/**
 * 홈에서 고른 파일을 도구 화면으로 넘기는 메모리 보관소. 서버로 보내지 않고, 새로고침하면 사라진다.
 * 값을 꺼낼 때 지우지 않는다: React StrictMode가 초기화 함수를 두 번 부르기 때문이다.
 */
let selected: File | null = null;

export function setSelectedFile(file: File | null): void {
  selected = file;
}

export function getSelectedFile(): File | null {
  return selected;
}
