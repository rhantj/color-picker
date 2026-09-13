#!/usr/bin/env node
// 28단계(어긋난 BM25 는 안 믿는다 · E1) 완료 조건 검사기.
//   node scripts/check-stage28.mjs S28-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** G1·G2 가 실패하는 것을 확인한 뒤에 src 를 고쳤다. G3 은 회귀다.

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

/** 감시 값 사본 — hybrid.js 에서 가져오지 않는다. */
const DISAGREE_BM25_WEIGHT = 0;
const DISTRUST_MAX_WHOLE = 1; // 어절 전체 매치가 이 수 이하일 때만 안 믿는다 — S27-G1 이 "둘 다 버림" 을 잡았다
const RRF_K = 60;
const LIVE_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const EMBED_MODEL = "bge-m3";
// 26단계는 "구현 전 값(7)보다 늘었나" 를 봤고, 여기는 **바닥값**이다 — 이 단계의 목적이 "12 에서 14 로" 라서
// 13 이면 회귀다. 값은 스파이크 관측치를 옮긴 것이지만 게이트는 매번 실제 모델로 다시 잰다(복사가 아니라 회귀선).
const TARGET_CORRECT = 14; // [실측] 스파이크에서 가중치 0 일 때
const E1 = Object.freeze([
  { q: "너무 병원 같아요", want: "dx-clinical" },
  { q: "CTA 가 안 눌리게 생겼어요", want: "dx-weak-accent" },
]);

/** 26단계 실측 픽스처 사본. 정답 수·거짓 확신·정확 매칭을 같은 기준으로 다시 잰다. */
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
  { q: "명절 저녁 식탁의 온기", want: "pair-09", alsoOk: "dx-warm-up" },
  { q: "화면이 죽어 보여요", want: "dx-flat-value", vocabGap: true },
  { q: "CTA 가 안 눌리게 생겼어요", want: "dx-weak-accent", bm25Wrong: true },
  { q: "색이 서로 싸워요", want: "dx-noisy", alsoOk: "dx-mismatch", bm25Wrong: true },
  { q: "너무 병원 같아요", want: "dx-clinical", bm25Wrong: true },
  { q: "숨이 막혀요 화면이", want: "dx-stifling", vocabGap: true, bm25Wrong: true },
  { q: "따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색", want: "pair-09", exact: true },
  { q: "병원 앱인데 차갑지 않게", want: "pair-10", exact: true },
  { q: "느와르 포스터 만들건데 고급스러운 빨강", want: "pair-15", exact: true },
  { q: "청량한 여름 화장품 브랜드", want: "pair-02", exact: true },
  { q: "신뢰감 주는 금융 앱 색", want: "pair-10", exact: true },
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
const topOf = (r) => (r.route === "diagnosis" ? r.diagnostics[0]?.id : r.results[0]?.id) ?? null;

function runStage26(id) {
  const child = spawn(process.execPath, ["scripts/check-stage26.mjs", id], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => resolve({ id, ok: code === 0 && stdout.includes(id.replace(/-/g, "_") + "_OK"), tail: (stdout + stderr).trim().split("\n").pop() ?? "" }));
  });
}

/**
 * 가짜 Ollama (G4). 결정적 벡터 · delayIf 가 든 입력(새 문서 배치)만 지연 — 질의 임베딩은 늦추지 않는다(늦추면 확신 경로 예산에 걸려 창을 못 본다).
 */
function stubOllama(initial = {}) {
  let cfg = { embedDelayMs: 0, delayIf: null, ...initial }; // delayIf: 이 문자열이 든 입력이 있을 때만 지연
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
      const input = JSON.parse(raw).input;
      const list = Array.isArray(input) ? input : [input];
      const shouldDelay = cfg.embedDelayMs && (cfg.delayIf ? list.some((t) => String(t).includes(cfg.delayIf)) : true);
      if (shouldDelay) await new Promise((r) => setTimeout(r, cfg.embedDelayMs));
      if (res.writableEnded || res.destroyed) return undefined;
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
      set: (next) => { cfg = { ...cfg, ...next }; },
      close: () => { for (const sock of sockets) sock.destroy(); server.close(); },
    }));
  });
}

/** 임시 코퍼스 폴더(27단계와 같은 처방 — 저장소 data/ 를 직접 바꾸지 않는다). */
function scratchCorpus() {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-28-"));
  const corpus = join(dir, "corpus");
  cpSync(join(ROOT, "data"), corpus, { recursive: true });
  return {
    corpus,
    read: (name) => JSON.parse(readFileSync(join(corpus, name), "utf8")),
    write: (name, value) => writeFileSync(join(corpus, name), JSON.stringify(value, null, 2), "utf8"),
    rm: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 임시 폴더 */ } },
  };
}

const GATES = {
  /*
   * 옛 벡터 창 — 재적재 직후 재임베딩(3초)이 끝나기 전에는 새 문서가 임베딩 순위에 없다. 그때 어절 하나
   * ("zzqq별똥별")로 BM25 가 그 문서를 확신하면, 임베딩이 "어긋난" 것이 아니라 "아직 모르는" 것이다.
   * 처음 구현은 둘을 같은 경로로 봐서 가중치 0 → 문서가 결과에서 사라졌다(리뷰 지적).
   */
  "S28-G4": async () => {
    const bad = [];
    const s = scratchCorpus();
    const stub = await stubOllama();
    try {
      await withServer(4362, { OLLAMA_HOST: stub.host, TONEFIRST_CORPUS_DIR: s.corpus }, async (get) => {
        await waitEmbedReady(get);
        stub.set({ embedDelayMs: 3000, delayIf: "게이트 전용" });
        // **새 문서**를 더한다. 고친 문서는 옛 벡터로 순위에 남아 있어 창이 안 열린다 — 순위에 아예 없어야 한다.
        const doc = s.read("palettes.json");
        // 어절 **하나**로만 잡혀야 한다 — "zzqq별똥별" 은 토크나이저가 둘로 쪼개 매치가 2개가 된다(실측). 희귀 한글 어절 하나만 쓴다.
        doc.palettes.push({ ...doc.palettes[2], id: "pair-99", name: "게이트 전용 새 조합", summary: "별똥별 하나로만 잡히는 새 문서", tags: [] });
        s.write("palettes.json", doc);
        await new Promise((r) => setTimeout(r, 2300)); // 확인 TTL(2초) 을 넘긴다
        const r = await search(get, "별똥별"); // BM25 는 pair-99 를 어절 하나로 확신, 임베딩 순위에는 아직 없다
        const ids = (r.results ?? []).map((x) => x.id);
        if (ids[0] !== "pair-99") bad.push(`창 안에서 BM25 답이 사라졌다: stage ${r.stage} route ${r.route} ids ${ids.join(",")}`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("옛 벡터 창에서 어절 하나짜리 새 문서가 BM25 로 살아 있다");
    out("S28_G4_OK");
  },

  /* 실제 bge-m3. 정답 14 이상 · E1 두 건 · 거짓 확신 0 · 정확 매칭 5건 1단계. */
  "S28-G1": async () => {
    const bad = [];
    await withServer(4361, { OLLAMA_HOST: LIVE_HOST }, async (get) => {
      const st = await waitEmbedReady(get);
      if (st.embed.model !== EMBED_MODEL) bad.push(`모델이 ${st.embed.model}`);
      let correct = 0;
      const got = new Map();
      for (const f of FIXTURE.filter((x) => !x.exact)) {
        const r = await search(get, f.q);
        const top = topOf(r);
        got.set(f.q, top);
        const ok = r.confident && (top === f.want || top === f.alsoOk);
        if (ok) correct += 1;
        if (f.bm25Wrong && r.stage === 1 && top !== f.want && top !== f.alsoOk) bad.push(`거짓 확신이 남았다: "${f.q}" → 1단계 ${top}`);
        out(`  ${ok ? "O" : f.vocabGap ? "-" : "X"} ${f.q} → ${r.stage}단계 ${top ?? "-"} (기대 ${f.want})`);
      }
      out(`  정답 ${correct}/18 (목표 ${TARGET_CORRECT} 이상 · 26단계 12)`);
      if (correct < TARGET_CORRECT) bad.push(`정답 ${correct} < ${TARGET_CORRECT}`);
      for (const e of E1) if (got.get(e.q) !== e.want) bad.push(`E1 "${e.q}" → ${got.get(e.q)} (기대 ${e.want})`);
      for (const f of FIXTURE.filter((x) => x.exact)) {
        const r = await search(get, f.q);
        if (r.stage !== 1 || topOf(r) !== f.want) bad.push(`정확 매칭이 1단계에 안 남았다: "${f.q}" → ${r.stage}단계 ${topOf(r)}`);
      }
    });
    if (bad.length) throw new Error(bad.join(" / "));
    out("S28_G1_OK");
  },

  /* 순수 함수. 가중치 0 이면 BM25 순위가 결합에 안 들어가고, 1 이면 26단계 식 그대로. */
  "S28-G2": async () => {
    const { fuse, DISAGREE_BM25_WEIGHT: W, DISTRUST_MAX_WHOLE: M, RRF_K: K } = await import("../src/hybrid.js");
    const bad = [];
    if (W !== DISAGREE_BM25_WEIGHT) bad.push(`DISAGREE_BM25_WEIGHT 가 ${W} (사본 ${DISAGREE_BM25_WEIGHT})`);
    if (M !== DISTRUST_MAX_WHOLE) bad.push(`DISTRUST_MAX_WHOLE 가 ${M} (사본 ${DISTRUST_MAX_WHOLE})`);
    if (K !== RRF_K) bad.push(`RRF_K 가 ${K}`);
    const close = (x, y) => Math.abs(x - y) < 1e-12;
    const rrf = (ranks) => ranks.reduce((s, r) => s + 1 / (RRF_K + r), 0);
    const sims = [{ id: "c", kind: "palette", cosine: 0.9 }, { id: "b", kind: "palette", cosine: 0.8 }, { id: "a", kind: "palette", cosine: 0.7 }];
    const bm25 = [{ id: "a", kind: "palette" }, { id: "b", kind: "palette" }]; // BM25 는 a 를 1위로 우긴다

    // 가중치 1 — 26단계와 같다: a 가 BM25 1위 + 코사인 3위로 결합 1위
    const w1 = fuse(bm25, sims, { bm25Weight: 1 });
    const by1 = Object.fromEntries(w1.map((f) => [f.id, f.rrf]));
    if (!close(by1.a, rrf([1, 3])) || !close(by1.b, rrf([2, 2])) || !close(by1.c, rrf([1]))) bad.push("가중치 1 의 RRF 가 26단계 식과 다르다");
    if (w1[0].id !== "a") bad.push(`가중치 1 의 1위가 ${w1[0].id} (a 여야 — BM25 가 이긴다)`);

    // 가중치 0 — 코사인 순위만 남아 c 가 1위, BM25 에만 있던 문서는 점수 0
    const w0 = fuse(bm25, sims, { bm25Weight: 0 });
    const by0 = Object.fromEntries(w0.map((f) => [f.id, f.rrf]));
    if (w0.map((f) => f.id).join(",") !== "c,b,a") bad.push(`가중치 0 의 순서가 ${w0.map((f) => f.id).join(",")} (코사인 순 c,b,a 여야)`);
    if (!close(by0.a, rrf([3]))) bad.push("가중치 0 인데 BM25 순위가 점수에 들어갔다");
    const only = fuse([{ id: "z", kind: "diagnosis" }], sims, { bm25Weight: 0 });
    if ((only.find((f) => f.id === "z")?.rrf ?? -1) !== 0) bad.push("BM25 에만 있는 문서가 가중치 0 에서 점수를 받았다");

    // 기본 인자는 1 — 재작성 뒤 결합이 아무것도 안 넘겨도 26단계와 같다
    const def = fuse(bm25, sims);
    if (def[0].id !== "a") bad.push("기본 가중치가 1 이 아니다");

    if (bad.length) throw new Error(bad.join(" / "));
    out(`가중치 1 = 26단계 식 · 0 = 코사인 순위만 · 기본 1 (K ${RRF_K})`);
    out("S28_G2_OK");
  },

  "S28-G3": async () => {
    const results = [];
    for (let i = 1; i <= 7; i += 1) results.push(await runStage26(`S26-G${i}`));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`26단계 게이트 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("26단계 게이트 7개 전부 통과");
    out("S28_G3_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage28.mjs <${Object.keys(GATES).join("|")}>`);
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
