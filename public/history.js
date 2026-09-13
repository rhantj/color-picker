// 대화 내역 화면.

import { api, el, formatWhen, refreshRuntime } from "./ui.js";

const list = document.getElementById("list");

const ROUTE_LABEL = { palette: "팔레트", diagnosis: "진단", none: "못 잡음" };

function turnRow(turn, conversationId) {
  const row = el("li", "turn");

  const stage = el("span", `turn__stage turn__stage--${turn.stage}`, `${turn.stage}단계`);
  const query = el("span", "turn__query", turn.query);

  const meta = el("span", "turn__meta");
  meta.append(el("span", `turn__route turn__route--${turn.route}`, ROUTE_LABEL[turn.route] ?? turn.route));
  if (turn.topLabel) meta.append(el("span", "turn__top", turn.topLabel));
  // 신뢰 여부는 숨기지 않는다. 저신뢰 답을 받은 기록도 기록이다.
  if (!turn.confident) meta.append(el("span", "turn__weak", "근거 약함"));
  meta.append(el("span", "turn__at", formatWhen(turn.at)));

  // 지난 질문을 그대로 다시 돌려 볼 수 있게 한다. 코퍼스가 바뀌면 답도 바뀐다.
  const again = el("a", "turn__again", "다시 묻기");
  again.href = `/?conv=${encodeURIComponent(conversationId)}&q=${encodeURIComponent(turn.query)}`;
  meta.append(again);

  row.append(stage, query, meta);
  return row;
}

function conversationBlock(conversation) {
  const block = el("article", "conv");
  block.id = conversation.id; // 홈의 '내역에서 보기' 가 이 앵커로 온다

  const head = el("div", "conv__head");
  // stage 로 못 센다 — 3단계(임베딩) 뒤에 재작성이 온 턴도 stage 3 이다. 기록의 usedLlm 을 믿는다.
  // 26단계 전에 남은 턴에는 usedLlm 이 없다. 그때는 2단계가 곧 LLM 이었으므로 stage 로 되돌아간다.
  const usedLlm = conversation.turns.filter((t) => (t.usedLlm === undefined ? t.stage === 2 : t.usedLlm === true)).length;
  head.append(
    el("h2", "conv__title", conversation.turns.at(-1)?.query ?? "(빈 대화)"),
    el(
      "span",
      "conv__meta",
      `${conversation.turns.length}턴 · LLM ${usedLlm}회 · ${formatWhen(conversation.updatedAt)}`,
    ),
  );

  const resume = el("a", "action action--primary", "이어서 묻기");
  resume.href = `/?conv=${encodeURIComponent(conversation.id)}`;
  head.append(resume);

  const turns = el("ol", "conv__turns");
  for (const turn of conversation.turns) turns.append(turnRow(turn, conversation.id));

  block.append(head, turns);
  return block;
}

async function load() {
  try {
    const { conversations } = await api("/api/conversations");
    list.replaceChildren();
    if (conversations.length === 0) {
      list.append(
        el("p", "empty", "아직 기록이 없습니다. 홈에서 검색하면 여기에 쌓입니다."),
      );
      return;
    }
    for (const conversation of conversations) list.append(conversationBlock(conversation));
  } catch (err) {
    list.replaceChildren(el("p", "empty", `내역을 불러오지 못했습니다 — ${err.message}`));
  }
}

load();
refreshRuntime();
