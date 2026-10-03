#!/usr/bin/env node
// 46단계(문장 팔레트 다듬기 — open-work J4 · J5 · J10 · J8) 완료 조건 검사기.
//   node scripts/check-stage46.mjs S46-G1
//
// J4 색 이름 · J5 UI 쓰임새의 밝게/어둡게 · J10 저장 메모 · J8 다듬은 답이 직전 비율 · 테마를 이어받는다.
// 가짜 Claude 는 scripts/lib/stub-apis.mjs — 진짜 API 는 부르지 않는다.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStubApis } from "./lib/stub-apis.mjs";
import { findAll, installDom } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const C = await import("../src/compose.js");
const { contrast } = await import("../public/color.js");

/* ── 서버 ──────────────────────────────────────────────── */

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TONEFIRST_DATA_DIR: gateDataDir(),
      PORT: String(port),
      HOST: "127.0.0.1",
      LANGSMITH_API_KEY: "",
      VERCEL: "",
      LLM_MAX_RETRIES: "0",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`서버가 8초 안에 뜨지 않았다. stderr: ${stderr.trim() || "(없음)"}`));
    }, 8000);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
      if (stdout.includes(`:${port}`)) {
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

async function withServer(port, env, fn) {
  const child = await startServer(port, env);
  try {
    const api = async (path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    return await fn(api);
  } finally {
    child.kill();
  }
}

const isIntentAsk = (body) => {
  const p = body?.output_config?.format?.schema?.properties ?? {};
  return Boolean(p.usage && p.base);
};
/** 의도 질문에는 늘 같은 의도를 돌려주는 가짜 Claude. */
const stubIntent = (intent) => startStubApis({ reply: (body) => (isIntentAsk(body) ? JSON.stringify(intent) : "{}") });

const UI = { kind: "palette", usage: "ui", count: 5, base: { hues: ["pink"], tone: "pale" }, accent: { hue: "teal", tone: "vivid" }, temperature: "neutral", contrast: "medium", avoid: [], reading: "연분홍 핀테크 앱", basis: "new" };
const UI_DARK = { ...UI, base: { hues: ["blue"], tone: "dark" }, reading: "어두운 대시보드" };
const GENERAL = { kind: "palette", usage: "general", count: 5, base: { hues: ["orange", "green"], tone: "soft" }, accent: { hue: "blue", tone: "vivid" }, temperature: "warm", contrast: "medium", avoid: [], reading: "봄날 카페", basis: "new" };

const hexes = (colors) => (colors ?? []).map((c) => c.hex).join();

/** 코퍼스 80색 — 서버의 corpusColors 와 같은 자리를 **여기서 다시 모은다**(감시 대상에서 가져오면 함께 느슨해진다). */
function corpus() {
  const p = JSON.parse(read("data/palettes.json"));
  const s = JSON.parse(read("data/seeds.json"));
  return [
    ...(p.palettes ?? p).flatMap((x) => x.colors.map((c) => ({ hex: c.hex.toUpperCase(), name: c.name }))),
    ...s.seeds.flatMap((x) => x.colors.map((c) => ({ hex: c.hex.toUpperCase(), name: c.origName }))),
  ];
}

/** 대비 검사 — 본문 4.5 · 주색 · 보조 · 강조 3 (WCAG 2.x). S42-G7 과 같은 하한을 여기 다시 적는다. */
function uiContrastProblems(colors, label) {
  const bad = [];
  const by = Object.fromEntries(colors.map((c) => [c.role, c.hex]));
  const bg = by["바탕"];
  if (!bg) return [`${label}: 바탕이 없다`];
  if (contrast(by["본문"], bg) < 4.5) bad.push(`${label}: 본문 ${by["본문"]} / 바탕 ${bg} 대비 ${contrast(by["본문"], bg).toFixed(2)}`);
  for (const role of ["주색", "보조", "강조"]) {
    if (by[role] && contrast(by[role], bg) < 3) bad.push(`${label}: ${role} ${by[role]} / 바탕 ${bg} 대비 ${contrast(by[role], bg).toFixed(2)}`);
  }
  return bad;
}

const GATES = {
  /**
   * 엔진의 테마(J5) — UI 쓰임새만 테마를 받는다. 받은 테마대로 짓고(바탕 밝기로 확인), 두 테마 모두 WCAG 대비를 지킨다.
   * 테마를 안 주면 46단계 전과 같다(의도의 톤이 정한다). 일반 팔레트 · 모르는 테마는 무시한다.
   */
  "S46-G1": async () => {
    const bad = [];
    const { hexToOklch } = await import("../src/oklch.js");
    let checked = 0;
    for (const hue of Object.keys(C.HUES)) {
      for (const tone of Object.keys(C.TONES)) {
        for (const count of [3, 5, 7]) {
          const intent = C.parseIntent({ kind: "palette", usage: "ui", count, base: { hues: [hue], tone }, accent: { hue: "orange", tone: "vivid" }, contrast: "high" });
          for (let v = 0; v < C.VARIANTS.length; v++) {
            const natural = C.compose(intent, v);
            if (natural.theme !== "light" && natural.theme !== "dark") bad.push(`${hue}/${tone}: 테마를 안 주면 theme 이 ${natural.theme}`);
            for (const theme of C.THEMES) {
              const p = C.compose(intent, v, { theme });
              checked += 1;
              if (p.theme !== theme) bad.push(`${hue}/${tone}/${count}/${v}: ${theme} 를 달라 했는데 ${p.theme}`);
              const bgL = hexToOklch(p.colors.find((c) => c.role === "바탕").hex).l;
              if (theme === "dark" ? bgL > 0.3 : bgL < 0.9) bad.push(`${hue}/${tone}/${count}/${v}: ${theme} 인데 바탕 밝기 ${bgL.toFixed(2)}`);
              bad.push(...uiContrastProblems(p.colors, `${hue}/${tone}/${count}/${v}/${theme}`));
              if (theme === natural.theme && hexes(p.colors) !== hexes(natural.colors)) bad.push(`${hue}/${tone}/${count}/${v}: 의도가 정한 테마(${theme})를 따로 달라 하면 색이 바뀐다`);
            }
          }
        }
      }
    }
    if (checked < 1000) bad.push(`검사한 경우가 ${checked}개뿐이다 — 헛돌고 있다`);
    // 46단계 전과 같다 — 테마를 안 주면 톤이 정한다(어두운 톤 → 다크).
    const dark = C.compose(C.parseIntent(UI_DARK), 0);
    if (dark.theme !== "dark") bad.push(`어두운 톤 UI 가 테마 없이 ${dark.theme}`);
    // 모르는 테마 · UI 가 아닌 의도는 무시한다.
    const ui = C.parseIntent(UI);
    for (const weird of ["blue", ["dark"], "__proto__", "", null, 1]) {
      if (hexes(C.compose(ui, 0, { theme: weird }).colors) !== hexes(C.compose(ui, 0).colors)) bad.push(`모르는 테마 ${JSON.stringify(weird)} 가 색을 바꾼다`);
    }
    const general = C.parseIntent(GENERAL);
    for (const theme of C.THEMES) {
      const p = C.compose(general, 0, { theme });
      if (p.theme !== null || hexes(p.colors) !== hexes(C.compose(general, 0).colors)) bad.push(`일반 팔레트가 테마 ${theme} 를 받는다`);
    }
    return bad.slice(0, 20);
  },

  /**
   * 색 이름(J4) — 가장 가까운 코퍼스 색의 이름이고, 상한(0.15)보다 멀면 null. **이름을 지어내지 않는다.**
   * 독립 계산(코퍼스를 여기서 다시 모아 전수 비교)과 대조한다.
   */
  "S46-G2": async () => {
    const bad = [];
    const F = await import("../src/from-color.js");
    if (F.NAME_MAX_DISTANCE !== 0.15) bad.push(`이름 거리 상한이 ${F.NAME_MAX_DISTANCE} — 문서(0.15)와 다르다`);
    const all = corpus();
    let named = 0;
    let unnamed = 0;
    for (const hue of Object.keys(C.HUES)) {
      for (const tone of Object.keys(C.TONES)) {
        for (const c of C.compose(C.parseIntent({ kind: "palette", base: { hues: [hue], tone } }), 0).colors) {
          const got = F.nearestName(c.hex, all);
          const best = all.map((k) => ({ ...k, d: F.colorDistance(c.hex, k.hex) })).sort((a, b) => a.d - b.d)[0];
          if (best.d <= 0.15) {
            named += 1;
            if (!got || got.hex !== best.hex || Math.abs(got.distance - best.d) > 0.001) bad.push(`${c.hex}: 가장 가까운 것은 ${best.name} ${best.hex}(${best.d.toFixed(3)}) 인데 ${JSON.stringify(got)}`);
            if (got && !all.some((k) => k.name === got.name && k.hex === got.hex)) bad.push(`${c.hex}: 코퍼스에 없는 이름 ${got.name}`);
          } else {
            unnamed += 1;
            if (got !== null) bad.push(`${c.hex}: 가장 가까운 색이 ${best.d.toFixed(3)} 떨어졌는데 이름을 붙였다 (${got.name})`);
          }
        }
      }
    }
    // 양성 · 음성 대조가 둘 다 실제로 일어났는가.
    if (named < 50 || unnamed < 50) bad.push(`이름 붙음 ${named} · 안 붙음 ${unnamed} — 한쪽이 거의 없어 검사가 헛돈다`);
    // 이름 없는 항목은 건너뛴다 · 코퍼스가 비면 null.
    if (F.nearestName("#C55347", [{ hex: "#C55347", name: "" }, { hex: "#C55347" }]) !== null) bad.push("이름 없는 코퍼스 항목에 이름을 붙였다");
    if (F.nearestName("#C55347", []) !== null) bad.push("빈 코퍼스에서 이름을 냈다");
    if (F.nearestName("#C55347", all)?.name !== "테라코타") bad.push("코퍼스 색 그대로(#C55347)가 테라코타가 아니다");
    return bad.slice(0, 20);
  },

  /**
   * 서버 응답(J4 · J5) — 문장 팔레트의 색마다 `near`(이름 또는 null), 헥스는 compose 그대로. UI 쓰임새는 `colorsByTheme` 두 벌이고
   * `colors` 는 의도가 정한 테마 쪽. 일반 팔레트에는 두 벌이 없다.
   */
  "S46-G3": async () => {
    const bad = [];
    const F = await import("../src/from-color.js");
    const all = corpus();
    // UI 는 두 번 — 밝은 톤(의도가 light)과 어두운 톤(의도가 dark). 한쪽만 보면 "colors 는 늘 밝은 벌" 이 통과한다(변형 검사).
    for (const [label, intent, port] of [["UI", UI, 4461], ["UI", UI_DARK, 4465], ["일반", GENERAL, 4462]]) {
      const stub = await stubIntent(intent);
      try {
        await withServer(port, stub.env, async (api) => {
          const r = (await api("/api/chat", { text: "팔레트 만들어 줘" })).json;
          const pay = r?.turn?.payload;
          if (pay?.kind !== "generated") return bad.push(`${label}: 문장 팔레트가 아니다 (${pay?.kind})`);
          const parsed = C.parseIntent(intent);
          for (const p of pay.palettes) {
            const want = C.compose(parsed, p.variant);
            if (hexes(p.colors) !== hexes(want.colors)) bad.push(`${label} 안 ${p.variant}: 헥스가 compose 와 다르다`);
            for (const c of p.colors) {
              if (!Object.hasOwn(c, "near")) bad.push(`${label} 안 ${p.variant}: ${c.role} 에 near 칸이 없다`);
              const expect = F.nearestName(c.hex, all);
              if (JSON.stringify(c.near ?? null) !== JSON.stringify(expect)) bad.push(`${label} ${c.hex}: near ${JSON.stringify(c.near)} (기대 ${JSON.stringify(expect)})`);
            }
            if (label === "UI") {
              if (!p.colorsByTheme?.light || !p.colorsByTheme?.dark) {
                bad.push(`UI 안 ${p.variant}: colorsByTheme 두 벌이 없다`);
                continue;
              }
              for (const t of C.THEMES) {
                if (hexes(p.colorsByTheme[t]) !== hexes(C.compose(parsed, p.variant, { theme: t }).colors)) bad.push(`UI 안 ${p.variant}: ${t} 벌이 compose 와 다르다`);
                if (p.colorsByTheme[t].some((c) => !Object.hasOwn(c, "near"))) bad.push(`UI 안 ${p.variant}: ${t} 벌에 near 가 없다`);
              }
              if (hexes(p.colors) !== hexes(p.colorsByTheme[p.theme])) bad.push(`UI 안 ${p.variant}: colors 가 의도가 정한 테마(${p.theme}) 벌이 아니다`);
              if (p.colorsByTheme.light.map((c) => c.role).join() !== p.colorsByTheme.dark.map((c) => c.role).join()) bad.push(`UI 안 ${p.variant}: 두 벌의 역할이 다르다 — 비율이 다른 색에 붙는다`);
            } else if (p.colorsByTheme !== undefined) bad.push(`일반 안 ${p.variant}: 테마가 없는 팔레트에 colorsByTheme 가 있다`);
          }
        });
      } finally {
        stub.close();
      }
    }
    return bad;
  },

  /**
   * 테마 저장(J5) — 서버가 의도 · 안 번호 · 테마로 다시 계산한다. 어두운 테마는 따로 저장되고(mode dark), 의도가 정한 테마로 저장하면
   * 46단계 전 키 그대로(테마를 안 보낸 저장과 같은 항목). 일반 팔레트 · 모르는 테마는 무시한다. 보낸 헥스는 안 믿는다.
   */
  "S46-G4": async () => {
    const bad = [];
    const dir = gateDataDir();
    await withServer(4463, { TONEFIRST_DATA_DIR: dir, ANTHROPIC_API_KEY: "" }, async (api) => {
      const ui = C.parseIntent(UI);
      const save = (body) => api("/api/saved/generated", { query: "연분홍 핀테크", ...body });
      const plain = await save({ intent: UI, variant: 0 });
      const light = await save({ intent: UI, variant: 0, theme: "light" });
      if (plain.status !== 200 || light.status !== 200) bad.push(`저장 실패 ${plain.status}/${light.status}`);
      if (plain.json?.id === light.json?.id) bad.push("저장 id 가 같다(덮어쓰면 새 id 여야 한다)");
      // 46단계 전 키 그대로 — 그 전에 저장한 항목을 같은 팔레트로 다시 저장하면 덮어써야 한다.
      const oldKey = `${C.intentKey(ui)}|0`;
      if (plain.json?.generatedKey !== oldKey || light.json?.generatedKey !== oldKey) bad.push(`의도가 정한 테마의 저장 키가 46단계 전과 다르다 (${plain.json?.generatedKey} / ${light.json?.generatedKey})`);
      const dark = (await save({ intent: UI, variant: 0, theme: "dark", colors: [{ role: "바탕", hex: "#FF0000" }] })).json;
      if (dark?.mode !== "dark" || dark?.generated?.theme !== "dark") bad.push(`어두운 테마 저장이 mode ${dark?.mode} · theme ${dark?.generated?.theme}`);
      if (hexes(dark?.colors) !== hexes(C.compose(ui, 0, { theme: "dark" }).colors)) bad.push("어두운 테마 저장 색이 서버 재계산과 다르다(보낸 헥스를 믿었나)");
      const weird = (await save({ intent: UI, variant: 0, theme: "sepia" })).json;
      if (hexes(weird?.colors) !== hexes(C.compose(ui, 0).colors)) bad.push("모르는 테마가 색을 바꿨다");
      const gen = (await save({ intent: GENERAL, variant: 1, theme: "dark" })).json;
      if (gen?.mode !== "light" || gen?.generated?.theme !== null) bad.push(`일반 팔레트가 테마를 받았다 (mode ${gen?.mode} · theme ${gen?.generated?.theme})`);
      const list = (await api("/api/saved")).json?.saved ?? [];
      const uiEntries = list.filter((e) => e.structureId === "generated" && e.generated?.intent?.usage === "ui");
      // 테마 없음 · light · sepia 는 같은 항목(덮어씀), dark 는 따로 — 둘.
      if (uiEntries.length !== 2) bad.push(`UI 저장 항목이 ${uiEntries.length}개 (기대 2 — 의도가 정한 테마는 한 항목, 어두운 테마는 따로)`);
    });
    return bad;
  },

  /**
   * 저장 메모(J10) — 문장 팔레트 저장이 메모를 싣는다. 메모 없이 다시 저장하면 예전 메모를 지우지 않는다. 상한 200자.
   * 화면 쪽은 `structureCard` 를 최소 DOM 으로 **직접 불러** 메모 칸 → onSave 로 가는지 본다(빈 칸이면 note 를 안 싣는다).
   */
  "S46-G5": async () => {
    const bad = [];
    await withServer(4464, { TONEFIRST_DATA_DIR: gateDataDir(), ANTHROPIC_API_KEY: "" }, async (api) => {
      const save = (body) => api("/api/saved/generated", { intent: GENERAL, variant: 0, ...body });
      const a = (await save({ note: "카페 메뉴판 시안" })).json;
      if (a?.note !== "카페 메뉴판 시안") bad.push(`메모가 저장되지 않았다 (${a?.note})`);
      const b = (await save({})).json;
      if (b?.note !== "카페 메뉴판 시안") bad.push(`메모 없이 다시 저장하니 메모가 ${JSON.stringify(b?.note)} — 예전 메모를 지웠다`);
      const c = (await save({ note: "가".repeat(260) })).json;
      if (c?.note?.length !== 200) bad.push(`긴 메모가 ${c?.note?.length}자로 남았다 (상한 200)`);
    });

    installDom();
    const ui = await import("../public/ui.js");
    const calls = [];
    const st = { id: "generated-faithful", name: "충실", source: "일반 · 3색", principle: "읽은 그대로", colors: [{ role: "주조색", hex: "#C55347" }, { role: "보조색", hex: "#719470" }, { role: "강조색", hex: "#006EB8" }], shares: [50, 30, 20] };
    const seen = [];
    const card = ui.structureCard(st, "light", null, async (shares, extra) => calls.push({ shares, extra }), null, { note: true, onShares: (s) => seen.push(s) });
    const note = findAll(card, (n) => n.className === "struct__note")[0];
    const button = findAll(card, (n) => n.className === "struct__save-button")[0];
    if (!note) return [...bad, "메모 칸(.struct__note)이 없다"];
    if (note.maxLength !== 200) bad.push(`메모 칸 상한이 ${note.maxLength} (서버 200)`);
    button.fire("click");
    await new Promise((r) => setTimeout(r, 10));
    note.value = "  봄 시안  ";
    button.fire("click");
    await new Promise((r) => setTimeout(r, 10));
    if (JSON.stringify(calls[0]?.extra) !== "{}") bad.push(`빈 메모인데 ${JSON.stringify(calls[0]?.extra)} 를 실었다 — 다시 저장하면 예전 메모가 지워진다`);
    if (calls[1]?.extra?.note !== "봄 시안") bad.push(`메모가 onSave 로 안 갔다 (${JSON.stringify(calls[1]?.extra)})`);
    // 비율을 옮기면 onShares 가 지금 비율을 알린다(테마 다시 그리기 · 다음 답 이어받기가 이것을 쓴다).
    const slider = findAll(card, (n) => n.className === "shares__slider")[0];
    slider.value = "70";
    slider.fire("input");
    if (seen.length !== 1 || seen[0]?.[0] !== 70 || seen[0].reduce((x, y) => x + y, 0) !== 100) bad.push(`onShares 가 옮긴 비율을 안 알린다 (${JSON.stringify(seen)})`);
    if (JSON.stringify(calls[1]?.shares) !== "[50,30,20]") bad.push(`저장한 비율이 ${JSON.stringify(calls[1]?.shares)} (기대 [50,30,20])`);
    // 메모 옵션이 없으면 칸이 없다 — 캐릭터 · 색 답 카드는 그대로다.
    const plain = ui.structureCard(st, "light", null, async () => {}, null);
    if (findAll(plain, (n) => n.className === "struct__note").length) bad.push("메모 옵션 없이도 메모 칸이 생긴다");
    return bad;
  },

  /**
   * 비율 이어받기(J8) — `carryShares` 는 역할 목록이 순서까지 같을 때만 직전 비율을 돌려준다. 색 수 · 순서가 다르거나 비율 형식이
   * 틀리면 null. 돌려준 배열은 사본이다(새 답의 슬라이더가 옛 답의 상태를 고치지 않게).
   */
  "S46-G6": async () => {
    const bad = [];
    const { carryShares } = await import("../public/ratio.js");
    const roles = ["바탕", "면", "본문", "주색", "강조"];
    const prev = { roles, shares: [50, 18, 11, 11, 10] };
    const got = carryShares(prev, [...roles]);
    if (JSON.stringify(got) !== "[50,18,11,11,10]") bad.push(`같은 역할인데 ${JSON.stringify(got)}`);
    if (got === prev.shares) bad.push("직전 비율 배열을 그대로 돌려준다 — 사본이어야 한다");
    for (const [label, p, next] of [
      ["색 수가 다름", prev, ["바탕", "면", "본문", "강조"]],
      ["순서가 다름", prev, ["바탕", "본문", "면", "주색", "강조"]],
      ["역할 이름이 다름", prev, ["주조색", "보조색", "보조색 2", "보조색 3", "강조색"]],
      ["합이 99", { roles, shares: [50, 18, 11, 10, 10] }, roles],
      ["하한 아래", { roles, shares: [90, 3, 3, 2, 2] }, roles],
      ["정수 아님", { roles, shares: [50.5, 17.5, 11, 11, 10] }, roles],
      ["문자열", { roles, shares: ["50", "18", "11", "11", "10"] }, roles],
      ["직전 없음", null, roles],
      ["역할 없음", { shares: [50, 18, 11, 11, 10] }, roles],
    ]) {
      if (carryShares(p, next) !== null) bad.push(`${label}: null 이어야 하는데 ${JSON.stringify(carryShares(p, next))}`);
    }
    return bad;
  },

  /**
   * 화면(J4 · J5 · J8 · J10) — 정적 검사. 브라우저 확인은 세션 재개 문서에 남긴다.
   * 색 이름 줄은 서버의 near 를 그린다 · 토글은 UI 두 벌이 있을 때만 · 사이트 기본 모드(modeStore)를 안 쓴다 · 저장은 두 벌이 있는 안만 theme 을
   * 싣는다 · 다듬은 답만 이어받는다 · 새 대화는 이어받을 것을 비운다 · 메모 옵션을 켠다.
   */
  "S46-G7": async () => {
    const bad = [];
    const app = stripComments(read("public/app.js"));
    const block = app.match(/function generatedBlock\(data\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    if (!block) return ["generatedBlock 을 못 찾았다"];
    const names = app.match(/function nameLine\(colors\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    if (!/c\.near/.test(names) || !/가까운 이름 없음/.test(names)) bad.push("색 이름 줄이 서버의 near 를 그리지 않는다(또는 이름 없음 문구가 없다)");
    if (!/nameLine\(colors\)/.test(block)) bad.push("문장 팔레트 카드에 색 이름 줄이 없다");
    if (!/const carried = data\.refine \? pinnedState : null/.test(block)) bad.push("다듬은 답만 이어받는다는 조건이 없다");
    if (!/carryShares\(carried, first\.colors\.map\(\(c\) => c\.role\)\)/.test(block)) bad.push("맨 앞 안의 역할로 carryShares 를 부르지 않는다");
    if (!/palettes\.some\(\(p\) => p\.colorsByTheme\)/.test(block)) bad.push("토글이 UI 두 벌이 있을 때만 나온다는 조건이 없다");
    if (/modeStore|nextMode/.test(block)) bad.push("문장 팔레트 토글이 사이트 기본 모드(modeStore)를 쓴다 — 의도의 톤이 정한 테마를 덮는다");
    if (!/\.\.\.\(twoThemes \? \{ theme \} : \{\}\)/.test(block)) bad.push("저장이 두 벌이 있는 안만 theme 을 싣지 않는다");
    if (!/note: true/.test(block)) bad.push("문장 팔레트 카드가 메모 칸을 켜지 않는다");
    if (!/if \(live !== liveBlock\) return;/.test(block)) bad.push("옛 답의 슬라이더가 이어받을 상태를 고칠 수 있다(마지막 답만 고쳐야 한다)");
    if (!/pinnedState = null;[\s\S]{0,40}retirePins\?\.\(\);/.test(app)) bad.push("새 대화가 이어받을 상태를 비우지 않는다");
    const ui = stripComments(read("public/ui.js"));
    if (!/memo \? \{ note: memo \} : \{\}/.test(ui)) bad.push("structureCard 가 빈 메모를 걸러 내지 않는다");
    if (!/e\.generated\?\.theme/.test(ui)) bad.push("저장 목록이 문장 팔레트의 테마를 안 보인다");
    const css = read("public/app.css");
    for (const sel of [".struct__note", ".names", ".carry"]) if (!css.includes(`${sel} {`)) bad.push(`app.css 에 ${sel} 규칙이 없다`);
    return bad;
  },

  /** 회귀 — 42 · 43단계(문장 팔레트 · 다듬기) 게이트가 그대로 통과한다. */
  "S46-G8": async () => {
    const bad = [];
    const runs = [
      ["check-stage42.mjs", 12],
      ["check-stage43.mjs", 10],
    ];
    let passed = 0;
    for (const [script, n] of runs) {
      for (let i = 1; i <= n; i++) {
        const id = `S${script.match(/\d+/)[0]}-G${i}`;
        const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), id], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
        if (r.stdout.includes(`${id.replace(/-/g, "_")}_OK`) && r.status === 0) passed += 1;
        else bad.push(`${id} 실패: ${(r.stdout + r.stderr).trim().split("\n").slice(-2).join(" / ").slice(0, 160)}`);
      }
    }
    if (bad.length === 0) out(`  회귀 — 게이트 ${passed}개가 그대로 통과`);
    return bad;
  },
};

const id = process.argv[2];
if (!GATES[id]) {
  out(`모르는 게이트: ${id}. 아는 것: ${Object.keys(GATES).join(", ")}`);
  process.exitCode = 1;
} else {
  const bad = await GATES[id]().catch((err) => [`검사 자체가 실패: ${err.message}`]);
  if (bad.length === 0) {
    out(`${id.replace(/-/g, "_")}_OK`);
  } else {
    for (const b of bad) out(`- ${b}`);
    out(`${id} 실패 (${bad.length})`);
    process.exitCode = 1;
  }
}
