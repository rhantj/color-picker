#!/usr/bin/env node
// 34단계(캐릭터 외형 → 부위별 색) 완료 조건 검사기.
//   node scripts/check-stage34.mjs S34-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 열 게이트가 전부 실패하는 것을 확인한 뒤에 src·public 을 고쳤다.
//
// 감시 값(역할 목록·재질 목록·규칙 수치·픽스처)은 대상에서 import 하지 않고 여기 사본으로 적는다 —
// 이 저장소가 "게이트가 감시 대상에서 값을 가져오면 함께 느슨해진다" 로 여러 번 뚫렸다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { hexToHsl, hslToHex } from "../src/expand.js";
import { installDom } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

/* ── 사본 ─────────────────────────────────────────────────── */
const ROLES = Object.freeze(["피부", "머리", "눈", "상의", "하의", "강조"]);
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const LOWER_L_DELTA = 0.18; // 하의 = 상의 명도 −0.18
const LOWER_S_FACTOR = 0.85; // 하의 = 상의 채도 ×0.85
const LOWER_L_FLOOR = 0.08;
const NEIGHBOR_MIN_L_GAP = 0.12;
const HUE_BUCKET = 30;
const CHROMATIC_MIN_S = 0.15;
const IMPRESSION_MAX = 120;
const TAB_KEY = "tonefirst:tab";
const TAB_LABELS = ["색감 추천", "캐릭터 색감", "코드 및 색상"]; // 35단계가 셋째 탭을 더했다

/** 코퍼스 80색. 팔레트 16쌍 + 씨앗 24쌍. 대상(server.js)이 아니라 데이터에서 직접 읽는다. */
function corpus() {
  const { palettes } = JSON.parse(read("data/palettes.json"));
  const { seeds } = JSON.parse(read("data/seeds.json"));
  return [
    ...palettes.flatMap((p) => p.colors.map((c) => ({ hex: c.hex, name: c.name }))),
    ...seeds.flatMap((s) => s.colors.map((c) => ({ hex: c.hex, name: c.origName }))),
  ];
}
const pairById = (id) => JSON.parse(read("data/palettes.json")).palettes.find((p) => p.id === id);
const up = (hex) => String(hex).toUpperCase();
const hueGap = (a, b) => {
  const d = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360));
  return d > 180 ? 360 - d : d;
};

/**
 * 픽스처 10건. `parts` 는 정규식 폴백이 잡아야 하는 것(G1 이 따로 본다) — 여기서는 파서를 거치지 않고
 * 그 결과를 직접 넣어 규칙만 잰다. `pair` 는 검색 대신 고정한다(결정적). `minHues` 는 30° 구획 수 하한 —
 * 회색·검정을 말한 픽스처는 낮다.
 */
const FIXTURES = Object.freeze([
  // minHues 는 손으로 센 예상값이다 — 검정·회색은 구획에 안 세고, 하의·눈은 상의·강조 구획에 앉는다. 구현 뒤 실측이 더 크면 올린다.
  { q: "붉은 머리에 검은 갑옷, 차가운 성격의 기사", parts: { 머리: "red", 상의: "black" }, creature: null, pair: "pair-02", minHues: 3 },
  { q: "로봇 병사, 은색 갑옷", parts: { 상의: "gray" }, creature: "robot", pair: "pair-03", minHues: 1 },
  { q: "트롤 전사", parts: {}, creature: "troll", pair: "pair-05", minHues: 3 },
  { q: "파란 피부의 로봇", parts: { 피부: "blue" }, creature: "robot", pair: "pair-07", minHues: 2 },
  { q: "금발에 초록 눈, 흰 드레스의 공주", parts: { 머리: "gold", 눈: "green", 상의: "white" }, creature: null, pair: "pair-01", minHues: 3 },
  { q: "좀비 해적, 갈색 코트", parts: { 상의: "brown" }, creature: "zombie", pair: "pair-09", minHues: 3 },
  { q: "보라 로브의 마법사, 신비로운", parts: { 상의: "purple" }, creature: "human", pair: "pair-11", minHues: 3 },
  { q: "분홍 머리 소녀, 밝고 상큼한", parts: { 머리: "pink" }, creature: null, pair: "pair-13", minHues: 3 },
  { q: "검은 옷의 암살자, 붉은 눈", parts: { 상의: "black", 눈: "red" }, creature: null, pair: "pair-15", minHues: 3 },
  { q: "유령 소년, 창백하고 슬픈", parts: {}, creature: "ghost", pair: "pair-16", minHues: 2 },
]);

const fullParts = (partial) => Object.fromEntries(ROLES.map((r) => [r, partial[r] ?? null]));

async function loadTargets() {
  const cw = await import("../src/color-words.js");
  const ch = await import("../src/character.js");
  const creatures = cw.loadCreatures();
  const byId = (id) => (id ? creatures.find((c) => c.id === id) ?? null : null);
  const compose = (f) => ch.composeCharacter({ parts: fullParts(f.parts), creature: byId(f.creature), pair: pairById(f.pair), corpus: corpus() });
  return { cw, ch, creatures, compose };
}

/* ── 서버·스텁 ────────────────────────────────────────────── */
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

/** 가짜 Ollama. 시스템 프롬프트로 파서 호출과 재질 호출을 가른다. */
function stubOllama(port, { parserReply, finishReply }) {
  const seen = { parser: 0, finish: 0, bodies: [] };
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }] }));
    }
    if (req.url === "/api/chat") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      seen.bodies.push(raw);
      const isParser = raw.includes("파서");
      if (isParser) seen.parser += 1;
      else seen.finish += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: isParser ? parserReply : finishReply } }));
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, seen })));
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

/* ── 게이트 ───────────────────────────────────────────────── */
const GATES = {
  "S34-G1": async () => {
    const bad = [];
    const { parseDescription, fallbackParse } = await import("../src/describe.js");
    const { loadCharacterWords } = await import("../src/color-words.js");
    const words = loadCharacterWords();
    const q = "시험 문장";

    // 쓰레기 응답 — 헥스·없는 부위·없는 낱말·프로토타입 이름·문자열 아닌 값
    const garbage = '{"parts":{"머리":"#FF0000","상의":"black","손":"red","__proto__":"red","눈":3,"피부":"velvet"},"impression":"어두운 느와르","hex":"#123456"}';
    const g = parseDescription(garbage, words, q);
    if (Object.keys(g.parts).length !== 6 || ROLES.some((r) => !Object.hasOwn(g.parts, r))) bad.push(`parts 가 여섯 부위 전부를 담지 않는다: ${Object.keys(g.parts).join(",")}`);
    if (g.parts.머리 !== null) bad.push(`헥스가 색 낱말로 통과했다: ${g.parts.머리}`);
    if (g.parts.상의 !== "black") bad.push(`정상 낱말 black 이 안 남았다: ${g.parts.상의}`);
    if (Object.hasOwn(g.parts, "손")) bad.push("없는 부위 '손' 이 남았다");
    if (g.parts.눈 !== null || g.parts.피부 !== null) bad.push("문자열 아닌 값·없는 낱말이 남았다");
    if (g.impression !== "어두운 느와르") bad.push(`인상이 그대로 안 왔다: ${g.impression}`);
    if (JSON.stringify(g).includes("#")) bad.push("파서 결과에 헥스가 있다");
    if (g.matched !== 1) bad.push(`matched 가 ${g.matched} (기대 1)`);

    for (const raw of ["not json", "[]", "null", '{"parts":[]}', '{"parts":{"머리":"red"},"impression":""}']) {
      const p = parseDescription(raw, words, q);
      if (!ROLES.every((r) => Object.hasOwn(p.parts, r))) bad.push(`${raw}: 부위 여섯이 없다`);
      if (typeof p.impression !== "string" || !p.impression) bad.push(`${raw}: 인상이 비었다`);
    }
    const emptyImp = parseDescription('{"parts":{},"impression":"   "}', words, q);
    if (emptyImp.impression !== q) bad.push(`빈 인상이 문장 전체로 안 돌아왔다: ${emptyImp.impression}`);
    const longImp = parseDescription(JSON.stringify({ parts: {}, impression: "가".repeat(500) }), words, q);
    if ([...longImp.impression].length > IMPRESSION_MAX) bad.push(`인상이 ${[...longImp.impression].length}자 — ${IMPRESSION_MAX} 이하여야 한다`);

    // 정규식 폴백
    const cases = [
      ["빨간 머리에 검은 갑옷을 입은 기사", { 머리: "red", 상의: "black" }],
      ["금발에 초록 눈", { 머리: "gold", 눈: "green" }],
      ["머리 빨간", {}],
      ["파란색 눈동자, 갈색 바지", { 눈: "blue", 하의: "brown" }],
      ["은발의 마법사", { 머리: "white" }],
      ["차가운 성격의 기사", {}],
    ];
    for (const [text, want] of cases) {
      const r = fallbackParse(text, words);
      for (const role of ROLES) {
        const got = r.parts[role] ?? null;
        const exp = want[role] ?? null;
        if (got !== exp) bad.push(`폴백 "${text}" ${role}: ${got} (기대 ${exp})`);
      }
      if (r.impression !== text) bad.push(`폴백 인상이 문장 전체가 아니다: ${r.impression}`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("파서가 표 밖의 것을 버리고 · 인상 폴백 · 정규식 폴백 6건");
    out("S34_G1_OK");
  },

  "S34-G2": async () => {
    const bad = [];
    const { RANGES, nearestCorpus, loadCharacterWords, loadCreatures } = await import("../src/color-words.js");
    const words = loadCharacterWords();
    const dataIds = Object.keys(words.colorWords).sort();
    const srcIds = Object.keys(RANGES).sort();
    if (JSON.stringify(dataIds) !== JSON.stringify(srcIds)) bad.push(`낱말표 ${dataIds.join(",")} ≠ 범위표 ${srcIds.join(",")}`);
    for (const role of ROLES) if (!Array.isArray(words.parts[role]) || words.parts[role].length === 0) bad.push(`부위 ${role} 의 표면형이 없다`);
    for (const [form, c] of Object.entries(words.compounds ?? {})) {
      if (!ROLES.includes(c.part) || !Object.hasOwn(RANGES, c.color)) bad.push(`복합어 ${form} 이 모르는 부위·색을 가리킨다`);
    }
    const creatures = loadCreatures();
    if (creatures.length < 8) bad.push(`종족이 ${creatures.length}개 — 8개 이상`);
    for (const c of creatures) {
      if (c.skin !== null && !Object.hasOwn(RANGES, c.skin)) bad.push(`종족 ${c.id} 의 피부 낱말 ${c.skin} 이 범위표에 없다`);
      if (c.finish !== null && !FINISH_IDS.includes(c.finish)) bad.push(`종족 ${c.id} 의 재질 ${c.finish} 이 없는 재질이다`);
      if (!Array.isArray(c.words) || c.words.length === 0) bad.push(`종족 ${c.id} 에 낱말이 없다`);
    }
    for (const id of ["robot", "troll", "zombie", "ghost", "human"]) if (!creatures.some((c) => c.id === id)) bad.push(`종족 ${id} 가 없다`);

    // 데이터 파일에 숫자·헥스가 없다 — 숫자는 src 에 둔다는 규칙
    for (const p of ["data/character-words.json", "data/creatures.json"]) {
      const raw = read(p);
      if (/#[0-9a-fA-F]{6}/.test(raw)) bad.push(`${p} 에 헥스가 있다`);
      if (/:\s*-?\d/.test(raw) || /\[\s*-?\d/.test(raw)) bad.push(`${p} 에 숫자 값이 있다`);
    }

    // 모든 낱말이 코퍼스 80색으로 간다 · 결정적 · 범위 안이면 범위를 지킨다
    const all = corpus();
    if (all.length !== 80) bad.push(`코퍼스가 ${all.length}색 (기대 80)`);
    const hexes = new Set(all.map((c) => up(c.hex)));
    for (const id of srcIds) {
      const a = nearestCorpus(id, all, new Set());
      const b = nearestCorpus(id, all, new Set());
      if (!a || !hexes.has(up(a.hex))) bad.push(`${id} → ${a?.hex} 가 코퍼스에 없다`);
      if (a?.hex !== b?.hex) bad.push(`${id} 가 결정적이지 않다`);
      const hsl = hexToHsl(a.hex);
      const r = RANGES[id];
      if (r.hue && hsl.s >= CHROMATIC_MIN_S) {
        const [lo, hi] = r.hue;
        const inside = lo <= hi ? hsl.h >= lo && hsl.h <= hi : hsl.h >= lo || hsl.h <= hi;
        if (!inside) out(`  참고: ${id} 는 범위 안 후보가 없어 중심 거리로 ${a.hex}(h ${hsl.h.toFixed(0)}) 를 골랐다`);
      }
      // 이미 쓴 색은 피한다
      const c = nearestCorpus(id, all, new Set([up(a.hex)]));
      if (!c || up(c.hex) === up(a.hex)) bad.push(`${id} 가 used 를 무시한다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`낱말 ${srcIds.length}개 ↔ 범위 일치 · 종족 ${creatures.length} · 코퍼스 80색으로 결정적`);
    out("S34_G2_OK");
  },

  "S34-G3": async () => {
    const bad = [];
    const { compose } = await loadTargets();
    const hexes = new Set(corpus().map((c) => up(c.hex)));
    const darken = (basis) => {
      const { h, s, l } = hexToHsl(basis);
      return hslToHex({ h, s: s * LOWER_S_FACTOR, l: Math.max(LOWER_L_FLOOR, l - LOWER_L_DELTA) });
    };
    let checked = 0;
    for (const f of FIXTURES) {
      const { colors } = compose(f);
      for (const c of colors) {
        checked += 1;
        if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) bad.push(`${f.q} ${c.role}: 헥스 형식 아님 ${c.hex}`);
        if (typeof c.basis !== "string" || !hexes.has(up(c.basis))) bad.push(`${f.q} ${c.role}: basis ${c.basis} 가 코퍼스에 없다`);
        if (hexes.has(up(c.hex))) continue;
        if (c.source !== "rule") bad.push(`${f.q} ${c.role}: 코퍼스 밖 헥스 ${c.hex} 인데 출처가 ${c.source}`);
        if (up(darken(c.basis)) !== up(c.hex)) bad.push(`${f.q} ${c.role}: ${c.hex} 가 basis ${c.basis} 의 규칙 결과 ${darken(c.basis)} 와 다르다`);
      }
      // 결정적
      const again = compose(f);
      if (JSON.stringify(again.colors) !== JSON.stringify(colors)) bad.push(`${f.q}: 두 번 계산이 다르다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`픽스처 ${FIXTURES.length}건 · 색 ${checked}개 전부 코퍼스이거나 basis 의 규칙 결과 · 결정적`);
    out("S34_G3_OK");
  },

  "S34-G4": async () => {
    const bad = [];
    const { cw, compose } = await loadTargets();
    const all = corpus();
    const byRole = (f) => Object.fromEntries(compose(f).colors.map((c) => [c.role, c]));

    // 말한 부위는 고정 — 그 낱말의 최근접과 같다
    const knight = byRole(FIXTURES[0]);
    if (up(knight.머리.hex) !== up(cw.nearestCorpus("red", all, new Set()).hex) || knight.머리.source !== "spoken") bad.push(`붉은 머리가 고정되지 않았다: ${knight.머리.hex} ${knight.머리.source}`);
    if (up(knight.상의.hex) !== up(cw.nearestCorpus("black", all, new Set()).hex) || knight.상의.source !== "spoken") bad.push(`검은 갑옷이 고정되지 않았다: ${knight.상의.hex}`);
    if (hexToHsl(knight.상의.hex).l > 0.3) bad.push(`검은 상의 명도가 ${hexToHsl(knight.상의.hex).l.toFixed(2)} — 어둡지 않다`);

    // 종족 → 피부
    const robot = byRole(FIXTURES[1]);
    if (robot.피부.source !== "creature") bad.push(`로봇 피부 출처가 ${robot.피부.source}`);
    if (hexToHsl(robot.피부.hex).s > 0.3) bad.push(`로봇 피부가 회색이 아니다: ${robot.피부.hex}`);
    const troll = byRole(FIXTURES[2]);
    const th = hexToHsl(troll.피부.hex);
    if (troll.피부.source !== "creature" || th.h < 60 || th.h > 180) bad.push(`트롤 피부가 초록이 아니다: ${troll.피부.hex} (h ${th.h.toFixed(0)})`);

    // 말한 피부가 종족을 이긴다
    const blueRobot = byRole(FIXTURES[3]);
    const bh = hexToHsl(blueRobot.피부.hex);
    if (blueRobot.피부.source !== "spoken" || bh.h < 180 || bh.h > 270) bad.push(`파란 피부가 로봇 회색에 졌다: ${blueRobot.피부.hex} ${blueRobot.피부.source}`);

    // 음성 대조 — 종족 없음·피부 말 안 함 → 따뜻한 뉴트럴 (h 10~50 · l ≥ 0.55)
    for (const i of [0, 7, 8]) {
      const skin = byRole(FIXTURES[i]).피부;
      const h = hexToHsl(skin.hex);
      if (skin.source !== "rule") bad.push(`${FIXTURES[i].q}: 피부 출처가 ${skin.source} (기대 rule)`);
      if (h.h < 10 || h.h > 50 || h.l < 0.55) bad.push(`${FIXTURES[i].q}: 피부가 따뜻한 뉴트럴이 아니다 ${skin.hex} (h ${h.h.toFixed(0)} l ${h.l.toFixed(2)})`);
    }
    // 사람 종족(human, skin null)도 뉴트럴
    const wizard = byRole(FIXTURES[6]);
    if (wizard.피부.source !== "rule") bad.push(`사람 종족 피부 출처가 ${wizard.피부.source}`);

    // 배색 쌍 출처
    if (knight.강조.source !== "pair") bad.push(`강조 출처가 ${knight.강조.source} (기대 pair)`);
    const pair = pairById(FIXTURES[0].pair);
    if (!pair.colors.some((c) => up(c.hex) === up(knight.강조.hex))) bad.push(`강조 ${knight.강조.hex} 가 배색 쌍 ${pair.id} 의 색이 아니다`);
    if (bad.length) throw new Error(bad.join(" / "));
    out("말한 색 고정 · 로봇 회색 · 트롤 초록 · 말한 피부 > 종족 · 뉴트럴 음성 대조 · 배색 쌍 출처");
    out("S34_G4_OK");
  },

  "S34-G5": async () => {
    const bad = [];
    const { compose } = await loadTargets();
    const NEIGHBORS = [["피부", "머리"], ["피부", "상의"], ["상의", "하의"]];
    for (const f of FIXTURES) {
      const { colors, warnings } = compose(f);
      if (colors.map((c) => c.role).join(",") !== ROLES.join(",")) bad.push(`${f.q}: 부위 순서 ${colors.map((c) => c.role).join(",")}`);
      const byRole = Object.fromEntries(colors.map((c) => [c.role, c]));
      const buckets = new Set(colors.filter((c) => hexToHsl(c.hex).s >= CHROMATIC_MIN_S).map((c) => Math.floor(hexToHsl(c.hex).h / HUE_BUCKET)));
      if (buckets.size < f.minHues) bad.push(`${f.q}: 색상각 구획 ${buckets.size} (하한 ${f.minHues})`);
      const spokenHex = new Set(colors.filter((c) => c.source === "spoken").map((c) => up(c.hex)));
      const rest = colors.filter((c) => c.source !== "spoken").map((c) => up(c.hex));
      if (new Set(rest).size !== rest.length || rest.some((h) => spokenHex.has(h))) bad.push(`${f.q}: 헥스 중복 ${rest.join(",")}`);
      for (const [a, b] of NEIGHBORS) {
        const ruled = [byRole[a], byRole[b]].some((c) => c.source === "rule");
        if (!ruled) continue;
        const gap = Math.abs(hexToHsl(byRole[a].hex).l - hexToHsl(byRole[b].hex).l);
        const warned = (warnings ?? []).some((w) => w.includes(a) || w.includes(b));
        if (gap < NEIGHBOR_MIN_L_GAP - 1e-9 && !warned) bad.push(`${f.q}: ${a}↔${b} 명도차 ${gap.toFixed(2)} < ${NEIGHBOR_MIN_L_GAP} 인데 warnings 에 없다`);
      }
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`픽스처 ${FIXTURES.length}건 — 순서 고정 · 색상각 구획 하한 · 이웃 명도차 · 중복 없음`);
    out("S34_G5_OK");
  },

  "S34-G6": async () => {
    const bad = [];
    const port = 4421;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      const hexes = new Set(corpus().map((c) => up(c.hex)));
      const r = await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("붉은 머리에 검은 갑옷, 차가운 성격의 기사")}`);
      if (r.status !== 200) bad.push(`응답이 ${r.status}`);
      const data = await r.json();
      if (data.parse?.from !== "fallback") bad.push(`Ollama 없이 parse.from 이 ${data.parse?.from}`);
      if (data.parse?.parts?.머리 !== "red" || data.parse?.parts?.상의 !== "black") bad.push(`폴백 파서가 못 잡았다: ${JSON.stringify(data.parse?.parts)}`);
      if (data.parse?.impression !== data.query) bad.push("폴백 인상이 문장 전체가 아니다");
      if (!data.palette?.id || !["search", "fallback"].includes(data.palette.from)) bad.push(`배색 쌍이 없다: ${JSON.stringify(data.palette)}`);
      if (!Array.isArray(data.colors) || data.colors.length !== 6) bad.push(`색이 ${data.colors?.length}개`);
      for (const c of data.colors ?? []) {
        if (!hexes.has(up(c.hex)) && c.source !== "rule") bad.push(`${c.role} ${c.hex} 가 코퍼스 밖인데 rule 이 아니다`);
        if (!hexes.has(up(c.basis))) bad.push(`${c.role} basis ${c.basis} 가 코퍼스 밖`);
      }
      if (data.finishes?.from !== "fallback") bad.push(`재질이 ${data.finishes?.from}`);
      for (const role of ROLES) if (!FINISH_IDS.includes(data.finishes?.assignments?.[role])) bad.push(`재질 폴백에 ${role} 이 없다`);
      if (typeof data.finishes?.names?.matte !== "string") bad.push("재질 이름표가 없다");

      const empty = await fetch(`http://127.0.0.1:${port}/api/character?q=%E2%80%8B`);
      if (empty.status !== 400) bad.push(`빈 q 가 ${empty.status}`);
      const none = await fetch(`http://127.0.0.1:${port}/api/character`);
      if (none.status !== 400) bad.push(`q 없음이 ${none.status}`);

      // 종족 낱말은 LLM 없이도 잡힌다
      const robot = await (await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("로봇 병사")}`)).json();
      if (robot.parse?.creature !== "robot") bad.push(`종족이 ${robot.parse?.creature}`);
      if (robot.finishes?.assignments?.피부 !== "metal") bad.push(`로봇 피부 재질이 ${robot.finishes?.assignments?.피부} (기대 metal)`);

      const html = stripHtml(await (await fetch(`http://127.0.0.1:${port}/`)).text());
      if (/LLM/.test(html)) bad.push("홈 HTML 에 'LLM' 이 있다");
      if (!html.includes("캐릭터 색감")) bad.push("홈 HTML 에 캐릭터 탭이 없다");
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("Ollama 없이 — 폴백 파서 · 배색 쌍 · 6색 · 종족 · 400 · 홈에 LLM 없음");
    out("S34_G6_OK");
  },

  "S34-G7": async () => {
    const bad = [];
    const stubPort = 4422;
    const port = 4423;
    const parserReply = '{"parts":{"머리":"#FF0000","상의":"black","손":"red","__proto__":"red"},"impression":"느와르 포스터 만들건데 고급스러운 빨강","hex":"#123456"}';
    const finishReply = '{"assignments":{"피부":"gloss","머리":"metal","눈":"gloss","상의":"matte","하의":"matte","강조":"emissive","바탕":"metal"}}';
    const { server: stub, seen } = await stubOllama(stubPort, { parserReply, finishReply });
    const server = await startServer(port, { OLLAMA_HOST: `127.0.0.1:${stubPort}`, OLLAMA_MODEL: "stub-model:1b" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("붉은 머리 검객")}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (/#FF0000|#123456/i.test(text)) bad.push("모델이 실어 보낸 헥스가 응답에 닿았다");
      if (data.parse?.from !== "llm") bad.push(`parse.from 이 ${data.parse?.from}`);
      // 모델이 준 헥스는 버려지고, 그 자리는 정규식이 잡은 "붉은 머리"(red) 로 채워진다 — 헥스만 아니면 된다.
      if (typeof data.parse?.parts?.머리 === "string" && data.parse.parts.머리.startsWith("#")) bad.push(`헥스가 색 낱말로 통과했다: ${data.parse.parts.머리}`);
      if (data.parse?.parts?.머리 !== "red") bad.push(`정규식이 채운 머리 red 가 없다: ${data.parse?.parts?.머리}`);
      if (data.parse?.parts?.상의 !== "black") bad.push("정상 낱말이 안 남았다");
      if (Object.hasOwn(data.parse?.parts ?? {}, "손")) bad.push("없는 부위가 응답에 남았다");
      if (data.parse?.impression !== "느와르 포스터 만들건데 고급스러운 빨강") bad.push(`인상이 ${data.parse?.impression}`);
      // 모델이 준 인상이 검색에 쓰였다 — 같은 문장을 /api/search 에 물은 답과 같다
      const search = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(data.parse.impression)}&rewrite=0`)).json();
      if (search.route !== "palette" || !search.results?.[0]) bad.push(`양성 대조 실패 — 인상 문장이 팔레트로 안 갔다 (${search.route})`);
      if (data.palette?.from !== "search" || data.palette?.id !== search.results?.[0]?.id) bad.push(`배색 쌍 ${data.palette?.id}(${data.palette?.from}) ≠ 검색 1위 ${search.results?.[0]?.id}`);
      if (data.finishes?.from !== "llm" || data.finishes?.assignments?.머리 !== "metal") bad.push(`재질 배정이 모델에서 안 왔다: ${JSON.stringify(data.finishes?.assignments)}`);
      if (Object.hasOwn(data.finishes?.assignments ?? {}, "바탕")) bad.push("캐릭터에 없는 역할 '바탕' 이 배정에 남았다");
      if (seen.parser !== 1 || seen.finish !== 1) bad.push(`모델 호출 파서 ${seen.parser} · 재질 ${seen.finish} (기대 1·1)`);
      const parserBody = JSON.parse(seen.bodies.find((b) => b.includes("파서")) ?? "{}");
      if (parserBody.format !== "json") bad.push("파서 호출이 format: json 이 아니다");
      if (!/red|black|gray/.test(parserBody.messages?.[0]?.content ?? "")) bad.push("프롬프트에 색 낱말 id 가 없다");
    } finally {
      server.kill();
      stub.close();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("스텁 모델의 헥스·없는 부위가 응답에 안 닿음 · 인상이 검색에 쓰임 · 호출 1·1");
    out("S34_G7_OK");
  },

  "S34-G8": async () => {
    const bad = [];
    const port = 4424;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      // 가짜 색을 실어 보낸다 — 무시돼야 한다
      const body = { query: "트롤 전사", parts: { 상의: "red", 손: "blue" }, creature: "troll", paletteId: "pair-03", colors: [{ role: "피부", hex: "#000000" }], finishes: { 피부: "metal", 바탕: "gloss" } };
      const r1 = await post(port, "/api/saved/character", body);
      const t1 = await r1.text();
      if (r1.status !== 200) bad.push(`저장이 ${r1.status}: ${t1}`);
      const e1 = JSON.parse(t1 || "{}");
      if (e1.kind !== "derived" || e1.structureId !== "character" || e1.seedId !== "pair-03" || e1.mode !== "light") bad.push(`항목 모양: ${JSON.stringify({ kind: e1.kind, structureId: e1.structureId, seedId: e1.seedId })}`);
      if (e1.colors?.length !== 6 || e1.colors.map((c) => c.role).join(",") !== ROLES.join(",")) bad.push(`색 ${e1.colors?.length}개`);
      const skin = e1.colors?.find((c) => c.role === "피부");
      if (up(skin?.hex) === "#000000") bad.push("본문의 가짜 피부색이 저장됐다");
      const sh = hexToHsl(skin.hex);
      if (sh.h < 60 || sh.h > 180) bad.push(`트롤 피부가 초록이 아니다: ${skin.hex}`);
      if (e1.finishes?.피부 !== "metal") bad.push(`보낸 재질이 안 실렸다: ${e1.finishes?.피부}`);
      if (Object.hasOwn(e1.finishes ?? {}, "바탕")) bad.push("없는 역할 재질이 저장됐다");
      if (e1.character?.parts?.상의 !== "red" || Object.hasOwn(e1.character?.parts ?? {}, "손")) bad.push(`저장된 parts: ${JSON.stringify(e1.character?.parts)}`);
      if (e1.colors.reduce((n, c) => n + c.ratio, 0) !== 100) bad.push("비율 합이 100 이 아니다");
      if (!e1.name?.startsWith("캐릭터 — ")) bad.push(`이름 ${e1.name}`);

      // 종족 재질이 기본으로 실린다 (재질 안 보냄)
      const r2 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01" });
      const e2 = await r2.json();
      if (e2.finishes?.피부 !== "metal") bad.push(`로봇 피부 기본 재질이 ${e2.finishes?.피부} (기대 metal)`);
      if (e2.finishes?.강조 !== "emissive" || e2.finishes?.머리 !== "gloss") bad.push(`캐릭터 기본 재질표가 안 쓰였다: ${JSON.stringify(e2.finishes)}`);

      // 같은 키로 다시 저장하면 덮어쓰고 비율·메모를 이어받는다
      const r3 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01", shares: [30, 20, 10, 15, 15, 10], note: "메모" });
      const e3 = await r3.json();
      if (e3.colors?.map((c) => c.ratio).join(",") !== "30,20,10,15,15,10" || e3.note !== "메모") bad.push("비율·메모가 안 실렸다");
      const r4 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01" });
      const e4 = await r4.json();
      if (e4.colors?.map((c) => c.ratio).join(",") !== "30,20,10,15,15,10" || e4.note !== "메모") bad.push("재저장이 비율·메모를 안 이어받았다");

      // 잘못된 요청
      for (const [label, b, want] of [
        ["배색 쌍 없음", { query: "x", parts: {}, creature: null, paletteId: "pair-99" }, 400],
        ["문장 없음", { parts: {}, paletteId: "pair-01" }, 400],
        ["비율 합 틀림", { query: "x", parts: {}, creature: null, paletteId: "pair-01", shares: [50, 10, 10, 10, 10, 20] }, 400],
      ]) {
        const r = await post(port, "/api/saved/character", b);
        if (r.status !== want) bad.push(`${label}: ${r.status} (기대 ${want})`);
      }

      // 목록 · 내보내기
      const { saved, finishNames } = await (await fetch(`http://127.0.0.1:${port}/api/saved`)).json();
      const mine = saved.filter((e) => e.structureId === "character");
      if (mine.length !== 2) bad.push(`캐릭터 항목이 ${mine.length}개 (기대 2 — 같은 키는 덮어쓴다)`);
      if (typeof finishNames?.metal !== "string") bad.push("재질 이름표가 없다");
      for (const fmt of ["unreal", "unity"]) {
        const ex = JSON.parse(await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text());
        const robot = ex.palettes.find((p) => p.name === e2.name);
        if (!robot) bad.push(`${fmt} 에 로봇 항목이 없다`);
        else {
          if (robot.colors.length !== 6) bad.push(`${fmt} 로봇 색 ${robot.colors.length}개`);
          const s = robot.colors.find((c) => c.role === "피부");
          if (s?.metallic !== 1) bad.push(`${fmt} 로봇 피부 metallic 이 ${s?.metallic}`);
          // 같은 키로 세 번 저장했으므로 남은 항목은 마지막(e4)이다.
          if (robot.id !== e4.id) bad.push(`${fmt} 항목 id 가 저장 id 가 아니다: ${robot.id} (기대 ${e4.id})`);
        }
        if (ex.skippedBroken !== 0) bad.push(`${fmt} skippedBroken ${ex.skippedBroken}`);
        const ids = ex.palettes.map((p) => p.id);
        if (new Set(ids).size !== ids.length) bad.push(`${fmt} 에 id 가 겹친다`);
      }
      for (const fmt of ["css", "json"]) {
        const text = await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text();
        if (text.includes("캐릭터 — ")) bad.push(`${fmt} 에 캐릭터 항목이 새어 나갔다`);
      }
    } finally {
      server.kill();
    }

    // /saved 화면 필드
    installDom();
    const { savedFields } = await import("../public/ui.js");
    const f = savedFields({ kind: "derived", structureId: "character", seedLabel: "세이지그린 × 연분홍", character: { query: "트롤 전사" }, colors: ROLES.map((role, i) => ({ role, hex: "#123456", ratio: i === 0 ? 20 : 16 })), finishes: { 피부: "metal" } });
    if (f.badge !== "캐릭터") bad.push(`savedFields 배지가 ${f.badge}`);
    if (!f.coords.some(([k, v]) => k === "배색 쌍" && v === "세이지그린 × 연분홍")) bad.push("좌표에 배색 쌍이 없다");
    if (!f.coords.some(([k, v]) => k === "설명" && v === "트롤 전사")) bad.push("좌표에 설명이 없다");
    if (f.finishes?.[0]?.id !== "metal") bad.push("재질 줄이 안 나온다");
    const plain = savedFields({ kind: "derived", structureId: "tone-on-tone", mode: "dark", colors: [] });
    if (plain.badge !== "어두운 배경") bad.push(`파생 배지 회귀: ${plain.badge}`);
    if (bad.length) throw new Error(bad.join(" / "));
    out("저장 왕복 — 가짜 색 무시 · 종족 재질 기본 · 덮어쓰기·이어받기 · 400 · 엔진 6역할·id 유일 · CSS/JSON 제외 · 화면 필드");
    out("S34_G8_OK");
  },

  "S34-G9": async () => {
    const bad = [];
    const html = stripHtml(read("public/index.html"));
    if (!/role="tablist"/.test(html)) bad.push("tablist 가 없다");
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
    if (tabs.join("|") !== TAB_LABELS.join("|")) bad.push(`탭이 ${tabs.join("|")} (기대 ${TAB_LABELS.join("|")})`);
    if (!/data-tab-select="palette"/.test(html) || !/data-tab-select="character"/.test(html)) bad.push("탭 버튼에 data-tab-select 가 없다");
    if (!/id="results-character"/.test(html) || !/id="results-palette"/.test(html)) bad.push("탭별 결과 영역이 없다");
    if (!/data-tab="character"/.test(html)) bad.push("캐릭터 예시 칩이 없다");
    if (/LLM/.test(html)) bad.push("index.html 에 'LLM'");

    const app = stripJs(read("public/app.js"));
    if (!app.includes("/api/character?q=")) bad.push("app.js 가 /api/character 를 안 부른다");
    if (!app.includes("/api/saved/character")) bad.push("app.js 가 캐릭터 저장을 안 부른다");
    if (!/tabStore\(/.test(app)) bad.push("app.js 가 tabStore 를 안 쓴다");
    if (!/characterStructure\(/.test(app) || !/structureCard\(/.test(app)) bad.push("캐릭터 카드가 structureCard 를 재사용하지 않는다");
    if (!/route:\s*"character"/.test(app)) bad.push("캐릭터 턴 기록에 route character 가 없다");
    if (/LLM/.test(app)) bad.push("app.js 에 'LLM'");
    if (!app.includes("인상을 못 읽어 기본 배색을 썼습니다")) bad.push("폴백 안내 문장이 없다");

    const ui = read("public/ui.js");
    const hits = [...ui.matchAll(/localStorage/g)].length;
    if (hits !== 1) bad.push(`ui.js 가 저장소를 ${hits}곳에서 만진다 (한 곳이어야 한다 — 주석 포함)`);
    if (!ui.includes(`"${TAB_KEY}"`)) bad.push(`ui.js 에 탭 키 ${TAB_KEY} 가 없다`);
    for (const p of ["public/app.js", "public/history.js", "public/saved.js"]) if (/localStorage|sessionStorage/.test(stripJs(read(p)))) bad.push(`${p} 가 저장소를 직접 만진다`);

    const hist = stripJs(read("public/history.js"));
    if (!/character:\s*"캐릭터"/.test(hist)) bad.push("history.js 라벨에 캐릭터가 없다");
    if (!hist.includes("tab=character")) bad.push("다시 묻기 링크가 탭을 안 넘긴다");

    // DOM 스텁으로 순수 함수를 직접 부른다
    installDom();
    const { tabStore, characterStructure, sourceLine } = await import("../public/ui.js");
    const mem = new Map();
    const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const store = tabStore(fake);
    if (store.read() !== "palette") bad.push(`빈 저장소에서 ${store.read()} (기대 palette)`);
    store.write("character");
    if (mem.get(TAB_KEY) !== "character" || store.read() !== "character") bad.push("탭 저장·읽기가 안 된다");
    store.write("purple");
    if (mem.get(TAB_KEY) !== "character") bad.push("모르는 탭 값을 저장했다");
    mem.set(TAB_KEY, "purple");
    if (store.read() !== "palette") bad.push("저장된 이상한 값을 믿었다");
    const throwing = { getItem: () => { throw new Error("막힘"); }, setItem: () => { throw new Error("막힘"); } };
    const t = tabStore(throwing);
    if (t.read() !== "palette") bad.push("던지는 저장소에서 안 돈다");
    t.write("character");

    const sample = {
      query: "q", parse: { parts: {}, creature: null, impression: "차가운 기사", from: "fallback" },
      palette: { id: "pair-01", name: "세이지그린 × 연분홍", from: "search" },
      colors: ROLES.map((role, i) => ({ role, hex: `#${(i + 1).toString(16).repeat(6)}`, name: role, source: i < 2 ? "spoken" : "rule", basis: "#111111" })),
    };
    const st = characterStructure(sample);
    if (st.id !== "character" || st.colors?.length !== 6 || st.colors[0].role !== "피부" || typeof st.name !== "string" || typeof st.principle !== "string") bad.push(`characterStructure: ${JSON.stringify({ id: st.id, n: st.colors?.length })}`);
    if (!st.source?.includes("세이지그린 × 연분홍")) bad.push("구조 source 에 배색 쌍 이름이 없다");
    const line = sourceLine(sample.colors);
    if (!line || line.childElementCount !== 6) bad.push("출처 줄이 여섯이 아니다");
    if (!/말한 색/.test(line.textContent) || !/규칙/.test(line.textContent)) bad.push(`출처 줄 문구: ${line.textContent}`);
    if (/LLM|llm/.test(line.textContent)) bad.push("출처 줄에 LLM");
    if (bad.length) throw new Error(bad.join(" / "));
    out("탭 셋(순서 고정) · /api/character · 저장소 한 곳 · tabStore 불신 · 내역 라벨 · structureCard 재사용 · 출처 줄");
    out("S34_G9_OK");
  },

  "S34-G10": async () => {
    const targets = [];
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage4.mjs", `S4-G${i}`]);
    for (let i = 1; i <= 11; i += 1) targets.push(["scripts/check-stage16.mjs", `S16-G${i}`]);
    for (let i = 1; i <= 12; i += 1) targets.push(["scripts/check-stage17.mjs", `S17-G${i}`]);
    for (let i = 1; i <= 13; i += 1) targets.push(["scripts/check-stage18.mjs", `S18-G${i}`]);
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage20.mjs", `S20-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage22.mjs", `S22-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage23.mjs", `S23-G${i}`]);
    for (let i = 1; i <= 3; i += 1) targets.push(["scripts/check-stage31.mjs", `S31-G${i}`]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S34_G10_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage34.mjs <${Object.keys(GATES).join("|")}>`);
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
