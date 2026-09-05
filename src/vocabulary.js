// 재작성어의 붙여쓰기를 코퍼스 어휘로 되돌린다.
//
// 왜 필요한가 (실측): exaone 이 "톤 비대칭" 을 "톤비대칭" 으로 붙여 낸다. 이때 2-gram 덕분에
// 순위는 살아남지만(pair-09 를 여전히 1위로 찾는다) 어절 전체 매칭이 0 이 되어 **저신뢰로 떨어진다.**
// 정답을 찾고도 "못 잡았다"고 말하게 되는 것이다.
//
// 프롬프트에 "붙여 쓰지 마라"를 적어 두긴 했지만, 모델이 지킬 것이라 가정하지 않는다.
// 여기서 결정적으로 되돌린다.

import { tokenize } from "./tokenize.js";

// 한 글자 어절도 사전에 넣는다 — 코퍼스의 "톤" 이 그렇다. 이게 빠지면 "톤비대칭" 이 안 쪼개진다.
// 대신 아래 가드로 남용을 막는다: 조각이 전부 사전어여야 하고, 4조각을 넘지 않으며,
// 두 글자 이상 조각이 최소 하나 있어야 한다(한 글자만으로 이뤄진 분해는 버린다).
const MIN_PART = 1;
const MAX_PART = 6;
const MAX_PIECES = 4;

/** 코퍼스 텍스트들에서 어절 전체 어휘만 모은다. */
export function buildVocabulary(texts) {
  const vocab = new Set();
  for (const text of texts) {
    for (const { term, weight } of tokenize(text)) {
      // 한 글자는 한글만 받는다. 유형 라벨("A형","B형")에서 나온 로마자·숫자 한 글자가
      // 사전에 들어가면 엉뚱한 분해의 재료가 된다.
      if (weight !== 1) continue;
      if (term.length === 1 && !/^[가-힣]$/.test(term)) continue;
      vocab.add(term);
    }
  }
  return vocab;
}

/**
 * 붙여 쓴 말을 사전어로 쪼갠다. 앞에서부터 가장 긴 사전어를 떼어 내고,
 * 끝까지 떨어지지 않으면 **원형을 그대로 둔다** — 억지로 쪼개 없는 말을 만들지 않는다.
 */
export function splitGlued(term, vocab) {
  if (vocab.has(term) || term.length < 2) return [term];

  const parts = [];
  let i = 0;
  while (i < term.length) {
    let matched = null;
    for (let len = Math.min(MAX_PART, term.length - i); len >= MIN_PART; len--) {
      const candidate = term.slice(i, i + len);
      if (vocab.has(candidate)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) return [term];
    parts.push(matched);
    i += matched.length;
  }
  if (parts.length < 2 || parts.length > MAX_PIECES) return [term];
  if (!parts.some((p) => p.length >= 2)) return [term];
  return parts;
}

/** 재작성어 배열을 검색 문자열로 편다. */
export function expandTerms(terms, vocab) {
  return terms.flatMap((t) => splitGlued(t, vocab)).join(" ");
}
