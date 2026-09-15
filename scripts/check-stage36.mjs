#!/usr/bin/env node
// 36단계(코드 및 색상 탭 저장 · 탭 전환 시 입력 초기화) 완료 조건 검사기.
//   node scripts/check-stage36.mjs S36-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 다섯 게이트가 전부 실패하는 것을 확인한 뒤에 src·public 을 고쳤다.
//
// 감시 값(재질 목록·기본 배정표·합성 씨앗 모양)은 대상에서 import 하지 않고 여기 사본으로 적는다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandSeed, loadStructures } from "../src/expand.js";
import { installDom } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/* ── 사본 ─────────────────────────────────────────────────── */
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const DEFAULT_FINISH_BY_ROLE = Object.freeze({ 바탕: "matte", 면: "metal", 본문: "gloss", 강조: "emissive", "먼 쪽": "matte", 중간: "gloss", "가까운 쪽": "metal" });
const HEX = "#E07A5F";
const SEED_ID = "hex-E07A5F";
const up = (hex) => String(hex).toUpperCase();
const syntheticSeed = (hex) => ({ id: null, colors: [{ hex }, { hex }] });
const recompute = (hex, structureId, mode) => expandSeed(syntheticSeed(hex), structureId, loadStructures(), { mode })?.colors ?? null;

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", EMBED_PREPARE: "0", ...env },
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

const post = (port, path, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });

function runChecker(script, id) {
  const child = spawn(process.execPath, [script, id], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => resolve({ id, ok: code === 0 && stdout.includes(id.replace(/-/g, "_") + "_OK"), tail: (stdout.trim() || stderr.trim()).split("\n").pop() ?? "" }));
  });
}

const GATES = {
  "S36-G1": async () => {
    const bad = [];
    const port = 4441;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      // 가짜 색을 실어 보낸다 — 무시돼야 한다
      const r1 = await post(port, "/api/saved/derived", { seedId: SEED_ID, structureId: "tone-on-tone", mode: "dark", shares: [50, 30, 20], finishes: { 바탕: "gloss", 손: "metal" }, colors: [{ role: "바탕", hex: "#000000" }] });
      const t1 = await r1.text();
      if (r1.status !== 200) bad.push(`저장이 ${r1.status}: ${t1}`);
      const e1 = JSON.parse(t1 || "{}");
      if (e1.kind !== "derived" || e1.seedId !== SEED_ID || e1.structureId !== "tone-on-tone" || e1.mode !== "dark") bad.push(`항목 모양: ${JSON.stringify({ kind: e1.kind, seedId: e1.seedId, structureId: e1.structureId, mode: e1.mode })}`);
      if (e1.seedLabel !== HEX) bad.push(`seedLabel 이 ${e1.seedLabel} (기대 ${HEX})`);
      const want = recompute(HEX, "tone-on-tone", "dark");
      if (!want || JSON.stringify(e1.colors?.map((c) => ({ role: c.role, hex: c.hex }))) !== JSON.stringify(want)) bad.push(`저장된 색이 재계산과 다르다: ${JSON.stringify(e1.colors)}`);
      if (e1.colors?.map((c) => c.ratio).join(",") !== "50,30,20") bad.push(`비율 ${e1.colors?.map((c) => c.ratio)}`);
      if (e1.finishes?.바탕 !== "gloss") bad.push(`보낸 재질이 안 실렸다: ${e1.finishes?.바탕}`);
      if (Object.hasOwn(e1.finishes ?? {}, "손")) bad.push("없는 역할 재질이 저장됐다");
      for (const role of ["본문", "강조"]) if (e1.finishes?.[role] !== DEFAULT_FINISH_BY_ROLE[role]) bad.push(`${role} 기본 재질이 ${e1.finishes?.[role]}`);
      if (typeof e1.name !== "string" || typeof e1.principle !== "string" || typeof e1.source !== "string") bad.push("이름·원리·출처 누락");

      // 밝은 모드도 재계산과 같다 · 다른 키(모드)는 다른 항목
      const e2 = await (await post(port, "/api/saved/derived", { seedId: SEED_ID, structureId: "accent-by-chroma", mode: "light" })).json();
      const want2 = recompute(HEX, "accent-by-chroma", "light");
      if (JSON.stringify(e2.colors?.map((c) => ({ role: c.role, hex: c.hex }))) !== JSON.stringify(want2)) bad.push("밝은 모드 저장이 재계산과 다르다");
      if (up(e2.colors?.find((c) => c.role === "강조")?.hex) !== HEX) bad.push("강조색 저장이 입력 헥스가 아니다");

      // 같은 키로 다시 저장하면 덮어쓰고 비율·메모를 이어받는다
      const e3 = await (await post(port, "/api/saved/derived", { seedId: SEED_ID, structureId: "tone-on-tone", mode: "dark", note: "메모" })).json();
      if (e3.colors?.map((c) => c.ratio).join(",") !== "50,30,20" || e3.note !== "메모") bad.push("재저장이 비율을 안 이어받거나 메모가 안 실렸다");

      for (const [label, b, want] of [
        ["깨진 헥스 씨앗", { seedId: "hex-GGGGGG", structureId: "tone-on-tone" }, 400],
        ["# 붙은 헥스", { seedId: HEX, structureId: "tone-on-tone" }, 400],
        ["없는 구조", { seedId: SEED_ID, structureId: "nope" }, 400],
        ["모르는 모드", { seedId: SEED_ID, structureId: "tone-on-tone", mode: "dim" }, 400],
        ["비율 합 틀림", { seedId: SEED_ID, structureId: "tone-on-tone", shares: [50, 50, 50] }, 400],
      ]) {
        const r = await post(port, "/api/saved/derived", b);
        if (r.status !== want) bad.push(`${label}: ${r.status} (기대 ${want})`);
      }

      const { saved } = await (await fetch(`http://127.0.0.1:${port}/api/saved`)).json();
      const mine = saved.filter((e) => e.seedId === SEED_ID);
      if (mine.length !== 2) bad.push(`헥스 항목이 ${mine.length}개 (기대 2 — 같은 키는 덮어쓴다)`);
      for (const fmt of ["unreal", "unity"]) {
        const ex = JSON.parse(await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text());
        const p = ex.palettes.find((x) => x.id === `${SEED_ID}-tone-on-tone-dark`);
        if (!p) bad.push(`${fmt} 에 ${SEED_ID}-tone-on-tone-dark 가 없다 (${ex.palettes.map((x) => x.id).join(",")})`);
        else {
          if (p.colors.length !== 3) bad.push(`${fmt} 색 ${p.colors.length}개`);
          if (p.seed !== HEX) bad.push(`${fmt} seed 가 ${p.seed}`);
          if (p.colors.find((c) => c.role === "바탕")?.finish !== "gloss") bad.push(`${fmt} 바탕 재질이 gloss 가 아니다`);
        }
        if (ex.skippedBroken !== 0) bad.push(`${fmt} skippedBroken ${ex.skippedBroken}`);
      }
      for (const fmt of ["css", "json"]) {
        const text = await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text();
        if (text.includes(SEED_ID)) bad.push(`${fmt} 에 헥스 파생이 새어 나갔다`);
      }
    } finally {
      server.kill();
    }

    installDom();
    const { savedFields } = await import("../public/ui.js");
    const f = savedFields({ kind: "derived", seedId: SEED_ID, seedLabel: HEX, structureId: "tone-on-tone", mode: "dark", name: "톤온톤", principle: "p", source: "s", colors: [{ role: "바탕", hex: "#111111", ratio: 50 }, { role: "본문", hex: "#222222", ratio: 30 }, { role: "강조", hex: "#333333", ratio: 20 }], finishes: { 바탕: "gloss" } });
    if (f.badge !== "어두운 배경") bad.push(`savedFields 배지가 ${f.badge}`);
    if (!f.coords?.some(([k, v]) => k === "씨앗" && v === HEX)) bad.push(`savedFields 씨앗이 ${JSON.stringify(f.coords)}`);
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("hex- 씨앗 저장 — 가짜 색 무시·두 모드 재계산 · seedLabel · 덮어쓰기·이어받기 · 400 다섯 · 목록 · 엔진 id · CSS/JSON 제외 · savedFields");
    out("S36_G1_OK");
  },

  "S36-G2": async () => {
    const bad = [];
    const port = 4442;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      const { seeds } = JSON.parse(read("data/seeds.json"));
      const pool = seeds.find((s) => s.id === "wada-002");
      if (!pool) throw new Error("검사기 픽스처 wada-002 가 씨앗 풀에 없다");
      const r1 = await post(port, "/api/saved", { paletteId: "wada-002", fromQuery: "#12354E" });
      const t1 = await r1.text();
      if (r1.status !== 200) bad.push(`풀 쌍 저장이 ${r1.status}: ${t1}`);
      const e1 = JSON.parse(t1 || "{}");
      if (e1.paletteId !== "wada-002") bad.push(`paletteId ${e1.paletteId}`);
      const label = pool.colors.map((c) => c.origName).join(" × ");
      if (e1.name !== label) bad.push(`이름이 ${e1.name} (기대 ${label})`);
      if (e1.colors?.length !== 2 || e1.colors.some((c, i) => up(c.hex) !== up(pool.colors[i].hex) || c.name !== pool.colors[i].origName)) bad.push(`색이 ${JSON.stringify(e1.colors)}`);
      if (e1.colors?.map((c) => c.ratio).join(",") !== "50,50") bad.push(`풀 쌍 비율이 ${e1.colors?.map((c) => c.ratio)} (유형 없음 → 50:50)`);
      if (e1.fromQuery !== "#12354E") bad.push("fromQuery 가 안 실렸다");
      if (Object.hasOwn(e1, "type") && e1.type !== undefined) bad.push(`풀 쌍에 유형이 지어졌다: ${e1.type}`);
      if (typeof e1.summary === "string" && e1.summary) bad.push("풀 쌍에 해설이 지어졌다");

      // 코퍼스 쌍은 전과 같다 — D형은 70:30(바탕은 저채도 쪽), 유형이 살아 있다
      const dPair = JSON.parse(read("data/palettes.json")).palettes.find((p) => p.type === "D");
      if (!dPair) throw new Error("검사기 픽스처: D형 쌍이 코퍼스에 없다");
      const e2 = await (await post(port, "/api/saved", { paletteId: dPair.id })).json();
      const ratio2 = (e2.colors ?? []).map((c) => c.ratio).sort((a, b) => a - b).join(",");
      if (e2.type !== "D" || ratio2 !== "30,70" || e2.summary !== dPair.summary) bad.push(`코퍼스 쌍 저장이 바뀌었다: ${JSON.stringify({ type: e2.type, ratio: e2.colors?.map((c) => c.ratio) })}`);

      const bad1 = await post(port, "/api/saved", { paletteId: "wada-999" });
      if (bad1.status !== 400) bad.push(`없는 풀 id 가 ${bad1.status}`);

      await post(port, "/api/saved", { paletteId: "wada-002", note: "풀 메모" });
      const { saved } = await (await fetch(`http://127.0.0.1:${port}/api/saved`)).json();
      const mine = saved.filter((e) => e.paletteId === "wada-002");
      if (mine.length !== 1 || mine[0].note !== "풀 메모") bad.push(`풀 쌍 항목이 ${mine.length}개 / 메모 ${mine[0]?.note}`);
    } finally {
      server.kill();
    }

    installDom();
    const { savedFields } = await import("../public/ui.js");
    const f = savedFields({ paletteId: "wada-002", name: "A × B", colors: [{ name: "A", hex: "#111111", ratio: 50 }, { name: "B", hex: "#222222", ratio: 50 }] });
    if (f.kind !== "palette" || f.badge !== "유형 모름" || f.title !== "A × B") bad.push(`savedFields: ${JSON.stringify({ kind: f.kind, badge: f.badge, title: f.title })}`);
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("풀 쌍 저장 — 원명 이름·2색·50:50·해설 없음 · 코퍼스 쌍 그대로 · 400 · 덮어쓰기 · savedFields 유형 모름");
    out("S36_G2_OK");
  },

  "S36-G3": async () => {
    const bad = [];
    const port = 4443;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/color?q=${encodeURIComponent(HEX)}`);
      if (r.status !== 200) bad.push(`응답이 ${r.status}`);
      const data = await r.json();
      const roles = [...new Set((data.structures ?? []).flatMap((st) => st.colors.map((c) => c.role)))];
      if (roles.length < 5) bad.push(`역할이 ${roles.length}개뿐`);
      for (const role of roles) if (!FINISH_IDS.includes(data.finishes?.assignments?.[role])) bad.push(`역할 ${role} 에 재질이 없다: ${data.finishes?.assignments?.[role]}`);
      for (const role of roles) if (data.finishes?.assignments?.[role] !== DEFAULT_FINISH_BY_ROLE[role]) bad.push(`역할 ${role} 이 기본 배정이 아니다`);
      if (typeof data.finishes?.names?.matte !== "string") bad.push("재질 이름표가 없다");
      if (data.finishes?.from === "llm") bad.push("재질이 LLM 에서 왔다");
      if (/"model"|ollama/i.test(JSON.stringify(data))) bad.push("응답에 model·Ollama 흔적");
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("/api/color 재질 — 모든 역할 기본 배정 · 이름표 · LLM 아님");
    out("S36_G3_OK");
  },

  "S36-G4": async () => {
    const bad = [];
    const app = stripJs(read("public/app.js"));
    // 39단계가 탭 절 경계(주석)를 없앴다 — colorBlock 함수 몸통으로 자른다(39단계가 탭 단정을 대체)
    const colorSection = app.slice(app.indexOf("function colorBlock"), app.indexOf("function inputCard"));
    if (colorSection.length < 200) bad.push("색 블록 절을 못 찾았다");
    if (!/`hex-\$\{[^`]*\}`/.test(colorSection)) bad.push("색 블록 저장이 hex- 씨앗 id 를 안 만든다");
    if (!/api\("\/api\/saved\/derived",\s*\{\s*seedId/.test(colorSection)) bad.push("색 블록이 구조 저장을 씨앗 id 로 안 부른다");
    if (!/api\("\/api\/saved",\s*\{[^}]*paletteId:\s*p\.pairId/.test(app)) bad.push("짝 카드가 paletteId 로 /api/saved 를 안 부른다");
    if (!/finishEditing\(/.test(colorSection) || !/finishOverrides\(/.test(colorSection)) bad.push("색 블록이 재질 고르개를 안 쓴다");
    if (!/applyModeButton\(/.test(colorSection) || !/nextMode\(/.test(colorSection)) bad.push("색 블록에 모드 토글이 없다");
    if (!/overrides\.forStructure\(/.test(colorSection)) bad.push("저장에 손으로 바꾼 재질이 안 실린다");
    if (!/input\.value = "";\s*send\(\{\s*text\s*\}\);/.test(app)) bad.push("form submit 이 입력을 비운 뒤 send({ text }) 를 부르지 않는다(39단계가 탭 단정을 대체)");
    if (/LLM/.test(app)) bad.push("app.js 에 'LLM'");
    const ui = read("public/ui.js");
    if ([...ui.matchAll(/localStorage/g)].length !== 1) bad.push("ui.js 저장소 접근이 한 곳이 아니다");
    for (const p of ["public/app.js", "public/history.js", "public/saved.js"]) if (/localStorage|sessionStorage/.test(stripJs(read(p)))) bad.push(`${p} 가 저장소를 직접 만진다`);
    if (bad.length) throw new Error(bad.join(" / "));
    out("hex- 씨앗 저장 · 짝 paletteId 저장 · 고르개·토글 재사용 · submit 이 입력을 비우고 send · 저장소 한 곳");
    out("S36_G4_OK");
  },

  "S36-G5": async () => {
    const targets = [];
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage9.mjs", `S9-G${i}`]);
    for (let i = 1; i <= 13; i += 1) targets.push(["scripts/check-stage18.mjs", `S18-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage19.mjs", `S19-G${i}`]);
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage20.mjs", `S20-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage22.mjs", `S22-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage35.mjs", `S35-G${i}`]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S36_G5_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage36.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  try {
    await GATES[id]();
    process.exitCode = 0;
  } catch (err) {
    out(`${id} 실패: ${err.message}`);
    process.exitCode = 1;
  }
}
