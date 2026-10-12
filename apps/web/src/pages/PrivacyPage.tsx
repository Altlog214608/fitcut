/**
 * 개인정보 처리방침 (docs/ADMIN.md 개인정보). 수집 항목·목적·보관 기간·파기 방법·문의처.
 * 값을 바꾸면 인프라(수명 주기·TTL)와 docs/ADMIN.md "무엇을 저장하나" 표도 같이 맞춘다.
 */
import { Link } from 'react-router';
import styles from './PrivacyPage.module.css';

const REPO_ISSUES = 'https://github.com/Altlog214608/fitcut/issues';

const STORED: [string, string, string][] = [
  [
    '사용 기록 (어떤 도구를 열고 저장했는지, 기기 종류·OS·브라우저, 파일 크기 구간·해상도·길이, 오류 코드)',
    '서비스 개선, 자주 쓰는 기기 프리셋 추가',
    '12개월',
  ],
  [
    '변환 작업 정보 (형식, 구간, 처리 시간, 결과 크기)',
    '변환 처리와 결과 전달',
    '2일 (보관 동의 시 31일)',
  ],
  ['올린 영상·음성과 변환 결과', '변환 처리와 결과 전달', '1~2일 뒤 자동 삭제'],
  [
    '보관에 동의한 영상·음성 원본과 결과',
    '서비스 품질 확인 (관리자가 볼 수 있고, 볼 때마다 기록이 남아요)',
    '30일 (내 작업 기록에서 언제든 삭제)',
  ],
  ['저장한 링크 구간 (YouTube 영상 ID, 시작·끝 시각)', '구간 반복 링크 제공', '12개월'],
  [
    '하이라이트 채널 연결: 치지직 채널 ID·채널 이름, 치지직 권한 토큰(암호화해 저장), 로그인 유지용 값의 해시',
    '방송 채팅으로 하이라이트 후보 찾기',
    '연결 해제할 때까지 (로그인 유지는 7일)',
  ],
  [
    '수집을 시작한 방송의 채팅·후원·구독 (내용, 시각, 후원 금액. 시청자 닉네임과 계정 ID는 저장하지 않아요)',
    '하이라이트 후보 찾기',
    '90일',
  ],
  [
    'IP 주소를 비밀 값으로 바꾼 해시 (원래 IP는 저장하지 않아요)',
    '하루 사용 횟수 제한 (남용 방지)',
    '다음 날까지',
  ],
];

export function PrivacyPage() {
  return (
    <article className={styles.page}>
      <h1 className={styles.title}>개인정보 처리방침</h1>
      <p className={styles.summary}>
        FitCut은 꼭 필요한 정보만, 정해진 기간 동안만 둬요. 회원 가입이 없고 이름·이메일·전화번호를
        받지 않아요.
      </p>

      <section className={styles.section}>
        <h2>서버로 보내지 않는 것</h2>
        <ul>
          <li>사진: 사진 도구의 모든 작업은 기기 안에서 끝나요. 사진은 서버로 올라가지 않아요.</li>
          <li>파일 이름, 원래 IP 주소</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>수집 항목, 목적, 보관 기간</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>항목</th>
                <th>목적</th>
                <th>보관 기간</th>
              </tr>
            </thead>
            <tbody>
              {STORED.map(([item, purpose, period]) => (
                <tr key={item}>
                  <td>{item}</td>
                  <td>{purpose}</td>
                  <td className={styles.period}>{period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          사용 기록에는 이 탭에서만 쓰는 무작위 값이 붙고, 누구인지와 연결하지 않아요. 브라우저에서
          추적 거부(Do Not Track, Global Privacy Control)를 켜면 사용 기록을 보내지 않아요. 서버
          오류 기록은 14일 동안 둬요.
        </p>
      </section>

      <section className={styles.section}>
        <h2>파기 방법</h2>
        <ul>
          <li>
            파일과 기록은 보관 기간이 끝나면 저장소의 자동 삭제 규칙으로 지워져요. 삭제는 기간이
            끝난 뒤 하루 안팎으로 처리돼요.
          </li>
          <li>
            보관에 동의한 파일은 <Link to="/my-jobs">내 작업 기록</Link>에서 지우면 그 자리에서
            원본과 결과가 함께 지워져요.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>이 기기에만 저장하는 것</h2>
        <p>
          최근 쓴 기기, 내 기기, 내 링크 구간, 내 작업 기록(삭제 열쇠 포함)은 이 브라우저에만
          저장돼요. 브라우저의 사이트 데이터를 지우면 함께 지워져요. 광고·추적용 쿠키는 쓰지 않아요.
        </p>
      </section>

      <section className={styles.section}>
        <h2>외부 서비스</h2>
        <ul>
          <li>
            링크 구간은 YouTube 공식 플레이어(개인정보 보호 모드)로 재생해요. 재생할 때는
            YouTube(Google)의 개인정보 처리방침이 적용돼요.
          </li>
          <li>모든 데이터는 Amazon Web Services 서울 리전에 저장해요.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>문의</h2>
        <p>
          개인정보와 관련한 문의나 삭제 요청은{' '}
          <a href={REPO_ISSUES} target="_blank" rel="noreferrer">
            GitHub 이슈
          </a>
          로 남겨 주세요. 공개 게시판이라 개인정보는 적지 말아 주세요.
        </p>
      </section>

      <p className={styles.note}>시행일: 2026년 10월 12일</p>
    </article>
  );
}
