/**
 * 저장할 때 사진을 줄이는 고품질 리샘플러 (Lanczos3, pica).
 * 브라우저 캔버스의 축소 품질은 엔진마다 달라서(WebKit은 계단·물결 무늬가 심하다) 저장 결과만
 * 같은 품질로 맞춘다. 미리보기는 빠른 캔버스 축소를 그대로 쓴다. 측정은 ADR-026.
 * 저장할 때만 불러와서 첫 화면 용량에 들어가지 않는다.
 */
import { context, type CanvasFactory, type Resampler } from './render';

export function picaResampler(make: CanvasFactory): Resampler {
  return async (image, width, height) => {
    const { default: pica } = await import('pica');
    // pica.resize()는 Worker 안에서 일부 경로가 document로 캔버스를 만들려다 실패한다.
    // 픽셀 배열만 계산하는 resizeBuffer()를 쓰고, 캔버스 읽고 쓰기는 직접 한다.
    const resizer = pica({ features: ['js', 'wasm'] });
    const from = make(image.width, image.height);
    const fromCtx = context(from);
    fromCtx.drawImage(image, 0, 0);
    const src = fromCtx.getImageData(0, 0, image.width, image.height).data;
    const pixels = await resizer.resizeBuffer({
      src,
      width: image.width,
      height: image.height,
      toWidth: width,
      toHeight: height,
      filter: 'lanczos3',
    });
    const out = make(width, height);
    const outCtx = context(out);
    const data = outCtx.createImageData(width, height);
    data.data.set(pixels);
    outCtx.putImageData(data, 0, 0);
    return out;
  };
}
