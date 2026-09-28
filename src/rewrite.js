// LLM 한 번 호출로 **의도 분류와 질의 재작성을 함께** 받는다. 모델은 Claude API(src/llm.js · 41단계).
//
// 왜 한 번인가: 분류와 재작성을 따로 부르면 호출이 두 배가 된다 — 돈도 시간도 두 배다(Ollama 때는
// 첫 호출의 모델 적재 51초 [실측] 를 두 번 겪었다). 둘 다 같은 문장을 읽고 판단하는 일이라 한 응답에 담을 수 있다.
//
// 왜 의도 분류가 필요한가: 재작성만 붙였을 때 "대시보드가 탁해 보여요" 가 그럴듯한 검색어로 바뀌어
// **틀린 팔레트를 자신 있게** 내놨다. 저신뢰 판정이 오히려 정직했다. 진단 질의는 팔레트 검색으로
// 보내면 안 된다. (근거: docs/session-resume/2026-09-01-stage1-bm25-search.md)

import { LlmError, chatJson, refresh } from "./llm.js";

// Ollama 때는 70초였다 — 모델을 GPU 에 처음 올리는 시간(51초 [실측]) 때문이었다. API 에는 그런 일이 없다.
// 10초는 [판단] 이다. 41단계 측정에서 실제 지연을 보고 다시 정한다.
const TIMEOUT_MS = Number(process.env.REWRITE_TIMEOUT_MS ?? 10000);

const SYSTEM = `너는 한국어 색 배색 검색 시스템의 질의 분류·재작성기다.

먼저 사용자의 질문을 셋 중 하나로 분류한다.
- "palette": 어떤 색 조합을 쓸지 찾는 질문. ("여름 화장품 브랜드에 어울리는 색", "느와르 포스터 색")
- "diagnosis": 이미 만든 것이 이상해서 원인과 처방을 찾는 질문. ("탁해 보여요", "유치해 보여요", "왜 밋밋하죠")
- "other": 둘 다 아닌 질문.

그다음 코퍼스에서 실제로 쓰이는 어휘로 검색어를 만든다.

규칙:
- 검색어는 5~8개.
- 띄어쓰기를 임의로 붙이지 않는다. "톤 비대칭"을 "톤비대칭"으로 쓰지 않는다. "공기 원근"도 마찬가지다.
- 사용자가 쓰지 않은 색 이름을 지어내지 않는다.
- 설명하지 않는다.

JSON 으로만 답한다: {"intent":"palette|diagnosis|other","terms":["...","..."]}`;

/** 구조화 출력 스키마. 모양만 강제한다 — 값의 뜻은 parseRewrite 가 본다. */
export const REWRITE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    intent: { type: "string", enum: ["palette", "diagnosis", "other"] },
    terms: { type: "array", items: { type: "string" } },
  },
  required: ["intent", "terms"],
  additionalProperties: false,
});

const VALID_INTENTS = new Set(["palette", "diagnosis", "other"]);

/** 모델이 뭘 뱉든 여기서 걸러 낸다. 신뢰할 수 없는 출력이므로 형태를 강제한다. */
export function parseRewrite(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const intent = VALID_INTENTS.has(parsed?.intent) ? parsed.intent : null;
  const terms = Array.isArray(parsed?.terms)
    ? parsed.terms
        .filter((t) => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 10)
    : [];
  // 의도만 나와도 값이 있다. 실제로 exaone 이 "other" 를 정확히 맞히면서 terms 에 레시피 설명을
  // 길게 넣은 적이 있는데, terms 를 이유로 통째로 버리면 그 판단까지 잃는다.
  if (!intent) return null;
  return { intent, terms };
}

/**
 * @returns {Promise<{intent: string, terms: string[], model: string, elapsedMs: number} | {error: string}>}
 * 던지지 않는다. 실패는 { error } 로 돌아오고, 호출부는 재작성 없이 계속 간다.
 */
export async function rewrite(query) {
  const state = await refresh();
  if (state.state !== "ready") return { error: `Claude 를 쓸 수 없다 (${state.detail})` };
  const { model } = state;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await chatJson({ system: SYSTEM, user: query, schema: REWRITE_SCHEMA, timeoutMs: TIMEOUT_MS, signal: controller.signal });
    const parsed = parseRewrite(raw);
    if (!parsed) return { error: "모델 응답을 해석하지 못했다", model };
    return { ...parsed, model, elapsedMs: Date.now() - started };
  } catch (err) {
    const reason = err instanceof LlmError && err.kind === "abort" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return { error: reason, model };
  } finally {
    clearTimeout(timer);
  }
}
