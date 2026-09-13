// 30단계 게이트 — 임베딩 2.2초 튐은 모델이 내려간 것이다 (E3).
//
// 원인 [실측]: /api/embed 에 keep_alive 가 없어 Ollama 기본 5분 뒤 bge-m3 가 GPU 에서 내려간다. 다음 질의가
// 다시 올리는 값(1855·2198ms)을 치르고, 확신 경로 예산 700ms 에 걸려 3단계를 건너뛴다. 웜은 39~83ms.
// 감시 대상에서 값을 가져오지 않는다 — keep_alive 는 여기 사본이다. rewrite.js 의 채팅 워밍업과 같은 값이어야 한다.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

/** 사본. src/embed.js 의 EMBED_KEEP_ALIVE 와 rewrite.js 워밍업의 keep_alive 가 이 값이어야 한다. */
const KEEP_ALIVE = "30m";
/** G2 — 30분 중 25분 이상 남아 있어야 한다. 5분(Ollama 기본값)이면 처방이 안 실린 것이다. */
const MIN_REMAINING_MS = 25 * 60 * 1000;
/** G3 — 콜드 재적재가 웜 중앙값의 이 배수 이상이면 "튐 = 재적재" 가 맞다. 실측 1855/50 ≈ 37배. */
const COLD_RATIO_MIN = 3;
const LIVE_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "bge-m3";

/** 확신 경로(짧은 예산)를 타는 정확 매칭 질의 — 26단계 픽스처의 exact 다섯. */
const EXACT = Object.freeze([
  "따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색",
  "병원 앱인데 차갑지 않게",
  "느와르 포스터 만들건데 고급스러운 빨강",
  "청량한 여름 화장품 브랜드",
  "신뢰감 주는 금융 앱 색",
]);

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", ...env },
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
  try {
    return await fn((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    server.kill();
  }
}

async function waitEmbedReady(get, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await (await get("/api/status")).json();
    if (st.embed?.state === "ready") return st;
    if (st.embed?.state === "unavailable") throw new Error(`임베딩을 쓸 수 없다: ${st.embed.detail}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("임베딩 준비가 30초 안에 안 끝났다");
}

const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();

/** 실제 Ollama 에 직접. keep_alive 0 은 즉시 내린다. 걸린 ms 를 돌려준다. */
async function liveEmbed(text, extra = {}) {
  const started = Date.now();
  const res = await fetch(`http://${LIVE_HOST}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: text, ...extra }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  await res.json();
  return Date.now() - started;
}

/** 내리고 나서 실제로 없어질 때까지 기다린다 — keep_alive 0 은 비동기라 바로 다음 요청이 옛 러너를 탄다(콜드 51ms 로 헛돈 실측). */
async function liveUnload() {
  await liveEmbed("내린다", { keep_alive: 0 });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!(await livePs())) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${EMBED_MODEL} 이 15초 안에 안 내려갔다`);
}

async function livePs() {
  const res = await fetch(`http://${LIVE_HOST}/api/ps`, { signal: AbortSignal.timeout(5000) });
  const json = await res.json();
  return (json.models ?? []).find((m) => m.name === EMBED_MODEL || m.name.startsWith(`${EMBED_MODEL}:`)) ?? null;
}

/** 가짜 Ollama — /api/embed 요청 본문을 전부 기록한다. 벡터는 결정적 3차원. */
function stubOllama() {
  const bodies = [];
  const sockets = new Set();
  const vec = (text) => {
    let h = 7;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 100003;
    const a = Math.sin(h), b = Math.cos(h), c = Math.sin(h / 3);
    const n = Math.hypot(a, b, c);
    return [a / n, b / n, c / n];
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }, { name: `${EMBED_MODEL}:latest` }] }));
    }
    if (req.url === "/api/embed") {
      const body = JSON.parse(raw);
      bodies.push(body);
      const list = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ model: EMBED_MODEL, embeddings: list.map(vec) }));
    }
    if (req.url === "/api/chat") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ intent: "palette", terms: [] }) } }));
    }
    res.writeHead(404).end("{}");
    return undefined;
  });
  server.on("connection", (sock) => { sockets.add(sock); sock.on("close", () => sockets.delete(sock)); });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      host: `127.0.0.1:${server.address().port}`,
      bodies,
      close: () => { for (const sock of sockets) sock.destroy(); server.close(); },
    }));
  });
}

function runStage26(id) {
  const child = spawn(process.execPath, ["scripts/check-stage26.mjs", id], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => resolve({ id, ok: code === 0 && stdout.includes(id.replace(/-/g, "_") + "_OK"), tail: (stdout.trim() || stderr.trim()).split("\n").pop() ?? "" })); // stdout 이 있으면 그 마지막 줄 — stderr 경고가 게이트 메시지를 가리지 않게(리뷰 지적)
  });
}

const GATES = {
  /* 스텁. 코퍼스 준비(배치 1건)와 질의(낱개) 요청 둘 다에 keep_alive 사본이 실려야 한다. 요청이 하나도 없으면 실패다(공허 통과 방지). */
  "S30-G1": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      await withServer(4381, { OLLAMA_HOST: stub.host }, async (get) => {
        await waitEmbedReady(get);
        await search(get, "청량한 여름 화장품 브랜드"); // 확신 경로 질의 임베딩
        await search(get, "아무 데도 없는 말"); // 저신뢰 경로 질의 임베딩
      });
    } finally {
      stub.close();
    }
    const batch = stub.bodies.filter((b) => Array.isArray(b.input) && b.input.length > 1);
    const single = stub.bodies.filter((b) => !Array.isArray(b.input) || b.input.length === 1);
    if (batch.length === 0) bad.push("코퍼스 준비 요청이 안 왔다");
    if (single.length < 2) bad.push(`질의 임베딩 요청이 ${single.length}건 (2건 이상이어야)`);
    for (const [i, b] of stub.bodies.entries()) if (b.keep_alive !== KEEP_ALIVE) bad.push(`요청 ${i + 1} 의 keep_alive 가 ${JSON.stringify(b.keep_alive)} (사본 ${KEEP_ALIVE})`);
    const { EMBED_KEEP_ALIVE } = await import("../src/embed.js");
    if (EMBED_KEEP_ALIVE !== KEEP_ALIVE) bad.push(`EMBED_KEEP_ALIVE 가 ${JSON.stringify(EMBED_KEEP_ALIVE)} (사본 ${KEEP_ALIVE})`);
    if (bad.length) throw new Error(bad.join(" / "));
    out(`요청 ${stub.bodies.length}건(배치 ${batch.length} · 낱개 ${single.length}) 전부 keep_alive ${KEEP_ALIVE}`);
    out("S30_G1_OK");
  },

  /*
   * 실제 Ollama. 먼저 모델을 내린다 — Ollama 는 **올릴 때의** keep_alive 를 기억하므로, 올라와 있는 채로 재면 이전
   * 요청의 값이 보인다(구현 전에 통과한 공허 게이트 · 실측). 새 데이터 폴더라 캐시가 비어 있어 준비가 반드시
   * /api/embed 를 부르고, 그 요청이 모델을 올린다. 그 keep_alive 가 /api/ps 만료 시각에 보인다.
   */
  "S30-G2": async () => {
    const bad = [];
    await liveUnload();
    await withServer(4382, { OLLAMA_HOST: LIVE_HOST }, async (get) => {
      const st = await waitEmbedReady(get);
      if (st.embed.embedded < 1) bad.push(`준비가 Ollama 를 안 불렀다 (embedded ${st.embed.embedded})`);
      const m = await livePs();
      if (!m) { bad.push(`/api/ps 에 ${EMBED_MODEL} 이 없다 — 내려가 있다`); return; }
      const remaining = new Date(m.expires_at).getTime() - Date.now();
      out(`  ${m.name} 만료까지 ${Math.round(remaining / 60000)}분`);
      if (!(remaining >= MIN_REMAINING_MS)) bad.push(`만료까지 ${Math.round(remaining / 1000)}초 — ${MIN_REMAINING_MS / 60000}분 이상이어야`);
    });
    if (bad.length) throw new Error(bad.join(" / "));
    out("S30_G2_OK");
  },

  /*
   * 실제 bge-m3. 튐을 재현한다 — 일부러 내린 뒤 직접 한 번 재는 것이 콜드(양성 대조). 다시 내리고 서버 준비를 거치면
   * 모델이 올라와 있으므로 확신 경로 질의 5건이 전부 예산 안에 임베딩된다(hybridError 없음). 콜드가 웜의 3배 미만이면
   * 이 기계에서는 재적재가 튐의 원인이 아니라는 뜻이라 실패다.
   */
  "S30-G3": async () => {
    const bad = [];
    await liveUnload();
    const cold = await liveEmbed("콜드 재적재");
    const warm = [];
    for (let i = 0; i < 3; i += 1) warm.push(await liveEmbed(`웜 ${i}`));
    const warmMedian = [...warm].sort((a, b) => a - b)[1];
    out(`  직접: 콜드 ${cold}ms · 웜 ${warm.join("/")}ms (중앙값 ${warmMedian})`);
    if (!(cold >= warmMedian * COLD_RATIO_MIN)) bad.push(`콜드 ${cold}ms 가 웜 ${warmMedian}ms 의 ${COLD_RATIO_MIN}배 미만 — 재적재가 튐이 아니다`);
    await liveUnload();
    await withServer(4383, { OLLAMA_HOST: LIVE_HOST }, async (get) => {
      await waitEmbedReady(get); // 준비가 모델을 올린다
      for (const q of EXACT) {
        const r = await search(get, q);
        out(`  ${r.hybridError ? "X" : "O"} ${q} → ${r.stage}단계 ${r.hybridError ?? "임베딩 예산 안"}`);
        if (r.stage !== 1 || r.hybridError !== null) bad.push(`"${q}" → ${r.stage}단계 ${r.hybridError}`);
      }
    });
    if (bad.length) throw new Error(bad.join(" / "));
    out("S30_G3_OK");
  },

  "S30-G4": async () => {
    const results = [];
    for (let i = 1; i <= 7; i += 1) results.push(await runStage26(`S26-G${i}`));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`26단계 게이트 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("26단계 게이트 7개 전부 통과");
    out("S30_G4_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage30.mjs <${Object.keys(GATES).join("|")}>`);
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
