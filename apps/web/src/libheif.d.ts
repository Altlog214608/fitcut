// libheif-js의 ESM 번들 (wasm 포함). 쓰는 만큼의 타입은 photo/heic.ts에 있다
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: () => unknown;
  export default factory;
}
