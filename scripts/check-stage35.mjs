#!/usr/bin/env node
// 35단계(코드 및 색상 탭 — 헥스·색 이름 → 어울리는 색) 완료 조건 검사기.
//   node scripts/check-stage35.mjs S35-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 여섯 게이트가 전부 실패하는 것을 확인한 뒤에 src·public 을 고쳤다.
//
// 감시 값(탭 라벨·거리 함수·합성 씨앗 모양)은 대상에서 import 하지 않고 여기 사본으로 적는다 —
// 이 저장소가 "게이트가 감시 대상에서 값을 가져오면 함께 느슨해진다" 로 여러 번 뚫렸다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandAll, hexToHsl, loadStructures } from "../src/expand.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

/* ── 사본 ─────────────────────────────────────────────────── */
const PARTNER_COUNT = 3;
const STRUCTURE_COUNT = 8;
const up = (hex) => String(hex).toUpperCase();

/** 거리 사본 — 지각 채도 평면(c·cos h, c·sin h)과 명도의 유클리드 거리 `[판단]`. */
function distanceCopy(a, b) {
  const p = (hex) => {
    const { h, s, l } = hexToHsl(hex);
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const rad = (h * Math.PI) / 180;
    return [c * Math.cos(rad), c * Math.sin(rad), l];
  };
  const [x1, y1, z1] = p(a);
  const [x2, y2, z2] = p(b);
  return Math.hypot(x1 - x2, y1 - y2, z1 - z2);
}

/** 씨앗 40쌍. 코퍼스 16 + 풀 24. 대상(server.js)이 아니라 데이터에서 직접 읽는다. */
function seeds() {
  const { palettes } = JSON.parse(read("data/palettes.json"));
  const { seeds: pool } = JSON.parse(read("data/seeds.json"));
  return [
    ...palettes.map((p) => ({ id: p.id, name: p.name, colors: p.colors.map((c) => ({ hex: c.hex, name: c.name, origName: c.origName })) })),
    ...pool.map((s) => ({ id: s.id, colors: s.colors.map((c) => ({ hex: c.hex, name: c.origName })) })),
  ];
}
const corpusHexes = () => new Set(seeds().flatMap((s) => s.colors.map((c) => up(c.hex))));

/** 합성 씨앗 사본 — 입력 색을 두 자리에 모두 앉힌다. 서버·규칙이 이 모양을 써야 G3 의 재계산이 맞는다. */
const syntheticSeed = (hex) => ({ id: null, colors: [{ hex }, { hex }] });

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

const loadTarget = () => import("../src/from-color.js");

const GATES = {
  "S35-G1": async () => {
    const bad = [];
    const { parseColorInput } = await loadTarget();
    const corpus = seeds().flatMap((s) => s.colors);
    const parse = (text) => parseColorInput(text, corpus);

    for (const [text, hex] of [["#E07A5F", "#E07A5F"], ["e07a5f", "#E07A5F"], ["#abc", "#AABBCC"], ["ABC", "#AABBCC"], ["  #E07A5F  ", "#E07A5F"]]) {
      const r = parse(text);
      if (r?.hex !== hex || r?.from !== "hex") bad.push(`${JSON.stringify(text)} → ${JSON.stringify(r)} (기대 ${hex}, hex)`);
    }
    // 코퍼스 이름 — 한글 · 원명 · 대소문자 무시
    for (const [text, hex] of [["테라코타", null], ["세이지그린", "#719470"], ["chromium green", "#719470"], ["Cameo Pink", "#E0B3B6"]]) {
      const r = parse(text);
      const want = hex ?? corpus.find((c) => c.name === text)?.hex;
      if (!want) bad.push(`검사기 픽스처 ${text} 가 코퍼스에 없다`);
      else if (up(r?.hex) !== up(want) || r?.from !== "name") bad.push(`${text} → ${JSON.stringify(r)} (기대 ${want}, name)`);
    }
    // 색 낱말 — 코퍼스 색이고 결정적
    const hexes = corpusHexes();
    for (const text of ["붉은", "파란", "잿빛", "초록색"]) {
      const a = parse(text);
      const b = parse(text);
      if (!a || a.from !== "word" || !hexes.has(up(a.hex))) bad.push(`낱말 ${text} → ${JSON.stringify(a)} (코퍼스 색이어야 한다)`);
      else if (a.hex !== b.hex) bad.push(`낱말 ${text} 가 결정적이지 않다`);
    }
    for (const text of ["hello", "#GGGGGG", "#12345", "#1234567", "constructor", "__proto__", "", "   ", null, 12, "빨강파랑", "#E07A5F extra"]) {
      const r = parse(text);
      if (r !== null) bad.push(`${JSON.stringify(text)} 가 null 이 아니다: ${JSON.stringify(r)}`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("헥스 4형 · 코퍼스 이름(한글·원명·대소문자) · 낱말 결정적 · 쓰레기 null");
    out("S35_G1_OK");
  },

  "S35-G2": async () => {
    const bad = [];
    const { partnersFor, colorDistance } = await loadTarget();
    const all = seeds();
    const hexes = corpusHexes();

    // 거리 함수 — 자기 자신 0 · 대칭 · 검사기 사본과 일치
    for (const [a, b] of [["#719470", "#E0B3B6"], ["#000000", "#FFFFFF"], ["#E07A5F", "#12354E"], ["#808080", "#808080"]]) {
      const d = colorDistance(a, b);
      if (Math.abs(d - colorDistance(b, a)) > 1e-12) bad.push(`거리가 비대칭 ${a} ${b}`);
      if (Math.abs(d - distanceCopy(a, b)) > 1e-9) bad.push(`거리가 사본과 다르다 ${a} ${b}: ${d} vs ${distanceCopy(a, b)}`);
    }
    if (colorDistance("#719470", "#719470") !== 0) bad.push("자기 자신과의 거리가 0 이 아니다");

    let checked = 0;
    for (const s of all) {
      for (let i = 0; i < 2; i += 1) {
        const input = s.colors[i].hex;
        const other = s.colors[1 - i].hex;
        const r = partnersFor(input, all, PARTNER_COUNT);
        checked += 1;
        if (!Array.isArray(r) || r.length !== PARTNER_COUNT) {
          bad.push(`${s.id} ${input}: 결과가 ${r?.length}개`);
          continue;
        }
        const ids = r.map((x) => x.pairId);
        if (new Set(ids).size !== ids.length) bad.push(`${s.id} ${input}: 쌍 id 중복 ${ids.join(",")}`);
        const own = r.find((x) => x.pairId === s.id);
        if (!own) bad.push(`${s.id} ${input}: 자기 쌍이 3위 안에 없다 (${ids.join(",")})`);
        else {
          if (own.distance !== 0) bad.push(`${s.id} ${input}: 자기 쌍 거리가 ${own.distance}`);
          if (up(own.partner?.hex) !== up(other)) bad.push(`${s.id} ${input}: 짝이 ${own.partner?.hex} (기대 ${other})`);
          if (up(own.near?.hex) !== up(input)) bad.push(`${s.id} ${input}: near 가 ${own.near?.hex}`);
        }
        for (let k = 1; k < r.length; k += 1) if (r[k].distance < r[k - 1].distance) bad.push(`${s.id} ${input}: 거리 오름차순이 아니다`);
        for (const x of r) {
          if (!hexes.has(up(x.near?.hex)) || !hexes.has(up(x.partner?.hex))) bad.push(`${s.id} ${input}: 코퍼스 밖 헥스 ${x.near?.hex}/${x.partner?.hex}`);
          if (typeof x.pairName !== "string" || !x.pairName) bad.push(`${s.id}: pairName 없음`);
          if (Math.abs(x.distance - distanceCopy(input, x.near.hex)) > 1e-9) bad.push(`${s.id} ${input}: 거리가 사본과 다르다`);
        }
        const again = partnersFor(input, all, PARTNER_COUNT);
        if (JSON.stringify(again) !== JSON.stringify(r)) bad.push(`${s.id} ${input}: 결정적이지 않다`);
      }
    }
    if (checked !== 80) bad.push(`검사한 색이 ${checked} (기대 80)`);
    // 코퍼스 밖 입력도 코퍼스 색만 낸다
    const off = partnersFor("#E07A5F", all, PARTNER_COUNT);
    for (const x of off) if (!hexes.has(up(x.near.hex)) || !hexes.has(up(x.partner.hex))) bad.push(`#E07A5F: 코퍼스 밖 헥스`);
    if (off.some((x) => x.distance === 0)) bad.push("#E07A5F 는 코퍼스에 없는데 거리 0 이 나왔다");
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("80색 전부 자기 쌍 3위 안 · 짝은 다른 색 · 코퍼스 헥스만 · 중복 없음 · 오름차순 · 결정적 · 거리 대칭");
    out("S35_G2_OK");
  },

  "S35-G3": async () => {
    const bad = [];
    const { structuresFor } = await loadTarget();
    const catalog = loadStructures();
    for (const hex of ["#E07A5F", "#12354E", "#808080", "#000000", "#FFFFFF", "#F5ECC2"]) {
      const r = structuresFor(hex);
      if (!Array.isArray(r) || r.length !== STRUCTURE_COUNT) {
        bad.push(`${hex}: 구조가 ${r?.length}개`);
        continue;
      }
      const light = expandAll(syntheticSeed(hex), catalog, { mode: "light" });
      const dark = expandAll(syntheticSeed(hex), catalog, { mode: "dark" });
      for (const st of r) {
        const l = light.find((x) => x.id === st.id);
        const d = dark.find((x) => x.id === st.id);
        if (!l || !d) {
          bad.push(`${hex}: 카탈로그에 없는 구조 ${st.id}`);
          continue;
        }
        if (![3, 4].includes(st.colors?.length)) bad.push(`${hex} ${st.id}: 색이 ${st.colors?.length}개`);
        if (JSON.stringify(st.colors) !== JSON.stringify(l.colors)) bad.push(`${hex} ${st.id}: 밝은 모드가 재계산과 다르다`);
        if (JSON.stringify(st.colorsDark) !== JSON.stringify(d.colors)) bad.push(`${hex} ${st.id}: 어두운 모드가 재계산과 다르다`);
        if (typeof st.name !== "string" || typeof st.principle !== "string" || typeof st.source !== "string") bad.push(`${hex} ${st.id}: 이름·원리·출처 누락`);
      }
      for (const id of ["accent-by-chroma", "warm-neutral"]) {
        const st = r.find((x) => x.id === id);
        const accent = st?.colors?.find((c) => c.role === "강조");
        if (up(accent?.hex) !== up(hex)) bad.push(`${hex} ${id}: 강조가 ${accent?.hex} (입력 그대로여야 한다)`);
      }
      if (JSON.stringify(structuresFor(hex)) !== JSON.stringify(r)) bad.push(`${hex}: 결정적이지 않다`);
    }
    for (const junk of ["#GGGGGG", "abcd", null]) {
      let threw = false;
      let r;
      try {
        r = structuresFor(junk);
      } catch {
        threw = true;
      }
      if (!threw && !(Array.isArray(r) && r.length === 0)) bad.push(`${JSON.stringify(junk)} 가 구조를 냈다`);
    }
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("8구조 · 3~4색 · 두 모드가 합성 씨앗 재계산과 일치 · 강조는 입력 그대로 · 결정적");
    out("S35_G3_OK");
  },

  "S35-G4": async () => {
    const bad = [];
    const port = 4431;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      const hexes = corpusHexes();
      const catalog = loadStructures();
      const get = (q) => fetch(`http://127.0.0.1:${port}/api/color${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);

      const r = await get("#E07A5F");
      if (r.status !== 200) bad.push(`헥스 응답이 ${r.status}`);
      const data = await r.json();
      const text = JSON.stringify(data);
      if (data.input?.hex !== "#E07A5F" || data.input?.from !== "hex") bad.push(`input 이 ${JSON.stringify(data.input)}`);
      if (!hexes.has(up(data.input?.nearest?.hex))) bad.push(`nearest 가 코퍼스 밖: ${JSON.stringify(data.input?.nearest)}`);
      if (!Array.isArray(data.partners) || data.partners.length !== PARTNER_COUNT) bad.push(`partners 가 ${data.partners?.length}`);
      for (const p of data.partners ?? []) {
        if (!hexes.has(up(p.near?.hex)) || !hexes.has(up(p.partner?.hex))) bad.push(`짝에 코퍼스 밖 헥스 ${p.near?.hex}/${p.partner?.hex}`);
        if (typeof p.pairId !== "string" || typeof p.pairName !== "string" || typeof p.distance !== "number") bad.push("짝 필드 누락");
      }
      if (!Array.isArray(data.structures) || data.structures.length !== STRUCTURE_COUNT) bad.push(`structures 가 ${data.structures?.length}`);
      const light = expandAll(syntheticSeed("#E07A5F"), catalog);
      const dark = expandAll(syntheticSeed("#E07A5F"), catalog, { mode: "dark" });
      for (const st of data.structures ?? []) {
        const l = light.find((x) => x.id === st.id);
        const d = dark.find((x) => x.id === st.id);
        if (!l || JSON.stringify(st.colors) !== JSON.stringify(l.colors)) bad.push(`${st.id} 밝은 모드가 재계산과 다르다`);
        if (!d || JSON.stringify(st.colorsDark) !== JSON.stringify(d.colors)) bad.push(`${st.id} colorsDark 가 재계산과 다르다`);
      }
      if (typeof data.elapsedMs !== "number") bad.push("elapsedMs 없음");
      if (/ollama|127\.0\.0\.1:1\b|model/i.test(text)) bad.push("응답에 Ollama·모델 흔적이 있다");

      const name = await (await get("세이지그린")).json();
      if (name.input?.from !== "name" || up(name.input?.hex) !== "#719470") bad.push(`이름 입력이 ${JSON.stringify(name.input)}`);
      if (name.partners?.[0]?.pairId !== "pair-01" || name.partners?.[0]?.distance !== 0) bad.push(`세이지그린의 1위가 ${JSON.stringify(name.partners?.[0])}`);
      const word = await (await get("붉은")).json();
      if (word.input?.from !== "word" || !hexes.has(up(word.input?.hex))) bad.push(`낱말 입력이 ${JSON.stringify(word.input)}`);

      const empty = await get("​");
      if (empty.status !== 400) bad.push(`빈 q 가 ${empty.status}`);
      const none = await get(undefined);
      if (none.status !== 400) bad.push(`q 없음이 ${none.status}`);
      const junk = await get("hello world");
      if (junk.status !== 400) bad.push(`못 읽는 색이 ${junk.status}`);
      const junkBody = await junk.text();
      if (/[A-Za-z]:\\|\/src\/|node_modules/.test(junkBody)) bad.push("오류 문구에 내부 경로");
      if (!/RRGGBB|헥스|색 이름/.test(junkBody)) bad.push(`오류 문구가 무엇을 받는지 말하지 않는다: ${junkBody}`);
      const long = await get("#" + "A".repeat(600));
      if (long.status !== 400) bad.push(`긴 q 가 ${long.status}`);
      const badHex = await get("#GGGGGG");
      if (badHex.status !== 400) bad.push(`#GGGGGG 가 ${badHex.status}`);

      const html = stripHtml(await (await fetch(`http://127.0.0.1:${port}/`)).text());
      if (/LLM/.test(html)) bad.push("홈 HTML 에 'LLM' 이 있다");
      if (!html.includes('<ol class="chat"')) bad.push("홈 HTML 에 채팅 목록이 없다(39단계가 탭 단정을 대체)");
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.slice(0, 12).join(" / "));
    out("Ollama 없이 — 헥스·이름·낱말 200 · 형태 · 재계산 일치 · 400 셋 · 내부 경로 없음 · 홈에 LLM 없음");
    out("S35_G4_OK");
  },

  "S35-G5": async () => {
    const bad = [];
    const html = stripHtml(read("public/index.html"));
    if (!html.includes('<ol class="chat"')) bad.push("index.html 에 채팅 목록이 없다(39단계가 탭 단정을 대체)");
    // 38단계: 예시 칩을 뺐다(대표 지시). 칩 검사는 없다.
    if (/LLM/.test(html)) bad.push("index.html 에 'LLM'");

    const app = stripJs(read("public/app.js"));
    if (!app.includes('"/api/chat"')) bad.push("app.js 가 /api/chat 을 안 부른다(39단계가 탭 단정을 대체)");
    if (/tabStore\(|asTab\(/.test(app)) bad.push("app.js 에 tabStore·asTab 이 남아있다(39단계가 탭 단정을 대체)");
    if (!/color:\s*\(data\)\s*=>\s*colorBlock\(data\)/.test(app)) bad.push("BLOCK_BY_ROUTE 에 색 블록이 없다(39단계가 탭 단정을 대체)");
    if (!/structureCard\(/.test(app) || !/swatchView\(/.test(app)) bad.push("색 탭이 structureCard·swatchView 를 재사용하지 않는다");
    if (/LLM/.test(app)) bad.push("app.js 에 'LLM'");

    const ui = read("public/ui.js");
    const hits = [...ui.matchAll(/localStorage/g)].length;
    if (hits !== 1) bad.push(`ui.js 가 저장소를 ${hits}곳에서 만진다 (한 곳이어야 한다 — 주석 포함)`);
    if (/tabStore|asTab|tonefirst:tab/.test(ui)) bad.push("ui.js 에 tabStore·asTab 이 남아있다(39단계가 탭 단정을 대체)");
    for (const p of ["public/app.js", "public/history.js", "public/saved.js"]) if (/localStorage|sessionStorage/.test(stripJs(read(p)))) bad.push(`${p} 가 저장소를 직접 만진다`);

    const hist = stripJs(read("public/history.js"));
    if (!/color:\s*"색"/.test(hist)) bad.push("history.js 라벨에 색이 없다(39단계가 라벨을 짧게 바꿨다)");
    if (!/ask:\s*"되물음"/.test(hist)) bad.push("history.js ROUTE_LABEL 에 되물음이 없다(39단계가 탭 단정을 대체)");

    if (bad.length) throw new Error(bad.join(" / "));
    out("채팅 목록 · /api/chat · tabStore 없음 · 내역 라벨 · 재사용 · 저장소 한 곳");
    out("S35_G5_OK");
  },

  "S35-G6": async () => {
    const targets = [];
    for (let i = 1; i <= 10; i += 1) targets.push(["scripts/check-stage11.mjs", `S11-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage22.mjs", `S22-G${i}`]);
    for (let i = 1; i <= 3; i += 1) targets.push(["scripts/check-stage31.mjs", `S31-G${i}`]);
    for (let i = 1; i <= 10; i += 1) targets.push(["scripts/check-stage34.mjs", `S34-G${i}`]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S35_G6_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage35.mjs <${Object.keys(GATES).join("|")}>`);
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
