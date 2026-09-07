#!/usr/bin/env node
// 22단계(/saved 가 저장된 재질을 보여준다) 완료 조건 검사기.
//   node scripts/check-stage22.mjs S22-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 다섯 게이트가 전부 실패하는 것을 확인한 뒤에
// public/ui.js · public/saved.js · server.js 를 고쳤다.
//
// **무엇이 안 보였나.** 파생 팔레트를 저장하면 재질이 남고(19단계) 엔진 수치로도 나가는데
// (20단계), 정작 `/saved` 목록에서는 **안 보였다.** 사용자는 자기가 무엇을 저장했는지
// 확인할 방법이 없었다 — 내보내기를 눌러 JSON 을 읽어야만 알 수 있었다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { findAll, installDom, text } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **재질 목록과 한글 이름을 여기 다시 적는다.** 감시할 대상에서 가져오면 그것을 바꾸는 순간
 * 게이트가 함께 느슨해진다. 이 저장소가 같은 부류로 다섯 번 뚫렸다.
 */
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const FINISH_KO = Object.freeze({ matte: "무광", gloss: "광택", metal: "메탈릭", emissive: "발광" });

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SEED = "pair-06";
const STRUCT = "complementary"; // 바탕 · 본문 · 강조

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
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-savedfin-"));
  const child = await startServer(port, { TONEFIRST_DATA_DIR: dir });
  const base = `http://127.0.0.1:${port}`;
  const api = {
    get: async (path) => {
      const res = await fetch(base + path);
      return { status: res.status, body: await res.json() };
    },
    post: (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    dir,
  };
  try {
    return await fn(api);
  } finally {
    // 자식이 실제로 끝날 때까지 기다린다 — 20단계에서 이걸 안 해 libuv 가 죽었다.
    const ended = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await ended;
    rmSync(dir, { recursive: true, force: true });
  }
}

const GATES = {
  /*
   * **목록 API 가 재질 이름을 함께 준다.**
   *
   * `savedFields` 는 재질 id(`matte`)를 갖고 있지만 화면에 그것을 그대로 찍으면 사용자가
   * 무엇인지 모른다. 이름은 카탈로그(`data/finishes.json`)가 갖고 있다.
   *
   * **화면이 이름을 박지 않는다.** 박으면 카탈로그를 고쳐도 화면이 안 따라오고, 그 어긋남은
   * 아무도 안 알려 준다. `/api/expand` 가 같은 이유로 같은 표를 보낸다(17-B).
   * 그 표를 `/api/saved` 에도 싣는다 — `limits` 를 싣는 것과 같은 자리다.
   */
  "S22-G1": async () => {
    const bad = [];
    await withServer(4991, async (api) => {
      const r = await api.get("/api/saved");
      if (r.status !== 200) {
        bad.push(`상태 ${r.status}`);
        return;
      }
      const names = r.body.finishNames;
      if (!names || typeof names !== "object") {
        bad.push(`finishNames 가 ${typeof names} 다 — 화면이 이름을 알 길이 없다`);
        return;
      }
      for (const id of FINISH_IDS) {
        if (names[id] !== FINISH_KO[id]) bad.push(`${id} 의 이름이 "${names[id]}" (${FINISH_KO[id]} 여야 한다)`);
      }
      if (Object.keys(names).length !== FINISH_IDS.length) {
        bad.push(`이름표에 ${Object.keys(names).length}개가 있다 (${FINISH_IDS.length}개여야 한다)`);
      }
      // 저장이 없어도 표는 온다. 화면이 "목록이 비면 이름도 없다" 를 다루지 않아도 되게.
      if ((r.body.saved ?? []).length !== 0) bad.push("빈 저장소인데 항목이 있다 — 이 검사의 전제가 깨졌다");
      // 기존 필드가 그대로 있는지(회귀).
      if (!r.body.limits) bad.push("limits 가 사라졌다 (기존 화면이 깨진다)");
    });
    out(bad.length ? bad.slice(0, 8).join("\n") : "목록 API 가 재질 id→한글 이름 표를 함께 준다 (저장이 없어도)");
    return bad.length === 0;
  },

  /*
   * **`savedFields` 가 재질을 내보낸다 — 역할과 짝지어, 그릴 수 있는 것만.**
   *
   * 화면 코드는 정적 검사밖에 못 하므로 무엇을 보여줄지 정하는 부분을 순수 함수로 두고
   * 게이트가 직접 부른다(17·18·20·21단계와 같은 자리).
   *
   * **색과 같은 규율로 거른다.** 저장 파일이 손상되면 모르는 재질이나 그 구조에 없는 역할이
   * 들어 있을 수 있고, 그대로 그리면 `undefined` 가 화면에 뜨거나 항목 하나가 목록 전체를
   * 죽인다(18-B 의 High 가 정확히 그것이었다).
   */
  "S22-G2": async () => {
    const bad = [];
    const { savedFields } = await import("../public/ui.js");

    const colors = [
      { role: "바탕", hex: "#111111", ratio: 40 },
      { role: "본문", hex: "#222222", ratio: 30 },
      { role: "강조", hex: "#333333", ratio: 30 },
    ];
    const derived = (extra) => ({ kind: "derived", name: "보색대비", mode: "light", colors, ...extra });

    const full = savedFields(derived({ finishes: { 바탕: "matte", 본문: "gloss", 강조: "emissive" } }));
    if (!Array.isArray(full.finishes)) {
      out(`savedFields 가 finishes 를 배열로 안 준다 (${typeof full.finishes})`);
      return false;
    }
    if (full.finishes.length !== 3) bad.push(`재질이 ${full.finishes.length}개다 (역할 3개여야 한다)`);
    // 색 순서와 같아야 한다 — 화면이 스와치와 나란히 읽는다.
    if (String(full.finishes.map((f) => f.role)) !== "바탕,본문,강조") {
      bad.push(`역할 순서가 ${full.finishes.map((f) => f.role)} 다 — 색 순서와 같아야 한다`);
    }
    if (full.finishes[1]?.id !== "gloss") bad.push(`본문의 재질이 ${full.finishes[1]?.id}`);

    /*
     * **손상된 것을 거른다.** 모르는 재질 · 색에 없는 역할 · 타입 위장 · 프로토타입 키.
     * 거부가 아니라 걸러내기다 — 하나 틀렸다고 항목 전체를 안 보여주면 사용자는 멀쩡한
     * 색과 비율까지 잃는다.
     */
    const dirty = savedFields(
      derived({
        finishes: {
          바탕: "velvet", // 모르는 재질
          본문: 7, // 타입 위장
          강조: "emissive", // 멀쩡
          면: "metal", // 이 구조에 없는 역할
          __proto__: "matte",
        },
      }),
    );
    const ids = dirty.finishes.map((f) => `${f.role}:${f.id}`);
    if (String(ids) !== "강조:emissive") bad.push(`손상된 것을 안 걸렀다 — [${ids}]`);

    // 재질이 아예 없는 옛 항목도 안 던진다.
    for (const [what, value] of [["없음", undefined], ["null", null], ["배열", []], ["문자열", "matte"]]) {
      const got = savedFields(derived({ finishes: value }));
      if (!Array.isArray(got.finishes) || got.finishes.length !== 0) {
        bad.push(`finishes 가 ${what} 일 때 ${JSON.stringify(got.finishes)} 가 나온다 (빈 배열이어야 한다)`);
      }
    }

    // **코퍼스 항목에는 재질이 없다.** 배색사전은 재질을 말하지 않는다(20단계와 같은 경계).
    const corpus = savedFields({ name: "앰버 × 커피브라운", type: "D", colors, finishes: { 바탕: "matte" } });
    if (corpus.finishes?.length) bad.push(`코퍼스 항목에 재질이 붙었다 — [${corpus.finishes.map((f) => f.id)}]`);

    // **손댄 것인지 표시한다.** 재질은 이 화면에서 못 고치므로 "왜 이게 메탈릭이지" 를 답해야 한다.
    if (savedFields(derived({ finishes: { 바탕: "matte" }, finishesAdjusted: true })).finishesAdjusted !== true) {
      bad.push("손댄 표시를 안 내보낸다");
    }
    for (const truthy of ["yes", 1, {}]) {
      if (savedFields(derived({ finishes: {}, finishesAdjusted: truthy })).finishesAdjusted !== true) {
        bad.push(`finishesAdjusted 가 ${JSON.stringify(truthy)} 일 때 참·거짓으로 안 바뀐다`);
      }
    }
    if (savedFields(derived({ finishes: {} })).finishesAdjusted !== false) bad.push("손 안 댔는데 참이다");

    out(bad.length ? bad.slice(0, 8).join("\n") : "savedFields 가 재질을 색 순서로 주고, 손상된 것 5가지를 거르고, 손댄 표시를 낸다");
    return bad.length === 0;
  },

  /*
   * **화면이 그 재질을 실제로 그린다.**
   *
   * `savedFields` 가 내보내기만 하고 화면이 안 읽으면 아무것도 안 바뀐다. 19단계 `S19-G5` ·
   * 21단계 `S21-G4` 가 "만들어 놓고 안 쓰는" 같은 부류를 겪었다 — 세 번째다.
   */
  "S22-G3": async () => {
    const bad = [];
    installDom();
    const { finishLine } = await import("../public/ui.js");
    if (typeof finishLine !== "function") {
      out("public/ui.js 가 finishLine 을 안 내보낸다");
      return false;
    }

    /*
     * **글자를 찾는 대신 직접 부른다.**
     *
     * 처음엔 `saved.js` 소스에서 `fields.finishes` 같은 글자를 찾아 "화면이 그린다" 를
     * 확인했다. 뮤테이션으로 재 보니 **`if (false)` 로 감싸거나 `void` 로 버려도 통과**했다 —
     * 글자는 그대로 남기 때문이다. 21단계 리뷰가 `S21-G4` 에서 같은 부류를 잡았고 처방도
     * 같다: 그리는 부분을 함수로 빼고 게이트가 부른다.
     */
    const fields = {
      finishes: [
        { role: "바탕", id: "matte" },
        { role: "본문", id: "gloss" },
        { role: "강조", id: "emissive" },
      ],
      finishesAdjusted: false,
    };
    const names = { ...FINISH_KO };
    const line = finishLine(fields, (id) => names[id]);
    if (!line) {
      out("재질이 있는데 줄을 안 그린다");
      return false;
    }
    const shown = text(line);
    for (const f of fields.finishes) {
      if (!shown.includes(f.role)) bad.push(`${f.role} 이 화면에 안 나온다`);
      if (!shown.includes(FINISH_KO[f.id])) bad.push(`${f.id} 의 한글 이름이 안 나온다 (${shown})`);
      // id 가 날것으로 새면 사용자가 무엇인지 모른다.
      if (shown.includes(f.id)) bad.push(`재질 id "${f.id}" 가 그대로 화면에 나온다`);
    }

    /*
     * **손댄 표시.** 재질은 이 화면에서 못 고치므로 "왜 이게 메탈릭이지" 를 답해 줘야 한다.
     * 붙을 때와 안 붙을 때를 **둘 다** 본다 — 한쪽만 보면 "늘 붙는다" 를 못 잡는다.
     */
    if (shown.includes("직접 고름")) bad.push("안 건드렸는데 손댄 표시가 붙는다");
    const touched = text(finishLine({ ...fields, finishesAdjusted: true }, (id) => names[id]));
    if (!touched.includes("직접 고름")) bad.push("손댔는데 표시가 안 붙는다");

    /*
     * **이름표가 없어도 줄이 사라지지 않는다.** 서버가 표를 못 보냈을 때 재질 줄이 통째로
     * 없어지는 것보다 `matte` 라고라도 보이는 편이 낫다.
     */
    for (const [what, fn] of [
      ["이름표 없음", null],
      ["빈 표", () => undefined],
      ["문자열 아닌 이름", () => ({})],
      ["빈 문자열", () => ""],
    ]) {
      const fallback = finishLine(fields, fn);
      if (!fallback) {
        bad.push(`${what} 일 때 줄이 통째로 사라진다`);
        continue;
      }
      if (!text(fallback).includes("matte")) bad.push(`${what} 일 때 id 로도 안 보인다`);
    }

    // 그릴 것이 없으면 아무것도 안 만든다 — 코퍼스 항목에 빈 줄이 생기지 않게.
    for (const empty of [{ finishes: [] }, { finishes: null }, {}, null, undefined]) {
      if (finishLine(empty, (id) => names[id]) !== null) bad.push(`${JSON.stringify(empty)} 에 빈 줄이 생긴다`);
    }

    // 사용자·카탈로그 문자열은 글자로만 들어간다(이 저장소의 화면 규칙).
    const nasty = "<img src=x onerror=alert(1)>";
    const evil = finishLine({ finishes: [{ role: nasty, id: "matte" }], finishesAdjusted: false }, () => nasty);
    if (findAll(evil, (n) => n.tag === "img").length) bad.push("이름이 마크업으로 해석됐다");
    if (!text(evil).includes(nasty)) bad.push("이름이 글자 그대로 안 들어갔다");

    /*
     * **여기부터는 정적 검사다. 표기만 본다.**
     *
     * `saved.js` 는 최상단에서 `getElementById` 를 부르고 마지막에 `load()` 를 부르므로
     * 게이트가 불러올 수 없다 — 불러오는 순간 요청이 나간다. 그래서 남은 **배선**
     * ("함수를 부르고 결과를 붙인다")은 글자로만 잰다.
     *
     * **그래도 두는 이유는 지워지는 것을 잡기 때문이다.** 우회는 가능하지만(변형으로 확인),
     * 이 네 자리가 깨지면 **화면을 열자마자 보인다** — 재질 줄이 없거나 `matte` 라고 뜬다.
     * 21단계에서 추출까지 간 것은 그 우회가 **조용히** 결과를 바꿨기 때문이고, 여기는 다르다.
     * 판단이 바뀔 조건: 이 배선이 눈에 안 보이는 것을 바꾸게 될 때.
     */
    const js = stripComments(read("public/saved.js"));
    if (!/finishLine\s*\(/.test(js)) bad.push("saved.js 가 finishLine 을 안 부른다");
    if (!/body\.append\(\s*finishes\s*\)/.test(js)) bad.push("saved.js 가 재질 줄을 카드에 안 붙인다");
    /*
     * **선언이 아니라 실제 자리를 본다.** 처음엔 `savedCard\(.*finishNames\)` 를 찾았는데
     * **함수 선언**(`function savedCard(entry, onRemoved, finishNames = null)`)이 그 검사를
     * 만족시켜, 호출부에서 인자를 빼도 통과했다(변형으로 확인).
     */
    if (!/finishNames\s*}\s*=\s*await\s+api\(/.test(js)) bad.push("목록 응답에서 이름표를 안 꺼낸다");
    if (!/append\(\s*savedCard\([^)]*finishNames[^)]*\)/.test(js)) {
      bad.push("카드를 부를 때 이름표를 안 넘긴다 — 화면이 id 를 보인다");
    }
    if (!/Object\.hasOwn\(names/.test(js)) bad.push("이름표 조회가 자기 속성을 안 본다");
    // 이름을 화면에 박으면 카탈로그를 고쳐도 안 따라온다.
    for (const ko of Object.values(FINISH_KO)) {
      if (js.includes(`"${ko}"`)) bad.push(`saved.js 에 재질 이름 "${ko}" 이 박혀 있다`);
    }
    const css = read("public/app.css");
    if (!/card__finishes/.test(css)) bad.push("재질 줄에 스타일이 없다");

    out(
      bad.length
        ? bad.slice(0, 8).join("\n")
        : "재질 줄이 역할·한글 이름을 그리고, 손댄 표시가 양쪽으로 갈리고, 이름표가 없어도 안 사라진다",
    );
    return bad.length === 0;
  },

  "S22-G4": async () => {
    const bad = [];
    const { savedFields } = await import("../public/ui.js");
    await withServer(4992, async (api) => {
      // 손으로 고른 것 하나(바탕의 기본은 무광이므로 광택은 손댄 것이다)
      const r1 = await api.post("/api/saved/derived", {
        seedId: SEED,
        structureId: STRUCT,
        mode: "light",
        finishes: { 바탕: "gloss" },
      });
      if (!r1.ok) throw new Error(`저장 실패 (${r1.status})`);

      const { body } = await api.get("/api/saved");
      const entry = (body.saved ?? []).find((e) => e.kind === "derived");
      if (!entry) {
        bad.push("파생 항목이 목록에 없다");
        return;
      }
      const fields = savedFields(entry);
      if (fields.finishes.length !== 3) bad.push(`재질이 ${fields.finishes.length}개 보인다 (3개여야 한다)`);
      const 바탕 = fields.finishes.find((f) => f.role === "바탕");
      if (바탕?.id !== "gloss") bad.push(`손으로 고른 바탕이 ${바탕?.id} 로 보인다`);
      if (fields.finishesAdjusted !== true) bad.push("손댔는데 표시가 안 붙는다");

      // 이름표로 한글이 나오는가 — 화면이 하는 것과 같은 조회.
      for (const f of fields.finishes) {
        const name = body.finishNames?.[f.id];
        if (name !== FINISH_KO[f.id]) bad.push(`${f.role} 의 이름이 "${name}" 로 나온다`);
      }

      // 색과 짝이 맞는가. 어긋나면 "바탕은 광택" 이 엉뚱한 색 옆에 붙는다.
      if (String(fields.finishes.map((f) => f.role)) !== String(fields.colors.map((c) => c.role))) {
        bad.push(`재질 순서 [${fields.finishes.map((f) => f.role)}] 가 색 순서 [${fields.colors.map((c) => c.role)}] 와 다르다`);
      }

      // **양성 대조** — 안 건드린 저장은 표시가 안 붙는다.
      const r2 = await api.post("/api/saved/derived", { seedId: SEED, structureId: "analogous", mode: "dark" });
      if (!r2.ok) throw new Error(`두 번째 저장 실패 (${r2.status})`);
      const again = await api.get("/api/saved");
      const plain = (again.body.saved ?? []).find((e) => e.structureId === "analogous");
      if (savedFields(plain).finishesAdjusted !== false) bad.push("안 건드렸는데 손댄 표시가 붙는다");
      if (savedFields(plain).finishes.length !== 3) bad.push("기본 배정이 안 보인다");
    });
    out(bad.length ? bad.slice(0, 8).join("\n") : "저장한 재질이 목록에 그대로 보인다 — 이름·순서·손댄 표시 (양성 대조 포함)");
    return bad.length === 0;
  },

  /*
   * **손상된 항목 하나가 목록 전체를 못 죽인다.**
   *
   * 18-B 에서 정확히 이 일이 났다 — `savedCard` 가 `entry.colors` 를 가드 없이 읽어,
   * 항목 하나가 던지자 `load()` 의 catch 가 **목록을 통째로 비웠다.** 리뷰가 High 로 잡았다.
   * 재질을 새로 그리면서 그 자리가 다시 생긴다.
   */
  "S22-G5": async () => {
    const bad = [];
    const { savedFields } = await import("../public/ui.js");
    await withServer(4993, async (api) => {
      const r = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, mode: "light" });
      if (!r.ok) throw new Error(`저장 실패 (${r.status})`);

      const file = join(api.dir, "saved.json");
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const list = Array.isArray(doc) ? doc : doc.saved;
      if (!Array.isArray(list)) throw new Error("저장 파일 형태가 바뀌었다 — 이 게이트를 고쳐야 한다");
      const donor = list.find((e) => e.kind === "derived");

      list.push({ ...donor, id: "broken-1", finishes: "재질" });
      list.push({ ...donor, id: "broken-2", finishes: { 바탕: { id: "matte" } } });
      list.push({ ...donor, id: "broken-3", colors: undefined, finishes: { 바탕: "matte" } });
      list.push({ id: "broken-4" });
      writeFileSync(file, JSON.stringify(Array.isArray(doc) ? list : { ...doc, saved: list }, null, 2), "utf8");

      const { body } = await api.get("/api/saved");
      let drawn = 0;
      for (const entry of body.saved ?? []) {
        try {
          const f = savedFields(entry);
          if (!Array.isArray(f.finishes)) bad.push(`${entry.id}: finishes 가 배열이 아니다`);
          if (f.finishes.some((x) => typeof x.id !== "string" || !FINISH_IDS.includes(x.id))) {
            bad.push(`${entry.id}: 모르는 재질이 샜다`);
          }
          if (String(JSON.stringify(f)).includes("undefined")) bad.push(`${entry.id}: undefined 가 샜다`);
          drawn += 1;
        } catch (err) {
          bad.push(`${entry.id} 에서 던졌다 — ${err.message} (목록 전체가 사라진다)`);
        }
      }
      if (drawn !== 5) bad.push(`${drawn}개만 그려졌다 (멀쩡한 1 + 손상 4 = 5개여야 한다)`);
    });
    out(bad.length ? bad.slice(0, 8).join("\n") : "손상 항목 4가지에서도 안 던지고 undefined 도 안 샌다 (다섯 개 다 그려짐)");
    return bad.length === 0;
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage22.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  const ok = await GATES[id]();
  if (ok) out(id.replace(/-/g, "_") + "_OK");
  process.exitCode = ok ? 0 : 1;
}
