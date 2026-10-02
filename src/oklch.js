// OKLCH 색 좌표(42단계). 사람이 느끼는 밝기(L)·선명함(C)·색상각(h)을 따로 움직일 수 있는 좌표다.
//
// 왜 HSL 이 아닌가: HSL 은 "같은 L" 이어도 노랑이 파랑보다 훨씬 밝아 보인다. 그래서 "같은 톤의 다른 색" 을 HSL 로
// 만들면 톤이 깨진다 — 미뤄 둔 B1(OKLCH)이 이 자리다. 변환식은 Björn Ottosson 의 OKLab 원식 그대로다 `[문헌]`.
// 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md 3.2절
//
// **순수 함수만 둔다.** 파일·네트워크·난수를 안 쓴다 — 같은 입력은 늘 같은 헥스다.

const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * 화면 안 판정 여유 — 8비트 반 단계. 이보다 작은 넘침은 헥스로 반올림할 때 사라진다.
 * 1e-4 로 두었더니 #0000FF 가 #0031E5 로 돌아왔다 `[실측]` — 파랑 근처에서 sRGB 경계가 같은 색상각 선을 살짝
 * 벗어나 휘기 때문이다(채널 하나가 −2e-4 쯤 음수). 반 단계 안이면 반올림 결과가 같으니 안으로 본다.
 */
const EPS = 0.5 / 255;

/** @returns {[number, number, number]} 0~1 이 아닐 수 있는 sRGB(감마) — 화면 밖이면 범위를 넘는다 */
function oklchToRgb({ l, c, h }) {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const [L, M, S] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map(toGamma);
}

const inside = (rgb) => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/** sRGB 로 낼 수 있는 색인가. */
export const inGamut = (lch) => inside(oklchToRgb(lch));

export function hexToOklch(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/**
 * 그 밝기·그 색상에서 화면이 낼 수 있는 가장 큰 C. 이진 탐색 — 24번이면 1e-7 까지 좁혀진다.
 * L 이 0·1 끝이면 0 이다(검정·흰색에는 색상이 없다).
 */
export function maxChroma(l, h) {
  if (l <= 0 || l >= 1) return 0;
  let lo = 0;
  let hi = 0.4; // sRGB 의 OKLCH C 는 0.33 을 안 넘는다
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut({ l, c: mid, h })) lo = mid;
    else hi = mid;
  }
  return lo;
}

const cusps = new Map();
/**
 * 색상 하나가 가장 선명해지는 밝기("첨점"). 노랑은 아주 밝은 곳(≈0.97), 파랑은 어두운 곳(≈0.45)에 있다.
 * PCCS 의 "선명한(vivid)" 톤이 색상마다 밝기가 다른 이유가 이것이다. 0.01 간격으로 찾고 색상각별로 기억한다.
 */
export function cuspLightness(h) {
  const key = Math.round(h * 10);
  if (cusps.has(key)) return cusps.get(key);
  let best = { l: 0.5, c: -1 };
  for (let l = 0.2; l <= 0.98 + 1e-9; l += 0.01) {
    const c = maxChroma(l, h);
    if (c > best.c) best = { l: Number(l.toFixed(2)), c };
  }
  cusps.set(key, best.l);
  return best.l;
}

/**
 * 화면 밖이면 L·h 를 지키고 C 만 줄인다. **원래 안이면 그대로** — 파랑 근처에서는 같은 색상각 선이 경계를 한 번
 * 나갔다 다시 들어와서(#0000AA 가 C 0.27 쯤에서 잠깐 밖이다 `[실측]`), `maxChroma` 는 첫 출구를 낸다. 이미 안인
 * 색을 그 값으로 자르면 왕복이 깨진다.
 */
export function clampToGamut({ l, c, h }) {
  const L = Math.min(1, Math.max(0, l));
  const H = ((h % 360) + 360) % 360;
  const C = Math.max(0, c);
  if (inGamut({ l: L, c: C, h: H })) return { l: L, c: C, h: H };
  return { l: L, c: Math.min(C, maxChroma(L, H)), h: H };
}

/** OKLCH → `#RRGGBB`. 화면 밖이면 먼저 C 를 줄인다. */
export function oklchToHex(lch) {
  const rgb = oklchToRgb(clampToGamut(lch));
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}

/** 두 색상각의 차(0~180). */
export const hueDistance = (a, b) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};
