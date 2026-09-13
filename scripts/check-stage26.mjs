#!/usr/bin/env node
// 26단계(검색 3단계 하이브리드) 완료 조건 검사기.
//   node scripts/check-stage26.mjs S26-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 실패하는 것을 확인한 뒤에 src 를 고쳤다.
//
// **`src/*.js` 를 정적으로 import 하지 않는다.** `embed.js`·`ollama.js` 가 `OLLAMA_HOST` 를 모듈
// 적재 시점에 읽고 상태를 모듈 변수에 든다. 상황마다 자식 프로세스를 띄워 환경변수를 먼저 세운다
// (check-stage25 와 같은 모양, 같은 이유).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/**
 * 자식·서버마다 **빈 임시 데이터 폴더**를 준다. 27단계부터 임베딩이 var/embeddings.json 에 캐시되는데,
 * 기본 폴더를 쓰면 앞 자식이 남긴 캐시를 뒤 자식이 읽어 Ollama 를 안 부르고도 ready 가 된다 — S26-G3 이
 * 그렇게 헛돌았다 [실측]. 그리고 게이트가 저장소의 var/ 를 더럽힌다.
 */
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-26-"));

/**
 * **감시할 값을 여기 다시 적는다.** `hybrid.js` 에서 가져오면 그 상수를 바꾸는 순간 게이트가 함께
 * 느슨해진다. 값이 바뀌면 여기와 거기를 함께 고치고, 그 이유를 GATES.md 알려진 한계에 적는다.
 */
const AGREE_TOP = 1; // [실측] 3 이면 거짓 확신 3건이 남는다
const COS_MIN = 0.44; // [실측] 정답 1위 최솟값. G1 이 이 값으로 정답 수를 잰다
const RRF_K = 60;

/**
 * 실측 질의 23건. `want` 가 정답, `bm25Wrong` 은 지금 1단계가 틀린 답을 확신하는 9건,
 * `vocabGap` 은 코퍼스 별칭에 없어 임베딩도 못 잡는 것이 맞는 것(정답 수에 안 넣는다).
 */
const FIXTURE = Object.freeze([
  { q: "아침에 빵 굽는 냄새가 나는 카페", want: "pair-09", bm25Wrong: true },
  { q: "해가 넘어간 직후 하늘의 잔광", want: "pair-06" },
  { q: "비 온 뒤 숲의 축축한 느낌", want: "pair-13" },
  { q: "물 위에 떠 있는 것처럼 가볍고 서늘한", want: "pair-14" },
  { q: "황무지에 피어난 작은 희망", want: "pair-16" },
  { q: "어른스러운 핑크", want: "pair-12" },
  { q: "과일 과육처럼 신선하고 혈기 넘치는", want: "pair-04" },
  { q: "가죽과 흙 냄새 나는 신사복 브랜드", want: "pair-05" },
  { q: "사막에 홀로 핀 꽃 같은 브랜드", want: "pair-16", bm25Wrong: true },
  { q: "빈티지 레코드 가게", want: "pair-11", bm25Wrong: true },
  { q: "존재감 없이 든든한 조연 같은 색", want: "pair-08", bm25Wrong: true },
  { q: "위험할 정도로 튀는 색", want: "pair-07" },
  { q: "명절 저녁 식탁의 온기", want: "pair-09", alsoOk: "dx-warm-up" }, // 임베딩도 "따뜻하게 만들고 싶다" 를 1위로 본다 — 한쪽 해석이 아니다
  { q: "화면이 죽어 보여요", want: "dx-flat-value", vocabGap: true },
  { q: "CTA 가 안 눌리게 생겼어요", want: "dx-weak-accent", bm25Wrong: true },
  { q: "색이 서로 싸워요", want: "dx-noisy", alsoOk: "dx-mismatch", bm25Wrong: true },
  { q: "너무 병원 같아요", want: "dx-clinical", bm25Wrong: true },
  { q: "숨이 막혀요 화면이", want: "dx-stifling", vocabGap: true, bm25Wrong: true },
  // S1-G2 의 다섯 — G2 회귀 대조. 지금도 맞고, 앞으로도 1단계여야 한다.
  { q: "따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색", want: "pair-09", exact: true },
  { q: "병원 앱인데 차갑지 않게", want: "pair-10", exact: true },
  { q: "느와르 포스터 만들건데 고급스러운 빨강", want: "pair-15", exact: true },
  { q: "청량한 여름 화장품 브랜드", want: "pair-02", exact: true },
  { q: "신뢰감 주는 금융 앱 색", want: "pair-10", exact: true },
]);
const BASELINE_CORRECT = 7; // [실측] 구현 전 1·2단계 정답 수 (18건 중). 이보다 늘어야 한다

const LIVE_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const EMBED_MODEL = "bge-m3";

/**
 * 가짜 Ollama. `/api/tags` 로 준비됨을, `/api/embed` 로 **결정적 벡터**를, `/api/chat` 호출 수를 센다.
 * 벡터는 문장의 문자 코드 합을 씨앗으로 만든 3차원 단위 벡터다 — 뜻은 없지만 같은 입력에 같은 값이라
 * 게이트가 흔들리지 않는다. `embedDelayMs` 로 느린 임베딩을 흉내 낸다(G4).
 */
function stubOllama(initial = {}) {
  let cfg = { embedDelayMs: 0, embedStatus: 200, chatIntent: "palette", ...initial };
  let chatCalls = 0;
  let embedCalls = 0;
  const sockets = new Set();
  const vec = (text) => {
    let h = 7;
    for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) % 100003;
    const a = Math.sin(h);
    const b = Math.cos(h);
    const c = Math.sin(h / 3);
    const n = Math.hypot(a, b, c);
    return [a / n, b / n, c / n];
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    // 자식 프로세스가 스텁의 행동을 바꿀 수 있게 한다(G3 회복 검사) — 부모가 자식 도중에 끼어들 수 없어서다.
    if (req.url.startsWith("/__set?")) {
      const p = new URL(req.url, "http://x").searchParams;
      cfg = { ...cfg, ...(p.has("embedStatus") ? { embedStatus: Number(p.get("embedStatus")) } : {}), ...(p.has("chatIntent") ? { chatIntent: p.get("chatIntent") } : {}) };
      res.writeHead(200).end("{}");
      return undefined;
    }
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }, { name: `${EMBED_MODEL}:latest` }] }));
    }
    if (req.url === "/api/embed") {
      embedCalls += 1;
      if (cfg.embedDelayMs) await new Promise((r) => setTimeout(r, cfg.embedDelayMs));
      if (res.writableEnded || res.destroyed) return undefined;
      if (cfg.embedStatus !== 200) {
        res.writeHead(cfg.embedStatus, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "게이트: 임베딩 실패" }));
      }
      const input = JSON.parse(raw).input;
      const list = Array.isArray(input) ? input : [input];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ model: EMBED_MODEL, embeddings: list.map(vec) }));
    }
    if (req.url === "/api/chat") {
      chatCalls += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ intent: cfg.chatIntent, terms: [] }) } }));
    }
    res.writeHead(404).end("{}");
    return undefined;
  });
  server.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        host: `127.0.0.1:${server.address().port}`,
        set: (next) => {
          cfg = { ...cfg, ...next };
        },
        chatCalls: () => chatCalls,
        embedCalls: () => embedCalls,
        reset: () => {
          chatCalls = 0;
          embedCalls = 0;
        },
        close: () => {
          for (const sock of sockets) sock.destroy();
          server.close();
        },
      }),
    );
  });
}

/** 아무도 안 듣는 포트. 잠깐 열었다 닫아 번호만 얻는다. */
async function deadHost() {
  const probe = await stubOllama();
  const host = probe.host;
  probe.close();
  await new Promise((r) => setTimeout(r, 30));
  return host;
}

/**
 * 자식 프로세스에서 ESM 코드를 돌리고 `RESULT {json}` 한 줄을 결과로 받는다. 자식은 스스로 exit 하지
 * 않는다 — fetch 소켓이 닫히는 도중에 exit 하면 Windows libuv 가 어서션으로 죽는다(25단계 실측).
 * 부모가 그 줄을 받고 자식을 죽인다.
 */
function runChild(code, env, { timeoutMs = 60000 } = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: ROOT,
    env: { ...process.env, OLLAMA_AUTOSTART: "0", TONEFIRST_DATA_DIR: freshDataDir(), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`자식이 ${timeoutMs}ms 안에 안 끝났다. stderr: ${stderr.trim()}`))), timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (!line) return;
      try {
        finish(() => resolve(JSON.parse(line.slice("RESULT ".length))));
      } catch {
        finish(() => reject(new Error(`자식 출력이 JSON 이 아니다: ${line}`)));
      }
    });
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => {
      if (!done) finish(() => reject(new Error(`자식이 결과 없이 코드 ${code} 로 끝났다: ${stderr.trim()}`)));
    });
  });
}

const IMPORTS = `
import { createPipeline } from "${new URL("../src/pipeline.js", import.meta.url).href}";
import * as embed from "${new URL("../src/embed.js", import.meta.url).href}";
const say = (o) => { console.log("RESULT " + JSON.stringify(o)); };
`;

/** 서버를 띄워 실제 응답을 본다. check-stage17·25 와 같은 모양을 독립적으로 적는다. */
function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", TONEFIRST_DATA_DIR: freshDataDir(), ...env },
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

/** 서버의 임베딩 준비가 끝날 때까지 `/api/status` 를 본다. 준비 전 질의는 3단계를 건너뛰므로 기다려야 잰다. */
async function waitEmbedReady(get, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await (await get("/api/status")).json();
    if (st.embed?.state === "ready") return st;
    if (st.embed?.state === "unavailable") throw new Error(`임베딩을 쓸 수 없다: ${st.embed.detail}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("임베딩 준비가 30초 안에 안 끝났다 (embed 상태가 응답에 없거나 unknown 인 채다)");
}

const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();
const topOf = (r) => (r.route === "diagnosis" ? r.diagnostics[0]?.id : r.results[0]?.id) ?? null;

const GATES = {
  /*
   * 실측 23건. 실제 bge-m3 가 LIVE_HOST 에 떠 있어야 성립한다(S3-G3 과 같은 전제) — 없으면 통과가
   * 아니라 실패다. 재는 것 셋: 정답이 늘었나 · 거짓 확신 9건이 1단계에 안 남나 · 두 방법이 같은 답이면
   * 1단계 그대로인가(양성 대조 — 임베딩을 항상 믿는 구현을 거른다).
   */
  "S26-G1": async () => {
    const bad = [];
    await withServer(4341, { OLLAMA_HOST: LIVE_HOST }, async (get) => {
      const st = await waitEmbedReady(get);
      if (st.embed.model !== EMBED_MODEL) bad.push(`모델이 ${st.embed.model} (${EMBED_MODEL} 이어야)`);
      let correct = 0;
      const rows = [];
      for (const f of FIXTURE.filter((x) => !x.exact)) {
        const r = await search(get, f.q);
        const top = topOf(r);
        const ok = r.confident && (top === f.want || top === f.alsoOk);
        if (ok) correct += 1;
        if (f.bm25Wrong && r.stage === 1 && top !== f.want && top !== f.alsoOk) bad.push(`거짓 확신이 남았다: "${f.q}" → 1단계 ${top}`);
        if (r.stage === 3 && r.hybrid === null) bad.push(`3단계인데 hybrid 가 null: "${f.q}"`);
        rows.push(`  ${ok ? "O" : f.vocabGap ? "-" : "X"} ${f.q} → ${r.stage}단계 ${top ?? "-"} (기대 ${f.want})${r.hybrid ? ` cos ${r.hybrid.cosine}` : ""}`);
      }
      rows.forEach(out);
      const measured = FIXTURE.filter((x) => !x.exact).length;
      out(`  정답 ${correct}/${measured} (구현 전 ${BASELINE_CORRECT})`);
      if (correct <= BASELINE_CORRECT) bad.push(`정답 ${correct} — 구현 전 ${BASELINE_CORRECT} 보다 늘지 않았다`);

      // 양성 대조 — 정확 매칭 질의는 두 방법이 같은 답이라 1단계에 남아야 한다.
      for (const f of FIXTURE.filter((x) => x.exact)) {
        const r = await search(get, f.q);
        if (r.stage !== 1 || topOf(r) !== f.want) bad.push(`동의하는 질의가 1단계에 안 남았다: "${f.q}" → ${r.stage}단계 ${topOf(r)}`);
      }
    });
    if (bad.length) throw new Error(bad.join(" / "));
    out("S26_G1_OK");
  },

  /*
   * 정확 매칭 회귀. S1-G2 의 다섯이 여전히 1단계·같은 답·LLM 0회. **실제 bge-m3** 로 잰다 —
   * 스텁의 무의미한 벡터는 절대 동의하지 않아 전부 3단계로 가고, 죽은 상태에서 재면 3단계가 아예 안 돌아
   * 늘 통과한다. 둘 다 이 게이트가 헛도는 길이다.
   */
  "S26-G2": async () => {
    const bad = [];
    {
      await withServer(4342, { OLLAMA_HOST: LIVE_HOST }, async (get) => {
        await waitEmbedReady(get);
        for (const f of FIXTURE.filter((x) => x.exact)) {
          const r = await search(get, f.q);
          if (r.stage !== 1) bad.push(`"${f.q}" 가 ${r.stage}단계`);
          if (topOf(r) !== f.want) bad.push(`"${f.q}" → ${topOf(r)} (기대 ${f.want})`);
          if (r.rewrite !== null || r.usedLlm) bad.push(`"${f.q}" 에서 LLM 을 불렀다`);
        }
      });
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("정확 매칭 5건 1단계 유지 · LLM 0회");
    out("S26_G2_OK");
  },

  /*
   * 임베딩이 없어도 사이트는 그대로다(S3-G1 의 원칙을 3단계로 넓힌다). 그리고 상태는 정직해야 한다 —
   * 25단계가 "아직 확인하지 않았다" 로 배운 것과 같다.
   */
  "S26-G3": async () => {
    const bad = [];
    const dead = await deadHost();
    const code = `${IMPORTS}
const docs = [{ id: "pair-01", kind: "palette", text: "세이지그린 연분홍" }, { id: "dx-muddy", kind: "diagnosis", text: "탁하다" }];
const st = await embed.prepare(docs);
const q = await embed.embedQuery("가을 카페");
const sims = embed.similarities([1, 0, 0]);
const pipe = createPipeline();
const r = await pipe.resolve("병원 앱인데 차갑지 않게", 3, { allowRewrite: false });
say({ state: st.state, detail: st.detail, qv: q.vector, qerr: q.error, sims: sims.length, stage: r.stage, top: r.paletteHits[0]?.doc.id ?? null, hybrid: r.hybrid === undefined ? "undefined" : r.hybrid });
`;
    // 1. 죽은 호스트
    const gone = await runChild(code, { OLLAMA_HOST: dead });
    if (gone.state !== "unavailable") bad.push(`죽은 호스트인데 상태가 ${gone.state}`);
    if (!String(gone.detail).includes(dead)) bad.push(`사유에 호스트가 없다: "${gone.detail}"`);
    if (gone.qv !== null || typeof gone.qerr !== "string") bad.push("죽은 호스트에서 질의 벡터가 null/사유가 아니다");
    if (gone.sims !== 0) bad.push("준비 안 됐는데 유사도가 나온다");
    if (gone.stage !== 1 || gone.top !== "pair-10") bad.push(`임베딩 없이 1단계가 깨졌다: stage=${gone.stage} top=${gone.top}`);
    if (gone.hybrid !== null) bad.push(`임베딩 없는데 hybrid 가 null 이 아니다 (${JSON.stringify(gone.hybrid)})`);

    // 2. 호스트는 살았는데 모델이 없다 (스텁이 404 로 답한다)
    const stub = await stubOllama({ embedStatus: 404 });
    try {
      const noModel = await runChild(code, { OLLAMA_HOST: stub.host });
      if (noModel.state !== "unavailable") bad.push(`모델 없음인데 상태가 ${noModel.state}`);
      if (noModel.stage !== 1 || noModel.top !== "pair-10") bad.push("모델 없이 1단계가 깨졌다");

      // 3. 양성 대조 — 임베딩이 살아 있으면 ready 이고 유사도가 나온다
      stub.set({ embedStatus: 200 });
      const alive = await runChild(code, { OLLAMA_HOST: stub.host });
      if (alive.state !== "ready") bad.push(`스텁이 살았는데 ${alive.state}: ${alive.detail} — 이 게이트가 헛돌고 있다`);
      if (!Array.isArray(alive.qv) || alive.qv.length !== 3) bad.push("질의 벡터가 안 나온다");
      if (alive.sims !== 2) bad.push(`유사도가 ${alive.sims}건 (2건이어야)`);
    } finally {
      stub.close();
    }

    // 4. 회복 — 모델이 없어 unavailable 이 됐다가 생기면(스텁 404→200) TTL 뒤 refresh 가 ready 로 올린다.
    //    처음 구현은 한 번 실패하면 재시작 전까지 3단계를 영영 못 썼다(리뷰 지적).
    //    그리고 재작성 의도가 "other" 면 결합이 답을 안 정했으므로 stage 2 · hybrid null 이어야 한다.
    const stub2 = await stubOllama({ embedStatus: 404 });
    try {
      const rec = await runChild(`${IMPORTS}
const docs = [{ id: "pair-01", kind: "palette", text: "세이지그린 연분홍" }];
const first = await embed.prepare(docs);
await fetch("http://${stub2.host}/__set?embedStatus=200&chatIntent=other");
const early = await embed.refresh();
await new Promise((r) => setTimeout(r, 5200));
const late = await embed.refresh();
const pipe = createPipeline();
const r = await pipe.resolve("zzqq 없는말", 3);
say({ first: first.state, early: early.state, late: late.state, stage: r.stage, hybrid: r.hybrid, usedLlm: r.usedLlm, route: r.route });
`, { OLLAMA_HOST: stub2.host });
      if (rec.first !== "unavailable") bad.push(`모델 없음인데 ${rec.first}`);
      if (rec.early !== "unavailable") bad.push(`TTL 전에 다시 시도했다 (${rec.early})`);
      if (rec.late !== "ready") bad.push(`모델이 생겼는데 TTL 뒤에도 ${rec.late} — 재시작 전까지 3단계를 못 쓴다`);
      if (rec.stage !== 2 || rec.hybrid !== null || rec.usedLlm !== true || rec.route !== "none") bad.push(`의도 other 의 응답이 stage ${rec.stage} · hybrid ${JSON.stringify(rec.hybrid)} · usedLlm ${rec.usedLlm} · route ${rec.route} (2 · null · true · none 이어야)`);
    } finally {
      stub2.close();
    }

    // 5. 보통 기동 경로 — 자동 기동을 켠 채 Ollama 를 못 띄우면(없는 실행 파일) 임베딩 상태가 unavailable 로
    //    남아야 한다. 처음 구현은 기동 성공 때만 준비를 불러 "unknown" 에 갇혔고 리뷰가 잡았다. 이 하네스는
    //    기본으로 OLLAMA_AUTOSTART=0 을 강제하므로 여기서만 명시적으로 켠다.
    await withServer(4347, { OLLAMA_AUTOSTART: "1", OLLAMA_HOST: dead, OLLAMA_BIN: "tonefirst-no-such-binary-26", OLLAMA_READY_TIMEOUT_MS: "2000" }, async (get) => {
      let st = null;
      for (let i = 0; i < 40; i += 1) {
        st = await (await get("/api/status")).json();
        if (st.embed?.state === "unavailable") break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (st?.embed?.state !== "unavailable") bad.push(`보통 기동에서 Ollama 를 못 띄웠는데 embed 가 ${st?.embed?.state} (unavailable 이어야)`);
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("죽은 호스트·모델 없음에서 unavailable + 1단계 그대로 · 살아 있으면 ready · TTL 뒤 회복 · other 는 2단계 · 보통 기동 실패에도 unavailable");
    out("S26_G3_OK");
  },

  /*
   * 느린 임베딩이 확신 검색을 느리게 하면 안 된다. 스텁이 3초 뒤에 답하게 하고, 확신 질의가 1초 안에
   * 1단계로 답하는지 잰다. 양성 대조 — 저신뢰 질의는 기다린다(2.5초 넘게 걸린다).
   */
  "S26-G4": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      await withServer(4343, { OLLAMA_HOST: stub.host }, async (get) => {
        await waitEmbedReady(get);
        stub.set({ embedDelayMs: 3000 });
        const started = Date.now();
        const r = await search(get, "병원 앱인데 차갑지 않게");
        const wall = Date.now() - started;
        if (r.stage !== 1 || topOf(r) !== "pair-10") bad.push(`확신 질의가 ${r.stage}단계 ${topOf(r)}`);
        if (wall > 1000) bad.push(`확신 질의 왕복 ${wall}ms — 느린 임베딩에 끌렸다`);
        if (r.hybridError === null || r.hybridError === undefined) bad.push("예산을 넘겼는데 hybridError 가 없다 — 조용히 넘어간다");

        const s2 = Date.now();
        await search(get, "zzqq 없는말");
        const wall2 = Date.now() - s2;
        if (wall2 < 2500) bad.push(`저신뢰 질의가 ${wall2}ms 만에 답했다 — 임베딩을 기다리지 않았다 (이 게이트가 헛돌고 있다)`);
      });
    } finally {
      stub.close();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("확신 질의 1초 안 · 저신뢰 질의는 임베딩을 기다림");
    out("S26_G4_OK");
  },

  /*
   * 순수 함수라 Ollama 없이 검사한다. 감시 값(AGREE_TOP·COS_MIN·RRF_K)은 위 사본으로 계산해
   * 구현과 대조한다 — 구현이 상수를 바꾸면 여기가 운다.
   */
  "S26-G5": async () => {
    const { cosine, agrees, fuse, decide, AGREE_TOP: A, COS_MIN: C, RRF_K: K } = await import("../src/hybrid.js");
    const bad = [];
    if (A !== AGREE_TOP || C !== COS_MIN || K !== RRF_K) bad.push(`상수가 사본과 다르다: ${A}/${C}/${K} (사본 ${AGREE_TOP}/${COS_MIN}/${RRF_K})`);

    const close = (x, y) => Math.abs(x - y) < 1e-9;
    if (!close(cosine([1, 0], [1, 0]), 1)) bad.push("같은 벡터의 코사인이 1 이 아니다");
    if (!close(cosine([1, 0], [0, 1]), 0)) bad.push("직교 벡터의 코사인이 0 이 아니다");
    if (!close(cosine([1, 0], [-1, 0]), -1)) bad.push("반대 벡터의 코사인이 -1 이 아니다");

    const sims = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, kind: "palette", cosine: 0.9 - i * 0.1 }));
    const inside = sims[AGREE_TOP - 1].id;
    const outside = sims[AGREE_TOP].id;
    if (!agrees({ id: inside }, sims)) bad.push(`${AGREE_TOP}위인데 동의하지 않는다`);
    if (agrees({ id: outside }, sims)) bad.push(`${AGREE_TOP + 1}위인데 동의한다`);
    if (agrees({ id: "zzz" }, sims)) bad.push("없는 문서인데 동의한다");

    const bm25 = [{ id: "b", kind: "palette" }, { id: "x", kind: "diagnosis" }];
    const fused = fuse(bm25, sims);
    const rrf = (ranks) => ranks.reduce((s, r) => s + 1 / (RRF_K + r), 0);
    const byId = Object.fromEntries(fused.map((f) => [f.id, f]));
    if (!close(byId.b.rrf, rrf([1, 2]))) bad.push(`b 의 RRF 가 ${byId.b.rrf} (기대 BM25 1위 + 코사인 2위)`);
    if (!close(byId.a.rrf, rrf([1]))) bad.push(`a 의 RRF 가 ${byId.a.rrf} (기대 코사인 1위만)`);
    if (!close(byId.x.rrf, rrf([2]))) bad.push(`x 의 RRF 가 ${byId.x.rrf} (기대 BM25 2위만)`);
    if (fused[0].id !== "b") bad.push(`결합 1위가 ${fused[0].id} (둘 다에 있는 b 여야)`);
    if (byId.x.cosine !== 0) bad.push("코사인 목록에 없는 문서의 cosine 이 0 이 아니다");
    for (let i = 1; i < fused.length; i++) if (fused[i - 1].rrf < fused[i].rrf) bad.push("결합 결과가 내림차순이 아니다");

    const at = (c) => decide([{ id: "p", kind: "palette", cosine: c, rrf: 1 }]);
    if (!at(COS_MIN).confident) bad.push("문턱과 같은 코사인이 저신뢰다");
    if (at(COS_MIN - 0.001).confident) bad.push("문턱 아래가 확신이다");
    if (at(COS_MIN).route !== "palette") bad.push("라우팅이 1위의 코퍼스가 아니다");
    const dx = decide([{ id: "d", kind: "diagnosis", cosine: 0.9, rrf: 1 }]);
    if (dx.route !== "diagnosis") bad.push("진단 1위인데 route 가 diagnosis 가 아니다");
    const none = decide([]);
    if (none.route !== "none" || none.confident || none.top !== null) bad.push("빈 결합의 판정이 none/false/null 이 아니다");

    if (bad.length) throw new Error(bad.join(" / "));
    out(`코사인 3 · 동의 3 · RRF 5 · 판정 5 검사 통과 (AGREE_TOP ${AGREE_TOP} · COS_MIN ${COS_MIN} · K ${RRF_K})`);
    out("S26_G5_OK");
  },

  /*
   * 오류 원문 경계. 루프백 밖(HOST=0.0.0.0)에서는 hybridError 에 호스트·포트가 안 들어간다.
   * 양성 대조 — 루프백에서는 원문이 나온다.
   */
  "S26-G6": async () => {
    const bad = [];
    const dead = await deadHost();
    const stub = await stubOllama({ embedStatus: 200 });
    try {
      await withServer(4344, { OLLAMA_HOST: stub.host }, async (get) => {
        await waitEmbedReady(get);
        stub.set({ embedDelayMs: 3000 });
        const r = await search(get, "병원 앱인데 차갑지 않게");
        if (typeof r.hybridError !== "string" || !r.hybridError.includes(stub.host)) bad.push(`루프백인데 원문이 아니다: ${r.hybridError}`);
        const st = await (await get("/api/status")).json();
        if (typeof st.embed?.detail !== "string") bad.push("루프백인데 /api/status 의 embed.detail 이 없다");
      });
      stub.set({ embedDelayMs: 0 });
    } finally {
      stub.close();
    }
    const server = await startServer(4345, { HOST: "0.0.0.0", OLLAMA_HOST: dead });
    try {
      const get = (p) => fetch(`http://127.0.0.1:4345${p}`);
      const r = await (await get(`/api/search?q=${encodeURIComponent("zzqq 없는말")}`)).json();
      if (typeof r.hybridError !== "string") bad.push(`루프백 밖에서 hybridError 가 문자열이 아니다 (${JSON.stringify(r.hybridError)})`);
      else if (r.hybridError.includes(dead)) bad.push(`루프백 밖인데 원문이 샌다: ${r.hybridError}`);
      const st = await (await get("/api/status")).json();
      if (st.embed?.detail !== undefined || st.embed?.model !== undefined) bad.push("루프백 밖인데 embed.detail/model 이 나간다");
      if (st.embed?.state !== "unavailable") bad.push(`상태는 나가야 한다: ${st.embed?.state}`);
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("루프백에서 원문 · 루프백 밖에서 상태만");
    out("S26_G6_OK");
  },

  /*
   * 화면 문장은 눈으로 읽는다(17-B). 여기서는 **구조**만 본다 — 3단계 분기가 있는가, LLM 횟수가
   * stage===2 로 세고 있지 않은가, 사다리가 3까지 켜지는가, 턴 기록이 stage 3 을 받는가.
   */
  "S26-G7": async () => {
    const bad = [];
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const app = strip(read("public/app.js"));
    const history = strip(read("public/history.js"));
    const css = read("public/app.css");

    if (!/data\.stage === 3/.test(app)) bad.push("app.js 에 3단계 분기가 없다");
    if (!/3단계/.test(app)) bad.push("app.js 에 3단계 배지 문구가 없다");
    if (/stage === 2\)\.length|s === 2\)\.length/.test(app + history)) bad.push("LLM 횟수를 아직 stage===2 로 센다 — 3단계 뒤에 2단계가 올 수 있다");
    if (!/usedLlm/.test(app) || !/usedLlm/.test(history)) bad.push("LLM 횟수가 usedLlm 기준이 아니다");
    if (!/\.turn__stage--3/.test(css)) bad.push("app.css 에 .turn__stage--3 이 없다");
    if (/실측이 요구하기 전까지 올리지 않습니다/.test(read("public/index.html"))) bad.push("사다리 주석이 아직 '올리지 않습니다' 다 — 3단계가 올라갔다");

    const stub = await stubOllama();
    try {
      await withServer(4346, { OLLAMA_HOST: stub.host }, async (get) => {
        const post = (body) =>
          fetch("http://127.0.0.1:4346/api/conversations/turn", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://127.0.0.1:4346" },
            body: JSON.stringify(body),
          });
        const a = await (await post({ query: "3단계 기록", stage: 3, route: "palette", confident: true, usedLlm: false })).json();
        const b = await (await post({ conversationId: a.conversationId, query: "재작성 뒤 3단계", stage: 3, route: "palette", confident: true, usedLlm: true })).json();
        await post({ conversationId: a.conversationId, query: "위조", stage: 99, route: "palette", usedLlm: "yes" });
        const conv = (await (await get(`/api/conversations?id=${encodeURIComponent(b.conversationId)}`)).json()).conversation;
        const [t1, t2, t3] = conv.turns;
        if (t1.stage !== 3 || t1.usedLlm !== false) bad.push(`턴1이 ${t1.stage}/${t1.usedLlm} (3/false 여야)`);
        if (t2.stage !== 3 || t2.usedLlm !== true) bad.push(`턴2가 ${t2.stage}/${t2.usedLlm} (3/true 여야)`);
        if (t3.stage !== 1 || t3.usedLlm !== false) bad.push(`위조가 ${t3.stage}/${t3.usedLlm} 로 저장됐다 (1/false 여야)`);
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("3단계 분기 · usedLlm · 사다리 · 턴 기록 왕복");
    out("S26_G7_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage26.mjs <${Object.keys(GATES).join("|")}>`);
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
