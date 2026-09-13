// 배색 구조 여덟 중 **이 질의에 맞는 다섯**을 로컬 LLM 이 고른다.
//
// 왜 LLM 인가: 8개 중 어느 다섯이 "가을 카페 브랜딩" 에 맞는지는 계산으로 안 나온다. 색상각도
// 명도도 그 판단을 못 한다 — 질문의 뜻을 읽어야 한다. 이 사이트에서 LLM 이 하는 일은 둘뿐이고
// (질의 재작성, 구조 선택) 둘 다 같은 성격이다.
//
// **LLM 은 색에 닿지 않는다.** 고르는 것은 구조 id 뿐이고 헥스는 src/expand.js 가 씨앗의 HSL 로만
// 만든다. 모델이 무엇을 뱉든 화면에 없는 색이 생기지 않는다 — 사용자가 이 경계를 골랐다.
//
// **없어도 돈다.** Ollama 가 죽어 있거나 응답을 못 알아들으면 카탈로그 앞 다섯으로 물러선다.
// 그 다섯은 원전 1절 기법표 넷과 4절 첫 항목이라 임의로 고른 것이 아니다.

import { refresh } from "./ollama.js";
import { pickModel } from "./rewrite.js";
import { cleanQuery } from "./query.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
// 재작성보다 짧게 잡는다. 재작성은 답을 못 얻으면 검색이 통째로 나빠지지만, 여기서는 물러설
// 자리가 분명하다 — 오래 기다리느니 카탈로그 순서로 그리는 편이 낫다.
const TIMEOUT_MS = Number(process.env.STRUCTURE_TIMEOUT_MS ?? 20000);

/** 화면에 보여줄 구조 수. 사용자가 "가장 많이 쓰는 5개" 로 정했다. */
export const PICK_COUNT = 5;

// **detail 도 함께 넣는다.** principle 은 기법만 말하고 증상 낱말이 없다 — `공기원근` 의 principle 은
// "먼 쪽은 대비·채도를 낮추고…" 라서 `평면`·`깊이` 가 없고, 그 낱말은 detail 에만 있다. 그 결과
// "평면적이고 깊이가 없어 보여요" 에서 공기원근이 통째로 빠졌다. detail 을 넣자 원전이 스스로 말한
// 대응 10건 중 다섯 안 9→10, 1위 7→8 이 됐고 지연은 447→457ms 였다(실측).
export const systemPrompt = (catalog) => `너는 한국어 색 배색 도구의 구조 선택기다.

사용자의 질문을 읽고, 아래 배색 구조 여덟 중 **그 질문에 가장 잘 맞는 다섯**을 고른다.

${catalog.map((s) => `- ${s.id}: ${s.name} — ${s.principle}${s.detail ? ` ${s.detail}` : ""}`).join("\n")}

규칙:
- 정확히 다섯 개를 고른다.
- 위 목록의 id 만 쓴다. 새 id 를 지어내지 않는다.
- 같은 id 를 두 번 쓰지 않는다.
- 가장 잘 맞는 것부터 순서대로 놓는다.
- 설명하지 않는다.

JSON 으로만 답한다: {"ids":["...","...","...","...","..."]}`;

async function callModel(model, catalog, query, signal) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json", // 자유 서술을 막는다. 파싱 실패가 곧 선택 실패이므로 형식을 강제한다.
      options: { temperature: 0.2, num_predict: 120 },
      messages: [
        { role: "system", content: systemPrompt(catalog) },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  return (await res.json()).message?.content ?? "";
}

/**
 * 모델이 뭘 뱉든 여기서 걸러 낸다. **카탈로그에 없는 id 는 버린다** — 통과시키면 화면이
 * 이름 없는 칸을 그리거나 `expandSeed` 가 null 을 내 그 자리가 조용히 빈다.
 *
 * 모자라면 카탈로그 순서로 채운다. 다섯을 못 채웠다고 통째로 버리면, 모델이 셋만 맞혀도
 * 그 판단까지 잃는다 — `parseRewrite` 가 의도만 나와도 살리는 것과 같은 선택이다.
 *
 * **모델이 실제로 몇 개를 보탰는지 함께 돌려준다(`matched`).** 이게 없으면 호출부가 "모델이
 * 쓸 수 있는 걸 하나도 안 줬다" 와 "모델이 다 골랐다" 를 구분하지 못한다. 실제로 구분하지 못해서,
 * 카탈로그에 없는 id 만 받고도 화면이 "LLM 이 골랐습니다" 라고 말한 적이 있다(리뷰 지적, 재현 확인).
 *
 * @returns {{ids: string[], matched: number}} ids 는 정확히 count 개, 전부 실재, 중복 없음
 */
export function parseSelection(raw, validIds, count = PICK_COUNT) {
  const known = new Set(validIds);
  let picked = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.ids)) {
      const seen = new Set();
      for (const id of parsed.ids) {
        if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
        seen.add(id);
        picked.push(id);
        if (picked.length === count) break;
      }
    }
  } catch {
    picked = [];
  }
  return { ids: fillTo(picked, validIds, count), matched: picked.length };
}

/**
 * 요청한 개수를 실제로 채울 수 있는 값으로 조인다.
 *
 * `count` 가 NaN 이면 정지 조건이 늘 거짓이라 카탈로그를 통째로 돌려주고, 음수면 빈 배열이 된다.
 * 카탈로그가 count 보다 짧아도 못 채운다. **지금은 PICK_COUNT 가 상수 5 이고 카탈로그가 8개라
 * 닿지 않지만**, 이건 export 된 함수이고 "모델 출력은 신뢰하지 않는다" 를 id 축에만 적용하고
 * 개수 축에는 안 한 비대칭이었다(리뷰 지적). 채울 수 있는 만큼으로 조인다.
 */
const usableCount = (count, poolSize) => {
  const n = Number.isInteger(count) ? count : PICK_COUNT;
  return Math.max(0, Math.min(n, poolSize));
};

/** 모자란 자리를 카탈로그 순서로 채운다. 이미 고른 것은 건너뛴다. */
function fillTo(picked, validIds, count) {
  const pool = [...new Set(validIds.filter((id) => typeof id === "string" && id !== ""))];
  const want = usableCount(count, pool.length);
  const out = picked.slice(0, want);
  const seen = new Set(out);
  for (const id of pool) {
    if (out.length >= want) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** LLM 없이 고르는 값. 카탈로그 순서 앞에서부터다. */
export const fallbackSelection = (validIds, count = PICK_COUNT) => fillTo([], validIds, count);

/**
 * @param {string} query 사용자의 질문. **비어 있으면 LLM 을 아예 부르지 않는다** —
 *   고를 근거가 없는데 부르면 비용만 쓰고 답을 지어낸다.
 * @param {{id:string,name:string,principle:string}[]} catalog
 * @returns {Promise<{ids:string[], from:"llm"|"fallback", matched?:number, model?:string, elapsedMs?:number, error?:string}>}
 *   **던지지 않는다.** 실패해도 ids 는 항상 count 개다 — 호출부가 갈라질 필요가 없다.
 *
 *   `from` 은 **결과가 실제로 모델에서 나왔을 때만** `"llm"` 이다. 모델이 응답은 했지만 쓸 수 있는
 *   id 를 하나도 안 줬다면 결과는 카탈로그 순서와 똑같으므로 `"fallback"` 이라고 말한다 —
 *   그러지 않으면 화면 배지가 거짓말을 한다.
 */
export async function selectStructures(query, catalog, count = PICK_COUNT) {
  const validIds = catalog.map((s) => s.id);
  const fallback = (error) => ({ ids: fallbackSelection(validIds, count), from: "fallback", ...(error ? { error } : {}) });

  const text = cleanQuery(query);
  if (!text) return fallback(null);

  const state = await refresh();
  if (state.state !== "ready") return fallback(`Ollama 를 쓸 수 없다 (${state.detail})`);

  const model = pickModel(state.models);
  if (!model) return fallback("쓸 수 있는 로컬 모델이 없다");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await callModel(model, catalog, text, controller.signal);
    const { ids, matched } = parseSelection(raw, validIds, count);
    const elapsedMs = Date.now() - started;
    // 모델이 쓸 수 있는 것을 하나도 안 줬으면 결과는 카탈로그 순서와 같다. 그걸 "llm" 이라 부르면
    // 화면이 "질문에 맞춰 골랐다" 고 말하게 된다 — 실제로는 아무것도 고르지 않았다.
    if (matched === 0) {
      return { ...fallback("모델 응답에서 쓸 수 있는 구조가 없었다"), matched: 0, model, elapsedMs };
    }
    return { ids, from: "llm", matched, model, elapsedMs };
  } catch (err) {
    const reason = err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return { ...fallback(reason), model };
  } finally {
    clearTimeout(timer);
  }
}
