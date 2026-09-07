#!/usr/bin/env node
// 23단계(새로고침해도 어두운 모드가 남는다) · A4 완료 조건 검사기.
//   node scripts/check-stage23.mjs S23-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 여섯 게이트가 전부 실패하는 것을 확인한 뒤에
// public/ui.js 와 public/app.js 를 고쳤다.
//
// **이 단계는 명시적 결정을 뒤집는다.** `public/app.js` 가 이렇게 적어 뒀다:
//
//   모드 상태는 이 영역 클로저 안에만 있다. 전역이나 localStorage 에 두지 않는다 —
//   카드마다 다른 모드로 나란히 비교할 수 있고, 이 저장소에 없던 저장 계층을 들이지도 않는다.
//
// **뒤집는 것은 뒤쪽 절반뿐이다.** 카드별 어긋남은 그대로 두고(그것이 그 결정의 값이다),
// **기본 모드 하나만** 저장한다. 새로 펼치는 카드가 그 모드로 시작하고, 그 뒤로는 카드마다
// 따로 토글할 수 있다.
//
// **이 저장소의 첫 localStorage 다.** 그래서 무는 것이 하나 더 있다 — 그것이 **없거나
// 던지는 환경**에서도 화면이 그대로 돌아야 한다. 시크릿 창·사이트 데이터 차단에서
// `localStorage` 는 읽기만 해도 던진다.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { installDom } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **감시할 값을 여기 다시 적는다.** 대상에서 가져오면 그것을 바꾸는 순간 게이트가 함께
 * 느슨해진다. 이 저장소가 같은 부류로 다섯 번 뚫렸다.
 */
const MODES = Object.freeze(["light", "dark"]);
const KEY = "tonefirst:mode"; // 이름을 나누지 않으면 같은 오리진의 다른 것과 부딪친다

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 흉내 낸 저장소. 진짜 `localStorage` 처럼 문자열만 담고, 원할 때 던지게 만들 수 있다. */
function fakeStorage({ throwOnGet = false, throwOnSet = false, initial = null } = {}) {
  const box = new Map();
  if (initial !== null) box.set(KEY, initial);
  const calls = { get: 0, set: 0 };
  return {
    calls,
    getItem(k) {
      calls.get += 1;
      if (throwOnGet) throw new Error("게이트: 읽기가 막힌 환경");
      return box.has(k) ? box.get(k) : null;
    },
    setItem(k, v) {
      calls.set += 1;
      if (throwOnSet) throw new Error("게이트: 쓰기가 막힌 환경");
      box.set(k, String(v));
    },
    peek: () => (box.has(KEY) ? box.get(KEY) : null),
  };
}

const GATES = {
  /*
   * **저장소가 없거나 던져도 화면이 돈다.**
   *
   * 이 저장소의 첫 `localStorage` 다. 시크릿 창·사이트 데이터 차단·일부 임베드 환경에서는
   * **접근만 해도 던진다** — `try/catch` 없이 쓰면 홈 화면이 통째로 안 뜬다.
   *
   * 쓰기도 마찬가지다. 용량이 찼거나 막힌 환경에서 던지는데, **모드를 못 저장한 것 때문에
   * 토글이 실패하면 안 된다** — 저장은 편의이고 토글은 기능이다.
   */
  "S23-G1": async () => {
    const bad = [];
    const { modeStore } = await import("../public/ui.js");
    if (typeof modeStore !== "function") {
      out("public/ui.js 가 modeStore 를 안 내보낸다");
      return false;
    }

    // 없는 저장소 · 던지는 저장소 · 이상한 값
    const cases = [
      ["저장소 없음", null],
      ["undefined", undefined],
      ["빈 객체", {}],
      ["숫자", 7],
      ["읽기가 던짐", fakeStorage({ throwOnGet: true })],
    ];
    for (const [what, storage] of cases) {
      let got;
      try {
        got = modeStore(storage).read();
      } catch (err) {
        bad.push(`${what} 에서 던졌다 — ${err.message} (화면이 통째로 안 뜬다)`);
        continue;
      }
      if (got !== "light") bad.push(`${what} 에서 ${got} 를 줬다 (light 로 물러서야 한다)`);
    }

    // 쓰기가 던져도 위로 안 올린다.
    try {
      modeStore(fakeStorage({ throwOnSet: true })).write("dark");
    } catch (err) {
      bad.push(`쓰기가 막힌 환경에서 던졌다 — ${err.message} (토글이 실패한다)`);
    }
    for (const storage of [null, undefined, {}, 7]) {
      try {
        modeStore(storage).write("dark");
      } catch (err) {
        bad.push(`저장소가 ${String(storage)} 일 때 쓰기가 던졌다 — ${err.message}`);
      }
    }

    /*
     * **저장소를 안 넘겼을 때도 안 던져야 한다.**
     *
     * 인자를 안 주면 `globalThis.localStorage` 를 집는데, **그 접근 자체가 던지는 환경이
     * 있다**(사이트 데이터 차단). 감싸기를 빼는 변형이 위 검사들을 전부 통과했다 —
     * 가짜 저장소를 넘겨 주고 있었으니 기본 경로를 한 번도 안 밟았기 때문이다.
     */
    const realLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let threwOnDefault = null;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("게이트: 사이트 데이터가 막힌 환경");
      },
    });
    try {
      const got = modeStore().read();
      if (got !== "light") bad.push(`기본 저장소가 막혔는데 ${got} 를 줬다`);
      modeStore().write("dark");
    } catch (err) {
      threwOnDefault = err;
    } finally {
      if (realLocal) Object.defineProperty(globalThis, "localStorage", realLocal);
      else delete globalThis.localStorage;
    }
    if (threwOnDefault) {
      bad.push(`기본 저장소 접근이 막힌 환경에서 던졌다 — ${threwOnDefault.message} (화면이 통째로 안 뜬다)`);
    }

    out(bad.length ? bad.slice(0, 8).join("\n") : "저장소가 없거나 던져도 안 던지고 밝은 모드로 물러선다 (인자 9가지 + 기본 경로)");
    return bad.length === 0;
  },

  /*
   * **저장한 것을 그대로 읽고, 이상한 것은 안 믿는다.**
   *
   * 저장소는 사용자가 손댈 수 있는 자리다 — 개발자 도구로 아무 값이나 넣을 수 있고,
   * 같은 오리진의 다른 코드가 덮어쓸 수도 있다. 그대로 믿으면 `mode` 가 `"purple"` 이 되어
   * 파생 계산이 어디서 터질지 모르는 상태가 된다.
   */
  "S23-G2": async () => {
    const bad = [];
    const { modeStore } = await import("../public/ui.js");

    // 왕복
    for (const mode of MODES) {
      const s = fakeStorage();
      modeStore(s).write(mode);
      const back = modeStore(s).read();
      if (back !== mode) bad.push(`${mode} 를 썼는데 ${back} 를 읽는다`);
    }

    // 이름을 나눈 자리에 쓴다. 안 나누면 같은 오리진의 다른 것과 부딪친다.
    const s2 = fakeStorage();
    modeStore(s2).write("dark");
    if (s2.peek() !== "dark") bad.push(`${KEY} 자리에 안 썼다 (읽어 보니 ${s2.peek()})`);

    // 이상한 값은 안 믿는다.
    for (const junk of ["purple", "", "DARK", " dark", "null", "[]", '{"mode":"dark"}', "0"]) {
      const got = modeStore(fakeStorage({ initial: junk })).read();
      if (got !== "light") bad.push(`저장값 ${JSON.stringify(junk)} 를 ${got} 로 읽었다`);
    }

    // 이상한 값은 안 쓴다. 쓰면 다음 읽기가 물러서겠지만, 그때 원래 값을 잃는다.
    const s3 = fakeStorage({ initial: "dark" });
    for (const junk of ["purple", "", null, undefined, 7, ["dark"], { mode: "dark" }]) {
      modeStore(s3).write(junk);
    }
    if (s3.peek() !== "dark") bad.push(`이상한 값을 쓰다가 저장된 dark 를 잃었다 (지금 ${s3.peek()})`);

    out(bad.length ? bad.slice(0, 8).join("\n") : "왕복이 맞고, 이상한 저장값 8가지·이상한 쓰기 7가지를 안 믿는다");
    return bad.length === 0;
  },

  /*
   * **토글 버튼이 지금 모드를 정직하게 보인다.**
   *
   * 저장된 모드로 시작하게 되면서 **버튼의 글자와 `aria-pressed` 가 처음부터 그 모드를
   * 반영해야 한다.** 전에는 밝은 모드로만 시작해서 `"어두운 배경으로 보기"` 를 박아 뒀는데,
   * 그대로 두면 어두운 모드로 시작할 때 **버튼이 거짓말을 한다** — 이미 어두운데 어둡게
   * 보자고 하고, 눌린 상태가 아니라고 알린다.
   *
   * 20단계 `engineToggle` 과 같은 모양으로 뺀다 — 라벨은 **지금이 아니라 갈 곳**을 말한다.
   */
  "S23-G3": async () => {
    const bad = [];
    const { modeToggle } = await import("../public/ui.js");
    if (typeof modeToggle !== "function") {
      out("public/ui.js 가 modeToggle 을 안 내보낸다");
      return false;
    }

    const light = modeToggle("light");
    const dark = modeToggle("dark");

    if (light.next !== "dark") bad.push(`밝은 모드의 다음이 ${light.next}`);
    if (dark.next !== "light") bad.push(`어두운 모드의 다음이 ${dark.next}`);
    if (light.pressed !== false) bad.push(`밝은 모드의 pressed 가 ${light.pressed}`);
    if (dark.pressed !== true) bad.push(`어두운 모드의 pressed 가 ${dark.pressed}`);
    // 라벨은 갈 곳을 말한다. "어두운" 이라고만 적혀 있으면 지금인지 갈 곳인지 모른다.
    if (!String(light.label).includes("어두운")) bad.push(`밝은 모드 라벨이 갈 곳을 안 말한다 (${light.label})`);
    if (!String(dark.label).includes("밝은")) bad.push(`어두운 모드 라벨이 갈 곳을 안 말한다 (${dark.label})`);
    if (light.label === dark.label) bad.push("두 모드의 라벨이 같다");

    // 모르는 값은 밝은 모드로 다룬다 — 저장값이 손상됐을 때 버튼이 이상해지지 않게.
    for (const junk of ["purple", "", null, undefined, 7, ["dark"]]) {
      const got = modeToggle(junk);
      if (got.next !== "dark" || got.pressed !== false) {
        bad.push(`${String(junk)} 를 ${got.next}/${got.pressed} 로 다룬다 (밝은 모드여야 한다)`);
      }
    }

    /*
     * **가짜 버튼에 실제로 칠해 본다.**
     *
     * 값을 정하는 것과 **그것을 버튼에 붙이는 것**은 다른 일이다. 처음 칠하는 호출을
     * 지우는 변형이 게이트를 통과했다 — 정적 검사는 "처음에 칠했는가" 를 못 본다.
     */
    const { applyModeButton } = await import("../public/ui.js");
    if (typeof applyModeButton !== "function") {
      out("public/ui.js 가 applyModeButton 을 안 내보낸다");
      return false;
    }
    installDom();
    for (const mode of MODES) {
      const btn = document.createElement("button");
      const view = applyModeButton(btn, mode);
      if (btn.getAttribute("aria-pressed") !== String(view.pressed)) {
        bad.push(`${mode}: aria-pressed 가 ${btn.getAttribute("aria-pressed")} (${view.pressed} 여야 한다)`);
      }
      if (btn.textContent !== view.label) bad.push(`${mode}: 글자가 "${btn.textContent}" (${view.label} 여야 한다)`);
      if (!btn.textContent) bad.push(`${mode}: 버튼에 글자가 없다`);
    }
    // 다시 칠하면 덮어써야 한다 — 쌓이면 글자가 두 번 나온다.
    const btn = document.createElement("button");
    applyModeButton(btn, "light");
    applyModeButton(btn, "dark");
    if (btn.textContent !== modeToggle("dark").label) bad.push(`다시 칠했더니 "${btn.textContent}"`);
    if (btn.getAttribute("aria-pressed") !== "true") bad.push("다시 칠했는데 aria-pressed 가 안 바뀐다");

    out(bad.length ? bad.slice(0, 8).join("\n") : "토글이 지금 모드를 정직하게 보이고 갈 곳을 말한다 · 버튼에 실제로 칠해진다");
    return bad.length === 0;
  },

  /*
   * **화면이 저장된 모드로 시작하고, 토글이 그것을 갱신한다.**
   *
   * `app.js` 는 최상단에서 `getElementById` 를 부르고 마지막에 요청을 보내므로 게이트가
   * 불러올 수 없다 — 배선은 글자로만 잰다. 판정 로직은 위 두 순수 함수가 갖고 있고
   * `S23-G1`·`S23-G2`·`S23-G3` 이 직접 부른다.
   */
  "S23-G4": async () => {
    const bad = [];
    const js = stripComments(read("public/app.js"));

    if (!/modeStore\s*\(/.test(js)) bad.push("app.js 가 modeStore 를 안 쓴다 — 저장이 화면에 안 닿는다");
    if (!/modeToggle\s*\(/.test(js)) bad.push("app.js 가 modeToggle 을 안 쓴다 — 버튼이 모드를 거짓말할 수 있다");
    // 버튼에 칠하는 것도 그 함수를 거쳐야 한다. 화면이 직접 적으면 두 곳이 갈라진다.
    const paints = [...js.matchAll(/applyModeButton\s*\(/g)].length;
    if (paints < 2) bad.push(`applyModeButton 을 ${paints}번 부른다 — 만들 때와 누를 때 둘 다 필요하다`);
    if (/modeBtn\.textContent\s*=/.test(js)) bad.push("화면이 버튼 글자를 직접 적는다 — applyModeButton 을 거쳐야 한다");
    if (!/\.read\s*\(\)/.test(js)) bad.push("app.js 가 저장된 모드를 안 읽는다");
    if (!/\.write\s*\(/.test(js)) bad.push("app.js 가 바꾼 모드를 안 쓴다 — 새로고침하면 도로 풀린다");

    /*
     * **모드 상태는 여전히 카드(펼침 영역)마다 따로여야 한다.** 그것이 원래 결정의 값이고,
     * 이 단계가 뒤집는 것은 "저장을 안 한다" 쪽뿐이다. 전역으로 올리면 한 카드를 어둡게
     * 하는 순간 나머지가 전부 따라 어두워진다.
     */
    const fnAt = js.indexOf("function expansionSection");
    if (fnAt < 0) bad.push("expansionSection 을 못 찾았다 — 이 검사의 전제가 깨졌다");
    else {
      const declAt = js.search(/let\s+mode\s*=/);
      if (declAt < 0) bad.push("mode 선언을 못 찾았다");
      else if (declAt < fnAt) bad.push("mode 가 expansionSection 밖에 선언됐다 — 카드별 어긋남이 사라진다");
    }

    // 저장 자리 이름을 화면이 직접 적지 않는다. 두 곳에 적으면 한쪽만 고쳐질 자리가 생긴다.
    if (js.includes(KEY)) bad.push(`app.js 가 저장 자리 이름("${KEY}")을 직접 적는다 — modeStore 안에만 있어야 한다`);

    out(bad.length ? bad.slice(0, 8).join("\n") : "화면이 저장된 모드로 시작하고 토글이 갱신한다 · mode 는 여전히 카드마다 따로다");
    return bad.length === 0;
  },

  /*
   * **저장을 들여도 `mode` 는 서버 파라미터가 아니다.**
   *
   * `S15-G11` 이 세운 경계다 — 모드를 서버에 물으면 `selectStructures` 가 다시 돌아
   * **같은 질의인데 보이는 다섯이 바뀐다.** 저장 계층이 생기면서 "이제 서버도 알아야 하지
   * 않나" 로 새기 쉬운 자리라 회귀로 다시 잰다.
   */
  "S23-G5": async () => {
    const bad = [];
    const js = stripComments(read("public/app.js"));

    // 요청을 만드는 자리에 mode 가 붙지 않는다.
    for (const m of js.matchAll(/api\(\s*`([^`]*)`/g)) {
      if (/\bmode\b/.test(m[1])) bad.push(`요청 경로에 mode 가 붙었다 — ${m[1].slice(0, 60)}`);
    }
    for (const m of js.matchAll(/api\(\s*"([^"]*)"/g)) {
      if (/\bmode\b/.test(m[1])) bad.push(`요청 경로에 mode 가 붙었다 — ${m[1]}`);
    }

    /*
     * **저장 요청에는 붙는다. 그것은 맞다.** 파생 저장은 `mode` 가 있어야 어느 색인지
     * 정해진다(18단계). 조회(`/api/expand`)에 붙는 것만 금지다 — 그때 다섯이 바뀐다.
     * 양성 대조로 그 자리가 실제로 있는지 확인한다. 없으면 위 검사가 공허하다.
     */
    const saveCall = js.indexOf("/api/saved/derived");
    if (saveCall < 0) bad.push("파생 저장 호출을 못 찾았다 — 이 검사의 전제가 깨졌다");
    else if (!js.slice(saveCall, saveCall + 200).includes("mode")) {
      bad.push("파생 저장에 mode 가 안 실린다 (18단계 회귀)");
    }

    const expandCall = js.indexOf("/api/expand");
    if (expandCall < 0) bad.push("펼치기 호출을 못 찾았다 — 이 검사의 전제가 깨졌다");

    out(bad.length ? bad.slice(0, 8).join("\n") : "조회 요청에 mode 가 안 붙는다 · 저장 요청에는 붙는다 (양성 대조)");
    return bad.length === 0;
  },

  /*
   * **저장 계층을 한 곳에만 둔다.**
   *
   * 이 저장소의 첫 `localStorage` 다. 문을 여는 것이므로 **어디서든 부를 수 있게 두지
   * 않는다** — 흩어지면 어느 값이 어디 저장됐는지 아무도 모르게 되고, 그때는 되돌릴 수도 없다.
   * 화면 코드가 `localStorage` 를 직접 만지는 자리가 없어야 한다.
   */
  "S23-G6": async () => {
    const bad = [];
    const files = ["public/app.js", "public/saved.js", "public/history.js", "public/ratio.js", "public/color.js"];
    for (const rel of files) {
      let src;
      try {
        src = stripComments(read(rel));
      } catch {
        continue; // 없는 화면은 건너뛴다
      }
      if (/localStorage|sessionStorage|indexedDB/.test(src)) {
        bad.push(`${rel} 이 저장소를 직접 만진다 — modeStore 를 거쳐야 한다`);
      }
    }

    // ui.js 안에서도 한 곳뿐이어야 한다.
    const ui = stripComments(read("public/ui.js"));
    const hits = [...ui.matchAll(/localStorage/g)].length;
    if (hits === 0) bad.push("ui.js 에 저장소를 쓰는 자리가 없다 — 기본 저장소를 어디서 얻나");
    if (hits > 1) bad.push(`ui.js 가 localStorage 를 ${hits}곳에서 만진다 (한 곳이어야 한다)`);

    // 그 자리가 방어돼 있는가 — 접근만 해도 던지는 환경이 있다.
    const at = ui.indexOf("localStorage");
    if (at >= 0) {
      const around = ui.slice(Math.max(0, at - 200), at + 200);
      if (!/try\s*\{/.test(around)) bad.push("localStorage 접근이 try 로 안 감싸였다 — 시크릿 창에서 화면이 통째로 안 뜬다");
    }

    out(bad.length ? bad.slice(0, 8).join("\n") : `저장소를 만지는 자리가 ui.js 한 곳뿐이고 감싸여 있다 (화면 ${files.length}개 확인)`);
    return bad.length === 0;
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage23.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  const ok = await GATES[id]();
  if (ok) out(id.replace(/-/g, "_") + "_OK");
  process.exitCode = ok ? 0 : 1;
}
