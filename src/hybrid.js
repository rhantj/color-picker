// 3단계의 순수한 부분 — BM25 결과와 임베딩 유사도를 **어떻게 합치고 어떻게 판정하는가**.
// Ollama 를 모른다. 그래서 스텁 벡터로 결정적으로 검사할 수 있다(S26-G5).
//
// 왜 RRF(Reciprocal Rank Fusion)인가 — 두 점수의 단위가 다르다. BM25 는 0~수십, 코사인은 -1~1.
// 값을 섞으면 어느 한쪽 단위가 이긴다. 순위만 쓰면 단위가 사라진다. k=60 은 원 논문의 값이다 [문헌].

/** 동의 범위 — BM25 1위가 임베딩 상위 몇 안에 있어야 "같은 답" 으로 보나. [실측] 3 이면 거짓 확신 3건이 남고, 1 이면 정답 1단계 8건이 전부 임베딩 1위라 안 흔들린다 */
export const AGREE_TOP = 1;
/** 확신 문턱 — 결합 1위의 코사인이 이 값 이상이면 3단계가 확신한다. [실측] 23건에서 정답 1위 최솟값 0.44 */
export const COS_MIN = 0.44;
/** RRF 상수. [문헌] Cormack et al. 2009 */
export const RRF_K = 60;

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
 * @returns {{id:string, kind:string, cosine:number, rrf:number}[]} RRF 내림차순
 */
export function fuse(bm25, sims) {
  const score = new Map();
  const meta = new Map();
  const add = (id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank));
  bm25.forEach((h, i) => {
    add(h.id, i + 1);
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

/** 결합 1위의 코퍼스가 route, 그 코사인이 문턱 이상이면 확신. */
export function decide(fused) {
  const top = fused[0] ?? null;
  if (!top) return { route: "none", confident: false, top: null };
  return { route: top.kind, confident: top.cosine >= COS_MIN, top };
}
