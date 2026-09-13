// 캐릭터 부위 여섯의 색을 정한다. **순수 함수** — 같은 입력이면 같은 색(S34-G3 이 두 번 계산해 대조한다).
//
// 색은 세 곳에서 온다. ① 말한 색(코퍼스 최근접) ② 인상으로 고른 배색 쌍(상의·강조) ③ 규칙 — 코퍼스 풀에서 고르거나
// (머리·눈·피부) 상의를 HSL 로 어둡게(하의). 어느 길도 헥스를 지어내지 않는다: 코퍼스 80색이거나 `basis`(코퍼스) 의 연산 결과다.
//
// **수치는 전부 여기 있다** `[판단]`. 원전은 캐릭터 부위를 말하지 않는다. 낱말은 data/ 에 있다.
//
// 처음 안(배색 쌍 하나를 HSL 로만 벌리기)은 두 색상각 안에서만 돌아 "두 색만 추천되지 않나" 는 지적을 받았다. 그래서
// 머리·눈·피부는 코퍼스 풀에서 고른다 — 4~5 색상각이 나온다(S34-G5).

import { hexToHsl, hslToHex, perceivedChroma } from "./expand.js";
import { nearestCorpus } from "./color-words.js";

export const CHARACTER_ROLES = Object.freeze(["피부", "머리", "눈", "상의", "하의", "강조"]);

/* ── 규칙 수치 [판단] ─────────────────────────────────────── */
const LOWER = { lDelta: 0.18, sFactor: 0.85, lFloor: 0.08 }; // 하의 = 상의 한 단 어둡게
const HAIR = { hueSpan: 40, minDarker: 0.15 }; // 머리 = 상의 근처 색상각, 상의보다 어둡게
const EYE = { hueSpan: 30, wideSpan: 90 }; // 눈 = 강조 근처 색상각 중 가장 쨍한 것. 새 구획이 없으면 ±90° 까지
const HUE_BUCKET = 30; // 색상각 구획 폭. "같은 색 계열" 의 단위 — S34-G5 의 사본과 같은 값
const CHROMATIC_MIN_S = 0.15; // 이 아래는 무채색으로 보고 구획에 안 센다(색상각이 뜻이 없다)
const SKIN = { hue: [10, 50], maxChroma: 0.35, minL: 0.6, center: { h: 30, s: 0.3, l: 0.75 } }; // 따뜻한 뉴트럴
/** 규칙으로 고른 부위와 이미 정해진 이웃의 명도차 하한. 하의는 −0.18 이라 상의가 바닥(lFloor) 근처가 아니면 넘는다. */
export const NEIGHBOR_MIN_L_GAP = 0.12;
const NEIGHBORS = Object.freeze({ 머리: ["피부"], 피부: ["머리", "상의"] });

const up = (hex) => String(hex).toUpperCase();
const wrap = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return d > 180 ? 360 - d : d;
};
const hslDistance = (a, b) => hueGap(a.h, b.h) / 180 + Math.abs(a.s - b.s) * 0.5 + Math.abs(a.l - b.l);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 배색 쌍을 바탕(채도 낮은 쪽)·강조로 가른다. expand.js 의 splitSeed 와 같은 기준이되 지각 채도로 본다. */
function splitPair(pair, corpus) {
  const colors = Array.isArray(pair?.colors) && pair.colors.length === 2 && pair.colors.every((c) => HEX.test(c?.hex ?? "")) ? pair.colors : corpus.slice(0, 2);
  const [a, b] = colors.map((c) => ({ hex: c.hex, name: c.name ?? c.origName ?? c.hex }));
  return perceivedChroma(hexToHsl(a.hex)) <= perceivedChroma(hexToHsl(b.hex)) ? { ground: a, accent: b } : { ground: b, accent: a };
}

/**
 * @param {{parts: Record<string, string|null>, creature: {skin: string|null}|null, pair: {colors: {hex, name}[]}, corpus: {hex, name}[]}} input
 * @returns {{colors: {role, hex, name, source: "spoken"|"pair"|"creature"|"rule", basis}[], warnings: string[]}}
 */
export function composeCharacter({ parts = {}, creature = null, pair, corpus }) {
  const pool = Array.isArray(corpus) ? corpus.filter((c) => HEX.test(c?.hex ?? "")) : [];
  const used = new Set();
  const out = Object.create(null);
  const warnings = [];
  const take = (role, color, source, basis = color.hex) => {
    out[role] = { role, hex: color.hex, name: color.name, source, basis };
    used.add(up(color.hex));
  };
  const hslOf = (role) => hexToHsl(out[role].hex);
  const fresh = (color) => {
    if (!used.has(up(color.hex))) return color;
    const target = hexToHsl(color.hex);
    const free = pool.filter((c) => !used.has(up(c.hex)));
    if (free.length === 0) return color;
    return free.map((c) => ({ c, d: hslDistance(target, hexToHsl(c.hex)) })).sort((x, y) => x.d - y.d || (x.c.hex < y.c.hex ? -1 : 1))[0].c;
  };
  /** 이미 정해진 이웃과 명도차를 지키는 후보만. 없으면 그대로 두고 경고를 남긴다. */
  const guarded = (role, candidates) => {
    const fixed = (NEIGHBORS[role] ?? []).filter((n) => out[n]);
    if (fixed.length === 0 || candidates.length === 0) return candidates;
    const ok = candidates.filter((x) => fixed.every((n) => Math.abs(x.hsl.l - hslOf(n).l) >= NEIGHBOR_MIN_L_GAP));
    if (ok.length) return ok;
    warnings.push(`${role}은 이웃(${fixed.join("·")})과 밝기 차이를 충분히 못 벌렸습니다`);
    return candidates;
  };
  const scored = () => pool.filter((c) => !used.has(up(c.hex))).map((c) => ({ c, hsl: hexToHsl(c.hex) }));
  const pick = (list, cmp) => (list.length ? [...list].sort((a, b) => cmp(a, b) || (a.c.hex < b.c.hex ? -1 : 1))[0].c : null);

  /** 이미 정해진 유채색 부위가 앉은 색상각 구획을 피하는 판정. 무채색(s < 0.15)은 구획이 없어 늘 통과한다. */
  const bucket = (hsl) => Math.floor(wrap(hsl.h) / HUE_BUCKET);
  const isFresh = () => {
    const taken = new Set(CHARACTER_ROLES.filter((r) => out[r]).map((r) => hslOf(r)).filter((x) => x.s >= CHROMATIC_MIN_S).map(bucket));
    return (x) => x.hsl.s >= CHROMATIC_MIN_S && !taken.has(bucket(x.hsl));
  };

  // ① 말한 색. 같은 색을 두 부위에 말할 수 있으므로 used 를 안 넘긴다.
  for (const role of CHARACTER_ROLES) {
    const word = parts?.[role];
    if (typeof word !== "string") continue;
    const color = nearestCorpus(word, pool);
    if (color) take(role, color, "spoken");
  }
  // ① ' 종족 피부 — 머리를 고르기 전에 정해야 이웃 명도차가 잡힌다.
  if (!out.피부 && creature?.skin) {
    const color = nearestCorpus(creature.skin, pool, used);
    if (color) take("피부", color, "creature");
  }
  // ② 배색 쌍
  const { ground, accent } = splitPair(pair, pool);
  if (!out.상의) take("상의", fresh(ground), "pair");
  if (!out.강조) take("강조", fresh(accent), "pair");
  // ③ 하의 — 상의를 한 단 어둡게. 코퍼스 밖 헥스가 나오는 유일한 자리라 basis 를 든다.
  if (!out.하의) {
    const { h, s, l } = hslOf("상의");
    const lower = Math.max(LOWER.lFloor, l - LOWER.lDelta);
    take("하의", { hex: hslToHex({ h, s: s * LOWER.sFactor, l: lower }), name: `${out.상의.name} 어둡게` }, "rule", out.상의.hex);
    // 검은 상의는 바닥에 걸려 더 못 어두워진다 — 색을 지어내는 대신 경고로 남긴다.
    if (l - lower < NEIGHBOR_MIN_L_GAP) warnings.push(`하의는 상의가 이미 어두워 더 어둡게 하지 못했습니다`);
  }
  // ③ 머리 — 상의 근처 색상각, 상의보다 어둡게. 없으면 근처 색상각 아무거나, 그것도 없으면 가장 어두운 것.
  if (!out.머리) {
    const top = hslOf("상의");
    const all = scored();
    const near = all.filter((x) => hueGap(x.hsl.h, top.h) <= HAIR.hueSpan);
    const darker = near.filter((x) => x.hsl.l <= top.l - HAIR.minDarker);
    // 같은 폭 안에서도 상의·강조가 안 앉은 구획을 먼저 본다 — 눈과 같은 이유(한 색 계열로 뭉치지 않게).
    const fresh = isFresh();
    const cands = darker.filter(fresh).length ? darker.filter(fresh) : darker.length ? darker : near.filter(fresh).length ? near.filter(fresh) : near.length ? near : all;
    const list = guarded("머리", cands);
    const color = pick(list, (a, b) => hueGap(a.hsl.h, top.h) - hueGap(b.hsl.h, top.h) || a.hsl.l - b.hsl.l);
    if (color) take("머리", color, "rule");
  }
  // ③ 눈 — 강조 근처 색상각 중 지각 채도가 가장 높은 것. **이미 앉은 색상각 구획은 피한다** — 배색 쌍이 상의·강조를
  //    같은 주황 부근에 앉히면(pair-05·09) 눈까지 거기 앉아 캐릭터가 한 색 계열로 뭉쳤다(실측: 픽스처 2건이 구획 2개).
  //    근처(±30°)에 새 구획이 없으면 ±90° 까지 넓히고, 그래도 없으면 근처 아무거나.
  if (!out.눈) {
    const acc = hslOf("강조");
    const all = scored();
    const fresh = isFresh();
    const near = all.filter((x) => hueGap(x.hsl.h, acc.h) <= EYE.hueSpan);
    const freshNear = near.filter(fresh);
    const freshWide = all.filter((x) => hueGap(x.hsl.h, acc.h) <= EYE.wideSpan && fresh(x));
    const list = freshNear.length ? freshNear : freshWide.length ? freshWide : near.length ? near : all;
    const color = pick(list, (a, b) => perceivedChroma(b.hsl) - perceivedChroma(a.hsl));
    if (color) take("눈", color, "rule");
  }
  // ③ 피부 — 따뜻한 뉴트럴. 상의와 명도차가 가장 큰 것. 조건에 드는 색이 없으면 중심에 가장 가까운 것.
  if (!out.피부) {
    const top = hslOf("상의");
    const all = scored();
    const fits = all.filter((x) => x.hsl.h >= SKIN.hue[0] && x.hsl.h <= SKIN.hue[1] && perceivedChroma(x.hsl) <= SKIN.maxChroma && x.hsl.l >= SKIN.minL);
    const list = guarded("피부", fits);
    const color = list.length
      ? pick(list, (a, b) => Math.abs(b.hsl.l - top.l) - Math.abs(a.hsl.l - top.l))
      : pick(all, (a, b) => hslDistance(a.hsl, SKIN.center) - hslDistance(b.hsl, SKIN.center));
    if (color) take("피부", color, "rule");
  }

  return { colors: CHARACTER_ROLES.map((r) => out[r]), warnings };
}
