// 의도 → 색(42단계). Claude 가 문장을 읽어 낸 "의도" 를 받아 헥스를 계산한다.
//
// **헥스를 지어내지 않는다.** Claude 는 아래 표의 낱말(색상 13 · 톤 12 · 쓰임새 · 대비 …)만 고르고, 색은 이 파일이
// OKLCH 좌표로 계산한다. 같은 의도는 늘 같은 색이다 — 난수·시각·파일을 안 쓴다.
// 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md
//
// **수치는 전부 `[판단]` 이다.** PCCS 는 톤을 이름과 그림으로 주고 OKLCH 수치는 안 준다. 색상각 대표값 · 톤별 밝기와
// 상대 채도 · 대비 폭 · 3안의 배율을 여기 한 곳에 둔다. 바꾸려면 여기만 고친다.

import { contrast } from "../public/color.js";
import { shareBounds } from "../public/ratio.js";
import { cuspLightness, hexToOklch, hueDistance, maxChroma, oklchToHex } from "./oklch.js";

/* ── 낱말표 ─────────────────────────────────────────────── */

/** 색상 낱말 → OKLCH 색상각 `[판단]`. sRGB 원색의 OKLCH 각(빨강 29 · 노랑 110 · 파랑 264 …)에 가깝게 잡았다. */
export const HUES = Object.freeze({
  red: 29,
  orange: 55,
  yellow: 105,
  "yellow-green": 128,
  green: 145,
  teal: 182,
  cyan: 205,
  blue: 258,
  indigo: 280,
  purple: 305,
  magenta: 330,
  pink: 355,
  neutral: null,
});

export const HUE_NAMES = Object.freeze({
  red: "빨강", orange: "주황", yellow: "노랑", "yellow-green": "연두", green: "초록", teal: "청록", cyan: "하늘",
  blue: "파랑", indigo: "남색", purple: "보라", magenta: "자홍", pink: "분홍", neutral: "무채색",
});

/**
 * PCCS 12톤 → (밝기, 상대 채도) `[판단]`.
 *
 * 상대 채도는 "그 밝기·그 색상에서 화면이 낼 수 있는 가장 선명한 정도" 의 몇 할인가다. 그래야 "선명한 노랑" 과 "선명한 파랑" 이
 * 둘 다 제 색의 끝까지 간다. 밝기는 앞의 넷(선명·강한·밝은·연한)과 몇몇이 **색상마다 다르다** — 노랑은 아주 밝은 곳에서,
 * 파랑은 어두운 곳에서 가장 선명해지기 때문이다(`cuspLightness`). PCCS 의 vivid 가 색상마다 명도가 다른 것과 같은 이유다.
 */
export const TONES = Object.freeze({
  vivid: { name: "선명한", c: 1.0, l: (cusp) => cusp },
  strong: { name: "강한", c: 0.85, l: (cusp) => cusp * 0.88 },
  bright: { name: "밝은", c: 0.8, l: (cusp) => cusp + (0.97 - cusp) * 0.45 },
  light: { name: "연한", c: 0.5, l: (cusp) => Math.max(0.86, cusp) },
  pale: { name: "아주 연한", c: 0.3, l: (cusp) => Math.min(0.97, Math.max(0.93, cusp + 0.02)) },
  soft: { name: "부드러운", c: 0.42, l: (cusp) => Math.max(0.74, cusp - 0.12) },
  dull: { name: "탁한", c: 0.38, l: (cusp) => Math.max(0.56, cusp - 0.3) },
  deep: { name: "짙은", c: 0.8, l: (cusp) => Math.min(0.45, cusp * 0.7) },
  dark: { name: "어두운", c: 0.55, l: () => 0.3 },
  "light-grayish": { name: "밝은 회색빛", c: 0.14, l: (cusp) => Math.min(0.93, Math.max(0.85, cusp - 0.05)) },
  grayish: { name: "회색빛", c: 0.14, l: () => 0.58 },
  "dark-grayish": { name: "어두운 회색빛", c: 0.14, l: () => 0.28 },
});

export const USAGES = Object.freeze({ general: "일반", ui: "UI", illustration: "일러스트", brand: "브랜드" });
export const CONTRASTS = Object.freeze({ low: "약하게", medium: "보통", high: "강하게" });
export const TEMPERATURES = Object.freeze({ warm: "따뜻하게", cool: "차갑게", neutral: "중립" });
export const KINDS = Object.freeze(["palette", "diagnosis", "other"]);
/** 다음 말이 직전 의도를 고치는가(refine) 새로 시작하는가(new) — 43단계. 색에는 안 닿는다. */
export const BASES = Object.freeze(["refine", "new"]);

export const COUNT_MIN = 3;
export const COUNT_MAX = 7;
export const COUNT_DEFAULT = 5;
export const READING_MAX = 80;
const LIST_MAX = 3;

/** 무채색의 기운. 순회색 대신 아주 옅게 데우거나 식힌다 `[판단]`. */
const NEUTRAL_TINT = Object.freeze({ warm: 70, cool: 250, neutral: 95 });

/** 명도를 벌리는 폭(대비 칸) `[판단]`. 일러스트는 빛과 그림자 폭이 더 필요해 조금 더 벌린다. */
const SPREAD = Object.freeze({ low: 0.12, medium: 0.25, high: 0.45 });
const ILLUSTRATION_EXTRA = 0.1;

/** 뺄 색의 띠. 이 안에서 C 가 이보다 크면 그 색이 "보인다" 고 본다. */
export const AVOID_BAND = 20;
export const AVOID_CHROMA = 0.04;

/** 포인트를 살리려고 나머지를 누르는 정도 — 포인트 C 의 몇 할까지 허락하나 `[판단]`. */
const ACCENT_HEADROOM = 0.8;

/**
 * 이보다 C 가 작은 포인트는 사실상 무채색이다 `[판단]`. "어두운 회색빛 청록" 포인트는 C 0.006 이라 바탕(0.006)과 비긴다 —
 * 그런 포인트 아래로 나머지를 누르면 화면 전체가 회색이 된다. 사용자가 회색빛 포인트를 말한 것이니 누르지 않는다(S42-G6).
 */
export const NEUTRAL_ACCENT_C = 0.03;

/** UI 대비 하한 `[문헌]` WCAG 2.x — 본문 1.4.3(4.5:1), 그래픽·컴포넌트 1.4.11(3:1). */
export const UI_TEXT_MIN = 4.5;
export const UI_COMPONENT_MIN = 3;

/** 3안 `[판단]`. 같은 의도에서 결정적으로 나온다. */
export const VARIANTS = Object.freeze([
  // bgTint · textL 은 UI 쓰임새만 쓴다 — 3색 UI(바탕 · 본문 · 강조)는 채도 배율이 거의 안 닿아 대담안이 충실안과 같은 헥스가 됐다(S42-G9).
  { id: "faithful", name: "충실", principle: "읽은 그대로", cMul: 1, spread: 1, hueStep: 0, accentC: (c) => c, bgTint: 0.25, textL: 0 },
  { id: "soft", name: "부드럽게", principle: "한 톤 차분하게 — 채도를 누르고 명도 폭을 좁혔다", cMul: 0.7, spread: 0.75, hueStep: 0, accentC: (c) => c * 0.85, bgTint: 0.12, textL: 0.04 },
  { id: "bold", name: "대담하게", principle: "한 톤 세게 — 채도와 명도 폭을 키우고 색상을 벌렸다", cMul: 1.2, spread: 1.3, hueStep: 12, accentC: () => 1, bgTint: 0.5, textL: -0.05 },
]);

/* ── 의도 검증 ──────────────────────────────────────────── */

const own = (obj, key) => (obj && typeof obj === "object" && Object.hasOwn(obj, key) ? obj[key] : undefined);
const oneOf = (value, table, fallback) => (typeof value === "string" && Object.hasOwn(table, value) ? value : fallback);
const BIDI_AND_CONTROL = /[\p{Cc}\p{Cf}]/gu;
const DIAGNOSIS_ID = /^[a-z0-9-]{1,40}$/;

/** 색상 낱말 배열. 문자열만 · 아는 것만 · 겹침 없이 · 최대 셋. `neutral` 을 허락할지는 호출부가 정한다. */
function hueList(value, { allowNeutral }) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    if (typeof v !== "string" || !Object.hasOwn(HUES, v)) continue;
    if (v === "neutral" && !allowNeutral) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length === LIST_MAX) break;
  }
  return out;
}

/**
 * 모델이 낸 의도든 화면이 저장하라고 보낸 의도든 **같은 검증**을 거친다. 모르는 값은 버리거나 기본값으로 — 던지지 않는다.
 * 문자열 강제 변환을 쓰지 않는다: `["ui"]` 는 `String(["ui"]) === "ui"` 라 강제 변환하면 통과한다(S18-G3 이 같은 부류를 잡았다).
 *
 * @param {unknown} raw 객체(또는 JSON 문자열)
 * @returns {null | {kind, usage, count, base: {hues: string[], tone: string}, accent: null | {hue, tone}, temperature, contrast, avoid: string[], reading: string}}
 *   객체가 아니거나 **뼈대(`kind` · `base`)가 없으면** null. 나머지 칸은 모르면 기본값으로 채운다.
 *   뼈대를 요구하는 이유: 다른 질문의 답(`{"intent":"palette","terms":[…]}`)이 기본값으로 채워져 "회색 5색" 의도로
 *   둔갑했다 — 옛 게이트의 가짜 모델이 그 모양을 모든 질문에 돌려준다. 의도가 아닌 것은 의도가 아니라고 말해야 한다.
 */
export function parseIntent(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const kind = own(value, "kind");
  const base = own(value, "base");
  if (!KINDS.includes(kind) || !base || typeof base !== "object" || Array.isArray(base)) return null;
  const usage = oneOf(own(value, "usage"), USAGES, "general");
  const rawCount = own(value, "count");
  const count = Number.isInteger(rawCount) && rawCount >= COUNT_MIN && rawCount <= COUNT_MAX ? rawCount : COUNT_DEFAULT;
  const avoid = hueList(own(value, "avoid"), { allowNeutral: false });

  let hues = hueList(own(base, "hues"), { allowNeutral: true }).filter((h) => !avoid.includes(h));
  if (hues.length === 0) hues = ["neutral"];
  const tone = oneOf(own(base, "tone"), TONES, "soft");

  const rawAccent = own(value, "accent");
  const accentHue = oneOf(own(rawAccent, "hue"), HUES, null);
  const accent =
    accentHue && !avoid.includes(accentHue) ? { hue: accentHue, tone: oneOf(own(rawAccent, "tone"), TONES, "vivid") } : null;

  const rawReading = own(value, "reading");
  const reading = typeof rawReading === "string" ? rawReading.replace(BIDI_AND_CONTROL, "").trim().slice(0, READING_MAX) : "";

  // 키 순서를 고정한다 — 저장 키(`intentKey`)가 이 모양의 JSON 이다.
  return {
    kind,
    usage,
    count,
    base: { hues, tone },
    accent,
    temperature: oneOf(own(value, "temperature"), TEMPERATURES, "neutral"),
    contrast: oneOf(own(value, "contrast"), CONTRASTS, "medium"),
    avoid,
    reading,
    basis: BASES.includes(own(value, "basis")) ? own(value, "basis") : "new",
    // 진단 id(44단계) — 모양만 본다. 지금 코퍼스에 있는 id 인지는 코퍼스를 아는 서버가 본다.
    diagnosis: typeof own(value, "diagnosis") === "string" && DIAGNOSIS_ID.test(own(value, "diagnosis")) ? own(value, "diagnosis") : null,
  };
}

/** 같은 색을 내는 의도는 같은 키. `reading`(설명 문장)은 색에 안 닿으므로 빼고, `kind` 도 뺀다. */
export const intentKey = (intent) => JSON.stringify({ ...intent, kind: undefined, reading: undefined, basis: undefined, diagnosis: undefined });

/* ── 엔진 ──────────────────────────────────────────────── */

const clampL = (l) => Math.min(0.97, Math.max(0.12, l));

/** 색상 낱말 → 실제 각. 무채색이면 온도가 정한 기운의 각. */
const angleOf = (hue, temperature) => HUES[hue] ?? NEUTRAL_TINT[temperature];

/** 뺄 색 띠 밖으로 민다 — 그 각이 있는 쪽 가장자리 너머로. 세 번 밀어도 다른 띠에 걸리면 null(C 를 누를 차례). */
function awayFromAvoid(h, avoidAngles) {
  let angle = ((h % 360) + 360) % 360;
  for (let i = 0; i < 3; i++) {
    const hit = avoidAngles.find((a) => hueDistance(angle, a) < AVOID_BAND);
    if (hit === undefined) return angle;
    const side = ((angle - hit + 540) % 360) - 180 >= 0 ? 1 : -1;
    angle = (((hit + side * (AVOID_BAND + 1)) % 360) + 360) % 360;
  }
  return avoidAngles.some((a) => hueDistance(angle, a) < AVOID_BAND) ? null : angle;
}

/**
 * 칸 하나를 헥스로. `spec` 은 {l, cRel, h, neutral, cap}. 무채색 칸은 상대 채도 대신 아주 작은 절대 C 를 쓴다.
 * 뺄 색 띠에 끝내 걸리면 C 를 띠의 문턱 아래로 누른다.
 */
function realize(spec, avoidAngles) {
  let h = spec.h;
  let squeeze = Infinity;
  if (!spec.neutral && avoidAngles.length) {
    const moved = awayFromAvoid(h, avoidAngles);
    if (moved === null) squeeze = AVOID_CHROMA * 0.9;
    else h = moved;
  }
  const l = clampL(spec.l);
  const raw = spec.neutral ? 0.006 + 0.016 * Math.min(1, spec.cRel) : Math.min(1, spec.cRel) * maxChroma(l, h);
  const c = Math.min(raw, spec.cap ?? Infinity, squeeze);
  const hex = oklchToHex({ l, c, h });
  // **계산한 각이 아니라 나온 헥스로 다시 잰다.** 띠 가장자리 바로 밖으로 민 각도 8비트 반올림 뒤에는 안으로 들어온다 —
  // 노랑을 빼 달랬는데 #68521F(h 85, 띠 105±20 안)가 나왔다 `[실측]`. 걸리면 C 를 띠 문턱 아래로 누른다.
  if (avoidAngles.length) {
    const got = hexToOklch(hex);
    if (got.c > AVOID_CHROMA && avoidAngles.some((a) => hueDistance(got.h, a) < AVOID_BAND)) {
      const c2 = Math.min(c, AVOID_CHROMA * 0.8);
      return { l, c: c2, h, hex: oklchToHex({ l, c: c2, h }) };
    }
  }
  return { l, c, h, hex };
}

/** 바탕에서 멀어지는 쪽으로 밝기를 0.01씩 밀어 대비 하한을 채운다. 끝까지 가도 모자라면 끝값. */
function pushContrast(spec, bgHex, min, avoidAngles) {
  const dir = hexToOklch(bgHex).l > 0.5 ? -1 : 1;
  let s = { ...spec };
  let out = realize(s, avoidAngles);
  for (let i = 0; i < 100 && contrast(out.hex, bgHex) < min; i++) {
    const next = clampL(s.l + dir * 0.01);
    if (next === s.l) break;
    s = { ...s, l: next };
    out = realize(s, avoidAngles);
  }
  return { spec: s, out };
}

/** 톤 하나를 이 색상에서의 (밝기, 상대 채도)로. */
function toneAt(toneId, h) {
  const tone = TONES[toneId];
  return { l: tone.l(cuspLightness(h)), cRel: tone.c };
}

/** 정수 지분, 합 100, 각자 하한 이상. 무게가 큰 칸부터 남는 것을 받고 모자라면 큰 칸에서 덜어 낸다. */
export function sharesFromWeights(weights) {
  const n = weights.length;
  const { min } = shareBounds(n);
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.max(min, Math.floor((w / total) * 100)));
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a] || a - b);
  let diff = 100 - shares.reduce((a, b) => a + b, 0);
  for (let k = 0; diff !== 0 && k < 1000; k++) {
    const i = order[k % n];
    if (diff > 0) {
      shares[i] += 1;
      diff -= 1;
    } else if (shares[i] > min) {
      shares[i] -= 1;
      diff += 1;
    }
  }
  return shares;
}

const UI_ROLES = Object.freeze({
  3: ["바탕", "본문", "강조"],
  4: ["바탕", "면", "본문", "강조"],
  5: ["바탕", "면", "본문", "주색", "강조"],
  6: ["바탕", "면", "본문", "주색", "보조", "강조"],
  7: ["바탕", "면", "테두리", "본문", "주색", "보조", "강조"],
});
const UI_WEIGHT = Object.freeze({ 바탕: 6, 면: 3, 테두리: 1, 본문: 2, 주색: 2, 보조: 1, 강조: 1 });
/** 면·테두리가 바탕에서 얼마나 떨어지나(대비 칸별) `[판단]`. */
const UI_STEP = Object.freeze({ low: [0.03, 0.1], medium: [0.05, 0.15], high: [0.08, 0.22] });

/** UI 쓰임새. 바탕 · 면 · 본문 · 주색 · 강조 … 역할과 WCAG 대비를 엔진이 보장한다. */
function composeUi(intent, v) {
  const avoidAngles = intent.avoid.map((a) => HUES[a]);
  const [h0Name, h1Name] = intent.base.hues;
  const neutral0 = HUES[h0Name] === null;
  const h0 = angleOf(h0Name, intent.temperature);
  const baseTone = toneAt(intent.base.tone, h0);
  const dark = baseTone.l < 0.45;
  const roles = UI_ROLES[intent.count];
  const [surfaceStep, borderStep] = UI_STEP[intent.contrast].map((s) => s * v.spread * (dark ? 1 : -1));
  const bgL = dark ? 0.19 : 0.975;

  // 강조 — 포인트가 없으면 첫 바탕 색상의 선명한 톤. 강조는 늘 그 화면에서 가장 선명해야 하므로 먼저 확정하고 나머지를 그 아래로 누른다.
  const accentName = intent.accent?.hue ?? h0Name;
  const accentNeutral = HUES[accentName] === null;
  const ah = angleOf(accentName, intent.temperature);
  const at = toneAt(intent.accent?.tone ?? "vivid", ah);
  const accentSpec = { l: at.l, cRel: v.accentC(at.cRel), h: ah, neutral: accentNeutral };

  let cap = Infinity;
  let bg;
  let accent;
  // 바탕 C 가 포인트보다 크면 바탕도 눌러야 하고, 바탕이 바뀌면 포인트 대비를 다시 봐야 한다. 두 번이면 멈춘다.
  for (let i = 0; i < 2; i++) {
    bg = realize({ l: bgL, cRel: v.bgTint, h: h0, neutral: neutral0, cap }, avoidAngles);
    accent = pushContrast(accentSpec, bg.hex, UI_COMPONENT_MIN, avoidAngles).out;
    // 판정은 나온 헥스에서 잰 C 로 한다 — 반올림 전 값으로 가르면 문턱(0.03)에서 게이트와 엔진이 서로 다른 쪽에 선다.
    const measured = hexToOklch(accent.hex).c;
    cap = accentNeutral || measured < NEUTRAL_ACCENT_C ? Infinity : measured * ACCENT_HEADROOM;
  }

  const h1 = h1Name ? angleOf(h1Name, intent.temperature) : h0 + 30;
  const neutral1 = h1Name ? HUES[h1Name] === null : neutral0;
  const specFor = (role) => {
    switch (role) {
      case "면":
        return { spec: { l: bgL + surfaceStep, cRel: 0.3 * v.cMul, h: h0, neutral: neutral0, cap }, min: 0 };
      case "테두리":
        return { spec: { l: bgL + borderStep, cRel: 0.2 * v.cMul, h: h0, neutral: neutral0, cap }, min: 0 };
      case "본문":
        return { spec: { l: dark ? 0.93 - v.textL : 0.26 + v.textL, cRel: 0.15 * v.cMul, h: h0, neutral: neutral0, cap }, min: UI_TEXT_MIN };
      // 주색 · 보조는 누르지 않는다 — 화면에서 강조와 나란히 서는 "부품 색" 이다. 눌렀더니 "신뢰감 있는 강한 파랑" 이
      // 청록 포인트(본디 C 가 낮다) 아래로 끌려 #516C95 처럼 탁해졌다 `[실측 10-02]`. 누르는 것은 바탕 · 면 · 테두리 · 본문뿐이다.
      case "주색":
        return { spec: { l: baseTone.l, cRel: baseTone.cRel * v.cMul, h: h0, neutral: neutral0 }, min: UI_COMPONENT_MIN };
      case "보조":
        return { spec: { l: toneAt(intent.base.tone, h1).l, cRel: baseTone.cRel * v.cMul, h: h1 + v.hueStep, neutral: neutral1 }, min: UI_COMPONENT_MIN };
      default:
        return null;
    }
  };

  const colors = roles.map((role) => {
    if (role === "바탕") return { role, hex: bg.hex };
    if (role === "강조") return { role, hex: accent.hex };
    const { spec, min } = specFor(role);
    const out = min ? pushContrast(spec, bg.hex, min, avoidAngles).out : realize(spec, avoidAngles);
    return { role, hex: out.hex };
  });
  return { colors, shares: sharesFromWeights(roles.map((r) => UI_WEIGHT[r])), theme: dark ? "dark" : "light" };
}

/** 일반 · 일러스트 · 브랜드. 바탕 색상들에 칸을 나누고 명도를 벌린 뒤 마지막 칸에 포인트. */
function composeGeneral(intent, v) {
  const avoidAngles = intent.avoid.map((a) => HUES[a]);
  const slots = intent.count - (intent.accent ? 1 : 0);
  const hues = intent.base.hues;
  const groupOf = (i) => Math.min(hues.length - 1, Math.floor((i * hues.length) / slots));

  const spread = (SPREAD[intent.contrast] + (intent.usage === "illustration" ? ILLUSTRATION_EXTRA : 0)) * v.spread;
  const h0 = angleOf(hues[0], intent.temperature);
  const baseL = toneAt(intent.base.tone, h0).l;
  // 남는 쪽부터 벌린다 — 밝은 바탕이면 어두운 쪽으로 먼저.
  const firstDir = baseL > 0.6 ? -1 : 1;
  const half = Math.ceil((slots - 1) / 2);
  const step = half ? spread / 2 / half : 0;
  const offsetOf = (i) => (i === 0 ? 0 : (i % 2 === 1 ? firstDir : -firstDir) * Math.ceil(i / 2) * step);

  // 포인트를 먼저 정한다 — 나머지를 그 아래로 누르기 위해서다.
  let cap = Infinity;
  let accentOut = null;
  if (intent.accent) {
    const ah = angleOf(intent.accent.hue, intent.temperature);
    const at = toneAt(intent.accent.tone, ah);
    accentOut = realize({ l: at.l, cRel: v.accentC(at.cRel), h: ah, neutral: HUES[intent.accent.hue] === null }, avoidAngles);
    const measured = hexToOklch(accentOut.hex).c;
    if (HUES[intent.accent.hue] !== null && measured >= NEUTRAL_ACCENT_C) cap = measured * ACCENT_HEADROOM;
  }

  // 같은 색상 묶음 안에서의 순번 — 대담안은 묶음 안에서 색상을 조금씩 벌린다.
  const members = hues.map((_, g) => Array.from({ length: slots }, (_, i) => i).filter((i) => groupOf(i) === g));
  const colors = [];
  for (let i = 0; i < slots; i++) {
    const g = groupOf(i);
    const name = hues[g];
    const k = members[g].indexOf(i);
    const groupSpread = (g - (hues.length - 1) / 2) * (v.hueStep ? 15 : 0);
    const h = angleOf(name, intent.temperature) + groupSpread + (k - (members[g].length - 1) / 2) * v.hueStep;
    const t = toneAt(intent.base.tone, h);
    const out = realize({ l: t.l + offsetOf(i), cRel: t.cRel * v.cMul, h, neutral: HUES[name] === null, cap }, avoidAngles);
    colors.push({ role: i === 0 ? "주조색" : i === 1 ? "보조색" : `보조색 ${i}`, hex: out.hex });
  }
  const weights = colors.map((_, i) => (i === 0 ? 5 : i === 1 ? 3 : 2));
  if (accentOut) {
    colors.push({ role: "강조색", hex: accentOut.hex });
    weights.push(1.2);
  }
  return { colors, shares: sharesFromWeights(weights), theme: null };
}

/**
 * 의도 하나 · 안 하나 → 색. 검증을 안 거친 의도는 받지 않는다 — 부르는 쪽이 `parseIntent` 를 거친다.
 * @param {ReturnType<typeof parseIntent>} intent
 * @param {number} variantIndex 0 충실 · 1 부드럽게 · 2 대담하게
 */
export function compose(intent, variantIndex) {
  const v = VARIANTS[variantIndex];
  if (!v) throw new RangeError(`모르는 안: ${variantIndex}`);
  const body = intent.usage === "ui" ? composeUi(intent, v) : composeGeneral(intent, v);
  return {
    id: `generated-${v.id}`,
    variant: variantIndex,
    name: v.name,
    principle: v.principle,
    source: `${USAGES[intent.usage]} · ${intent.count}색`,
    ...body,
  };
}

/** 3안. 헥스가 똑같은 안은 한 번만 낸다(무채색만 고른 의도에서 부드럽게 · 충실이 같아질 수 있다). */
export function composeAll(intent) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < VARIANTS.length; i++) {
    const p = compose(intent, i);
    const key = p.colors.map((c) => c.hex).join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * 이 엔진의 역할 → 재질 규칙(`src/material.js`)이 아는 역할. 재질 기본값 · 발광 세기는 그 표의 등급을 그대로 빌린다.
 * 그 표에 새 이름을 더하지 않는 이유: S16-G11 · S17-G8 이 그 표를 "파생 구조의 실제 역할과 정확히 같다" 로 잠갔다.
 */
export function materialRole(role) {
  if (role === "강조색" || role === "강조") return "강조";
  if (role === "주색" || role === "보조" || role === "본문") return "본문";
  if (role === "면" || role === "테두리") return "면";
  // 바탕 · 주조색 · 보조색 · 보조색 N — 조용한 넓은 면이다. 처음엔 보조색을 "면" 에 붙였더니 기본 재질이 메탈릭이 됐다 `[판단]`.
  return "바탕";
}

/**
 * 두 의도의 차이 — 화면의 "바뀐 것" 칩(43단계). **Claude 가 쓴 설명이 아니라 칸을 비교한 결과다.** 낱말표의 한국어 이름만 쓴다.
 * 색에 닿는 칸만 본다(kind · reading · basis 제외).
 */
export function diffIntent(before, after) {
  const out = [];
  const hues = (list) => (list.length ? list.map((h) => HUE_NAMES[h]).join("·") : "없음");
  const accent = (a) => (a ? `${HUE_NAMES[a.hue]} ${TONES[a.tone].name}` : "없음");
  if (before.usage !== after.usage) out.push(`쓰임새 ${USAGES[before.usage]}→${USAGES[after.usage]}`);
  if (before.count !== after.count) out.push(`색 ${before.count}→${after.count}`);
  if (before.base.hues.join() !== after.base.hues.join()) out.push(`바탕 색 ${hues(before.base.hues)}→${hues(after.base.hues)}`);
  if (before.base.tone !== after.base.tone) out.push(`바탕 톤 ${TONES[before.base.tone].name}→${TONES[after.base.tone].name}`);
  if (accent(before.accent) !== accent(after.accent)) out.push(`포인트 ${accent(before.accent)}→${accent(after.accent)}`);
  if (before.temperature !== after.temperature) out.push(`온도 ${TEMPERATURES[before.temperature]}→${TEMPERATURES[after.temperature]}`);
  if (before.contrast !== after.contrast) out.push(`대비 ${CONTRASTS[before.contrast]}→${CONTRASTS[after.contrast]}`);
  for (const h of after.avoid) if (!before.avoid.includes(h)) out.push(`뺀 색 +${HUE_NAMES[h]}`);
  for (const h of before.avoid) if (!after.avoid.includes(h)) out.push(`뺀 색 −${HUE_NAMES[h]}`);
  return out;
}

/**
 * 고른 안을 맨 앞에(43단계). 나머지는 `composeAll` 순서 그대로 — 같은 헥스인 안은 한 번만.
 * @param {number} focus 0~2. 검증은 부르는 쪽이 한다
 */
export function composeFocused(intent, focus) {
  const first = compose(intent, focus);
  const key = first.colors.map((c) => c.hex).join();
  return [first, ...composeAll(intent).filter((p) => p.variant !== focus && p.colors.map((c) => c.hex).join() !== key)];
}

/** 화면에 "이렇게 읽었어요" 옆에 붙일 칸들. 낱말표의 한국어 이름만 쓴다 — 지어낸 말 없음. */
export function describeIntent(intent) {
  const hues = intent.base.hues.map((h) => HUE_NAMES[h]).join("·");
  const parts = [
    `${USAGES[intent.usage]} ${intent.count}색`,
    `바탕 ${hues} ${TONES[intent.base.tone].name}`,
  ];
  if (intent.accent) parts.push(`포인트 ${HUE_NAMES[intent.accent.hue]} ${TONES[intent.accent.tone].name}`);
  parts.push(`대비 ${CONTRASTS[intent.contrast]}`);
  if (intent.temperature !== "neutral") parts.push(TEMPERATURES[intent.temperature]);
  if (intent.avoid.length) parts.push(`뺀 색 ${intent.avoid.map((h) => HUE_NAMES[h]).join("·")}`);
  return parts;
}
