// 홈 화면. 렌더 조각은 ui.js 가 세 화면과 공유한다.

import { api, diagnosisCard, el, paletteCard, refreshRuntime, structureCard } from "./ui.js";

const form = document.getElementById("search-form");
const input = document.getElementById("q");
const submit = form.querySelector(".searchbar__submit");
const statusBox = document.getElementById("status");
const resultsHead = document.getElementById("results-head");
const resultsTitle = document.getElementById("results-title");
const resultsNote = document.getElementById("results-note");
const featuredBox = document.getElementById("results-featured");
const restBox = document.getElementById("results-rest");
const diagnosisBox = document.getElementById("results-diagnosis");
const stageLabel = document.getElementById("stage-label");
const ladder = document.getElementById("ladder");

const INTENT_LABEL = { palette: "팔레트 탐색", diagnosis: "진단", other: "색과 무관" };

// 서버의 LIMITS.noteChars 와 **같아야 한다.** 어긋나면 사용자는 다 썼다고 보는데 서버가 조용히
// 잘라, 저장된 뒤에야 알게 된다. 홈은 한계값을 받아오지 않으므로 S8-G4 가 두 값을 대조한다.
const NOTE_MAX = 200;

// 한 번 검색하면 그 뒤로는 같은 대화에 이어 붙인다. 새로고침하면 새 대화가 열린다 —
// 대화의 경계를 사용자가 선언하게 만들지 않고 세션으로 잡는다.
let conversationId = null;
let lastQuery = "";

const threadBox = document.getElementById("thread");
const threadTitle = document.getElementById("thread-title");
const threadMeta = document.getElementById("thread-meta");

/* ── 렌더 ────────────────────────────────────────────────── */

/**
 * 결과 카드 하나. 슬라이더로 조정한 비율을 들고 있다가 저장할 때 함께 보낸다 —
 * 비율은 코퍼스가 모르는 값이고 사용자의 판단이므로, 저장되는 것이 기본값이 아니라 조정한 값이어야 한다.
 */
function resultCard(result, rank, featured) {
  let ratio = null; // null 이면 서버가 규칙의 기본값을 쓴다

  const box = el("div", "card__actions");
  const button = el("button", "action action--primary", "조합 저장");
  button.type = "button";
  const feedback = el("span", "action__feedback");

  // 메모는 저장할 때 함께 보낸다. 비어 있으면 아예 안 보내서, 앞서 적어 둔 메모가 남게 한다 —
  // 빈 값을 보내는 것은 서버에서 "지우기" 로 읽히기 때문이다.
  const memo = el("input", "action__memo");
  memo.type = "text";
  memo.maxLength = NOTE_MAX;
  memo.placeholder = "메모 (선택) — 어디에 쓸 색인지";
  memo.setAttribute("aria-label", `${result.name} 조합에 남길 메모`);

  // 전송 중인지와 저장이 끝났는지를 버튼의 disabled 하나로 겸하면, 전송 중 입력이 버튼을 다시
  // 열어 중복 전송이 된다. 상태를 따로 잡는다.
  let pending = false;
  // 전송 중에 사용자가 바꾼 것이 있는가. 전송 중에는 버튼을 안 열지만 **바뀐 사실은 남겨 둔다** —
  // 그냥 버리면 전송된 값과 화면 값이 다른데 버튼은 "저장됨" 으로 잠긴 채 남아, 사용자가 한 번 더
  // 건드리기 전에는 다시 저장할 방법이 없다.
  let changedWhilePending = false;

  // 버튼을 다시 여는 자리는 둘이다 — 메모 입력과 비율 변경. 한 곳에 모아 두 경로가 갈라지지
  // 않게 한다. 실제로 한쪽에만 pending 가드가 있어 비율 쪽으로 중복 전송이 열려 있었다.
  const reopen = (label) => {
    if (pending) {
      changedWhilePending = true;
      return;
    }
    button.disabled = false;
    button.textContent = label;
    feedback.textContent = "";
  };

  const save = async () => {
    pending = true;
    changedWhilePending = false;
    button.disabled = true;
    const note = memo.value.trim();
    try {
      await api("/api/saved", {
        paletteId: result.id,
        fromQuery: lastQuery,
        ...(ratio ? { ratio: ratio[0] } : {}),
        ...(note ? { note } : {}),
      });
      button.textContent = "저장됨";
      feedback.textContent = ratio
        ? `${ratio[0]} : ${ratio[1]} 비율로 저장했습니다`
        : "‘추천 받은 조합’ 에서 볼 수 있습니다";
    } catch (err) {
      feedback.textContent = err.message;
      button.disabled = false;
    } finally {
      pending = false;
      // 전송 중에 바뀐 것이 있으면 지금 연다. 이 시점에는 pending 이 끝나 중복 전송이 안 된다.
      if (changedWhilePending) {
        changedWhilePending = false;
        reopen("바뀐 내용으로 저장");
      }
    }
  };

  // 저장한 뒤 메모를 고치면 다시 저장할 수 있어야 한다. 비율을 고쳤을 때와 같은 규칙이다.
  memo.addEventListener("input", () => {
    if (!pending && !button.disabled) return;
    reopen("메모와 함께 저장");
  });

  button.addEventListener("click", save);
  box.append(memo, button, feedback, expansionSection(result.id, lastQuery));

  return paletteCard(result, rank, {
    featured,
    actions: box,
    onRatio: (next) => {
      // 값은 항상 받아 둔다. 전송 중이라고 여기서 버리면 사용자가 맞춘 비율이 사라진다 —
      // 버튼을 여는 것만 미루고, 미뤘다는 사실은 reopen 이 기억한다.
      ratio = next;
      // 이미 저장한 뒤 비율을 바꿨다면 다시 저장할 수 있어야 한다.
      reopen("이 비율로 저장");
    },
  });
}

/**
 * 조합 하나를 배색 구조 여덟으로 펼치는 자리.
 *
 * **색을 보내지 않고 씨앗 id 만 보낸다.** 서버가 코퍼스·씨앗 풀에서 찾아 계산한다 —
 * 화면이 준 색을 서버가 믿지 않는 규칙(S4)과 같은 자리다.
 *
 * 접힌 상태로 시작한다. 여덟 장을 늘 펼쳐 두면 결과 하나가 화면을 통째로 먹는다.
 * 한 번 받아 온 것은 다시 받지 않는다 — 파생은 결정적이라(S11-G3) 같은 씨앗은 늘 같은 답이다.
 */
function expansionSection(seedId, query) {
  const box = el("div", "expand");
  const toggle = el("button", "expand__toggle", "배색 구조로 펼치기");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");

  const body = el("div", "expand__body");
  body.hidden = true;

  const note = el("p", "expand__note");
  let loaded = false;
  let pending = false;

  // **모드 상태는 이 영역 클로저 안에만 있다.** 전역이나 localStorage 에 두지 않는다 —
  // 카드마다 다른 모드로 나란히 비교할 수 있고, 이 저장소에 없던 저장 계층을 들이지도 않는다.
  let mode = "light";
  // 받아 둔 데이터로 다시 그리는 자리. 펼치기 전에는 그릴 것이 없어 null 이다.
  let redraw = null;

  toggle.addEventListener("click", async () => {
    if (!body.hidden) {
      body.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.textContent = "배색 구조로 펼치기";
      return;
    }

    body.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.textContent = "접기";
    if (loaded || pending) return;

    pending = true;
    note.textContent = "펼치는 중…";
    body.replaceChildren(note);
    try {
      const q = (query ?? "").trim();
      const data = await api(
        `/api/expand?seed=${encodeURIComponent(seedId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      );
      const byId = new Map(data.structures.map((st) => [st.id, st]));
      const chosen = (data.selection?.ids ?? []).map((id) => byId.get(id)).filter(Boolean);
      const rest = data.structures.filter((st) => !data.selection?.ids?.includes(st.id));

      // **무엇이 골랐는지 밝힌다.** LLM 이 골랐는지 카탈로그 순서로 물러섰는지를 안 적으면,
      // 사용자는 다섯이 자기 질문에 맞춰 뽑힌 것이라고 늘 믿게 된다.
      note.replaceChildren();
      const picked = data.selection?.from === "llm";
      const matched = data.selection?.matched ?? 0;
      note.append(
        el("span", "status__badge", picked ? "LLM 이 고름" : "기본 순서"),
        el(
          "span",
          "expand__note-text",
          picked
            ? // 문장을 조각내 잇지 않는다. 조건마다 온전한 문장을 쓴다 —
              // 잇다가 "골랐고" + "습니다" 가 붙어 "골랐고습니다" 가 나갔다.
              (matched < chosen.length
                ? `로컬 LLM 이 ${matched}가지를 골랐고, 나머지 ${chosen.length - matched}가지는 기본 순서로 채웠습니다.`
                : `질문에 맞는 ${matched}가지를 로컬 LLM 이 골랐습니다.`) +
              " 색은 씨앗의 HSL 연산으로만 나왔고 LLM 은 색에 닿지 않습니다."
            : `${data.selection?.error ? `${data.selection.error} — ` : ""}카탈로그 순서로 ${chosen.length}가지를 보여줍니다. 색은 씨앗의 HSL 연산으로만 나왔습니다.`,
        ),
      );
      if (picked && data.selection?.elapsedMs != null) {
        note.append(el("span", "status__timing", `${data.selection.model} · ${data.selection.elapsedMs}ms`));
      }

      /*
       * **재질 배정의 출처를 따로 밝힌다.** 구조 선택 배지와 나란히 두지 않고 줄을 나눈다 —
       * 둘은 서로 다른 호출이고 한쪽만 실패할 수 있다. 한 줄에 붙이면 "LLM 이 고름" 이 무엇에
       * 대한 말인지 흐려진다.
       *
       * 배지가 거짓말하지 않게 하는 판정은 서버가 이미 했다(S17-G5) — 모델이 쓸 수 있는 배정을
       * 하나도 안 줬으면 from 이 fallback 이다. 화면은 그것을 그대로 옮긴다.
       */
      const fin = data.finishes;
      const roleCount = Object.keys(fin?.assignments ?? {}).length;
      const finNote = el("p", "expand__finish-note");
      if (fin?.assignments) {
        const byLlm = fin.from === "llm";
        finNote.append(
          el("span", "status__badge", byLlm ? "LLM 이 배정" : "기본 배정"),
          el(
            "span",
            "expand__finish-text",
            byLlm
              ? // 문장을 조각내 잇지 않는다. 조건마다 온전한 문장을 쓴다 — 14단계에서 조각을
                // 이어 붙였다가 "골랐고" + "습니다" 가 붙어 "골랐고습니다" 가 나간 적이 있고,
                // 여기서는 전부 배정됐는데도 "나머지는 기본 배정" 이라고 말했다(브라우저 실측).
                fin.matched < roleCount
                ? `질문에 맞춰 ${fin.matched}자리를 로컬 LLM 이 배정했고, 나머지 ${roleCount - fin.matched}자리는 기본 재질입니다.`
                : `역할 ${fin.matched}자리의 재질을 질문에 맞춰 로컬 LLM 이 배정했습니다.`
              : `${fin.error ? `${fin.error} — ` : ""}역할별 기본 재질로 보여줍니다.`,
          ),
        );
        if (byLlm && fin.elapsedMs != null) {
          finNote.append(el("span", "status__timing", `${fin.model} · ${fin.elapsedMs}ms`));
        }
      }

      // **토글은 이미 받아 둔 data 로만 다시 그린다 — 네트워크 0, LLM 재호출 0.**
      // 모드를 서버에 물으면 selectStructures 가 다시 돌아 같은 질의인데 보이는 다섯이 바뀐다.
      // 서버가 두 모드를 한 번에 보내 주므로(S15-G10) 여기서는 어느 쪽을 그릴지만 고른다.
      const modeBox = el("div", "expand__mode");
      const modeBtn = el("button", "expand__mode-toggle", "어두운 배경으로 보기");
      modeBtn.type = "button";
      modeBtn.setAttribute("aria-pressed", "false");
      modeBtn.addEventListener("click", () => {
        mode = mode === "dark" ? "light" : "dark";
        modeBtn.setAttribute("aria-pressed", String(mode === "dark"));
        modeBtn.textContent = mode === "dark" ? "밝은 배경으로 보기" : "어두운 배경으로 보기";
        // **다시 그리기 전에 포커스를 이 버튼으로 확정한다.** redraw 가 격자를 통째로 갈아서,
        // 카드 안 비율 슬라이더에 포커스가 있었다면 그 요소가 DOM 에서 사라지고 포커스가 body 로
        // 떨어진다(실측). Safari 는 마우스 클릭으로 button 에 포커스를 주지 않으므로 그 경로가
        // 실제로 열려 있다 — 스크린리더에게는 포커스가 조용히 사라지는 것으로 보인다.
        modeBtn.focus();
        redraw?.();
      });
      modeBox.append(modeBtn);

      const grid = el("div", "expand__grid");

      body.replaceChildren(note, ...(finNote.childElementCount ? [finNote] : []), modeBox, grid);

      // 나머지는 지우지 않고 접어 둔다. 서버가 이미 계산해 둔 것이고, 고른 다섯이 마음에 안 들 때
      // 사용자가 볼 자리가 있어야 한다.
      let restGrid = null;
      if (rest.length) {
        const moreBox = el("div", "expand__more");
        const more = el("button", "expand__more-toggle", `나머지 ${rest.length}가지 보기`);
        more.type = "button";
        more.setAttribute("aria-expanded", "false");
        restGrid = el("div", "expand__grid");
        restGrid.hidden = true;
        more.addEventListener("click", () => {
          restGrid.hidden = !restGrid.hidden;
          more.setAttribute("aria-expanded", String(!restGrid.hidden));
          more.textContent = restGrid.hidden ? `나머지 ${rest.length}가지 보기` : "나머지 접기";
        });
        moreBox.append(more, restGrid);
        body.append(moreBox);
      }

      // 두 격자를 한 자리에서 다시 그린다. 접힘 상태(restGrid.hidden)는 replaceChildren 이
      // 건드리지 않으므로 모드를 바꿔도 펼쳐 둔 나머지가 도로 접히지 않는다.
      redraw = () => {
        grid.replaceChildren(...chosen.map((st) => structureCard(st, mode, fin)));
        restGrid?.replaceChildren(...rest.map((st) => structureCard(st, mode, fin)));
      };
      redraw();
      loaded = true;
    } catch (err) {
      // 실패를 삼키면 사용자는 빈 칸을 보고 구조가 없다고 읽는다.
      note.textContent = `펼치지 못했습니다 — ${err.message}`;
      body.replaceChildren(note);
    } finally {
      pending = false;
    }
  });

  box.append(toggle, body);
  return box;
}

function renderStatus(data, error) {
  statusBox.replaceChildren();
  statusBox.hidden = false;

  if (error) {
    statusBox.append(el("span", "status__badge status__badge--warn", "오류"), el("span", "status__text", error));
    return;
  }

  if (!data.confident) {
    const hasAny = data.results.length > 0 || data.diagnostics.length > 0;
    statusBox.append(
      el("span", "status__badge status__badge--warn", "못 잡음"),
      el(
        "span",
        "status__text",
        data.rewriteError
          ? `전문 검색이 못 잡았고 재작성도 실패했습니다 — ${data.rewriteError}`
          : hasAny
            ? "어절 전체로 겹친 항이 없습니다 — 조각이나 기능어만 맞았습니다. 아래 결과는 근거가 약하니 그대로 믿지 마세요."
            : "팔레트 코퍼스에도 진단표에도 걸리는 것이 없습니다. 색에 관한 질문이 아닐 수 있습니다.",
      ),
    );
  } else if (data.stage === 1) {
    statusBox.append(
      el("span", "status__badge", "1단계"),
      el(
        "span",
        "status__text",
        data.route === "diagnosis"
          ? "전문 검색이 진단표에서 바로 찾았습니다. LLM 을 부르지 않았습니다."
          : "전문 검색만으로 걸렸습니다. LLM 을 부르지 않았습니다.",
      ),
    );
  } else {
    statusBox.append(
      el("span", "status__badge", "2단계"),
      el("span", "status__text", "전문 검색이 못 잡아 로컬 LLM 이 질문을 다시 썼습니다. 아래 검색어로 다시 찾은 결과입니다."),
    );
  }

  const count = data.route === "diagnosis" ? data.diagnostics.length : data.results.length;
  statusBox.append(el("span", "status__timing", `BM25 ${data.elapsedMs}ms · ${count}건`));

  if (data.rewrite) {
    const strip = el("div", "rewrite");
    strip.append(
      el("span", "status__badge", "재작성"),
      el("span", "rewrite__label", `의도 ${INTENT_LABEL[data.rewrite.intent] ?? data.rewrite.intent} · 검색어`),
    );
    for (const term of data.rewrite.terms) strip.append(el("span", "rewrite__term", term));
    strip.append(el("span", "rewrite__meta", `${data.rewrite.model} · ${data.rewrite.elapsedMs}ms`));
    statusBox.append(strip);
  }
}

function renderLadder(stage) {
  stageLabel.textContent = String(stage);
  for (const step of ladder.children) {
    step.dataset.active = String(Number(step.dataset.step) <= stage);
  }
}

function render(data) {
  renderStatus(data);
  featuredBox.replaceChildren();
  restBox.replaceChildren();
  diagnosisBox.replaceChildren();

  const isDiagnosis = data.route === "diagnosis";
  const items = isDiagnosis ? data.diagnostics : data.results;
  resultsHead.hidden = items.length === 0;

  if (isDiagnosis) {
    // 진단은 팔레트를 주지 않는다. 색 조합이 아니라 어느 축을 의심할지가 답이기 때문이다.
    // 다만 축이 조합의 관계를 그대로 말하는 진단은 코퍼스가 조합을 가리킬 수 있다 — 그때만 잇는다.
    resultsTitle.textContent = "진단";
    resultsNote.textContent = "색 조합이 아니라 어느 축을 의심할지가 답입니다";
    data.diagnostics.forEach((dx, i) => diagnosisBox.append(diagnosisCard(dx, i + 1)));
    return;
  }

  resultsTitle.textContent = "추천 조합";
  resultsNote.textContent = "색상각과 톤 좌표를 따로 찍어 정렬했습니다";
  const [first, ...rest] = data.results;
  if (first) featuredBox.append(resultCard(first, 1, true));
  rest.forEach((r, i) => restBox.append(resultCard(r, i + 2, false)));
}

/* ── 동작 ────────────────────────────────────────────────── */

// 예시 칩은 제출 버튼 잠금을 거치지 않으므로 빠르게 연달아 누르면 요청이 겹친다.
// 번호표를 끊어 최신 요청의 응답만 그린다.
let latestTicket = 0;

// 대화 기록은 화면이 명시적으로 남긴다. 검색(GET)이 부수효과로 쓰기를 하면
// 게이트 실행이나 새로고침까지 내역에 쌓인다.
async function recordTurn(data) {
  const top = data.route === "diagnosis" ? data.diagnostics[0] : data.results[0];
  const saved = await api("/api/conversations/turn", {
    conversationId,
    query: data.query,
    stage: data.stage,
    route: data.route,
    confident: data.confident,
    topKind: top ? data.route : null,
    topId: top?.id ?? null,
    topLabel: top ? (top.name ?? top.symptom) : null,
  });
  conversationId = saved.conversationId;
}

async function run(query) {
  // 대화 확인이 끝나기 전에 기록하면, 그 턴은 새 대화로 가는데 화면은 이어 쓰는 중이라고 말한다.
  // 리스너는 이미 붙어 있으므로(사용자가 바로 검색할 수 있다) 여기서 기다린다.
  await ready;
  const ticket = ++latestTicket;
  submit.disabled = true;
  lastQuery = query;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}&limit=3`);
    if (ticket !== latestTicket) return;
    render(data);
    // 기록 실패가 검색을 막지는 않지만, 조용히 넘기지도 않는다 —
    // 이어 쓰는 중이라고 표시해 놓고 기록이 안 되면 사용자가 속는다.
    recordTurn(data).catch((err) => {
      threadMeta.textContent = `기록하지 못했습니다 — ${err.message}`;
    });
  } catch (err) {
    if (ticket === latestTicket) renderStatus(null, err.message ?? "서버에 닿지 못했습니다");
  } finally {
    if (ticket === latestTicket) submit.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim() || input.placeholder;
  input.value = query;
  run(query);
});

for (const chip of document.querySelectorAll("[data-example]")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.example;
    run(input.value);
  });
}

/* ── 대화 이어하기 ───────────────────────────────────────────
   내역에서 넘어온 ?conv= 를 받아 그 대화에 이어 붙인다. ?q= 가 있으면 바로 한 번 돌린다.
   없는 대화 id 면 이어 쓰는 척하지 않는다 — 조용히 새 대화를 열면 사용자가 어디에 쓰고 있는지 잃는다. */

function showThread(conversation) {
  conversationId = conversation.id;
  threadTitle.textContent = conversation.turns.at(-1)?.query ?? "(빈 대화)";
  const usedLlm = conversation.turns.filter((t) => t.stage === 2).length;
  threadMeta.textContent = `${conversation.turns.length}턴 · LLM ${usedLlm}회`;
  document.getElementById("thread-open").href = `/history#${conversation.id}`;
  threadBox.hidden = false;
}

document.getElementById("thread-new").addEventListener("click", () => {
  conversationId = null;
  threadBox.hidden = true;
  history.replaceState(null, "", "/");
});

// 대화 확인이 끝나야 기록이 어디로 갈지 정해진다. run() 이 이 프로미스를 기다린다.
// 안에서 run() 을 부르지 않는다 — run 이 ready 를 기다리므로 교착한다.
const ready = (async () => {
  const params = new URLSearchParams(location.search);
  const conv = params.get("conv");

  if (conv) {
    try {
      const { conversation } = await api(`/api/conversations?id=${encodeURIComponent(conv)}`);
      showThread(conversation);
    } catch (err) {
      // 이어 쓸 수 없다는 것을 화면에 말한다.
      renderStatus(null, `그 대화를 이어 쓸 수 없습니다 — ${err.message}. 새 대화로 시작합니다.`);
      history.replaceState(null, "", "/");
    }
  }
  return params.get("q");
})();

// 자동 실행은 확인이 끝난 뒤에. 이 시점에 ready 는 이미 해소돼 있어 run 이 막히지 않는다.
ready.then((query) => {
  if (!query) return;
  input.value = query;
  run(query);
});
renderLadder(1);
refreshRuntime(0, renderLadder);
