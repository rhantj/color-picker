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

/*
 * **쓸 수 있는 재질.** 서버가 카탈로그에서 만들어 보내 주지만(`finishes.names`), 응답이
 * 없거나 손상됐을 때도 화면이 모르는 값을 담지 않도록 기본값을 둔다.
 *
 * `src/material.js` 의 `MATERIAL_FINISHES` 와 **같아야 하는 사본**이다. 서로 어긋나면
 * 화면이 고를 수 있는 것과 서버가 받는 것이 달라져, 사용자가 고른 재질이 저장에서
 * 조용히 기본값으로 바뀐다. `S21-G1` 이 두 목록을 대조한다.
 * (전에는 이 주석이 대조한다고 적어 놓고 실제로는 게이트가 자기 사본하고만 비교했다 —
 * 리뷰가 잡았다.)
 */
export const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);

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
export function shareControl({ colors, value, onInput, onCommit }) {
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
    // 놓는 순간에만 저장한다. `input` 마다 저장하면 슬라이더를 끄는 동안 요청이 수십 번 나간다.
    // `ratioControl` 이 2색에서 같은 이유로 같은 자리를 쓴다.
    slider.addEventListener("change", () => onCommit?.(shares.slice()));

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
    onCommit?.(shares.slice());
  });

  paint();
  box.append(...rows.map((r) => r.row), reset);
  /*
   * `set` 은 **실패 롤백을 위한 것**이다. 저장이 실패했을 때 스와치만 되돌리고 슬라이더를 그대로
   * 두면 화면에 서로 다른 두 비율이 동시에 보이고, 사용자가 다시 만질 때 `redistribute` 가
   * **되돌아가지 않은 값**을 기준으로 계산한다. `ratioControl` 이 2색에서 같은 이유로 같은 것을 준다.
   */
  return {
    node: box,
    shares: () => shares.slice(),
    set: (next) => {
      shares = next.slice();
      paint();
    },
  };
}

/**
 * 저장된 항목 하나를 **무엇으로 그릴지** 정한다. DOM 을 안 만지는 순수 함수다.
 *
 * **저장에는 두 종류가 있다.** 코퍼스 조합(`type`·`색상각`·`요약`)과 파생 팔레트
 * (`구조 이름`·`원리`·`씨앗`·`모드`). 화면이 코퍼스 필드를 그냥 읽으면 파생 항목에서
 * **"undefined형"** 이 뜬다.
 *
 * **함수로 뺀 이유는 게이트다.** `/saved` 는 브라우저 화면이라 정적 검사밖에 못 하는데,
 * 정적 검사는 "무엇이 화면에 나가는가" 를 못 본다. 순수 함수면 게이트가 그냥 불러서 대조한다 —
 * 17단계에서 `structureColors` 를 뺀 것과 같은 이유이고, 그때 정적 검사가 `dark`/`light` 를
 * 뒤바꾼 변형을 못 잡았다. `S18-G10` 이 필드가 빠진 항목까지 넣어 본다.
 *
 * **빈 자리를 문자열로 채운다.** 옛 저장이나 손상된 파일은 필드가 없을 수 있고, 그때
 * `undefined` 가 화면에 나가는 것이 이 함수가 막는 것이다.
 *
 * **색도 함께 정규화한다.** 표시 문자열만 막아 두면 화면이 `entry.colors` 를 직접 읽다가
 * 던진다 — `colors` 가 없는 항목 하나가 `/saved` 목록을 **통째로** 비웠다(리뷰 지적, 재현 확인).
 * 막을 것은 "undefined 가 화면에 나가는 것" 만이 아니라 **"한 항목이 나머지를 죽이는 것"** 이다.
 *
 * @returns {{kind:"palette"|"derived", title:string, badge:string, text:string,
 *            coords:[string,string][], colors:{hex:string, ratio:number, role?:string}[]}}
 */
export function savedFields(entry) {
  const e = entry ?? {};
  const or = (value, fallback) => (typeof value === "string" && value.trim() ? value : fallback);

  // 그릴 수 있는 색만 남긴다. 헥스가 없거나 비율이 정수가 아니면 스와치도 슬라이더도 못 만든다.
  const colors = (Array.isArray(e.colors) ? e.colors : []).filter(
    (c) => c && typeof c.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(c.hex) && Number.isInteger(c.ratio),
  );

  if (e.kind === "derived") {
    return {
      kind: "derived",
      title: or(e.name, "이름 없는 구조"),
      // 모드가 곧 이 항목의 정체다 — 같은 구조라도 밝은 것과 어두운 것은 색이 다르다.
      badge: e.mode === "dark" ? "어두운 배경" : "밝은 배경",
      text: or(e.principle, ""),
      coords: [
        ["씨앗", or(e.seedLabel, or(e.seedId, "모름"))],
        ["출처", or(e.source, "모름")],
      ],
      colors,
    };
  }

  // kind 가 없는 옛 항목은 코퍼스 조합이다. 파생은 이 단계부터 늘 kind 를 붙인다.
  return {
    kind: "palette",
    title: or(e.name, "이름 없는 조합"),
    badge: e.type ? `${e.type}형` : "유형 모름",
    text: or(e.summary, ""),
    coords: [
      ["색상각", or(e.hueRelation, "모름")],
      ["톤", or(e.toneRelation, "모름")],
    ],
    colors,
  };
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
/**
 * 재질 고르개에 넣을 항목을 만든다.
 *
 * **한글 이름을 쓴다.** 화면에 `metal` 이라고 뜨면 사용자가 그것이 무엇인지 모른다.
 * 이름은 카탈로그(`data/finishes.json`)가 갖고 있고 서버가 `finishes.names` 로 보낸다.
 * 이름이 없으면 id 로 물러선다 — 고르개가 통째로 비는 것보다 낫다.
 *
 * **LLM 이 고른 것에 표시를 붙인다.** 사용자가 이것저것 바꿔 본 뒤 원래로 돌아가려 할 때,
 * 어느 것이 원래였는지 알 방법이 필요하다. 되돌리기 버튼과 그 상태를 따로 만드는 대신
 * **목록 안에 적어** 상태를 하나도 안 늘린다.
 *
 * @param {string[]} ids 쓸 수 있는 재질. 서버가 카탈로그에서 만들어 보낸다
 * @param {Record<string,string>|null} names 재질 id → 한글 이름
 * @param {string|null} assigned LLM(또는 기본값)이 이 자리에 배정한 것
 */
export function finishOptions(ids, names, assigned) {
  const list = Array.isArray(ids) ? ids : [];
  return list.map((id) => {
    // 자기 속성만 본다. 카탈로그가 손상되면 `__proto__` 같은 이름이 값을 물고 나온다.
    const name = names && Object.hasOwn(names, id) && typeof names[id] === "string" ? names[id] : id;
    return { id, label: id === assigned ? `${name} (LLM 배정)` : name };
  });
}

/**
 * 사용자가 손으로 바꾼 재질 배정을 담아 둔다.
 *
 * **구조마다 따로 담는다.** 배정 표는 역할별로 하나다(`본문 → 광택`) — 카드 여덟이 그것을
 * 함께 본다. 그대로 고치면 **한 카드를 건드렸는데 나머지 일곱이 조용히 바뀐다.** 사용자는
 * 하나의 배색을 다듬는 중이고, 저장도 구조 단위다.
 *
 * **이 상태는 카드 밖에 두어야 한다.** 모드 토글이 격자를 통째로 다시 그리므로(`redraw`),
 * 카드 안에 두면 어두운 모드로 바꾸는 순간 고친 것이 전부 사라진다. 15단계에서 겪은 것과
 * 같은 부류이고 `S21-G4` 가 그 자리를 검사한다.
 *
 * **모르는 값은 안 받는다.** 여기 담긴 것이 그대로 저장 요청에 실린다. 서버가 다시 거르지만
 * (S19-G1) 화면이 모르는 값을 들고 있으면 **화면과 저장이 어긋난 채로** 보인다 —
 * 사용자는 벨벳으로 저장했다고 믿고 저장소에는 무광이 앉는다.
 */
export function finishOverrides(valid = FINISH_IDS) {
  const known = new Set(valid);
  // 구조 id → (역할 → 재질). 프로토타입 없는 Map 이라 `__proto__` 가 키로 와도 안전하다.
  const byStructure = new Map();

  return {
    set(structureId, role, finishId) {
      if (typeof structureId !== "string" || typeof role !== "string") return;
      if (typeof finishId !== "string" || !known.has(finishId)) return;
      if (!byStructure.has(structureId)) byStructure.set(structureId, new Map());
      byStructure.get(structureId).set(role, finishId);
    },

    /**
     * 이 구조에 실제로 쓸 배정을 만든다 — **그 구조의 역할만.**
     *
     * 배정 표는 일곱 역할 전부를 담고 있지만 구조마다 쓰는 것은 3~4개다. 통째로 넘기면
     * 서버가 어차피 거르지만(S19-G1), 화면이 무엇을 저장하는지 스스로 알고 보내는 편이 맞다.
     */
    forStructure(structure, base) {
      const mine = byStructure.get(structure?.id);
      const out = Object.create(null);
      for (const color of structure?.colors ?? []) {
        const role = color?.role;
        if (typeof role !== "string") continue;
        const picked = mine?.get(role);
        if (picked) {
          out[role] = picked;
          continue;
        }
        // 원래 배정도 자기 속성만 본다 — 서버 응답이 손상됐을 때 프로토타입에서 값이 샌다.
        if (base && Object.hasOwn(base, role) && known.has(base[role])) out[role] = base[role];
      }
      return out;
    },
  };
}

/**
 * 카드에 넘길 재질 편집 묶음을 만든다 — **지금 보일 배정**과 **고쳤을 때 할 일**.
 *
 * **화면 코드에서 이걸 빼낸 이유는 게이트다.** 이 단계에서 가장 중요한 보장이
 * "재질을 고쳐도 서버를 다시 안 부른다" 인데(부르면 `selectStructures` 가 다시 돌아
 * **보이는 다섯이 바뀐다**), 그것을 `app.js` 소스에서 `api(` 라는 글자를 찾는 방식으로
 * 재고 있었다. 리뷰가 그 검사를 **한 줄로 우회**했다 — 호출을 이름 붙인 헬퍼로 빼서
 * 검사 창 밖에 두면 그만이었고, 그건 난독화가 아니라 **평범한 리팩터링**이다.
 *
 * 순수 함수로 빼면 게이트가 이것을 직접 부르고 **네트워크를 실제로 감시**할 수 있다.
 * 17단계 `structureColors` · 18단계 `savedFields` · 20단계 `engineToggle` 과 같은 자리다.
 *
 * **여기서 하는 일은 담아 두는 것뿐이다.** 다시 그리지 않는다 — 그리면 사용자가 맞춘
 * 면적 비율과 포커스가 날아간다(실측). 고르개는 고른 값을 이미 스스로 보이고 있고,
 * 카드의 나머지는 재질과 무관하다. 합치기는 다음에 격자가 갈릴 때 `forStructure` 가 한다.
 *
 * @param {{set:Function, forStructure:Function}} store `finishOverrides()` 가 만든 것
 * @param {object} structure 이 카드의 구조
 * @param {Record<string,string>|null} base 서버가 준 원래 배정
 */
export function finishEditing(store, structure, base) {
  return {
    assignments: store.forStructure(structure, base),
    onFinish: (role, finishId) => store.set(structure?.id, role, finishId),
  };
}

export function structureColors(structure, mode = "light") {
  return (mode === "dark" ? structure.colorsDark : null) ?? structure.colors;
}

/**
 * 파생 구조 카드.
 *
 * @param {object} structure 서버가 준 구조 하나
 * @param {"light"|"dark"} mode 어두운 모드로 볼지 (15단계)
 * @param {{assignments: Record<string,string>, names?: Record<string,string>, ids?: string[]} | null} finishes
 *   역할별 재질 배정과 재질 id→이름 표. **이름을 코드에 박지 않는다** — `data/finishes.json`
 *   을 고쳐도 화면이 안 따라오면 그 어긋남을 아무도 안 알려 준다. 없으면 재질 줄을 안 그린다
 *   (17-B 이전 응답을 받아도 화면이 깨지지 않게). `ids` 를 안 주면 `FINISH_IDS` 로 물러선다.
 * @param {((shares:number[]) => Promise<unknown>)|null} onSave 저장 버튼을 붙일 때 넘긴다.
 *   **색은 안 받는다** — 씨앗·구조·모드만 알면 서버가 다시 계산한다(`S18-G1`).
 * @param {{assignments: Record<string,string>, onFinish: (role:string, finishId:string) => void}|null} editing
 *   재질을 고칠 수 있게 할 때 넘긴다(21단계). 안 넘기면 17단계의 읽기 전용 표시 그대로다.
 *   **`onFinish` 는 담아 두기만 해야 한다** — 거기서 카드를 다시 그리면 사용자가 맞춘 비율과
 *   포커스가 날아간다(`S21-G4` 가 검사한다).
 */
export function structureCard(structure, mode = "light", finishes = null, onSave = null, editing = null) {
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

  /*
   * 재질 줄. 역할마다 어떤 재질이 배정됐는지만 적는다 — 수치는 화면에 안 낸다(사용자 결정).
   *
   * **`editing` 을 주면 고를 수 있게 된다(21단계).** 안 주면 17단계의 읽기 전용 표시 그대로다 —
   * 이 카드는 홈에서만 쓰지만, 고르개를 늘 그리면 "볼 수만 있는 자리" 를 만들 수 없게 된다.
   */
  if (finishes?.assignments) {
    const shown = editing?.assignments ?? finishes.assignments;
    const line = el("div", "struct__finishes");
    for (const c of colors) {
      // 자기 속성만 본다. 서버 응답이 손상되면 `__proto__` 같은 역할 이름이 값을 물고 나온다.
      const id = Object.hasOwn(shown, c.role) ? shown[c.role] : null;
      if (!id) continue;
      const item = el("span", "struct__finish");
      item.append(el("b", "struct__finish-role", c.role), document.createTextNode(" "));

      if (editing?.onFinish) {
        const pick = el("select", "struct__finish-pick");
        // 역할 이름을 붙여 읽어 준다. "무광" 만 들리면 어느 자리의 재질인지 알 수 없다.
        pick.setAttribute("aria-label", `${c.role}의 재질`);
        // 어느 역할의 고르개인지를 DOM 에 남긴다 — 게이트가 이것으로 짝을 맞춘다.
        pick.setAttribute("data-role", c.role);
        for (const opt of finishOptions(finishes.ids ?? FINISH_IDS, finishes.names, finishes.assignments[c.role])) {
          const node = el("option", null, opt.label);
          node.value = opt.id;
          pick.append(node);
        }
        pick.value = id;
        pick.addEventListener("change", () => editing.onFinish(c.role, pick.value));
        item.append(pick);
      } else {
        const name = finishes.names && Object.hasOwn(finishes.names, id) ? finishes.names[id] : id;
        item.append(el("span", "struct__finish-name", name));
      }
      line.append(item);
    }
    if (line.childElementCount) card.append(line);
  }

  card.append(control.node);

  /*
   * 저장 버튼. **색을 안 보낸다** — 호출부는 씨앗·구조·모드만 알면 되고 서버가 색을 다시
   * 계산한다(`src/store.js` 규칙 4, `S18-G1`). 여기서 넘기는 것은 **지금 맞춘 비율**뿐이다.
   *
   * 비율을 안 넘기면 슬라이더로 맞춘 것이 저장에 안 실린다 — 이 사이트가 "같은 두 헥스도
   * 비율이 바뀌면 다른 색" 이라고 말해 온 것을 저장이 배신하게 된다.
   */
  if (onSave) {
    const box = el("div", "struct__save");
    const button = el("button", "struct__save-button", "이 배색 저장");
    button.type = "button";
    const feedback = el("span", "struct__save-feedback");
    button.addEventListener("click", async () => {
      button.disabled = true;
      feedback.textContent = "저장 중…";
      try {
        await onSave(control.shares());
        feedback.textContent = "저장됨";
      } catch (err) {
        // 실패를 삼키면 사용자는 저장된 줄 안다.
        feedback.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });
    box.append(button, feedback);
    card.append(box);
  }

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

/*
 * **내보내기 패널의 엔진 토글이 무엇을 할지 정한다.**
 *
 * 언리얼 `Roughness` 는 0이 거울, 유니티 `Smoothness` 는 1이 거울로 정반대다. 두 표기를
 * **오가면서 비교할 수 있어야** 어느 쪽을 붙여넣는지 사용자가 안다. 그래서 버튼 하나가
 * 지금 보이는 출력을 뒤집는다.
 *
 * **라벨은 지금이 아니라 갈 곳을 말한다.** "언리얼" 이라고만 적혀 있으면 지금이 언리얼인지
 * 누르면 언리얼이 되는지 알 수 없다. 15단계 모드 토글이 "어두운 배경으로 보기" 라고 적는
 * 것과 같은 규칙이다.
 *
 * **화면을 못 보는 사람에게는 그것만으로 부족하다.** 눈으로 보면 바로 위 제목에 "언리얼
 * 엔진" 이 떠 있어서 지금이 어디인지 알지만, 버튼으로 바로 이동하면 그 제목을 안 지난다 —
 * "유니티 표기로 보기" 만 들리고 지금이 어디인지는 모른다. 그래서 `speech` 가 **지금과 갈
 * 곳을 함께** 말한다(`aria-label`).
 *
 * **`aria-pressed` 를 안 쓴다.** 15단계 모드 토글은 그것을 쓰지만 거기는 "어두운 모드가
 * 켜졌는가" 라는 이진 상태다. 여기는 **둘 사이를 오가는 전환**이라 눌림/안 눌림이 언리얼·
 * 유니티에 대응되지 않는다 — 읽어 주면 오히려 틀린 말이 된다. (리뷰가 같은 자리를 지적했고,
 * 상태 표시가 빠졌다는 지적은 맞지만 그 수단은 이쪽이 맞다고 봤다.)
 *
 * **`speech` 는 보이는 글자를 그대로 포함한다.** 음성으로 조작하는 사람은 눈에 보이는 것을
 * 말해서 버튼을 누르므로, 라벨이 보이는 글자를 안 담으면 그 방법이 막힌다.
 *
 * **순수 함수로 빼는 이유는 게이트다.** 화면 코드는 정적 검사밖에 못 하는데 정적 검사는
 * "눌렀을 때 어디로 가는가" 를 못 본다. 17단계 `structureColors` · 18단계 `savedFields` 와
 * 같은 자리다.
 *
 * @param {unknown} format 지금 보고 있는 형식
 * @returns {{visible:boolean, next:string|null, label:string, speech:string}}
 *   `label` 은 눈으로 읽는 글자, `speech` 는 읽어 주는 문장(`aria-label`)이다.
 */
export function engineToggle(format) {
  const ENGINE_KO = { unreal: "언리얼", unity: "유니티" };
  // 자기 속성만 본다. `__proto__`·`constructor` 는 평범한 객체에서 값을 물고 나온다.
  if (typeof format !== "string" || !Object.hasOwn(ENGINE_KO, format)) {
    return { visible: false, next: null, label: "", speech: "" };
  }
  const next = format === "unreal" ? "unity" : "unreal";
  const label = `${ENGINE_KO[next]} 표기로 보기`;
  return { visible: true, next, label, speech: `지금 ${ENGINE_KO[format]} 표기 · ${label}` };
}

export const formatWhen = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
