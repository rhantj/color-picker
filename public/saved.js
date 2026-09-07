// 추천 받은 조합 화면.

import { api, el, engineToggle, formatWhen, ratioControl, refreshRuntime, savedFields, shareControl, swatchView } from "./ui.js";

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
function noteField(entry, title) {
  const wrap = el("div", "card__note-edit");

  const input = el("input", "card__note-input");
  input.type = "text";
  input.maxLength = NOTE_MAX;
  input.value = entry.note ?? "";
  input.placeholder = "메모 (선택) — 어디에 쓸 색인지";
  // 제목은 savedFields 가 정규화한 것을 쓴다. entry.name 을 직접 읽으면 이름 없는 항목에서
  // "undefined 조합의 메모" 가 스크린리더에 나간다 — 눈에 안 보여서 더 오래 남는다.
  input.setAttribute("aria-label", `${title} 조합의 메모`);

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

  /*
   * **저장에는 두 종류가 있다** — 코퍼스 조합과 파생 팔레트. 무엇을 보여줄지는 `savedFields`
   * 한 곳에서 정한다. 여기서 `entry.type` 같은 코퍼스 전용 필드를 직접 읽으면 파생 항목에서
   * **"undefined형"** 이 뜬다. `S18-G10` 이 필드가 빠진 항목까지 넣어 그것을 검사한다.
   */
  const fields = savedFields(entry);

  const head = el("div", "card__head");
  head.append(el("h3", "card__name", fields.title), el("span", "badge badge--rank", fields.badge));

  const coords = el("div", "card__coords");
  for (const [key, value] of fields.coords) {
    const item = el("span", null, `${key} `);
    item.append(el("b", null, value));
    coords.append(item);
  }

  body.append(head, coords, el("p", "card__text", fields.text));
  body.append(noteField(entry, fields.title));

  // 저장된 조합도 비율을 다시 만질 수 있다. 저장은 슬라이더에서 손을 뗐을 때 한 번만 한다.
  // 마지막으로 서버가 받아들인 값. 실패 롤백이 여기로 돌아간다 —
  // 최초 로드 값으로 돌리면 그 사이 성공한 변경이 화면에서 사라져 서버와 어긋난다.
  /*
   * **색은 `savedFields` 가 정규화한 것을 쓴다.** `entry.colors` 를 직접 읽으면 그 필드가 없는
   * 항목에서 던지고, 그 예외가 `load()` 의 catch 로 튀어 **목록 전체가 사라진다**(리뷰 지적).
   * 그릴 색이 모자라면 비율 조작을 통째로 뺀다 — 나머지(제목·메모·삭제)는 그대로 보인다.
   */
  const colors = fields.colors;
  let current = colors.map((c) => c.ratio);
  const view = swatchView(colors, current);
  const status = el("span", "ratio__status");

  /*
   * **비율은 언제나 배열로 보낸다.** 예전에는 `ratio: next[0]` 로 숫자 하나를 보냈는데,
   * 그건 2색에서만 성립한다 — 3~4색에서는 첫 색의 지분일 뿐이라 나머지를 잃는다.
   * 서버는 두 형태를 다 받지만(S18-G8) 화면이 굳이 두 갈래를 쓸 이유가 없다.
   */
  /*
   * **응답이 순서대로 안 온다.** 다색 슬라이더는 색마다 하나씩 있어서, A 를 놓고 응답이 오기 전에
   * B 를 놓으면 요청 둘이 동시에 떠 있다. 늦게 보낸 것이 먼저 도착하면 `current` 가 옛 값으로
   * 덮여, 그 뒤 실패 롤백이 **사용자가 의도하지 않은 값**으로 되돌린다.
   *
   * 표를 뽑아 마지막 것만 반영한다. 같은 파일의 `noteField` 가 `pending` 으로 같은 문제를
   * 이미 막고 있었는데 비율 쪽에는 없었다(리뷰 지적).
   */
  let ticket = 0;
  const commit = async (next, label) => {
    const mine = ++ticket;
    status.textContent = "저장 중…";
    try {
      await api("/api/saved/ratio", { id: entry.id, ratio: next });
      if (mine !== ticket) return true; // 더 최근 조작이 있다. 이 응답은 버린다.
      current = next;
      status.textContent = `${label} 로 저장됨`;
      return true;
    } catch (err) {
      if (mine !== ticket) return false;
      status.textContent = err.message;
      view.set(current); // 실패하면 마지막으로 확인된 값으로 돌린다
      return false;
    }
  };

  // 2색은 기존 슬라이더 하나(한쪽을 올리면 반대쪽이 줄어드는 것이 눈에 보인다).
  // 3색 이상은 색마다 슬라이더가 있어야 한다 — 파생 팔레트가 그렇다(13단계).
  let control = null;
  if (colors.length === 2) {
    control = ratioControl({
      colors,
      value: current[0],
      defaultValue: (entry.defaultRatio ?? current)[0],
      onInput: (next) => view.set(next),
      onCommit: async (next) => {
        const ok = await commit(next, `${next[0]} : ${next[1]}`);
        if (!ok) control.set(current[0]);
      },
    });
  } else if (colors.length > 2) {
    control = shareControl({
      colors,
      value: current,
      onInput: (next) => view.set(next),
      onCommit: async (next) => {
        const ok = await commit(next, next.join(" : "));
        // 실패하면 슬라이더도 되돌린다. 스와치만 되돌리면 화면에 두 비율이 동시에 보이고,
        // 다음 조작이 되돌아가지 않은 값을 기준으로 계산된다.
        if (!ok) control.set(current);
      },
    });
  }
  if (control) body.append(control.node, status);
  else body.append(el("p", "card__text", "색을 읽을 수 없어 비율을 조정할 수 없습니다."));

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
    /*
     * **한 항목이 나머지를 죽이지 않게 한다.** `savedFields` 가 표시와 색을 정규화하지만,
     * 여기서 한 겹 더 두는 이유는 **다음에 무엇이 던질지 모르기 때문**이다. 실제로 `colors` 가
     * 없는 항목 하나가 목록 전체를 비웠다. 조용히 넘기지 않고 그 자리에 무슨 일인지 남긴다.
     */
    for (const entry of saved) {
      try {
        list.append(savedCard(entry, dropCard));
      } catch (err) {
        list.append(el("p", "empty", `이 항목을 그리지 못했습니다 — ${err.message}`));
      }
    }
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

const FORMAT_LABEL = { css: "CSS 변수", json: "JSON", unreal: "언리얼 엔진", unity: "유니티" };
const FILENAME = {
  css: "tonefirst-palettes.css",
  json: "tonefirst-palettes.json",
  unreal: "tonefirst-unreal.json",
  unity: "tonefirst-unity.json",
};
const MIME = { css: "text/css" };

const engineBtn = document.getElementById("export-engine");

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
    /*
     * 엔진 형식일 때만 토글을 보인다. 어디에 있는지가 아니라 **어디로 가는지**를 적는다 —
     * 두 표기는 거울 방향이 반대라(언리얼 0 = 거울, 유니티 1 = 거울) 어느 쪽을 보고 있는지
     * 헷갈리면 그대로 잘못 붙여넣게 된다.
     */
    const toggle = engineToggle(format);
    engineBtn.hidden = !toggle.visible;
    engineBtn.textContent = toggle.label;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    shown = null;
    engineBtn.hidden = true;
    titleBox.textContent = "내보내기 실패";
    codeBox.textContent = err.message;
    panel.hidden = false;
  }
}

document.getElementById("export-css").addEventListener("click", () => showExport("css"));
document.getElementById("export-json").addEventListener("click", () => showExport("json"));
// 엔진 수치는 언리얼부터 연다. 토글이 그 자리에서 유니티로 뒤집는다.
document.getElementById("export-engine-open").addEventListener("click", () => showExport("unreal"));
engineBtn.addEventListener("click", () => {
  const next = engineToggle(shown?.format).next;
  if (next) showExport(next);
});
document.getElementById("export-close").addEventListener("click", () => {
  panel.hidden = true;
  engineBtn.hidden = true;
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
  // 형식이 넷이 됐다. "json 인가 아닌가" 로 갈랐더니 엔진 파일이 text/css 로 저장됐다.
  const blob = new Blob([shown.text], { type: MIME[shown.format] ?? "application/json" });
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
