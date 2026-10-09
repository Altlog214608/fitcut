import type { Page } from '@playwright/test';

/**
 * 테스트용 사진을 브라우저 캔버스로 그려서 만든다 (저장소에 사진 파일을 두지 않는다).
 * 위는 하늘색, 아래는 초록색, 가운데 원이 있는 그림이라 방향과 잘림을 눈으로도 확인할 수 있다.
 */
export async function makeImage(
  page: Page,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ width, height, type }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.fillStyle = '#7fb4ea';
      ctx.fillRect(0, 0, width, height / 2);
      ctx.fillStyle = '#3f7a4a';
      ctx.fillRect(0, height / 2, width, height / 2);
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, Math.min(width, height) / 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d92d33';
      ctx.fillRect(0, 0, width / 10, height / 10); // 왼쪽 위 표시
      return canvas.toDataURL(type, 0.95);
    },
    { width, height, type },
  );
  return Buffer.from(dataUrl.split(',')[1] ?? '', 'base64');
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** IFD 항목: tag, type, count, 4바이트 값(또는 오프셋) */
function entry(tag: number, type: number, count: number, value: Buffer): Buffer {
  const v = Buffer.alloc(4);
  value.copy(v);
  return Buffer.concat([u16(tag), u16(type), u32(count), v]);
}

/**
 * JPEG에 EXIF(방향, 선택적으로 GPS)를 넣는다. 결과 파일에 메타데이터가 남지 않는지 확인하는 데 쓴다.
 * 구조: APP1 "Exif\0\0" + TIFF(빅엔디언) + IFD0 [Orientation, (GPS IFD 포인터)] + GPS IFD.
 */
export function withExif(jpeg: Buffer, orientation: number, gps = false): Buffer {
  const ifd0Count = gps ? 2 : 1;
  const ifd0Size = 2 + ifd0Count * 12 + 4;
  const gpsOffset = 8 + ifd0Size;
  const entries = [entry(0x0112, 3, 1, u16(orientation))];
  if (gps) entries.push(entry(0x8825, 4, 1, u32(gpsOffset)));
  const ifd0 = Buffer.concat([u16(ifd0Count), ...entries, u32(0)]);
  const gpsIfd = gps
    ? Buffer.concat([
        u16(2),
        entry(0x0000, 1, 4, Buffer.from([2, 3, 0, 0])), // GPSVersionID
        entry(0x0001, 2, 2, Buffer.from('N\0')), // GPSLatitudeRef
        u32(0),
      ])
    : Buffer.alloc(0);
  const tiff = Buffer.concat([Buffer.from('MM'), u16(42), u32(8), ifd0, gpsIfd]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload]);
  // SOI(FFD8) 바로 뒤에 넣는다
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** JPEG(SOF) 또는 PNG(IHDR)에서 가로·세로를 읽는다 */
export function imageSize(file: Buffer): {
  width: number;
  height: number;
  type: 'jpeg' | 'png' | 'webp';
} {
  if (file.subarray(1, 4).toString('latin1') === 'PNG') {
    return { width: file.readUInt32BE(16), height: file.readUInt32BE(20), type: 'png' };
  }
  if (file.subarray(0, 4).toString('latin1') === 'RIFF') {
    return { width: 0, height: 0, type: 'webp' };
  }
  let i = 2;
  while (i < file.length) {
    if (file[i] !== 0xff) throw new Error(`JPEG 마커가 아니다: ${i}`);
    const marker = file[i + 1] ?? 0;
    const length = file.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: file.readUInt16BE(i + 5), width: file.readUInt16BE(i + 7), type: 'jpeg' };
    }
    i += 2 + length;
  }
  throw new Error('크기를 찾지 못했다');
}

export function hasExif(file: Buffer): boolean {
  return file.includes(Buffer.from('Exif\0\0', 'binary'));
}
