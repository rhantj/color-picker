// BM25 (Okapi) 인메모리 구현. 코퍼스가 16건이라 역색인 없이 전수 스캔으로 충분하다.
// 문서가 수천 건을 넘어가면 그때 역색인을 넣는다.
//
// 표준 BM25 와 다른 점 하나 — 용어 빈도(tf)가 정수가 아니라 가중 합이다.
// 토크나이저가 2-gram 을 0.3 짜리로 내보내기 때문이다(tokenize.js 주석 참고).
// BM25 식 자체는 tf 가 실수여도 그대로 성립한다.

import { tokenize } from "./tokenize.js";
import { isStopword } from "./stopwords.js";

const K1 = 1.2; // 용어 빈도 포화 지점. 낮을수록 "여러 번 나옴"의 이득이 빨리 사라진다
const B = 0.75; // 문서 길이 정규화 강도. 0 이면 길이를 무시, 1 이면 완전 보정

export function buildIndex(docs, textOf) {
  const entries = docs.map((doc) => {
    const tf = new Map();
    const whole = new Set(); // 어절 전체로 등장한 항. 2-gram 조각과 구분하기 위해 따로 둔다
    let length = 0;
    for (const { term, weight } of tokenize(textOf(doc))) {
      tf.set(term, (tf.get(term) ?? 0) + weight);
      if (weight === 1) whole.add(term);
      length += weight;
    }
    return { doc, tf, whole, length };
  });

  const df = new Map();
  for (const e of entries) {
    for (const term of e.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const totalLength = entries.reduce((sum, e) => sum + e.length, 0);
  return {
    entries,
    df,
    N: entries.length,
    avgdl: entries.length ? totalLength / entries.length : 0,
  };
}

function idf(index, term) {
  const n = index.df.get(term) ?? 0;
  // 평활화된 IDF. +1 을 감싸 두면 절반 넘는 문서에 나오는 흔한 항이 음수가 되지 않는다.
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
}

export function search(index, query, limit = 5) {
  const queryTokens = tokenize(query);
  const queryTerms = [...new Set(queryTokens.map((t) => t.term))];
  // 질의에서도 어절 전체였던 항. 이게 없으면 질의의 2-gram 조각이 문서의 어절과 맞았을 때
  // 강한 근거로 승격된다 — 실측: "화면이" 의 조각 "면이" 가 문서의 "면이" 와 맞아
  // 엉뚱한 진단이 고신뢰로 잡혔다.
  const queryWhole = new Set(queryTokens.filter((t) => t.weight === 1).map((t) => t.term));

  const scored = index.entries.map((entry) => {
    let score = 0;
    const matched = [];

    for (const term of queryTerms) {
      const f = entry.tf.get(term);
      if (!f) continue;
      const norm = f + K1 * (1 - B + (B * entry.length) / index.avgdl);
      const contribution = idf(index, term) * ((f * (K1 + 1)) / norm);
      score += contribution;
      // 기능어는 어절 전체로 겹쳐도 근거로 치지 않는다(stopwords.js). 점수에는 그대로 반영된다.
      const whole = entry.whole.has(term) && queryWhole.has(term) && !isStopword(term);
      matched.push({ term, contribution, whole });
    }

    matched.sort((a, b) => b.contribution - a.contribution);
    // 어절 전체로 겹친 항이 하나도 없으면 어미·조사 조각만 맞은 것이다.
    // 점수는 나오지만 근거가 없으므로 호출부가 "못 잡았다"로 판정할 수 있게 따로 알린다.
    const wholeMatches = matched.filter((m) => m.whole).length;
    return { doc: entry.doc, score, matched, wholeMatches };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
