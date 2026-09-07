#!/usr/bin/env node
// 21단계(재질을 손으로 바꾼다) · A3 완료 조건 검사기.
//   node scripts/check-stage21.mjs S21-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 전부 실패하는 것을 확인한 뒤에
// public/ui.js 와 public/app.js 를 고쳤다.
//
// **이 단계가 막으려는 것 셋:**
//   1. 고친 재질이 **모드 토글에 날아가는 것** — redraw 가 격자를 통째로 간다(15단계와 같은 함정)
//   2. 한 카드를 고쳤는데 **나머지 일곱이 같이 바뀌는 것** — 배정 표는 역할별로 하나다
//   3. 재질을 바꾸려고 **`/api/expand` 를 다시 부르는 것** — 그러면 보이는 다섯이 바뀐다(S15-G11)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findAll, installDom, text } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **재질 목록을 여기 다시 적는다.** 감시할 대상에서 가져오면 그것을 바꾸는 순간 게이트가
 * 함께 느슨해진다. 이 저장소가 같은 부류로 다섯 번 뚫렸다.
 */
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const FINISH_KO = Object.freeze({ matte: "무광", gloss: "광택", metal: "메탈릭", emissive: "발광" });

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 구조 하나를 흉내 낸 최소 입력. 실제 `expandSeed` 결과와 같은 모양이면 된다. */
const structure = (id, roles) => ({
  id,
  name: `${id} 구조`,
  source: "시험",
  principle: "시험용",
  colors: roles.map((role, i) => ({ role, hex: `#${(i + 1).toString(16).repeat(6)}` })),
});

const GATES = {
  /*
   * **고르개가 실재하는 재질 넷을 전부 준다.**
   *
   * 목록이 모자라면 사용자가 고를 수 없는 재질이 생기고, 남으면 저장소가 거절하는 값을
   * 화면이 권하는 꼴이 된다(`pickFinishes` 가 모르는 재질을 버린다 — S19-G1).
   *
   * **한글 이름을 쓴다.** 화면에 `metal` 이라고 뜨면 사용자가 그것이 무엇인지 모른다.
   * 이름은 카탈로그(`data/finishes.json`)가 갖고 있고 서버가 `finishes.names` 로 보낸다.
   */
  "S21-G1": async () => {
    const bad = [];
    const { finishOptions } = await import("../public/ui.js");
    if (typeof finishOptions !== "function") {
      out("public/ui.js 가 finishOptions 를 안 내보낸다");
      return false;
    }

    const names = { matte: "무광", gloss: "광택", metal: "메탈릭", emissive: "발광" };
    const list = finishOptions(FINISH_IDS, names, "gloss");
    if (!Array.isArray(list)) {
      out(`finishOptions 가 배열이 아니다 (${typeof list})`);
      return false;
    }
    if (list.length !== FINISH_IDS.length) bad.push(`고를 것이 ${list.length}개 (넷이어야 한다)`);
    for (const id of FINISH_IDS) {
      const found = list.find((o) => o.id === id);
      if (!found) {
        bad.push(`${id} 를 고를 수 없다`);
        continue;
      }
      if (!String(found.label).includes(FINISH_KO[id])) bad.push(`${id} 가 한글 이름을 안 쓴다 (${found.label})`);
    }
    // LLM 이 고른 것에 표시가 붙는다 — 되돌릴 길이 상태 없이 생긴다.
    const llm = list.find((o) => o.id === "gloss");
    const others = list.filter((o) => o.id !== "gloss");
    if (!/LLM/.test(String(llm?.label))) bad.push(`LLM 배정에 표시가 없다 (${llm?.label})`);
    for (const o of others) {
      if (/LLM/.test(String(o.label))) bad.push(`${o.id} 에 엉뚱한 LLM 표시가 있다 (${o.label})`);
    }
    // 이름을 모를 때도 고를 수는 있어야 한다. 화면이 통째로 비는 것보다 낫다.
    const nameless = finishOptions(FINISH_IDS, null, null);
    if (nameless.length !== FINISH_IDS.length) bad.push(`이름이 없으면 고르개가 ${nameless.length}개로 준다`);
    if (nameless.some((o) => /LLM/.test(String(o.label)))) bad.push("LLM 배정이 없는데 표시가 붙는다");

    /*
     * **재질 id 는 서버가 보낸 값이다.** 카탈로그가 손상되거나 바뀌면 `constructor` 같은
     * 이름이 올 수 있고, 그때 이름표에서 함수를 꺼내 오면 화면에 함수 원문이 찍힌다.
     * 자기 속성인지 · 문자열인지 둘 다 봐야 막힌다 — 한쪽만 빼는 변형이 살아남았다.
     */
    for (const weird of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      for (const [what, table] of [["빈 이름표", {}], ["이름표 없음", null]]) {
        const [opt] = finishOptions([weird], table, null);
        if (typeof opt?.label !== "string") {
          bad.push(`${what}에서 ${weird} 의 이름이 ${typeof opt?.label} 이다 — 화면에 그것이 찍힌다`);
        }
      }
    }
    // 이름이 문자열이 아닌 값으로 와도 마찬가지다.
    const [bogus] = finishOptions(["matte"], { matte: { toString: () => "무광" } }, null);
    if (typeof bogus?.label !== "string") bad.push(`이름이 객체일 때 ${typeof bogus?.label} 이 나온다`);

    /*
     * **화면의 사본이 엔진의 목록과 같은지 대조한다.**
     *
     * `public/ui.js` 의 `FINISH_IDS` 는 `src/material.js` 의 `MATERIAL_FINISHES` 사본이다.
     * 어긋나면 **화면이 고를 수 있는 것과 서버가 받는 것이 달라져**, 사용자가 고른 재질이
     * 저장에서 조용히 기본값으로 바뀐다.
     *
     * 게이트 자신의 사본까지 셋을 맞춘다 — 두 쪽을 함께 고치면서 게이트를 안 고치는 것을
     * 막기 위해서다. (전에는 `ui.js` 주석이 "여기서 대조한다" 고 적어 놓고 실제 대조가
     * 없었다. 리뷰가 잡았다.)
     */
    const { FINISH_IDS: uiList } = await import("../public/ui.js");
    const { MATERIAL_FINISHES } = await import("../src/material.js");
    const asText = (v) => [...(v ?? [])].sort().join(",");
    const mine = asText(FINISH_IDS);
    if (asText(uiList) !== mine) bad.push(`ui.js 의 목록이 [${uiList}] — 게이트가 아는 것은 [${FINISH_IDS}]`);
    if (asText(MATERIAL_FINISHES) !== mine) {
      bad.push(`material.js 의 목록이 [${MATERIAL_FINISHES}] — 게이트가 아는 것은 [${FINISH_IDS}]`);
    }

    out(bad.length ? bad.slice(0, 8).join("\n") : "고르개가 재질 넷을 한글 이름으로 주고 LLM 배정에만 표시가 붙는다 (화면·엔진 목록 일치)");
    return bad.length === 0;
  },

  /*
   * **바꾼 배정이 구조마다 따로 산다.**
   *
   * 배정 표는 역할별로 하나다(`본문 → 광택`). 카드 여덟이 그것을 함께 보므로, 그대로 고치면
   * **한 카드를 건드렸는데 나머지 일곱이 조용히 바뀐다.** 사용자는 하나의 배색을 다듬는
   * 중이고 저장도 구조 단위다.
   *
   * 여기서 무는 것은 순수 함수 `finishOverrides` — 어느 구조의 어느 역할이 무엇으로
   * 바뀌었는지를 담고, 원래 배정과 합쳐 **그 구조의 역할만** 돌려준다.
   */
  "S21-G2": async () => {
    const bad = [];
    const { finishOverrides } = await import("../public/ui.js");
    if (typeof finishOverrides !== "function") {
      out("public/ui.js 가 finishOverrides 를 안 내보낸다");
      return false;
    }

    const base = { 바탕: "matte", 본문: "gloss", 강조: "emissive", 면: "metal" };
    const three = structure("comp", ["바탕", "본문", "강조"]);
    const four = structure("wide", ["바탕", "면", "본문", "강조"]);

    const store = finishOverrides();
    // 아무것도 안 바꿨으면 원래 배정 그대로, 그 구조의 역할만.
    const a0 = store.forStructure(three, base);
    if (String(Object.keys(a0).sort()) !== String(["강조", "바탕", "본문"])) {
      bad.push(`3색 구조인데 역할이 ${Object.keys(a0)}`);
    }
    if (a0.본문 !== "gloss") bad.push(`안 바꿨는데 본문이 ${a0.본문}`);
    if ("면" in a0) bad.push("그 구조에 없는 역할이 섞였다");

    // 한 구조에서 바꾼다.
    store.set("comp", "본문", "matte");
    if (store.forStructure(three, base).본문 !== "matte") bad.push("바꾼 것이 안 반영된다");
    if (store.forStructure(four, base).본문 !== "gloss") {
      bad.push("한 구조를 바꿨더니 다른 구조까지 바뀐다 — 안 건드린 카드가 조용히 달라진다");
    }

    // 같은 구조의 다른 역할은 안 건드린다.
    if (store.forStructure(three, base).바탕 !== "matte") bad.push("같은 구조의 다른 역할이 함께 바뀌었다");

    // 원래 값으로 되돌리는 것도 되어야 한다.
    store.set("comp", "본문", "gloss");
    if (store.forStructure(three, base).본문 !== "gloss") bad.push("원래 값으로 못 되돌린다");

    /*
     * **이상한 것을 받지 않는다.** 이 값은 그대로 저장 요청에 실린다. 서버가 다시 거르지만
     * (S19-G1) 화면이 모르는 값을 담고 있으면 화면과 저장이 어긋난 채로 보인다.
     */
    for (const evil of ["velvet", "__proto__", "", null, undefined, 7, ["matte"]]) {
      store.set("comp", "본문", evil);
      if (store.forStructure(three, base).본문 !== "gloss") bad.push(`모르는 재질 ${String(evil)} 이 들어갔다`);
    }
    for (const evilRole of ["__proto__", "constructor", "없는역할"]) {
      store.set("comp", evilRole, "matte");
      const got = store.forStructure(three, base);
      if (Object.hasOwn(got, evilRole)) bad.push(`그 구조에 없는 역할 ${evilRole} 이 실렸다`);
    }
    if (Object.getPrototypeOf(store.forStructure(three, base)) !== null) {
      bad.push("돌려주는 것이 프로토타입 없는 객체가 아니다");
    }

    /*
     * **원래 배정도 못 믿는다.** 이것은 서버 응답이다 — 카탈로그가 바뀌면 화면이 모르는
     * 재질 id 가 오고, 손상되면 역할 이름이 프로토타입 키일 수 있다. 그대로 실으면
     * **사용자는 그 재질로 저장했다고 믿는데** 서버가 거르고(S19-G1) 기본값이 앉는다.
     */
    const fresh = finishOverrides();
    const strange = fresh.forStructure(three, { 바탕: "velvet", 본문: 7, 강조: null });
    for (const role of ["바탕", "본문", "강조"]) {
      if (Object.hasOwn(strange, role)) bad.push(`원래 배정의 모르는 값이 실렸다 (${role} = ${strange[role]})`);
    }
    const protoRole = structure("proto", ["constructor", "toString"]);
    const leaked = fresh.forStructure(protoRole, {});
    for (const role of ["constructor", "toString"]) {
      if (Object.hasOwn(leaked, role)) bad.push(`빈 배정인데 ${role} 이 값을 물고 나왔다 (${String(leaked[role]).slice(0, 30)})`);
    }
    // 양성 대조 — 멀쩡한 값은 그대로 실린다. 위 검사가 "늘 비어 있다" 가 아님을 안다.
    const okay = fresh.forStructure(three, base);
    if (okay.본문 !== "gloss") bad.push(`양성 대조 실패 — 멀쩡한 배정이 ${okay.본문}`);

    out(bad.length ? bad.slice(0, 8).join("\n") : "바꾼 배정이 구조마다 따로 살고, 모르는 재질·역할 10가지가 안 들어간다");
    return bad.length === 0;
  },

  /*
   * **카드가 고르개를 그리고, 고르면 알려 준다.**
   *
   * 정적 검사로는 "무엇이 화면에 나가는가" 를 못 보므로 `structureCard` 를 직접 부른다.
   * 브라우저가 없으니 DOM 을 흉내 내는 최소 구현을 여기서 만든다 — 의존성 0 저장소라
   * jsdom 을 들이지 않는다.
   */
  "S21-G3": async () => {
    const bad = [];
    installDom();
    const { structureCard } = await import("../public/ui.js");

    const st = structure("comp", ["바탕", "본문", "강조"]);
    const finishes = {
      assignments: { 바탕: "matte", 본문: "gloss", 강조: "emissive" },
      names: FINISH_KO,
    };
    const changed = [];
    const card = structureCard(st, "light", finishes, null, {
      assignments: finishes.assignments,
      onFinish: (role, id) => changed.push([role, id]),
    });

    const selects = findAll(card, (n) => n.tag === "select");
    if (selects.length !== 3) bad.push(`고르개가 ${selects.length}개다 (역할 3개여야 한다)`);
    for (const sel of selects) {
      if (sel.children.length !== FINISH_IDS.length) bad.push(`고를 것이 ${sel.children.length}개다`);
      if (!sel.attrs["aria-label"]) bad.push("고르개에 읽어 줄 이름이 없다 — 무엇을 고르는지 모른다");
    }
    // 지금 배정이 골라져 있어야 한다. 안 그러면 첫 항목이 골라진 것처럼 보인다.
    const byRole = new Map(selects.map((s) => [s.attrs["data-role"], s.value]));
    for (const [role, want] of Object.entries(finishes.assignments)) {
      if (byRole.get(role) !== want) bad.push(`${role} 의 고르개가 ${byRole.get(role)} 로 열린다 (${want} 여야 한다)`);
    }

    // 고르면 알려 준다.
    const target = selects.find((s) => s.attrs["data-role"] === "본문");
    target.value = "metal";
    target.fire("change");
    if (String(changed) !== "본문,metal") bad.push(`고쳤는데 안 알린다 (${JSON.stringify(changed)})`);

    /*
     * **손으로 바꾼 값으로 열리는가. 이 단계의 첫 번째 함정이 여기서 완성된다.**
     *
     * 격자가 다시 그려질 때(모드 토글) 카드는 **합쳐진 배정**을 받는다. 그것을 무시하고
     * 원래 배정으로 그리면, 사용자가 고른 것이 저장에는 남는데 **화면에서만 원래대로
     * 돌아간다** — 무엇이 저장될지 알 수 없게 된다.
     *
     * 앞의 검사는 `editing.assignments` 를 원래 배정과 **같게** 넘겨서 그 둘을 구별하지
     * 못했다. 실제로 `editing` 을 통째로 무시하는 변형이 일곱 게이트를 다 통과했다
     * (리뷰가 재현). 여기서는 **다른 값**을 넘겨 가른다.
     */
    const overridden = { ...finishes.assignments, 본문: "metal", 바탕: "emissive" };
    const after = structureCard(st, "light", finishes, null, { assignments: overridden, onFinish: () => {} });
    const opened = new Map(
      findAll(after, (n) => n.tag === "select").map((s) => [s.attrs["data-role"], s.value]),
    );
    for (const [role, want] of Object.entries(overridden)) {
      if (opened.get(role) !== want) {
        bad.push(`손으로 바꾼 ${role} 이 ${opened.get(role)} 로 열린다 (${want} 여야 한다) — 화면이 저장과 어긋난다`);
      }
    }
    // 양성 대조 — 안 바꾼 자리는 원래대로. 위 검사가 "늘 덮어쓴 값" 이 아님을 안다.
    if (opened.get("강조") !== finishes.assignments.강조) {
      bad.push(`안 바꾼 강조가 ${opened.get("강조")} 로 열린다`);
    }
    // `(LLM 배정)` 표시는 **원래** 배정을 따른다 — 되돌릴 자리를 알려 주는 것이 그 목적이다.
    const bodyOpts = findAll(after, (n) => n.tag === "select").find((s) => s.attrs["data-role"] === "본문");
    const marked = bodyOpts.children.filter((o) => /LLM/.test(o.textContent)).map((o) => o.value);
    if (String(marked) !== finishes.assignments.본문) {
      bad.push(`LLM 표시가 [${marked}] 에 붙었다 — 원래 배정(${finishes.assignments.본문})에 붙어야 한다`);
    }

    // **고르개를 안 준 옛 호출은 그대로 돈다.** 17단계의 읽기 전용 표시가 회귀하지 않게.
    const plain = structureCard(st, "light", finishes, null);
    if (findAll(plain, (n) => n.tag === "select").length !== 0) bad.push("고르개 없이 불렀는데 고르개가 생겼다");
    if (!text(plain).includes("광택")) bad.push("고르개가 없을 때 재질 이름이 안 보인다 (17단계 회귀)");

    out(bad.length ? bad.slice(0, 8).join("\n") : "카드가 역할마다 고르개를 그리고, 지금 배정이 골라져 있고, 고치면 알린다");
    return bad.length === 0;
  },

  /*
   * **모드를 바꿔도 고친 재질이 남는다. 이 단계의 핵심 함정이다.**
   *
   * 모드 토글은 격자를 **통째로 다시 그린다**(`redraw`). 배정을 카드 안에 두면 그 순간
   * 사용자가 고친 것이 전부 사라진다 — 15단계에서 겪은 것과 같은 부류다.
   *
   * 정적 검사로 그것을 본다: 배정 상태가 **`redraw` 보다 바깥**에 선언돼 있는가.
   * 그리고 `redraw` 가 그 상태를 읽어 카드에 넘기는가.
   */
  "S21-G4": async () => {
    const bad = [];
    const js = stripComments(read("public/app.js"));

    /*
     * **정적으로는 자리만 본다.** 배정 상태가 `redraw` 보다 **위**에 선언돼 있는가 —
     * 안에 있으면 모드 토글이 격자를 다시 그릴 때마다 초기화된다.
     */
    const at = js.indexOf("finishOverrides(");
    if (at < 0) {
      out("app.js 가 finishOverrides 를 안 쓴다 — 바꾼 배정을 둘 자리가 없다");
      return false;
    }
    const redrawAt = js.indexOf("redraw = ");
    if (redrawAt < 0) bad.push("app.js 에 redraw 가 없다 — 이 검사의 전제가 깨졌다");
    else if (at > redrawAt) bad.push("배정 상태가 redraw 안(또는 뒤)에 있다 — 다시 그릴 때마다 초기화된다");

    // 화면이 그 묶음을 실제로 쓰는가. 안 쓰면 아래 동작 검사가 공허하다.
    if (!js.includes("finishEditing(")) bad.push("app.js 가 finishEditing 을 안 쓴다 — 아래 검사가 겨냥하는 코드가 화면에 없다");

    /*
     * **나머지는 직접 불러서 잰다. 정규식으로 재던 것을 걷어냈다.**
     *
     * 전에는 `app.js` 소스에서 `api(` 라는 글자를 찾아 "서버를 다시 안 부른다" 를
     * 확인했다. 리뷰가 그것을 **한 줄로 우회**했다 — 호출을 이름 붙인 헬퍼로 빼서 검사 창
     * 밖에 두면 그만이었고, 그건 난독화가 아니라 **평범한 리팩터링**이다. 그래서 판정 로직을
     * `finishEditing` 이라는 순수 함수로 빼고, 여기서 그것을 부른다.
     *
     * 무는 것 셋:
     *   1. 서버를 안 부른다 — `fetch` 를 감시한다
     *   2. 화면을 안 부순다 — DOM 을 아예 안 깔고 부른다. 건드리면 던진다
     *   3. 고른 것이 실제로 담긴다 — 담고 나서 다시 물어본다
     */
    const { finishEditing, finishOverrides } = await import("../public/ui.js");
    if (typeof finishEditing !== "function") {
      out("public/ui.js 가 finishEditing 을 안 내보낸다");
      return false;
    }

    const realFetch = globalThis.fetch;
    const realDocument = globalThis.document;
    let fetched = 0;
    globalThis.fetch = (...args) => {
      fetched += 1;
      return Promise.reject(new Error(`게이트: 여기서 부르면 안 된다 (${args[0]})`));
    };
    // DOM 을 치운다. 건드리면 던지고, 그 던짐이 아래에서 잡힌다.
    delete globalThis.document;

    let threw = null;
    try {
      const store = finishOverrides();
      const st = structure("comp", ["바탕", "본문", "강조"]);
      const base = { 바탕: "matte", 본문: "gloss", 강조: "emissive" };

      const bundle = finishEditing(store, st, base);
      // 지금 보일 배정은 합쳐진 것이다.
      if (bundle.assignments?.본문 !== "gloss") bad.push(`처음 배정이 ${bundle.assignments?.본문}`);

      bundle.onFinish("본문", "metal");
      // 담겼는가 — 같은 묶음이 아니라 새로 만들어 물어본다(그래야 캐시가 아니라 저장을 본다).
      const again = finishEditing(store, st, base);
      if (again.assignments?.본문 !== "metal") bad.push(`고쳤는데 안 담겼다 (${again.assignments?.본문})`);
      if (again.assignments?.바탕 !== "matte") bad.push(`안 건드린 바탕이 ${again.assignments?.바탕}`);

      // 다른 구조는 안 바뀐다(구조별 격리가 이 경로로도 유지되는가).
      const other = finishEditing(store, structure("wide", ["본문"]), base);
      if (other.assignments?.본문 !== "gloss") bad.push("한 구조를 고쳤더니 다른 구조까지 바뀐다");

      // 모르는 값은 안 담긴다.
      bundle.onFinish("본문", "velvet");
      if (finishEditing(store, st, base).assignments?.본문 !== "metal") bad.push("모르는 재질이 담겼다");
    } catch (err) {
      threw = err;
    } finally {
      globalThis.fetch = realFetch;
      globalThis.document = realDocument;
    }

    if (threw) bad.push(`고칠 때 화면을 건드리거나 던졌다 — ${threw.message}`);
    if (fetched) bad.push(`고칠 때 서버를 ${fetched}번 불렀다 — 보이는 다섯이 바뀐다`);

    /*
     * **양성 대조.** 위 감시가 진짜로 도는지 확인한다. 감시를 깔아 놓고 아무도 안 부르면
     * "0번 불렀다" 는 늘 참이라 검사가 공허해진다.
     */
    let sawSpy = 0;
    const keep = globalThis.fetch;
    globalThis.fetch = () => {
      sawSpy += 1;
      return Promise.reject(new Error("spy"));
    };
    globalThis.fetch("http://example.invalid").catch(() => {});
    globalThis.fetch = keep;
    if (sawSpy !== 1) bad.push("fetch 감시가 안 걸린다 — 위 검사가 공허하다");

    out(
      bad.length
        ? bad.slice(0, 8).join("\n")
        : "배정 상태가 redraw 밖에 있다 · 고칠 때 서버 0번 · 화면 안 건드림 · 고른 것이 담기고 구조별로 갈린다",
    );
    return bad.length === 0;
  },

  "S21-G5": async () => {
    const bad = [];
    const js = stripComments(read("public/app.js"));

    const at = js.indexOf("saveDerived");
    if (at < 0) {
      out("app.js 에 saveDerived 가 없다");
      return false;
    }
    const closure = js.slice(at, js.indexOf("/api/saved/derived", at));
    if (!/forStructure|overrides/.test(closure)) {
      bad.push("저장 요청이 바꾼 배정을 안 읽는다 — 고친 것이 저장에 안 실린다");
    }

    const call = js.slice(js.indexOf("/api/saved/derived", at), js.indexOf("/api/saved/derived", at) + 220);
    if (!call.includes("finishes")) bad.push("저장 요청에 finishes 가 없다 (19단계 회귀)");
    // 색은 여전히 안 보낸다 — 18·19단계가 세운 경계다.
    if (/\bcolors\b|\bhex\b/.test(call)) bad.push("저장 요청에 색이 실렸다 (S18-G1 경계 위반)");

    out(bad.length ? bad.slice(0, 8).join("\n") : "저장 요청이 바꾼 배정을 싣고, 색은 여전히 안 보낸다");
    return bad.length === 0;
  },

  /*
   * **바꾼 재질이 실제로 저장된다.** 위 둘은 정적 검사라 표기만 본다. 여기서는 저장소를
   * 직접 불러 **끝에서 끝까지** 확인한다 — 화면이 보내는 모양 그대로 넣고 무엇이 남는지 본다.
   */
  "S21-G6": async () => {
    const bad = [];
    const { finishOverrides } = await import("../public/ui.js");
    const { saveDerived } = await import("../src/store.js");
    const { DEFAULT_FINISH_BY_ROLE, MATERIAL_FINISHES } = await import("../src/material.js");
    const { expandSeed, loadStructures } = await import("../src/expand.js");

    const dir = (await import("node:fs")).mkdtempSync(
      join((await import("node:os")).tmpdir(), "tonefirst-a3-"),
    );
    process.env.TONEFIRST_DATA_DIR = dir;

    const seeds = JSON.parse(read("data/palettes.json")).palettes;
    const all = loadStructures();
    const seed = seeds.find((p) => p.id === "pair-06");
    const st = expandSeed(seed, "complementary", all, { mode: "light" });
    if (!st) throw new Error("구조를 못 펼쳤다 — 이 검사의 전제가 깨졌다");

    const materials = {
      finishes: [...MATERIAL_FINISHES],
      defaultFor: (role) =>
        Object.hasOwn(DEFAULT_FINISH_BY_ROLE, role) ? DEFAULT_FINISH_BY_ROLE[role] : MATERIAL_FINISHES[0],
    };
    const resolve = (seedId, structureId, mode) => {
      const s = seeds.find((p) => p.id === seedId);
      return s ? expandSeed(s, structureId, all, { mode }) : null;
    };
    const ratioFor = (p) => p.colors.map(() => Math.floor(100 / p.colors.length));

    // 화면이 하는 것과 같은 순서 — LLM 배정을 받고, 하나를 손으로 바꾼다.
    const llm = { 바탕: "matte", 본문: "gloss", 강조: "emissive" };
    const store = finishOverrides();
    store.set("complementary", "본문", "metal");
    const sent = store.forStructure(st, llm);

    const saved = await saveDerived(
      { seedId: "pair-06", structureId: "complementary", mode: "light", finishes: sent },
      resolve,
      ratioFor,
      materials,
    );
    const entry = saved?.entry ?? saved;
    if (entry?.finishes?.본문 !== "metal") bad.push(`저장된 본문이 ${entry?.finishes?.본문} (metal 이어야 한다)`);
    if (entry?.finishes?.바탕 !== "matte") bad.push(`안 건드린 바탕이 ${entry?.finishes?.바탕}`);
    if (entry?.finishesAdjusted !== true) bad.push(`손댔는데 finishesAdjusted 가 ${entry?.finishesAdjusted}`);

    // **양성 대조** — 안 바꾸면 LLM 배정 그대로다. 그래야 위 검사가 "늘 metal" 이 아님을 안다.
    const store2 = finishOverrides();
    const saved2 = await saveDerived(
      { seedId: "pair-06", structureId: "analogous", mode: "light", finishes: store2.forStructure(
        expandSeed(seed, "analogous", all, { mode: "light" }), llm) },
      resolve,
      ratioFor,
      materials,
    );
    const e2 = saved2?.entry ?? saved2;
    if (e2?.finishes?.본문 !== "gloss") bad.push(`안 바꿨는데 본문이 ${e2?.finishes?.본문} (gloss 여야 한다)`);

    (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
    out(bad.length ? bad.slice(0, 8).join("\n") : "손으로 바꾼 재질이 저장에 그대로 남고, 안 건드린 것은 LLM 배정 그대로다");
    return bad.length === 0;
  },

  /*
   * **고르개가 화면 규칙을 안 깬다.**
   *
   * 이 저장소는 사용자·모델이 만든 문자열을 전부 `textContent` 로 넣는다 — `innerHTML` 로
   * 조립하는 곳이 하나도 없어야 그 규칙이 유지된다(`public/ui.js` 머리말).
   * 재질 이름은 카탈로그에서 오지만 카탈로그가 손상될 수 있고, 규칙은 출처를 안 따진다.
   */
  "S21-G7": async () => {
    const bad = [];
    installDom();
    const { structureCard } = await import("../public/ui.js");

    const ui = read("public/ui.js");
    if (/innerHTML|outerHTML|insertAdjacentHTML/.test(stripComments(ui))) {
      bad.push("ui.js 가 HTML 을 문자열로 조립한다");
    }

    const st = structure("comp", ["바탕", "본문", "강조"]);
    const nasty = "<img src=x onerror=alert(1)>";
    const card = structureCard(
      st,
      "light",
      { assignments: { 바탕: "matte", 본문: "gloss", 강조: "emissive" }, names: { gloss: nasty } },
      null,
      { assignments: { 바탕: "matte", 본문: "gloss", 강조: "emissive" }, onFinish: () => {} },
    );
    // 흉내 낸 DOM 은 `textContent` 로만 글자를 담으므로, 그 글자가 그대로 남아 있으면
    // 파싱된 것이 아니라 글자로 들어간 것이다. 자식 요소가 안 생겼는지도 함께 본다.
    const opt = findAll(card, (n) => n.tag === "option").find((o) => o.value === "gloss");
    if (!opt) bad.push("광택 항목이 없다");
    else {
      if (!String(opt.textContent).includes(nasty)) bad.push("이름이 글자 그대로 안 들어갔다");
      if (opt.children.length) bad.push("항목 안에 요소가 생겼다 — 마크업으로 해석됐다");
    }

    out(bad.length ? bad.slice(0, 8).join("\n") : "ui.js 에 HTML 문자열 조립이 없고, 재질 이름이 글자로만 들어간다");
    return bad.length === 0;
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage21.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  const ok = await GATES[id]();
  if (ok) out(id.replace(/-/g, "_") + "_OK");
  process.exitCode = ok ? 0 : 1;
}
