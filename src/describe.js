// 캐릭터 외형 문장에서 **부위마다 말해진 색 낱말**과 **인상 한 줄**을 뽑는다.
//
// **LLM 은 색에 닿지 않는다.** 모델이 고르는 것은 색 낱말 id(red·black …)뿐이고, 헥스는 src/color-words.js 가
// 코퍼스에서 찾는다. 모델이 응답에 헥스를 실어 보내도 `parseDescription` 이 버린다 — 재질 배정(finish.js)과 같은 경계.
//
// **없어도 돈다.** Ollama 가 없거나 응답을 못 알아들으면 정규식 폴백 — 색 낱말 바로 뒤에 부위가 오는 것("빨간 머리")만
// 잡고 인상은 문장 전체다. 종족 낱말은 어느 길이든 표를 직접 대조한다(결정적).

import { refresh } from "./ollama.js";
import { pickModel } from "./rewrite.js";
import { cleanQuery } from "./query.js";
import { CHARACTER_ROLES } from "./character.js";
import { findCreature, loadCharacterWords, loadCreatures } from "./color-words.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
// 구조 선택·재질 배정과 같은 값을 독립적으로 적는다. 물러설 자리(정규식)가 분명하다.
const TIMEOUT_MS = Number(process.env.DESCRIBE_TIMEOUT_MS ?? 20000);

/** 인상 한 줄의 상한. 검색 질의로 들어가므로 길면 BM25 가 흐려진다. */
export const IMPRESSION_MAX = 120;

const emptyParts = () => Object.fromEntries(CHARACTER_ROLES.map((r) => [r, null]));

export const systemPrompt = (words) => `너는 한국어 캐릭터 외형 설명을 읽는 파서다.

문장에서 **부위마다 말해진 색**과 **전체 인상 한 줄**을 뽑는다.

부위: ${CHARACTER_ROLES.join(", ")}
색 낱말 id: ${Object.entries(words.colorWords).map(([id, forms]) => `${id}(${forms.slice(0, 3).join("·")})`).join(", ")}

규칙:
- 문장이 그 부위의 색을 말했을 때만 적는다. 안 말한 부위는 null.
- 위 색 낱말 id 만 쓴다. 헥스나 새 이름을 쓰지 않는다. 색은 이 도구가 따로 계산한다.
- impression 은 색 이름을 뺀 분위기·성격·장면을 한 문장(40자 안팎)으로 쓴다.
- 설명하지 않는다.

JSON 으로만 답한다: {"parts":{"피부":null,"머리":"red","눈":null,"상의":"black","하의":null,"강조":null},"impression":"차가운 성격의 기사"}`;

const clipChars = (s, max) => Array.from(s).slice(0, max).join("");

/**
 * 모델이 뭘 뱉든 여기서 걸러 낸다 — 없는 부위 · 없는 색 낱말 · 문자열 아닌 값 · 프로토타입 이름.
 * 인상은 문자열만 받고 비면 **문장 전체**로 물러선다 — 검색이 빈 질의를 받으면 안 된다.
 */
export function parseDescription(raw, words, query) {
  const parts = emptyParts();
  let matched = 0;
  let impression = "";
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const p = parsed.parts;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      for (const role of CHARACTER_ROLES) {
        if (!Object.hasOwn(p, role)) continue;
        const id = p[role];
        if (typeof id !== "string" || !Object.hasOwn(words.colorWords, id)) continue;
        parts[role] = id;
        matched += 1;
      }
    }
    if (typeof parsed.impression === "string") impression = clipChars(parsed.impression.trim(), IMPRESSION_MAX);
  }
  return { parts, impression: impression || query, matched };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byLength = (a, b) => b.length - a.length;

/** 낱말표에서 정규식 둘을 만든다. 표면형은 긴 것부터 — "머리카락" 이 "머리" 보다 먼저 맞아야 한다. */
function buildMatchers(words) {
  const colorForm = new Map();
  for (const [id, forms] of Object.entries(words.colorWords)) for (const f of forms) colorForm.set(f, id);
  const partForm = new Map();
  for (const [role, forms] of Object.entries(words.parts)) for (const f of forms) partForm.set(f, role);
  const colors = [...colorForm.keys()].sort(byLength).map(escapeRe).join("|");
  const parts = [...partForm.keys()].sort(byLength).map(escapeRe).join("|");
  const compounds = Object.keys(words.compounds ?? {}).sort(byLength).map(escapeRe).join("|");
  return {
    colorForm,
    partForm,
    pair: new RegExp(`(${colors})(?:색|빛)?\\s?(${parts})`, "g"),
    compound: compounds ? new RegExp(`(${compounds})`, "g") : null,
  };
}

// 낱말표는 한 번만 읽는다 — 매 요청마다 새 객체를 만들면 아래 matchers 캐시가 한 번도 적중하지 않는다(리뷰 지적).
let cachedWords = null;
const wordsTable = () => (cachedWords ??= loadCharacterWords());

let matchers = null;

/** Ollama 없이 쓰는 파서. 색 낱말 바로 뒤에 부위가 온 것만 잡는다. 먼저 나온 것이 이긴다. */
export function fallbackParse(query, words) {
  if (!matchers || matchers.words !== words) matchers = { words, ...buildMatchers(words) };
  const parts = emptyParts();
  const text = typeof query === "string" ? query : "";
  for (const m of text.matchAll(matchers.pair)) {
    const role = matchers.partForm.get(m[2]);
    const id = matchers.colorForm.get(m[1]);
    if (role && id && parts[role] === null) parts[role] = id;
  }
  if (matchers.compound) {
    for (const m of text.matchAll(matchers.compound)) {
      const c = words.compounds[m[1]];
      if (c && parts[c.part] === null) parts[c.part] = c.color;
    }
  }
  return { parts, impression: text };
}

async function callModel(model, words, query, signal) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.2, num_predict: 200 },
      messages: [
        { role: "system", content: systemPrompt(words) },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  return (await res.json()).message?.content ?? "";
}

/**
 * @param {string} query 캐릭터 외형 문장
 * @returns {Promise<{parts, creature, impression, from: "llm"|"fallback", model?, elapsedMs?, error?}>}
 *   모델·네트워크 실패로는 던지지 않는다. 낱말표·종족표가 깨졌으면 던진다(호출부가 기동 때 알아야 한다).
 */
export async function describe(query) {
  const words = wordsTable();
  const creature = findCreature(query, loadCreatures());
  const text = cleanQuery(query);
  const fallback = (error, extra = {}) => ({ ...fallbackParse(text, words), creature, from: "fallback", ...(error ? { error } : {}), ...extra });
  if (!text) return fallback(null);

  const state = await refresh();
  if (state.state !== "ready") return fallback(`Ollama 를 쓸 수 없다 (${state.detail})`);
  const model = pickModel(state.models);
  if (!model) return fallback("쓸 수 있는 로컬 모델이 없다");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await callModel(model, words, text, controller.signal);
    const { parts, impression, matched } = parseDescription(raw, words, text);
    const elapsedMs = Date.now() - started;
    // 모델이 부위를 하나도 안 줬어도 인상은 썼을 수 있다 — 인상이 문장과 다르면 모델이 일한 것이다.
    if (matched === 0 && impression === text) return fallback("모델 응답에서 쓸 수 있는 것이 없었다", { model, elapsedMs });
    // 폴백 파서가 잡은 것 중 모델이 놓친 부위를 채운다 — "빨간 머리" 는 규칙이 더 확실하다.
    const regex = fallbackParse(text, words).parts;
    for (const role of CHARACTER_ROLES) if (parts[role] === null && regex[role] !== null) parts[role] = regex[role];
    return { parts, creature, impression, from: "llm", model, elapsedMs };
  } catch (err) {
    const reason = err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return fallback(reason, { model });
  } finally {
    clearTimeout(timer);
  }
}
