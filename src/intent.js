// 문장 → 의도(42단계). Claude 가 문장을 읽어 **낱말표의 칸만** 채운다 — 헥스 칸은 스키마에 없다.
// 색은 src/compose.js 가 계산한다. 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md
//
// llm.js 의 규칙 그대로 — 사용자 문장은 user 자리로만 간다. 던지지 않고 `{ error }` 로 돌려준다.

import { LlmError, chatJson, refresh } from "./llm.js";
import { CONTRASTS, HUES, KINDS, TEMPERATURES, TONES, USAGES, parseIntent } from "./compose.js";

// 재작성(rewrite.js)과 같은 예산 `[판단]`. 41단계 실측으로 Claude 호출 하나가 1.6~2.7초였다.
const TIMEOUT_MS = Number(process.env.INTENT_TIMEOUT_MS ?? 10000);

const HUE_IDS = Object.keys(HUES);
const TONE_IDS = Object.keys(TONES);

const SYSTEM = `너는 한국어 문장을 읽고 색 팔레트의 "의도"만 정하는 해석기다. 헥스 코드나 RGB 를 쓰지 않는다 — 색은 다른 프로그램이 계산한다.

칸:
- kind: 색 조합을 찾는 말이면 "palette". 이미 만든 배색이 이상하다며 원인을 묻는 말("탁해 보여요", "왜 촌스럽죠")이면 "diagnosis". 색과 무관한 말(인사·잡담)이면 "other".
- usage: 웹·앱 화면이면 "ui", 그림·일러스트·배경 그림이면 "illustration", 로고·브랜드·패키지면 "brand", 그 밖은 "general".
- count: 사용자가 말한 색 개수(3~7). 말하지 않았으면 5.
- base.hues: 팔레트의 주된 색상 1~3개. 거의 무채색(회색·흰·검정·베이지 바탕)이면 "neutral".
- base.tone: 주된 색의 톤.
- accent: 사용자가 "포인트·강조·튀는 색" 을 말했거나 장면에 분명히 튀는 색이 있으면 {hue, tone}. 없으면 null.
- temperature: 따뜻한 인상이면 "warm", 차가운 인상이면 "cool", 아니면 "neutral".
- contrast: 차분하고 은은하면 "low", 또렷하고 강렬하면 "high", 아니면 "medium".
- avoid: 사용자가 빼 달라고 한 색상. 없으면 [].
- reading: 문장을 어떻게 읽었는지 한국어 한 줄(40자 안팎). 사용자에게 그대로 보인다. 색 코드를 쓰지 않는다.

색상 낱말: red 빨강 · orange 주황 · yellow 노랑 · yellow-green 연두 · green 초록 · teal 청록 · cyan 하늘 · blue 파랑 · indigo 남색 · purple 보라 · magenta 자홍 · pink 분홍 · neutral 무채색.
갈색·베이지·카키 같은 색은 색상과 톤으로 나눠 쓴다 — 갈색은 orange + dark·deep·dull, 베이지는 orange + light-grayish·pale, 카키는 yellow-green + dull·grayish, 네이비는 indigo + dark.

톤(PCCS): vivid 선명한 · strong 강한 · bright 밝은 · light 연한 · pale 아주 연한 · soft 부드러운 · dull 탁한 · deep 짙은 · dark 어두운 · light-grayish 밝은 회색빛 · grayish 회색빛 · dark-grayish 어두운 회색빛.

사용자가 말하지 않은 것은 문장의 분위기에서 고르되, 사용자가 말한 것(색 개수·뺄 색·포인트 색)은 그대로 따른다.`;

/** 구조화 출력 스키마. 모양만 강제한다 — 값의 뜻(범위·겹침·뺄 색과의 충돌)은 parseIntent 가 본다. */
export const INTENT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    kind: { type: "string", enum: [...KINDS] },
    usage: { type: "string", enum: Object.keys(USAGES) },
    count: { type: "integer" },
    base: {
      type: "object",
      properties: {
        hues: { type: "array", items: { type: "string", enum: HUE_IDS } },
        tone: { type: "string", enum: TONE_IDS },
      },
      required: ["hues", "tone"],
      additionalProperties: false,
    },
    accent: {
      anyOf: [
        {
          type: "object",
          properties: { hue: { type: "string", enum: HUE_IDS }, tone: { type: "string", enum: TONE_IDS } },
          required: ["hue", "tone"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    temperature: { type: "string", enum: Object.keys(TEMPERATURES) },
    contrast: { type: "string", enum: Object.keys(CONTRASTS) },
    avoid: { type: "array", items: { type: "string", enum: HUE_IDS } },
    reading: { type: "string" },
  },
  required: ["kind", "usage", "count", "base", "accent", "temperature", "contrast", "avoid", "reading"],
  additionalProperties: false,
});

/**
 * @returns {Promise<{intent: object, model: string, elapsedMs: number} | {error: string, model?: string}>}
 * 던지지 않는다.
 */
export async function readIntent(text) {
  const state = await refresh();
  if (state.state !== "ready") return { error: `Claude 를 쓸 수 없다 (${state.detail})` };
  const { model } = state;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await chatJson({ system: SYSTEM, user: text, schema: INTENT_SCHEMA, timeoutMs: TIMEOUT_MS, signal: controller.signal });
    const intent = parseIntent(raw);
    if (!intent) return { error: "모델 응답을 해석하지 못했다", model };
    return { intent, model, elapsedMs: Date.now() - started };
  } catch (err) {
    const reason = err instanceof LlmError && err.kind === "abort" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return { error: reason, model };
  } finally {
    clearTimeout(timer);
  }
}
