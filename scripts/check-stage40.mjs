#!/usr/bin/env node
// 40단계(임베딩이 조용히 죽어도 틀린 확신을 안 내보낸다 · 인사말 확신 · 종족 낱말) 완료 조건 검사기.
//   node scripts/check-stage40.mjs S40-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 아홉 게이트가 전부 실패하는 것을 확인한 뒤에 src 를 고쳤다.
// 감시 값(PROMINENCE_MIN · 예산)과 기대표는 대상에서 import 하지 않고 여기 사본으로 적는다. 워밍업 문장만은 import 한다 —
// 값이 무엇이든 "그 한 줄만 갔는가" 를 보는 것이라 사본이 지킬 것이 없다.
// 증거: docs/troubleshootings/2026-09-27-embed-fails-silently-bm25-passes.md

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate40-"));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 사본 ───────────────────────────────────────────────── */
/** [실측 2026-09-27] 인사·잡담 6건 ≤ 0.084, 어휘 없는 정상 질의 4건 ≥ 0.151 — 그 사이. */
const PROMINENCE_MIN = 0.12;
const FAST_BUDGET_MS = 700;
const LIVE_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const EMBED_MODEL = "bge-m3";
const STRONG_QUERY = "느와르 포스터 만들건데 고급스러운 빨강"; // BM25 어절 셋 → pair-15
const WEAK_QUERY = "병원 앱인데 차갑지 않게"; // BM25 어절 하나 → pair-10

const JUNK = ["안녕", "hello", "안녕하세요", "ㅋㅋㅋ", "오늘 날씨 좋다", "뭔가 이상해"];
const NO_LEXICON_OK = ["과일 과육처럼 신선하고 혈기 넘치는", "파스텔톤 유아용품 브랜드", "올리브색", "코랄"];
/** check-stage26.mjs FIXTURE 23건의 정답. alsoOk 는 "|" 로 이었다. */
const A_SET = {
  "아침에 빵 굽는 냄새가 나는 카페": "pair-09", "해가 넘어간 직후 하늘의 잔광": "pair-06", "비 온 뒤 숲의 축축한 느낌": "pair-13",
  "물 위에 떠 있는 것처럼 가볍고 서늘한": "pair-14", "황무지에 피어난 작은 희망": "pair-16", "어른스러운 핑크": "pair-12",
  "과일 과육처럼 신선하고 혈기 넘치는": "pair-04", "가죽과 흙 냄새 나는 신사복 브랜드": "pair-05", "사막에 홀로 핀 꽃 같은 브랜드": "pair-16",
  "빈티지 레코드 가게": "pair-11", "존재감 없이 든든한 조연 같은 색": "pair-08", "위험할 정도로 튀는 색": "pair-07",
  "명절 저녁 식탁의 온기": "pair-09|dx-warm-up", "화면이 죽어 보여요": "dx-flat-value", "CTA 가 안 눌리게 생겼어요": "dx-weak-accent",
  "색이 서로 싸워요": "dx-noisy|dx-mismatch", "너무 병원 같아요": "dx-clinical", "숨이 막혀요 화면이": "dx-stifling",
  "따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색": "pair-09", "병원 앱인데 차갑지 않게": "pair-10",
  "느와르 포스터 만들건데 고급스러운 빨강": "pair-15", "청량한 여름 화장품 브랜드": "pair-02", "신뢰감 주는 금융 앱 색": "pair-10",
};
const A_SET_MIN = 21; // [실측 2026-09-27] 21/23

// 종족 낱말만 있으면 추천이 첫 후보다 — 비유("천사 같은 파스텔")로도 흔해서, 마지막 턴에 안 묻고 고를 때 추천이 안전하다(리뷰 P2).
const ROUTE_TABLE = [
  { text: "금속 로봇 경비병", routes: ["palette", "character"] },
  { text: "트롤 전사", routes: ["palette", "character"] },
  { text: "유령 소년, 창백하고 슬픈", routes: ["palette", "character"] },
  { text: "로봇에 어울리는 색", routes: ["palette", "character"] },
  { text: "로봇한테 입힐 색", routes: ["palette", "character"] },
  { text: "로봇이야", routes: ["palette", "character"] },
  { text: "공주님 캐릭터", routes: ["palette", "character"] },
  { text: "사람 많은 카페 느낌", routes: ["palette"] },
  { text: "기계적인 느낌의 대시보드", routes: ["palette"] },
  { text: "뉴스 기사 썸네일 배경", routes: ["palette"] },
  { text: "설치 마법사 화면", routes: ["palette"] },
  { text: "사람들이 편안하게 느끼는 색", routes: ["diagnosis"] },
  { text: "검 든 기사 색 짜줘", routes: ["character"] },
  { text: "빨간 머리 도적", routes: ["character"] },
];

/* ── 가짜 Ollama ───────────────────────────────────────────
   임베딩은 글자 해시로 만든 3차원 단위 벡터. 요청마다 경로·입력·끝까지 응답했는지(끊김)를 남긴다. */
function stubOllama(initial = {}) {
  let cfg = { embedDelayMs: 0, ...initial };
  let log = [];
  const vec = (text) => {
    let h = 7;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 100003;
    const a = Math.sin(h), b = Math.cos(h), c = Math.sin(h / 3);
    const n = Math.hypot(a, b, c);
    return [a / n, b / n, c / n];
  };
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const entry = { path: req.url, at: Date.now(), inputs: [], completed: false, aborted: false };
    log.push(entry);
    res.on("close", () => {
      if (!res.writableEnded) entry.aborted = true;
    });
    const json = (body) => {
      if (res.destroyed) return;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      entry.completed = true;
    };
    if (req.url === "/api/tags") return json({ models: [{ name: "stub-model:1b" }, { name: `${EMBED_MODEL}:latest` }] });
    if (req.url === "/api/embed") {
      const input = JSON.parse(raw).input;
      entry.inputs = Array.isArray(input) ? input : [input];
      if (cfg.embedDelayMs) await settle(cfg.embedDelayMs);
      return json({ model: EMBED_MODEL, embeddings: entry.inputs.map(vec) });
    }
    if (req.url === "/api/generate") return json({ model: "stub-model:1b", response: "", done: true });
    if (req.url === "/api/chat") return json({ model: "stub-model:1b", message: { role: "assistant", content: JSON.stringify({ intent: "palette", terms: ["게이트"] }) }, done: true });
    res.writeHead(404);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        host: `127.0.0.1:${server.address().port}`,
        set: (next) => (cfg = { ...cfg, ...next }),
        reset: () => (log = []),
        log: () => log,
        embeds: () => log.filter((e) => e.path === "/api/embed"),
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      }),
    ),
  );
}

/** LangSmith 흉내. */
function fakeLangsmith() {
  const received = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      received.push(raw ? JSON.parse(raw) : null);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ received, port: server.address().port, close: () => server.close() })));
}

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", TONEFIRST_DATA_DIR: freshDataDir(), LANGSMITH_API_KEY: "", ...env },
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

async function withServer(port, env, fn) {
  const server = await startServer(port, env);
  const base = `http://127.0.0.1:${port}`;
  const api = {
    get: (path) => fetch(`${base}${path}`),
    post: (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) }),
  };
  try {
    return await fn(api);
  } finally {
    server.kill();
    await settle(400);
  }
}

async function waitEmbedReady(api, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await (await api.get("/api/status")).json();
    if (st.embed?.state === "ready") return st;
    if (st.embed?.state === "unavailable") throw new Error(`임베딩을 쓸 수 없다: ${st.embed.detail}`);
    await settle(200);
  }
  throw new Error("임베딩 준비가 제때 안 끝났다");
}

const search = async (api, q, extra = "") => (await api.get(`/api/search?q=${encodeURIComponent(q)}${extra}`)).json();
const topOf = (r) => (r.route === "diagnosis" ? r.diagnostics?.[0]?.id : r.results?.[0]?.id) ?? null;
const chat = async (api, body) => (await api.post("/api/chat", body)).json();
const traceLines = (dir) => {
  const f = join(dir, "traces.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

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
  const { loadCharacterWords, loadCreatures } = await import("../src/color-words.js");
  const { loadDiagnostics } = await import("../src/diagnostics.js");
  const { loadSeeds } = await import("../src/seeds.js");
  const { loadPalettes } = await import("../src/palettes.js");
  const corpus = [...loadPalettes(), ...loadSeeds()].flatMap((p) => p.colors);
  // server.js 와 같은 인자 — S39-G1 의 교훈(creatures 를 빼면 운영과 다른 라우터를 본다).
  return createRouter({ words: loadCharacterWords(), diagnostics: loadDiagnostics(), corpus, creatures: loadCreatures() });
}

const GATES = {
  /* H1 — 캐시가 찬 재시작에서 임베딩 모델을 올린다. LLM 워밍업보다 먼저. 끄면 0건. */
  "S40-G1": async () => {
    const bad = [];
    const { EMBED_WARMUP_TEXT } = await import("../src/embed.js");
    if (typeof EMBED_WARMUP_TEXT !== "string" || EMBED_WARMUP_TEXT.length === 0) return ["embed.js 가 EMBED_WARMUP_TEXT 를 내보내지 않는다"];
    const stub = await stubOllama();
    const dir = freshDataDir();
    try {
      // 1) 첫 기동 — 캐시를 채운다
      await withServer(4401, { OLLAMA_HOST: stub.host, TONEFIRST_DATA_DIR: dir }, async (api) => waitEmbedReady(api));
      // 2) 워밍업 켠 재시작
      stub.reset();
      await withServer(4401, { OLLAMA_HOST: stub.host, TONEFIRST_DATA_DIR: dir, OLLAMA_WARMUP: "1" }, async (api) => {
        await waitEmbedReady(api);
        await settle(800);
      });
      const inputs = stub.embeds().flatMap((e) => e.inputs);
      if (inputs.length !== 1 || inputs[0] !== EMBED_WARMUP_TEXT) bad.push(`캐시가 찬 재시작(워밍업 켬)의 임베딩 입력이 ${JSON.stringify(inputs)} — "${EMBED_WARMUP_TEXT}" 한 줄이어야`);
      // 3) 워밍업 끈 재시작 — S27-G3 과 같은 뜻
      stub.reset();
      await withServer(4401, { OLLAMA_HOST: stub.host, TONEFIRST_DATA_DIR: dir, OLLAMA_WARMUP: "0" }, async (api) => {
        await waitEmbedReady(api);
        await settle(800);
      });
      if (stub.embeds().length !== 0) bad.push(`워밍업을 껐는데 임베딩 요청이 ${stub.embeds().length}건`);
      // 4) 자동 기동 켬 — 임베딩 워밍업이 LLM 워밍업보다 먼저
      stub.reset();
      await withServer(4401, { OLLAMA_HOST: stub.host, TONEFIRST_DATA_DIR: dir, OLLAMA_WARMUP: "1", OLLAMA_AUTOSTART: "1", OLLAMA_BIN: "tonefirst-no-such-binary-40" }, async (api) => {
        await waitEmbedReady(api);
        await settle(1500);
      });
      const paths = stub.log().map((e) => e.path);
      const firstEmbed = paths.indexOf("/api/embed");
      const firstGenerate = paths.indexOf("/api/generate");
      if (firstEmbed < 0) bad.push(`자동 기동에서 임베딩 워밍업이 없다: ${paths.join(",")}`);
      if (firstGenerate < 0) bad.push(`자동 기동에서 LLM 워밍업이 없다 (게이트 전제 확인): ${paths.join(",")}`);
      if (firstEmbed >= 0 && firstGenerate >= 0 && firstEmbed > firstGenerate) bad.push(`LLM 워밍업이 임베딩보다 먼저 갔다: ${paths.join(",")}`);
    } finally {
      stub.close();
    }
    return bad;
  },

  /* H1 — 700ms 예산은 기다림만 멈춘다. 요청은 끝까지 간다(끊으면 Ollama 가 모델 로딩을 버린다). */
  "S40-G2": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      await withServer(4402, { OLLAMA_HOST: stub.host }, async (api) => {
        await waitEmbedReady(api);
        stub.set({ embedDelayMs: 1500 });
        stub.reset();
        const started = Date.now();
        const r = await search(api, STRONG_QUERY);
        const wall = Date.now() - started;
        if (r.stage !== 1 || topOf(r) !== "pair-15") bad.push(`어절 셋 확신 질의가 ${r.stage}단계 ${topOf(r)} (1단계 pair-15 여야)`);
        if (wall > 1000) bad.push(`확신 질의 왕복 ${wall}ms — 짧은 예산이 안 걸렸다`);
        if (!r.hybridError) bad.push("예산을 넘겼는데 hybridError 가 없다");
        await settle(1500);
        const q = stub.embeds().filter((e) => e.inputs.includes(STRONG_QUERY));
        if (q.length !== 1) bad.push(`질의 임베딩 요청이 ${q.length}건`);
        else if (q[0].aborted || !q[0].completed) bad.push(`질의 임베딩 요청이 끊겼다 (completed ${q[0].completed} · aborted ${q[0].aborted}) — Ollama 가 로딩을 버린다`);
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /* H2 — 어절 하나짜리 확신은 긴 예산으로 기다린다. 끝내 못 받으면 BM25 답(1단계)과 사유. */
  "S40-G3": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      await withServer(4403, { OLLAMA_HOST: stub.host }, async (api) => {
        await waitEmbedReady(api);
        stub.set({ embedDelayMs: 1500 });
        const started = Date.now();
        const r = await search(api, WEAK_QUERY, "&rewrite=0");
        const wall = Date.now() - started;
        if (wall < 1400) bad.push(`어절 하나 확신 질의가 ${wall}ms 만에 답했다 — 임베딩을 안 기다렸다`);
        if (r.hybridError) bad.push(`기다렸는데 hybridError: ${r.hybridError}`);
      });
      stub.set({ embedDelayMs: 0 });
      await withServer(4404, { OLLAMA_HOST: stub.host, EMBED_TIMEOUT_MS: "2000" }, async (api) => {
        await waitEmbedReady(api);
        stub.set({ embedDelayMs: 3000 });
        const started = Date.now();
        const r = await search(api, WEAK_QUERY, "&rewrite=0");
        const wall = Date.now() - started;
        if (wall < 1900 || wall > 3500) bad.push(`긴 예산 2초인데 ${wall}ms 에 답했다`);
        if (r.stage !== 1 || topOf(r) !== "pair-10") bad.push(`임베딩이 끝내 없으면 BM25 답이어야 — ${r.stage}단계 ${topOf(r)}`);
        if (!r.hybridError) bad.push("임베딩을 끝내 못 받았는데 hybridError 가 없다");
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /* H2 — 임베딩 결과가 응답·트레이스·LangSmith 에 남는다. */
  "S40-G4": async () => {
    const bad = [];
    const stub = await stubOllama();
    const ls = await fakeLangsmith();
    const dir = freshDataDir();
    try {
      await withServer(4405, { OLLAMA_HOST: stub.host, TONEFIRST_DATA_DIR: dir, LANGSMITH_API_KEY: "gate-key", LANGSMITH_ENDPOINT: `http://127.0.0.1:${ls.port}` }, async (api) => {
        await waitEmbedReady(api);
        const s = await search(api, STRONG_QUERY);
        if (typeof s.embed?.elapsedMs !== "number" || s.embed?.budgetMs !== FAST_BUDGET_MS) bad.push(`/api/search 의 embed 가 ${JSON.stringify(s.embed)} (elapsedMs 수 · budgetMs ${FAST_BUDGET_MS})`);

        stub.set({ embedDelayMs: 1500 });
        await chat(api, { text: STRONG_QUERY });
        stub.set({ embedDelayMs: 0 });
        await chat(api, { text: STRONG_QUERY });
        await settle(600);
      });
      const turns = traceLines(dir).filter((t) => (t.children ?? []).some((c) => c.name === "search"));
      if (turns.length !== 2) bad.push(`검색 턴 기록이 ${turns.length}줄 (2 여야)`);
      else {
        const [slow, fast] = turns.map((t) => t.children.find((c) => c.name === "embed"));
        if (!slow) bad.push("느린 턴에 embed 자식이 없다");
        else {
          if (slow.inputs?.budgetMs !== FAST_BUDGET_MS) bad.push(`느린 턴 embed.inputs.budgetMs ${slow.inputs?.budgetMs}`);
          if (slow.outputs?.ok !== false || typeof slow.outputs?.error !== "string" || !slow.outputs.error) bad.push(`느린 턴 embed.outputs 가 ${JSON.stringify(slow.outputs)} (ok:false + 사유)`);
        }
        if (!fast) bad.push("정상 턴에 embed 자식이 없다");
        else if (fast.outputs?.ok !== true || typeof fast.outputs?.elapsedMs !== "number" || fast.outputs?.error !== null) bad.push(`정상 턴 embed.outputs 가 ${JSON.stringify(fast.outputs)} (ok:true · elapsedMs · error null)`);
      }
      // 임베딩을 **못 부른** 턴(Ollama 가 죽음)도 기록에 남아야 한다 — 가장 흔한 실패다(리뷰 P2-1).
      const deadDir = freshDataDir();
      await withServer(4409, { OLLAMA_HOST: "127.0.0.1:1", TONEFIRST_DATA_DIR: deadDir }, async (api) => {
        await settle(500);
        await chat(api, { text: STRONG_QUERY });
        await settle(300);
      });
      const deadEmbed = traceLines(deadDir).flatMap((t) => t.children ?? []).find((c) => c.name === "embed");
      if (!deadEmbed) bad.push("Ollama 가 죽은 턴에 embed 자식이 없다 — 가장 흔한 실패가 기록에 안 남는다");
      else if (deadEmbed.outputs?.ok !== false || deadEmbed.outputs?.skipped !== true || !deadEmbed.outputs?.error) bad.push(`죽은 턴 embed.outputs 가 ${JSON.stringify(deadEmbed.outputs)} (ok:false · skipped:true · 사유)`);
      const runs = ls.received.filter((r) => r?.name === "embed");
      if (runs.length < 2) bad.push(`LangSmith 에 embed 런이 ${runs.length}건`);
      else if (runs.some((r) => r.run_type !== "embedding")) bad.push(`embed 런의 run_type 이 ${runs.map((r) => r.run_type).join(",")} ("embedding" 이어야)`);
    } finally {
      stub.close();
      ls.close();
    }
    return bad;
  },

  /* H4 — 순수 함수. 평평한 코사인은 BM25 증거가 없을 때 확신 안 함. */
  "S40-G5": async () => {
    const bad = [];
    const hy = await import("../src/hybrid.js");
    if (hy.PROMINENCE_MIN !== PROMINENCE_MIN) bad.push(`PROMINENCE_MIN 이 ${hy.PROMINENCE_MIN} (사본 ${PROMINENCE_MIN})`);
    if (typeof hy.prominence !== "function") return [...bad, "hybrid.js 가 prominence 를 내보내지 않는다"];
    const mk = (cos) => cos.map((c, i) => ({ id: `d${i}`, kind: i % 2 ? "diagnosis" : "palette", cosine: c }));
    const flat = mk([0.45, 0.445, 0.44, 0.438, 0.435, 0.43, 0.43, 0.425]);
    const peaked = mk([0.6, 0.35, 0.33, 0.32, 0.31, 0.3, 0.3, 0.29]);
    const p = hy.prominence(flat[0].cosine, flat);
    const mean = flat.reduce((a, s) => a + s.cosine, 0) / flat.length;
    if (Math.abs(p - (0.45 - mean)) > 1e-9) bad.push(`prominence 가 1위 − 평균이 아니다: ${p}`);
    const fFlat = hy.fuse([], flat);
    const fPeak = hy.fuse([], peaked);
    if (hy.decide(fFlat, { sims: flat, lexical: false }).confident) bad.push("평평한 코사인 · BM25 증거 없음인데 확신");
    if (!hy.decide(fFlat, { sims: flat, lexical: true }).confident) bad.push("BM25 증거가 있으면 지금처럼 문턱(0.44)만 봐야 하는데 확신 안 함");
    if (!hy.decide(fFlat).confident) bad.push("옵션 없는 decide 가 옛 동작(문턱만)과 다르다");
    if (!hy.decide(fPeak, { sims: peaked, lexical: false }).confident) bad.push("뾰족한 코사인인데 확신 안 함");
    const again = hy.decide(hy.fuse([], flat), { sims: flat, lexical: false });
    if (again.confident !== hy.decide(fFlat, { sims: flat, lexical: false }).confident) bad.push("같은 입력에 다른 판정");
    const src = read("src/hybrid.js");
    for (const w of ["fetch(", "Date.now", "Math.random", "readFileSync"]) if (src.includes(w)) bad.push(`hybrid.js 가 순수하지 않다: ${w}`);
    return bad;
  },

  /* H4 — 실제 bge-m3. 인사·잡담은 확신 안 함 · 어휘 없는 정상 질의는 확신 유지 · 23건 정답 유지. */
  "S40-G6": async () => {
    const bad = [];
    await withServer(4406, { OLLAMA_HOST: LIVE_HOST }, async (api) => {
      const st = await waitEmbedReady(api);
      if (st.embed.model !== EMBED_MODEL) bad.push(`모델이 ${st.embed.model}`);
      for (const q of JUNK) {
        const r = await search(api, q, "&rewrite=0");
        if (r.hybridError) bad.push(`"${q}" 임베딩 실패: ${r.hybridError}`);
        if (r.confident) bad.push(`"${q}" 를 확신했다 → ${r.stage}단계 ${topOf(r)}`);
      }
      for (const q of NO_LEXICON_OK) {
        const r = await search(api, q, "&rewrite=0");
        if (!r.confident) bad.push(`어휘 없는 정상 질의 "${q}" 가 확신을 잃었다 (${r.stage}단계 ${topOf(r)})`);
      }
      let correct = 0;
      const wrong = [];
      for (const [q, want] of Object.entries(A_SET)) {
        const r = await search(api, q, "&rewrite=0");
        const top = topOf(r);
        if (r.confident && want.split("|").includes(top)) correct += 1;
        else wrong.push(`${q}→${top}`);
      }
      // 캐릭터 경로의 인상 문구는 LLM 이 만든 말이라 튀어나옴을 안 본다(리뷰 P2-2) — 옛 판정 그대로여야 한다.
      // embed.js 는 import 순간 호스트·캐시 폴더를 읽는다 — 환경을 먼저 정해야 저장소 var/ 에 안 쓴다.
      process.env.OLLAMA_HOST ??= LIVE_HOST;
      process.env.TONEFIRST_DATA_DIR = freshDataDir();
      const { createPipeline } = await import("../src/pipeline.js");
      const embed = await import("../src/embed.js");
      const pipe = createPipeline();
      await embed.prepare(pipe.embedDocs);
      for (const q of ["밝고 명랑한", "창백하고 슬픈"]) {
        const plain = await pipe.resolve(q, 3, { allowRewrite: false, judgeProminence: false });
        if (!plain.confident) bad.push(`judgeProminence:false 인데 인상 "${q}" 가 확신을 잃었다`);
      }
      const call = read("server.js").match(/async function computeCharacter[\s\S]*?pipeline\.resolve\(([^)]*)\)/)?.[1] ?? "";
      if (!/judgeProminence:\s*false/.test(call)) bad.push(`computeCharacter 가 튀어나옴을 끄지 않는다: resolve(${call})`);
      if (correct < A_SET_MIN) bad.push(`23건 정답 ${correct} (${A_SET_MIN} 이상) — 틀린 것: ${wrong.join(" / ")}`);
      else out(`23건 정답 ${correct} · 틀린 것: ${wrong.join(" / ")}`);
    });
    return bad;
  },

  /* H5 — 라우터. 종족 낱말만 있으면 캐릭터·추천을 되묻는다. */
  "S40-G7": async () => {
    const bad = [];
    const router = await loadRouter();
    for (const row of ROUTE_TABLE) {
      const got = router.route(row.text);
      const ok = got.kind === "route" && JSON.stringify(got.routes) === JSON.stringify(row.routes) && !got.unclear;
      if (!ok) bad.push(`"${row.text}" → ${JSON.stringify(got.routes ?? got.route)}${got.unclear ? ` unclear:${got.unclear}` : ""} (기대 ${JSON.stringify(row.routes)})`);
    }
    return bad;
  },

  /* H5 — 채팅. 죽은 Ollama 에서도 LLM 없이 되묻고, 칩으로 캐릭터가 된다. */
  "S40-G8": async () => {
    const bad = [];
    const dir = freshDataDir();
    await withServer(4408, { OLLAMA_HOST: "127.0.0.1:1", EMBED_PREPARE: "0", TONEFIRST_DATA_DIR: dir }, async (api) => {
      const a = await chat(api, { text: "금속 로봇 경비병" });
      const choices = (a.turn?.choices ?? []).map((c) => c.id);
      if (a.turn?.kind !== "ask" || a.turn?.reason !== "ambiguous" || JSON.stringify(choices) !== JSON.stringify(["palette", "character"])) {
        bad.push(`첫 턴이 ${a.turn?.kind}/${a.turn?.reason} 후보 ${JSON.stringify(choices)} (ask/ambiguous [palette, character] 여야)`);
      }
      const b = await chat(api, { conversationId: a.conversationId, choice: "character" });
      if (b.turn?.kind !== "answer" || b.turn?.route !== "character") bad.push(`칩 뒤가 ${b.turn?.kind}/${b.turn?.route}`);
      // 칩 대신 글로 "추천으로" — 원문에 이어 붙이면 4어절이라 바로잡기를 못 타고 첫 후보로 갔다(리뷰 P2-2)
      const c = await chat(api, { text: "금속 로봇 경비병", fresh: true });
      const d = await chat(api, { conversationId: c.conversationId, text: "추천으로" });
      if (d.turn?.kind !== "answer" || d.turn?.route !== "palette" || d.turn?.original !== "금속 로봇 경비병") bad.push(`되물음에 "추천으로" 를 쳤는데 ${d.turn?.kind}/${d.turn?.route} original "${d.turn?.original}" (answer/palette · 원문 그대로)`);
      const e = await chat(api, { text: "금속 로봇 경비병", fresh: true });
      const f = await chat(api, { conversationId: e.conversationId, text: "캐릭터 색 짜기" });
      if (f.turn?.kind !== "answer" || f.turn?.route !== "character") bad.push(`되물음에 칩 이름 "캐릭터 색 짜기" 를 쳤는데 ${f.turn?.kind}/${f.turn?.route}`);
      await settle(300);
    });
    // 죽은 Ollama 에서는 llm.* 자식이 성공해야만 남으므로 이 줄만으로는 못 운다 — 되묻기 판정(위)이 본 검사다(리뷰 P3).
    const llm = traceLines(dir).flatMap((t) => t.children ?? []).filter((c) => c.name.startsWith("llm."));
    if (llm.length) bad.push(`LLM 자식이 ${llm.length}건: ${llm.map((c) => c.name).join(",")}`);
    return bad;
  },

  "S40-G9": async () => {
    const targets = [
      ["scripts/check-stage3.mjs", 10],
      ["scripts/check-stage22.mjs", 6],
      ["scripts/check-stage26.mjs", 7],
      ["scripts/check-stage27.mjs", 7],
      ["scripts/check-stage28.mjs", 4],
      ["scripts/check-stage29.mjs", 3],
      ["scripts/check-stage30.mjs", 4],
      ["scripts/check-stage34.mjs", 10],
      ["scripts/check-stage39.mjs", 10],
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
