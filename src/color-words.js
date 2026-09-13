// 색 낱말("빨간"·"회색")을 코퍼스 80색 중 하나로 보낸다.
//
// **낱말은 data/character-words.json 에, 숫자는 여기에.** data/structures.json ↔ src/expand.js 와 같은 나눔이다.
// 범위는 전부 `[판단]` — 원전은 색 이름의 색상각 경계를 말하지 않는다.
//
// **헥스를 지어내지 않는다.** 이 파일이 내는 것은 언제나 코퍼스에 실제로 있는 색 하나다. 범위 안에 후보가 없으면
// 범위 중심과의 HSL 거리로 전체에서 고른다 — 코퍼스에 흰색이 없어서 "흰" 은 아이보리 부근이 된다 [실측].
// 그것은 알려진 한계이지 결함이 아니다: 코퍼스에 없는 색을 지어내는 대신 가장 가까운 실재하는 색을 보인다.
//
// 회색·흰색은 HSL 채도가 아니라 지각 채도(`c` = (1-|2l-1|)·s)로 가른다 — HSL s ≤ 0.2 로 두면 세이지그린(s 0.14)이 회색에 든다 [실측].

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hexToHsl } from "./expand.js";

const WORDS_PATH = fileURLToPath(new URL("../data/character-words.json", import.meta.url));
const CREATURES_PATH = fileURLToPath(new URL("../data/creatures.json", import.meta.url));

export class CharacterError extends Error {}

/**
 * 낱말 id → 범위 `[판단]`. `hue` 는 [시작, 끝] 도(끝이 시작보다 작으면 0° 를 넘는다), `l` 은 HSL 명도, `c` 는 지각 채도
 * [하한, 상한]. hue 가 있는 낱말은 유채색이라 HSL 채도 하한(`CHROMATIC_MIN_S`)을 함께 건다 — 안 걸면 회색이 "빨강" 범위에 든다.
 * 코퍼스 실측(2026-09-13): red 10 · orange 13 · yellow 8 · green 6 · teal 11 · blue 17 · purple 7 · pink 3 · brown 3 · black 10 후보.
 */
export const RANGES = Object.freeze({
  red: { hue: [345, 15] },
  orange: { hue: [15, 45], l: [0.4, 1] },
  yellow: { hue: [45, 70] },
  gold: { hue: [36, 60], l: [0.4, 0.8] },
  green: { hue: [70, 170] },
  teal: { hue: [160, 200] },
  blue: { hue: [195, 260] },
  purple: { hue: [260, 320] },
  pink: { hue: [320, 350], l: [0.5, 1] },
  brown: { hue: [15, 45], l: [0, 0.45] },
  black: { l: [0, 0.25] },
  white: { l: [0.8, 1], c: [0, 0.3] },
  gray: { c: [0, 0.12], l: [0.3, 0.85] },
});

export const CHROMATIC_MIN_S = 0.15;
const chromaOf = ({ s, l }) => (1 - Math.abs(2 * l - 1)) * s;

const wrap = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return d > 180 ? 360 - d : d;
};
const hueInside = ([lo, hi], h) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);
const hueCenter = ([lo, hi]) => (lo <= hi ? (lo + hi) / 2 : wrap((lo + hi + 360) / 2));
const mid = (range, fallback) => (range ? (range[0] + range[1]) / 2 : fallback);

function inside(range, hsl) {
  if (range.hue && (hsl.s < CHROMATIC_MIN_S || !hueInside(range.hue, hsl.h))) return false;
  if (range.c && (chromaOf(hsl) < range.c[0] || chromaOf(hsl) > range.c[1])) return false;
  if (range.l && (hsl.l < range.l[0] || hsl.l > range.l[1])) return false;
  return true;
}

/** 범위 중심과의 거리. 무채색 낱말은 색상각을 안 보고 지각 채도로 잰다. */
function distance(range, hsl) {
  const dh = range.hue ? hueGap(hueCenter(range.hue), hsl.h) / 180 : 0;
  const dc = range.hue ? Math.abs(0.5 - chromaOf(hsl)) : Math.abs(mid(range.c, 0.05) - chromaOf(hsl));
  const dl = Math.abs(mid(range.l, 0.5) - hsl.l);
  return dh + dc * 0.5 + dl;
}

/**
 * 낱말 하나를 코퍼스 색 하나로. **결정적** — 같은 낱말·같은 코퍼스·같은 used 면 늘 같은 색.
 *
 * @param {string} wordId RANGES 의 키
 * @param {{hex:string, name:string}[]} corpus 코퍼스 80색
 * @param {Set<string>} used 이미 쓴 헥스(대문자). 피한다
 * @returns {{hex:string, name:string}|null} 모르는 낱말이거나 코퍼스가 비면 null
 */
export function nearestCorpus(wordId, corpus, used = new Set()) {
  if (typeof wordId !== "string" || !Object.hasOwn(RANGES, wordId)) return null;
  const range = RANGES[wordId];
  const free = corpus.filter((c) => !used.has(String(c.hex).toUpperCase()));
  const pool = free.length ? free : corpus;
  if (pool.length === 0) return null;
  const scored = pool.map((c) => ({ c, hsl: hexToHsl(c.hex) }));
  const fits = scored.filter((x) => inside(range, x.hsl));
  const candidates = fits.length ? fits : scored;
  candidates.sort((a, b) => distance(range, a.hsl) - distance(range, b.hsl) || (a.c.hex < b.c.hex ? -1 : 1));
  return { hex: candidates[0].c.hex, name: candidates[0].c.name };
}

const isStringList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "");

export function loadCharacterWords(path = WORDS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new CharacterError("낱말표를 읽지 못했다 (data/character-words.json)", { cause });
  }
  const { colorWords, parts, compounds = {} } = parsed ?? {};
  if (!colorWords || typeof colorWords !== "object" || !parts || typeof parts !== "object") {
    throw new CharacterError("낱말표에 colorWords·parts 가 없다 (data/character-words.json)");
  }
  for (const [id, forms] of Object.entries(colorWords)) {
    if (!Object.hasOwn(RANGES, id)) throw new CharacterError(`낱말 ${id} 에 범위가 없다 (src/color-words.js)`);
    if (!isStringList(forms)) throw new CharacterError(`낱말 ${id} 의 표면형이 비었다`);
  }
  for (const id of Object.keys(RANGES)) {
    if (!Object.hasOwn(colorWords, id)) throw new CharacterError(`범위 ${id} 에 낱말이 없다 (data/character-words.json)`);
  }
  for (const [role, forms] of Object.entries(parts)) if (!isStringList(forms)) throw new CharacterError(`부위 ${role} 의 표면형이 비었다`);
  for (const [form, c] of Object.entries(compounds)) {
    if (!c || !Object.hasOwn(parts, c.part) || !Object.hasOwn(RANGES, c.color)) throw new CharacterError(`복합어 ${form} 이 모르는 부위·색을 가리킨다`);
  }
  return { colorWords, parts, compounds };
}

export function loadCreatures(path = CREATURES_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new CharacterError("종족표를 읽지 못했다 (data/creatures.json)", { cause });
  }
  if (!Array.isArray(parsed?.creatures)) throw new CharacterError("종족표에 creatures 배열이 없다");
  const seen = new Set();
  return parsed.creatures.map((c) => {
    if (typeof c?.id !== "string" || seen.has(c.id)) throw new CharacterError(`종족 id 가 없거나 겹친다: ${c?.id}`);
    seen.add(c.id);
    if (!isStringList(c.words)) throw new CharacterError(`종족 ${c.id} 에 낱말이 없다`);
    const skin = c.skin ?? null;
    if (skin !== null && !Object.hasOwn(RANGES, skin)) throw new CharacterError(`종족 ${c.id} 의 피부 낱말 ${skin} 이 범위표에 없다`);
    const finish = c.finish ?? null;
    if (finish !== null && typeof finish !== "string") throw new CharacterError(`종족 ${c.id} 의 재질이 문자열이 아니다`);
    return { id: c.id, words: [...c.words], skin, finish };
  });
}

/** 문장에서 가장 앞에 나온 종족. LLM 을 거치지 않는다 — Ollama 없이도 같은 답이어야 한다. */
export function findCreature(text, creatures) {
  const s = typeof text === "string" ? text : "";
  let best = null;
  for (const c of creatures) {
    for (const w of c.words) {
      const at = s.indexOf(w);
      if (at >= 0 && (best === null || at < best.at)) best = { at, c };
    }
  }
  return best ? best.c : null;
}
