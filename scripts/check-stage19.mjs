#!/usr/bin/env node
// 19단계(저장에 재질 배정을 남긴다) · A2-a 완료 조건 검사기.
//   node scripts/check-stage19.mjs S19-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 여섯 게이트가 전부 실패하는 것을 확인한 뒤에
// src/store.js 와 server.js 를 고쳤다. 통과부터 하는 게이트는 무엇을 지키는지 알 수 없다.
//
// **색과 재질을 다르게 다루는 것이 이 단계의 전부다.**
//   색   — 파생이 결정적이라(S11-G3) 서버가 다시 계산한다. 화면이 보낸 것을 안 믿는다(S18-G1)
//   재질 — LLM 이 정하는 것이라 다시 계산하면 저장할 때와 다른 답이 나온다. **받되 검증한다**
// `src/store.js` 규칙 4 가 그 경계를 이미 그어 뒀다 — "색은 코퍼스가 아는 사실이지만
// 비율은 사용자의 판단이다". 재질 배정도 판단 쪽이다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandSeed, loadStructures } from "../src/expand.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const palettes = () => JSON.parse(read("data/palettes.json")).palettes;

/**
 * **`material.js` 의 기본 배정과 재질 목록을 여기 다시 적는다.**
 *
 * 감시할 대상에서 값을 가져오면 그것을 바꾸는 순간 게이트가 함께 느슨해진다. 이 저장소가
 * 같은 부류로 네 번 뚫렸다(`fallbackSelection()` · `METAL_MIN` · `EV_MAX` · `MIN_SHARE`).
 */
const EXPECTED_DEFAULT = Object.freeze({
  바탕: "matte",
  면: "metal",
  본문: "gloss",
  강조: "emissive",
  "먼 쪽": "matte",
  중간: "gloss",
  "가까운 쪽": "metal",
});
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`서버가 5초 안에 뜨지 않았다. stderr: ${stderr.trim() || "(없음)"}`));
    }, 5000);
    child.stdout.on("data", (c) => {
      if (c.toString("utf8").includes(String(port))) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`서버가 코드 ${code} 로 종료했다. stderr: ${stderr.trim() || "(없음)"}`));
    });
  });
}

async function withServer(port, fn) {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-finishsave-"));
  const child = await startServer(port, { TONEFIRST_DATA_DIR: dir });
  const base = `http://127.0.0.1:${port}`;
  const api = {
    get: (path) => fetch(base + path),
    post: (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    /*
     * **본문을 문자열 그대로 보낸다.** `JSON.stringify(자바스크립트객체)` 로는 진짜 공격 형태를
     * 만들 수 없다 — 객체 리터럴에서 `__proto__: "matte"` 는 (문자열이라) 무시되어 애초에
     * 키가 안 생기고, 직렬화해도 남지 않는다. 반면 **원문 JSON 의 `"__proto__"` 는
     * `JSON.parse` 가 own 속성으로 만든다.** 리뷰가 이 사각지대를 지적했다.
     */
    postRaw: (path, raw) =>
      fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: raw }),
  };
  try {
    return await fn(api);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const saved = async (api) => (await (await api.get("/api/saved")).json()).saved ?? [];

const SEED = "pair-06";
const STRUCT = "complementary"; //  바탕 · 본문 · 강조
const WIDE = "value-scale"; //      바탕 · 면 · 본문 · 강조 (4색)
const AERIAL = "aerial"; //         먼 쪽 · 중간 · 가까운 쪽

/** 그 구조의 실제 역할 — 서버와 무관하게 다시 계산한다. */
const rolesOf = (structureId, mode = "light") => {
  const seed = palettes().find((p) => p.id === SEED);
  const st = expandSeed(seed, structureId, loadStructures(), { mode });
  return st ? st.colors.map((c) => c.role) : [];
};

const shapeColors = (colors) => (colors ?? []).map((c) => `${c.role}:${c.hex}`).join(",");

const GATES = {
  /*
   * **모르는 재질·모르는 역할·타입 위장을 거른다.**
   *
   * 재질 배정은 화면이 보내는 값이다(색과 달리 재계산이 안 된다). 그러면 **검증이 유일한
   * 방어**다 — 통과시키면 저장소에 엔진이 모르는 재질이 앉고, 내보내기가 그것으로
   * `applyFinish` 를 부르다가 던진다.
   *
   * `parseAssignment`(17단계)가 LLM 응답에 같은 것을 한다. 여기는 **화면** 쪽 입구다.
   *
   * **거부가 아니라 걸러내기다.** 모르는 것만 버리고 나머지는 살린다 — 하나 틀렸다고 저장을
   * 통째로 막으면 사용자가 이유도 모른 채 저장을 못 한다. 버린 자리는 기본 배정으로 채운다.
   */
  "S19-G1": async () => {
    const bad = [];
    let filtered = 0;
    let rawTried = 0;
    await withServer(4971, async (api) => {
      const roles = rolesOf(STRUCT);
      if (roles.length < 3) throw new Error(`역할이 ${roles.length}개다 — 이 검사가 공허하다`);

      const cases = [
        ["없는 재질", { [roles[0]]: "velvet" }, roles[0]],
        ["프로토타입 재질", { [roles[0]]: "__proto__" }, roles[0]],
        ["재질이 숫자", { [roles[0]]: 3 }, roles[0]],
        ["재질이 배열", { [roles[0]]: ["matte"] }, roles[0]],
        ["재질이 객체", { [roles[0]]: { id: "matte" } }, roles[0]],
        ["없는 역할", { 손잡이: "matte" }, null],
        ["프로토타입 역할", { __proto__: "matte" }, null],
        ["다른 구조의 역할", { "먼 쪽": "matte" }, null],
      ];

      filtered = cases.length;
      for (const [label, finishes, touched] of cases) {
        const res = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, finishes });
        if (res.status !== 200) {
          bad.push(`${label}: ${res.status} — 하나 틀렸다고 저장을 막으면 안 된다`);
          continue;
        }
        const entry = await res.json();
        // 걸러진 자리는 기본 배정이어야 한다.
        for (const role of roles) {
          const got = entry.finishes?.[role];
          if (!FINISH_IDS.includes(got)) bad.push(`${label}: ${role} 에 ${got}`);
          if (touched === role && got !== EXPECTED_DEFAULT[role]) {
            bad.push(`${label}: 걸러낸 ${role} 이 기본(${EXPECTED_DEFAULT[role]})이 아니라 ${got}`);
          }
        }
        // 배정 표에 없는 키가 새어 들어가면 안 된다.
        for (const key of Object.keys(entry.finishes ?? {})) {
          if (!roles.includes(key)) bad.push(`${label}: 배정에 없는 역할 ${key} 가 들어갔다`);
        }
        if (Object.getPrototypeOf(entry.finishes ?? {}) === null) continue;
      }

      /*
       * **원문 JSON 으로 보낸 프로토타입 공격.** 위 목록의 `{ __proto__: "matte" }` 는 JS 객체
       * 리터럴이라 그 키가 애초에 안 생긴다 — 즉 "빈 배정" 과 같은 검사였다(리뷰 지적).
       * 진짜 형태는 `JSON.parse` 가 own 속성으로 만드는 원문 문자열이다.
       */
      const rawAttacks = [
        `{"seedId":"${SEED}","structureId":"${STRUCT}","finishes":{"__proto__":"matte"}}`,
        `{"seedId":"${SEED}","structureId":"${STRUCT}","finishes":{"constructor":"matte"}}`,
        `{"seedId":"${SEED}","structureId":"${STRUCT}","finishes":{"__proto__":{"polluted":true}}}`,
      ];
      rawTried = rawAttacks.length;
      for (const raw of rawAttacks) {
        const res = await api.postRaw("/api/saved/derived", raw);
        if (res.status !== 200) {
          bad.push(`원문 공격이 ${res.status} — 저장을 막으면 안 된다: ${raw.slice(0, 60)}`);
          continue;
        }
        const entry = await res.json();
        for (const key of Object.keys(entry.finishes ?? {})) {
          if (!roles.includes(key)) bad.push(`원문 공격으로 ${key} 가 배정에 들어갔다`);
        }
        for (const role of roles) {
          if (entry.finishes?.[role] !== EXPECTED_DEFAULT[role]) {
            bad.push(`원문 공격 뒤 ${role} 이 ${entry.finishes?.[role]} (기본이어야 한다)`);
          }
        }
      }
      // 서버 프로세스가 오염됐다면 그다음 저장이 이상해진다. 멀쩡한 저장으로 확인한다.
      const after = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT })).json();
      if (Object.keys(after.finishes ?? {}).length !== roles.length) {
        bad.push("원문 공격 뒤 정상 저장이 이상해졌다 — 프로토타입이 오염됐을 수 있다");
      }

      // 양성 대조 — 멀쩡한 배정은 그대로 반영된다. 아니면 위 검사가 "전부 기본값" 으로 공허해진다.
      const good = Object.fromEntries(roles.map((r) => [r, "metal"]));
      const entry = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, finishes: good })).json();
      for (const role of roles) {
        if (entry.finishes?.[role] !== "metal") bad.push(`멀쩡한 배정이 안 실렸다 — ${role}=${entry.finishes?.[role]}`);
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`모르는 재질·역할·타입 위장 ${filtered}가지 + 원문 JSON 프로토타입 공격 ${rawTried}가지가 걸러진다 (저장은 안 막힌다)`);
    out("양성 대조: 멀쩡한 배정은 그대로 실린다");
    out("S19_G1_OK");
  },

  /*
   * **배정을 안 보내면 기본 배정으로 채워진다.** 그리고 그 기본이 `material.js` 의 표와 같다.
   *
   * 기대값은 이 파일 맨 위의 **독립 사본**이다. `DEFAULT_FINISH_BY_ROLE` 에서 가져오면 그 표를
   * 뒤집어도 게이트가 함께 따라간다 — 이 저장소가 같은 부류로 네 번 뚫렸다.
   */
  "S19-G2": async () => {
    const bad = [];
    await withServer(4972, async (api) => {
      for (const structureId of [STRUCT, WIDE, AERIAL]) {
        const roles = rolesOf(structureId);
        const res = await api.post("/api/saved/derived", { seedId: SEED, structureId });
        if (res.status !== 200) {
          bad.push(`${structureId}: ${res.status}`);
          continue;
        }
        const entry = await res.json();
        if (!entry.finishes) {
          bad.push(`${structureId}: 배정이 없다`);
          continue;
        }
        if (Object.keys(entry.finishes).length !== roles.length) {
          bad.push(`${structureId}: 배정이 ${Object.keys(entry.finishes).length}개 (역할 ${roles.length}개)`);
        }
        for (const role of roles) {
          if (entry.finishes[role] !== EXPECTED_DEFAULT[role]) {
            bad.push(`${structureId}/${role}: ${entry.finishes[role]} (기대 ${EXPECTED_DEFAULT[role]})`);
          }
        }
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("배정 없이 저장한 구조 3개가 전부 기본 배정으로 채워지고, 독립 사본과 일치한다");
    out("S19_G2_OK");
  },

  /*
   * **저장된 배정이 그 구조의 실제 역할을 전부 덮는다.** 빠진 자리가 있으면 내보내기가
   * 그 색의 재질을 모른다 — 엔진 수치를 만들 수 없다.
   *
   * 구조마다 역할이 다르다(3색·4색·공기원근). 하나만 보면 나머지 둘이 검사 밖이다.
   */
  "S19-G3": async () => {
    const bad = [];
    let checked = 0;
    await withServer(4973, async (api) => {
      for (const structureId of [STRUCT, WIDE, AERIAL]) {
        for (const mode of ["light", "dark"]) {
          const roles = rolesOf(structureId, mode);
          const entry = await (await api.post("/api/saved/derived", { seedId: SEED, structureId, mode })).json();
          checked += 1;

          const keys = Object.keys(entry.finishes ?? {});
          if (keys.length !== roles.length) bad.push(`${structureId}(${mode}): 배정 ${keys.length}개 ≠ 역할 ${roles.length}개`);
          for (const role of roles) {
            if (!entry.finishes?.[role]) bad.push(`${structureId}(${mode}): ${role} 에 배정이 없다`);
          }
          // 색과 배정의 역할 이름이 같아야 짝이 맞는다.
          for (const c of entry.colors ?? []) {
            if (!entry.finishes?.[c.role]) bad.push(`${structureId}(${mode}): 색 ${c.role} 의 재질이 없다`);
          }
        }
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`구조 3개 × 모드 2 = ${checked}장에서 배정이 실제 역할을 전부 덮고 색과 짝이 맞는다`);
    out("S19_G3_OK");
  },

  /*
   * **재저장에서 배정도 이어받는다.** 비율·메모와 같은 규칙이다(S5-G5·S8-G2·S18-G4).
   *
   * 규칙이 셋 다 같아야 사용자가 "저장했는데 재질이 기본값으로 돌아갔다" 를 겪지 않는다.
   */
  "S19-G4": async () => {
    const bad = [];
    await withServer(4974, async (api) => {
      const roles = rolesOf(STRUCT);
      const custom = Object.fromEntries(roles.map((r) => [r, "metal"]));

      await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, finishes: custom, note: "메모" });
      // 배정 없이 재저장 — 이어받아야 한다.
      const again = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT })).json();
      for (const role of roles) {
        if (again.finishes?.[role] !== "metal") bad.push(`재저장에서 ${role} 배정이 안 이어졌다 — ${again.finishes?.[role]}`);
      }
      if (again.note !== "메모") bad.push("메모가 안 이어졌다 — 같은 규칙이어야 한다");

      const list = await saved(api);
      if (list.length !== 1) bad.push(`덮어쓰기가 아니라 ${list.length}개`);

      // 명시한 배정이 이어받기를 이긴다.
      const other = Object.fromEntries(roles.map((r) => [r, "matte"]));
      const explicit = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, finishes: other })).json();
      for (const role of roles) {
        if (explicit.finishes?.[role] !== "matte") bad.push(`명시한 배정이 안 이겼다 — ${role}`);
      }

      // 모드가 다르면 다른 항목이라 배정도 따로다.
      const dark = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, mode: "dark" })).json();
      for (const role of rolesOf(STRUCT, "dark")) {
        if (dark.finishes?.[role] !== EXPECTED_DEFAULT[role]) {
          bad.push(`어두운 모드가 밝은 모드의 배정을 물려받았다 — ${role}=${dark.finishes?.[role]}`);
        }
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("재저장이 배정·메모를 이어받고 명시한 것이 이긴다 · 모드가 다르면 배정도 따로다");
    out("S19_G4_OK");
  },

  /*
   * **화면이 배정을 보낸다.** 안 보내면 저장은 되지만 전부 기본 배정이 되어, 사용자가 화면에서
   * 본 "강조 = 발광" 과 저장된 것이 달라진다.
   *
   * **정적 검사다.** 회귀 스모크지 동작 증명이 아니다. 실제 동작은 브라우저에서 따로 본다.
   */
  "S19-G5": async () => {
    const bad = [];
    const app = stripComments(read("public/app.js"));

    const i = app.indexOf("function expansionSection");
    if (i < 0) throw new Error("expansionSection 을 못 찾았다 — 이 검사가 공허하다");
    const sec = app.slice(i, app.indexOf("function renderStatus", i));

    /*
     * **호출문만 보지 않고 조립부 전체를 본다.** 18단계 리뷰가 `S18-G9` 에 대해 정확히 이
     * 한계를 지적했다 — 본문을 별도 변수로 조립하면 호출문 밖이라 정적 검사를 우회한다.
     * 여기서는 `saveDerived` 클로저 전체를 잘라 본다. 실제로 이 구현이 배정을 호출문 **위에서**
     * 조립하므로, 좁게 잘랐다면 이 게이트가 거짓 실패를 냈을 것이다(실제로 그렇게 됐다).
     */
    const j = sec.indexOf("const saveDerived");
    if (j < 0) throw new Error("saveDerived 를 못 찾았다 — 이 검사가 공허하다");
    const k = sec.indexOf("redraw =", j);
    const call = sec.slice(j, k > 0 ? k : undefined);
    if (!call.includes("/api/saved/derived")) bad.push("saveDerived 가 저장 요청을 안 부른다");

    /*
     * **조립부와 호출부를 따로 본다.** 넓게 자른 것만으로는 "만들어 놓고 안 보내는" 변형을
     * 못 잡는다 — 실제로 그 뮤테이션이 통과했다. 17단계에서 리뷰가 같은 부류를 찾았다
     * (`structureColors` 를 부르고 반환을 버리는 변형).
     */
    if (!/finishes/.test(call)) bad.push("저장 요청을 만드는 자리에 finishes 가 없다");
    const at = call.indexOf("/api/saved/derived");
    const payload = at < 0 ? "" : call.slice(at, call.indexOf(")", at));
    // 호출 인자만 좁게 잘라 본다. 정규식 경계를 안 쓴다 — 이 저장소의 스크립트 편집 경로에서
    // 그 escape 가 실제 제어문자로 들어간 적이 있다(실측). 좁은 슬라이스면 포함 검사로 충분하다.
    if (!payload.includes("finishes")) {
      bad.push(`만들어 놓고 요청에 안 싣는다 — 저장이 전부 기본 배정이 된다 (본문: ${payload})`);
    }
    // 색은 여전히 안 보낸다(S18-G9 와 같은 규율).
    for (const forbidden of ["colors", "hex"]) {
      if (new RegExp(`\\b${forbidden}\\s*:`).test(call)) bad.push(`저장 요청에 ${forbidden} 를 싣는다`);
    }
    // 화면이 들고 있는 배정에서 가져와야 한다. 새로 지어내면 화면과 저장이 갈린다.
    if (!/fin\b|assignments/.test(call)) bad.push("화면이 들고 있는 배정(data.finishes)에서 안 가져온다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("저장 요청이 화면의 배정을 싣고, 색은 여전히 안 보낸다");
    out("S19_G5_OK");
  },

  /*
   * **배정이 색을 오염시키지 않는다.** 배정이 무엇이든 저장된 색은 서버가 다시 계산한 것과 같다.
   *
   * 18단계가 세운 경계(`S18-G1`)가 새 필드를 더한 뒤에도 살아 있는지 본다. 새 입구가 생기면
   * 옛 경계가 그 옆으로 뚫릴 수 있다 — 17단계에서 리뷰가 정확히 그 부류를 찾았다
   * (`assignments` 는 깨끗한데 반환 객체 전체는 아니었다).
   */
  "S19-G6": async () => {
    const bad = [];
    await withServer(4975, async (api) => {
      const roles = rolesOf(STRUCT);
      const want = shapeColors(
        expandSeed(palettes().find((p) => p.id === SEED), STRUCT, loadStructures(), { mode: "light" }).colors,
      );

      const attacks = [
        ["배정에 헥스", Object.fromEntries(roles.map((r) => [r, "#ff0000"]))],
        ["배정 값이 색 객체", Object.fromEntries(roles.map((r) => [r, { hex: "#00ff00" }]))],
        ["배정에 색 키를 섞음", { ...Object.fromEntries(roles.map((r) => [r, "matte"])), colors: "#0000ff", hex: "#0000ff" }],
      ];
      for (const [label, finishes] of attacks) {
        const entry = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, finishes })).json();
        if (shapeColors(entry.colors) !== want) bad.push(`${label}: 색이 재계산과 다르다`);
        const flat = JSON.stringify(entry).toLowerCase();
        for (const inject of ["ff0000", "00ff00", "0000ff"]) {
          if (flat.includes(inject)) bad.push(`${label}: 주입된 ${inject} 가 저장에 들어갔다`);
        }
        for (const [role, id] of Object.entries(entry.finishes ?? {})) {
          if (!FINISH_IDS.includes(id)) bad.push(`${label}: ${role} 에 재질이 아닌 값 ${id}`);
        }
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("색 주입 3가지에서 저장된 색이 재계산 그대로 · 주입된 헥스 0건 · 배정 값이 전부 실재하는 재질");
    out("S19_G6_OK");
  },
};

const id = process.argv[2];
const gate = Object.hasOwn(GATES, String(id)) ? GATES[id] : null;
if (!gate) {
  out(`쓰는 법: node scripts/check-stage19.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(2);
}

try {
  await gate();
} catch (err) {
  out(`${id} 실패: ${err.message}`);
  process.exit(1);
}
