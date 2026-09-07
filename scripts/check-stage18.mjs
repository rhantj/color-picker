#!/usr/bin/env node
// 18단계(파생 팔레트 저장) · 18-A 완료 조건 검사기.
//   node scripts/check-stage18.mjs S18-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 여덟 게이트가 전부 실패하는 것을 확인한 뒤에
// src/store.js 와 server.js 를 고쳤다. 통과부터 하는 게이트는 무엇을 지키는지 알 수 없다.
//
// 18-A 가 서버·저장소(G1~G8), 18-B 가 홈의 저장 버튼과 `/saved` 화면 표시(G9~G12)다.
//
// **HTTP 로 검사한다.** 저장소 함수를 직접 부르면 `isTrustedWrite`·입력 검증·직렬화를 건너뛴다 —
// 그것들이 이 단계에서 실제로 지켜야 하는 것의 절반이다. check-stage4·8·10 이 같은 이유로
// 같은 방식을 쓴다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandSeed, loadStructures } from "../src/expand.js";
import { savedFields } from "../public/ui.js";
import { FORMATS } from "../src/export.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const palettes = () => JSON.parse(read("data/palettes.json")).palettes;

/**
 * **최소 지분을 여기 다시 적는다.** `public/ratio.js` 의 `MIN_SHARE` 를 읽어 오면 그쪽을
 * 낮췄을 때 이 게이트가 함께 느슨해진다. 이 저장소가 같은 부류로 세 번 뚫렸다
 * (`fallbackSelection()` · `METAL_MIN` · `DEFAULT_FINISH_BY_ROLE`).
 */
const EXPECTED_MIN_SHARE = 10;

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

/** 임시 데이터 디렉터리에서 서버를 띄운다. 사용자 데이터를 오염시키지 않는다. */
async function withServer(port, fn, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-derived-"));
  const child = await startServer(port, { TONEFIRST_DATA_DIR: dir, ...extraEnv });
  const base = `http://127.0.0.1:${port}`;
  const api = {
    get: (path) => fetch(base + path),
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
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}

const saved = async (api) => (await (await api.get("/api/saved")).json()).saved ?? [];

/** 이 씨앗·구조를 서버와 **무관하게** 다시 계산한다. 응답과 대조할 독립 기준이다. */
const expectColors = (seedId, structureId, mode) => {
  const seed = palettes().find((p) => p.id === seedId);
  const st = expandSeed(seed, structureId, loadStructures(), mode === "dark" ? { mode } : undefined);
  return st ? st.colors.map((c) => `${c.role}:${c.hex}`).join(",") : null;
};

/** 주석을 걷어낸 소스. check-stage13·15·17 과 같은 예외(문자열 안 URL 스킴)를 같은 이유로 둔다. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const shapeColors = (colors) => (colors ?? []).map((c) => `${c.role}:${c.hex}`).join(",");

const SEED = "pair-06";
const STRUCT = "complementary";

const GATES = {
  /*
   * **화면이 준 색을 서버가 믿지 않는다.**
   *
   * `src/store.js` 규칙 4 가 그것을 이미 적어 뒀다 — "색·헥스·유형은 서버가 코퍼스에서 찾아
   * 채운다. 화면이 보낸 색을 그대로 저장하면 저장소가 코퍼스와 어긋나기 시작한다."
   * 파생은 코퍼스에 없지만 **결정적이라**(S11-G3) 서버가 다시 계산할 수 있다. 그래서 화면은
   * 씨앗 id·구조 id·모드만 보낸다.
   *
   * 검사: 요청에 색을 실어 보내도 **무시되고**, 저장된 색이 게이트가 독립적으로 계산한 것과
   * 정확히 같다. `S4-G2` 가 2색에 대해 같은 것을 본다.
   */
  "S18-G1": async () => {
    const bad = [];
    await withServer(4961, async (api) => {
      const want = expectColors(SEED, STRUCT, "light");
      if (!want) throw new Error("기준 색을 계산하지 못했다 — 이 검사가 공허하다");

      // 색을 실어 보낸다. 전부 새빨간 거짓말이다.
      const res = await api.post("/api/saved/derived", {
        seedId: SEED,
        structureId: STRUCT,
        colors: [{ role: "바탕", hex: "#ff0000" }, { role: "본문", hex: "#00ff00" }, { role: "강조", hex: "#0000ff" }],
        hex: "#ff0000",
        name: "내가 지은 이름",
      });
      if (res.status !== 200) bad.push(`저장이 ${res.status}`);
      const entry = await res.json();

      if (shapeColors(entry.colors) !== want) {
        bad.push(`저장된 색이 서버 계산과 다르다 — ${shapeColors(entry.colors)} != ${want}`);
      }
      const flat = JSON.stringify(entry).toLowerCase();
      for (const lie of ["ff0000", "00ff00", "0000ff", "내가 지은 이름"]) {
        if (flat.includes(lie.toLowerCase())) bad.push(`요청에 실은 "${lie}" 가 저장에 들어갔다`);
      }
      if (entry.kind !== "derived") bad.push(`kind 가 ${entry.kind}`);
      if (entry.seedId !== SEED || entry.structureId !== STRUCT) bad.push("씨앗·구조 id 가 안 남았다");

      // 목록에서도 같은가.
      const list = await saved(api);
      if (list.length !== 1) bad.push(`목록이 ${list.length}개`);
      if (shapeColors(list[0]?.colors) !== want) bad.push("목록의 색이 다르다");
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("요청에 실은 색·이름 4가지가 전부 무시되고, 저장된 색이 서버 계산과 정확히 같다");
    out("S18_G1_OK");
  },

  /*
   * **다색 비율.** 2색은 숫자 하나(`70` → `[70,30]`)로 받지만 파생은 3~4색이라 배열이다.
   *
   * `public/ratio.js` 의 `shareBounds` 주석이 이 단계를 미리 적어 뒀다 — "다음 단계(다색 저장)
   * 에서 색이 늘면 조용히 깨진다".
   *
   * 무는 것 넷 — 길이가 색 개수와 같다 · 전부 정수다 · 각자 하한 이상이다 · 합이 정확히 100 이다.
   * 합이 100 이 아니면 스와치 바에 틈이 생기거나 마지막 색이 잘려, 화면이 말하는 비율과
   * 보이는 비율이 달라진다(S13-G1 이 같은 이유로 같은 것을 본다).
   *
   * **거부된 요청이 아무것도 안 바꾼다**는 것까지 본다. `S5-G3` 이 2색에서 같은 규율을 건다.
   */
  "S18-G2": async () => {
    const bad = [];
    await withServer(4962, async (api) => {
      const n = expectColors(SEED, STRUCT, "light").split(",").length;
      if (n < 3) throw new Error(`색이 ${n}개다 — 다색 검사가 공허하다`);

      const good = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT });
      if (good.status !== 200) bad.push(`기본 저장이 ${good.status}`);
      const before = JSON.stringify(await saved(api));

      const rejects = [
        ["길이가 짧다", [50, 50]],
        ["길이가 길다", [25, 25, 25, 25, 0]],
        ["합이 99", [33, 33, 33]],
        ["합이 101", [34, 34, 33]],
        ["소수", [33.5, 33.5, 33]],
        ["문자열", ["33", "33", "34"]],
        ["하한 미만", [5, 5, 90]],
        ["음수", [-10, 60, 50]],
        ["배열이 아님", 70],
        ["빈 배열", []],
        ["null 이 섞임", [50, null, 50]],
      ];
      for (const [label, shares] of rejects) {
        const res = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares });
        if (res.status === 200) bad.push(`${label} 가 통과했다: ${JSON.stringify(shares)}`);
      }
      const after = JSON.stringify(await saved(api));
      if (before !== after) bad.push("거부된 요청이 저장소를 바꿨다");

      // 양성 대조 — 멀쩡한 배열은 통과하고 실제로 반영된다. 아니면 위 검사가 "전부 거부" 로 공허해진다.
      const okShares = n === 3 ? [50, 30, 20] : [40, 30, 20, 10];
      const res = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares: okShares });
      if (res.status !== 200) bad.push(`멀쩡한 비율이 거부됐다: ${(await res.json()).error}`);
      else {
        const entry = await res.json();
        if (JSON.stringify(entry.colors.map((c) => c.ratio)) !== JSON.stringify(okShares)) {
          bad.push(`비율이 반영 안 됐다 — ${JSON.stringify(entry.colors.map((c) => c.ratio))}`);
        }
        if (entry.ratioAdjusted !== true) bad.push("손댄 비율인데 ratioAdjusted 가 false");
      }

      // 하한이 게이트의 독립 사본과 같은가. 하한을 낮추면 여기서 운다.
      const atFloor = [EXPECTED_MIN_SHARE, ...Array(n - 2).fill(EXPECTED_MIN_SHARE)];
      atFloor.push(100 - EXPECTED_MIN_SHARE * (n - 1));
      const floorRes = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares: atFloor.slice(0, n) });
      if (floorRes.status !== 200) bad.push(`하한 ${EXPECTED_MIN_SHARE} 정확히가 거부됐다`);
      const under = [...atFloor.slice(0, n)];
      under[0] -= 1;
      under[n - 1] += 1;
      const underRes = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares: under });
      if (underRes.status === 200) bad.push(`하한 ${EXPECTED_MIN_SHARE} 아래가 통과했다`);
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("잘못된 비율 11가지가 전부 거부되고 저장소가 안 바뀐다 · 멀쩡한 비율은 반영됨");
    out(`하한 ${EXPECTED_MIN_SHARE} 정확히는 통과, 하나 아래는 거부 (게이트의 독립 사본과 대조)`);
    out("S18_G2_OK");
  },

  /*
   * 불량 입력에서 **4xx 로 답하고 서버가 안 죽는다.** `S13-G5` 가 `/api/expand` 에 대해 같은
   * 것을 본다. 여기서 특히 무는 것은 **프로토타입 이름** — `expandSeed` 가 `Object.hasOwn` 으로
   * 거르는 것을 확인했지만, 저장 경로가 그 앞에서 다른 조회를 하면 거기서 샐 수 있다.
   *
   * **양성 대조를 함께 둔다** — 멀쩡한 요청이 거부되면 이 게이트는 "전부 거부" 를 통과시킨다.
   */
  "S18-G3": async () => {
    const bad = [];
    await withServer(4963, async (api) => {
      const rejects = [
        ["씨앗 없음", {}],
        ["없는 씨앗", { seedId: "없는씨앗", structureId: STRUCT }],
        ["씨앗이 프로토타입", { seedId: "__proto__", structureId: STRUCT }],
        ["구조 없음", { seedId: SEED }],
        ["없는 구조", { seedId: SEED, structureId: "없는구조" }],
        ["구조가 프로토타입", { seedId: SEED, structureId: "__proto__" }],
        ["구조가 constructor", { seedId: SEED, structureId: "constructor" }],
        ["씨앗이 객체", { seedId: { id: SEED }, structureId: STRUCT }],
        ["구조가 배열", { seedId: SEED, structureId: [STRUCT] }],
        ["아주 긴 씨앗 id", { seedId: "x".repeat(500), structureId: STRUCT }],
        ["없는 모드", { seedId: SEED, structureId: STRUCT, mode: "형광" }],
        ["모드가 프로토타입", { seedId: SEED, structureId: STRUCT, mode: "__proto__" }],
      ];
      for (const [label, body] of rejects) {
        const res = await api.post("/api/saved/derived", body);
        if (res.status === 200) bad.push(`${label} 가 통과했다`);
        else if (res.status >= 500) bad.push(`${label} 에 ${res.status} — 서버 잘못으로 답한다`);
      }

      // 서버가 살아 있는가. 죽었으면 아래가 실패한다.
      const alive = await api.get("/api/saved");
      if (alive.status !== 200) bad.push(`불량 입력 뒤에 목록이 ${alive.status}`);

      // 양성 대조 — 멀쩡한 요청 셋(기본·어두운 모드·명시 밝은 모드)은 통과한다.
      for (const body of [
        { seedId: SEED, structureId: STRUCT },
        { seedId: SEED, structureId: STRUCT, mode: "dark" },
        { seedId: SEED, structureId: STRUCT, mode: "light" },
      ]) {
        const res = await api.post("/api/saved/derived", body);
        if (res.status !== 200) bad.push(`양성 대조 ${JSON.stringify(body)} 가 ${res.status}`);
      }
      // 모드가 다르면 **다른 항목**이다 — 같은 구조라도 색이 다르기 때문이다.
      const list = await saved(api);
      const modes = new Set(list.map((e) => e.mode));
      if (list.length !== 2) bad.push(`밝은·어두운이 ${list.length}개로 저장됐다 (2개여야 한다)`);
      if (modes.size !== 2) bad.push(`모드가 ${[...modes].join(",")}`);
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("불량 입력 12가지가 전부 4xx 이고 서버가 살아 있다 · 양성 대조 3가지 통과");
    out("밝은·어두운 모드가 서로 다른 항목으로 남는다");
    out("S18_G3_OK");
  },

  /*
   * **같은 파생을 다시 저장하면 덮어쓰기다.** 그리고 안 보낸 것은 앞의 것을 이어받는다 —
   * `S5-G5`(비율)·`S8-G2`(메모)가 2색에서 같은 규칙을 건다. 규칙이 하나여야 사용자가
   * "저장했는데 메모가 사라졌다" 를 겪지 않는다.
   *
   * **음성 대조**: 빈 메모는 "지우기" 라서 이어받지 않는다(`S8-G3` 과 같은 규칙).
   */
  "S18-G4": async () => {
    const bad = [];
    await withServer(4964, async (api) => {
      const n = expectColors(SEED, STRUCT, "light").split(",").length;
      const custom = n === 3 ? [50, 30, 20] : [40, 30, 20, 10];

      await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares: custom, note: "첫 메모" });
      // 비율·메모 없이 재저장 — 둘 다 이어받아야 한다.
      const again = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT })).json();
      if (JSON.stringify(again.colors.map((c) => c.ratio)) !== JSON.stringify(custom)) {
        bad.push(`재저장에서 비율이 안 이어졌다 — ${JSON.stringify(again.colors.map((c) => c.ratio))}`);
      }
      if (again.note !== "첫 메모") bad.push(`재저장에서 메모가 안 이어졌다 — ${again.note}`);

      const list = await saved(api);
      if (list.length !== 1) bad.push(`덮어쓰기가 아니라 ${list.length}개가 됐다`);

      /*
       * 음성 대조 — 빈 메모는 지우기다.
       *
       * **`null` 도 함께 본다.** 처음엔 빈 문자열만 봤고 리뷰가 그 틈으로 뚫었다 —
       * `String(null)` 이 문자열 `"null"` 이 되어 그대로 저장됐다. 화면이 "메모 없음" 을
       * `null` 로 보내는 것은 흔한 형태이고, 그러면 사용자에게 안 보이는 "null" 이 남는다.
       */
      for (const empty of ["   ", "", null, String.fromCharCode(9, 10)]) {
        const cleared = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, note: empty })).json();
        if (cleared.note) bad.push(`빈 메모 ${JSON.stringify(empty)} 를 보냈는데 "${cleared.note}" 가 남았다`);
      }
      // 양성 대조 — 진짜 메모는 남는다. 아니면 위 검사가 "전부 지운다" 로 공허해진다.
      const kept = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, note: "남을 메모" })).json();
      if (kept.note !== "남을 메모") bad.push(`진짜 메모가 안 남았다 — ${kept.note}`);

      // 명시한 비율이 이어받기를 이긴다.
      const other = n === 3 ? [20, 30, 50] : [10, 20, 30, 40];
      const explicit = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, shares: other })).json();
      if (JSON.stringify(explicit.colors.map((c) => c.ratio)) !== JSON.stringify(other)) {
        bad.push("명시한 비율이 안 이겼다");
      }
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("재저장이 덮어쓰기이고 비율·메모를 이어받는다 · 빈 메모는 지우기 · 명시한 비율이 이긴다");
    out("S18_G4_OK");
  },

  /*
   * **저장한 파생의 비율을 나중에 바꿀 수 있고 색은 안 바뀐다.** `S5-G2` 의 다색판이다.
   *
   * 기존 `/api/saved/ratio` 는 숫자 하나를 받아 `[v, 100-v]` 를 만든다 — 2색 전용이다.
   * 파생 항목에는 배열을 받아야 하고, **2색 항목의 기존 동작은 그대로여야 한다**(S18-G8 이
   * 그 회귀를 본다).
   */
  "S18-G5": async () => {
    const bad = [];
    await withServer(4965, async (api) => {
      const created = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT })).json();
      const n = created.colors.length;
      const before = shapeColors(created.colors);
      const next = n === 3 ? [60, 25, 15] : [40, 25, 20, 15];

      const res = await api.post("/api/saved/ratio", { id: created.id, ratio: next });
      if (res.status !== 200) bad.push(`비율 변경이 ${res.status} — ${(await res.json()).error}`);
      else {
        const entry = await res.json();
        if (JSON.stringify(entry.colors.map((c) => c.ratio)) !== JSON.stringify(next)) {
          bad.push(`비율이 안 바뀌었다 — ${JSON.stringify(entry.colors.map((c) => c.ratio))}`);
        }
        if (shapeColors(entry.colors) !== before) bad.push("비율만 바꿨는데 색이 바뀌었다");
        if (entry.ratioAdjusted !== true) bad.push("손댄 비율인데 ratioAdjusted 가 false");
      }

      // 잘못된 배열은 거부되고 아무것도 안 바꾼다.
      const snapshot = JSON.stringify(await saved(api));
      for (const wrong of [[50, 50], [33, 33, 33], [5, 5, 90], 70, "x", null]) {
        const r = await api.post("/api/saved/ratio", { id: created.id, ratio: wrong });
        if (r.status === 200) bad.push(`잘못된 비율 ${JSON.stringify(wrong)} 가 통과했다`);
      }
      if (JSON.stringify(await saved(api)) !== snapshot) bad.push("거부된 비율 변경이 저장소를 바꿨다");

      // 기본값으로 되돌리면 ratioAdjusted 가 false 로 돌아온다.
      const back = await (await api.post("/api/saved/ratio", { id: created.id, ratio: created.defaultRatio })).json();
      if (back.ratioAdjusted !== false) bad.push(`기본값으로 되돌렸는데 ratioAdjusted 가 ${back.ratioAdjusted}`);
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("파생 항목의 비율을 배열로 바꿀 수 있고 색은 안 바뀐다 · 잘못된 값 6가지 거부 · 기본값 복귀");
    out("S18_G5_OK");
  },

  /*
   * **파생과 코퍼스 항목이 섞여도 목록·메모·삭제가 둘 다 동작한다.**
   *
   * `kind` 가 없던 옛 항목은 코퍼스 항목이다. 저장소에 이미 그런 것이 있으므로, 없다고
   * 터지거나 파생으로 오인하면 안 된다.
   */
  "S18-G6": async () => {
    const bad = [];
    await withServer(4966, async (api) => {
      const corpusId = palettes()[0].id;
      const a = await (await api.post("/api/saved", { paletteId: corpusId, note: "코퍼스 메모" })).json();
      const b = await (await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, note: "파생 메모" })).json();

      const list = await saved(api);
      if (list.length !== 2) bad.push(`목록이 ${list.length}개`);
      const kinds = list.map((e) => e.kind ?? "palette").sort();
      if (JSON.stringify(kinds) !== JSON.stringify(["derived", "palette"])) {
        bad.push(`kind 가 ${JSON.stringify(kinds)}`);
      }
      // 옛 항목처럼 kind 가 없는 것은 코퍼스로 읽힌다.
      const corpusEntry = list.find((e) => e.id === a.id);
      if (corpusEntry.kind !== undefined && corpusEntry.kind !== "palette") {
        bad.push(`코퍼스 항목의 kind 가 ${corpusEntry.kind}`);
      }

      // 메모 편집이 양쪽에서 된다.
      for (const [label, id] of [["코퍼스", a.id], ["파생", b.id]]) {
        const res = await api.post("/api/saved/note", { id, note: `${label} 고침` });
        if (res.status !== 200) bad.push(`${label} 메모 편집이 ${res.status}`);
        else if ((await res.json()).note !== `${label} 고침`) bad.push(`${label} 메모가 안 바뀌었다`);
      }

      // 삭제가 양쪽에서 되고, 하나 지워도 다른 하나가 남는다.
      const del = await api.post("/api/saved/delete", { id: b.id });
      if (del.status !== 200) bad.push(`파생 삭제가 ${del.status}`);
      const left = await saved(api);
      if (left.length !== 1 || left[0].id !== a.id) bad.push(`삭제 뒤 목록이 ${JSON.stringify(left.map((e) => e.id))}`);
      const del2 = await api.post("/api/saved/delete", { id: a.id });
      if (del2.status !== 200) bad.push(`코퍼스 삭제가 ${del2.status}`);
      if ((await saved(api)).length !== 0) bad.push("둘 다 지웠는데 남았다");
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("코퍼스·파생이 섞여도 목록이 둘을 kind 로 가르고, 메모 편집·삭제가 양쪽에서 동작");
    out("S18_G6_OK");
  },

  /*
   * **파생 항목이 무엇으로부터 나왔는지 남는다.** 씨앗·구조·모드가 없으면 나중에 다시
   * 계산할 수 없고, 이 사이트가 "색을 서버가 다시 만든다" 는 전제를 잃는다.
   *
   * 구조 이름·원리·출처도 함께 남긴다 — `/saved` 가 그릴 것이고, 코퍼스 항목의
   * `type`·`hueRelation`·`summary` 자리를 대신한다.
   *
   * **저장된 값이 지금 다시 계산한 것과 같은지도 본다.** 어긋나면 저장소가 엔진과 갈라진 것이다.
   */
  "S18-G7": async () => {
    const bad = [];
    await withServer(4967, async (api) => {
      const catalog = loadStructures();
      let checked = 0;

      for (const mode of ["light", "dark"]) {
        for (const structureId of ["complementary", "value-scale", "aerial"]) {
          const res = await api.post("/api/saved/derived", { seedId: SEED, structureId, mode });
          if (res.status !== 200) {
            bad.push(`${structureId}(${mode}) 저장이 ${res.status}`);
            continue;
          }
          const entry = await res.json();
          checked += 1;

          const meta = catalog.find((s) => s.id === structureId);
          for (const [field, want] of [["name", meta.name], ["principle", meta.principle], ["source", meta.source]]) {
            if (entry[field] !== want) bad.push(`${structureId}: ${field} 가 ${entry[field]}`);
          }
          if (entry.seedId !== SEED) bad.push(`${structureId}: seedId 가 ${entry.seedId}`);
          if (entry.structureId !== structureId) bad.push(`${structureId}: structureId 가 ${entry.structureId}`);
          if (entry.mode !== mode) bad.push(`${structureId}: mode 가 ${entry.mode}`);
          if (!entry.seedLabel) bad.push(`${structureId}: 씨앗 이름이 없다`);

          // 저장된 색 == 지금 다시 계산한 색.
          const want = expectColors(SEED, structureId, mode);
          if (shapeColors(entry.colors) !== want) {
            bad.push(`${structureId}(${mode}): 저장된 색이 재계산과 다르다`);
          }
        }
      }
      if (checked !== 6) bad.push(`검사한 항목이 ${checked}개 (6개여야 한다)`);
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("파생 6장(구조 3 × 모드 2)이 씨앗·구조·모드·이름·원리·출처를 남기고, 색이 재계산과 일치");
    out("S18_G7_OK");
  },

  /*
   * **2색 저장 경로가 하나도 안 바뀐다.** 이 단계는 더하기만 한다.
   *
   * `S5`·`S8` 이 그 경로를 이미 보지만, 그것들은 **이 변경 전에 쓰였다.** 같은 프로세스에서
   * 파생 저장과 나란히 돌 때도 그대로인지는 여기서 본다 — 특히 비율 검증이 배열을 받게
   * 넓어졌으므로 **숫자 하나를 받던 계약이 살아 있는지**가 핵심이다.
   */
  "S18-G8": async () => {
    const bad = [];
    await withServer(4968, async (api) => {
      const corpusId = palettes()[0].id;

      // 파생을 먼저 저장해 둔다. 두 경로가 같은 저장소를 쓴다.
      await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT });

      const created = await (await api.post("/api/saved", { paletteId: corpusId, ratio: 70 })).json();
      if (created.colors.length !== 2) bad.push(`코퍼스 항목이 ${created.colors.length}색`);
      if (JSON.stringify(created.colors.map((c) => c.ratio)) !== JSON.stringify([70, 30])) {
        bad.push(`숫자 70 이 [70,30] 이 안 됐다 — ${JSON.stringify(created.colors.map((c) => c.ratio))}`);
      }

      // 숫자 하나로 비율 변경이 그대로 된다.
      const changed = await (await api.post("/api/saved/ratio", { id: created.id, ratio: 40 })).json();
      if (JSON.stringify(changed.colors.map((c) => c.ratio)) !== JSON.stringify([40, 60])) {
        bad.push(`숫자 40 이 [40,60] 이 안 됐다 — ${JSON.stringify(changed.colors.map((c) => c.ratio))}`);
      }

      // 2색에 범위 밖은 여전히 거부된다.
      for (const wrong of [5, 95, 0, 100, 33.5, "70"]) {
        const r = await api.post("/api/saved/ratio", { id: created.id, ratio: wrong });
        if (r.status === 200) bad.push(`2색에 ${JSON.stringify(wrong)} 가 통과했다`);
      }

      // 2색 항목에 배열을 주면? 길이 2 · 합 100 이면 받는다 — 같은 규칙이 두 색에도 성립한다.
      const arr = await api.post("/api/saved/ratio", { id: created.id, ratio: [30, 70] });
      if (arr.status !== 200) bad.push(`2색에 배열 [30,70] 이 ${arr.status}`);
      else if (JSON.stringify((await arr.json()).colors.map((c) => c.ratio)) !== JSON.stringify([30, 70])) {
        bad.push("2색 배열이 반영 안 됐다");
      }
      // 길이가 안 맞는 배열은 거부.
      const wrongLen = await api.post("/api/saved/ratio", { id: created.id, ratio: [30, 30, 40] });
      if (wrongLen.status === 200) bad.push("2색 항목에 3칸 배열이 통과했다");
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("2색 경로가 그대로다 — 숫자 70 → [70,30] · 범위 밖 6가지 거부 · 배열도 길이가 맞으면 받는다");
    out("S18_G8_OK");
  },

  /*
   * **홈이 저장 버튼을 만들고, 색을 안 보낸다.**
   *
   * `S18-G1` 이 서버 쪽에서 "색을 받아도 무시한다" 를 보고, 이 게이트가 화면 쪽에서
   * "애초에 안 보낸다" 를 본다. 둘 중 하나만 있으면 반쪽이다 — 서버가 무시해도 화면이 색을
   * 실어 보내면 다음 사람이 그것을 쓰려 들고, 화면이 안 보내도 서버가 받으면 다른 클라이언트가 넣는다.
   *
   * **정적 검사다.** 회귀 스모크지 동작 증명이 아니다. S13-G7·S15-G13·S17-G12 가 같은 이유로
   * 같은 말을 한다. 실제 동작은 브라우저에서 따로 본다.
   */
  "S18-G9": async () => {
    const bad = [];
    const ui = stripComments(read("public/ui.js"));
    const app = stripComments(read("public/app.js"));
    const css = read("public/app.css");

    const between = (src, a, b, what) => {
      const i = src.indexOf(a);
      if (i < 0) throw new Error(`${what} 를 못 찾았다 — 이 검사가 공허하다`);
      const j = src.indexOf(b, i + a.length);
      return src.slice(i, j > 0 ? j : undefined);
    };

    // 카드가 저장 버튼을 만들고, 지금 맞춘 비율을 넘긴다.
    const card = between(ui, "export function structureCard", "export function paletteCard", "structureCard");
    if (!/struct__save/.test(card)) bad.push("카드에 저장 버튼(.struct__save)이 없다");
    if (!/onSave/.test(card)) bad.push("카드가 onSave 를 안 받는다");
    if (!/control\.shares\(\)/.test(card)) bad.push("저장이 지금 맞춘 비율(control.shares())을 안 읽는다");

    // 저장 요청이 무엇을 싣는가.
    const sec = between(app, "function expansionSection", "function renderStatus", "expansionSection");
    const call = between(sec, "/api/saved/derived", "});", "저장 요청");
    for (const need of ["seedId", "structureId", "mode", "shares"]) {
      if (!new RegExp(`\\b${need}\\b`).test(call)) bad.push(`저장 요청에 ${need} 가 없다`);
    }
    // **색을 안 보낸다.** 이 검사가 이 게이트의 요점이다.
    for (const forbidden of ["colors", "hex", "colorsDark", "name:"]) {
      if (new RegExp(`\\b${forbidden.replace(":", "")}\\s*:`).test(call)) {
        bad.push(`저장 요청에 ${forbidden} 를 싣는다 — 화면이 색을 보내면 안 된다`);
      }
    }

    // JS 가 쓰는 클래스가 스타일시트에 있다. S15-G13·S17-G12 가 같은 대조를 한다.
    const used = [...new Set(ui.match(/struct__save[\w-]*/g) ?? [])];
    if (used.length === 0) bad.push("저장 버튼 클래스가 없다");
    const missing = used.filter((cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css));
    if (missing.length) bad.push(`화면이 쓰는데 스타일시트에 없는 클래스: ${missing.join(", ")}`);

    if (bad.length) throw new Error(bad.join(" / "));
    out(`카드가 저장 버튼을 만들고 지금 맞춘 비율을 넘긴다 · 요청에 씨앗·구조·모드·비율만 실린다`);
    out(`클래스 대조: ${used.join(" · ")} 가 전부 app.css 에 있다`);
    out("S18_G9_OK");
  },

  /*
   * **저장 화면이 두 종류를 다르게 그리고, 어느 쪽에서도 `undefined` 가 안 샌다.**
   *
   * 지금 `/saved` 는 코퍼스 항목만 있다고 가정한다 — `entry.type`·`hueRelation`·`summary` 를
   * 그냥 읽는다. 파생 항목이 섞이면 화면에 **"undefined형"** 이 뜬다.
   *
   * **정적 검사로는 이것을 못 본다.** 그래서 무엇을 보여줄지 정하는 부분을 `savedFields` 라는
   * 순수 함수로 빼고 여기서 직접 부른다 — 17단계에서 `structureColors` 를 뺀 것과 같은 이유다
   * (그때 정적 검사가 `dark`/`light` 를 뒤바꾼 변형을 못 잡았다).
   *
   * **필드가 통째로 빠진 항목도 넣는다.** 옛 저장이나 손상된 파일이 그런 모양일 수 있고,
   * 그때 화면이 "undefined" 를 보여주는 것이 이 게이트가 막는 것이다.
   */
  "S18-G10": async () => {
    const bad = [];

    const corpus = {
      kind: undefined, // 옛 항목에는 kind 가 없다. 그것도 코퍼스로 읽혀야 한다.
      name: "자홍 × 진파랑",
      type: "D",
      hueRelation: "보색",
      toneRelation: "톤 대비",
      summary: "요약 문장",
      colors: [{ hex: "#b73f74", ratio: 70 }, { hex: "#005b8d", ratio: 30 }],
    };
    const derived = {
      kind: "derived",
      name: "보색대비",
      principle: "원리 문장",
      source: "1절 기법표",
      seedId: SEED,
      seedLabel: "자홍 × 진파랑",
      structureId: STRUCT,
      mode: "dark",
      colors: [{ role: "바탕", hex: "#1f282e", ratio: 40 }],
    };

    const shown = (fields) => [fields.title, fields.badge, fields.text, ...fields.coords.flat()].join(" | ");

    const a = savedFields(corpus);
    const b = savedFields(derived);

    if (a.kind !== "palette") bad.push(`코퍼스 항목의 kind 가 ${a.kind}`);
    if (b.kind !== "derived") bad.push(`파생 항목의 kind 가 ${b.kind}`);
    // 둘이 실제로 달라야 한다. 같으면 갈랐다고 말만 하는 것이다.
    if (shown(a) === shown(b)) bad.push("두 종류가 똑같이 그려진다");
    // 코퍼스 전용 낱말이 파생 쪽에 나오면 안 된다(그 반대도).
    if (/형|색상각/.test(shown(b))) bad.push(`파생에 코퍼스 전용 표기가 나온다 — ${shown(b)}`);
    if (!/자홍/.test(shown(b))) bad.push("파생에 씨앗 이름이 안 나온다");
    if (!/어두운/.test(shown(b))) bad.push("파생에 모드가 안 나온다");
    if (!/보색/.test(shown(a))) bad.push("코퍼스에 색상각이 안 나온다");

    // **필드가 빠져도 undefined 가 안 샌다.**
    const holes = [
      ["빈 객체", {}],
      ["kind 만 있는 파생", { kind: "derived" }],
      ["null", null],
      ["colors 만", { colors: [] }],
      ["파생인데 이름 없음", { kind: "derived", seedId: SEED, mode: "light" }],
      ["코퍼스인데 유형 없음", { name: "x" }],
    ];
    for (const [label, entry] of holes) {
      let fields;
      try {
        fields = savedFields(entry);
      } catch (err) {
        bad.push(`${label} 에서 던졌다: ${err.message}`);
        continue;
      }
      const text = shown(fields);
      if (/undefined|null|\[object/.test(text)) bad.push(`${label}: 화면에 "${text}" 가 나간다`);
      if (!fields.title) bad.push(`${label}: 제목이 비었다`);
      /*
       * **색도 정규화돼야 한다.** 표시 문자열만 막으면 화면이 `entry.colors` 를 직접 읽다가
       * 던지고, 그 예외가 목록 전체를 비운다 — 리뷰가 실제로 그것을 찾았다.
       * 여기서 무는 것은 "언제나 배열" 과 "그릴 수 있는 것만 남는다" 둘이다.
       */
      if (!Array.isArray(fields.colors)) bad.push(`${label}: colors 가 배열이 아니다`);
      else {
        for (const c of fields.colors) {
          if (!/^#[0-9a-f]{6}$/i.test(c.hex ?? "")) bad.push(`${label}: 못 그릴 헥스 ${c.hex} 가 남았다`);
          if (!Number.isInteger(c.ratio)) bad.push(`${label}: 못 그릴 비율 ${c.ratio} 가 남았다`);
        }
      }
      for (const [key, value] of fields.coords) {
        if (!key || !value) bad.push(`${label}: 좌표에 빈 값 (${key}=${value})`);
      }
    }

    /*
     * **양성 대조 — 걸러 낸다는 것이 실제로 일어나는가.** 위 검사는 "남은 것이 멀쩡하다" 만
     * 보므로 아무것도 안 걸러도 통과할 수 있다. 못 그릴 색을 섞어 넣고 실제로 빠지는지 본다.
     */
    const dirty = savedFields({
      kind: "derived",
      colors: [
        { hex: "#ff0000", ratio: 50, role: "바탕" },
        { hex: "zzz", ratio: 50 }, //         헥스가 아니다
        { hex: "#00ff00", ratio: 12.5 }, //   비율이 정수가 아니다
        null, //                              항목 자체가 없다
      ],
    });
    if (dirty.colors.length !== 1) bad.push(`못 그릴 색을 안 걸렀다 — ${dirty.colors.length}개 남음`);
    // 그리고 멀쩡한 것은 안 걸러야 한다. 아니면 "전부 버린다" 로 위 검사가 공허해진다.
    const clean = savedFields({ colors: [{ hex: "#ff0000", ratio: 60 }, { hex: "#0000ff", ratio: 40 }] });
    if (clean.colors.length !== 2) bad.push(`멀쩡한 색을 걸렀다 — ${clean.colors.length}개 남음`);

    // 자체 대조 — 검사가 살아 있는가. 일부러 undefined 를 넣은 문자열은 잡혀야 한다.
    if (!/undefined/.test(String(`${undefined}형`))) bad.push("판정기 자체 대조 실패");

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`코퍼스·파생이 다르게 그려지고, 필드가 빠진 ${holes.length}가지에서도 undefined 가 안 샌다`);
    out(`  코퍼스: ${shown(a)}`);
    out(`  파생:   ${shown(b)}`);
    out("S18_G10_OK");
  },

  /*
   * **`/saved` 가 그 순수 함수를 실제로 쓰고, 다색 항목을 다색 슬라이더로 그린다.**
   *
   * `S18-G10` 이 함수가 맞게 도는지 보고, 이 게이트가 그것이 화면에 닿는지 본다. 둘 중 하나만
   * 있으면 함수는 맞는데 화면이 안 쓰는 상태가 조용히 생긴다 — 17단계에서 리뷰가 정확히 그
   * 부류를 지적했다(`structureColors` 를 부르기만 하고 반환을 버리는 변형).
   *
   * 그리고 비율 저장이 **배열로** 나가야 한다. 지금 `/saved` 는 `ratio: next[0]` 로 숫자 하나를
   * 보내는데, 3~4색에서는 그것이 첫 색의 지분일 뿐이라 나머지를 잃는다.
   */
  "S18-G11": async () => {
    const bad = [];
    const savedJs = stripComments(read("public/saved.js"));
    const ui = stripComments(read("public/ui.js"));

    if (!/savedFields/.test(savedJs)) bad.push("saved.js 가 savedFields 를 안 쓴다");
    // 코퍼스 전용 필드를 화면이 직접 읽으면 파생에서 undefined 가 샌다.
    for (const direct of ["entry.type", "entry.hueRelation", "entry.toneRelation", "entry.summary"]) {
      if (savedJs.includes(direct)) bad.push(`saved.js 가 ${direct} 를 직접 읽는다 — savedFields 를 거쳐야 한다`);
    }
    // 다색 슬라이더.
    if (!/shareControl/.test(savedJs)) bad.push("saved.js 가 다색 슬라이더(shareControl)를 안 쓴다");
    // 비율을 배열로 보낸다.
    if (/ratio:\s*next\[0\]/.test(savedJs)) bad.push("비율을 숫자 하나로 보낸다 — 다색에서 나머지를 잃는다");

    // shareControl 이 저장 시점을 갖는가. 없으면 슬라이더를 놓아도 저장이 안 된다.
    const share = ui.slice(ui.indexOf("export function shareControl"), ui.indexOf("export function savedFields"));
    if (!/onCommit/.test(share)) bad.push("shareControl 에 저장 시점(onCommit)이 없다");
    if (!/addEventListener\("change"/.test(share)) bad.push("shareControl 이 슬라이더를 놓는 순간을 안 잡는다");
    /*
     * **실패하면 슬라이더도 되돌린다.** 스와치만 되돌리면 화면에 두 비율이 동시에 보이고,
     * 다음 조작이 되돌아가지 않은 값을 기준으로 계산된다. `ratioControl` 이 2색에서 `set` 을
     * 주는 것과 같은 이유인데 `shareControl` 에는 없었다(리뷰 지적).
     */
    if (!/set:\s*\(next\)/.test(share)) bad.push("shareControl 이 되돌리기(set)를 안 준다");
    if (!/if \(!ok\) control\.set/.test(savedJs)) bad.push("다색 경로가 실패해도 슬라이더를 안 되돌린다");

    // 색이 없는 항목에서 화면이 던지지 않는가. entry.colors 를 직접 읽으면 목록 전체가 사라진다.
    if (/entry\.colors/.test(savedJs)) bad.push("saved.js 가 entry.colors 를 직접 읽는다 — savedFields 를 거쳐야 한다");
    // 한 항목이 던져도 나머지가 그려지는가.
    if (!/try \{[\s\S]{0,120}savedCard/.test(savedJs)) bad.push("항목 하나가 던지면 목록 전체가 사라진다");
    // 커밋 경합 가드. 다색은 슬라이더가 여럿이라 응답이 순서대로 안 온다.
    if (!/ticket/.test(savedJs)) bad.push("비율 저장에 경합 가드가 없다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("saved.js 가 savedFields 를 거치고 코퍼스 전용 필드를 직접 안 읽는다");
    out("다색 슬라이더로 그리고 비율을 배열로 보낸다 · shareControl 에 저장 시점이 있다");
    out("S18_G11_OK");
  },

  /*
   * **목록 API 가 화면이 그릴 것을 전부 준다.** `savedFields` 가 아무리 잘 갈라도 서버가
   * 필드를 안 주면 화면이 빈다.
   *
   * 실제로 둘을 저장하고 목록을 받아, **화면이 읽는 필드가 전부 있는지** 본다.
   */
  "S18-G12": async () => {
    const bad = [];
    await withServer(4969, async (api) => {
      const corpusId = palettes()[0].id;
      await api.post("/api/saved", { paletteId: corpusId });
      await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, mode: "dark" });

      const list = await saved(api);
      if (list.length !== 2) throw new Error(`목록이 ${list.length}개 — 이 검사가 공허하다`);

      const derived = list.find((e) => e.kind === "derived");
      const corpus = list.find((e) => e.kind !== "derived");
      if (!derived || !corpus) throw new Error("두 종류가 다 안 들어왔다");

      for (const key of ["name", "principle", "source", "seedId", "seedLabel", "structureId", "mode", "colors", "defaultRatio"]) {
        if (derived[key] === undefined) bad.push(`파생 항목에 ${key} 가 없다`);
      }
      for (const key of ["name", "type", "hueRelation", "toneRelation", "summary", "colors", "defaultRatio"]) {
        if (corpus[key] === undefined) bad.push(`코퍼스 항목에 ${key} 가 없다`);
      }

      // 화면이 그리면 undefined 가 나오는가 — 실제 항목으로 순수 함수를 돌려 본다.
      for (const entry of list) {
        const f = savedFields(entry);
        const text = [f.title, f.badge, f.text, ...f.coords.flat()].join(" | ");
        if (/undefined|\[object/.test(text)) bad.push(`실제 저장 항목에서 "${text}" 가 나온다`);
      }

      // 파생 색마다 역할 이름이 있어야 슬라이더 라벨이 선다.
      for (const c of derived.colors) if (!c.role) bad.push("파생 색에 역할 이름이 없다");
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("목록이 두 종류에 필요한 필드를 전부 주고, 실제 항목으로 그려도 undefined 가 안 나온다");
    out("S18_G12_OK");
  },

  /*
   * **내보내기가 파생을 조용히 망가뜨리지 않는다.**
   *
   * 내보내기(`src/export.js`)는 코퍼스 조합 전제로 쓰였다 — `paletteId` 로 변수 이름을 만들고,
   * `rolesOf` 가 앞 두 색만 보고, 주석에 `type`·`색상각` 을 찍는다. 파생을 그대로 넣으면
   * 실측으로 이렇게 나왔다:
   *
   *     --undefined-ground        paletteId 가 없어 **파생 항목마다 이름이 같아진다**
   *     --undefined-undefined     3·4번째 색의 역할이 없다
   *     보색대비 · undefined형     코퍼스 전용 필드가 주석에 그대로
   *
   * 18-B 가 저장 버튼을 만들면서 이 경로가 **버튼 한 번으로 닿게 됐다** — 전에는 `curl` 이
   * 필요했다. 그래서 **빼고, 뺐다고 말한다.** 파생을 제대로 내보내는 것은 별도 작업(A2)이다.
   *
   * 양성 대조가 절반이다 — "안 망가진다" 는 **아무것도 안 내보내도** 통과한다.
   */
  "S18-G13": async () => {
    const bad = [];
    const derived = {
      id: "save-d", kind: "derived", name: "보색대비", seedId: SEED, structureId: STRUCT, mode: "dark",
      colors: [{ role: "바탕", hex: "#1f282e", ratio: 40 }, { role: "본문", hex: "#90c3df", ratio: 30 }, { role: "강조", hex: "#8d3200", ratio: 30 }],
    };
    const corpus = {
      id: "save-c", paletteId: palettes()[0].id, name: palettes()[0].name, type: palettes()[0].type,
      hueRelation: palettes()[0].hueRelation, toneRelation: palettes()[0].toneRelation, summary: "요약",
      colors: palettes()[0].colors.map((c, i) => ({ name: c.name, hex: c.hex, ratio: i === 0 ? 70 : 30 })),
    };

    for (const [format, spec] of Object.entries(FORMATS)) {
      const mixed = spec.build([derived, corpus]);
      if (/undefined/.test(mixed)) bad.push(`${format}: 출력에 undefined 가 있다`);
      // 파생의 헥스가 새어 나가면 이름 없는 변수로 나간 것이다.
      for (const c of derived.colors) {
        if (mixed.includes(c.hex)) bad.push(`${format}: 파생 색 ${c.hex} 가 내보내기에 실렸다`);
      }
      // 뺐다는 사실을 말하는가. 조용히 빼면 사용자는 다 나왔다고 믿는다.
      if (!/파생|skippedDerived/.test(mixed)) bad.push(`${format}: 뺐다는 사실을 안 말한다`);
      // 양성 대조 — 코퍼스 조합은 실제로 나온다.
      if (!mixed.includes(corpus.colors[0].hex)) bad.push(`${format}: 코퍼스 색이 안 나온다 — 전부 빠졌다`);

      // 파생만 있는 목록에서도 던지지 않는다.
      const onlyDerived = spec.build([derived]);
      if (/undefined/.test(onlyDerived)) bad.push(`${format}: 파생만 있을 때 undefined 가 있다`);
      // 빈 목록도 그대로 돈다(회귀).
      spec.build([]);
    }

    // JSON 은 숫자로도 말한다.
    const json = JSON.parse(FORMATS.json.build([derived, corpus]));
    if (json.count !== 1) bad.push(`JSON count 가 ${json.count} (코퍼스 1개여야 한다)`);
    if (json.skippedDerived !== 1) bad.push(`JSON skippedDerived 가 ${json.skippedDerived}`);

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`CSS·JSON 둘 다 파생을 빼고 그 사실을 말한다 — 출력에 undefined 0건, 파생 색 0건`);
    out(`양성 대조: 코퍼스 조합은 그대로 나온다 · JSON count 1 · skippedDerived 1`);
    out("S18_G13_OK");
  },
};

const id = process.argv[2];
const gate = Object.hasOwn(GATES, String(id)) ? GATES[id] : null;
if (!gate) {
  out(`쓰는 법: node scripts/check-stage18.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(2);
}

try {
  await gate();
} catch (err) {
  out(`${id} 실패: ${err.message}`);
  process.exit(1);
}
