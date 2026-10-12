import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROADCAST_ID,
  BroadcastError,
  DAILY_STARTS,
  isStale,
  makeBroadcasts,
  newBroadcastId,
} from './broadcasts';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2' }));
const ecs = new ECSClient({ region: 'ap-northeast-2' });
const ddbMock = mockClient(ddb);
const ecsMock = mockClient(ecs);
const NOW = new Date('2026-10-12T09:00:00Z');
const CH = 'ch1';

const b = makeBroadcasts({
  env: {
    TABLE_NAME: 't',
    CLUSTER: 'cluster',
    TASK_FAMILY: 'fitcut-dev-collector',
    SUBNETS: 'subnet-a,subnet-b',
    SECURITY_GROUP: 'sg-1',
  },
  ddb,
  ecs,
  now: () => NOW,
});

const conditionFailed = () => {
  const e = new Error('cond');
  e.name = 'ConditionalCheckFailedException';
  return e;
};

/** UpdateCommand를 키·식에 따라 답한다 */
function updates(
  fn: (input: {
    Key: { PK: string; SK: string };
    UpdateExpression: string;
    ConditionExpression?: string;
  }) => unknown,
) {
  ddbMock.on(UpdateCommand).callsFake(fn);
}

beforeEach(() => {
  ddbMock.reset();
  ecsMock.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('newBroadcastId', () => {
  it('UTC 시각 14자리 + 무작위 6자리', () => {
    const id = newBroadcastId(NOW);
    expect(id).toMatch(BROADCAST_ID);
    expect(id.startsWith('20261012090000-')).toBe(true);
  });
});

describe('isStale', () => {
  it('끝난 방송이나 5분 넘게 소식이 없는 방송은 멈춘 것으로 본다', () => {
    expect(isStale({ status: 'done' }, NOW)).toBe(true);
    expect(isStale({ status: 'collecting', heartbeatAt: '2026-10-12T08:58:00Z' }, NOW)).toBe(false);
    expect(isStale({ status: 'collecting', heartbeatAt: '2026-10-12T08:54:00Z' }, NOW)).toBe(true);
    expect(isStale({ status: 'starting', requestedAt: '2026-10-12T08:57:00Z' }, NOW)).toBe(false);
  });
});

describe('start', () => {
  it('하루 횟수·수집 중 표시를 잡고, 방송 기록을 만든 뒤 Fargate 태스크를 띄운다', async () => {
    updates(() => ({}));
    ecsMock.on(RunTaskCommand).resolves({ tasks: [{ taskArn: 'arn:task/1' }] });
    const r = await b.start(CH);
    expect(r).toMatchObject({ status: 'starting', requestedAt: NOW.toISOString(), chatCount: 0 });

    const quota = ddbMock
      .commandCalls(UpdateCommand)
      .map((c) => c.args[0].input)
      .find((i) => String(i.Key?.PK).startsWith('QUOTA#'));
    expect(quota?.Key).toEqual({ PK: `QUOTA#chzzk#${CH}#20261012`, SK: 'COLLECT' });
    expect(quota?.ExpressionAttributeValues?.[':max']).toBe(DAILY_STARTS);

    const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(put).toMatchObject({ PK: `CONN#chzzk#${CH}`, SK: `BCAST#${r.id}`, status: 'starting' });

    const run = ecsMock.commandCalls(RunTaskCommand)[0]?.args[0].input;
    expect(run).toMatchObject({
      cluster: 'cluster',
      taskDefinition: 'fitcut-dev-collector',
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ['subnet-a', 'subnet-b'],
          securityGroups: ['sg-1'],
          assignPublicIp: 'ENABLED',
        },
      },
    });
    expect(run?.overrides?.containerOverrides?.[0]?.environment).toEqual([
      { name: 'BROADCAST_ID', value: r.id },
      { name: 'CHANNEL_ID', value: CH },
    ]);
  });

  it('하루 횟수를 넘으면 429', async () => {
    updates((i) => {
      if (i.Key.PK.startsWith('QUOTA#')) throw conditionFailed();
      return {};
    });
    await expect(b.start(CH)).rejects.toMatchObject({ status: 429, code: 'daily_limit' });
    expect(ecsMock.commandCalls(RunTaskCommand)).toHaveLength(0);
  });

  it('살아 있는 수집이 있으면 409', async () => {
    updates((i) => {
      if (i.Key.SK === 'META' && i.ConditionExpression?.includes('attribute_not_exists')) {
        throw conditionFailed();
      }
      return {};
    });
    ddbMock
      .on(GetCommand)
      .callsFake((i: { Key: { SK: string } }) =>
        i.Key.SK === 'META'
          ? { Item: { activeBroadcastId: 'old' } }
          : { Item: { status: 'collecting', heartbeatAt: '2026-10-12T08:59:30Z' } },
      );
    const err = await b.start(CH).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BroadcastError);
    expect(err).toMatchObject({ status: 409 });
  });

  it('멈춘 수집(5분 넘게 소식 없음)은 새 수집으로 바꾼다', async () => {
    let tries = 0;
    updates((i) => {
      if (i.Key.SK === 'META' && i.UpdateExpression.startsWith('SET activeBroadcastId')) {
        tries += 1;
        if (tries === 1) throw conditionFailed();
      }
      return {};
    });
    ddbMock
      .on(GetCommand)
      .callsFake((i: { Key: { SK: string } }) =>
        i.Key.SK === 'META'
          ? { Item: { activeBroadcastId: 'old' } }
          : { Item: { status: 'collecting', heartbeatAt: '2026-10-12T08:40:00Z' } },
      );
    ecsMock.on(RunTaskCommand).resolves({ tasks: [{ taskArn: 'arn:task/2' }] });
    await expect(b.start(CH)).resolves.toMatchObject({ status: 'starting' });
    expect(tries).toBe(2);
  });

  it('태스크를 못 띄우면 failed로 남기고 수집 중 표시를 푼다', async () => {
    updates(() => ({}));
    ecsMock.on(RunTaskCommand).resolves({ tasks: [], failures: [{ reason: 'RESOURCE:CPU' }] });
    await expect(b.start(CH)).rejects.toMatchObject({ status: 503, code: 'run_task' });
    const exprs = ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input.UpdateExpression);
    expect(exprs).toContain('REMOVE activeBroadcastId');
    expect(exprs.some((e) => e?.includes('stopReason'))).toBe(true);
  });
});

describe('stop·list', () => {
  it('수집 중인 방송에 종료 요청을 남긴다', async () => {
    updates(() => ({
      Attributes: {
        id: 'x',
        status: 'collecting',
        requestedAt: 'r',
        stopRequested: true,
        chatCount: 5,
      },
    }));
    const r = await b.stop(CH, '20261012090000-abcdef');
    expect(r).toMatchObject({ status: 'collecting', stopRequested: true, chatCount: 5 });
    const i = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(i?.Key).toEqual({ PK: `CONN#chzzk#${CH}`, SK: 'BCAST#20261012090000-abcdef' });
  });

  it('이미 끝난 방송은 그대로 돌려준다', async () => {
    updates(() => {
      throw conditionFailed();
    });
    ddbMock.on(GetCommand).resolves({ Item: { id: 'x', status: 'done', requestedAt: 'r' } });
    await expect(b.stop(CH, '20261012090000-abcdef')).resolves.toMatchObject({ status: 'done' });
  });

  it('목록은 최신순 20개, 내부 값(taskArn·키)은 빼고', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'p',
          SK: 's',
          id: 'x',
          status: 'done',
          requestedAt: 'r',
          taskArn: 'arn',
          chatCount: 3,
        },
      ],
    });
    const list = await b.list(CH);
    expect(list).toEqual([
      {
        id: 'x',
        status: 'done',
        requestedAt: 'r',
        chatCount: 3,
        donationCount: 0,
        subscriptionCount: 0,
      },
    ]);
    const q = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(q).toMatchObject({ ScanIndexForward: false, Limit: 20 });
  });
});
