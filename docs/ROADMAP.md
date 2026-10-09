# 로드맵

마일스톤은 순서대로 진행한다. 완료 기준을 만족해야 다음 마일스톤으로 넘어간다. 작업하면서 체크박스를 갱신한다. 기간은 대략적인 예상치다.

## M0. 프로젝트 기반 (1주)

- [x] pnpm 모노레포, TypeScript strict, ESLint, Prettier
- [x] `apps/web`: Vite + React 초기화, 라우팅 (홈, 사진, 움짤, 음성, 링크, 하이라이트, 관리자)
- [x] `infra/terraform`: S3 원격 상태, dev 환경, 공통 태그 (`Project=fitcut`, `Env`, `Component`)
- [x] S3(web) + CloudFront(OAC) 정적 배포
- [x] GitHub Actions: PR에서 lint·test·`terraform plan`, main 머지 시 배포 (OIDC, plan 역할과 배포 역할 분리)
- [x] AWS Budgets 알림 (월 $20, 실제 50%·100%, 예측 100%)
- [x] CLAUDE.md의 "명령어" 섹션 채우기
- [ ] 비용 할당 태그(`Project`, `Env`, `Component`) 활성화 — 첫 배포 후 태그가 결제 데이터에 나타나면 Terraform으로

완료 기준: main에 머지하면 빈 페이지가 CloudFront 주소로 자동 배포된다.

완료 (2026-10-09): PR #1 머지 → Deploy 워크플로가 dev에 apply(리소스 11개)하고 웹을 올렸다. 확인한 것:

- 모든 경로(`/photo` 등, 없는 경로 포함)가 새로고침해도 200 + index.html. 없는 정적 파일은 403
- `index.html`은 `Cache-Control: no-cache`, `assets/`는 `max-age=31536000, immutable`
- 보안 헤더(HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) 적용, HTTP는 HTTPS로 301
- S3 버킷 직접 접근은 403 (CloudFront OAC로만 읽힘). 서울 엣지(ICN)에서 응답

남은 후속 작업: 비용 할당 태그 활성화 (태그가 결제 데이터에 나타난 뒤).

## M1. 사진 도구 (2주)

- [ ] 드롭 영역, 파일 종류를 판별해 알맞은 도구 열기
- [ ] Web Worker 리사이즈·크롭 (채우기, 맞추기, 늘이기, 흐린 배경 채우기)
- [ ] EXIF 방향 반영, 위치정보 제거
- [ ] JPG·PNG·WebP 저장, 화질 옵션
- [ ] `packages/presets`: 스키마, 검증 테스트, 1차 기기 데이터 (출처 포함)
- [ ] 기기 검색, 최근 기기, 내 기기
- [ ] 화면 모양 가이드 (rect, rounded-rect, circle)
- [ ] 디자인 계획 제안 → 확인 → 적용
- [ ] 모바일 레이아웃

완료 기준: 폰에서 사진 하나로 아이폰 배경과 갤럭시 워치 배경을 30초 안에 만든다. 작업 중 네트워크 탭에 업로드 요청이 없다.

## M2. 움짤 도구 + 서버리스 파이프라인 + 이벤트 수집 (3주)

- [ ] 타임라인: 썸네일 스트립, 핸들, 확대, 키보드, 시간 입력, 구간 반복
- [ ] 업로드와 미리보기를 동시에 진행 (Object URL)
- [ ] API: `POST /jobs`, `GET /jobs/{id}` (HTTP API + Lambda + DynamoDB)
- [ ] presigned POST 업로드 (크기·타입 제한)
- [ ] dispatcher: 작업 크기에 따라 Lambda / Fargate Spot으로 분배
- [ ] ffmpeg 워커: GIF(팔레트 2단계), WebP, MP4, 프레임 단위로 정확한 자르기
- [ ] 출력 프리셋 (갤럭시 워치 GIF, 애플워치용 짧은 MP4), 예상 용량 표시
- [ ] S3 수명 주기, IP별 일일 할당량, WAF 속도 제한
- [ ] 사용 이벤트 수집 기본: `POST /events` → Lambda → Data Firehose → S3 (M1 사진 도구 이벤트도 연결)
- [ ] Lambda 메모리별 실행 시간·비용 측정 (Lambda Power Tuning) → DECISIONS의 ADR-002 확정

완료 기준: 1분 영상에서 5초 구간을 GIF로 만든다. 처리 시간과 잡당 비용이 README에 기록되어 있다. 사진·움짤 사용 이벤트가 S3에 쌓인다.

## M3. 편의 기능 + 음성 + 링크 구간 (3주)

- [ ] 잠금화면·워치 미리보기 오버레이 (F7)
- [ ] 여러 기기 한 번에 → ZIP (F8)
- [ ] 목표 용량 맞추기 (F9)
- [ ] HEIC 입력 (F10)
- [ ] 음성 추출·벨소리: 파형 타임라인, MP3·M4A·WAV, 페이드, 음량 맞추기 (F14)
- [ ] 링크 구간: YouTube IFrame Player, 구간 저장 API, 구간 반복 페이지, 임베드 불가 안내 (F15)

완료 기준: F7~F10, F14, F15의 수용 기준을 통과한다.

## M4. 관리자·분석 (2주)

- [ ] Cognito 사용자 풀 (셀프 가입 끔, MFA, admin 그룹), `/admin/*` API 권한
- [ ] Glue Data Catalog 테이블, Athena 워크그룹 (스캔 한도)
- [ ] 일별 집계 Lambda (EventBridge Scheduler), Cost Explorer 일일 수집
- [ ] 관리자 화면: 개요, 도구 사용, 기기 프리셋, 성능, 링크, 감사 로그
- [ ] 작업 파일 보관 동의 (F16): 동의 UI, retained 버킷, 내 작업 기록 삭제, 관리자 보관 파일 화면
- [ ] 개인정보 처리방침 페이지

완료 기준: 관리자 계정으로만 대시보드에 들어갈 수 있고, 전날 사용 통계와 비용이 보인다. 보관 파일 열람이 감사 로그에 남는다.

## M5. 방송 하이라이트 (3주)

- [ ] 치지직 개발자센터 앱 등록, 공식 문서 확인 항목 정리 (`docs/HIGHLIGHT.md`)
- [ ] 스트리머 채널 연결 (OAuth, KMS 암호화 토큰 저장, 연결 해제)
- [ ] 치지직 수집기 (Fargate, 여러 채널 담당, 시작·종료 규칙)
- [ ] 채팅 이벤트 → Data Firehose 동적 파티셔닝 → S3 방송별 경로
- [ ] 분석 Step Functions: 채팅 특징, 점수 계산(순수 함수 + 단위 테스트), 후보 저장
- [ ] 모드 A 결과: 시각 목록, 마커 파일, 유튜브 댓글용 타임라인 텍스트
- [ ] 모드 B: 녹화 파일 멀티파트 업로드, 싱크 보정, 후보 주변만 처리, 움짤 도구 연결
- [ ] 모드 C: 파일 전체 소리 크기 분석
- [ ] 리플레이 데모 모드
- [ ] 테스트 방송으로 데이터 수집, 라벨링, precision@5·precision@10 측정

완료 기준: 테스트 방송 1회를 수집·분석해 후보 10개를 만든다. 수집·분석 비용, 처리 시간, 정확도가 README에 기록되어 있다.

## M6. AI·플랫폼 확장 (선택)

- [ ] YouTube 수집기: streamList 할당량 실측, 폴링 대안, 할당량 80% 차단 (ADR-014)
- [ ] Kick·Twitch 웹훅 수집 (API Gateway + Lambda, 서명 검증)
- [ ] 하이라이트 제목 생성: 모드 A는 Bedrock 채팅 요약, 모드 B·C는 Transcribe + Bedrock (F12)
- [ ] 스마트 크롭 (Rekognition), 브라우저 모델과 비용·품질 비교 (F11)
- [ ] 자막 파일 만들기 (Transcribe SRT·VTT, F18)
- [ ] 오디오그램 (F19)
- [ ] 애플워치용 Live Photo를 웹에서 만들어 저장하는 방법 조사

## M7. 운영 고도화

- [ ] k6 부하 테스트 (잡 생성 API, 동시 변환, 이벤트 수집)
- [ ] CloudWatch 대시보드, 실패율 알람
- [ ] 태그별 월 비용 리포트 → README
- [ ] 브라우저 변환(ffmpeg.wasm)과 서버 변환 비교 실험 (ADR-003)
- [ ] (선택) PR 미리보기 환경, 보안 사고 자동 대응
