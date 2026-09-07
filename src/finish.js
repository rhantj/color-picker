// 역할마다 어떤 재질을 입힐지 **로컬 LLM 이 정한다.**
//
// 왜 LLM 인가: "네온 사인 빛의 어두운 사이버펑크" 의 강조가 발광이어야 하고 "가을 카페 브랜딩"
// 의 강조는 그러면 안 된다는 것은 계산으로 안 나온다. 색상각도 명도도 그 판단을 못 한다 —
// 질문의 뜻을 읽어야 한다. 이 사이트에서 LLM 이 하는 일은 셋뿐이고(질의 재작성, 구조 선택,
// 재질 배정) 전부 같은 성격이다.
//
// **LLM 은 색에 닿지 않는다.** 고르는 것은 재질 id 뿐이고 헥스는 전부 `src/material.js` 가
// 씨앗 색을 받아 계산한다. 모델이 응답에 헥스를 실어 보내도 그 값이 화면에 닿는 경로가 없다 —
// S17-G7 이 실제로 주입을 시도해 확인한다. `structure.js` 와 같은 경계이고, 사용자가 골랐다.
//
// **없어도 돈다.** Ollama 가 죽어 있거나 응답을 못 알아들으면 `DEFAULT_FINISH_BY_ROLE` 로
// 물러선다. 그 표는 16단계가 이미 만든 것이고 **두 번 만들지 않는다**(스펙 4.5).

import { refresh } from "./ollama.js";
import { pickModel } from "./rewrite.js";
import { DEFAULT_FINISH_BY_ROLE, MATERIAL_FINISHES, MaterialError, loadFinishes } from "./material.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
// 구조 선택과 같은 값을 독립적으로 적는다. 한쪽에서 읽어 오면 그쪽을 늘렸을 때 이쪽도 함께
// 늘어나 "재질 때문에 느려졌다" 를 아무도 못 가른다. 물러설 자리가 분명하다는 점도 같다.
const TIMEOUT_MS = Number(process.env.FINISH_TIMEOUT_MS ?? 20000);

/**
 * 프롬프트. **재질의 `detail` 까지 넣는다.**
 *
 * `principle` 은 기법만 말한다 — `metal` 의 principle 에는 "젖은", "네온관" 같은 낱말이 없고
 * 그것들은 `detail` 에만 있다. 14단계에서 구조 카탈로그의 `detail` 을 떨어뜨렸다가 프롬프트의
 * 그 자리가 늘 빈 문자열이라 개선이 통째로 무효였던 사고가 있었다(S14-G9 가 그것을 검사한다).
 * 같은 자리에 같은 것을 넣고 S17-G6 이 검사한다.
 */
export const systemPrompt = (roles, catalog) => `너는 한국어 색 배색 도구의 재질 배정기다.

사용자의 질문을 읽고, **역할마다** 아래 재질 중 하나를 고른다.

${catalog.map((f) => `- ${f.id}: ${f.name} — ${f.principle}${f.detail ? ` ${f.detail}` : ""}`).join("\n")}

역할은 이것들이다: ${roles.join(", ")}

규칙:
- 역할마다 정확히 하나를 고른다.
- 위 목록의 재질 id 만 쓴다. 새 id 를 지어내지 않는다.
- 색을 고르지 않는다. 헥스를 쓰지 않는다. 색은 이 도구가 따로 계산한다.
- 발광(emissive)은 좁은 면적에만 준다. 전부 빛나면 아무것도 빛나지 않는다.
- 설명하지 않는다.

JSON 으로만 답한다: {"assignments":{"역할":"재질id", ...}}`;

/** 역할 이름이 기본 배정 표에 있는가. 없는 역할은 호출부의 잘못이므로 던진다. */
function assertRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new MaterialError(`역할 목록이 비었다: ${Array.isArray(roles) ? "빈 배열" : typeof roles}`);
  }
  for (const role of roles) {
    if (typeof role !== "string" || !Object.hasOwn(DEFAULT_FINISH_BY_ROLE, role)) {
      const shown = typeof role === "string" ? role : typeof role;
      throw new MaterialError(`없는 역할이다: ${shown}. 아는 것 — ${Object.keys(DEFAULT_FINISH_BY_ROLE).join(", ")}`);
    }
  }
}

/**
 * LLM 없이 배정하는 값. **16단계의 `DEFAULT_FINISH_BY_ROLE` 을 그대로 쓴다** — 스펙 4.5 가
 * "이 표가 곧 LLM 배정의 폴백" 이라고 정했고, 두 벌을 두면 둘이 갈라진다.
 *
 * **던진다.** 없는 역할에 아무거나 물려주면 그 자리가 조용히 다른 재질로 칠해지고,
 * 틀렸다는 신호가 어디에도 남지 않는다.
 */
export function fallbackAssignment(roles) {
  assertRoles(roles);
  return Object.fromEntries(roles.map((role) => [role, DEFAULT_FINISH_BY_ROLE[role]]));
}

/**
 * 모델이 뭘 뱉든 여기서 걸러 낸다.
 *
 * 버리는 것 넷 — 목록에 없는 역할 · 없는 재질 · 문자열이 아닌 값 · 프로토타입 이름.
 * 통과시키면 화면이 이름 없는 재질을 그리거나 `applyFinish` 가 던진다.
 *
 * **빠진 자리는 기본 배정으로 채운다.** 모델이 셋만 맞혔다고 통째로 버리면 그 판단까지 잃는다 —
 * `parseSelection` 이 모자란 자리를 카탈로그 순서로 채우는 것과 같은 선택이다.
 *
 * **모델이 실제로 몇 자리를 채웠는지 함께 돌려준다(`matched`).** 이게 없으면 호출부가
 * "모델이 쓸 수 있는 걸 하나도 안 줬다" 와 "모델이 다 골랐다" 를 구분하지 못한다.
 * 14단계에서 정확히 그것을 구분 못 해 화면이 거짓 배지를 단 적이 있다.
 *
 * @returns {{assignments: Record<string,string>, matched: number}}
 *   assignments 는 `roles` 전부를 키로 갖고 값은 전부 실재하는 재질이다.
 */
export function parseAssignment(raw, roles, validFinishes = MATERIAL_FINISHES) {
  assertRoles(roles);
  const known = new Set(validFinishes);
  const wanted = new Set(roles);

  /*
   * 프로토타입 없는 객체로 모은다. 모델이 `__proto__` 를 키로 주는 경로를 아예 없앤다 —
   * 객체 리터럴이라면 `picked["__proto__"] = "matte"` 가 **own 속성이 아니라 프로토타입 대입**이
   * 되어 조용히 사라진다(실측).
   *
   * **이것을 리터럴로 바꾸는 변형은 게이트가 안 잡는다. 구멍이 아니라 이중 방어다** —
   * 아래 `wanted` 필터가 `__proto__` 를 먼저 거른다(역할 이름은 한국어 낱말뿐이다).
   * 그래도 남겨 두는 것은, `roles` 가 언제까지나 한국어 낱말이라는 보장이 없기 때문이다.
   */
  const picked = Object.create(null);
  let matched = 0;

  try {
    const parsed = JSON.parse(raw);
    const table = parsed?.assignments;
    /*
     * 배열도 `typeof "object"` 다. 배열이면 역할 이름 자리에 `"0"`·`"1"` 이 오므로 볼 것이 없다.
     * **이 배제를 지우는 변형도, 아래 `typeof id` 검사를 지우는 변형도 게이트가 안 잡는다.
     * 둘 다 등가이기 때문이다** — 숫자 인덱스는 `wanted` 에 없고, 비문자열은 `known`(Set)에
     * 애초에 들어갈 수 없다(실측: `new Set(["matte"]).has(3) === false`).
     * 남겨 두는 것은 의도를 코드에 적어 두기 위해서다.
     */
    if (table && typeof table === "object" && !Array.isArray(table)) {
      for (const [role, id] of Object.entries(table)) {
        if (!wanted.has(role) || Object.hasOwn(picked, role)) continue;
        if (typeof id !== "string" || !known.has(id)) continue;
        picked[role] = id;
        matched += 1;
      }
    }
  } catch {
    // 파싱 실패는 "아무것도 못 골랐다" 와 같다. 아래에서 전부 기본 배정으로 채워진다.
  }

  const base = fallbackAssignment(roles);
  return { assignments: { ...base, ...picked }, matched };
}

/**
 * 결과 객체의 **닫힌 모양**. 여기 없는 키는 밖으로 안 나간다.
 *
 * **모델 원문이 결과에 실릴 경로를 구조적으로 없앤다.** 리뷰가 실측으로 보였다 —
 * 반환에 `debugHex` 같은 필드 하나를 더해 모델 응답의 헥스를 실어도 게이트 여덟이 전부
 * 통과했다. `assignments` 는 깨끗한데 **반환 객체 전체가 깨끗하다는 보장이 없었다.**
 *
 * 17-B 가 이 객체를 `/api/expand` 응답에 얹는다. 그때 이 경계가 뚫려 있으면 "LLM 은 색에
 * 닿지 않는다" 는 이 저장소가 스스로 "가장 중요한 경계" 라고 적은 약속이 조용히 깨진다.
 * **필드를 늘리려면 이 목록을 먼저 늘려야 한다** — 그 마찰이 목적이다. S17-G7 이 검사한다.
 */
const RESULT_KEYS = Object.freeze(["assignments", "from", "matched", "model", "elapsedMs", "error"]);

const result = (fields) => {
  const out = {};
  for (const key of RESULT_KEYS) if (fields[key] !== undefined) out[key] = fields[key];
  return out;
};

async function callModel(model, roles, catalog, query, signal) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json", // 자유 서술을 막는다. 파싱 실패가 곧 배정 실패이므로 형식을 강제한다.
      options: { temperature: 0.2, num_predict: 160 },
      messages: [
        { role: "system", content: systemPrompt(roles, catalog) },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  return (await res.json()).message?.content ?? "";
}

/**
 * @param {string} query 사용자의 질문. **비어 있으면 LLM 을 아예 부르지 않는다** —
 *   고를 근거가 없는데 부르면 비용만 쓰고 답을 지어낸다.
 * @param {string[]} roles 이 결과에 실제로 나오는 역할 이름들
 * @returns {Promise<{assignments: Record<string,string>, from: "llm"|"fallback",
 *   matched: number, model?: string, elapsedMs?: number, error?: string}>}
 *
 *   **모델·네트워크 실패로는 던지지 않는다.** `assignments` 는 언제나 `roles` 전부를 채운
 *   완전한 표다 — 호출부가 갈라질 필요가 없다. `roles` 자체가 잘못되면 던진다(호출부 잘못이다).
 *
 *   `from` 은 **결과가 실제로 모델에서 나왔을 때만** `"llm"` 이다. 모델이 응답은 했지만 쓸 수
 *   있는 배정을 하나도 안 줬다면 결과가 기본 배정과 똑같으므로 `"fallback"` 이라고 말한다 —
 *   그러지 않으면 화면 배지가 거짓말을 한다.
 */
export async function selectFinishes(query, roles) {
  assertRoles(roles);
  const fallback = (error, extra = {}) =>
    result({
      assignments: fallbackAssignment(roles),
      from: "fallback",
      matched: 0,
      ...(error ? { error } : {}),
      ...extra,
    });

  const text = typeof query === "string" ? query.trim() : "";
  if (!text) return fallback(null);

  const state = await refresh();
  if (state.state !== "ready") return fallback(`Ollama 를 쓸 수 없다 (${state.detail})`);

  const model = pickModel(state.models);
  if (!model) return fallback("쓸 수 있는 로컬 모델이 없다");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await callModel(model, roles, loadFinishes(), text, controller.signal);
    const { assignments, matched } = parseAssignment(raw, roles);
    const elapsedMs = Date.now() - started;
    // 모델이 쓸 수 있는 것을 하나도 안 줬으면 결과는 기본 배정과 같다. 그걸 "llm" 이라 부르면
    // 화면이 "질문에 맞춰 배정했다" 고 말하게 된다 — 실제로는 아무것도 배정하지 않았다.
    if (matched === 0) {
      return fallback("모델 응답에서 쓸 수 있는 배정이 없었다", { model, elapsedMs });
    }
    return result({ assignments, from: "llm", matched, model, elapsedMs });
  } catch (err) {
    const reason = err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return fallback(reason, { model });
  } finally {
    clearTimeout(timer);
  }
}
