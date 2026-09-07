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

    out(bad.length ? bad.slice(0, 8).join("\n") : "고르개가 재질 넷을 한글 이름으로 주고 LLM 배정에만 표시가 붙는다");
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

    const at = js.indexOf("finishOverrides(");
    if (at < 0) {
      out("app.js 가 finishOverrides 를 안 쓴다 — 바꾼 배정을 둘 자리가 없다");
      return false;
    }
    const redrawAt = js.indexOf("redraw = ");
    if (redrawAt < 0) bad.push("app.js 에 redraw 가 없다 — 이 검사의 전제가 깨졌다");
    else if (at > redrawAt) bad.push("배정 상태가 redraw 안(또는 뒤)에 있다 — 다시 그릴 때마다 초기화된다");

    /*
     * **카드에 넘기는 "지금 배정" 이 합쳐진 것인가.**
     *
     * 처음엔 `redraw` 본문에 `overrides` 라는 글자가 있는지만 봤다. **그걸로는 못 잡는다** —
     * 카드에 넘길 것을 만드는 자리가 `redraw` 밖(`cardEditing`)에 있고, 거기서
     * `assignments` 를 원래 배정으로 바꿔치기해도 `overrides.set` 이 남아 검사가 통과했다.
     * 실제로 그 변형이 살아남았다. 19단계 S19-G5 가 겪은 "조립부와 호출부가 따로 있다" 와
     * 같은 부류다.
     *
     * 그래서 **`assignments:` 에 실리는 값이 `forStructure` 에서 오는지**를 직접 본다.
     * 합치는 규칙이 한 곳에만 있으므로(`ui.js`), 그것을 안 거치면 합쳐진 것일 수 없다.
     */
    const merged = /assignments:\s*[^,;\n]*forStructure\s*\(/.test(js);
    if (!merged) {
      bad.push("카드에 넘기는 배정이 forStructure 를 안 거친다 — 다시 그리면 원래 배정으로 돌아간다");
    }
    const body = js.slice(redrawAt, js.indexOf("redraw();", redrawAt));
    if (!/forStructure|overrides|Editing/.test(body)) {
      bad.push("redraw 가 바꾼 배정을 안 읽는다");
    }

    /*
     * **재질을 바꿀 때 서버에 다시 묻지 않는다.** `/api/expand` 를 다시 부르면
     * `selectStructures` 가 다시 돌아 같은 질의인데 보이는 다섯이 바뀐다(S15-G11 과 같은 함정).
     * `onFinish` 처리 안에 그 호출이 없어야 한다.
     */
    /*
     * **처리기만 잘라 본다.** 처음엔 `onFinish` 부터 300자를 봤는데 그 창이 바로 뒤의
     * `redraw = ` 선언까지 삼켜, 처리기가 깨끗해도 검사가 울었다. 다음 문장이 시작하는
     * 자리에서 자른다.
     */
    const onFinishAt = js.indexOf("onFinish");
    const nextStmt = js.indexOf("redraw = ", onFinishAt);
    if (onFinishAt < 0) bad.push("app.js 가 onFinish 를 안 넘긴다 — 고쳐도 받을 곳이 없다");
    else {
      const handler = js.slice(onFinishAt, nextStmt > onFinishAt ? nextStmt : onFinishAt + 300);
      if (/api\(|fetch\(/.test(handler)) bad.push("재질을 고칠 때 서버를 다시 부른다 — 보이는 다섯이 바뀐다");
      /*
       * **고칠 때 카드를 부수지도 않는다.** 처음 구현이 여기서 `redraw()` 를 불렀고,
       * 그것이 브라우저에서 두 가지를 망가뜨렸다(실측):
       *   - 사용자가 맞춘 면적 비율이 55:25:20 → 34:33:33 으로 초기화됐다
       *   - 방금 조작한 고르개가 사라져 포커스가 body 로 떨어졌다
       * 다시 그릴 이유도 없었다 — 고르개는 고른 값을 스스로 보이고, 카드의 나머지는
       * 재질과 무관하다. 담아 두기만 한다.
       */
      if (/redraw/.test(handler)) {
        bad.push("재질을 고칠 때 카드를 다시 그린다 — 맞춰 둔 비율과 포커스가 날아간다");
      }
    }

    out(bad.length ? bad.slice(0, 8).join("\n") : "배정 상태가 redraw 밖에 있고 redraw 가 그것을 읽는다 · 고칠 때 서버를 안 부른다 (정적 검사)");
    return bad.length === 0;
  },

  /*
   * **저장에 실리는 것이 화면에서 고친 것이다.**
   *
   * 고르개를 만들어 놓고 저장에는 원래 배정을 보내면, 사용자는 바꿔 저장했다고 믿는데
   * 저장된 것은 LLM 배정이다. 정적으로 저장 요청 조립부를 본다.
   */
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

const text = (n) => n.textContent;

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage21.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  const ok = await GATES[id]();
  if (ok) out(id.replace(/-/g, "_") + "_OK");
  process.exitCode = ok ? 0 : 1;
}
