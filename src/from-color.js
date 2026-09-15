// 색 하나(헥스·코퍼스 이름·색 낱말)에서 어울리는 색을 찾는다. 35단계.
//
// 두 답을 낸다.
//   ① 배색사전 짝 — 씨앗 40쌍 중 입력 색과 가장 가까운 색을 가진 쌍. 그 쌍의 **다른 색**이 짝이다.
//      원전이 실제로 묶어 놓은 조합이라 근거가 있고, 헥스는 전부 코퍼스 80색이다.
//   ② 배색 구조 — 입력 색을 씨앗으로 `expandAll`. 규칙은 전부 src/expand.js 의 HSL 연산이라 지어낸 색이 없다.
//
// **LLM 은 여기 닿지 않는다.** 헥스에는 인상(질의)이 없어 모델이 고를 근거가 없고, 전부 결정적이다.
// **거리 함수는 `[판단]`** — 원전은 "가까운 색" 을 정의하지 않는다. 검사기(S35-G2)가 사본으로 대조한다.

import { loadCharacterWords, nearestCorpus } from "./color-words.js";
import { expandAll, hexToHsl, loadStructures } from "./expand.js";

/** 배색사전 짝을 몇 쌍 보이나. 화면 카드 수와 같다. */
export const PARTNER_COUNT = 3;

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#?([0-9a-f]{3})$/i;

// 낱말표는 한 번만 읽는다(34단계 리뷰가 잡은 것과 같은 자리).
let wordsCache = null;
const words = () => (wordsCache ??= loadCharacterWords());

/** 헥스 문자열 하나를 `#RRGGBB`(대문자)로. 아니면 null. */
export function normalizeHex(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  const six = HEX6.exec(t);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = HEX3.exec(t);
  if (three) return `#${[...three[1]].map((ch) => ch + ch).join("").toUpperCase()}`;
  return null;
}

/**
 * 입력 문자열을 색 하나로 읽는다. **던지지 않는다** — 못 읽으면 null.
 *
 * 순서: 헥스 → 코퍼스 이름(한글 `name` · 원명 `origName`, 대소문자·양끝 공백 무시) → 색 낱말(34단계 낱말표 → 코퍼스 최근접).
 * 코퍼스 이름이 낱말보다 앞이다 — "빨강" 은 코퍼스에 그 이름의 색이 실제로 있어 그것이 정답이다.
 * 낱말은 "초록"·"초록색" 처럼 뒤에 "색" 이 붙은 것도 받는다. 그 밖의 것은 색이 아니다.
 *
 * @param {unknown} text
 * @param {{hex:string,name:string,origName?:string}[]} corpus 코퍼스 80색
 * @returns {{hex:string, from:"hex"|"name"|"word", label:string, wordId?:string, name?:string}|null}
 */
export function parseColorInput(text, corpus) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;

  const hex = normalizeHex(t);
  if (hex) return { hex, from: "hex", label: hex };

  const key = t.toLowerCase();
  const same = (v) => typeof v === "string" && v.trim().toLowerCase() === key;
  const named = (corpus ?? []).find((c) => same(c?.name) || same(c?.origName));
  if (named) return { hex: named.hex.toUpperCase(), from: "name", label: named.name ?? named.origName };

  const bare = key.endsWith("색") && key.length > 1 ? key.slice(0, -1) : key;
  for (const [id, forms] of Object.entries(words().colorWords)) {
    if (!forms.includes(key) && !forms.includes(bare)) continue;
    const found = nearestCorpus(id, corpus ?? []);
    return found ? { hex: found.hex.toUpperCase(), from: "word", label: t, wordId: id, name: found.name } : null;
  }
  return null;
}

/**
 * 두 헥스의 거리 `[판단]`. 지각 채도 평면(c·cos h, c·sin h)과 명도의 유클리드 거리.
 * 회색은 채도가 0 이라 색상각이 자연히 무시되고, 명도 차이는 색상과 같은 무게로 센다.
 */
export function colorDistance(a, b) {
  const p = (hex) => {
    const { h, s, l } = hexToHsl(hex);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const rad = (h * Math.PI) / 180;
    return [c * Math.cos(rad), c * Math.sin(rad), l];
  };
  const [x1, y1, z1] = p(a);
  const [x2, y2, z2] = p(b);
  return Math.hypot(x1 - x2, y1 - y2, z1 - z2);
}

/**
 * 씨앗 쌍 중 입력 색과 가장 가까운 색을 가진 쌍 `count` 개. 쌍마다 한 번만 센다(가까운 쪽 색으로).
 *
 * @param {string} hex `#RRGGBB`
 * @param {{id:string, name?:string, colors:{hex:string,name?:string,origName?:string}[]}[]} seeds 코퍼스 16 + 풀 24
 * @param {number} count
 * @returns {{pairId:string, pairName:string, distance:number, near:{hex,name}, partner:{hex,name}}[]}
 */
export function partnersFor(hex, seeds, count = PARTNER_COUNT) {
  const label = (c) => c.name ?? c.origName ?? c.hex;
  const scored = [];
  for (const s of seeds ?? []) {
    if (!Array.isArray(s?.colors) || s.colors.length !== 2) continue;
    const [a, b] = s.colors;
    const da = colorDistance(hex, a.hex);
    const db = colorDistance(hex, b.hex);
    const [near, partner, distance] = da <= db ? [a, b, da] : [b, a, db];
    scored.push({
      pairId: s.id,
      pairName: s.name ?? s.colors.map(label).join(" × "),
      distance,
      near: { hex: near.hex.toUpperCase(), name: label(near) },
      partner: { hex: partner.hex.toUpperCase(), name: label(partner) },
    });
  }
  // 거리가 같으면 씨앗 순서(코퍼스가 풀보다 앞)를 지킨다 — sort 는 안정적이다.
  scored.sort((x, y) => x.distance - y.distance);
  return scored.slice(0, count);
}

/**
 * 입력 색을 씨앗 두 자리에 모두 앉혀 카탈로그 전부로 불린다. 두 모드를 함께 낸다.
 * 모양은 `/api/expand` 의 structures 와 같다 — 화면이 `structureCard` 를 그대로 쓴다.
 */
export function structuresFor(hex, catalog = loadStructures()) {
  const norm = normalizeHex(hex);
  if (!norm) return [];
  const seed = { id: null, colors: [{ hex: norm }, { hex: norm }] };
  const dark = new Map(expandAll(seed, catalog, { mode: "dark" }).map((st) => [st.id, st.colors]));
  return expandAll(seed, catalog).map((st) => ({
    id: st.id,
    name: st.name,
    principle: st.principle,
    source: st.source,
    colors: st.colors,
    colorsDark: dark.get(st.id) ?? st.colors,
  }));
}
