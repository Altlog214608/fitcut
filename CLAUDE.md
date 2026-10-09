# CLAUDE.md

Claude Code가 세션마다 읽는 프로젝트 안내서다. 원칙과 문서 지도만 짧게 두고, 상세 내용은 `docs/`에 있다.

## 프로젝트 요약

FitCut(가칭)은 사진·영상·음성을 기기와 용도에 딱 맞게 바꿔주는 웹 서비스다.

- 사진 도구: 리사이즈·크롭, 폰·폴더블·태블릿·워치 기기 프리셋
- 움짤 도구: 영상 구간을 프레임 단위로 골라 GIF·WebP·MP4로 변환
- 음성 도구: 영상에서 음성 추출, 구간 자르기, 벨소리 프리셋
- 링크 구간: 유튜브 링크를 공식 플레이어로 재생하며 구간을 저장하고 반복 재생 (파일은 만들지 않는다)
- 하이라이트 도구: 스트리머가 채널을 연결하면 라이브 채팅을 수집해 하이라이트 후보를 찾는다
- 관리자 화면: 관리자만 보는 사용 분석, 비용, 보관 동의 파일

이 프로젝트는 클라우드 직군 포트폴리오다. 기능만큼 중요한 목표는 **AWS 서버리스로 유휴 비용이 거의 0인 구조를 만들고, 그 근거를 숫자로 남기는 것**이다.

## 문서 지도

작업 전에 관련 문서를 먼저 읽는다.

| 문서 | 읽는 때 |
| --- | --- |
| `docs/ROADMAP.md` | 매 작업 시작 시. 현재 마일스톤과 체크리스트 |
| `docs/PRD.md` | 기능 범위, 우선순위, 하지 않는 것 |
| `docs/FEATURES.md` | 기능 구현 시. 상세 명세와 수용 기준 |
| `docs/ARCHITECTURE.md` | 인프라·백엔드 작업. 처리 위치, AWS 구성, 비용 가드레일 |
| `docs/HIGHLIGHT.md` | 하이라이트 도구, 플랫폼 채팅 수집 작업 |
| `docs/ADMIN.md` | 사용 이벤트 수집, 관리자 화면, 파일 보관, 개인정보 작업 |
| `docs/PRESETS.md` | 기기 프리셋 데이터 작업 |
| `docs/UI.md` | 프론트엔드, 디자인, 화면 문구 작업 |
| `docs/DECISIONS.md` | 기술 결정 확인과 기록 (ADR) |

## 작업 방식

1. `docs/ROADMAP.md`에서 현재 마일스톤을 확인하고, 한 번에 한 마일스톤만 진행한다.
2. 여러 파일을 바꾸는 작업은 구현 전에 계획(바꿀 파일, 접근 방식, 영향)을 먼저 보여주고 확인을 받는다.
3. 작업이 끝나면 ROADMAP 체크박스를 갱신한다. 기술 결정을 내렸거나 바꿨으면 `docs/DECISIONS.md`에 기록한다.
4. 사실 데이터(기기 해상도, AWS 한도·가격, 외부 API 쿼터·약관)는 추측하지 않는다. 공식 문서로 확인하거나 사용자에게 묻는다. 확인하지 못한 값은 `TODO(verify)`로 표시한다.
5. 측정할 수 있는 것은 측정해서 남긴다(처리 시간, 잡당 비용, 월 비용). README의 측정 결과 표가 최종 목적지다.

## 반드시 지킬 원칙

- **가장 싼 곳에서 처리한다.** 브라우저 > Lambda > Fargate Spot 순서. 사진 작업은 브라우저에서 끝낸다.
- **상시 과금 리소스를 만들지 않는다.** EC2, NAT Gateway, 상시 Fargate 서비스, 상시 추론 엔드포인트, 프로비저닝된 동시성은 금지. 라이브 채팅 수집기처럼 오래 도는 작업은 방송 중에만 실행하고 끝나면 반드시 종료한다. 예외가 필요하면 DECISIONS.md에 근거를 쓰고 사용자 확인을 받는다.
- **파일은 기본적으로 짧게 둔다.** 업로드·결과 파일은 S3 수명 주기로 자동 삭제한다. 오래 보관하는 것은 사용자가 동의한 파일만, 정해진 기간 동안이다 (ADR-009). 관리자의 파일 열람은 모두 기록한다.
- **사진 원본은 서버로 보내지 않는다.** 사진 도구의 분석은 메타데이터 이벤트로만 한다.
- **외부 플랫폼 영상은 내려받지 않는다.** 일부 구간이라도 URL로 영상·음성을 내려받거나 방송을 녹화하는 기능은 만들지 않는다. 링크는 공식 임베드 플레이어로 재생하고 링크·구간 정보만 저장한다. 외부 연동은 공식 API로 채팅 데이터만 쓰고, 비공식 API는 쓰지 않는다.
- **개인정보는 최소로 수집한다.** 파일명, 원본 IP, 채팅 닉네임은 저장하지 않는다 (IP는 솔트 해시로만).
- **비밀값은 저장소에 두지 않는다.** SSM Parameter Store(SecureString)를 쓴다. 스트리머의 플랫폼 OAuth 토큰은 KMS로 암호화해 저장한다. IAM은 함수별 최소 권한. S3 퍼블릭 액세스는 차단.
- **관리자 API는 Cognito 관리자 그룹 + MFA로만 접근한다.** 프론트에서 메뉴를 숨긴 것을 보호로 보지 않는다.
- **인프라는 Terraform으로만 바꾼다.** 콘솔에서 수동으로 바꾸지 않는다.
- **실제 AWS 적용(`terraform apply`, 배포)은 사용자가 요청할 때만** 한다. 평소에는 `terraform plan`까지만. 예외로, 인프라 변경이 없는 PR(CI의 dev plan이 "No changes")은 CI 통과 후 Claude가 머지해도 된다. 웹 배포만 일어나기 때문이다 (사용자 허락 2026-10-09, ADR-018). 인프라가 바뀌는 PR은 plan 요약을 보여주고 사용자가 머지한다.

## 기술 스택

바꾸면 DECISIONS.md를 갱신한다.

- 프론트엔드: React, TypeScript, Vite. 이미지 처리는 Web Worker + OffscreenCanvas
- 백엔드: TypeScript (Lambda가 지원하는 최신 Node.js LTS 런타임, arm64), ffmpeg
- 데이터: DynamoDB(온디맨드), S3, Amazon Data Firehose, Glue Data Catalog, Athena
- 인증: 관리자는 Cognito(MFA). 스트리머는 플랫폼 OAuth로 채널 연결 (세션 방식은 ADR-015)
- 인프라: Terraform, AWS 서울 리전(ap-northeast-2). CloudFront용 ACM 인증서만 us-east-1
- CI/CD: GitHub Actions + AWS OIDC (장기 액세스 키 금지)
- 테스트: Vitest(단위), Playwright(E2E)
- 패키지 관리: pnpm workspaces

## 저장소 구조 (목표)

```
apps/web/              프론트엔드 (관리자 화면은 /admin 라우트)
services/api/          잡·링크 API
services/dispatcher/   작업 크기에 따라 Lambda / Fargate로 분배
services/worker/       ffmpeg 워커: 움짤, 클립, 음성 (Lambda 컨테이너 이미지와 Fargate 태스크가 같은 코드 사용)
services/events/       사용 이벤트 수집 → Data Firehose
services/admin/        관리자 API, 일별 집계
services/highlight/    하이라이트 분석 (점수 계산은 순수 함수로)
services/collectors/   플랫폼별 라이브 채팅 수집 (치지직·YouTube는 Fargate, Kick·Twitch는 웹훅 Lambda)
packages/presets/      기기 프리셋 데이터(JSON)와 스키마
packages/shared/       공용 타입·유틸
infra/terraform/       IaC (modules/, envs/dev, envs/prod)
docs/                  기획·설계 문서
```

## 명령어

도구 버전: Node 24(`.nvmrc`), pnpm 12(`packageManager`), Terraform 1.16, TypeScript 6.0 (ADR-020).

```sh
pnpm install                 # 의존성 설치
pnpm dev                     # 웹 개발 서버 (apps/web)
pnpm lint                    # ESLint
pnpm format:check            # Prettier 검사 (pnpm format으로 고치기)
pnpm typecheck               # 모든 패키지 타입 검사
pnpm test                    # 모든 패키지 Vitest
pnpm build                   # 모든 패키지 빌드

terraform fmt -recursive infra/terraform
terraform -chdir=infra/terraform/envs/dev init
terraform -chdir=infra/terraform/envs/dev plan
```

- `infra/terraform/bootstrap`은 상태 버킷·GitHub OIDC 역할·Budgets를 만드는 1회성 스택이다. 로컬에서만 적용하고 CI는 건드리지 않는다. 개인 값은 커밋하지 않는 `terraform.tfvars`에 둔다 (`terraform.tfvars.example` 참고).
- `envs/dev`는 PR에서 plan, main 머지 시 GitHub Actions가 apply와 웹 배포를 한다 (ADR-018). plan이 "No changes"인 PR은 CI 통과 후 Claude가 `gh pr merge --merge --delete-branch`로 머지한다.
- 저장소는 공개다. 이메일·AWS 계정 ID 같은 개인 식별 값을 커밋하지 않는다.

## 코딩 규칙

- TypeScript strict. `any`는 피하고, 불가피하면 이유를 주석으로 남긴다.
- 계산 로직(순수 함수)과 I/O(AWS 호출, 파일 처리)를 분리해서 단위 테스트한다.
- 사용자에게 보이는 문구는 한국어로 쓰고, 규칙은 `docs/UI.md`를 따른다.
- 커밋은 Conventional Commits 형식 (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`).
- 새 의존성은 추가 이유와 라이선스를 확인한다. 특히 ffmpeg 빌드와 HEIC 디코더.
