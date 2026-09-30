// 대화 모델 — Claude API 를 이 파일 한 곳에서 부른다(41단계).
//
// 네 호출부(질의 재작성 rewrite.js · 설명 읽기 describe.js · 구조 선택 structure.js · 재질 배정 finish.js)가
// 전부 여기를 거친다. 40단계까지는 넷이 각자 Ollama `/api/chat` 을 불렀다 — 부르는 법이 네 벌이면
// 모델을 바꿀 때 네 곳을 고치고 한 곳을 놓친다.
//
// 규칙 셋.
//   1. 여기는 **던진다.** 물러설 자리(정규식 · 카탈로그 순서 · 기본 배정)는 호출부마다 다르고, 그걸 아는 것도 호출부다.
//      호출부는 지금처럼 `{ error }` 로 바꿔 돌려주고 절대 던지지 않는다.
//   2. 키가 없으면 부르지 않는다. 상태가 `unavailable` 이고 사이트는 1단계(전문 검색)로 돈다.
//   3. 사용자 입력은 `messages` 의 user 자리로만 간다. 시스템 프롬프트에 섞지 않는다.
//
// 한 번 튄 429·5xx 로 상태를 `unavailable` 로 내리지 않는다. Ollama 때는 "프로세스가 죽었다" 가 상태였지만
// API 는 한 호출의 실패가 다음 호출의 실패를 뜻하지 않는다. 그 호출만 폴백한다.

import Anthropic from "@anthropic-ai/sdk";

import { take } from "./quota.js";

/** 짧은 JSON 을 뱉는 일이라 가장 빠르고 싼 모델로 충분하다(대표 결정 2026-09-29 — 크레딧을 다 쓸 때까지 쓴다, 09-30). */
export const LLM_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

/**
 * 답 길이 상한. Ollama 때는 120~200 이었다. 한국어 JSON 이 잘리면 파싱 실패가 곧 기능 실패라 넉넉히 둔다 —
 * 짧게 끝나면 쓴 만큼만 낸다.
 */
export const LLM_MAX_TOKENS = 512;

/**
 * 재시도 횟수. SDK 기본은 2 인데, 호출부의 시간 예산(10초) 안에서 세 번 기다리면 예산을 넘는다.
 * 429·5xx·연결 끊김에 한 번만 다시 해 본다. 게이트는 0 으로 둔다 — 가짜 서버의 호출 수를 세기 때문이다.
 */
const MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 1);

const apiKey = () => process.env.ANTHROPIC_API_KEY ?? "";

export class LlmError extends Error {
  /** @param {string} message @param {{ kind?: "abort"|"status"|"connection"|"refusal"|"empty"|"limited", status?: number }} [info] */
  constructor(message, info = {}) {
    super(message);
    this.name = info.kind === "abort" ? "AbortError" : "LlmError";
    this.kind = info.kind ?? "status";
    if (info.status) this.status = info.status;
  }
}

let client = null;
let clientKey = null;
// 키가 바뀌면 새로 만든다 — 게이트가 한 프로세스 안에서 키를 바꿔 끼운다.
function getClient() {
  const key = apiKey();
  if (!client || clientKey !== key) {
    // baseURL 은 SDK 가 ANTHROPIC_BASE_URL 에서 읽는다 — 게이트는 그걸로 가짜 서버를 끼운다.
    client = new Anthropic({ apiKey: key, maxRetries: MAX_RETRIES });
    clientKey = key;
  }
  return client;
}

/**
 * @returns {{state: "ready"|"unavailable", detail: string, model: string}}
 * 네트워크를 안 탄다. 키가 있는지만 본다 — 키가 틀렸는지는 실제 호출이 알려 준다.
 */
export function status() {
  return apiKey()
    ? { state: "ready", detail: `Claude API · ${LLM_MODEL}`, model: LLM_MODEL }
    : { state: "unavailable", detail: "ANTHROPIC_API_KEY 가 없다", model: LLM_MODEL };
}

/** Ollama 시절의 `refresh()` 자리. 이제 확인할 프로세스가 없어 status() 와 같다. */
export async function refresh() {
  return status();
}

/**
 * 시스템 프롬프트 + 사용자 문장 한 번으로 **JSON 문자열**을 받는다.
 *
 * JSON 모양은 구조화 출력(`output_config.format`)으로 강제한다 — Ollama 의 `format: "json"` 자리다.
 * 스키마는 모양만 보장한다. "허용된 id 인가" 같은 뜻은 호출부의 파서(parseRewrite 등)가 계속 본다.
 *
 * @param {{ system: string, user: string, schema: object, timeoutMs: number, signal?: AbortSignal }} req
 * @returns {Promise<string>} 모델이 쓴 JSON 원문
 * @throws {LlmError}
 */
export async function chatJson({ system, user, schema, timeoutMs, signal }) {
  // 방문자 한 명이 비용을 태우지 못하게(quota.js). 넘으면 호출부가 모델 없이 물러선다.
  if (!take()) throw new LlmError("요청이 너무 많다 — 잠시 뒤에 다시", { kind: "limited" });
  let res;
  try {
    res = await getClient().messages.create(
      {
        model: LLM_MODEL,
        max_tokens: LLM_MAX_TOKENS,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema } },
      },
      { timeout: timeoutMs, signal },
    );
  } catch (err) {
    throw toLlmError(err, signal);
  }
  if (res.stop_reason === "refusal") throw new LlmError("Claude 가 답을 거절했다", { kind: "refusal" });
  const text = (res.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text) throw new LlmError("Claude 응답이 비었다", { kind: "empty" });
  return text;
}

/** SDK 오류를 호출부가 읽는 말로 바꾼다. 사유 문구는 루프백 밖에서 server.js 가 숨긴다. */
function toLlmError(err, signal) {
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) {
    return new LlmError("시간 안에 응답하지 않았다", { kind: "abort" });
  }
  // TypeScript SDK 에서 연결 오류는 APIError 의 하위 클래스다 — 먼저 거른다.
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("시간 안에 응답하지 않았다", { kind: "abort" });
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("Claude API 에 닿지 못했다", { kind: "connection" });
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("Claude API 키가 거절됐다 (401)", { status: 401 });
  if (err instanceof Anthropic.RateLimitError) return new LlmError("Claude API 가 요청이 너무 많다고 했다 (429)", { status: 429 });
  if (err instanceof Anthropic.APIError) return new LlmError(`Claude API 가 ${err.status ?? "?"}`, { status: err.status });
  return new LlmError(err?.message ?? String(err));
}
