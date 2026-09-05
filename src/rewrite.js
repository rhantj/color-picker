// 로컬 LLM 한 번 호출로 **의도 분류와 질의 재작성을 함께** 받는다.
//
// 왜 한 번인가: 분류와 재작성을 따로 부르면 호출이 두 배가 되고, 첫 호출의 모델 적재(실측 51초)를
// 두 번 겪는다. 둘 다 같은 문장을 읽고 판단하는 일이라 한 응답에 담을 수 있다.
//
// 왜 의도 분류가 필요한가: 재작성만 붙였을 때 "대시보드가 탁해 보여요" 가 그럴듯한 검색어로 바뀌어
// **틀린 팔레트를 자신 있게** 내놨다. 저신뢰 판정이 오히려 정직했다. 진단 질의는 팔레트 검색으로
// 보내면 안 된다. (근거: docs/session-resume/2026-09-01-stage1-bm25-search.md)

import { refresh, status } from "./ollama.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
// 첫 호출은 모델을 메모리에 올리느라 오래 걸린다. 실측: 콜드 3.9초, 워밍업 후 0.56초.
// (내려받은 직후 최초 1회는 51초까지 갔다 — 그건 디스크에서 처음 읽을 때의 값이다.)
const TIMEOUT_MS = Number(process.env.REWRITE_TIMEOUT_MS ?? 70000);

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

/** 로컬 모델만 고른다. 이름이 :cloud 로 끝나는 것은 원격이라 이 사이트의 전제에 안 맞는다. */
export function pickModel(models) {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  const local = models.filter((m) => !m.endsWith(":cloud"));
  return local.find((m) => m.startsWith("exaone")) ?? local[0] ?? null;
}

async function callModel(model, query, signal) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json", // 자유 서술을 막는다. 파싱 실패가 곧 재작성 실패이므로 형식을 강제한다.
      options: { temperature: 0.2, num_predict: 160 },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  return (await res.json()).message?.content ?? "";
}

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
  if (state.state !== "ready") return { error: `Ollama 를 쓸 수 없다 (${state.detail})` };

  const model = pickModel(state.models);
  if (!model) return { error: "쓸 수 있는 로컬 모델이 없다" };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await callModel(model, query, controller.signal);
    const parsed = parseRewrite(raw);
    if (!parsed) return { error: "모델 응답을 해석하지 못했다", model };
    return { ...parsed, model, elapsedMs: Date.now() - started };
  } catch (err) {
    const reason = err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return { error: reason, model };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 모델을 미리 메모리에 올린다. 실측: 이게 없으면 첫 저신뢰 질의가 3944ms, 있으면 556ms.
 * 결과를 기다리지 않아도 되고, 실패해도 아무것도 깨지지 않는다.
 */
export async function warmUp() {
  const state = status();
  if (state.state !== "ready") return { skipped: "Ollama 가 준비되지 않았다" };
  const model = pickModel(state.models);
  if (!model) return { skipped: "쓸 수 있는 로컬 모델이 없다" };

  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: "30m" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { skipped: `워밍업이 ${res.status}` };
    await res.text();
    return { model, elapsedMs: Date.now() - started };
  } catch (err) {
    return { skipped: err.name === "AbortError" ? "워밍업 시간 초과" : err.message };
  }
}
