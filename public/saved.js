// 추천 받은 조합 화면.

import { api, el, formatWhen, ratioControl, refreshRuntime, swatchView } from "./ui.js";

const list = document.getElementById("list");

// 서버의 LIMITS.noteChars 와 **같아야 한다.** 어긋나면 사용자는 다 썼다고 보는데 서버가 조용히
// 잘라, 저장된 뒤에야 알게 된다. 이 화면은 한계값을 받아오지 않으므로 S9-G4 가 두 값을 대조한다.
const NOTE_MAX = 200;

/**
 * 메모 편집 칸. **포커스를 뗄 때** 저장한다 — 비율이 슬라이더에서 손을 뗄 때 저장하는 것과
 * 같은 모양이다. 글자마다 보내면 요청이 쏟아지고, 버튼을 따로 두면 비율만 자동인 이유를
 * 사용자가 알 수 없다.
 *
 * 값이 실제로 바뀐 경우에만 보낸다. 그냥 지나쳐 포커스만 스친 것으로 쓰기를 만들지 않는다.
 * **빈 값은 지우기다** — 홈에서 못 하던 것이 여기서 열린다.
 */
function noteField(entry) {
  const wrap = el("div", "card__note-edit");

  const input = el("input", "card__note-input");
  input.type = "text";
  input.maxLength = NOTE_MAX;
  input.value = entry.note ?? "";
  input.placeholder = "메모 (선택) — 어디에 쓸 색인지";
  input.setAttribute("aria-label", `${entry.name} 조합의 메모`);

  const status = el("span", "card__note-status");

  // 마지막으로 서버가 받아들인 값. 실패 롤백과 "바뀌었는가" 판정이 둘 다 여기를 본다 —
  // 최초 로드 값으로 판정하면 한 번 성공한 뒤의 재편집을 안 보낸다.
  let committed = entry.note ?? "";

  // 전송 중인지를 **핸들러가 읽는 상태**로 따로 잡는다. `input.disabled` 를 세팅만 하고
  // 가드로 쓰지 않으면, 전송이 끝나기 전에 blur 가 한 번 더 들어올 때 `committed` 가 아직
  // 옛 값이라 두 번째 요청이 그대로 나간다 — 실측으로 요청이 2건 나가는 것을 확인했다.
  // 브라우저가 포커스를 막는 것과 핸들러가 가드하는 것은 다르다. 이 저장소는 홈 화면에서
  // 이미 같은 형태로("전송 중" 과 "저장 완료" 를 disabled 하나로 겸해) 중복 전송을 열었다.
  let pending = false;

  input.addEventListener("blur", async () => {
    if (pending) return;
    const next = input.value.trim();
    if (next === committed) return;

    pending = true;
    input.disabled = true;
    status.textContent = "저장 중…";
    try {
      await api("/api/saved/note", { id: entry.id, note: next });
      committed = next;
      status.textContent = next ? "메모를 저장했습니다" : "메모를 지웠습니다";
    } catch (err) {
      status.textContent = err.message;
      input.value = committed; // 실패하면 서버가 아는 값으로 되돌린다
    } finally {
      pending = false;
      input.disabled = false;
    }
  });

  // Enter 로도 끝낼 수 있게 한다. blur 가 실제 저장을 맡으므로 경로는 하나다.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });

  wrap.append(input, status);
  return wrap;
}

function savedCard(entry, onRemoved) {
  const root = el("article", "card");
  const body = el("div", "card__body");

  const head = el("div", "card__head");
  head.append(el("h3", "card__name", entry.name), el("span", "badge badge--rank", `${entry.type}형`));

  const coords = el("div", "card__coords");
  for (const [key, value] of [
    ["색상각", entry.hueRelation],
    ["톤", entry.toneRelation],
  ]) {
    const item = el("span", null, `${key} `);
    item.append(el("b", null, value));
    coords.append(item);
  }

  body.append(head, coords, el("p", "card__text", entry.summary));
  body.append(noteField(entry));

  // 저장된 조합도 비율을 다시 만질 수 있다. 저장은 슬라이더에서 손을 뗐을 때 한 번만 한다.
  // 마지막으로 서버가 받아들인 값. 실패 롤백이 여기로 돌아간다 —
  // 최초 로드 값으로 돌리면 그 사이 성공한 변경이 화면에서 사라져 서버와 어긋난다.
  let current = entry.colors.map((c) => c.ratio);
  const view = swatchView(entry.colors, current);
  const status = el("span", "ratio__status");
  const control = ratioControl({
    colors: entry.colors,
    value: current[0],
    defaultValue: (entry.defaultRatio ?? current)[0],
    onInput: (next) => view.set(next),
    onCommit: async (next) => {
      status.textContent = "저장 중…";
      try {
        await api("/api/saved/ratio", { id: entry.id, ratio: next[0] });
        current = next;
        status.textContent = `${next[0]} : ${next[1]} 로 저장됨`;
      } catch (err) {
        status.textContent = err.message;
        view.set(current); // 실패하면 마지막으로 확인된 값으로 돌린다
        control.set(current[0]);
      }
    },
  });
  body.append(control.node, status);

  const meta = el("div", "card__meta");
  meta.append(el("span", null, `저장 ${formatWhen(entry.savedAt)}`));
  // 어떤 질문에서 나온 조합인지 남긴다. 나중에 "왜 이걸 저장했지" 를 답해 준다.
  if (entry.fromQuery) meta.append(el("span", "card__from", `“${entry.fromQuery}”`));
  body.append(meta);

  const actions = el("div", "card__actions");
  const remove = el("button", "action", "삭제");
  remove.type = "button";
  const feedback = el("span", "action__feedback");
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try {
      await api("/api/saved/delete", { id: entry.id });
      // **지운 카드만 걷어낸다.** 목록을 통째로 다시 그리면 다른 카드에서 아직 blur 하지 않은
      // 메모(= 서버로 안 보낸 입력)가 원래 값으로 되돌아가 조용히 사라진다.
      onRemoved(root);
    } catch (err) {
      feedback.textContent = err.message;
      remove.disabled = false;
    }
  });
  actions.append(remove, feedback);
  body.append(actions);

  root.append(view.node, body);
  return root;
}

const EMPTY_TEXT = "저장한 조합이 없습니다. 홈에서 추천을 받고 ‘조합 저장’ 을 누르세요.";

/** 카드 하나가 지워졌을 때. 목록을 다시 받지 않고 그 노드만 뗀다 — 나머지 카드의 입력을 지킨다. */
function dropCard(node) {
  node.remove();
  if (!list.querySelector(".card")) list.replaceChildren(el("p", "empty", EMPTY_TEXT));
}

async function load() {
  try {
    const { saved } = await api("/api/saved");
    list.replaceChildren();
    if (saved.length === 0) {
      list.append(el("p", "empty", EMPTY_TEXT));
      return;
    }
    for (const entry of saved) list.append(savedCard(entry, dropCard));
  } catch (err) {
    list.replaceChildren(el("p", "empty", `불러오지 못했습니다 — ${err.message}`));
  }
}

/* ── 내보내기 ────────────────────────────────────────────────
   형식은 서버가 만든다(src/export.js). 화면은 보여주고 건네주기만 한다 —
   화면이 문자열을 조립하기 시작하면 곧 서버 형식과 갈라진다. */

const panel = document.getElementById("export");
const codeBox = document.getElementById("export-code");
const titleBox = document.getElementById("export-title");
const noteBox = document.getElementById("export-note");

const FORMAT_LABEL = { css: "CSS 변수", json: "JSON" };
const FILENAME = { css: "tonefirst-palettes.css", json: "tonefirst-palettes.json" };

let shown = null; // { format, text }

async function showExport(format) {
  noteBox.textContent = "";
  try {
    const res = await fetch(`/api/export?format=${encodeURIComponent(format)}`);
    if (!res.ok) throw new Error(`요청이 ${res.status}`);
    const text = await res.text();
    shown = { format, text };
    const lines = text.split(/\r?\n/).length;
    titleBox.textContent = `${FORMAT_LABEL[format] ?? format} · ${lines}줄`;
    codeBox.textContent = text;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    shown = null;
    titleBox.textContent = "내보내기 실패";
    codeBox.textContent = err.message;
    panel.hidden = false;
  }
}

document.getElementById("export-css").addEventListener("click", () => showExport("css"));
document.getElementById("export-json").addEventListener("click", () => showExport("json"));
document.getElementById("export-close").addEventListener("click", () => {
  panel.hidden = true;
  shown = null;
});

document.getElementById("export-copy").addEventListener("click", async () => {
  if (!shown) return;
  try {
    await navigator.clipboard.writeText(shown.text);
    noteBox.textContent = "클립보드에 복사했습니다.";
  } catch {
    // 클립보드 권한이 없을 수 있다. 그때는 직접 고를 수 있게 선택해 준다 — 실패를 숨기지 않는다.
    const range = document.createRange();
    range.selectNodeContents(codeBox);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    codeBox.focus();
    noteBox.textContent = "클립보드에 못 넣었습니다. 전체를 선택해 뒀으니 Ctrl+C 로 복사하세요.";
  }
});

document.getElementById("export-download").addEventListener("click", () => {
  if (!shown) return;
  const blob = new Blob([shown.text], { type: shown.format === "json" ? "application/json" : "text/css" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILENAME[shown.format] ?? `tonefirst.${shown.format}`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  noteBox.textContent = `${link.download} 로 저장했습니다.`;
});

load();
refreshRuntime();
