# 관리자·사용 분석

## 목표

- 서비스가 어떻게 쓰이는지 관리자(본인)만 볼 수 있는 화면을 만든다.
- 포트폴리오 포인트: 서버리스 데이터 파이프라인(수집 → 저장 → 쿼리 → 대시보드), 접근 통제, 개인정보 최소 수집.

## 무엇을 저장하나

| 데이터 | 저장 위치 | 보관 |
| --- | --- | --- |
| 사용 이벤트 (아래 목록) | S3 analytics (Parquet) | 12개월 |
| 잡 메타데이터 | DynamoDB | 90일 (TTL) |
| 링크와 구간 (YouTube URL, 시작·끝) | DynamoDB | 12개월 |
| 업로드·결과 파일 | S3 uploads·outputs | 1~2일 자동 삭제 |
| 보관 동의 파일 | S3 retained (SSE-KMS) | 30일 |
| 사진 | 서버에 올라오지 않음 (보관 동의 시 결과 이미지만) | 위와 같음 |
| 관리자 행동 기록 | DynamoDB `AUDIT#` | 12개월 |

## 사용 이벤트

모든 이벤트에 공통으로 `sessionId`(브라우저에 저장한 무작위 값, 신원과 연결하지 않음), `ts`, `appVersion`이 붙는다.

| 이벤트 | 주요 속성 |
| --- | --- |
| `session_start` | deviceType, os, browser, referrerDomain, lang |
| `tool_open` | tool (photo, gif, audio, link, highlight) |
| `file_selected` | kind, mime, sizeBucket, width, height, durationSec |
| `preset_selected` | presetId |
| `preset_search_miss` | query (검색했는데 없던 기기 → 프리셋 추가 우선순위) |
| `export_done` | tool, format, width, height, sizeBytes, elapsedMs (브라우저 작업 포함) |
| `job_created` / `job_succeeded` / `job_failed` | jobId, type, inputSize, durationSec, worker(lambda·fargate), processingMs, estCostUsd, errorCode |
| `link_saved` | platform, videoId, start, end |
| `link_embed_blocked` | platform, videoId |
| `retain_consent` | scope (retain_30d), given |
| `error_shown` | code |

저장하지 않는 것: 파일 내용(보관 동의 파일 제외), 파일명, 원본 IP(솔트 해시만, 솔트는 주기적으로 교체), 채팅 닉네임.

## 파이프라인

```
브라우저 sendBeacon ─→ POST /events (여러 개를 묶어서) → Lambda(events)
                         허용된 이벤트·필드만 통과 (스키마 검증)
서버 잡 이벤트 ──────────→ 같은 Firehose
   → Data Firehose (버퍼링, JSON → Parquet 변환)
   → S3 analytics/dt=YYYY-MM-DD/
   → Glue Data Catalog 테이블 → Athena
매일 새벽: EventBridge Scheduler → Lambda(aggregate)
   → Athena 쿼리 (전날 파티션만) → 일별 집계 JSON (S3 artifacts)
비용: 하루 한 번 Cost Explorer API → 태그별 일별 비용 저장
```

- 관리자 화면은 일별 집계만 읽는다. 오늘 실시간 지표는 DynamoDB 잡 테이블(GSI1 날짜별)에서 바로 읽는다.
- 깊이 보고 싶은 분석은 관리자 화면의 "직접 쿼리"(미리 정한 쿼리 목록 중 선택, 기간 지정)로 Athena를 돌린다. 임의 SQL 입력은 받지 않는다.

## 관리자 화면

| 화면 | 내용 |
| --- | --- |
| 개요 | 오늘·7일·30일 세션 수, 도구별 작업 수, 성공률, 추정 비용, 실제 청구액(어제까지) |
| 도구 사용 | 도구별 추이, 형식·크기·길이 분포, 파일 선택 → 저장 전환율 |
| 기기 프리셋 | 인기 프리셋 순위, 검색했는데 없던 기기 순위 |
| 성능 | 잡 처리 시간 p50·p95, 대기 시간, 실패 사유 순위, Lambda와 Fargate 비율 |
| 링크 | 플랫폼별 저장 수, 많이 저장된 영상, 임베드가 막힌 영상 수 |
| 하이라이트 | 연결된 채널 수, 수집한 방송 수, 수집 시간, 분석 비용, YouTube 할당량 사용량 |
| 보관 파일 | 보관 동의 파일 목록, 미리보기(5분짜리 서명 URL), 삭제. 열람·삭제는 감사 로그에 남는다 |
| 감사 로그 | 관리자 로그인과 파일 열람·삭제 기록 |

## 접근 통제

- Cognito 사용자 풀: 셀프 가입 끔, 관리자 계정만 만든다, MFA 필수, `admin` 그룹
- `/admin/*` API: HTTP API JWT 권한 부여자 + Lambda에서 `cognito:groups`에 admin이 있는지 다시 확인
- 프론트의 `/admin` 라우트는 숨김일 뿐이고, 실제 보호는 API에서 한다
- (선택) WAF로 `/admin/*` API를 특정 IP에서만 허용

## 비용

- Athena: 워크그룹에 쿼리당 스캔 한도, 파티션으로 날짜 범위 제한, 결과 버킷 7일 후 삭제
- 집계는 하루 한 번만 돌리고 화면은 집계를 읽는다
- Data Firehose 버퍼를 크게 잡아 S3 객체 수를 줄인다
- Cost Explorer API는 요청마다 요금이 붙으므로 하루 한 번만 호출한다
- 목표: 분석 파이프라인 월 비용을 README에 따로 기록한다

## 개인정보

이 부분은 설계 원칙이다. 공개 전에 개인정보보호법 기준으로 따로 검토한다.

- 개인정보 처리방침 페이지: 수집 항목, 목적, 보관 기간, 파기 방법, 문의처
- 보관 동의는 기본 꺼짐. 목적과 기간을 동의 화면에 적는다
- 사용자는 "내 작업 기록"에서 언제든 보관 파일을 삭제할 수 있다
- 스트리머는 채널 연결을 해제하면 토큰과 수집 데이터 삭제를 요청할 수 있다
