// 되묻기 상태 기계. 39단계. 손으로 쓴 표 하나다 — 설계 문서 3절의 표를 코드로 옮겼다.
//
//   pending 없음 + 문장      → 라우터. 하나면 답. 겹침·불명이면 되묻고 pending 을 남긴다
//   pending 없음 + 바로잡기  → 직전 답의 원문을 지정 경로로 다시 답한다
//   pending 있음 + 칩        → 원문을 그 경로로 답한다. pending 을 지운다
//   pending 있음 + 문장      → 원문에 이어 붙여 라우터. 또 애매해도 **다시 안 묻고** 첫 후보(겹침)·추천(불명)으로 답한다
//   턴 10개                  → 새 대화
//
// 색·헥스는 여기서 안 만든다. 처리기(handlers)가 내는 것을 그대로 payload 로 싣는다.

import { cleanQuery } from "./query.js";
import { ROUTES } from "./route.js";

/**
 * 사용자 입력 자체가 잘못된 경우. server.js 가 이것만 400 으로 내려보내고(원문 메시지 그대로),
 * 그 밖의 예외(검색·LLM·파일 쓰기 실패 등 내부 사정)는 failSafely 로 넘겨 응답에 내부 경로를 안 싣는다(리뷰 1차).
 */
export class ChatInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChatInputError";
  }
}

const CHOICE_LABEL = Object.freeze({ palette: "분위기로 색 찾기", diagnosis: "고칠 원인 보기", character: "캐릭터 색 짜기", color: "색 코드로 찾기" });

const QUESTION = Object.freeze({
  ambiguous: "두 가지로 읽혀요. 어느 쪽으로 할까요?",
  unclearPalette: "무엇을 찾으시는지 못 잡았어요. 어느 쪽인가요?",
  unclearCharacter: "머리색이나 옷 색 하나만 더 알려 주시면 캐릭터 색을 짤 수 있어요.",
});

const askTurn = (reason, choices, question) => ({ kind: "ask", reason, question, choices: choices.map((id) => ({ id, label: CHOICE_LABEL[id] })), allowFreeText: true });

/** 답한 턴을 내역에 남길 요약. app.js 가 하던 것을 서버로 옮겼다. */
function summarize(route, payload) {
  if (route === "color") return { stage: 1, usedLlm: false, confident: true, topKind: "color", topId: payload.partners[0]?.pairId ?? null, topLabel: payload.partners[0]?.pairName ?? null };
  if (route === "character") return { stage: 1, usedLlm: payload.parse.from === "llm", confident: payload.palette.from === "search", topKind: "character", topId: payload.palette.id, topLabel: payload.palette.name };
  const top = payload.route === "diagnosis" ? payload.diagnostics[0] : payload.results[0];
  return { stage: payload.stage, usedLlm: payload.usedLlm === true, confident: payload.confident === true, topKind: top ? payload.route : null, topId: top?.id ?? null, topLabel: top ? (top.name ?? top.symptom) : null };
}

/** 검색이 끝까지 저신뢰이고 모델도 "other" 이거나 없으면 정보 부족이다. */
const searchUnclear = (payload) => payload.confident !== true && (payload.rewrite == null || payload.rewrite.intent === "other");

export function createChat({ router, handlers, trace, store, limit }) {
  /** 경로 하나로 실제 답을 만든다. color 인데 색이 아니면 추천으로 내려간다. */
  async function answer(route, query, span) {
    if (route === "color") {
      const body = await handlers.color(query);
      if (body) {
        span.child("color", { query }).end({ input: body.input?.hex ?? null, partners: body.partners.length });
        return { route: "color", payload: body };
      }
      route = "palette";
    }
    if (route === "character") {
      const body = await handlers.character(query);
      span.child("character", { query }).end({ parts: body.parse.parts, palette: body.palette.id, from: body.parse.from });
      if (body.parse.from === "llm") span.child("llm.character", { query, model: body.parse.model }).end({ parts: body.parse.parts, impression: body.parse.impression });
      return { route: "character", payload: body };
    }
    const body = await handlers.search(query);
    span.child("search", { query }).end({ stage: body.stage, route: body.route, confident: body.confident, topId: body.route === "diagnosis" ? body.diagnostics[0]?.id : body.results[0]?.id });
    if (body.rewrite) span.child("llm.rewrite", { query, model: body.rewrite.model }).end({ intent: body.rewrite.intent, terms: body.rewrite.terms });
    return { route: ROUTES.includes(body.route) ? body.route : "palette", payload: body };
  }

  async function step(input) {
    const text = cleanQuery(input?.text);
    const choice = ROUTES.includes(input?.choice) ? input.choice : null;
    if (!text && !choice) throw new ChatInputError("text 나 choice 가 있어야 한다");
    if (text.length > limit.queryChars) throw new ChatInputError(`text 는 ${limit.queryChars}자까지`);

    let conversation = store.findConversation(input?.conversationId);
    // 사용자 턴 10개가 찼으면 새 대화. 옛 대화는 손대지 않는다.
    if (conversation && conversation.turns.length >= limit.turnsPerConversation) conversation = null;
    const conversationId = conversation?.id ?? null;
    const pending = conversation?.pending ?? null;

    // 칩(choice)은 되물은 질문에 대한 답이다. 되물은 것이 없는데 칩만 오면(10턴 롤오버로 pending 이
    // 사라진 경우 포함) router.route("") 를 부르는 대신 여기서 바로 400 이다(리뷰 1차 · 항목 3).
    if (choice && !pending) {
      throw new ChatInputError("되물은 질문이 없다 — 문장으로 다시 물어 주세요");
    }

    const span = trace.begin("chat.turn", { text, choice, conversationId, pending: pending ? { original: pending.original, reason: pending.reason } : null });
    try {
      // record 의 세 번째 인자가 실제로 store 에 남길 query 다 — 늘 text 인 것은 아니다.
      // 답한 턴은 실제로 답한 원문(pending.original·이어붙인 문장·직전 턴의 query)을 남긴다.
      // 안 남기면 되돌리기 경로가 그 자리에서 "[캐릭터]" 같은 라벨 문자열을 다시 검색하게 된다(리뷰 1차 · 항목 2).
      const record = async (turn, fields, recordedQuery) => {
        const saved = await store.recordTurn({ conversationId, query: recordedQuery ?? text, ...fields });
        span.end({ kind: turn.kind, route: turn.route ?? null, reason: turn.reason ?? null, conversationId: saved.conversationId });
        return { conversationId: saved.conversationId, turn };
      };
      const answerAndRecord = async (route, query, routeTrace) => {
        const { route: finalRoute, payload } = await answer(route, query, span);
        const turn = { kind: "answer", route: finalRoute, original: query, payload, trace: routeTrace };
        return record(turn, { kind: "answer", route: finalRoute, pending: null, ...summarize(finalRoute, payload) }, query);
      };

      // ── pending 있음 ──
      if (pending) {
        if (choice) {
          const routeTrace = { routes: [choice], signals: null, redirect: false };
          span.child("route", { text, choice, pending: true }).end({ ...routeTrace, resolvedBy: "choice" });
          return answerAndRecord(choice, pending.original, routeTrace);
        }
        const combined = `${pending.original} ${text}`;
        const r = router.route(combined);
        const routes = r.kind === "redirect" ? [r.route] : r.routes;
        const routeTrace = { routes, signals: r.kind === "route" ? (r.signals ?? null) : null, redirect: r.kind === "redirect" };
        span.child("route", { text: combined, pending: true }).end({ ...routeTrace, resolvedBy: "text" });
        // 두 번째는 안 묻는다. 겹침이면 첫 후보, 불명이면 추천.
        const route = r.kind === "route" && r.unclear ? "palette" : routes[0];
        return answerAndRecord(route, combined, routeTrace);
      }

      // ── pending 없음 ──
      const r = router.route(text);
      const routeSpan = span.child("route", { text });

      if (r.kind === "redirect") {
        const last = [...(conversation?.turns ?? [])].reverse().find((t) => t.kind !== "ask");
        if (last) {
          const routeTrace = { routes: [r.route], signals: null, redirect: true };
          routeSpan.end({ ...routeTrace, original: last.query });
          return answerAndRecord(r.route, last.query, routeTrace);
        }
        // 되돌릴 답이 없으면 보통 문장이다
        const routeTrace = { routes: ["palette"], signals: null, redirect: false };
        routeSpan.end(routeTrace);
        return answerAndRecord("palette", text, routeTrace);
      }

      const routeTrace = { routes: r.routes, signals: r.signals ?? null, redirect: false };
      routeSpan.end({ ...routeTrace, unclear: r.unclear });

      if (r.unclear === "character") {
        const turn = { ...askTurn("unclear", [], QUESTION.unclearCharacter), original: text, trace: routeTrace };
        span.child("ask", { reason: "unclear" }).end({ choices: [] });
        return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: [], reason: "unclear" } }, text);
      }
      if (r.routes.length > 1) {
        const turn = { ...askTurn("ambiguous", r.routes, QUESTION.ambiguous), original: text, trace: routeTrace };
        span.child("ask", { reason: "ambiguous" }).end({ choices: r.routes });
        return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: r.routes, reason: "ambiguous" } }, text);
      }

      const route = r.routes[0];
      if (route === "palette" || route === "diagnosis") {
        const { route: finalRoute, payload } = await answer(route, text, span);
        if (searchUnclear(payload)) {
          const turn = { ...askTurn("unclear", ["palette", "diagnosis", "character", "color"], QUESTION.unclearPalette), original: text, trace: routeTrace };
          span.child("ask", { reason: "unclear" }).end({ choices: turn.choices.map((c) => c.id) });
          return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: turn.choices.map((c) => c.id), reason: "unclear" } }, text);
        }
        const turn = { kind: "answer", route: finalRoute, original: text, payload, trace: routeTrace };
        return record(turn, { kind: "answer", route: finalRoute, pending: null, ...summarize(finalRoute, payload) }, text);
      }
      return answerAndRecord(route, text, routeTrace);
    } catch (err) {
      // 처리기·저장이 실패해도 트레이스는 남긴다 — 안 남기면 이 턴은 traces.jsonl 에서 통째로 사라진다(리뷰 1차 · 항목 4).
      span.end({ error: err.message, kind: "error" });
      throw err;
    }
  }

  return { step };
}
