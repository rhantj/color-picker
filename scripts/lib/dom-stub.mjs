// 게이트가 화면 코드를 **직접 부르기 위한** 최소 DOM.
//
// **의존성 0 저장소라 jsdom 을 안 들인다.** 화면 함수가 실제로 쓰는 것만 만든다 —
// `append` · `textContent` · `setAttribute` · `addEventListener` · `style`.
//
// **일부러 더 안 만든다.** 흉내가 브라우저와 어긋나는 자리는 게이트가 못 보는데,
// 더 만들수록 그런 자리가 늘고 아무도 그 어긋남을 안 본다.
//
// **그러나 브라우저보다 너그럽게는 안 만든다.** 너그러우면 게이트가 통과하는데 화면이
// 깨지고, 그게 흉내를 쓰는 값을 통째로 없앤다 — 실제로 `select.value` 를 그냥 필드로 뒀다가
// 기능을 통째로 깨는 변형이 게이트를 통과했다(21단계 리뷰가 재현).
//
// 21·22단계가 함께 쓴다. 한 벌만 둬서 두 곳이 갈라지지 않게 한다.

/* ── 최소 DOM ────────────────────────────────────────────────
   의존성 0 저장소라 jsdom 을 안 들인다. `structureCard` 가 실제로 쓰는 것만 흉내 낸다 —
   더 만들면 흉내가 브라우저와 어긋나는 자리가 늘고, 그 어긋남을 아무도 안 본다. */

function node(tag) {
  const self = {
    tag,
    children: [],
    attrs: Object.create(null),
    listeners: Object.create(null),
    className: "",
    value: "",
    type: "",
    // 스와치가 폭·색을 여기에 쓴다. 값을 검사하지는 않지만 없으면 그리다가 던진다.
    style: {},
    disabled: false,
    hidden: false,
    _text: "",
    get textContent() {
      return self._text + self.children.map((c) => c.textContent).join("");
    },
    set textContent(v) {
      self._text = String(v);
      self.children = [];
    },
    append: (...kids) => {
      for (const k of kids) self.children.push(typeof k === "string" ? textNode(k) : k);
    },
    replaceChildren: (...kids) => {
      self.children = [];
      self.append(...kids);
    },
    setAttribute: (k, v) => {
      self.attrs[k] = String(v);
    },
    getAttribute: (k) => (Object.hasOwn(self.attrs, k) ? self.attrs[k] : null),
    addEventListener: (type, fn) => {
      (self.listeners[type] ??= []).push(fn);
    },
    fire: (type) => {
      for (const fn of self.listeners[type] ?? []) fn({ target: self });
    },
    focus: () => {},
    get childElementCount() {
      return self.children.filter((c) => c.tag !== "#text").length;
    },
  };
  /*
   * **`select` 의 `value` 는 자기 `option` 을 실제로 참조한다.**
   *
   * 그냥 필드로 두면 흉내가 브라우저보다 **너그러워진다.** 진짜 `select` 는 일치하는
   * `option` 이 없는 값을 받지 않고 빈 문자열이 된다. 필드로 두면 아무 값이나 들어가서,
   * `option` 의 `value` 를 이름표로 바꿔치기하는 변형이 **`S21-G3` 을 통과했다**
   * (리뷰가 재현). 실제 브라우저에서는 그 변형이 기능을 통째로 깬다 —
   * 고르개가 아무것도 안 고른 채로 열리고, 고르면 이름표 문자열이 저장으로 가서
   * `finishOverrides` 가 조용히 버린다.
   *
   * 흉내는 최소로 두되, **브라우저보다 너그러운 자리는 만들지 않는다.** 너그러우면
   * 게이트가 통과하는데 화면은 깨진다.
   */
  if (tag === "select") {
    let picked = "";
    Object.defineProperty(self, "value", {
      get: () => picked,
      set: (v) => {
        const want = String(v);
        picked = self.children.some((c) => c.tag === "option" && c.value === want) ? want : "";
      },
    });
  }
  return self;
}

const textNode = (t) => {
  const n = node("#text");
  n.textContent = t;
  return n;
};

function installDom() {
  globalThis.document = {
    createElement: (tag) => node(tag),
    createTextNode: (t) => textNode(t),
  };
}

function findAll(root, pred, acc = []) {
  if (pred(root)) acc.push(root);
  for (const c of root.children) findAll(c, pred, acc);
  return acc;
}

export { node, textNode, installDom, findAll };
export const text = (n) => n.textContent;
