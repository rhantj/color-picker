// 추천 받은 조합 화면.

import { api, el, formatWhen, ratioControl, refreshRuntime, swatchView } from "./ui.js";

const list = document.getElementById("list");

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
  if (entry.note) body.append(el("p", "card__note", entry.note));

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
      onRemoved();
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

async function load() {
  try {
    const { saved } = await api("/api/saved");
    list.replaceChildren();
    if (saved.length === 0) {
      list.append(el("p", "empty", "저장한 조합이 없습니다. 홈에서 추천을 받고 ‘조합 저장’ 을 누르세요."));
      return;
    }
    for (const entry of saved) list.append(savedCard(entry, load));
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
