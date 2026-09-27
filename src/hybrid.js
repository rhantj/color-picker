// 3단계의 순수한 부분 — BM25 결과와 임베딩 유사도를 **어떻게 합치고 어떻게 판정하는가**.
// Ollama 를 모른다. 그래서 스텁 벡터로 결정적으로 검사할 수 있다(S26-G5).
//
// 왜 RRF(Reciprocal Rank Fusion)인가 — 두 점수의 단위가 다르다. BM25 는 0~수십, 코사인은 -1~1.
// 값을 섞으면 어느 한쪽 단위가 이긴다. 순위만 쓰면 단위가 사라진다. k=60 은 원 논문의 값이다 [문헌].

/** 동의 범위 — BM25 1위가 임베딩 상위 몇 안에 있어야 "같은 답" 으로 보나. [실측] 3 이면 거짓 확신 3건이 남고, 1 이면 정답 1단계 8건이 전부 임베딩 1위라 안 흔들린다 */
export const AGREE_TOP = 1;
/** 확신 문턱 — 결합 1위의 코사인이 이 값 이상이면 3단계가 확신한다. [실측] 23건에서 정답 1위 최솟값 0.44 */
export const COS_MIN = 0.44;
/**
 * 튀어나옴 문턱 — BM25 에 걸린 어절이 **하나도 없을 때만** 본다. 1위 코사인이 코퍼스 전체 평균보다 이만큼은 높아야
 * 확신한다. 문턱(COS_MIN)만 보면 "안녕"·"hello" 도 0.442 로 넘었다(40단계 · H4). 인사·잡담은 코퍼스 전체와 고르게
 * 비슷하고, 뜻이 있는 질의는 한 문서가 튀어나온다.
 * 값은 `[판단]` 이다 — 잰 것은 두 묶음 사이의 빈틈이고, 0.12 는 그 사이에서 고른 값이다.
 *   맞춘 묶음 [실측 2026-09-27] 인사·잡담 6건 0.048~0.084 · 어휘 없는 정상 질의 4건 0.151~0.219 (n=10, S40-G6 의 시험 세트와 같다)
 *   따로 뗀 묶음 [실측 2026-09-28] 새 잡담 10건 최대 0.103 — 전부 아래 · 새 정상 질의 10건 중 이 규칙 때문에 확신을 잃은 것 0
 * 평균이 코퍼스 전체(팔레트+진단)에 대한 값이라 코퍼스가 크게 바뀌면 다시 재야 한다.
 * BM25 증거가 있으면 안 본다: "색이 탁해요"(0.077)처럼 증거가 있는 정답이 이 값 아래에 있다. 그래서 흔한 어절 하나가
 * 걸린 잡담("안녕 좋은 아침" — "좋은")은 빠져나간다 [실측] — open-work H4.
 */
export const PROMINENCE_MIN = 0.12;
/** RRF 상수. [문헌] Cormack et al. 2009 */
export const RRF_K = 60;
/**
 * BM25 가 확신했는데 임베딩 1위와 다를 때 그 BM25 순위에 주는 가중치. 그 확신은 흔한 어절 하나에서 온
 * 것이라 증거가 아니다. [실측] 1 → 12/18, 0.5 → 12/18, 0 → 14/18 (28단계 · E1). 재작성 뒤 결합은 새 증거라 1.
 */
export const DISAGREE_BM25_WEIGHT = 0;
/**
 * 어긋났어도 BM25 를 믿는 기준 — 어절 전체 매치가 이 수를 넘으면 흔한 어절 하나로 우긴 것이 아니다.
 * "zzqq 별똥별 카페" 처럼 희귀 어절 둘이 통째로 맞은 확신까지 버리면 정확 매칭이 무너진다(S27-G1 이 잡았다).
 */
export const DISTRUST_MAX_WHOLE = 1;

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm === 0 ? 0 : dot / norm;
}

/** @param {{id:string}} top BM25 1위 @param {{id:string}[]} sims 코사인 내림차순 */
export function agrees(top, sims, within = AGREE_TOP) {
  return sims.slice(0, within).some((s) => s.id === top.id);
}

/**
 * @param {{id:string, kind:"palette"|"diagnosis"}[]} bm25 BM25 순위(두 코퍼스를 이은 목록)
 * @param {{id:string, kind:"palette"|"diagnosis", cosine:number}[]} sims 코사인 내림차순
 * @param {{bm25Weight?: number}} [options] BM25 순위 가중치. 0 이면 코사인 순위만 남는다(BM25 에만 있는 문서는 0점)
 * @returns {{id:string, kind:string, cosine:number, rrf:number}[]} RRF 내림차순
 */
export function fuse(bm25, sims, { bm25Weight = 1 } = {}) {
  const score = new Map();
  const meta = new Map();
  const add = (id, rank, weight = 1) => score.set(id, (score.get(id) ?? 0) + weight / (RRF_K + rank));
  bm25.forEach((h, i) => {
    add(h.id, i + 1, bm25Weight);
    meta.set(h.id, { kind: h.kind, cosine: 0 });
  });
  sims.forEach((s, i) => {
    add(s.id, i + 1);
    meta.set(s.id, { kind: s.kind, cosine: s.cosine });
  });
  return [...score.entries()]
    .map(([id, rrf]) => ({ id, ...meta.get(id), rrf }))
    .sort((a, b) => b.rrf - a.rrf);
}

/** 코사인 하나가 코퍼스 전체 코사인의 평균보다 얼마나 높은가. sims 가 비면 0. */
export function prominence(cos, sims) {
  if (sims.length === 0) return 0;
  return cos - sims.reduce((sum, s) => sum + s.cosine, 0) / sims.length;
}

/**
 * 결합 1위의 코퍼스가 route, 그 코사인이 문턱 이상이면 확신.
 * `lexical: false`(BM25 에 어절 매치가 하나도 없음)이면 1위가 코퍼스 평균에서 PROMINENCE_MIN 이상 튀어나와야 한다.
 * @param {{sims?: {cosine:number}[], lexical?: boolean}} [options] 옵션이 없으면 옛 동작(문턱만)
 */
export function decide(fused, { sims = [], lexical = true } = {}) {
  const top = fused[0] ?? null;
  if (!top) return { route: "none", confident: false, top: null };
  const standsOut = lexical || prominence(top.cosine, sims) >= PROMINENCE_MIN;
  return { route: top.kind, confident: top.cosine >= COS_MIN && standsOut, top };
}
