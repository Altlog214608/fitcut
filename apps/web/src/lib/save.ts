/**
 * 만든 파일을 기기에 저장하는 방법들. 브라우저마다 되는 방법이 달라서 SAVE_METHOD(lib/inApp.ts)로 고른다.
 * 사진 도구(브라우저에서 만든 Blob)와 움짤 도구(서버가 만든 결과)가 같이 쓴다.
 */
import type { SaveMethod } from './inApp';

export function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('파일을 저장하지 못했어요.'));
    reader.readAsDataURL(blob);
  });
}

function clickLink(href: string, name?: string): void {
  const a = document.createElement('a');
  a.href = href;
  if (name) a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

/**
 * 파일을 기기에 저장한다. 보통은 blob 주소로 내려받는다.
 * iOS 인앱 브라우저(카카오톡 등)는 blob 다운로드를 못 해서 data URL로 내려받는다 (lib/inApp.ts).
 */
export async function download(blob: Blob, name: string, method: SaveMethod): Promise<void> {
  const url = method === 'data-url' ? await readAsDataUrl(blob) : URL.createObjectURL(blob);
  clickLink(url, name);
  if (method !== 'data-url') setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * 서버가 첨부 파일(Content-Disposition: attachment)로 주는 주소를 연다.
 * 다른 출처라 download 속성은 무시되고 서버가 정한 파일 이름으로 저장된다.
 */
export function openDownloadUrl(url: string): void {
  clickLink(url);
}

/**
 * 아이폰 공유 화면을 연다. 결과를 기다리지 않는다: iOS 15에서 '이미지 저장'을 고르면 끝났다는 신호가
 * 오지 않는 버그가 있었다 (WebKit 231995). 버튼을 누른 직후가 아니어서 막히면 onBlocked로 다시 누르게 한다.
 */
export function openShare(file: File, onBlocked: () => void): void {
  navigator.share({ files: [file] }).catch((error: unknown) => {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'AbortError') return; // 사용자가 닫았다
    if (name === 'NotAllowedError') onBlocked();
    else void download(file, file.name, 'blob');
  });
}
