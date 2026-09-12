// 씨앗 조합(배색사전 2색)을 배색 구조로 불린다.
//
// 왜 여기 있나: 코퍼스 16쌍은 전부 2색이라 바탕·본문·강조가 있는 화면을 짤 수 없다.
// 어떤 구조로 불릴지의 이름과 원리는 data/structures.json 이 원전에서 옮겨 들고 있고,
// **몇 도 벌리고 채도를 몇 % 누르는지는 원전에 없으므로 이 파일 하나에 둔다.**
// public/ratio.js 가 면적 규칙을 혼자 들고 있는 것과 같은 자리다 — 바꾸려면 여기만 고친다.
//
// **헥스를 지어내지 않는다.** 모든 파생색은 씨앗 두 색의 HSL 좌표에서 계산된다. 그래야
// 같은 질의가 같은 색을 내고(S11-G3), 명도 위계를 게이트로 검사할 수 있다(S11-G7).
// LLM 은 이 파일에 닿지 않는다. LLM 이 하는 일은 8개 중 무엇을 고르느냐뿐이다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chroma, contrast } from "../public/color.js";

const CATALOG_PATH = fileURLToPath(new URL("../data/structures.json", import.meta.url));

export class StructureError extends Error {}

export function loadStructures() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  } catch (cause) {
    throw new StructureError("구조 카탈로그를 읽지 못했다 (data/structures.json)", { cause });
  }
  if (!Array.isArray(parsed.structures) || parsed.structures.length === 0) {
    throw new StructureError("구조 카탈로그에 structures 배열이 없다 (data/structures.json)");
  }
  return parsed.structures;
}

/* ── 색 좌표 ──────────────────────────────────────────────
   HSL 을 쓰는 이유는 원전의 두 축(색상축·톤축)이 그대로 좌표축이 되기 때문이다.
   h 가 색상축, l·s 가 톤축이다. RGB 로는 "색상만 30도 돌린다" 를 쓸 수 없다. */

const HEX = /^#[0-9a-fA-F]{6}$/;

export function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? 60 * (((g - b) / d) % 6)
      : max === g
        ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

export function hslToHex({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round((v + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const wrapHue = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
};

const at = (c, { h = c.h, s = c.s, l = c.l } = {}) => ({
  h: wrapHue(h),
  s: clamp01(s),
  l: clamp01(l),
});

/** 짧은 쪽 호로 target 방향으로 최대 deg 만큼만 돈다. 한난 이동에 쓴다. */
function rotateToward(h, target, deg) {
  const diff = ((wrapHue(target) - wrapHue(h) + 540) % 360) - 180;
  return wrapHue(h + Math.sign(diff) * Math.min(Math.abs(diff), deg));
}

/** 짧은 쪽 호의 중간 색상각. 톤인톤이 두 씨앗 사이를 메울 때 쓴다. */
function midHue(a, b) {
  const diff = ((wrapHue(b) - wrapHue(a) + 540) % 360) - 180;
  return wrapHue(a + diff / 2);
}

/* ── 명도 앵커 ────────────────────────────────────────────
   "명도 단계가 뭉쳐 있다. 명·중·암 세 덩어리로 다시 벌린다"(진단표 '탁하다').
   덩어리로 읽히려면 단계 사이가 실제로 벌어져 있어야 하므로 값을 여기 한 줄로 모은다.
   S11-G7 이 이 간격을 검사한다 — 앵커를 좁히면 게이트가 먼저 운다. */
const L = { light: 0.93, upper: 0.72, mid: 0.5, lower: 0.32, dark: 0.15 };

/** 앵커 값을 밖에서 읽는다. 검사기가 "이 명도가 앵커인가" 를 물으려면 필요하다. */
export const ANCHORS = { ...L };

/* ── 명도 방향 ────────────────────────────────────────────
   여덟 구조는 원전의 **웹·앱 UI 색 결정** 절에서 왔고, 거기서 바탕이 밝은 것은 기본값이다.
   그래서 파생 결과의 바탕이 거의 전부 흰색에 가깝다 — 16쌍 × 8구조 128장 중 112장(87.5%)의
   바탕 명도가 l >= 0.90 이다(실측). 게임 씬처럼 어둠이 지배하는 화면은 전제가 다르다.

   **앵커를 거울로 뒤집어 방향만 바꾼다.** 근거는 원전의 명도 그루핑 —
   "명부·중간톤·암부 중 어느 덩어리가 가장 넓은 면적을 차지하는지 파악한다."

   반사이지 압축이 아니므로 앵커 사이 간격이 그대로 보존된다. 그래서 S11-G7(명도 단계 최소
   0.15)이 어두운 모드에서도 성립한다 — S15-G3 이 그것을 따로 검사한다. */
export const MIRROR = { light: "dark", upper: "lower", mid: "mid", lower: "upper", dark: "light" };

/** 명도 앵커만 뒤집는다. 채도 상한은 따라가지 않는다 — 아래 S_CAP 주석 참조. */
const anchorFor = (key, mode) => (mode === "dark" ? MIRROR[key] : key);

const isDark = (mode) => mode === "dark";

/* 앵커별 채도 상한.
   HSL 의 s 는 지각 채도가 아니다. 실제로 눈에 보이는 채도는 C = (1-|2l-1|)·s 라 **명도가
   0.5 에 가까울수록 같은 s 가 더 쨍해진다.** 옥색(#00978D, s=1.0)을 명도만 0.5 로 올렸더니
   #00ffee(C=1.00)가 나왔다(실측) — "통일·안정, 차분한 깊이" 라는 톤온톤 설명과 정반대다.

   **상한은 앵커가 맡는 역할에 맞춘 값이지 지각 채도를 고르게 맞춘 값이 아니다.** light 가 가장
   낮은 것은 그 앵커가 언제나 바탕이라 조용해야 하기 때문이고, mid 가 그다음인 것은 거기가
   형광이 나오는 자리이기 때문이며, dark 가 가장 느슨한 것은 명도 자체가 이미 C 를 눌러 주기
   때문이다. 그래서 값은 단조 증가한다 — 지각 채도로 보면 여전히 mid 가 가장 높고, 그건
   본문·강조가 색으로 읽혀야 하므로 의도한 것이다.

   **형광선은 이 표가 아니라 S11-G9 가 지킨다** — 파생색의 지각 채도가 코퍼스 32색의 최대치를
   넘지 않는지 본다. 이 표만으로는 조합에 따라 그 선을 넘을 수 있고, 실제로 톤인톤이 넘었다. */
const S_CAP = { light: 0.3, upper: 0.5, mid: 0.6, lower: 0.78, dark: 0.85 };

/** 지각 채도. 눈에 보이는 쨍함은 s 가 아니라 이 값이다. */
export const perceivedChroma = ({ s, l }) => (1 - Math.abs(2 * l - 1)) * s;

/**
 * 앵커 하나로 색을 옮긴다. 채도는 씨앗보다 올라가지 않고 앵커 상한도 넘지 않는다.
 *
 * **명도만 거울을 타고 채도 상한은 안 탄다.** S_CAP 은 위 주석대로 "앵커가 맡는 **역할**에
 * 맞춘 값" 이다 — `light` 가 가장 낮은 것은 그 자리가 언제나 바탕이라 조용해야 하기 때문이다.
 * 바탕이 어느 명도로 가든 바탕은 조용해야 하므로, 상한은 규칙이 요청한 원래 키를 따른다.
 * 거울을 채도에도 먹이면 어두운 모드의 바탕이 S_CAP.dark(0.85)를 쓰게 되어, 바탕을 조용하게
 * 두려던 이유가 통째로 사라진다.
 *
 * 규칙은 이것을 **인자로 받는다.** 모듈 레벨에 기본 모드용 `step` 을 따로 두었다가 뺐다 —
 * 모든 규칙이 인자를 구조 분해하므로 그 이름이 가려져 **아무도 쓰지 않는 죽은 코드**가 됐고,
 * 뮤테이션(`makeStep("light")` → `makeStep("dark")`)으로 바꿔도 결과가 안 변해 게이트 여섯이
 * 전부 조용했다. 죽은 갈래는 다음 사람에게 "여기를 고치면 기본 모드가 바뀐다"고 거짓말을 한다.
 */
const makeStep =
  (mode) =>
  (c, key, { h = c.h, k = 1 } = {}) =>
    at(c, { h, l: L[anchorFor(key, mode)], s: Math.min(c.s * k, S_CAP[key]) });

// 한난의 기준 색상각. 원전은 "따뜻한 뉴트럴(살구·아이보리)" 과 "먼 쪽은 한색" 이라고만 말하고
// 각도를 말하지 않는다. 살구·아이보리가 앉는 자리와 하늘·그림자가 앉는 자리를 각으로 옮긴 값이다.
const WARM = 32;
const COOL = 210;
// 살구·아이보리가 앉는 구간. 이 밖으로 나가면 "따뜻한 뉴트럴" 이 이름값을 못 한다.
const WARM_BAND = [15, 55];

/** 색상각을 난색 구간 안으로 민다. 이미 안에 있으면 그대로 둔다 — 씨앗의 색을 살리는 쪽이 먼저다. */
function clampToWarm(h) {
  const hue = wrapHue(h);
  const [lo, hi] = WARM_BAND;
  if (hue >= lo && hue <= hi) return hue;
  return hueGap(hue, lo) <= hueGap(hue, hi) ? lo : hi;
}

/**
 * 씨앗 두 색에서 바탕과 강조를 가른다.
 * 채도가 낮은 쪽이 바탕이다 — public/ratio.js 가 면적을 정할 때 쓴 것과 같은 판정이고,
 * 그 판정은 D형 9쌍에서 디자인 초안의 손 배치와 8/9 일치했다(실측).
 */
function splitSeed(colors) {
  const [a, b] = colors;
  return chroma(a.hex) <= chroma(b.hex) ? { ground: a, accent: b } : { ground: b, accent: a };
}

/* ── 구조별 파생 규칙 ─────────────────────────────────────
   각 규칙은 {ground, accent} 의 HSL 을 받아 [{role, hsl}] 을 돌려준다.
   역할 이름(바탕·본문·강조)은 "디자인 토큰은 톤 축으로 먼저 짠다"(4절)의 자리 이름이다. */

/* ── 읽힐 때까지 채도를 뺀다 (24단계) ────────────────────────
   **HSL 명도는 지각 휘도가 아니다.** 같은 앵커에 앉혀도 색상에 따라 휘도가 6배 넘게 갈린다 —
   l=0.5 에서 노랑은 0.510, 파랑은 0.081 이다(실측). 그래서 앵커만으로는 "본문이 바탕 위에서
   읽힌다" 를 보장할 수 없다.

   **앵커 자체가 못 닿는 경우도 있었다.** 순수 회색으로 계산해도 `light(0.93)` ↔ `mid(0.5)` 는
   최대 3.37:1 이라 **어떤 색으로도 4.5 에 못 닿는다.** 톤온톤의 본문이 거기 있었고,
   **씨앗 40 × 모드 2 = 80건 중 62건이 읽히지 않았다.** 본문을 `lower` 로 내린 것이 그
   때문이다(회색 기준 6.67:1).

   그러고도 남는 것이 있다 — 청록·노랑·주황처럼 **휘도가 높은 색상**은 같은 앵커에서도 밝다.
   그때만 채도를 뺀다. **회색 쪽으로 가면 반드시 목표에 닿는다**(회색이 앵커 간격만큼의 대비를
   내므로). 80건 중 **9건만 손대고 71건은 그대로다**(실측).

   **문턱을 여기서 정하지 않는다.** 4.5:1 은 WCAG 2.2 의 일반 크기 글자 기준이고 `[문헌]`,
   이 저장소가 스와치 글자색에 이미 쓰던 값이다(S2-G5·S13-G6).

   **채도를 빼는 것이 이 구조의 성격을 배신하지 않는다.** 톤온톤의 설명이 "통일·안정,
   차분한 깊이" 이고, value-scale 의 주석이 이미 같은 것을 말한다 —
   "채도를 낮게 묶어야 단계가 명도로만 읽힌다."

   S24-G1 이 이 보장을 검사한다. */
const TEXT_CONTRAST = 4.5;

/**
 * 이 색이 바탕 위에서 읽히게 만든다. **읽히면 손대지 않는다.**
 *
 * 색상은 그대로 두고 채도만 뺀다 — 씨앗의 색을 잃지 않기 위해서다. 명도도 안 건드린다.
 * 앵커가 정한 단계를 흐트러뜨리면 `S11-G7` 이 지키던 것이 무너진다.
 *
 * 이분 탐색 24회는 **결정적**이다(`S11-G3`). 채도 정밀도가 2^-24 라 헥스 반올림보다 촘촘하다.
 */
function readable(hsl, groundHex) {
  const at = (s) => hslToHex({ ...hsl, s });
  if (contrast(at(hsl.s), groundHex) >= TEXT_CONTRAST) return hsl;
  // 회색으로도 못 닿으면 회색이 최선이다. 앵커가 그만큼 안 벌어졌다는 뜻이고 S24-G1 이 운다.
  if (contrast(at(0), groundHex) < TEXT_CONTRAST) return { ...hsl, s: 0 };

  let lo = 0;
  let hi = hsl.s;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (contrast(at(mid), groundHex) >= TEXT_CONTRAST) lo = mid;
    else hi = mid;
  }
  return { ...hsl, s: lo };
}

const RULES = {
  /*
   * 색상 고정, 명도만 세로로. 세 색의 h 가 모두 같아야 이름값을 한다(S11-G6).
   *
   * **본문이 `mid` 에 있었고, 그 자리는 읽힐 수 없는 자리였다(24단계).** 바탕이 `light`(0.93)
   * 인데 `mid`(0.5)와의 대비는 **순수 회색으로 계산해도 최대 3.37:1** 이라 어떤 색으로도
   * 4.5 에 못 닿는다. 씨앗 40 × 모드 2 = 80건 중 62건이 읽히지 않았다.
   *
   * `value-scale` 은 같은 것을 약속하고도 0건이었다 — 그쪽 본문이 `lower` 에 있기 때문이다.
   * **대조군이 있으니 "이 기법은 원래 그렇다" 가 아니다.** 카탈로그도 이 구조를
   * *"바탕부터 본문까지 한 색으로 덮을 때 쓴다"* 고 적어 글자 올릴 자리라고 스스로 말한다.
   *
   * `lower` 로 내리면 명도 단계는 0.93 → 0.32 → 0.15 다. 인접 간격이 0.61·0.17 로
   * `S11-G7`(최소 0.15)을 지킨다.
   */
  "tone-on-tone": ({ accent, step }) => {
    const ground = step(accent, "light", { k: 0.35 });
    return [
      { role: "바탕", hsl: ground },
      // 앵커만으로는 색상에 따라 못 닿는다. 그때만 채도를 뺀다 — 위 `readable` 주석 참조.
      { role: "본문", hsl: readable(step(accent, "lower"), hslToHex(ground)) },
      { role: "강조", hsl: step(accent, "dark", { k: 0.8 }) },
    ];
  },

  // 톤 좌표를 고정하고 색상만 가로로. 두 씨앗의 톤을 평균 내 같은 자리에 앉힌다.
  // 씨앗의 색상 간격이 좁으면 메울 사이가 없으므로 그때만 ±40 으로 벌린다.
  //
  // **평균 낸 톤은 두 씨앗보다 쨍할 수 있다.** l 과 s 를 따로 평균하면 l 이 0.5 쪽으로 당겨지면서
  // C = (1-|2l-1|)·s 가 둘 다를 넘는다 — 로즈핑크(C=0.533)×민트그린(C=0.706)에서 0.776 이
  // 나왔다(실측). 코퍼스 32색의 최대치(0.729)까지 넘는 값이라, 원전에 없는 강도의 색을 만든 것이다.
  // 그래서 평균 뒤에 **씨앗 중 높은 쪽의 지각 채도까지 s 를 되돌린다.**
  //
  // **어두운 모드에서만 거울이 아니라 접기다.** 이 구조는 톤을 씨앗 명도의 평균에서 가져오므로
  // 앵커가 없고, 그대로 반사(1-l)하면 **어두운 씨앗이 오히려 밝아진다** — pair-06 의 톤인톤은
  // l=0.38 이라 반사하면 0.62 다. 그래서 어두운 쪽으로 접는다(min(l, 1-l)). 이미 어두우면
  // 그대로 두는 것이 이 구조의 정의를 지키는 쪽이다 — 톤은 씨앗이 정한다.
  "tone-in-tone": ({ ground, accent, mode }) => {
    const mean = (ground.l + accent.l) / 2;
    const l = isDark(mode) ? Math.min(mean, 1 - mean) : mean;
    const ceiling = Math.max(perceivedChroma(ground), perceivedChroma(accent));
    const span = 1 - Math.abs(2 * l - 1); // 이 명도에서 s=1 이 내는 지각 채도
    const s = Math.min((ground.s + accent.s) / 2, span === 0 ? 0 : ceiling / span);
    const tone = { s, l };
    const hues =
      hueGap(ground.h, accent.h) < 40
        ? [accent.h - 40, accent.h, accent.h + 40]
        : [ground.h, midHue(ground.h, accent.h), accent.h];
    return hues.map((h, i) => ({
      role: ["바탕", "본문", "강조"][i],
      hsl: at(accent, { ...tone, h }),
    }));
  },

  // 정확히 180 을 연다. **씨앗의 관계를 이어받지 않는다** — 배색사전이 `보색` 이라 적은 7쌍의
  // 실제 색상환 간격은 113.8~177.4 도로 180 이 아니다(실측). `보색에 가까움` 1쌍(158.9)을
  // 더해 8쌍으로 봐도 범위는 같다. 이어받으면 이름과 결과가 어긋난다.
  complementary: ({ accent, step }) => [
    { role: "바탕", hsl: step(accent, "light", { k: 0.2 }) },
    { role: "본문", hsl: step(accent, "lower", { k: 0.55 }) },
    { role: "강조", hsl: at(accent, { h: accent.h + 180 }) },
  ],

  // 인접한 각도만. 셋의 최대 간격이 50 이라 "이완" 쪽에 남는다.
  analogous: ({ accent, step }) => [
    { role: "바탕", hsl: step(accent, "light", { h: accent.h - 25, k: 0.3 }) },
    { role: "본문", hsl: step(accent, "lower") },
    { role: "강조", hsl: at(accent, { h: accent.h + 25 }) },
  ],

  // 색상을 끝까지 미루고 명도 네 단계만 확보한다. 디자인 토큰을 짜는 순서 그대로다.
  "value-scale": ({ accent, step }) => {
    // 스케일은 채도를 낮게 묶어야 단계가 명도로만 읽힌다. 앵커 상한보다 더 조인다.
    const base = { ...accent, s: Math.min(accent.s, 0.35) };
    const ground = step(base, "light", { k: 0.5 });
    return [
      { role: "바탕", hsl: ground },
      { role: "면", hsl: step(base, "upper") },
      /*
       * **오늘은 아무것도 안 바꾼다** — 코퍼스 16쌍과 씨앗 풀 24쌍을 합친 40씨앗 × 2모드
       * 80건 전부에서 이미 4.71:1 이상이라 채도를 한 번도 안 뺀다(실측). 그래도 거는 것은
       * **약속이 구조에 붙어 있지 씨앗 목록에 붙어 있지 않기 때문**이다 — 씨앗이 더 늘거나
       * 앵커를 조정하면 여기도 못 닿는 색이 온다. S24-G1 이 40씨앗 전부를 검사한다.
       */
      { role: "본문", hsl: readable(step(base, "lower"), hslToHex(ground)) },
      { role: "강조", hsl: step(base, "dark") },
    ];
  },

  // "나머지를 탁하게 눌러야 하나가 산다." 강조만 씨앗 원본이고 나머지는 채도를 뺀다.
  "accent-by-chroma": ({ ground, accent, step }) => [
    { role: "바탕", hsl: step(ground, "light", { k: 0.2 }) },
    { role: "본문", hsl: step(ground, "lower", { k: 0.3 }) },
    { role: "강조", hsl: accent },
  ],

  // 흰색 대신 따뜻한 뉴트럴. 씨앗 중 난색에 **가까운 쪽**을 골라 그 색상각을 난색 구간으로 민다.
  // 회전량에 상한을 뒀다가 뺐다 — 옥색(175)·라벤더(246) 씨앗에서 40 만 돌리면 135(연두)에 멎어
  // "따뜻한 뉴트럴" 이라는 이름이 거짓말이 됐다(실측). 어느 씨앗을 쓸지만 씨앗이 정한다.
  // 이 구조만 step 을 안 쓰고 앵커를 직접 부른다. 그래서 거울도 직접 태운다.
  "warm-neutral": ({ ground, accent, mode }) => {
    const warmer = hueGap(ground.h, WARM) <= hueGap(accent.h, WARM) ? ground : accent;
    // 뉴트럴은 씨앗 채도를 따라가지 않는다. 따라가면 고채도 씨앗에서 바탕이 살구가 아니라 주황이 된다.
    const neutral = { ...warmer, h: clampToWarm(warmer.h), s: 0.28 };
    return [
      { role: "바탕", hsl: at(neutral, { l: L[anchorFor("light", mode)] }) },
      { role: "본문", hsl: at(neutral, { l: L[anchorFor("dark", mode)], s: 0.22 }) },
      { role: "강조", hsl: accent },
    ];
  },

  // 먼 쪽은 대비·채도를 낮추고 한색으로, 가까운 쪽은 난색으로.
  aerial: ({ accent, step }) => [
    { role: "먼 쪽", hsl: step(accent, "light", { h: rotateToward(accent.h, COOL, 30), k: 0.25 }) },
    { role: "중간", hsl: step(accent, "mid", { k: 0.6 }) },
    { role: "가까운 쪽", hsl: step(accent, "lower", { h: rotateToward(accent.h, WARM, 30) }) },
  ],
};

/**
 * 카탈로그에 있고 파생 규칙도 있는 id 만. 둘 중 하나만 있으면 구조가 아니다.
 *
 * `in` 이 아니라 `Object.hasOwn` 을 쓴다 — `in` 은 프로토타입 체인을 타므로 카탈로그에
 * `toString` 같은 id 가 들어오면 여기서는 유효로 세고 expandSeed 는 null 을 준다.
 * 두 판정이 갈리면 화면에 이름만 뜨고 색이 없는 구조가 생긴다. **두 곳이 같은 판정을 쓴다.**
 */
export const structureIds = () =>
  loadStructures()
    .map((s) => s.id)
    .filter((id) => Object.hasOwn(RULES, String(id)));

const validSeed = (palette) => {
  const colors = palette?.colors;
  if (!Array.isArray(colors) || colors.length !== 2) return null;
  if (!colors.every((c) => typeof c?.hex === "string" && HEX.test(c.hex))) return null;
  return colors;
};

/**
 * 씨앗 하나를 구조 하나로 불린다.
 *
 * **던지지 않는다.** 씨앗이 2색이 아니거나 헥스가 깨졌거나 없는 구조를 물으면 null 이다.
 * 코퍼스 오타 하나가 화면 전체를 내리면 안 된다 — src/bridge.js 가 같은 이유로 같은 선택을 했다.
 *
 * **`mode` 는 명도 방향이다.** 기본값 `"light"` 는 이 함수가 처음부터 내던 것과 **한 글자도
 * 같은 결과**를 낸다 — S15-G1 이 변경 전 기준선과 대조해 그것을 검사한다. `"dark"` 는 명도
 * 앵커를 거울로 뒤집는다. 알 수 없는 값은 밝은 쪽으로 읽는다: 이 함수는 던지지 않는 것이 계약이고,
 * 오타 하나로 화면이 통째로 어두워지는 것보다 기본값으로 도는 편이 낫다.
 *
 * @param {{mode?: "light"|"dark"}} [options]
 * @returns {{id,name,principle,detail,source,mode,colors:[{role,hex}]}|null}
 */
export function expandSeed(palette, structureId, catalog = loadStructures(), options) {
  const colors = validSeed(palette);
  if (!colors) return null;

  const meta = catalog.find((s) => s.id === structureId);
  const rule = Object.hasOwn(RULES, String(structureId)) ? RULES[structureId] : null;
  if (!meta || !rule) return null;

  // `{ mode = "light" } = {}` 로 받지 않는다. 구조 분해 기본값은 undefined 만 막고 **null 은 못 막아**
  // `expandSeed(p, id, cat, null)` 이 던진다 — 이 함수의 계약("던지지 않는다")을 정면으로 깬다.
  // 호출부가 `opts ?? null` 같은 흔한 형태를 쓰면 바로 닿는다. S15-G6 이 이 경로를 검사한다.
  const direction = isDark(options?.mode) ? "dark" : "light";
  const { ground, accent } = splitSeed(colors);
  const derived = rule({
    ground: hexToHsl(ground.hex),
    accent: hexToHsl(accent.hex),
    step: makeStep(direction),
    mode: direction,
  });

  return {
    id: meta.id,
    name: meta.name,
    principle: meta.principle,
    detail: meta.detail,
    source: meta.source,
    mode: direction,
    seed: { id: palette.id ?? null, ground: ground.hex, accent: accent.hex },
    colors: derived.map(({ role, hsl }) => ({ role, hex: hslToHex(hsl) })),
  };
}

/** 씨앗 하나를 카탈로그 전부로 불린다. 무엇을 보여줄지 고르는 것은 이 파일의 일이 아니다. */
export function expandAll(palette, catalog = loadStructures(), options) {
  return catalog.map((s) => expandSeed(palette, s.id, catalog, options)).filter(Boolean);
}
