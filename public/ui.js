// 세 화면이 함께 쓰는 조각. 사용자·모델이 만든 문자열은 전부 textContent 로 넣는다 —
// innerHTML 로 조립하는 곳이 하나도 없어야 이 규칙이 유지된다.

import { labelColor } from "./color.js";
import { equalShares, ratioFor, redistribute, shareBounds } from "./ratio.js";

export const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `요청이 ${res.status}`);
  return data;
}

/** 어절 전체로 겹친 항만 굵게. 나머지는 2-gram 조각이거나 기능어라 근거가 약하다. */
export function matchedTerms(matched = []) {
  const box = el("div", "card__terms", "매칭 항 ");
  matched.forEach((m, i) => {
    if (i > 0) box.append(document.createTextNode(" "));
    box.append(m.whole ? el("b", null, m.term) : document.createTextNode(m.term));
  });
  return box;
}

/**
 * 스와치는 언제나 면적 비율을 반영한다. 저장된 조합은 저장 당시의 비율(`colors[].ratio`)을
 * 그대로 들고 다니고, 검색 결과는 화면이 ratio.js 로 계산한다.
 *
 * 비율을 바꿔 볼 수 있어야 하므로 노드만 주지 않고 `set(ratio)` 를 함께 준다 —
 * 슬라이더가 움직일 때마다 다시 만들지 않고 폭과 라벨만 갈아 끼운다.
 */
export function swatchView(colors, ratio) {
  const node = el("div", "swatch");
  const parts = colors.map(() => el("div", "swatch__part"));
  const labels = colors.map(() => el("span", "swatch__label"));
  parts.forEach((part, i) => {
    part.append(labels[i]);
    node.append(part);
  });

  const set = (next) => {
    colors.forEach((color, i) => {
      parts[i].style.width = `${next[i]}%`;
      parts[i].style.background = color.hex;
      labels[i].textContent = color.role ? `${color.role} · ${next[i]}%` : `${color.hex} · ${next[i]}%`;
      labels[i].style.color = labelColor(color.hex);
    });
  };
  set(ratio);
  return { node, set };
}

export const RATIO_MIN = 10;
export const RATIO_MAX = 90;
const RATIO_STEP = 5;

/**
 * 면적 비율 슬라이더.
 *
 * 이 사이트는 "같은 두 헥스도 비율이 바뀌면 다른 색" 이라고 말한다. 그러면 바꿔 볼 수 있어야 한다 —
 * 이 컨트롤이 그 주장을 만질 수 있게 만드는 유일한 자리다.
 * 단계를 5%로 둔 것은 면적 판단이 1% 단위로 의미 있지 않기 때문이다.
 */
export function ratioControl({ colors, value, defaultValue, onInput, onCommit }) {
  const box = el("div", "ratio");
  const slider = document.createElement("input");
  const id = `ratio-${Math.random().toString(36).slice(2, 8)}`;

  slider.type = "range";
  slider.id = id;
  slider.className = "ratio__slider";
  slider.min = String(RATIO_MIN);
  slider.max = String(RATIO_MAX);
  slider.step = String(RATIO_STEP);
  slider.value = String(value);

  const label = el("label", "ratio__label", "면적 비율");
  label.htmlFor = id;

  const readout = el("span", "ratio__readout");
  const reset = el("button", "ratio__reset", "기본값");
  reset.type = "button";

  const describe = (v) => `${colors[0].name} ${v}% · ${colors[1].name} ${100 - v}%`;
  const paint = (v) => {
    readout.textContent = `${v} : ${100 - v}`;
    slider.setAttribute("aria-valuetext", describe(v));
    reset.hidden = v === defaultValue;
  };

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    paint(v);
    onInput?.([v, 100 - v]);
  });
  // 저장은 손을 뗐을 때 한 번만. input 마다 쓰면 슬라이더 한 번에 수십 번 쓴다.
  slider.addEventListener("change", () => onCommit?.([Number(slider.value), 100 - Number(slider.value)]));

  reset.addEventListener("click", () => {
    slider.value = String(defaultValue);
    paint(defaultValue);
    onInput?.([defaultValue, 100 - defaultValue]);
    onCommit?.([defaultValue, 100 - defaultValue]);
  });

  paint(value);
  box.append(label, slider, readout, reset);
  return { node: box, set: (v) => { slider.value = String(v); paint(v); } };
}

/**
 * @param options.onRatio 비율이 바뀔 때 호출. 주면 슬라이더가 붙는다.
 * @param options.actions 카드 본문에 넣을 동작 영역
 */
/**
 * 색이 셋 이상인 팔레트의 면적 슬라이더. 색마다 하나씩 붙는다.
 *
 * 왜 2색용 ratioControl 을 쓰지 않나: 그건 슬라이더 하나로 [v, 100-v] 를 만든다. 색이 셋이면
 * 나머지 둘 사이를 어떻게 나눌지 말할 방법이 없다.
 *
 * 왜 기본이 균등인가: **3색 이상의 면적에는 원전도 실측도 없다.** 2색에는 규칙이 있지만
 * (public/ratio.js) 그건 배색사전 D형 9쌍을 재서 얻은 것이고, 파생 팔레트에는 그런 근거가 없다.
 * 규칙을 지어내는 대신 균등으로 두고 사용자가 옮겨 보게 한다 — 이 사이트가 "같은 헥스도 비율이
 * 바뀌면 다른 색" 이라고 주장하므로, 그 주장을 만질 수 있게 하는 것이 규칙을 만드는 것보다 정직하다.
 *
 * 합이 100 이라는 것과 최소 지분은 redistribute() 가 지킨다(S13-G3). 여기서는 그리기만 한다.
 */
export function shareControl({ colors, value, onInput }) {
  const box = el("div", "shares");
  const bounds = shareBounds(colors.length);
  const start = value ?? equalShares(colors.length);
  let shares = start.slice();

  const rows = colors.map((color, i) => {
    const row = el("div", "shares__row");
    const id = `share-${Math.random().toString(36).slice(2, 8)}-${i}`;

    const swatch = el("span", "shares__dot");
    swatch.style.background = color.hex;

    const label = el("label", "shares__name", color.role ?? color.name ?? color.hex);
    label.htmlFor = id;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = id;
    slider.className = "shares__slider";
    // 슬라이더 범위를 여기서 따로 계산하지 않는다. redistribute 와 갈리면 사용자가 움직인 값을
    // 계산이 조용히 되돌린다 — S5-G4 가 2색에서 같은 이유로 같은 규칙을 건다.
    slider.min = String(bounds.min);
    slider.max = String(bounds.max);
    slider.step = String(RATIO_STEP);

    const readout = el("span", "shares__readout");

    slider.addEventListener("input", () => {
      shares = redistribute(shares, i, Number(slider.value));
      paint();
      onInput?.(shares.slice());
    });

    row.append(swatch, label, slider, readout);
    return { row, slider, readout, color };
  });

  function paint() {
    rows.forEach((r, i) => {
      r.slider.value = String(shares[i]);
      r.readout.textContent = `${shares[i]}%`;
      r.slider.setAttribute(
        "aria-valuetext",
        `${r.color.role ?? r.color.hex} ${shares[i]}%`,
      );
    });
  }

  const reset = el("button", "shares__reset", "균등으로");
  reset.type = "button";
  reset.addEventListener("click", () => {
    shares = equalShares(colors.length);
    paint();
    onInput?.(shares.slice());
  });

  paint();
  box.append(...rows.map((r) => r.row), reset);
  return { node: box, shares: () => shares.slice() };
}

/**
 * 씨앗 하나를 펼친 배색 구조 카드 하나.
 *
 * 구조 이름과 원리는 data/structures.json 이 원전에서 옮겨 온 문장이라 그대로 보이고,
 * 어느 절에서 왔는지(source)도 함께 적는다 — 화면이 근거 없이 말하지 않게 하려는 것이다.
 */
/**
 * 파생 구조에서 그 모드로 그릴 색 배열을 고른다.
 *
 * **structureCard 밖으로 뺀 이유는 게이트다.** 카드 조립은 DOM 이 있어야 돌아 정적 검사밖에
 * 못 하는데, 정적 검사는 `dark` 와 `light` 를 뒤바꾼 변형을 못 잡는다(실측 — 뮤테이션 M6 이
 * 게이트 아홉을 전부 통과했다). 순수 함수로 빼면 S15-G13 이 그냥 불러서 대조한다.
 *
 * 어두운 모드는 서버가 같은 응답에 함께 실어 보낸다(S15-G10). 없으면 밝은 쪽으로 물러선다 —
 * `colorsDark` 를 모르던 시절의 응답을 받아도 화면이 비지 않게 한다.
 */
export function structureColors(structure, mode = "light") {
  return (mode === "dark" ? structure.colorsDark : null) ?? structure.colors;
}

/**
 * 파생 구조 카드.
 *
 * @param {object} structure 서버가 준 구조 하나
 * @param {"light"|"dark"} mode 어두운 모드로 볼지 (15단계)
 * @param {{assignments: Record<string,string>, names: Record<string,string>} | null} finishes
 *   역할별 재질 배정과 재질 id→이름 표. **이름을 코드에 박지 않는다** — `data/finishes.json`
 *   을 고쳐도 화면이 안 따라오면 그 어긋남을 아무도 안 알려 준다. 없으면 재질 줄을 안 그린다
 *   (17-B 이전 응답을 받아도 화면이 깨지지 않게).
 */
export function structureCard(structure, mode = "light", finishes = null) {
  const card = el("article", "struct");

  const head = el("div", "struct__head");
  head.append(
    el("h4", "struct__name", structure.name),
    el("span", "struct__source", structure.source),
  );

  const colors = structureColors(structure, mode);

  const ratio = ratioFor({ ...structure, colors });
  const view = swatchView(colors, ratio);

  const control = shareControl({
    colors,
    value: ratio,
    onInput: (next) => view.set(next),
  });

  card.append(head, el("p", "struct__principle", structure.principle), view.node);

  // 재질 줄. 역할마다 어떤 재질이 배정됐는지만 적는다 — 수치는 이 단계에 없다(사용자 결정).
  if (finishes?.assignments) {
    const line = el("div", "struct__finishes");
    for (const c of colors) {
      const id = finishes.assignments[c.role];
      if (!id) continue;
      const item = el("span", "struct__finish");
      item.append(el("b", "struct__finish-role", c.role), document.createTextNode(" "));
      item.append(el("span", "struct__finish-name", finishes.names?.[id] ?? id));
      line.append(item);
    }
    if (line.childElementCount) card.append(line);
  }

  card.append(control.node);
  return card;
}

export function paletteCard(result, rank, { featured = false, actions = null, onRatio = null } = {}) {
  const root = el("article", featured ? "card card--featured" : "card");
  const body = el("div", "card__body");

  const head = el("div", "card__head");
  head.append(
    el("span", "card__rank", String(rank).padStart(2, "0")),
    el("h3", "card__name", result.name),
    el("span", "badge badge--rank", `${result.type}형`),
  );

  const coords = el("div", "card__coords");
  for (const [key, value] of [
    ["색상각", result.hueRelation],
    ["톤", result.toneRelation],
    ["매칭", result.score.toFixed(2)],
  ]) {
    const item = el("span", null, `${key} `);
    item.append(el("b", null, value));
    coords.append(item);
  }

  body.append(head, coords, el("p", "card__text", featured ? result.impression : result.summary));

  const defaultRatio = ratioFor(result);
  const view = swatchView(result.colors, defaultRatio);

  if (onRatio) {
    const control = ratioControl({
      colors: result.colors,
      value: defaultRatio[0],
      defaultValue: defaultRatio[0],
      onInput: (next) => view.set(next),
      onCommit: (next) => onRatio(next),
    });
    body.append(control.node);
  }

  if (actions) body.append(actions);
  body.append(matchedTerms(result.matched));

  root.append(view.node, body);
  return root;
}

/**
 * 진단에서 조합으로 넘어가는 자리.
 *
 * 연결된 조합은 진단의 축이 팔레트 관계어를 그대로 써서 **코퍼스가 직접 가리키는 것**이다
 * (18개 중 2개). 나머지는 아무것도 붙이지 않고 왜 없는지만 적는다.
 *
 * **처방을 검색어로 넣는 버튼을 뒀다가 뺐다 `[실측]`.** 처방 문장은 진단 코퍼스에서 온 텍스트라
 * 진단 색인에 가장 잘 맞는다 — 18개를 전부 돌려 보니 팔레트 0건, 진단 18건이었고 그것도 모두
 * 출발한 그 진단이 1위였다. 제자리로 돌아오는 고리다. 팔레트만 검색하도록 강제하는 변형도
 * 답이 아니다. 그 경로는 `면적·순서` 가 `테라코타 × 회분홍` 을 무는 식의 낱말 겹침을 "확신" 으로
 * 내놓는다. **없는 연결은 없다고 말하는 것이 화면이 할 수 있는 가장 정직한 일이다.**
 */
function bridgeSection(dx) {
  const bridge = dx.bridge;
  const box = el("div", "dx__bridge");

  if (bridge?.palettes?.length) {
    const axis = [bridge.hue, bridge.tone].filter(Boolean).join(" + ");
    box.append(el("h4", "dx__bridge-title", `이 축에 맞는 조합 — ${axis}`));
    const list = el("ul", "dx__bridge-list");
    for (const p of bridge.palettes) {
      const item = el("li", "dx__bridge-item");
      const view = swatchView(p.colors, ratioFor(p));
      view.node.classList.add("swatch--mini");
      const text = el("div", "dx__bridge-text");
      text.append(
        el("b", "dx__bridge-name", p.name),
        el("span", "dx__bridge-rel", `${p.hueRelation} · ${p.toneRelation}`),
      );
      item.append(view.node, text);
      list.append(item);
    }
    box.append(list);
    return box;
  }

  // 연결이 없다. **없다고 말하고 끝낸다.** 위 주석의 이유로 검색으로 때우지 않는다.
  box.append(
    el(
      "p",
      "dx__bridge-none",
      "이 축은 조합의 관계(색상각·톤)를 말하지 않습니다. 코퍼스가 가리킬 조합이 없어 넘겨줄 것도 없습니다.",
    ),
  );
  return box;
}

export function diagnosisCard(dx, rank) {
  const root = el("article", "dx");
  const head = el("div", "dx__head");
  head.append(
    el("span", "card__rank", String(rank).padStart(2, "0")),
    el("h3", "dx__symptom", dx.symptom),
    el("span", "dx__axis", `의심할 축 — ${dx.axis}`),
  );
  root.append(
    head,
    el("p", "dx__prescription", dx.prescription),
    el("p", "dx__detail", dx.detail),
    bridgeSection(dx),
    matchedTerms(dx.matched),
  );
  return root;
}

/** 상단 런타임 필. 세 화면이 같은 것을 쓴다. */
const RUNTIME_LABEL = {
  ready: "로컬 · Ollama 준비됨",
  starting: "로컬 · Ollama 기동 중",
  unavailable: "로컬 · Ollama 없음",
  unknown: "로컬",
};

export async function refreshRuntime(attempt = 0, onStage) {
  const dot = document.getElementById("runtime-dot");
  const where = document.getElementById("runtime-where");
  const pill = document.getElementById("runtime");
  if (!dot) return;

  let data;
  try {
    data = await api("/api/status");
  } catch {
    return; // 상태는 부가 정보다. 못 읽어도 화면은 그대로 쓴다.
  }

  if (typeof data.stage === "number" && onStage) onStage(data.stage);

  const { state = "unknown", detail = "", models = [] } = data.ollama ?? {};
  dot.dataset.state = state;
  where.textContent = RUNTIME_LABEL[state] ?? RUNTIME_LABEL.unknown;
  pill.title = [detail, models.length ? `모델 ${models.length}개` : ""].filter(Boolean).join(" · ");

  if (state === "starting" && attempt < 20) setTimeout(() => refreshRuntime(attempt + 1, onStage), 1500);
}

export const formatWhen = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
