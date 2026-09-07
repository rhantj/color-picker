// 역할색 하나를 PBR 머티리얼 한 벌로 바꾼다.
//
// **왜 별도 파일인가.** expand.js 는 씨앗을 배색으로 불리고, 이 파일은 그 결과를 물질로 읽는다.
// 방향이 반대다 — expand.js 는 안료의 규칙(채도 상한·명도 앵커)을 지키는 쪽이고, 여기서 하는
// 금속 파생은 그 규칙을 정면으로 거스른다(아래 참조). 한 파일에 두면 어느 규칙이 이기는지가
// 코드에 안 남는다.
//
// **숫자는 전부 여기 있다.** data/finishes.json 에는 문자열만 둔다 — 러프니스를 몇으로 두는지는
// 원전(light.md)에 없고, 원전에 없는 값이 데이터 파일에 앉으면 "원전이 그렇게 말했다" 로 읽힌다.
// data/structures.json ↔ src/expand.js 가 같은 이유로 같은 모양을 하고 있다. S16-G1 이 검사한다.
//
// 근거 등급이 셋으로 갈린다. 섞어 적으면 다음 사람이 무엇을 의심해야 하는지 알 수 없다.
//   [원전]  light.md 가 말하는 것 — 무광은 하이라이트가 번지고 금속은 광원 색을 반사한다
//   [문헌]  언리얼 Physically Based Materials 지침 — base color 범위 50~243 / 180~255.
//           **이 저장소에서 인게임으로 확인하지 않았다.** 유니티에도 같은지 검증되지 않았다
//   [판단]  러프니스 수치 · EV 값 · 기본 배정. 원전에도 문헌에도 없고 내가 정했다.
//           인게임 실측으로 대체할 자리다

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { hexToHsl, hslToHex } from "./expand.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export class MaterialError extends Error {}

/**
 * 비금속 base color 의 채널 범위 `[문헌]`.
 *
 * 아래는 0(검정)도 255(흰색)도 실재하는 표면이 아니라는 뜻이다 — 가장 검은 숯도 빛을 조금은
 * 돌려보내고, 가장 흰 석고도 전부 돌려보내지는 않는다. 이 범위를 벗어난 base color 는
 * 조명을 어떻게 걸어도 물질로 안 보인다.
 */
export const DIELECTRIC_MIN = 50;
export const DIELECTRIC_MAX = 243;

/**
 * 금속 base color 의 하한 `[문헌]`.
 *
 * **금속의 base color 는 안료색이 아니라 반사율(F0)이다.** 금속에는 주광부라 부를 것이 거의
 * 없고 보이는 것이 대부분 반사라, 어두운 금속이라는 물질이 사실상 없다. 씨앗 색을 그대로
 * Metallic=1 로 주면 "어두운 자주색 금속" 같은, 현실에 없는 물질이 나온다.
 *
 * **실측: 코퍼스 32색 중 이 범위에 드는 것은 2개뿐이다**(아이보리 #F5ECC2 · 살구 #FDD4BD).
 * 파생 역할색으로 넓혀도 밝은 모드 28.4% · 어두운 모드 13.4% 다. 그래서 메탈릭은 색을
 * 끌어올리는 파생 없이는 성립하지 않는다.
 */
export const METAL_MIN = 180;
const METAL_MAX = 255;

/**
 * 발광체의 **꺼졌을 때** base color 상한 `[판단]`.
 *
 * 네온관도 표지판도 전원을 끄면 어둡다. base 를 밝게 두면 발광을 껐을 때 밝은 판이 남고,
 * 켰을 때도 발광이 아니라 그냥 밝은 색으로 읽힌다 — **발광은 주변이 어두워야 발광이다.**
 * 하한은 비금속과 같다(`DIELECTRIC_MIN`). 그 아래는 물질이 아니기 때문이다.
 */
export const EMISSIVE_BASE_MAX = 90;

/**
 * 발광색의 채도 이득과 명도 `[판단]`.
 *
 * **여기가 안료 채도 상한이 면제되는 유일한 자리다.** 임의 예외가 아니라 원전이 이미 나눠 놓은
 * 구분이다 — 하이라이트와 발광에 실리는 것은 물체 색이 아니라 광원 색이고, **광원은 안료가 아니다.**
 * `baseColor` 는 어떤 재질에서도 면제되지 않는다(S16-G7 이 그 누수를 막는다).
 *
 * 명도를 0.5 로 두는 것은 **지각 채도가 그 자리에서 최대**이기 때문이다 —
 * `perceivedChroma = (1 - |2l - 1|)·s` 이므로 l=0.5 에서 계수가 1 이 된다.
 *
 * 이득을 곱셈으로 두어 **무채색은 무채색으로 남는다**(s=0 이면 0). 회색 판이 채도 높은 빛을
 * 내뿜는 것은 씨앗에 없는 색을 지어내는 일이다.
 */
const EMISSION_SATURATION_GAIN = 1.6;
const EMISSION_LIGHTNESS = 0.5;

/**
 * 발광 세기 상한(EV) `[판단]`.
 *
 * **채도를 풀어 준 대신 에너지를 묶는다.** 면제만 하고 이 상한을 안 물면 상한이 그냥 사라진
 * 것이고, 11단계에서 `#00ffee`(지각 채도 1.000) 사고를 만든 것이 정확히 그런 빈자리였다.
 * S16-G7(면제가 안 샌다)과 S16-G8(면제한 자리에 상한이 걸린다)이 짝이다.
 *
 * **값에 근거가 없다.** 인게임 블룸 실측으로 대체할 자리다. 그래서 **헐겁지 않게** 잡았다 —
 * 가장 밝은 역할(강조)이 이 값에 딱 붙어 있다. 여유를 두면 상한이 아무것도 안 묶는다.
 */
export const EV_MAX = 4;

/**
 * 역할별 발광 세기 `[판단]`.
 *
 * 역할 이름은 `expand.js` 가 정하고 **씨앗·모드와 무관하게 고정이다**(실측: 드리프트 0건).
 * 위계는 하나뿐이다 — **주목시키려는 자리가 밝고 바탕이 어둡다.** 바탕이 함께 빛나면
 * 대비가 사라져 아무것도 빛나지 않는다.
 */
const EV_BY_ROLE = Object.freeze({
  // **상한을 참조하지 않고 같은 값을 독립적으로 적는다.** 처음엔 `강조: EV_MAX` 로 썼고
  // 뮤테이션이 뚫었다 — 상한을 99 로 올리면 강조도 함께 99 가 되어 "상한에 닿는다" 가
  // 그대로 성립했다. **둘이 함께 움직이면 상한이 아무것도 안 묶는다.**
  // check-stage11 의 MIN_TIER_GAP 을 check-stage15 가 다시 적는 것과 같은 이유다.
  강조: 4,
  "가까운 쪽": 3,
  본문: 2,
  중간: 2,
  면: 1,
  바탕: 0.5,
  "먼 쪽": 0.5,
});

/**
 * 역할별 기본 재질 `[판단]`. **이것이 곧 17단계(LLM 배정)의 폴백이다** — 두 번 만들지 않는다.
 * Ollama 가 없거나 모델이 쓸 수 있는 답을 안 주면 여기로 물러선다.
 *
 * 구조마다 다르게 두지 않고 **역할 이름 하나당 재질 하나**로 둔다. 구조별로 가르면 규칙이
 * 여덟 배로 늘고, 그 여덟 개를 정당화할 근거가 원전에 없다.
 *
 * 위계는 반사의 세기다 — 바탕은 조용하고(무광), 그 위에 얹히는 판은 반사가 있어야 층이 서고
 * (금속), 본문은 읽혀야 하므로 그 중간이며(광택), 강조만 스스로 빛난다.
 * 공기원근은 같은 위계를 거리로 읽는다 — 멀수록 공기가 많아 반사가 흐려진다.
 */
export const DEFAULT_FINISH_BY_ROLE = Object.freeze({
  바탕: "matte",
  면: "metal",
  본문: "gloss",
  강조: "emissive",
  "먼 쪽": "matte",
  중간: "gloss",
  "가까운 쪽": "metal",
});

/**
 * 엔진 칸에 붙여넣을 값이다. 소수 셋째 자리로 맞춰 부동소수 꼬리를 남기지 않는다 — 아래 참조.
 *
 * **왕복이 정확한 것은 입력이 이미 셋째 자리 안일 때뿐이다.** `roughness: 0.1234` 를 넣으면
 * 0.123 으로 돌아온다(리뷰 실측). 지금 `ROUGHNESS` 의 네 값이 전부 셋째 자리 안이라 닿지 않지만,
 * 값을 늘릴 때는 이 정밀도가 계약이라는 것을 알고 늘린다.
 */
const ENGINE_PRECISION = 1000;
const roundEngine = (v) => Math.round(v * ENGINE_PRECISION) / ENGINE_PRECISION;

/**
 * 러프니스 `[판단]`.
 *
 * 원전은 방향만 말한다 — "유리·금속처럼 매끈 → 날카롭게 맺힘 / 천·점토처럼 거칠고 무광 →
 * 거의 안 나타나거나 넓고 흐릿하게 번짐". **몇으로 두라는 말은 없다.**
 *
 * 값은 **언리얼 기준**이다(0 = 거울). 유니티는 Smoothness = 1 − Roughness 로 방향이 반대이고,
 * 그 변환은 16-B 에서 온다. 그때까지 이 값을 유니티 칸에 그대로 붙여넣으면 **정반대 재질**이 된다.
 *
 * 셋의 간격만 근거가 있다 — 무광과 광택이 갈리는 것이 원전의 요지이므로 둘 사이가 가장 멀고,
 * 금속은 광택과 같은 "매끈" 쪽이라 가깝다. 절대값은 실측으로 대체할 자리다.
 */
const ROUGHNESS = Object.freeze({ matte: 0.85, gloss: 0.2, metal: 0.25, emissive: 0.4 });

/** 엔진이 실제로 구현한 재질. 카탈로그와 어긋나면 S16-G10 이 운다. */
export const MATERIAL_FINISHES = Object.freeze(["matte", "gloss", "metal", "emissive"]);

const HEX = /^#[0-9a-fA-F]{6}$/;

const CATALOG_PATH = join(ROOT, "data/finishes.json");

let cached = null;

/**
 * data/finishes.json 을 읽는다. 기본 경로는 **한 번만 읽는다** — 요청마다 다시 읽으면 같은
 * 질의가 파일 수정 순간에 다른 재질을 받는다. server.js 의 fullCatalog 와 같은 자리다(S15-G14).
 *
 * **`expand.js` 의 `loadStructures` 와 같은 모양이다** — 손상된 파일에서 원시 `SyntaxError` 가
 * 아니라 `MaterialError` 를 던진다. 처음엔 `JSON.parse` 를 그냥 불렀고, 리뷰가 잡았다:
 * 이 모듈이 스스로 세운 "불량 입력은 전부 MaterialError" 계약이 `applyFinish` 에만 걸려 있고
 * 여기에는 없었다. **주석은 이미 "StructureError 와 같은 자리다" 라고 말하고 있었다.**
 *
 * 씨앗 풀(`loadSeeds`)이 손상 시 빈 배열로 물러서는 것과는 다르게 **던진다.** 씨앗 풀은 없어도
 * 코퍼스 16쌍이 그대로 도는 선택 사항이지만, 재질 카탈로그가 비면 이 엔진이 할 일이 없다.
 *
 * `path` 인자는 게이트가 픽스처를 물리기 위한 자리다 — `loadSeeds(path)` 가 같은 이유로 같은
 * 모양을 하고 있다. **기본 경로일 때만 캐시한다.** 픽스처를 캐시에 남기면 그다음 게이트가
 * 그것을 진짜 카탈로그로 읽는다.
 */
export function loadFinishes(path = CATALOG_PATH) {
  if (path === CATALOG_PATH && cached) return cached;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new MaterialError(`재질 카탈로그를 읽지 못했다 (${path})`, { cause });
  }
  if (!Array.isArray(parsed?.finishes) || parsed.finishes.length === 0) {
    throw new MaterialError(`재질 카탈로그에 finishes 배열이 없다 (${path})`);
  }

  if (path === CATALOG_PATH) cached = parsed.finishes;
  return parsed.finishes;
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (list) => "#" + list.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 채널 전체를 `[lo, hi]` 안으로 **아핀 사상**해 넣는다. 필요할 때만 움직인다.
 *
 * **왜 채널별 clamp 가 아닌가.** `clamp(c, 50, 243)` 을 채널마다 따로 걸면 색상각이 무너진다 —
 * 흑록 #0f1a14 은 (15,26,20) 이라 세 채널이 전부 50 으로 눌려 **회색**이 된다. 색을 물질로
 * 바꾸려던 것이 색을 없애는 것이 된다.
 *
 * 아핀 사상(`c' = k·c + b`, k > 0)은 채널 간 차이의 비를 그대로 두므로 **색상각이 정확히
 * 보존된다.** HSL 색상각은 (max−min) 에 대한 채널 차의 비로 정해지는데, 분자와 분모가 같은
 * k 로 함께 곱해지기 때문이다. 대신 채도가 k 배로 줄고 명도가 옮겨간다 — 그게 "물질의 범위
 * 안으로 들어온다" 의 실제 내용이다.
 *
 * 이동은 최소로 한다. `newLo` 를 원래 최저값에 가장 가깝게 잡아, 이미 범위 안인 색은
 * **한 채널도 안 움직인다**(S16-G4 가 그것까지 검사한다).
 */
function fitRange(hex, lo, hi) {
  const c = channels(hex);
  const min = Math.min(...c);
  const max = Math.max(...c);

  // **이 줄은 지름길이지 보장이 아니다.** 지워도 결과가 같다 — 이미 범위 안이면 span <= hi-lo
  // 라 k=1 이 되고 newLo 가 min 으로 고정되어 아래 사상이 항등이 된다. 뮤테이션으로 확인했다:
  // 채널 조합 138만 건(그중 범위 안 31만 건)에서 **두 구현의 출력 차이 0건.**
  // 그래서 이것을 지우는 변형은 어떤 게이트도 안 울고, 그게 맞다 — 등가 변형이다.
  // "이미 범위 안인 색을 안 건드린다" 를 실제로 지키는 것은 아래 아핀 사상이고, S16-G4 가 그것을 문다.
  if (min >= lo && max <= hi) return hex.toLowerCase();

  const span = max - min;
  // 창보다 넓으면 좁힌다(채도가 준다). 좁으면 그대로 옮기기만 한다.
  const k = span === 0 ? 1 : Math.min(1, (hi - lo) / span);
  const newLo = clamp(min, lo, hi - k * span);
  return toHex(c.map((v) => newLo + k * (v - min)));
}

const RULES = {
  // 비금속 둘은 base 가 같고 러프니스만 다르다. 원전이 가르는 것이 정확히 그 축이다 —
  // "매끈한가" 만 다르고 고유색은 양쪽 다 그대로 남는다.
  matte: (hex) => ({ baseColor: fitRange(hex, DIELECTRIC_MIN, DIELECTRIC_MAX), metallic: 0 }),
  gloss: (hex) => ({ baseColor: fitRange(hex, DIELECTRIC_MIN, DIELECTRIC_MAX), metallic: 0 }),
  metal: (hex) => ({ baseColor: fitRange(hex, METAL_MIN, METAL_MAX), metallic: 1 }),

  // 발광체의 몸체는 어둡다. 같은 아핀 사상을 **좁고 어두운 창**에 태우는 것뿐이라 색상각이
  // 그대로 남는다. 빛은 base 가 아니라 emission 으로 나간다.
  emissive: (hex, role) => ({
    baseColor: fitRange(hex, DIELECTRIC_MIN, EMISSIVE_BASE_MAX),
    metallic: 0,
    emission: { color: emissionColor(hex), ev: evForRole(role) },
  }),
};

/**
 * 역할색에서 그 자리가 내뿜을 빛의 색을 만든다. 색상각은 그대로, 채도는 올리고, 명도는
 * 지각 채도가 최대가 되는 자리로 옮긴다.
 *
 * **씨앗에 없는 색상각을 지어내지 않는다.** 곱셈 이득이라 무채색은 무채색으로 남는다.
 */
function emissionColor(hex) {
  const { h, s } = hexToHsl(hex);
  return hslToHex({ h, s: Math.min(1, s * EMISSION_SATURATION_GAIN), l: EMISSION_LIGHTNESS });
}

/** EV 가 상한 안인지 확인한다. 면제한 자리에 실제로 걸리는 유일한 빗장이라 밖으로 내보낸다. */
export function assertEv(ev) {
  if (typeof ev !== "number" || !Number.isFinite(ev) || ev < 0 || ev > EV_MAX) {
    throw new MaterialError(`발광 세기가 0~${EV_MAX} 밖이다: ${typeof ev === "number" ? ev : typeof ev}`);
  }
  return ev;
}

/*
 * 엔진 변환의 입력 검증.
 *
 * **이 함수들은 stage 17 과 내보내기가 쓸 공개 API 다.** `applyFinish` 가 만든 것만 들어온다는
 * 보장이 없고, 검증이 없으면 조용히 이상한 값을 뱉는다 — 리뷰가 실측으로 보였다:
 * `roughness: 1.5` 는 `smoothness: -0.5` 가 되고, 문자열 `"0.2"` 는 `1 - "0.2" = 0.8` 로
 * 강제 변환되어 타입이 소리 없이 바뀐다. `applyFinish` 가 "던진다" 를 계약으로 세운 이상
 * 같은 모듈의 다른 출구가 그 계약을 안 지킬 이유가 없다.
 */
const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function assertHex(v, what) {
  if (typeof v !== "string" || !HEX.test(v)) {
    throw new MaterialError(`${what} 가 #rrggbb 형식이 아니다: ${typeof v === "string" ? v : typeof v}`);
  }
}

function assertMetallic(v) {
  if (v !== 0 && v !== 1) throw new MaterialError(`metallic 이 0 도 1 도 아니다: ${typeof v === "number" ? v : typeof v}`);
}

/** 0~1 스칼라. PBR 의 roughness·smoothness 가 사는 구간이고 그 밖은 물질이 아니다. */
function assertUnit(v, what) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new MaterialError(`${what} 가 0~1 밖이다: ${typeof v === "number" ? v : typeof v}`);
  }
}

function assertMaterial(material) {
  if (!isPlainObject(material)) throw new MaterialError(`재질이 객체가 아니다: ${typeof material}`);
  assertHex(material.baseColor, "baseColor");
  assertMetallic(material.metallic);
  assertUnit(material.roughness, "roughness");
  if (material.emission !== null) {
    if (!isPlainObject(material.emission)) throw new MaterialError(`emission 이 객체도 null 도 아니다: ${typeof material.emission}`);
    assertHex(material.emission.color, "emission.color");
    assertEv(material.emission.ev);
  }
}

function evForRole(role) {
  /*
   * `Object.hasOwn` 으로 거른다. `EV_BY_ROLE[role] === undefined` 로 쓰면 프로토타입 이름이
   * 값을 물고 나온다 — `__proto__` 는 객체를, `toString`·`valueOf` 는 함수를 준다(실측).
   *
   * **이 검사를 약하게 만드는 뮤테이션은 살아남는다. 구멍이 아니라 이중 방어다** — `applyFinish`
   * 가 같은 것을 먼저 거르므로 여기까지 오지 않는다. 그래도 남겨 두는 것은, 이 함수가
   * `RULES.emissive` 에서만 불린다는 사실이 언제까지나 참이라는 보장이 없기 때문이다.
   */
  if (typeof role !== "string" || !Object.hasOwn(EV_BY_ROLE, role)) {
    throw new MaterialError(`발광 세기를 모르는 역할이다: ${role}. 아는 것 — ${Object.keys(EV_BY_ROLE).join(", ")}`);
  }
  return assertEv(EV_BY_ROLE[role]);
}

/**
 * 유니티로 옮긴다. **`Smoothness = 1 − Roughness` 로 방향이 반대다.**
 * 그대로 붙여넣으면 의도한 것의 정반대 재질이 나오고, 조용히 틀린다.
 *
 * **반올림이 필수다 `[실측]`.** `1 - (1 - x)` 는 x 로 안 돌아온다 — 0~1 을 0.001 간격으로 재면
 * 1001개 중 **335개**가 어긋나고, 이 파일의 `gloss` 값 0.2 가 바로 그중 하나다
 * (0.19999999999999996). 오차 자체는 5.6e-17 로 무시할 크기지만 **사람이 엔진 칸에 붙여넣을
 * 값**이라 그런 꼬리가 보이면 안 된다. S16-G9 가 정확한 일치를 요구한다.
 */
export function toUnity(material) {
  assertMaterial(material);
  return {
    baseColor: material.baseColor,
    metallic: material.metallic,
    smoothness: roundEngine(1 - material.roughness),
    emissionColor: material.emission ? material.emission.color : null,
    emissionIntensity: material.emission ? material.emission.ev : null,
  };
}

/**
 * 유니티 표기에서 **물리 값**으로 되돌린다. S16-G9 가 왕복이 제자리로 오는 것을 검사한다.
 *
 * **`finish` 는 안 돌려준다.** 재질 이름은 우리 개념이지 엔진 표기에 있는 것이 아니다.
 * 처음엔 `unity.finish ?? null` 로 자리를 채웠고 왕복 게이트가 8000건 전부 실패했다 —
 * **되돌릴 수 없는 것을 되돌릴 수 있는 척한 것**이고, 게이트가 그것을 정확히 잡았다.
 * 왕복이 성립하는 범위는 엔진이 실제로 들고 가는 값까지다.
 */
export function fromUnity(unity) {
  if (!isPlainObject(unity)) throw new MaterialError(`유니티 재질이 객체가 아니다: ${typeof unity}`);
  assertHex(unity.baseColor, "baseColor");
  assertMetallic(unity.metallic);
  assertUnit(unity.smoothness, "smoothness");
  if (unity.emissionColor !== null) {
    assertHex(unity.emissionColor, "emissionColor");
    assertEv(unity.emissionIntensity);
  }
  return {
    baseColor: unity.baseColor,
    metallic: unity.metallic,
    roughness: roundEngine(1 - unity.smoothness),
    emission: unity.emissionColor === null ? null : { color: unity.emissionColor, ev: unity.emissionIntensity },
  };
}

/** 왕복이 성립하는 범위 — 엔진이 실제로 들고 가는 물리 값. 재질 이름은 여기 없다. */
export const enginePayload = (material) => ({
  baseColor: material.baseColor,
  metallic: material.metallic,
  roughness: material.roughness,
  emission: material.emission,
});

/** 언리얼로 옮긴다. 내부 표현이 언리얼 기준이라 **이름만 갈린다** — 값은 안 뒤집힌다. */
export function toUnreal(material) {
  assertMaterial(material);
  return {
    baseColor: material.baseColor,
    metallic: material.metallic,
    roughness: roundEngine(material.roughness),
    emissiveColor: material.emission ? material.emission.color : null,
    emissiveIntensity: material.emission ? material.emission.ev : null,
  };
}

/**
 * 역할색 하나에 재질을 입힌다.
 *
 * @param {string} hex `#rrggbb`. expand.js 가 낸 역할색이다 — 씨앗 색이 아니다.
 * @param {string} finishId `MATERIAL_FINISHES` 중 하나
 * @param {string} role `expand.js` 가 정한 역할 이름. 발광 세기가 여기서 갈린다
 * @returns {{finish: string, baseColor: string, metallic: 0|1, roughness: number,
 *            emission: null | {color: string, ev: number}}}
 *
 * **던진다.** 없는 재질에 기본값을 물려주면 사용자는 자기가 고른 것과 다른 재질의 수치를
 * 붙여넣게 되고, 틀렸다는 신호가 어디에도 남지 않는다. expand.js 의 StructureError 와 같은 자리다.
 *
 * `emission` 은 발광에서만 객체이고 나머지는 null 이다. 자리를 늘 두는 것은 엔진 변환이
 * 이 필드를 보기 때문이다 — 없으면 발광이 조용히 사라진다.
 */
export function applyFinish(hex, finishId, role) {
  if (typeof hex !== "string" || !HEX.test(hex)) {
    throw new MaterialError(`색이 #rrggbb 형식이 아니다: ${typeof hex === "string" ? hex : typeof hex}`);
  }
  // MATERIAL_FINISHES 로 먼저 거른다. RULES 를 바로 조회하면 __proto__ 같은 이름이 걸린다.
  if (typeof finishId !== "string" || !MATERIAL_FINISHES.includes(finishId)) {
    const shown = typeof finishId === "string" ? finishId : typeof finishId;
    throw new MaterialError(`없는 재질이다: ${shown}. 쓸 수 있는 것 — ${MATERIAL_FINISHES.join(", ")}`);
  }
  /*
   * **역할은 발광에만 쓰이지만 모든 재질에서 검사한다.** 통과시키면 오타 난 역할이 무광으로
   * 조용히 지나가다가, 나중에 그 자리를 발광으로 바꾸는 순간 처음으로 터진다.
   *
   * **문자열인지 먼저 본다.** `Object.hasOwn` 은 키를 `ToPropertyKey` 로 강제 변환하므로
   * `{ toString: () => "강조" }` 나 `["강조"]` 가 통과한다(리뷰가 재현). JSDoc 이 `string` 이라고
   * 선언해 놓고 아닌 것을 받으면 그 선언이 거짓말이 된다. hex·finishId 와 같은 모양으로 맞춘다.
   */
  if (typeof role !== "string" || !Object.hasOwn(EV_BY_ROLE, role)) {
    const shown = typeof role === "string" ? role : typeof role;
    throw new MaterialError(`없는 역할이다: ${shown}. 아는 것 — ${Object.keys(EV_BY_ROLE).join(", ")}`);
  }

  const { baseColor, metallic, emission } = RULES[finishId](hex, role);
  return {
    finish: finishId,
    baseColor,
    metallic,
    roughness: ROUGHNESS[finishId],
    emission: emission ?? null,
  };
}
