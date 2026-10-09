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
- 아이폰 잠금화면 배경을 화면 해상도보다 크게 내보내야 하는지(확대·시차 효과 때문에)는 확인한 뒤 `notes`와 내보내기 기본값에 반영한다.

## 데이터 현황 (2026-10-09)

`packages/presets/data/`에 31개, 그중 사용자에게 보이는 것(verified)은 29개다.

| 묶음 | 기기 | 출처 |
| --- | --- | --- |
| 아이폰 | 16, 16 Plus, 16 Pro, 16 Pro Max, 16e, 17, 17 Pro, 17 Pro Max, 17e, Air, 18 Pro, 18 Pro Max | Apple 지원 사이트 Tech Specs |
| 애플워치 | Series 10·11·12 (42·46mm), SE 3 (40·44mm), Ultra 3, Ultra 4 | Apple 지원 사이트 Tech Specs |
| 갤럭시 S | S26, S26+, S26 Ultra | Samsung Newsroom Korea 출시 기사 사양표 |
| 갤럭시 Z | Flip8 (메인·커버). Fold8, Fold8 Ultra는 `verified: false` | Samsung Newsroom Korea 출시 기사 사양표 |
| 갤럭시 워치 | Watch9 (40·44mm), Watch Ultra2 | samsung.com 구매 가이드 |

다음 배치: 태블릿(아이패드, 갤럭시 탭 S), 한 세대 이전 모델(아이폰 15, 갤럭시 S25, Z Fold7·Flip7, 워치8), 갤럭시 A, 픽셀.

- 삼성 사양표는 해상도를 "세로 x 가로" 순서로 적는다 (예: S26 Ultra `3,120 x 1,440`). 데이터에는 `widthPx`·`heightPx`로 풀어서 넣는다.
- Fold8·Fold8 Ultra의 펼친 화면은 해상도 순서와 화면비 표기가 서로 맞지 않아, 가로·세로 방향을 확인할 때까지 숨긴다. TODO(verify)
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
