// 되묻기 상태 기계. 39단계. 손으로 쓴 표 하나다 — 설계 문서 3절의 표를 코드로 옮겼다.
//
//   pending 없음 + 문장      → 라우터. 하나면 답. 겹침·불명이면 되묻고 pending 을 남긴다
//   pending 없음 + 바로잡기  → 직전 답의 원문을 지정 경로로 다시 답한다
//   pending 있음 + 칩        → 원문을 그 경로로 답한다. pending 을 지운다
//   pending 있음 + 문장      → 원문에 이어 붙여 라우터. 또 애매해도 **다시 안 묻고** 첫 후보(겹침)·추천(불명)으로 답한다
//   마지막 자리(9턴)         → 되묻지 않는다. 겹침이면 첫 후보, 불명이면 추천으로 바로 답한다
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
  // 42단계 — 문장으로 만든 색. 검색 단계가 없다(Claude 한 번 + 계산). 내역의 "몇 단계" 자리는 LLM 을 쓴 2 로 적는다.
  if (payload?.kind === "generated") return { stage: 2, usedLlm: true, confident: payload.intent.kind === "palette", topKind: "generated", topId: null, topLabel: payload.reading || payload.read.join(" · ") };
  if (route === "color") return { stage: 1, usedLlm: false, confident: true, topKind: "color", topId: payload.partners[0]?.pairId ?? null, topLabel: payload.partners[0]?.pairName ?? null };
  if (route === "character") return { stage: 1, usedLlm: payload.parse.from === "llm", confident: payload.palette.from === "search", topKind: "character", topId: payload.palette.id, topLabel: payload.palette.name };
  const top = payload.route === "diagnosis" ? payload.diagnostics[0] : payload.results[0];
  return { stage: payload.stage, usedLlm: payload.usedLlm === true, confident: payload.confident === true, topKind: top ? payload.route : null, topId: top?.id ?? null, topLabel: top ? (top.name ?? top.symptom) : null };
}

/** 검색이 끝까지 저신뢰이고 모델도 "other" 이거나 없으면 정보 부족이다. 문장 팔레트(42단계)는 Claude 가 "색과 무관" 으로 읽었을 때다. */
const searchUnclear = (payload) =>
  payload.kind === "generated" ? payload.intent.kind === "other" : payload.confident !== true && (payload.rewrite == null || payload.rewrite.intent === "other");

/**
 * `router` 는 **함수**다 — 부를 때마다 지금 코퍼스로 만든 라우터를 돌려준다(server.js 가 `pipeline` 버전으로
 * 캐시한다). 값으로 받으면 기동 때의 코퍼스·진단표가 박혀 27단계 핫리로드가 `/api/chat` 에서만 죽는다(최종 리뷰 P1-5).
 */
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
    // 42단계 — 추천은 Claude 가 의도를 읽고 엔진이 색을 계산한다. **과도기(42·43단계)**: Claude 를 못 쓰거나 진단으로
    // 읽혔으면 옛 검색 경로로 물러선다 — 진단표를 찾는 길이 아직 그쪽에 있다. 44단계에서 검색을 걷어내며 바뀐다.
    //
    // **라우터가 진단이라고 해도 Claude 에게 한 번 묻는다.** 진단 별칭은 BM25 시절 검색용으로 맞춘 낱말이라 팔레트 문장에도
    // 걸린다 — "차분한데 포인트는 주황" 이 '차분하게 하고 싶다' 별칭으로 진단에 갔다 `[실측 10-02]`. Claude 가 팔레트로 읽으면
    // 팔레트로 답한다. 진단 경로에서 "색과 무관" 으로 읽히면 되묻지 않고 옛 진단 검색 그대로 간다 — 별칭이 걸린 문장이다.
    if ((route === "palette" || route === "diagnosis") && handlers.generate) {
      const gen = await handlers.generate(query);
      if (!gen.skipped) {
        span.child("llm.intent", { query, model: gen.model ?? null }).end(gen.error ? { error: gen.error } : { kind: gen.intent.kind, usage: gen.intent.usage, count: gen.intent.count, variants: gen.palettes.length });
      }
      const wanted = route === "palette" ? ["palette", "other"] : ["palette"];
      if (!gen.error && wanted.includes(gen.intent.kind)) return { route: "palette", payload: gen };
    }
    const body = await handlers.search(query);
    span.child("search", { query }).end({ stage: body.stage, route: body.route, confident: body.confident, topId: body.route === "diagnosis" ? body.diagnostics[0]?.id : body.results[0]?.id });
    // 임베딩 결과를 따로 남긴다. 실패해도 답은 1단계로 나가서, 이게 없으면 기록만 봐서는 실패를 모른다(40단계 · H2).
    // 못 부른 턴(임베딩 키가 없거나 API 가 죽어 준비 안 됨)도 남긴다 — 가장 흔한 실패다(리뷰 P2-1). skipped 로 "느렸다" 와 가른다.
    if (body.embed) {
      const skipped = body.embed.budgetMs == null;
      span.child("embed", { query, budgetMs: body.embed.budgetMs }).end({ ok: !skipped && !body.hybridError, skipped, elapsedMs: body.embed.elapsedMs, error: body.hybridError ?? null });
    }
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
    // fresh 는 "이건 새 질문이다" 는 선언이다. 내역의 '다시 묻기' 가 pending 이 남은 대화로 들어가면
    // 서버가 그 질문을 되묻기의 답으로 읽어 두 질의를 이어 붙인다 — 사용자는 전혀 다른 답을 받는다(최종 리뷰 P1-3).
    const fresh = input?.fresh === true;
    const pending = fresh ? null : conversation?.pending ?? null;

    // 칩(choice)은 되물은 질문에 대한 답이다. 되물은 것이 없는데 칩만 오면(10턴 롤오버로 pending 이
    // 사라진 경우 포함) router.route("") 를 부르는 대신 여기서 바로 400 이다(리뷰 1차 · 항목 3).
    if (choice && !pending) {
      throw new ChatInputError("되물은 질문이 없다 — 문장으로 다시 물어 주세요");
    }

    // 대화의 마지막 한 자리에서는 되묻지 않는다. 물어 놓으면 다음 요청이 10턴 롤오버에 먼저 걸려
    // 새 대화가 되고, 그 대화에는 pending 이 없어 칩이 400 을 받는다 — 서버가 스스로 물어 놓고 그 답을
    // 거부한다(최종 리뷰 P1-1). 처분은 "pending 있음 + 문장" 행과 같다: 겹침이면 첫 후보, 불명이면 추천.
    const isLastTurn = conversation != null && conversation.turns.length === limit.turnsPerConversation - 1;

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
        // 칩 대신 바로잡기 낱말("추천으로")이나 칩 이름("캐릭터 색 짜기")을 글로 쳐도 칩과 같다. 원문에 이어 붙이면
        // 어절이 늘어 바로잡기 규칙(3어절 이하)을 못 타고 첫 후보로 가 버렸다 — 사용자가 고른 것과 반대로(40단계 리뷰).
        const own = router().route(text);
        const typed = own.kind === "redirect" ? own.route : (ROUTES.find((id) => CHOICE_LABEL[id] === text) ?? null);
        if (typed) {
          const routeTrace = { routes: [typed], signals: null, redirect: true };
          span.child("route", { text, pending: true }).end({ ...routeTrace, resolvedBy: "typed" });
          return answerAndRecord(typed, pending.original, routeTrace);
        }
        // 양쪽 다 각각 queryChars 를 통과했으므로 합치면 최대 2배다. 기록(recordTurn)은 어차피 자르므로
        // 여기서 같은 한도로 잘라 **기록과 실제 질의를 같게** 만든다(최종 리뷰 P2-11).
        const combined = `${pending.original} ${text}`.slice(0, limit.queryChars);
        const r = router().route(combined);
        const routes = r.kind === "redirect" ? [r.route] : r.routes;
        const routeTrace = { routes, signals: r.kind === "route" ? (r.signals ?? null) : null, redirect: r.kind === "redirect" };
        span.child("route", { text: combined, pending: true }).end({ ...routeTrace, resolvedBy: "text" });
        // 두 번째는 안 묻는다. 겹침이면 첫 후보, 불명이면 추천.
        const route = r.kind === "route" && r.unclear ? "palette" : routes[0];
        return answerAndRecord(route, combined, routeTrace);
      }

      // ── pending 없음 ──
      const r = router().route(text);
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
        if (isLastTurn) return answerAndRecord("palette", text, routeTrace);
        const turn = { ...askTurn("unclear", [], QUESTION.unclearCharacter), original: text, trace: routeTrace };
        span.child("ask", { reason: "unclear" }).end({ choices: [] });
        return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: [], reason: "unclear" } }, text);
      }
      if (r.routes.length > 1) {
        if (isLastTurn) return answerAndRecord(r.routes[0], text, routeTrace);
        const turn = { ...askTurn("ambiguous", r.routes, QUESTION.ambiguous), original: text, trace: routeTrace };
        span.child("ask", { reason: "ambiguous" }).end({ choices: r.routes });
        return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: r.routes, reason: "ambiguous" } }, text);
      }

      const route = r.routes[0];
      if (route === "palette" || route === "diagnosis") {
        const { route: finalRoute, payload } = await answer(route, text, span);
        if (searchUnclear(payload) && !isLastTurn) {
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
