# 기기 프리셋

## 원칙

- 해상도 등 모든 수치는 제조사 공식 스펙을 기준으로 한다. 항목마다 출처 URL이 있어야 한다.
- 확인하지 못한 값은 넣지 않거나 `verified: false`로 둔다. `verified: false` 항목은 사용자에게 보이지 않는다.
- 프리셋은 코드가 아니라 데이터다. 새 기기는 JSON만 추가하면 된다. (나중에 S3 + CloudFront에서 JSON을 받아와 재배포 없이 갱신하는 방식도 검토)
- 관리자 화면의 "검색했는데 없던 기기" 순위로 추가 우선순위를 정한다.

## 스키마 (초안)

```ts
type DevicePreset = {
  id: string;                 // "galaxy-z-flip6"
  brand: string;              // "Apple", "Samsung", "Google"
  category: "phone" | "foldable" | "flip" | "tablet" | "watch";
  name: string;               // 화면에 보이는 이름
  aliases: string[];          // 검색어: "플립6", "flip 6"
  releaseYear: number;
  screens: Screen[];          // 폴드·플립은 화면이 여러 개
  source: string;             // 공식 스펙 페이지 URL
  verified: boolean;
  verifiedAt?: string;        // YYYY-MM-DD
};

type Screen = {
  role: "main" | "cover" | "inner";
  widthPx: number;
  heightPx: number;
  shape: "rect" | "rounded-rect" | "circle";
  cornerRadiusRatio?: number;      // rounded-rect 가이드용 대략값
  overlays?: Overlay[];            // 잠금화면 시계·카메라 등 (F7, 대략값)
  animated?: "gif" | "live-photo" | "none" | "unknown";  // 움짤 배경 형식
  notes?: string;
};

type Overlay = {
  kind: "clock" | "camera" | "widgets";
  x: number;   // 화면 대비 비율 (0~1)
  y: number;
  w: number;
  h: number;
};
```

## 1차 범위

최근 3~4년 사이 출시된 주요 모델부터 넣고, 요청이 많은 순서로 늘린다.

- 폰: 아이폰, 갤럭시 S
- 폴더블·플립: 갤럭시 Z 폴드(접은 화면·펼친 화면), 갤럭시 Z 플립(메인·커버 화면)
- 태블릿: 아이패드 계열, 갤럭시 탭 S
- 워치: 애플워치, 갤럭시 워치
- 이후: 갤럭시 A, 픽셀, 픽셀 워치 등

## 주의할 점

- **애플워치 화면은 원형이 아니라 둥근 사각형이다.** 갤럭시 워치는 원형이다. `shape`로 구분한다.
- **워치 움짤 형식은 기기마다 다르다.**
  - 갤럭시 워치: My Photo+ 워치 페이스에서 GIF를 쓸 수 있다 (Galaxy Watch4 업데이트부터). `animated: "gif"`. 현재 모델의 용량·길이 제한은 확인해서 `notes`에 적는다.
  - 애플워치: 움짤 배경 지원은 확인됨. 사진 워치 페이스가 Live Photo를 손목을 들 때 움직이게 보여주는 방식이다. `animated: "live-photo"`. 출력 방식은 FEATURES.md F3을 따른다.
- 폴드의 펼친 화면은 정사각형에 가깝다. 같은 사진도 크롭 위치가 크게 달라진다.
- 플립의 커버 화면은 작고 카메라가 화면 안에 들어와 있다. `overlays`로 표시한다.
- 해상도가 같아도 잠금화면 시계 위치는 기기와 OS 버전마다 다르다. `overlays`는 "대략적인 가이드"로만 쓰고 화면에도 그렇게 표시한다.
- 기기에 `overlays`가 없으면 OS별 공통 틀을 쓴다 (`src/overlays.ts`: 아이폰·갤럭시 One UI·픽셀의 폰 본 화면). 공식 수치가 없어 잠금화면 모양을 보고 잡은 대략값이다. TODO(verify): 실제 잠금화면 캡처(기본 시계 스타일)로 맞춘다.
- 아이폰 잠금화면 배경을 화면 해상도보다 크게 내보내야 하는지(확대·시차 효과 때문에)는 확인한 뒤 `notes`와 내보내기 기본값에 반영한다.

## 데이터 현황 (2026-10-10)

`packages/presets/data/`에 60개이고, 모두 확인되어 사용자에게 보인다(verified).

| 묶음 | 기기 | 출처 |
| --- | --- | --- |
| 아이폰 | 16, 16 Plus, 16 Pro, 16 Pro Max, 16e, 17, 17 Pro, 17 Pro Max, 17e, Air, 18 Pro, 18 Pro Max | Apple 지원 사이트 Tech Specs |
| 애플워치 | Series 10·11·12 (42·46mm), SE 3 (40·44mm), Ultra 3, Ultra 4 | Apple 지원 사이트 Tech Specs |
| 갤럭시 S | S26, S26+, S26 Ultra | Samsung Newsroom Korea 출시 기사 사양표 |
| 갤럭시 Z | Flip8 (메인·커버), Fold8·Fold8 Ultra (펼친 화면·커버) | Samsung Newsroom Korea 출시 기사 사양표 |
| 갤럭시 워치 | Watch9 (40·44mm), Watch Ultra2 | samsung.com 구매 가이드 |
| 2차 (2026-10-10) | | |
| 아이폰 | 15, 15 Plus, 15 Pro, 15 Pro Max | Apple 지원 사이트 Tech Specs |
| 아이패드 | Pro 11·13 (M5), Air 11·13 (M4), iPad (A16), mini (A17 Pro) | Apple 지원 사이트 Tech Specs |
| 갤럭시 S | S25, S25+, S25 Ultra | samsung.com 지원 페이지(영국) 비교표 |
| 갤럭시 Z | Fold7 (펼친 화면·커버), Flip7 (메인·커버) | Samsung Global Newsroom 보도자료 사양표 |
| 갤럭시 워치 | Watch8 (40·44mm), Watch8 Classic | samsung.com 지원 페이지(콜롬비아) |
| 갤럭시 탭 | Tab S11, Tab S11 Ultra | Samsung Global Newsroom 보도자료 사양표 |
| 픽셀 | 10, 10 Pro, 10 Pro XL, 10 Pro Fold, 10a, 11, 11 Pro, 11 Pro XL, 11 Pro Fold | Google Pixel 하드웨어 기술 사양 |

다음 배치: 갤럭시 A(A57·A37 등. 보도자료에 픽셀 해상도가 글자로 나오지 않아 공식 출처를 찾는 중), 관리자 화면의 "검색했는데 없던 기기" 순위.

- 태블릿은 세로로 든 방향(가로 < 세로)으로 넣었다. 태블릿 배경화면은 화면을 돌리면 같이 돌아가므로, 한 방향 크기로 만들지 긴 변 기준 정사각형으로 만들지는 확인한 뒤 내보내기 기본값에 반영한다. TODO(verify)
- Fold7 펼친 화면은 사양표가 `2184 x 1968`(세로 x 가로)이고, 펼친 크기(143.2 x 158.4mm)도 세로가 더 길어 방향이 맞는다. 방향 확인 방법은 아래 Fold8과 같다.
- Google은 해상도를 "가로 x 세로"(예: `1080 x 2424`)로, Apple은 "세로-by-가로"(예: `2556-by-1179`)로 적는다.

- 삼성 사양표는 해상도를 "세로 x 가로" 순서로 적는다 (예: S26 Ultra `3,120 x 1,440`). 데이터에는 `widthPx`·`heightPx`로 풀어서 넣는다.
- 폴더블 펼친 화면의 가로·세로는 사양표의 해상도 순서나 화면비 표기만으로는 정할 수 없다 (같은 기사 안에서도 순서가 섞여 있다). 그래서 같은 사양표의 "펼쳤을 때" 기기 크기와 화면 대각선으로 확인한다: 화면이 기기 안에 들어가는 방향이 맞는 방향이다 (2026-10-10).
  - Fold8: 펼친 크기 161.4 x 123.9mm, 7.6형 4:3 화면(약 154 x 116mm)은 가로로만 들어간다 → 2448 x 1848 (가로가 긴 화면)
  - Fold8 Ultra: 펼친 크기 143.2 x 158.4mm, 8형 화면(약 136 x 151mm)은 세로로만 들어간다 → 2256 x 2504
- samsung.com 제품 스펙 페이지는 스크립트로 그려져서 자동으로 읽히지 않는다. 그래서 Newsroom 기사의 사양표를 출처로 쓴다.

## 추가 절차

1. 공식 스펙 페이지에서 값을 확인한다.
2. `packages/presets/data/`에 JSON을 추가한다 (source, verified, verifiedAt 포함).
3. 테스트를 통과해야 한다.
   - 스키마 검증
   - id 중복 없음
   - 해상도는 양의 정수
   - `verified: true`면 `source` 필수
4. PR로 올린다.
