# 아키텍처

## 설계 원칙

1. **가장 싼 곳에서 처리한다.** 브라우저 > Lambda > Fargate Spot.
2. **유휴 비용은 거의 0.** 상시 켜진 리소스가 없다. 채팅 수집기도 방송 중에만 돈다.
3. **파일은 기본적으로 짧게 둔다.** 업로드·결과 파일은 수명 주기로 자동 삭제하고, 동의한 파일만 30일 보관한다.
4. **비동기 작업은 모두 "잡(Job)"이다.** 움짤·음성 변환과 하이라이트 클립이 같은 잡 모델과 워커를 쓴다.
5. **비용 상한이 설계에 들어 있다.** 입력 제한, 동시성 제한, 일일 할당량, 예산 알림.
6. **개인정보는 최소로.** 분석은 메타데이터로 하고, 파일명·원본 IP·채팅 닉네임은 저장하지 않는다.

## 처리 위치

| 작업 | 처리 위치 | 이유 |
| --- | --- | --- |
| 사진 리사이즈·크롭·포맷 변환 | 브라우저 (Web Worker) | 서버 비용 0, 업로드 대기 없음, 사진이 서버로 가지 않음 |
| ZIP 묶기, 목표 용량 맞추기 | 브라우저 | 위와 같음 |
| 사진 확대: 보간(M1), AI 업스케일(M3) | 브라우저 (Web Worker, AI는 WebGPU·wasm) | 사진이 서버로 가지 않음. 모델 파일은 처음 쓸 때만 내려받아 캐시 (ADR-023) |
| HEIC 디코딩 | 브라우저 (wasm) 우선 검토 | 라이선스·번들 크기 확인 필요 |
| 링크 구간 재생·선택 | 브라우저 (YouTube 공식 플레이어) | 영상이 서버를 거치지 않음 |
| 짧은 영상 변환 (초안: 구간 30초·원본 200MB 이하) | Lambda 컨테이너 이미지 + ffmpeg (arm64) | 수 초~수 분 작업, 쓴 만큼 과금 |
| 음성 추출·벨소리 | Lambda (같은 워커) | 가벼운 작업 |
| 영상 세로로 돌리기 | 회전 정보만 바꾸기는 Lambda, 재인코딩은 작업 크기에 따라 Lambda / Fargate Spot (같은 워커) | 영상 전체를 다루므로 움짤보다 길 수 있음 (ADR-024) |
| 긴 영상 변환, 오디오 분석, 오디오그램 | ECS Fargate Spot 태스크 | Lambda 15분 제한, Spot으로 비용 절감 |
| 사용 이벤트 수집 | Lambda → SQS → 배치 Lambda | 쓴 만큼 과금, 최대 5분씩 모아 S3 객체 수를 줄임 (무료 플랜이라 Firehose 대신, ADR-030) |
| 관리자 집계 | 하루 한 번 Lambda + Athena | 화면은 집계만 읽어서 쿼리 비용 최소화 |
| 채팅 수집: 웹훅 플랫폼 (Kick, Twitch) | API Gateway + Lambda | 이벤트가 올 때만 실행 |
| 채팅 수집: 연결 유지 플랫폼 (치지직 세션, YouTube streamList) | Fargate 태스크 (일반), 방송 중에만 | 장시간 연결 필요. 태스크 하나가 여러 채널을 맡음 |
| 스마트 크롭 (M6) | Rekognition DetectFaces | 버튼을 눌렀을 때만, 축소 이미지로 |
| 자막 (M6) | Transcribe | 길이 상한 안에서만 |
| 하이라이트 제목 (M6) | Bedrock (+ 파일이 있으면 Transcribe) | 후보 구간에만 |

기준값은 M2에서 Lambda 메모리별 실행 시간·비용을 측정한 뒤 `docs/DECISIONS.md`에 확정한다. Fargate Spot은 중간에 회수될 수 있으므로 변환 워커는 멱등하게 만들고 재시도한다. 채팅 수집기는 회수되면 그동안의 채팅을 놓치므로 Spot을 쓰지 않는다.

## 요청 흐름 (움짤·음성 변환)

```
브라우저
 ├─ 정적 파일: CloudFront → S3(web)
 ├─ 사진 작업: 브라우저 안에서 끝 (서버 호출 없음)
 └─ 영상·음성 작업
     1. POST /jobs → API Gateway(HTTP API) → Lambda(api)
                      → DynamoDB에 잡 생성, IP별 일일 할당량 확인
                      ← S3 presigned POST (크기·타입 제한 정책 포함)
     2. 브라우저 → S3(uploads) 직접 업로드
     3. 업로드 완료 이벤트 → EventBridge → Lambda(dispatcher)
          ├─ 작은 작업: SQS → Lambda(worker, ffmpeg)
          └─ 큰 작업: ECS RunTask (Fargate Spot, 같은 worker 코드)
     4. 결과 → S3(outputs), DynamoDB 상태 갱신
        보관 동의 시: 원본·결과를 S3(retained)로 복사
     5. 브라우저: GET /jobs/{id} 폴링 (지수 백오프)
          → 완료 시 CloudFront 서명 URL로 다운로드
```

## 링크 구간 흐름

```
브라우저: 링크 → 영상 ID 추출 → YouTube IFrame Player로 재생 → 타임라인으로 구간 선택
  → POST /links (링크·구간만) → Lambda(api) → DynamoDB
구간 반복 페이지 /v/{id}: GET /links/{id} → 공식 플레이어 임베드 + 구간 반복
```

## 사용 이벤트·분석 흐름

자세한 내용은 `docs/ADMIN.md`.

```
브라우저 (sendBeacon) ──→ POST /events → Lambda(events: 검증, 허용 필드만 통과)
서버 잡 상태 변화 ──────────────────────────┘
   → SQS → Lambda(배치 창 최대 5분) → S3(analytics) gzip JSON Lines, dt=YYYY-MM-DD 파티션 (ADR-030)
   → Glue Data Catalog → Athena
매일 새벽: EventBridge Scheduler → Lambda(aggregate) → Athena 쿼리 → 일별 집계(S3 JSON)
관리자 화면 → /admin API (Cognito JWT + admin 그룹)
   → 일별 집계 읽기, 오늘 지표는 DynamoDB에서
```

## 하이라이트 흐름

자세한 내용은 `docs/HIGHLIGHT.md`.

```
스트리머: 채널 연결 (플랫폼 OAuth) → 토큰을 KMS로 암호화해 저장
방송 시작: 수동 "수집 시작" 또는 정기 방송 시간에 EventBridge Scheduler
  ├─ 치지직·YouTube: ECS RunTask (수집기 태스크, 여러 채널 담당)
  └─ Kick·Twitch: 웹훅 → API Gateway → Lambda (서명 검증, 중복 제거)
  → 채팅 이벤트 정규화 (닉네임 제거)
  → SQS → 배치 Lambda → S3(chat) 방송별 경로 (ADR-030)
방송 종료 → 수집 중지 → SQS가 비고 배치 Lambda가 끝날 때까지 대기 → Step Functions
  1. 채팅 특징 계산 (Lambda)
  2. (녹화 파일이 있으면) 후보 주변만 오디오 분석 + 싱크 보정 (Fargate Spot)
  3. 점수 계산·피크 검출·구간 병합 (Lambda)
  4. (M6) 제목 생성 (Bedrock, 필요하면 Transcribe)
  5. 결과 저장 (후보는 DynamoDB, 시계열은 S3 JSON)
```

## 데이터 모델 (DynamoDB 단일 테이블, 온디맨드)

| PK | SK | 주요 속성 |
| --- | --- | --- |
| `JOB#<id>` | `META` | type(gif·webp·mp4·audio·rotate·subtitle·audiogram·clip), status(created·uploaded·queued·processing·done·failed), params, inputKey, outputKeys, retain, retainUntil, deleteTokenHash, error, createdAt, ttl |
| `LINK#<id>` | `META` | platform, videoId, start, end, createdAt |
| `CONN#<플랫폼>#<채널ID>` | `META` | encryptedTokens(KMS), scopes, connectedAt, status |
| `BCAST#<id>` | `META` | platform, channelId, startedAt, endedAt, collector(task·webhook), eventCount, analysisStatus |
| `BCAST#<id>` | `CAND#<순번>` | start, end, score, signals, title |
| `QUOTA#<IP해시>#<yyyymmdd>` | `COUNT` | count (원자적 증가), ttl |
| `AUDIT#<yyyymm>` | `<시각>#<관리자>` | action(view·download·delete), target |

- GSI1: `GSI1PK = DAY#<yyyymmdd>`, `GSI1SK = <시각>#<PK>` → 관리자 화면의 날짜별 목록
- TTL 삭제는 즉시 일어나지 않는다. 조회할 때 ttl이 지났으면 만료된 것으로 취급한다.

## S3 버킷

| 버킷 | 용도 | 수명 주기 |
| --- | --- | --- |
| web | 정적 사이트 | 버전 관리, 이전 버전은 30일 후 삭제 |
| uploads | 원본 업로드 | 1일 후 만료, 완료되지 않은 멀티파트 업로드는 1일 후 중단 |
| outputs | 결과물 | 1일 후 만료 |
| retained | 보관 동의 파일 (SSE-KMS) | 30일 후 만료 |
| chat | 수집한 채팅 이벤트 (닉네임 제거, 방송별 경로) | 30일 후 만료 |
| artifacts | 하이라이트 시계열, 일별 집계 | 시계열 90일, 집계는 보관 |
| analytics | 사용 이벤트 (Parquet, dt 파티션) | 12개월 후 만료 |
| athena-results | Athena 쿼리 결과 | 7일 후 만료 |

- 모든 버킷은 퍼블릭 액세스를 차단한다. web은 CloudFront OAC로만, outputs는 CloudFront 서명 URL로만 접근한다. retained는 관리자 API가 발급하는 짧은 서명 URL로만 연다.
- 수명 주기 만료는 다음 자정(UTC) 기준으로 계산되고 비동기로 처리된다. 그래서 화면 문구는 "24시간 후 삭제"가 아니라 "보통 1~2일 안에 자동 삭제"로 쓴다.

## 네트워크

- Lambda는 VPC 밖에서 실행한다 (VPC가 필요 없다).
- Fargate 태스크는 NAT Gateway 없이 실행한다: 퍼블릭 서브넷 + 퍼블릭 IP + 인바운드를 모두 막은 보안그룹. S3는 게이트웨이 VPC 엔드포인트(무료)로 접근한다.

## 보안

- 업로드: 일반 파일은 presigned POST 정책으로 `content-length-range`와 Content-Type을 제한한다. 하이라이트 녹화 파일은 멀티파트로 받고 업로드 후 크기를 검증한다 (ADR-008). 처리 전에 ffprobe로 실제 형식을 검증한다 (확장자를 믿지 않는다).
- API: HTTP API 단계 속도 제한, 잡 생성 시 IP 해시별 하루 할당량. WAF는 월 고정비 때문에 보류 (ADR-030).
- 관리자: Cognito 사용자 풀 (셀프 가입 끔, MFA 필수, admin 그룹). HTTP API JWT 권한 부여자로 막고, Lambda에서 그룹을 한 번 더 확인한다. 관리자 행동은 감사 로그에 남긴다.
- 웹훅: 플랫폼 서명을 검증하고, 메시지 ID로 재전송 중복을 제거한다.
- 스트리머 토큰: KMS로 암호화해 저장하고, 필요한 최소 권한(scope)만 요청한다. 연결을 해제하면 바로 삭제한다.
- IAM: 함수·태스크별 역할, 버킷·접두사 단위 최소 권한.
- 비밀값: SSM Parameter Store SecureString (플랫폼 클라이언트 시크릿 등).
- GitHub Actions: OIDC. `plan`용 역할(읽기 위주)과 배포 역할을 나누고, 배포 역할은 이 저장소의 main 브랜치에서만 맡을 수 있게 제한한다.
- (검토) GuardDuty S3 악성코드 검사: 비용 대비 효과를 보고 결정한다.

## 비용 가드레일

- AWS Budgets 월 예산 알림 (예: $10, $20 단계)
- 워커 동시 실행 상한: SQS 이벤트 소스 매핑의 최대 동시 실행 (계정 동시 실행 한도가 10이라 예약 동시성은 못 씀, ADR-030)
- Fargate 동시 태스크 상한 (dispatcher가 확인하고, 넘으면 대기열), 태스크 최대 실행 시간
- 입력 제한: 원본 크기, 구간 길이, 출력 해상도 상한
- 채팅 수집기: 최대 실행 시간(초안 8시간), 동시 수집 채널 상한, 태스크 하나가 여러 채널 담당
- YouTube: 할당량 사용량을 지표로 남기고, 80%를 넘으면 새 수집을 받지 않고 알림
- Athena: 워크그룹에 쿼리당 스캔 한도를 걸고, 파티션으로 범위를 제한하고, 결과는 7일 후 삭제
- 이벤트 수집 배치 Lambda: 배치 창을 크게 잡아 S3 객체 수를 줄인다
- Cost Explorer API는 요청마다 요금이 붙으므로 하루 한 번만 호출해 저장한다
- CloudWatch Logs 보존 기간 14일
- 모든 리소스에 `Project`, `Env`, `Component` 태그 → Cost Explorer에서 기능별 비용 확인

## 관측성

- 구조화 로그: Powertools for AWS Lambda (TypeScript)
- 지표: 잡 유형별 처리 시간(p50·p95), 실패율, 대기 시간, 잡당 추정 비용, 수집기 연결 끊김·재연결 횟수, YouTube 할당량 사용량
- CloudWatch 대시보드, 실패율 알람 → SNS 이메일

## 환경

- dev, prod (`infra/terraform/envs/dev`, `infra/terraform/envs/prod`)
- 리전은 ap-northeast-2. CloudFront용 ACM 인증서만 us-east-1에 만든다.
- Terraform 상태는 S3 백엔드에 두고 상태 잠금을 켠다.
