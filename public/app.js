// 홈 화면 — 채팅창 하나(39단계). 렌더 조각은 ui.js 가 세 화면과 공유한다.

import { api, applyModeButton, characterStructure, diagnosisCard, el, finishEditing, finishOverrides, modeStore, nextMode, refreshRuntime, sourceLine, structureCard, swatchView } from "./ui.js";

const form = document.getElementById("search-form");
const input = document.getElementById("q");
const submit = form.querySelector(".searchbar__submit");
const chatList = document.getElementById("chat");

const ROUTE_LABEL = { palette: "추천으로", diagnosis: "진단으로", character: "캐릭터로", color: "색으로" };

// 한 번 보내면 그 뒤로는 같은 대화에 이어 붙인다. 새로고침하면 새 대화가 열린다 —
// 대화의 경계를 사용자가 선언하게 만들지 않고 세션으로 잡는다.
let conversationId = null;

const threadBox = document.getElementById("thread");
const threadTitle = document.getElementById("thread-title");
const threadMeta = document.getElementById("thread-meta");

/* ── 답 카드 ─────────────────────────────────────────────── */

const DIAGNOSIS_FROM = { llm: "Claude 가 진단표에서 골랐습니다", alias: "증상 낱말로 진단표에서 찾았습니다" };

/**
 * 진단 답(44단계). 진단표에서 **id 로** 찾은 항목이다 — 검색 점수가 없다. 어디서 골랐는지(Claude · 증상 낱말)는 한 줄로 밝힌다.
 * 맞는 것이 없으면 채팅이 되묻기 때문에 여기 빈 목록이 오는 것은 마지막 턴(되묻지 않는 자리)뿐이다.
 */
function diagnosisBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  if (data.diagnostics.length) status.append(el("span", "status__text", DIAGNOSIS_FROM[data.from] ?? ""));
  else status.append(el("span", "status__badge status__badge--warn", "못 잡음"), el("span", "status__text", "진단표에서 맞는 원인을 못 찾았습니다. 증상을 조금 더 적어 주세요."));
  box.append(status);
  if (!data.diagnostics.length) return box;
  box.append(el("h2", "results__title", "진단"), el("p", "results__note", "색 조합이 아니라 어느 원인을 의심할지가 답입니다"));
  data.diagnostics.forEach((dx, i) => box.append(diagnosisCard(dx, i + 1)));
  return box;
}

/**
 * 문장을 못 읽은 답(44단계). Claude 를 못 쓰면(키 없음 · 크레딧 · 시간 초과) 추천 문장은 읽을 길이 없다 — 검색으로 비슷한 것을
 * 지어내던 폴백은 걷어냈다. 무엇이 되는지(색 코드 · 진단 낱말)를 대신 말한다.
 */
function unavailableBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(
    el("span", "status__badge status__badge--warn", "못 읽음"),
    el("span", "status__text", "지금은 문장을 읽을 수 없습니다(Claude 를 쓸 수 없음). #E07A5F 같은 색 코드나 “테라코타” 같은 색 이름은 바로 찾을 수 있습니다."),
  );
  if (data.reason) status.append(el("span", "status__timing", data.reason));
  box.append(status);
  return box;
}


/**
 * UI 쓰임새 팔레트의 작은 화면 미리보기(42단계). 역할 이름(바탕 · 면 · 본문 · 주색 · 강조 …)대로 색을 칠해
 * "이 색들이 화면에서 어떻게 앉나" 를 바로 보인다. 색은 서버가 준 것 그대로 — 여기서 만들지 않는다.
 */
function uiPreview(palette) {
  const by = Object.fromEntries(palette.colors.map((c) => [c.role, c.hex]));
  const frame = el("div", "uiprev");
  frame.setAttribute("aria-hidden", "true");
  frame.style.background = by["바탕"];
  frame.style.color = by["본문"];
  const card = el("div", "uiprev__card");
  card.style.background = by["면"] ?? by["바탕"];
  if (by["테두리"]) card.style.borderColor = by["테두리"];
  const title = el("p", "uiprev__title", "오늘의 색");
  const line = el("p", "uiprev__text", "본문 글자는 바탕과 4.5:1 이상");
  const row = el("div", "uiprev__row");
  const primary = el("span", "uiprev__button", "확인");
  primary.style.background = by["주색"] ?? by["강조"];
  primary.style.color = by["바탕"];
  row.append(primary);
  if (by["보조"]) {
    const second = el("span", "uiprev__ghost", "취소");
    second.style.color = by["보조"];
    second.style.borderColor = by["보조"];
    row.append(second);
  }
  const badge = el("span", "uiprev__badge", "새 소식");
  badge.style.background = by["강조"];
  row.append(badge);
  card.append(title, line, row);
  frame.append(card);
  return frame;
}

/*
 * 다듬기 기준 안(43단계). 다음 말을 보낼 때 `variant` 로 싣는다 — 서버는 0~2 정수만 받고, 직전 답이 문장 팔레트이고 Claude 가
 * "고친다" 로 읽었을 때만 쓴다. **화면이 보내는 것은 이 번호뿐이다** — 직전 의도는 서버가 대화 기록에서 꺼낸다.
 * 새 답이 그려질 때마다 그 답의 맨 앞 안으로 돌아가고, 옛 답의 고르개는 잠근다(직전 의도는 늘 마지막 답의 것이다).
 */
let pinnedVariant = 0;
let retirePins = null;

/**
 * 문장으로 만든 팔레트(42단계). Claude 가 읽은 것 한 줄 + 읽은 칸들 + 3안.
 * **저장은 의도와 안 번호만 보낸다** — 서버가 같은 검증을 거쳐 색을 다시 계산한다(S4 · S18 과 같은 규칙).
 * 다듬은 답(43단계)은 바뀐 칸을 칩으로 보이고, 고른 안을 맨 앞에 두고 나머지 결은 접어 둔다.
 */
function generatedBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · ${data.palettes.length}안`));
  const strip = el("div", "rewrite");
  strip.append(el("span", "status__badge", "읽은 것"));
  for (const part of data.read ?? []) strip.append(el("span", "rewrite__term", part));
  status.append(strip);
  if (data.refine) {
    const changed = el("div", "rewrite refine");
    changed.append(el("span", "status__badge", "바뀐 것"));
    if (data.refine.changes.length === 0) changed.append(el("span", "rewrite__label", "칸은 그대로입니다"));
    for (const c of data.refine.changes) changed.append(el("span", "rewrite__term refine__chip", c));
    status.append(changed);
  }
  box.append(status);
  if (data.reading) box.append(el("p", "reading", `이렇게 읽었어요 — ${data.reading}`));
  box.append(
    el("h2", "results__title", "팔레트"),
    el("p", "results__note", "비율을 옮겨 보고 마음에 드는 안을 저장하세요. 이어서 “좀 더 따뜻하게” 처럼 쓰면 ‘기준’ 안을 고칩니다"),
  );

  retirePins?.();
  const pins = [];
  const choose = (variant) => {
    pinnedVariant = variant;
    for (const { button, variant: v } of pins) {
      const on = v === variant;
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "기준 — 다음 말이 이 안을 고친다" : "이 안으로 다듬기";
    }
  };
  retirePins = () => {
    for (const { button } of pins) button.disabled = true;
  };

  const cardFor = (p) => {
    const onSave = (shares) => api("/api/saved/generated", { intent: data.intent, variant: p.variant, shares, query: data.query });
    const card = structureCard(p, "light", null, onSave, null);
    if (p.theme) card.insertBefore(uiPreview(p), card.querySelector(".struct__principle")?.nextSibling ?? null);
    const pin = el("button", "pin");
    pin.type = "button";
    pin.dataset.variant = String(p.variant);
    pin.addEventListener("click", () => choose(p.variant));
    pins.push({ button: pin, variant: p.variant });
    card.append(pin);
    return card;
  };

  const [first, ...rest] = data.palettes ?? [];
  const grid = el("div", "expand__grid");
  if (data.refine && rest.length) {
    // 고른 결 하나를 앞에, 나머지는 접어 둔다 — 지우지 않는다. 다듬은 결과가 기대와 다를 때 다른 결이 볼 자리다.
    grid.append(cardFor(first));
    const moreBox = el("div", "expand__more");
    const more = el("button", "expand__more-toggle", `다른 결 ${rest.length}가지 보기`);
    more.type = "button";
    more.setAttribute("aria-expanded", "false");
    const restGrid = el("div", "expand__grid");
    restGrid.hidden = true;
    for (const p of rest) restGrid.append(cardFor(p));
    more.addEventListener("click", () => {
      restGrid.hidden = !restGrid.hidden;
      more.setAttribute("aria-expanded", String(!restGrid.hidden));
      more.textContent = restGrid.hidden ? `다른 결 ${rest.length}가지 보기` : "다른 결 접기";
    });
    moreBox.append(more, restGrid);
    box.append(grid, moreBox);
  } else {
    for (const p of data.palettes ?? []) grid.append(cardFor(p));
    box.append(grid);
  }
  if (first) choose(first.variant);
  return box;
}

/** 캐릭터 답. 전의 renderCharacter 를 요소로. */
function characterBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · 배색 쌍 ${data.palette.name}`));
  if (data.palette.from === "fallback") status.append(el("span", "character__note", "배색 쌍을 못 골라 기본 배색을 썼습니다"));
  for (const w of data.warnings ?? []) status.append(el("span", "character__note", w));
  box.append(status, el("h2", "results__title", "캐릭터 부위별 색"));

  const struct = characterStructure(data);
  const base = data.finishes?.assignments && Object.keys(data.finishes.assignments).length ? data.finishes.assignments : null;
  const overrides = finishOverrides();
  const editing = base ? finishEditing(overrides, struct, base) : null;
  const finishes = base ? { assignments: base, names: data.finishes.names, ids: data.finishes.ids } : null;
  const onSave = (shares) => api("/api/saved/character", { query: data.query, parts: data.parse.parts, creature: data.parse.creature, paletteId: data.palette.id, shares, finishes: overrides.forStructure(struct, base) });
  const card = structureCard(struct, "light", finishes, onSave, editing);
  card.append(sourceLine(data.colors));
  box.append(card);
  return box;
}

/** 색 답. 전의 renderColor 를 요소로. */
function colorBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · 짝 ${data.partners.length}쌍 · 구조 ${data.structures.length}가지`));
  box.append(status, inputCard(data));
  if (data.partners.length) box.append(el("h2", "results__title", "배색사전에서 어울리는 짝"));
  data.partners.forEach((p, i) => box.append(partnerCard(p, i + 1, data.query)));

  const modes = modeStore();
  let mode = modes.read();
  const overrides = finishOverrides();
  const fin = data.finishes?.assignments ? data.finishes : null;
  const seedId = `hex-${data.input.hex.slice(1)}`;
  const saveDerived = (st) => (shares) => api("/api/saved/derived", { seedId, structureId: st.id, mode, shares, finishes: overrides.forStructure(st, fin?.assignments) });
  const modeBtn = el("button", "expand__mode-toggle");
  modeBtn.type = "button";
  applyModeButton(modeBtn, mode);
  const grid = el("div", "expand__grid");
  const redraw = () => grid.replaceChildren(...data.structures.map((st) => structureCard(st, mode, fin, saveDerived(st), fin ? finishEditing(overrides, st, fin.assignments) : null)));
  modeBtn.addEventListener("click", () => {
    mode = nextMode(modes, mode);
    applyModeButton(modeBtn, mode);
    modeBtn.focus();
    redraw();
  });
  redraw();
  const modeBox = el("div", "expand__mode");
  modeBox.append(modeBtn);
  box.append(el("h2", "results__title", "배색 구조 여덟"), modeBox, grid);
  return box;
}

const BLOCK_BY_ROUTE = {
  // Claude 를 못 써 문장을 못 읽은 답(44단계)은 kind: "unavailable" — 옛 검색 폴백은 걷어냈다.
  palette: (data) => (data.kind === "generated" ? generatedBlock(data) : unavailableBlock(data)),
  diagnosis: (data) => diagnosisBlock(data),
  character: (data) => characterBlock(data),
  color: (data) => colorBlock(data),
};

/* ── 코드 및 색상 ─────────────────────────────────────────── */
const INPUT_FROM = { hex: "헥스", name: "코퍼스 색 이름", word: "색 낱말" };

/** 입력 색 한 장. 코퍼스에 없는 헥스면 가장 가까운 코퍼스 색을 옆에 적는다 — 짝은 그 색으로 찾았기 때문이다. */
function inputCard(data) {
  const card = el("article", "colorin__card");
  const view = swatchView([{ hex: data.input.hex }], [100]);
  const meta = el("div", "colorin__meta");
  meta.append(el("b", null, data.input.label), el("span", null, ` · ${INPUT_FROM[data.input.from] ?? data.input.from}`));
  const near = data.input.nearest;
  if (near && near.hex.toUpperCase() !== data.input.hex.toUpperCase()) {
    meta.append(el("span", "colorin__near", `가장 가까운 코퍼스 색 ${near.name ?? near.hex} ${near.hex}`));
  } else if (data.input.from === "word" && near?.name) {
    // 낱말("파란")은 코퍼스의 어느 색으로 갔는지 이름을 적는다. 코퍼스 이름 입력은 이미 그 이름이라 안 적는다.
    meta.append(el("span", "colorin__near", `코퍼스 ${near.name} ${near.hex}`));
  }
  card.append(view.node, meta);
  return card;
}

/**
 * 배색사전 짝 한 장 — 왼쪽이 입력에 가까운 코퍼스 색, 오른쪽이 그 쌍의 다른 색(짝).
 *
 * **저장은 쌍 id 만 보낸다.** 코퍼스 쌍이든 씨앗 풀 쌍이든 서버가 자기 자료에서 색을 꺼낸다 — 화면이 보낸 색을
 * 안 믿는 규칙(S4) 그대로. 비율은 안 보낸다(이 카드에는 슬라이더가 없다). `/saved` 에서 고칠 수 있다.
 */
function partnerCard(p, rank, fromQuery) {
  const card = el("article", "colorin__partner");
  const head = el("div", "struct__head");
  head.append(el("h4", "struct__name", p.partner.name), el("span", "struct__source", `배색사전 ${p.pairName}`));
  const colors = [{ hex: p.near.hex, role: p.near.name }, { hex: p.partner.hex, role: p.partner.name }];
  const view = swatchView(colors, [50, 50]);
  const note = el("p", "colorin__partner-note", `${String(rank).padStart(2, "0")} · 짝 ${p.partner.hex} · 가까운 색 ${p.near.name} ${p.near.hex}`);

  const actions = el("div", "card__actions");
  const button = el("button", "action action--primary", "조합 저장");
  button.type = "button";
  const feedback = el("span", "action__feedback");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await api("/api/saved", { paletteId: p.pairId, fromQuery });
      button.textContent = "저장됨";
      feedback.textContent = "‘추천 받은 조합’ 에서 볼 수 있습니다";
    } catch (err) {
      feedback.textContent = err.message;
      button.disabled = false;
    }
  });
  actions.append(button, feedback);
  card.append(head, view.node, note, actions);
  return card;
}

/* ── 대화 기록 ─────────────────────────────────────────────── */
function userItem(text) {
  const li = el("li", "chat__item chat__item--user");
  li.append(el("p", "chat__bubble", text));
  return li;
}

function agentItem(...children) {
  const li = el("li", "chat__item chat__item--agent");
  li.append(...children);
  return li;
}

/** 확인 질문. 칩을 누르면 choice 로, 문장을 치면 text 로 간다 — 입력창은 그대로 쓴다. */
function askItem(turn) {
  const box = el("div", "ask");
  const question = el("p", "ask__question", turn.question);
  question.setAttribute("aria-live", "polite");
  box.append(question);
  if (turn.choices.length) {
    const chips = el("div", "ask__chips");
    for (const c of turn.choices) {
      const chip = el("button", "ask__chip", c.label);
      chip.type = "button";
      chip.dataset.choice = c.id;
      chip.addEventListener("click", () => {
        for (const b of chips.querySelectorAll("button")) b.disabled = true;
        chip.classList.add("ask__chip--picked");
        send({ choice: c.id });
      });
      chips.append(chip);
    }
    box.append(chips);
  }
  return agentItem(box);
}

function answerItem(turn) {
  const head = el("p", "answer__route", `${ROUTE_LABEL[turn.route] ?? `${turn.route}으로`} 읽었습니다`);
  const block = (BLOCK_BY_ROUTE[turn.route] ?? unavailableBlock)(turn.payload, turn.original);
  return agentItem(head, block);
}

function errorItem(message) {
  const box = el("div", "status");
  box.append(el("span", "status__badge status__badge--warn", "오류"), el("span", "status__text", message));
  return agentItem(box);
}

let latestTicket = 0;

/** 서버에 한 턴을 보낸다. 사용자 말풍선은 먼저 붙이고, 답이 오면 그 아래에 붙인다. */
async function send(body) {
  await ready;
  const ticket = ++latestTicket;
  submit.disabled = true;
  // 화면에 남은 칩은 전부 **이미 해소된** 되묻기의 것이다(칩으로든 문장으로든). 누르면 서버에 pending 이
  // 없어 400 오류 말풍선이 뜬다 — 새 턴을 보내는 이 자리에서 잠근다(최종 리뷰 P1-2).
  // 방금 고른 칩의 표시(ask__chip--picked)는 건드리지 않는다.
  for (const chip of chatList.querySelectorAll(".ask__chip")) chip.disabled = true;
  if (body.text) chatList.append(userItem(body.text));
  const waitingText = el("p", "chat__waiting", "생각 중…");
  waitingText.setAttribute("aria-live", "polite");
  const waiting = agentItem(waitingText);
  chatList.append(waiting);
  waiting.scrollIntoView({ block: "end" });
  try {
    // 고른 안 번호를 함께 싣는다(43단계) — 서버는 직전 답을 다듬을 때만 쓴다.
    const data = await api("/api/chat", { conversationId, variant: pinnedVariant, ...body });
    if (ticket !== latestTicket) {
      // 이 응답을 기다리는 사이 다른 턴이 시작됐다 — 낡은 "생각 중…" 을 남겨 두면 화면에 두 개가 겹친다.
      waiting.remove();
      return;
    }
    // conversationId 는 여기서 갱신하되, 배너(showThread)는 안 띄운다 — 이 시점의 conversation 은
    // turns:[] 뿐이라 "(빈 대화) · 0턴" 이라는 거짓 배너가 뜬다. 배너는 `?conv=` 로 이어 쓸 때만 의미가 있다.
    conversationId = data.conversationId;
    waiting.replaceWith(data.turn.kind === "ask" ? askItem(data.turn) : answerItem(data.turn));
    chatList.lastElementChild?.scrollIntoView({ block: "end" });
  } catch (err) {
    if (ticket === latestTicket) waiting.replaceWith(errorItem(err.message ?? "서버에 닿지 못했습니다"));
    else waiting.remove();
  } finally {
    if (ticket === latestTicket) {
      submit.disabled = false;
      input.focus();
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  // 보내는 중에 Enter 를 또 치면 두 번째 턴이 시작되고, 첫 답은 latestTicket 때문에 화면에서 사라지지만
  // 서버에는 이미 기록된다 — 내역에만 있고 화면에 없는 턴이 생긴다(최종 리뷰 P2-10).
  if (submit.disabled) return;
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  input.value = "";
  send({ text });
});

/* ── 대화 이어하기 ───────────────────────────────────────────
   내역에서 넘어온 ?conv= 를 받아 그 대화에 이어 붙인다. ?q= 가 있으면 바로 한 번 보낸다.
   없는 대화 id 면 이어 쓰는 척하지 않는다 — 조용히 새 대화를 열면 사용자가 어디에 쓰고 있는지 잃는다. */

/**
 * 이어 쓰는 중 배너만 채운다. **`?conv=` 로 들어왔을 때만 부른다** — send() 안에서는
 * 부르지 않는다. send() 가 만드는 conversation 은 그 순간 `turns:[]` 뿐이라, 여기서 부르면
 * "(빈 대화) · 0턴" 이라는 거짓 배너가 뜬다(리뷰 지적). 옛 턴을 chat 목록에 그리는 것도
 * 이 함수의 일이 아니다 — ready() 쪽에서 따로 한다.
 */
function showThread(conversation) {
  conversationId = conversation.id;
  threadTitle.textContent = conversation.turns.at(-1)?.query ?? "(빈 대화)";
  // 26단계 전 턴에는 usedLlm 이 없다 — 그때는 2단계가 곧 그 자리였다(history.js 와 같은 보정).
  const usedLlm = conversation.turns.filter((t) => (t.usedLlm === undefined ? t.stage === 2 : t.usedLlm === true)).length;
  threadMeta.textContent = `${conversation.turns.length}턴 · Claude ${usedLlm}회`; // 44단계: 재작성은 걷어냈다 — 문장을 Claude 가 읽은 턴 수
  document.getElementById("thread-open").href = `/history#${conversation.id}`;
  threadBox.hidden = false;
}

document.getElementById("thread-new").addEventListener("click", () => {
  conversationId = null;
  pinnedVariant = 0;
  retirePins?.();
  threadBox.hidden = true;
  chatList.replaceChildren();
  history.replaceState(null, "", "/");
});

// 대화 확인이 끝나야 기록이 어디로 갈지 정해진다. send() 가 이 프로미스를 기다린다.
// 안에서 send() 를 부르지 않는다 — send 가 ready 를 기다리므로 교착한다.
const ready = (async () => {
  const params = new URLSearchParams(location.search);
  const conv = params.get("conv");
  const q = params.get("q");

  if (conv) {
    try {
      const { conversation } = await api(`/api/conversations?id=${encodeURIComponent(conv)}`);
      showThread(conversation);
      // 옛 턴을 그린다 — 답은 저장돼 있지 않다(다시 묻기가 그 역할이다). 사용자 말풍선만 붙인다.
      // send() 가 아직 한 번도 안 불렸을 이 시점에만 한다 — 그 뒤에 부르면 막 붙인 말풍선을 지운다.
      // 마지막 턴이 이번 ?q= 와 같으면 건너뛴다 — 아니면 그 말풍선이 그려진 뒤 곧 send(q) 가
      // 같은 문장으로 하나 더 붙여 화면에 같은 말풍선이 두 번 보인다(리뷰 지적).
      chatList.replaceChildren();
      const turns = conversation.turns;
      const skipLast = q && turns.at(-1)?.query === q;
      turns.slice(0, skipLast ? -1 : undefined).forEach((t) => chatList.append(userItem(t.query)));
    } catch (err) {
      // 이어 쓸 수 없다는 것을 화면에 말한다.
      chatList.append(errorItem(`그 대화를 이어 쓸 수 없습니다 — ${err.message}. 새 대화로 시작합니다.`));
      history.replaceState(null, "", "/");
    }
  }

  // 빈 채팅에 안내 한 줄 — 대화가 없고(?conv= 도 없고) 아무것도 안 그려졌을 때만(스펙 5절).
  if (!conv && chatList.childElementCount === 0) {
    chatList.append(agentItem(el("p", "chat__bubble chat__bubble--agent", "찾는 색, 고칠 배색, 캐릭터 외형, 또는 #RRGGBB 를 문장으로 쓰세요.")));
  }

  return q;
})();

// 자동 실행은 확인이 끝난 뒤에. 이 시점에 ready 는 이미 해소돼 있어 send 가 막히지 않는다.
ready.then((query) => {
  if (!query) return;
  // fresh: 이 대화에 되묻기가 남아 있어도 이 질문은 **새 질문**이다. 안 주면 서버가 옛 원문에 이어 붙여
  // 전혀 다른 질의의 답을 낸다(최종 리뷰 P1-3).
  send({ text: query, fresh: true });
});
refreshRuntime();
