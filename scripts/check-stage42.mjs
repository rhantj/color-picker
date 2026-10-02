#!/usr/bin/env node
// 42단계(문장 → 의도 → 색) 완료 조건 검사기.
//   node scripts/check-stage42.mjs S42-G1
//
// 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md
// 가짜 Claude 는 scripts/lib/stub-apis.mjs — 서버가 **실제로 보낸 요청 본문**을 기록한다. 진짜 API 는 부르지 않는다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStubApis } from "./lib/stub-apis.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

const C = await import("../src/compose.js");
const { hexToOklch, oklchToHex, hueDistance } = await import("../src/oklch.js");
const { contrast } = await import("../public/color.js");
const { ratioFor } = await import("../public/ratio.js");

const HUE_IDS = Object.keys(C.HUES);
const TONE_IDS = Object.keys(C.TONES);
const CONTRAST_IDS = Object.keys(C.CONTRASTS);
const HEX = /^#[0-9A-F]{6}$/;

/** 검사에 쓰는 의도 하나. 뼈대(kind · base)를 늘 채운다. */
const intentOf = (over = {}) => C.parseIntent({ kind: "palette", usage: "general", count: 5, base: { hues: ["blue"], tone: "soft" }, accent: null, temperature: "neutral", contrast: "medium", avoid: [], reading: "", ...over });

/** UI · 일반 전 조합 — 색상 13 × 톤 12 × 대비 3 × 색 수 5. 포인트는 없음과 결정적으로 돌린 하나. */
function* grid(usage) {
  let i = 0;
  for (const hue of HUE_IDS)
    for (const tone of TONE_IDS)
      for (const contrastId of CONTRAST_IDS)
        for (let count = C.COUNT_MIN; count <= C.COUNT_MAX; count++) {
          i++;
          const accentHue = HUE_IDS[(i * 5) % HUE_IDS.length];
          const accent = accentHue === hue ? null : { hue: accentHue, tone: TONE_IDS[(i * 7) % TONE_IDS.length] };
          yield intentOf({ usage, count, contrast: contrastId, base: { hues: [hue], tone }, accent: null });
          if (accent) yield intentOf({ usage, count, contrast: contrastId, base: { hues: [hue], tone }, accent });
        }
}

const SAMPLES = [
  { usage: "general", count: 5, base: { hues: ["blue", "neutral"], tone: "grayish" }, accent: { hue: "orange", tone: "vivid" }, temperature: "cool", contrast: "low" },
  { usage: "ui", count: 5, base: { hues: ["teal"], tone: "light" }, accent: { hue: "orange", tone: "vivid" }, contrast: "medium" },
  { usage: "ui", count: 7, base: { hues: ["indigo"], tone: "dark" }, accent: { hue: "yellow", tone: "vivid" }, contrast: "high" },
  { usage: "illustration", count: 6, base: { hues: ["orange", "green"], tone: "soft" }, temperature: "warm", contrast: "high", avoid: ["blue"] },
  { usage: "brand", count: 3, base: { hues: ["purple", "pink", "neutral"], tone: "deep" }, accent: { hue: "yellow", tone: "bright" } },
].map((s) => intentOf(s));

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
      OLLAMA_AUTOSTART: "0",
      OLLAMA_WARMUP: "0",
      EMBED_PREPARE: "0",
      OLLAMA_HOST: "127.0.0.1:1",
      LLM_MAX_RETRIES: "0",
      ...env,
      // 가짜 Claude 의 env 는 OLLAMA_HOST 를 비운다 — 그러면 이 PC 의 진짜 Ollama 로 간다. 닿지 않는 주소로 묶는다.
      OLLAMA_HOST: env.OLLAMA_HOST || "127.0.0.1:1",
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
      return { status: res.status, json: await res.json().catch(() => null), text: res.status === 200 && path.startsWith("/api/export") ? await res.clone().text().catch(() => "") : "" };
    };
    return await fn(api);
  } finally {
    child.kill();
  }
}

/** 가짜 Claude 가 받은 요청이 무엇을 묻는가 — 스키마 속성으로 가른다. */
const kindOf = (body) => {
  const p = body?.output_config?.format?.schema?.properties ?? {};
  if (p.usage && p.base) return "intent";
  if (p.terms) return "rewrite";
  return "other";
};

/** 가짜 Claude — 의도 질문에는 `intentReply`, 재작성 질문에는 팔레트 재작성어. */
const stubWith = (intentReply) =>
  startStubApis({
    reply: (body) => (kindOf(body) === "intent" ? JSON.stringify(intentReply) : kindOf(body) === "rewrite" ? JSON.stringify({ intent: "palette", terms: ["봄", "파스텔"] }) : "{}"),
  });

const GOOD = { kind: "palette", usage: "ui", count: 5, base: { hues: ["blue"], tone: "strong" }, accent: { hue: "orange", tone: "vivid" }, temperature: "cool", contrast: "high", avoid: ["red"], reading: "신뢰감 있는 파랑에 주황 포인트" };

const GATES = {
  /** 같은 의도 → 같은 헥스. 같은 프로세스 두 번 + **다른 프로세스**(색상각별 기억 같은 상태가 결과를 바꾸지 않는가). */
  "S42-G1": async () => {
    const bad = [];
    const once = SAMPLES.map((it) => C.composeAll(it).map((p) => p.colors.map((c) => c.hex)));
    const twice = SAMPLES.map((it) => C.composeAll(it).map((p) => p.colors.map((c) => c.hex)));
    if (JSON.stringify(once) !== JSON.stringify(twice)) bad.push("같은 프로세스에서 두 번 부른 결과가 다르다");
    // 다른 프로세스는 순서를 뒤집어 부른다 — 먼저 계산한 것이 뒤의 결과를 바꾸면(기억 오염) 여기서 갈린다.
    const script = `const C = await import(${JSON.stringify(new URL("../src/compose.js", import.meta.url).href)});
const S = ${JSON.stringify(SAMPLES)};
const r = S.map((it) => C.composeAll(it).map((p) => p.colors.map((c) => c.hex))).reverse().reverse();
const rev = [...S].reverse().map((it) => C.composeAll(it).map((p) => p.colors.map((c) => c.hex))).reverse();
process.stdout.write(JSON.stringify([r, rev]));`;
    const printed = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      child.stdout.on("data", (c) => (text += c));
      child.on("close", () => resolve(text));
    });
    let other;
    try {
      other = JSON.parse(printed);
    } catch {
      return [`다른 프로세스의 출력을 못 읽었다: ${printed.slice(0, 200)}`];
    }
    if (JSON.stringify(other[0]) !== JSON.stringify(once)) bad.push("다른 프로세스에서 같은 의도가 다른 색을 냈다");
    if (JSON.stringify(other[1]) !== JSON.stringify(once)) bad.push("부르는 순서를 뒤집으니 색이 바뀌었다 — 기억된 상태가 결과에 샌다");
    return bad;
  },

  /** 색을 지어내지 않는다 — 스키마에 헥스 칸이 없고, 모델이 헥스를 섞어 보내도 결과가 같다. 엔진에 상수 헥스가 없다. */
  "S42-G2": async () => {
    const bad = [];
    const { INTENT_SCHEMA } = await import("../src/intent.js");
    // 문자열 칸은 전부 enum 이어야 한다 — 예외는 reading(설명 한 줄) 하나. 자유 문자열이 늘면 거기로 헥스가 들어온다.
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "string" && !node.enum && path !== "reading") bad.push(`자유 문자열 칸이 있다: ${path}`);
      if (node.type === "object" && node.additionalProperties !== false) bad.push(`${path || "(최상위)"} 에 additionalProperties:false 가 없다`);
      for (const [k, v] of Object.entries(node.properties ?? {})) walk(v, path ? `${path}.${k}` : k);
      if (node.items) walk(node.items, `${path}[]`);
      for (const v of node.anyOf ?? []) walk(v, path);
    };
    walk(INTENT_SCHEMA, "");
    if (/hex|rgb|color/i.test(JSON.stringify(Object.keys(INTENT_SCHEMA.properties)))) bad.push("스키마 최상위 칸 이름에 hex/rgb/color 가 있다");

    // 헥스를 섞은 답 — 검증이 버리고 결과가 같아야 한다.
    const clean = C.parseIntent(GOOD);
    const dirty = C.parseIntent({ ...GOOD, hex: "#FF0000", colors: ["#00FF00"], base: { ...GOOD.base, hex: "#0000FF" }, accent: { ...GOOD.accent, hex: "#123456" } });
    if (JSON.stringify(clean) !== JSON.stringify(dirty)) bad.push("헥스를 섞은 의도가 깨끗한 의도와 다르게 검증됐다");
    const a = C.composeAll(clean).flatMap((p) => p.colors.map((c) => c.hex));
    const b = C.composeAll(dirty).flatMap((p) => p.colors.map((c) => c.hex));
    if (a.join() !== b.join()) bad.push("헥스를 섞은 의도가 다른 색을 냈다");
    for (const hex of ["#FF0000", "#00FF00", "#0000FF", "#123456"]) if (a.includes(hex)) bad.push(`모델이 섞은 ${hex} 가 결과에 나왔다`);

    // 엔진 · 해석기 본문에 상수 헥스가 없다(주석 제외).
    for (const file of ["src/compose.js", "src/intent.js", "src/oklch.js"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
      const hit = code.match(/#[0-9a-fA-F]{6}\b/);
      if (hit) bad.push(`${file} 에 상수 헥스 ${hit[0]}`);
    }
    return bad;
  },

  /** 검증 — 모르는 값 · 범위 밖 · 타입 위장 · 프로토타입 키를 버린다. 뼈대가 없으면 null. */
  "S42-G3": async () => {
    const bad = [];
    const P = (v) => C.parseIntent(v);
    const base = { kind: "palette", base: { hues: ["blue"], tone: "vivid" } };
    const expect = (label, got, want) => {
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`);
    };
    for (const v of [null, undefined, 5, "x", [], ["palette"], { intent: "palette", terms: ["a"] }, { kind: "palette" }, { base: {} }, { kind: "maybe", base: {} }, { kind: "palette", base: [] }])
      if (P(v) !== null) bad.push(`뼈대가 없는 ${JSON.stringify(v)} 이 통과했다`);
    expect("JSON 문자열", P(JSON.stringify(base))?.base, { hues: ["blue"], tone: "vivid" });
    expect("모르는 색상", P({ ...base, base: { hues: ["blue", "chartreuse", 7, ["red"]], tone: "vivid" } })?.base.hues, ["blue"]);
    expect("겹친 색상 · 넷 이상", P({ ...base, base: { hues: ["red", "red", "blue", "green", "teal"], tone: "vivid" } })?.base.hues, ["red", "blue", "green"]);
    expect("모르는 톤", P({ ...base, base: { hues: ["blue"], tone: "neon" } })?.base.tone, "soft");
    expect("빈 색상", P({ ...base, base: { hues: [], tone: "vivid" } })?.base.hues, ["neutral"]);
    for (const [label, count] of [["2", 2], ["8", 8], ["5.5", 5.5], ["문자열", "4"], ["배열", [4]], ["NaN", NaN]]) expect(`개수 ${label}`, P({ ...base, count })?.count, 5);
    expect("개수 7", P({ ...base, count: 7 })?.count, 7);
    expect("쓰임새 위장 [\"ui\"]", P({ ...base, usage: ["ui"] })?.usage, "general");
    expect("쓰임새 __proto__", P({ ...base, usage: "__proto__" })?.usage, "general");
    expect("톤 toString", P({ ...base, base: { hues: ["blue"], tone: "toString" } })?.base.tone, "soft");
    expect("대비 constructor", P({ ...base, contrast: "constructor" })?.contrast, "medium");
    expect("포인트 모르는 색", P({ ...base, accent: { hue: "gold", tone: "vivid" } })?.accent, null);
    expect("포인트 톤 없음", P({ ...base, accent: { hue: "orange" } })?.accent, { hue: "orange", tone: "vivid" });
    expect("뺄 색이 바탕에서 빠짐", P({ ...base, base: { hues: ["blue", "red"], tone: "vivid" }, avoid: ["red"] })?.base.hues, ["blue"]);
    expect("뺄 색이 포인트를 지움", P({ ...base, accent: { hue: "red", tone: "vivid" }, avoid: ["red"] })?.accent, null);
    expect("뺄 색에 무채색 없음", P({ ...base, avoid: ["neutral", "red"] })?.avoid, ["red"]);
    expect("설명 제어 문자 · 길이", P({ ...base, reading: "‮ab\u0007c" + "가".repeat(200) })?.reading, ("abc" + "가".repeat(200)).slice(0, C.READING_MAX));
    expect("설명이 문자열 아님", P({ ...base, reading: { toString: () => "x" } })?.reading, "");
    // 프로토타입 키로 오염되지 않는다.
    const polluted = P(JSON.parse('{"kind":"palette","base":{"hues":["blue"],"tone":"vivid"},"__proto__":{"usage":"ui","count":7}}'));
    expect("__proto__ 키", [polluted?.usage, polluted?.count], ["general", 5]);
    if ({}.usage !== undefined) bad.push("Object.prototype 이 오염됐다");
    return bad;
  },

  /** 개수 — 결과 색 수 = count, 면적은 정수 · 합 100 · 하한 이상이고 카드(ratioFor)가 그 면적을 쓴다. */
  "S42-G4": async () => {
    const bad = [];
    const { shareBounds } = await import("../public/ratio.js");
    for (const usage of Object.keys(C.USAGES))
      for (let count = C.COUNT_MIN; count <= C.COUNT_MAX; count++)
        for (const accent of [null, { hue: "orange", tone: "vivid" }]) {
          const it = intentOf({ usage, count, accent });
          for (const p of C.composeAll(it)) {
            const label = `${usage} ${count}색 포인트 ${accent ? "있음" : "없음"} ${p.name}`;
            if (p.colors.length !== count) bad.push(`${label}: 색이 ${p.colors.length}개`);
            if (p.shares.length !== count) bad.push(`${label}: 면적이 ${p.shares.length}칸`);
            if (p.shares.reduce((a, b) => a + b, 0) !== 100) bad.push(`${label}: 면적 합 ${p.shares.reduce((a, b) => a + b, 0)}`);
            if (!p.shares.every((s) => Number.isInteger(s) && s >= shareBounds(count).min)) bad.push(`${label}: 면적 ${p.shares}`);
            if (new Set(p.colors.map((c) => c.role)).size !== count) bad.push(`${label}: 역할 이름이 겹친다`);
            if (JSON.stringify(ratioFor(p)) !== JSON.stringify(p.shares)) bad.push(`${label}: 카드가 엔진 면적을 안 쓴다 (${ratioFor(p)})`);
          }
        }
    // 모양이 틀린 면적은 카드가 안 쓴다 — 균등으로 물러선다.
    const colors = [{ hex: "#000000" }, { hex: "#111111" }, { hex: "#222222" }];
    for (const shares of [[50, 50], [90, 5, 5], [40, 30, 31], ["40", 30, 30], [33.4, 33.3, 33.3]])
      if (JSON.stringify(ratioFor({ colors, shares })) !== JSON.stringify([34, 33, 33])) bad.push(`틀린 면적 ${JSON.stringify(shares)} 을 카드가 썼다`);
    return bad;
  },

  /** 뺄 색 — 어느 칸도 뺄 색상각 ±20° 안에서 C 0.04 를 안 넘는다(바탕 색상이 이웃이어도, 대담안이 색상을 벌려도). */
  "S42-G5": async () => {
    const bad = [];
    let checked = 0;
    for (const avoidId of HUE_IDS.filter((h) => h !== "neutral"))
      for (const hue of HUE_IDS.filter((h) => h !== avoidId))
        for (const usage of ["general", "ui"])
          for (const tone of ["vivid", "soft", "deep"]) {
            const it = intentOf({ usage, count: 6, base: { hues: [hue], tone }, accent: { hue: HUE_IDS[(HUE_IDS.indexOf(hue) + 1) % HUE_IDS.length], tone: "vivid" }, avoid: [avoidId] });
            for (const p of C.composeAll(it))
              for (const c of p.colors) {
                checked++;
                const o = hexToOklch(c.hex);
                if (o.c > C.AVOID_CHROMA && hueDistance(o.h, C.HUES[avoidId]) < C.AVOID_BAND)
                  bad.push(`뺄 색 ${avoidId}: ${usage} ${hue} ${tone} ${p.name} ${c.role} ${c.hex} (h ${o.h.toFixed(0)} · C ${o.c.toFixed(3)})`);
              }
          }
    if (checked < 1000) bad.push(`검사한 색이 ${checked}개뿐이다 — 헛돌고 있다`);
    return bad.slice(0, 20);
  },

  /** 포인트 — 일반은 포인트가 가장 선명하고, UI 는 강조가 바탕 · 면 · 테두리 · 본문보다 선명하다. */
  "S42-G6": async () => {
    const bad = [];
    let checked = 0;
    for (const usage of ["general", "ui"])
      for (const it of grid(usage)) {
        if (usage === "general" && (!it.accent || C.HUES[it.accent.hue] === null)) continue;
        if (usage === "ui" && it.accent && C.HUES[it.accent.hue] === null) continue;
        if (usage === "ui" && !it.accent && C.HUES[it.base.hues[0]] === null) continue;
        for (const p of C.composeAll(it)) {
          const accentRole = usage === "ui" ? "강조" : "강조색";
          const accent = p.colors.find((c) => c.role === accentRole);
          const ac = hexToOklch(accent.hex).c;
          if (ac < C.NEUTRAL_ACCENT_C) continue; // 사실상 무채색 포인트 — 누르지 않는 것이 규칙이다
          const pressed = usage === "ui" ? ["바탕", "면", "테두리", "본문"] : p.colors.map((c) => c.role).filter((r) => r !== accentRole);
          for (const c of p.colors.filter((x) => pressed.includes(x.role))) {
            checked++;
            const cc = hexToOklch(c.hex).c;
            if (cc >= ac) bad.push(`${usage} ${it.base.hues[0]} ${it.base.tone} 포인트 ${it.accent?.hue ?? "-"} ${it.accent?.tone ?? ""} ${p.name}: ${c.role} ${c.hex} C ${cc.toFixed(3)} ≥ ${accent.hex} C ${ac.toFixed(3)}`);
          }
        }
      }
    if (checked < 5000) bad.push(`검사한 색이 ${checked}개뿐이다 — 헛돌고 있다`);
    return bad.slice(0, 20);
  },

  /** UI 대비 — 본문/바탕 ≥ 4.5 · 주색 · 보조 · 강조/바탕 ≥ 3. 색상 13 × 톤 12 × 대비 3 × 색 수 5 × 3안 × 포인트 유무. */
  "S42-G7": async () => {
    const bad = [];
    let checked = 0;
    for (const it of grid("ui"))
      for (const p of C.composeAll(it)) {
        const bg = p.colors.find((c) => c.role === "바탕");
        if (!bg) {
          bad.push(`UI ${it.count}색에 바탕이 없다`);
          continue;
        }
        for (const c of p.colors) {
          const min = c.role === "본문" ? C.UI_TEXT_MIN : ["주색", "보조", "강조"].includes(c.role) ? C.UI_COMPONENT_MIN : 0;
          if (!min) continue;
          checked++;
          const r = contrast(c.hex, bg.hex);
          if (r < min) bad.push(`${it.base.hues[0]} ${it.base.tone} ${it.contrast} ${it.count}색 포인트 ${it.accent?.hue ?? "-"} ${p.name}: ${c.role} ${c.hex} / 바탕 ${bg.hex} = ${r.toFixed(2)} < ${min}`);
        }
      }
    if (checked < 20000) bad.push(`검사한 짝이 ${checked}개뿐이다 — 헛돌고 있다`);
    return bad.slice(0, 20);
  },

  /** 화면 안 — 모든 결과가 #RRGGBB 이고, OKLCH 변환이 sRGB 를 왕복한다(4096색 격자). */
  "S42-G8": async () => {
    const bad = [];
    for (const usage of ["general", "ui"])
      for (const it of grid(usage))
        for (const p of C.composeAll(it)) for (const c of p.colors) if (!HEX.test(c.hex)) bad.push(`${c.role} ${c.hex} 이 #RRGGBB 가 아니다`);
    let mismatch = 0;
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 17)
        for (let b = 0; b < 256; b += 17) {
          const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
          if (oklchToHex(hexToOklch(hex)) !== hex) mismatch++;
        }
    if (mismatch) bad.push(`sRGB 격자 4096색 중 ${mismatch}색이 OKLCH 왕복에서 바뀐다`);
    return bad.slice(0, 20);
  },

  /** 3안이 다르다 — 유채색 바탕이면 세 안이 나오고 서로 다르다. 어떤 의도에서도 같은 안이 두 번 나오지 않는다. */
  "S42-G9": async () => {
    const bad = [];
    for (const usage of ["general", "ui"])
      for (const it of grid(usage)) {
        const ps = C.composeAll(it);
        const keys = ps.map((p) => p.colors.map((c) => c.hex).join());
        if (new Set(keys).size !== keys.length) bad.push(`${usage} ${it.base.hues[0]} ${it.base.tone}: 같은 안이 두 번 나왔다`);
        const chromatic = C.HUES[it.base.hues[0]] !== null && !["light-grayish", "grayish", "dark-grayish"].includes(it.base.tone);
        if (chromatic && ps.length !== 3) bad.push(`${usage} ${it.base.hues[0]} ${it.base.tone} ${it.contrast} ${it.count}색: 안이 ${ps.length}개(${ps.map((p) => p.name)})`);
        if (ps[0]?.name !== "충실") bad.push(`${usage}: 첫 안이 ${ps[0]?.name} (충실이어야)`);
      }
    return bad.slice(0, 20);
  },

  /** 경로 — 추천은 의도를 부르고 generated 를 낸다 · 진단으로 읽히면 옛 검색 · 색과 무관하면 되묻기 · Claude 실패면 옛 검색. 사용자 문장은 user 자리에만. */
  "S42-G10": async () => {
    const bad = [];
    const Q = "신뢰감 있는 핀테크 대시보드, 빨강은 빼줘";
    // (1) 정상 — generated
    let stub = await stubWith(GOOD);
    try {
      await withServer(4421, stub.env, async (api) => {
        const r = (await api("/api/chat", { text: Q })).json;
        const p = r?.turn?.payload;
        if (r?.turn?.kind !== "answer" || r?.turn?.route !== "palette") bad.push(`정상: 턴이 ${r?.turn?.kind}/${r?.turn?.route}`);
        if (p?.kind !== "generated") bad.push(`정상: payload.kind=${p?.kind} (generated 여야)`);
        if (p?.palettes?.length !== 3) bad.push(`정상: 안이 ${p?.palettes?.length}개`);
        const want = C.composeAll(C.parseIntent(GOOD)).map((x) => x.colors.map((c) => c.hex).join());
        if (JSON.stringify(p?.palettes?.map((x) => x.colors.map((c) => c.hex).join())) !== JSON.stringify(want)) bad.push("정상: 서버 색이 엔진 계산과 다르다");
        if (p?.reading !== GOOD.reading) bad.push(`정상: reading 이 모델 답과 다르다 (${p?.reading})`);
        if (!Array.isArray(p?.read) || !p.read.some((x) => x.includes("뺀 색 빨강"))) bad.push(`정상: 읽은 칸에 "뺀 색 빨강" 이 없다 (${p?.read})`);
      });
      const asks = stub.messages.filter((m) => kindOf(m.body) === "intent");
      if (asks.length !== 1) bad.push(`정상: 의도 질문이 ${asks.length}번 갔다 (1번이어야)`);
      if (stub.messages.some((m) => kindOf(m.body) === "rewrite")) bad.push("정상: 의도를 읽었는데 재작성(옛 검색)도 불렀다");
      const m = asks[0]?.body;
      if (m) {
        if (m.messages?.[0]?.role !== "user" || m.messages[0].content !== Q) bad.push("정상: 사용자 문장이 user 자리에 그대로 없다");
        if (typeof m.system !== "string" || m.system.includes(Q)) bad.push("정상: 사용자 문장이 시스템 프롬프트에 섞였다");
        if (m.output_config?.format?.type !== "json_schema") bad.push("정상: 구조화 출력이 아니다");
      }
    } finally {
      stub.close();
    }

    // (2) 진단으로 읽힘 — 옛 검색 경로(payload 에 kind 없음, 진단표를 찾는 길).
    // **라우터가 추천으로 보내는 문장이어야 한다.** 처음엔 "칙칙하고 탁해 보여요" 를 썼는데 라우터가 별칭으로 먼저 진단에 보내
    // Claude 까지 오지 않았고, "진단도 새 팔레트로 낸다" 는 변형이 살아남았다(변형 검사). 그래서 의도 질문이 갔는지도 본다.
    stub = await stubWith({ ...GOOD, kind: "diagnosis" });
    try {
      await withServer(4422, stub.env, async (api) => {
        const p = (await api("/api/chat", { text: "내가 만든 포스터 색 조합이 어딘가 어색해" })).json?.turn?.payload;
        if (!p || p.kind === "generated") bad.push(`진단: 옛 검색으로 안 갔다 (kind=${p?.kind})`);
      });
      if (!stub.messages.some((m) => kindOf(m.body) === "intent")) bad.push("진단: 의도 질문이 안 갔다 — 라우터가 먼저 보냈다, 이 검사가 헛돈다");
    } finally {
      stub.close();
    }

    // (2b) 라우터는 진단 · Claude 는 팔레트 — 팔레트로 답한다("차분" 이 진단 별칭이다). "포인트는 ○○" 는 캐릭터로 안 간다.
    stub = await stubWith(GOOD);
    try {
      await withServer(4428, stub.env, async (api) => {
        const t = (await api("/api/chat", { text: "비 오는 날 오래된 서점, 차분한데 포인트는 주황" })).json?.turn;
        if (t?.route !== "palette" || t?.payload?.kind !== "generated") bad.push(`진단 별칭 문장: ${t?.kind}/${t?.route} kind=${t?.payload?.kind} (팔레트 generated 여야)`);
        const u = (await api("/api/chat", { text: "핀테크 앱 대시보드 5색, 신뢰감 있게, 포인트는 주황", fresh: true })).json?.turn;
        if (u?.route !== "palette" || u?.payload?.kind !== "generated") bad.push(`"포인트는 주황": ${u?.kind}/${u?.route} (팔레트여야 — 캐릭터 강조 부위가 아니다)`);
      });
    } finally {
      stub.close();
    }
    // 같은 진단 별칭 문장을 Claude 도 진단으로 읽으면 옛 진단 검색 그대로
    stub = await stubWith({ ...GOOD, kind: "other" });
    try {
      await withServer(4429, stub.env, async (api) => {
        const t = (await api("/api/chat", { text: "전체적으로 너무 칙칙하고 탁해 보여요" })).json?.turn;
        if (t?.kind !== "answer" || t?.payload?.kind === "generated") bad.push(`진단 문장 · Claude 무관: ${t?.kind}/${t?.route} kind=${t?.payload?.kind} (옛 진단 검색이어야)`);
      });
    } finally {
      stub.close();
    }

    // (3) 색과 무관 — 되묻기
    stub = await stubWith({ ...GOOD, kind: "other" });
    try {
      await withServer(4423, stub.env, async (api) => {
        const t = (await api("/api/chat", { text: "오늘 점심 뭐 먹지" })).json?.turn;
        if (t?.kind !== "ask" || t?.reason !== "unclear") bad.push(`무관: 되묻지 않았다 (${t?.kind}/${t?.reason})`);
      });
    } finally {
      stub.close();
    }

    // (4) 모델이 의도가 아닌 것을 줌 — 옛 검색으로
    stub = await stubWith({ intent: "palette", terms: ["봄"] });
    try {
      await withServer(4424, stub.env, async (api) => {
        const p = (await api("/api/chat", { text: "봄 파스텔" })).json?.turn?.payload;
        if (!p || p.kind === "generated") bad.push(`엉뚱한 답: 옛 검색으로 안 갔다 (kind=${p?.kind})`);
      });
    } finally {
      stub.close();
    }

    // (5) 키 없음 — 옛 검색으로, 가짜 Claude 는 0번
    stub = await stubWith(GOOD);
    try {
      await withServer(4425, { ...stub.env, ANTHROPIC_API_KEY: "" }, async (api) => {
        const p = (await api("/api/chat", { text: "봄 파스텔" })).json?.turn?.payload;
        if (!p || p.kind === "generated") bad.push(`키 없음: 옛 검색으로 안 갔다 (kind=${p?.kind})`);
      });
      if (stub.messages.length) bad.push(`키 없음: 가짜 Claude 가 ${stub.messages.length}번 불렸다`);
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 저장 — 의도 · 안 번호로만 저장되고 서버가 다시 계산한다. 거짓 색 무시 · 덮어쓰기와 이어받기 · 불량 입력 400 · 내보내기. */
  "S42-G11": async () => {
    const bad = [];
    const stub = await stubWith(GOOD);
    try {
      await withServer(4426, stub.env, async (api) => {
        const want = C.compose(C.parseIntent(GOOD), 2);
        const first = await api("/api/saved/generated", { intent: GOOD, variant: 2, query: "핀테크", colors: [{ role: "바탕", hex: "#FF0000" }], note: "첫 메모" });
        if (first.status !== 200) bad.push(`저장이 ${first.status}: ${first.json?.error}`);
        const e = first.json;
        if (JSON.stringify(e?.colors?.map((c) => c.hex)) !== JSON.stringify(want.colors.map((c) => c.hex))) bad.push(`저장 색이 엔진 재계산과 다르다 (${e?.colors?.map((c) => c.hex)})`);
        if (e?.colors?.some((c) => c.hex === "#FF0000")) bad.push("화면이 보낸 거짓 색이 저장됐다");
        if (JSON.stringify(e?.defaultRatio) !== JSON.stringify(want.shares)) bad.push(`기본 면적이 엔진 면적과 다르다 (${e?.defaultRatio})`);
        if (e?.kind !== "derived" || e?.structureId !== "generated") bad.push(`항목 모양이 ${e?.kind}/${e?.structureId}`);
        if (e?.generated?.variant !== 2 || e?.generated?.intent?.usage !== "ui") bad.push("다시 계산할 근거(의도 · 안 번호)가 항목에 없다");
        for (const role of want.colors.map((c) => c.role)) if (typeof e?.finishes?.[role] !== "string") bad.push(`${role} 의 재질 기본값이 없다`);

        // 같은 의도 · 같은 안 — 덮어쓰기, 메모 이어받기, 비율 반영. reading 만 다른 의도도 같은 항목이다.
        const shares = want.shares.map((s, i) => (i === 0 ? s + 5 : i === 1 ? s - 5 : s)); // 둘째 칸(21)에서 덜어 하한 10 을 지킨다
        const second = await api("/api/saved/generated", { intent: { ...GOOD, reading: "다른 설명" }, variant: 2, shares });
        if (second.status !== 200) bad.push(`다시 저장이 ${second.status}: ${second.json?.error}`);
        if (second.json?.note !== "첫 메모") bad.push(`메모를 이어받지 않았다 (${second.json?.note})`);
        if (JSON.stringify(second.json?.colors?.map((c) => c.ratio)) !== JSON.stringify(shares)) bad.push("보낸 비율이 안 실렸다");
        // 다른 안은 다른 항목
        await api("/api/saved/generated", { intent: GOOD, variant: 0 });
        const list = (await api("/api/saved")).json;
        const items = (list?.saved ?? list ?? []).filter?.((x) => x.structureId === "generated") ?? [];
        if (items.length !== 2) bad.push(`저장 목록의 문장 팔레트가 ${items.length}개 (2개여야 — 같은 안은 덮어쓰기)`);

        // 불량 입력 — 전부 400
        const cases = [
          ["의도가 문자열", { intent: JSON.stringify(GOOD), variant: 0 }],
          ["의도가 배열", { intent: [GOOD], variant: 0 }],
          ["뼈대 없는 의도", { intent: { usage: "ui" }, variant: 0 }],
          ["안 번호 3", { intent: GOOD, variant: 3 }],
          ["안 번호 문자열", { intent: GOOD, variant: "0" }],
          ["안 번호 __proto__", { intent: GOOD, variant: "__proto__" }],
          ["면적 칸 수", { intent: GOOD, variant: 0, shares: [50, 50] }],
          ["면적 합", { intent: GOOD, variant: 0, shares: [20, 20, 20, 20, 21] }],
        ];
        for (const [label, body] of cases) {
          const r = await api("/api/saved/generated", body);
          if (r.status !== 400) bad.push(`${label}: ${r.status} (400 이어야)`);
        }

        // 엔진 내보내기에 실린다 — 새 역할 이름(주조색 · 주색 …)이 재질 표 등급으로 옮겨져야 한다.
        await api("/api/saved/generated", { intent: { ...GOOD, usage: "general" }, variant: 0 });
        const ex = await fetch(`http://127.0.0.1:4426/api/export?format=unreal`);
        const text = await ex.text();
        if (ex.status !== 200) bad.push(`내보내기가 ${ex.status}`);
        for (const role of ["주색", "주조색", "강조색"]) if (!text.includes(role)) bad.push(`엔진 내보내기에 ${role} 이 없다 — 문장 팔레트가 빠졌다`);
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 기록 — 내역 요약은 generated · LLM 사용으로 남고, 트레이스에 llm.intent 자식이 생긴다(키 없으면 안 생긴다). 화면이 새 블록을 그린다. */
  "S42-G12": async () => {
    const bad = [];
    const { readdirSync } = await import("node:fs");
    const stub = await stubWith(GOOD);
    const dir = gateDataDir();
    try {
      await withServer(4427, { ...stub.env, TONEFIRST_DATA_DIR: dir }, async (api) => {
        const r = (await api("/api/chat", { text: "핀테크 대시보드" })).json;
        const conv = (await api(`/api/conversations?id=${encodeURIComponent(r?.conversationId)}`)).json?.conversation;
        const t = conv?.turns?.at(-1);
        if (t?.topKind !== "generated" || t?.usedLlm !== true || t?.topLabel !== GOOD.reading) bad.push(`내역 요약이 ${JSON.stringify({ topKind: t?.topKind, usedLlm: t?.usedLlm, topLabel: t?.topLabel })}`);
      });
    } finally {
      stub.close();
    }
    const traceFile = readdirSync(dir).find((f) => f === "traces.jsonl");
    const traces = traceFile ? readFileSync(join(dir, traceFile), "utf8") : "";
    if (!traces.includes("llm.intent")) bad.push("트레이스에 llm.intent 자식 런이 없다");

    // 화면 — 추천 답이 generated 면 새 블록, 아니면 옛 검색 블록. 저장은 의도와 안 번호만 보낸다.
    const app = read("public/app.js");
    if (!/data\.kind === "generated" \? generatedBlock\(data\) : searchBlock\(data, original\)/.test(app)) bad.push("화면이 generated 를 새 블록으로 가르지 않는다");
    const save = app.match(/api\("\/api\/saved\/generated", \{([^}]*)\}/)?.[1] ?? "";
    if (!save.includes("intent") || !save.includes("variant")) bad.push(`화면 저장이 의도 · 안 번호를 안 보낸다: {${save}}`);
    if (/hex|colors/.test(save)) bad.push(`화면 저장이 색을 보낸다: {${save}}`);
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
