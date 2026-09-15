// 홈 화면 — 채팅창 하나(39단계). 렌더 조각은 ui.js 가 세 화면과 공유한다.

import { api, applyModeButton, characterStructure, diagnosisCard, el, finishEditing, finishOverrides, modeStore, nextMode, paletteCard, refreshRuntime, sourceLine, structureCard, swatchView } from "./ui.js";

const form = document.getElementById("search-form");
const input = document.getElementById("q");
const submit = form.querySelector(".searchbar__submit");
const chatList = document.getElementById("chat");

const INTENT_LABEL = { palette: "팔레트 탐색", diagnosis: "진단", other: "색과 무관" };
const ROUTE_LABEL = { palette: "추천으로", diagnosis: "진단으로", character: "캐릭터로", color: "색으로" };

// 서버의 LIMITS.noteChars 와 **같아야 한다.** 어긋나면 사용자는 다 썼다고 보는데 서버가 조용히
// 잘라, 저장된 뒤에야 알게 된다. 홈은 한계값을 받아오지 않으므로 S8-G4 가 두 값을 대조한다.
const NOTE_MAX = 200;

// 한 번 보내면 그 뒤로는 같은 대화에 이어 붙인다. 새로고침하면 새 대화가 열린다 —
// 대화의 경계를 사용자가 선언하게 만들지 않고 세션으로 잡는다.
let conversationId = null;

const threadBox = document.getElementById("thread");
const threadTitle = document.getElementById("thread-title");
const threadMeta = document.getElementById("thread-meta");

/* ── 답 카드 ─────────────────────────────────────────────── */

/**
 * 결과 카드 하나. 슬라이더로 조정한 비율을 들고 있다가 저장할 때 함께 보낸다 —
 * 비율은 코퍼스가 모르는 값이고 사용자의 판단이므로, 저장되는 것이 기본값이 아니라 조정한 값이어야 한다.
 */
function resultCard(result, rank, featured, original) {
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
        fromQuery: original,
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
  box.append(memo, button, feedback, expansionSection(result.id, original));

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

  /*
   * **모드 상태는 여전히 이 영역 클로저 안에만 있다.** 카드마다 다른 모드로 나란히
   * 비교할 수 있어야 하기 때문이다 — 전역으로 올리면 한 카드를 어둡게 하는 순간
   * 나머지가 전부 따라 어두워진다.
   *
   * **바뀐 것은 시작값뿐이다(23단계).** 전에는 늘 밝은 모드로 시작해서 새로고침할 때마다
   * 다시 눌러야 했다. 이제 **기본 모드 하나**를 기억하고 그것으로 시작한다.
   * 그 뒤로는 카드마다 따로 토글할 수 있다 — 원래 결정의 값은 그대로 산다.
   */
  const modes = modeStore();
  let mode = modes.read();
  /*
   * **손으로 바꾼 재질도 여기, redraw 밖에 둔다.** 모드 토글이 격자를 통째로 다시 그리므로
   * 카드 안에 두면 어두운 모드로 바꾸는 순간 고친 것이 전부 사라진다 —
   * 15단계에서 겪은 것과 같은 부류이고 `S21-G4` 가 이 자리를 검사한다.
   */
  const overrides = finishOverrides();
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

      // 무엇이 골랐는지는 화면에 적지 않는다(31단계 · 대표 지시). 서버 응답의 selection.from 은 그대로 온다.
      note.replaceChildren();

      // 재질 배정의 출처(finishes.from)도 화면에 적지 않는다(31단계). 되돌릴 자리는 고르개의 "(처음 값)" 이 알려 준다.
      const fin = data.finishes;

      // **토글은 이미 받아 둔 data 로만 다시 그린다 — 네트워크 0, 재계산 0.**
      // 모드를 서버에 물으면 selectStructures 가 다시 돌아 같은 질의인데 보이는 다섯이 바뀐다.
      // 서버가 두 모드를 한 번에 보내 주므로(S15-G10) 여기서는 어느 쪽을 그릴지만 고른다.
      const modeBox = el("div", "expand__mode");
      const modeBtn = el("button", "expand__mode-toggle");
      modeBtn.type = "button";
      /*
       * **버튼 모양은 `applyModeButton` 한 곳에서 정한다.** 전에는 글자와 `aria-pressed` 를
       * 만들 때와 누를 때 두 곳에 적었는데, 늘 밝은 모드로 시작했기에 그 둘이 우연히 맞았다.
       * 저장된 모드로 시작하면 **어두운 모드에서 버튼이 거짓말을 한다** — 이미 어두운데
       * 어둡게 보자고 하고, 눌린 상태가 아니라고 알린다.
       */
      applyModeButton(modeBtn, mode);
      modeBtn.addEventListener("click", () => {
        // 뒤집기와 저장이 한 동작이다 — 두 줄로 나누면 순서를 틀릴 수 있고, 그 고장은
        // 새로고침해야 드러난다(리뷰가 재현). 마지막으로 고른 것이 다음번 기본이 된다.
        mode = nextMode(modes, mode);
        applyModeButton(modeBtn, mode);
        // **다시 그리기 전에 포커스를 이 버튼으로 확정한다.** redraw 가 격자를 통째로 갈아서,
        // 카드 안 비율 슬라이더에 포커스가 있었다면 그 요소가 DOM 에서 사라지고 포커스가 body 로
        // 떨어진다(실측). Safari 는 마우스 클릭으로 button 에 포커스를 주지 않으므로 그 경로가
        // 실제로 열려 있다 — 스크린리더에게는 포커스가 조용히 사라지는 것으로 보인다.
        modeBtn.focus();
        redraw?.();
      });
      modeBox.append(modeBtn);

      const grid = el("div", "expand__grid");

      // 빈 note 는 안 붙인다 — 비운 <p> 도 12px 여백을 남긴다(리뷰 지적). 실패 경로는 위에서 붙인 note 에 문장을 쓴다.
      body.replaceChildren(modeBox, grid);

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
      /*
       * 카드마다 저장 버튼을 붙인다.
       *
       * **색을 안 보낸다.** 씨앗 id·구조 id·모드만 보내면 서버가 색을 다시 계산한다 —
       * 파생은 결정적이라(S11-G3) 늘 같은 답이 나온다. `src/store.js` 규칙 4 가 그것을 적어 뒀고
       * `S18-G1` 이 거짓 색을 실어 보내 확인한다.
       *
       * **지금 맞춘 비율은 보낸다.** 색은 코퍼스(또는 파생 규칙)가 아는 사실이지만 비율은
       * 사용자의 판단이고, 그것을 안 보내면 슬라이더로 맞춘 것이 저장에서 사라진다.
       */
      /*
       * **재질 배정도 함께 보낸다.** 색과 달리 서버가 다시 계산할 수 없다 — 인상을 읽어 정하는
       * 것이라 재계산하면 사용자가 화면에서 본 것과 다른 재질이 나온다. 그래서 화면이 보내고
       * 서버가 검증한다(`S19-G1`).
       *
       * **이 구조의 역할만 골라 보낸다.** 배정 표는 일곱 역할 전부를 담고 있지만 구조마다
       * 쓰는 것이 다르다(3~4개). 통째로 보내면 서버가 어차피 거르지만, 화면이 무엇을 저장하는지
       * 스스로 알고 보내는 편이 맞다.
       */
      const saveDerived = (st) => (shares) => {
        // 손으로 바꾼 것이 있으면 그것이, 없으면 기본 배정이 실린다. 그 합치기는
        // `forStructure` 한 곳에서 하고 화면이 다시 적지 않는다 — 두 곳에 적으면 갈라진다.
        const finishes = overrides.forStructure(st, fin?.assignments);
        return api("/api/saved/derived", { seedId, structureId: st.id, mode, shares, finishes });
      };

      /*
       * **재질을 고쳐도 서버에 다시 묻지 않는다.** `/api/expand` 를 다시 부르면
       * `selectStructures` 가 다시 돌아 같은 질의인데 **보이는 다섯이 바뀐다** —
       * 모드 토글이 피한 것과 같은 함정이다(S15-G11).
       *
       * **다시 그리지도 않는다.** 처음에는 "고르개가 새 값으로 열려야 하니까" 다시 그렸는데,
       * 그것이 두 가지를 망가뜨렸다(브라우저 실측):
       *
       *   1. **사용자가 맞춘 면적 비율이 초기화된다.** 55:25:20 으로 맞춰 놓고 재질을 바꾸면
       *      34:33:33 으로 돌아간다. 이 사이트가 "면적이 색의 일부다" 라고 말해 온 것을
       *      정면으로 배신한다.
       *   2. **포커스가 body 로 떨어진다.** 방금 조작한 고르개가 DOM 에서 사라지기 때문이다.
       *      모드 토글이 이미 겪고 `focus()` 로 막아 둔 바로 그 문제다.
       *
       * **애초에 다시 그릴 필요가 없었다.** 고르개는 사용자가 고른 값을 이미 스스로 보이고
       * 있고, 이 카드에서 재질에 딸린 것은 그것 하나뿐이다 — 스와치·비율·"(기본 배정)" 표시는
       * 전부 재질과 무관하다(표시는 **원래** 배정 기준이라 안 바뀐다).
       *
       * 담아 두기만 한다. 다음에 격자가 갈릴 때(모드 토글) `forStructure` 가 합쳐서 넘긴다.
       */
      const cardEditing = (st) => finishEditing(overrides, st, fin?.assignments);

      redraw = () => {
        const draw = (st) => structureCard(st, mode, fin, saveDerived(st), fin?.assignments ? cardEditing(st) : null);
        grid.replaceChildren(...chosen.map(draw));
        restGrid?.replaceChildren(...rest.map(draw));
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

/** 검색 답(추천·진단) 한 덩어리. 전의 renderStatus + render 를 합쳐 요소로 돌려준다. */
function searchBlock(data, original) {
  const box = el("div", "answer");
  const status = el("div", "status");
  if (!data.confident) {
    const hasAny = data.results.length > 0 || data.diagnostics.length > 0;
    status.append(
      el("span", "status__badge status__badge--warn", "못 잡음"),
      el("span", "status__text", data.rewriteError ? `전문 검색이 못 잡았고 재작성도 실패했습니다 — ${data.rewriteError}` : hasAny ? "어절 전체로 겹친 항이 없습니다 — 아래 결과는 근거가 약하니 그대로 믿지 마세요." : "팔레트 코퍼스에도 진단표에도 걸리는 것이 없습니다."),
    );
  }
  const count = data.route === "diagnosis" ? data.diagnostics.length : data.results.length;
  const timing = [`BM25 ${data.elapsedMs}ms`];
  if (data.hybrid) timing.push(`임베딩 ${data.hybrid.elapsedMs}ms · 코사인 ${data.hybrid.cosine}`);
  status.append(el("span", "status__timing", `${timing.join(" · ")} · ${count}건`));
  if (data.hybridError && data.confident) status.append(el("span", "status__timing", `임베딩은 못 썼습니다 — ${data.hybridError}`));
  if (data.rewrite) {
    const strip = el("div", "rewrite");
    strip.append(el("span", "status__badge", "재작성"), el("span", "rewrite__label", `의도 ${INTENT_LABEL[data.rewrite.intent] ?? data.rewrite.intent} · 검색어`));
    for (const term of data.rewrite.terms) strip.append(el("span", "rewrite__term", term));
    strip.append(el("span", "rewrite__meta", `${data.rewrite.model} · ${data.rewrite.elapsedMs}ms`));
    status.append(strip);
  }
  box.append(status);

  if (data.route === "diagnosis") {
    box.append(el("h2", "results__title", "진단"), el("p", "results__note", "색 조합이 아니라 어느 원인을 의심할지가 답입니다"));
    data.diagnostics.forEach((dx, i) => box.append(diagnosisCard(dx, i + 1)));
    return box;
  }
  if (data.results.length) box.append(el("h2", "results__title", "추천 조합"), el("p", "results__note", "색상각과 톤 좌표를 따로 찍어 정렬했습니다"));
  const [first, ...rest] = data.results;
  if (first) box.append(resultCard(first, 1, true, original));
  rest.forEach((r, i) => box.append(resultCard(r, i + 2, false, original)));
  return box;
}

/** 캐릭터 답. 전의 renderCharacter 를 요소로. */
function characterBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · 배색 쌍 ${data.palette.name}`));
  if (data.palette.from === "fallback") status.append(el("span", "character__note", "인상을 못 읽어 기본 배색을 썼습니다"));
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
  palette: (data, original) => searchBlock(data, original),
  diagnosis: (data, original) => searchBlock(data, original),
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
  const block = (BLOCK_BY_ROUTE[turn.route] ?? searchBlock)(turn.payload, turn.original);
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
    const data = await api("/api/chat", { conversationId, ...body });
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
  threadMeta.textContent = `${conversation.turns.length}턴 · 재작성 ${usedLlm}회`; // 31단계: 무엇을 했는지(질문 재작성)로 적는다
  document.getElementById("thread-open").href = `/history#${conversation.id}`;
  threadBox.hidden = false;
}

document.getElementById("thread-new").addEventListener("click", () => {
  conversationId = null;
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
refreshRuntime(0, () => {});
