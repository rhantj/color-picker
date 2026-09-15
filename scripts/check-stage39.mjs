#!/usr/bin/env node
// 39단계(탭 통합 · 결정적 라우터 · 되묻기) 완료 조건 검사기.
//   node scripts/check-stage39.mjs S39-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 열 게이트가 전부 실패하는 것을 확인한 뒤에 src·public 을 고쳤다.
// 라우터 기대표는 대상에서 import 하지 않고 여기 사본으로 적는다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/* ── 사본: 라우터 기대표 ─────────────────────────────────────
   kind=route 면 routes 를, kind=redirect 면 route 를 본다. unclear 는 "character" 또는 false. */
const ROUTE_TABLE = [
  { text: "#E07A5F", routes: ["color"] },
  { text: "테라코타", routes: ["color"] },
  { text: "빨강", routes: ["color"] },
  { text: "빨강 어울리는 색", routes: ["palette"] },
  { text: "여름 화장품 브랜드", routes: ["palette"] },
  { text: "눈에 띄는 색", routes: ["palette"] },
  { text: "따뜻한데 촌스럽지 않은 색", routes: ["palette"] },
  { text: "탁해 보여요", routes: ["diagnosis"] },
  { text: "대시보드가 너무 요란해", routes: ["diagnosis"] },
  { text: "빨간 머리 도적", routes: ["character"] },
  { text: "금발 마법사", routes: ["character"] },
  { text: "상의는 갈색 하의는 검정", routes: ["character"] },
  { text: "도적 상의가 탁해", routes: ["character", "diagnosis"] },
  { text: "머리", routes: ["character"], unclear: "character" },
  { text: "색으로 봐줘", redirect: "color" },
  { text: "캐릭터로", redirect: "character" },
];
// 음성 = 그 경로가 아닌 것을 확인하는 행. 캐릭터가 아닌 행 + 진단이 아닌 행이 절반을 넘는다.
const NEGATIVE_MIN = Math.ceil(ROUTE_TABLE.length / 2);

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: env.TONEFIRST_DATA_DIR ?? gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", EMBED_PREPARE: "0", OLLAMA_HOST: "127.0.0.1:1", LANGSMITH_API_KEY: "", ...env },
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
const chat = async (port, body) => {
  const r = await post(port, "/api/chat", body);
  const text = await r.text();
  return { status: r.status, body: JSON.parse(text || "{}") };
};

/** LangSmith 흉내. 받은 요청을 전부 모은다. */
function fakeLangsmith() {
  const received = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ received, port: server.address().port, close: () => server.close() })));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function loadRouter() {
  const { createRouter } = await import("../src/route.js");
  const { loadCharacterWords } = await import("../src/color-words.js");
  const { loadDiagnostics } = await import("../src/diagnostics.js");
  const { loadSeeds } = await import("../src/seeds.js");
  const { loadPalettes } = await import("../src/palettes.js");
  const corpus = [...loadPalettes(), ...loadSeeds()].flatMap((p) => p.colors);
  return createRouter({ words: loadCharacterWords(), diagnostics: loadDiagnostics(), corpus });
}

const sameRoute = (got, row) => (row.redirect ? got.kind === "redirect" && got.route === row.redirect : got.kind === "route" && JSON.stringify(got.routes) === JSON.stringify(row.routes) && (got.unclear || false) === (row.unclear || false));

const GATES = {
  "S39-G1": async () => {
    const bad = [];
    const router = await loadRouter();
    for (const row of ROUTE_TABLE) {
      const got = router.route(row.text);
      if (!sameRoute(got, row)) bad.push(`${JSON.stringify(row.text)} → ${JSON.stringify(got)} (기대 ${JSON.stringify(row.redirect ?? row.routes)}${row.unclear ? " unclear" : ""})`);
    }
    const negatives = ROUTE_TABLE.filter((r) => !r.redirect && !r.routes.includes("character")).length;
    if (negatives < NEGATIVE_MIN) bad.push(`캐릭터가 아닌 행이 ${negatives}건 (최소 ${NEGATIVE_MIN})`);
    return bad;
  },

  "S39-G2": async () => {
    const bad = [];
    const router = await loadRouter();
    for (const row of ROUTE_TABLE) {
      const a = JSON.stringify(router.route(row.text));
      const b = JSON.stringify(router.route(row.text));
      if (a !== b) bad.push(`${row.text}: ${a} ≠ ${b}`);
    }
    const src = stripJs(read("src/route.js"));
    for (const word of ["fetch(", "readFileSync", "process.env", "Math.random", "Date.now"]) if (src.includes(word)) bad.push(`route.js 에 ${word} 가 있다 — 순수 함수가 아니다`);
    return bad;
  },

  "S39-G3": async () => {
    const bad = [];
    const port = 4491;
    const server = await startServer(port);
    try {
      const a1 = await chat(port, { text: "도적 상의가 탁해" });
      if (a1.status !== 200) bad.push(`1턴 ${a1.status}: ${JSON.stringify(a1.body)}`);
      const t1 = a1.body.turn ?? {};
      if (t1.kind !== "ask" || t1.reason !== "ambiguous") bad.push(`겹침이 ask 가 아니다: ${JSON.stringify(t1)}`);
      if (JSON.stringify((t1.choices ?? []).map((c) => c.id)) !== JSON.stringify(["character", "diagnosis"])) bad.push(`후보 ${JSON.stringify(t1.choices)}`);
      const conv = a1.body.conversationId;

      const a2 = await chat(port, { conversationId: conv, choice: "diagnosis" });
      const t2 = a2.body.turn ?? {};
      if (t2.kind !== "answer" || t2.route !== "diagnosis" || t2.original !== "도적 상의가 탁해") bad.push(`칩 답이 틀리다: ${JSON.stringify({ kind: t2.kind, route: t2.route, original: t2.original })}`);
      if (a2.body.conversationId !== conv) bad.push("칩 답이 대화를 바꿨다");

      // 다시 애매하게 — 새 대화에서 ask 를 받고, 문장으로 또 애매하게 답한다
      const b1 = await chat(port, { text: "도적 상의가 탁해" });
      const b2 = await chat(port, { conversationId: b1.body.conversationId, text: "눈이 요란해" });
      const u2 = b2.body.turn ?? {};
      if (u2.kind !== "answer") bad.push(`두 번째 애매한 답에 또 물었다: ${JSON.stringify(u2)}`);
      if (u2.route !== "character") bad.push(`두 번째 애매한 답이 첫 후보(character)가 아니다: ${u2.route}`);

      // 불명(부위만) → 이어 쓰면 캐릭터
      const c1 = await chat(port, { text: "머리" });
      const v1 = c1.body.turn ?? {};
      if (v1.kind !== "ask" || v1.reason !== "unclear" || v1.allowFreeText !== true) bad.push(`부위만 입력이 unclear ask 가 아니다: ${JSON.stringify(v1)}`);
      const c2 = await chat(port, { conversationId: c1.body.conversationId, text: "빨간" });
      const v2 = c2.body.turn ?? {};
      if (v2.kind !== "answer" || v2.route !== "character") bad.push(`이어 쓴 답이 character 가 아니다: ${JSON.stringify({ kind: v2.kind, route: v2.route })}`);
      if (!v2.payload?.colors) bad.push("character payload 에 colors 가 없다");
    } finally {
      server.kill();
    }
    return bad;
  },

  "S39-G4": async () => {
    const bad = [];
    const { LIMITS } = await import("../src/store.js");
    if (LIMITS.turnsPerConversation !== 10) bad.push(`turnsPerConversation 이 ${LIMITS.turnsPerConversation}`);
    const port = 4492;
    const server = await startServer(port);
    try {
      let conv = null;
      for (let i = 0; i < 10; i++) {
        const r = await chat(port, { conversationId: conv, text: `여름 화장품 브랜드 ${i}` });
        if (r.status !== 200) bad.push(`${i + 1}턴 ${r.status}`);
        if (conv && r.body.conversationId !== conv) bad.push(`${i + 1}턴에서 대화가 바뀌었다`);
        conv = r.body.conversationId;
      }
      const r11 = await chat(port, { conversationId: conv, text: "여름 화장품 브랜드 11" });
      if (r11.body.conversationId === conv) bad.push("11번째 턴이 새 대화로 안 갔다");
      const { conversations } = await (await fetch(`http://127.0.0.1:${port}/api/conversations`)).json();
      const old = conversations.find((c) => c.id === conv);
      if (!old || old.turns.length !== 10) bad.push(`옛 대화 턴 수 ${old?.turns.length}`);
    } finally {
      server.kill();
    }
    return bad;
  },

  "S39-G5": async () => {
    const bad = [];
    const fake = await fakeLangsmith();
    const port = 4493;
    const server = await startServer(port, { LANGSMITH_ENDPOINT: `http://127.0.0.1:${fake.port}`, LANGSMITH_API_KEY: "" });
    try {
      for (const text of ["#E07A5F", "탁해 보여요", "빨간 머리 도적", "도적 상의가 탁해"]) {
        const r = await chat(port, { text });
        if (r.status !== 200) bad.push(`${text}: ${r.status}`);
      }
      await settle(300);
      if (fake.received.length !== 0) bad.push(`키 없이 ${fake.received.length}건이 나갔다: ${fake.received.map((r) => r.url).join(",")}`);
    } finally {
      server.kill();
      fake.close();
    }
    return bad;
  },

  "S39-G6": async () => {
    const bad = [];
    const fake = await fakeLangsmith();
    const port = 4494;
    const server = await startServer(port, { LANGSMITH_ENDPOINT: `http://127.0.0.1:${fake.port}`, LANGSMITH_API_KEY: "test-key", LANGSMITH_PROJECT: "gate-39" });
    try {
      const r = await chat(port, { text: "도적 상의가 탁해" });
      if (r.status !== 200) bad.push(`응답 ${r.status}`);
      await settle(500);
      const runs = fake.received.filter((x) => x.method === "POST" && x.url.startsWith("/runs")).map((x) => ({ headers: x.headers, ...x.body }));
      const parent = runs.find((x) => x.name === "chat.turn");
      if (!parent) bad.push(`부모 런이 없다: ${runs.map((x) => x.name).join(",")}`);
      else {
        if (parent.headers["x-api-key"] !== "test-key") bad.push("x-api-key 가 없다");
        if (parent.session_name !== "gate-39") bad.push(`session_name ${parent.session_name}`);
        if (parent.trace_id !== parent.id) bad.push("부모의 trace_id 가 자기 id 가 아니다");
        if (!String(parent.dotted_order).endsWith(parent.id)) bad.push("부모 dotted_order 가 id 로 안 끝난다");
        for (const name of ["route", "ask"]) {
          const child = runs.find((x) => x.name === name);
          if (!child) bad.push(`자식 런 ${name} 이 없다`);
          else {
            if (child.parent_run_id !== parent.id) bad.push(`${name}.parent_run_id`);
            if (child.trace_id !== parent.id) bad.push(`${name}.trace_id`);
            if (!String(child.dotted_order).startsWith(parent.dotted_order + ".")) bad.push(`${name}.dotted_order`);
          }
        }
        const route = runs.find((x) => x.name === "route");
        if (JSON.stringify(route?.outputs?.routes) !== JSON.stringify(["character", "diagnosis"])) bad.push(`route.outputs ${JSON.stringify(route?.outputs)}`);
      }
    } finally {
      server.kill();
      fake.close();
    }
    // 죽은 엔드포인트여도 응답이 막히지 않는다
    const port2 = 4495;
    const server2 = await startServer(port2, { LANGSMITH_ENDPOINT: "http://127.0.0.1:9", LANGSMITH_API_KEY: "test-key" });
    try {
      const started = Date.now();
      const r = await chat(port2, { text: "#E07A5F" });
      const ms = Date.now() - started;
      if (r.status !== 200) bad.push(`죽은 엔드포인트에서 ${r.status}`);
      if (ms > 1000) bad.push(`죽은 엔드포인트에서 ${ms}ms`);
    } finally {
      server2.kill();
    }
    return bad;
  },

  "S39-G7": async () => {
    const bad = [];
    const dir = gateDataDir();
    const port = 4496;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const sample = ROUTE_TABLE.filter((r) => !r.redirect).slice(0, 6);
    try {
      for (const row of sample) await chat(port, { text: row.text });
      await settle(200);
    } finally {
      server.kill();
    }
    const file = join(dir, "traces.jsonl");
    if (!existsSync(file)) return [`${file} 이 없다`];
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    if (lines.length !== sample.length) bad.push(`줄 수 ${lines.length} (기대 ${sample.length})`);
    for (const [i, row] of sample.entries()) {
      const routeRun = lines[i]?.children?.find((c) => c.name === "route");
      if (JSON.stringify(routeRun?.outputs?.routes) !== JSON.stringify(row.routes)) bad.push(`${row.text}: 기록 ${JSON.stringify(routeRun?.outputs)}`);
    }
    return bad;
  },

  "S39-G8": async () => {
    const bad = [];
    const html = read("public/index.html");
    const app = stripJs(read("public/app.js"));
    const ui = stripJs(read("public/ui.js"));
    for (const word of ['role="tablist"', "data-tab-select", "tabpanel"]) if (html.includes(word)) bad.push(`index.html 에 ${word}`);
    if (!html.includes('<ol class="chat"')) bad.push("index.html 에 <ol class=\"chat\"> 이 없다");
    for (const word of ["RUN_BY_TAB", "tabStore", "asTab", "applyTab", "tab="]) {
      if (app.includes(word)) bad.push(`app.js 에 ${word}`);
      if (ui.includes(word)) bad.push(`ui.js 에 ${word}`);
    }
    if (!app.includes('"/api/chat"')) bad.push("app.js 가 /api/chat 을 안 부른다");
    if (app.includes("/api/conversations/turn")) bad.push("app.js 가 아직 /api/conversations/turn 을 부른다");
    for (const [name, text] of [["index.html", html], ["app.js", app]]) if (/LLM/.test(text)) bad.push(`${name} 에 "LLM"`);
    return bad;
  },

  "S39-G9": async () => {
    const bad = [];
    const port = 4497;
    const server = await startServer(port);
    try {
      const a = await chat(port, { text: "여름 화장품 브랜드" });
      const b = await chat(port, { conversationId: a.body.conversationId, text: "캐릭터로" });
      const t = b.body.turn ?? {};
      if (t.kind !== "answer" || t.route !== "character" || t.original !== "여름 화장품 브랜드") bad.push(`바로잡기: ${JSON.stringify({ kind: t.kind, route: t.route, original: t.original })}`);
      const c = await chat(port, { text: "색으로 봐줘" });
      const u = c.body.turn ?? {};
      if (u.kind === "answer" && u.original !== "색으로 봐줘") bad.push(`직전 답이 없는데 바로잡기로 갔다: ${JSON.stringify(u)}`);
    } finally {
      server.kill();
    }
    return bad;
  },

  "S39-G10": async () => {
    const targets = [
      ["scripts/check-stage4.mjs", 7],
      ["scripts/check-stage22.mjs", 6],
      ["scripts/check-stage34.mjs", 10],
      ["scripts/check-stage35.mjs", 6],
      ["scripts/check-stage36.mjs", 5],
    ];
    const bad = [];
    for (const [script, count] of targets) {
      const stage = script.match(/stage(\d+)/)[1];
      for (let i = 1; i <= count; i++) {
        const r = await runChecker(script, `S${stage}-G${i}`);
        if (!r.ok) bad.push(`${r.id}: ${r.tail}`);
      }
    }
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
    process.exitCode = 0;
  } else {
    for (const b of bad) out(`  - ${b}`);
    out(`${id} 실패 (${bad.length})`);
    process.exitCode = 1;
  }
}
