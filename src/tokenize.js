// 한국어 형태소 분석기 없이 BM25 를 돌리기 위한 토크나이저.
//
// 한글 어절은 조사·어미가 붙어 표면형이 계속 달라진다("따뜻한 / 따뜻하고 / 따뜻함").
// 어절을 통째로만 쓰면 이 셋이 서로 다른 항이 되어 매칭이 끊긴다.
// 그래서 어절 전체와 문자 2-gram 을 함께 낸다 —
//   어절 전체: 정확히 같은 표면형에 가중치를 몰아준다
//   2-gram   : 어간이 겹치면 부분 점수를 준다 ("따뜻한" 과 "따뜻하고" 는 "따뜻" 을 공유)
//
// 다만 2-gram 은 어미·조사 조각("않게" "보여" "인데")도 그대로 만들어낸다. 실측에서
// "대시보드가 탁해 보여요" 가 오직 "보여" 하나로 엉뚱한 조합을 1위로 올렸다.
// 그래서 2-gram 은 가중치를 낮춰 넣는다 — 부분매칭은 살리되 혼자서는 순위를 못 뒤집게 한다.
// 형태소 분석기를 붙이면 근본적으로 해결되지만, 의존성 0 을 유지하는 것이 지금 단계의 조건이다.

const HANGUL_RUN = /^[가-힣]+$/;
const RUNS = /[가-힣]+|[a-z0-9#]+/g;

export const BIGRAM_WEIGHT = 0.3;

/** @returns {{term: string, weight: number}[]} */
export function tokenize(text) {
  const tokens = [];
  // NFKC 를 먼저 걸고 소문자화한다. 순서가 반대면 전각 대문자가 정규화 전에 소문자화를 못 받는다.
  // NFKC 를 쓰는 이유는 한국어 IME·모바일 붙여넣기로 들어오는 전각 문자 때문이다 —
  // "＃Ｆ３Ａ２５７" 이 NFC 에서는 토큰이 통째로 사라지고, NFKC 에서는 "#f3a257" 로 살아난다.
  // 낱자 자모("ㄱㅏ")도 NFKC 가 "가" 로 합쳐준다. 한자·가나는 여전히 버려지는데, 코퍼스가 한국어라 의도된 것이다.
  const runs = String(text).normalize("NFKC").toLowerCase().match(RUNS) || [];

  for (const run of runs) {
    tokens.push({ term: run, weight: 1 });
    if (HANGUL_RUN.test(run)) {
      for (let i = 0; i + 2 <= run.length; i++) {
        tokens.push({ term: run.slice(i, i + 2), weight: BIGRAM_WEIGHT });
      }
    }
  }
  return tokens;
}
