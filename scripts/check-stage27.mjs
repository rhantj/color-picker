#!/usr/bin/env node
// 27단계(검색 4단계 온디맨드) 완료 조건 검사기.
//   node scripts/check-stage27.mjs S27-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 실패하는 것을 확인한 뒤에 src 를 고쳤다.
//
// 코퍼스를 **임시 폴더에 복사해** 서버에 TONEFIRST_CORPUS_DIR 로 넘긴다. 저장소의 data/ 를 직접 바꾸면
// 다른 게이트가 그 사이 다른 코퍼스를 본다. 캐시도 TONEFIRST_DATA_DIR 로 임시 폴더에 둔다.
// 하네스(스텁 Ollama·서버)는 check-stage26 의 것과 같은 모양을 **독립적으로** 적는다 — 한쪽에서 읽어 오면
// 그쪽이 바뀔 때 이 단계 게이트가 조용히 다른 것을 검사하게 된다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 감시할 값 사본. 대상에서 가져오지 않는다. */
const CHECK_TTL_MS = 2000;
const CACHE_FILE = "embeddings.json";
const CORPUS_DOCS = 34; // 팔레트 16 + 진단 18
const EMBED_MODEL = "bge-m3";

/**
 * 가짜 Ollama. `/api/embed` 로 결정적 벡터를 내고 **입력 건수를 합산**한다(G2·G3 의 핵심).
 * `/api/chat` 은 팔레트 의도로 답한다. `embedDelayMs` 로 느린 임베딩을 흉내 낸다(G5 의 옛 벡터 창).
 */
function stubOllama(initial = {}) {
  // echo: "zzqq" 가 든 질의에 이 문장의 벡터를 돌려준다 — 옛 벡터 창에서 특정 문서를 코사인 1 로 1위에 세우려고(G5).
  // embedDelayMs 는 "zzqq" 질의 한 건만 빼고 전부에 건다. 질의까지 늦추면 확신 경로 예산에 걸려 창을 못 보고,
  // "배치에만" 걸면 바뀐 문서가 1건일 때 창이 안 열린다(실측 — 둘 다 겪었다).
  let cfg = { embedDelayMs: 0, embedStatus: 200, echo: null, ...initial };
  let embedInputs = 0;
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
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }, { name: `${EMBED_MODEL}:latest` }] }));
    }
    if (req.url === "/api/embed") {
      const input = JSON.parse(raw).input;
      const list = Array.isArray(input) ? input : [input];
      embedCalls += 1;
      embedInputs += list.length;
      const isProbe = list.length === 1 && String(list[0]).includes("zzqq");
      if (cfg.embedDelayMs && !isProbe) await new Promise((r) => setTimeout(r, cfg.embedDelayMs));
      if (res.writableEnded || res.destroyed) return undefined;
      if (cfg.embedStatus !== 200) {
        res.writeHead(cfg.embedStatus, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "게이트: 임베딩 실패" }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ model: EMBED_MODEL, embeddings: list.map((t) => (cfg.echo && String(t).includes("zzqq") ? vec(cfg.echo) : vec(t))) }));
    }
    if (req.url === "/api/chat") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ intent: "palette", terms: [] }) } }));
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
        embedInputs: () => embedInputs,
        embedCalls: () => embedCalls,
        reset: () => {
          embedInputs = 0;
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

/** 서버를 띄워 실제 응답을 본다. */
function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", ...env },
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
    // Windows 에서 kill 직후 같은 포트로 다시 띄우면 잠깐 거부된다. 한 박자 쉰다.
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 임베딩 준비가 끝날 때까지 `/api/status` 를 본다. */
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

/** 임시 코퍼스·데이터 폴더. 끝나면 지운다. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-27-"));
  const corpus = join(dir, "corpus");
  const data = join(dir, "var");
  cpSync(join(ROOT, "data"), corpus, { recursive: true });
  return {
    corpus,
    data,
    read: (name) => JSON.parse(readFileSync(join(corpus, name), "utf8")),
    write: (name, value) => writeFileSync(join(corpus, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8"),
    cache: () => (existsSync(join(data, CACHE_FILE)) ? JSON.parse(readFileSync(join(data, CACHE_FILE), "utf8")) : null),
    files: () => (existsSync(data) ? readdirSync(data) : []),
    rm: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows 가 잠깐 잡고 있을 수 있다. 임시 폴더라 남아도 해가 없다 */
      }
    },
  };
}

/** TTL 이 지나게 기다린 뒤 검색한다. mtime 해상도(일부 FS 1초)를 넘기려고 여유를 둔다. */
const settle = () => new Promise((r) => setTimeout(r, CHECK_TTL_MS + 300));
const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();
const status = async (get) => (await get("/api/status")).json();
const env = (s, extra = {}) => ({ TONEFIRST_CORPUS_DIR: s.corpus, TONEFIRST_DATA_DIR: s.data, ...extra });
/** 재임베딩은 서버가 기다리지 않으므로, 상태의 embedded 가 바뀔 때까지 잠깐 본다. */
async function waitEmbedded(get, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let st = null;
  while (Date.now() < deadline) {
    st = await status(get);
    if (st.embed?.state === "ready" && predicate(st)) return st;
    await new Promise((r) => setTimeout(r, 150));
  }
  return st;
}

const GATES = {
  /* 바뀐 요약이 재시작 없이 검색에 잡힌다. 어절 전체 매치가 1단계를 만들도록 코퍼스에 없는 낱말을 넣는다. */
  "S27-G1": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4351, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        const before = await status(get);
        if (!before.corpus) throw new Error("/api/status 에 corpus 가 없다");
        const miss = await search(get, "zzqq 별똥별 카페");
        if (miss.stage === 1 && miss.confident) bad.push("바꾸기 전에 이미 잡힌다 — 이 게이트가 헛돌고 있다");

        await settle();
        const same = await status(get);
        if (same.corpus.version !== before.corpus.version) bad.push(`안 바꿨는데 version 이 ${before.corpus.version} → ${same.corpus.version}`);

        const doc = s.read("palettes.json");
        doc.palettes[0].summary = `${doc.palettes[0].summary} 별똥별 카페`;
        s.write("palettes.json", doc);
        await settle();
        const hit = await search(get, "zzqq 별똥별 카페");
        const top = hit.route === "palette" ? hit.results[0]?.id : null;
        if (top !== "pair-01") bad.push(`바꾼 뒤에도 못 잡는다: stage ${hit.stage} route ${hit.route} top ${top}`);
        const after = await status(get);
        if (after.corpus.version !== before.corpus.version + 1) bad.push(`version 이 ${before.corpus.version} → ${after.corpus.version} (1 올라야)`);
        if (after.corpus.error !== null) bad.push(`정상 재적재인데 error 가 ${after.corpus.error}`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("요약을 고치자 재시작 없이 잡힌다 · version +1 · 안 바꾸면 그대로");
    out("S27_G1_OK");
  },

  /* 바뀐 문서 하나만 다시 임베딩. 스텁이 /api/embed 입력 건수를 합산한다. */
  "S27-G2": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4352, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        if (stub.embedInputs() !== CORPUS_DOCS) bad.push(`첫 준비의 입력이 ${stub.embedInputs()}건 (${CORPUS_DOCS}건이어야)`);
        stub.reset();
        const doc = s.read("diagnostics.json");
        doc.diagnostics[0].prescription = `${doc.diagnostics[0].prescription} (고침)`;
        s.write("diagnostics.json", doc);
        await settle();
        await status(get); // 검색이 아니라 상태로 재적재를 일으킨다 — 검색은 질의 임베딩 1건을 섞어 센다
        const st = await waitEmbedded(get, (x) => x.embed.embedded === 1);
        if (stub.embedInputs() !== 1) bad.push(`바뀐 문서 1건인데 임베딩 입력이 ${stub.embedInputs()}건`);
        if (st?.embed?.cached !== CORPUS_DOCS - 1 || st?.embed?.embedded !== 1) bad.push(`상태가 cached ${st?.embed?.cached} · embedded ${st?.embed?.embedded} (33 · 1 이어야)`);

        // 연속 편집 — 첫 재임베딩(3초)이 끝나기 전에 두 번째 편집이 오면 두 번째 문서도 임베딩돼야 한다.
        // 처음 구현은 진행 중인 것을 그대로 돌려줘 두 번째가 유실됐다(리뷰 재현).
        stub.reset();
        stub.set({ embedDelayMs: 3000 });
        const d1 = s.read("diagnostics.json");
        d1.diagnostics[1].prescription = `${d1.diagnostics[1].prescription} (첫째)`;
        s.write("diagnostics.json", d1);
        await settle();
        await status(get); // 재적재 1 → 재임베딩 시작(3초)
        const d2 = s.read("diagnostics.json");
        d2.diagnostics[2].prescription = `${d2.diagnostics[2].prescription} (둘째)`;
        s.write("diagnostics.json", d2);
        await settle();
        await status(get); // 재적재 2 — 첫 재임베딩이 아직 진행 중이다
        await new Promise((r) => setTimeout(r, 7500));
        if (stub.embedInputs() !== 2) bad.push(`연속 편집 2건인데 임베딩 입력이 ${stub.embedInputs()}건 (2 여야 — 둘째가 유실됐다)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("34 → 1건만 재임베딩");
    out("S27_G2_OK");
  },

  /* 캐시가 재시작을 넘긴다 · 모델이 바뀌면 전부 다시. */
  "S27-G3": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
      });
      if (!s.cache()) bad.push("첫 기동 뒤 캐시 파일이 없다");
      stub.reset();
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (stub.embedInputs() !== 0) bad.push(`재시작인데 임베딩 입력이 ${stub.embedInputs()}건 (0 이어야)`);
        if (st.embed.cached !== CORPUS_DOCS) bad.push(`cached 가 ${st.embed.cached}`);
      });
      stub.reset();
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s, { OLLAMA_EMBED_MODEL: "other-model" }) }, async (get) => {
        await waitEmbedReady(get);
        if (stub.embedInputs() !== CORPUS_DOCS) bad.push(`모델이 바뀌었는데 입력이 ${stub.embedInputs()}건 (${CORPUS_DOCS} 이어야)`);
      });
      if (s.cache()?.model !== "other-model") bad.push(`캐시의 model 이 ${s.cache()?.model} (other-model 이어야)`);
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("재시작 시 임베딩 0건 · 모델 변경 시 전부");
    out("S27_G3_OK");
  },

  /* 깨진 JSON 은 옛 코퍼스로 버틴다. 고치면 회복. */
  "S27-G4": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4354, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        const v0 = (await status(get)).corpus.version;
        s.write("palettes.json", '{"palettes": [ {"id": "pair-01", "na');
        await settle();
        // 스텁 벡터는 정확 매칭에 동의하지 않아 단계·1위를 단정할 수 없다. 옛 코퍼스로 "계속 답하는가" 만 본다.
        const r = await search(get, "병원 앱인데 차갑지 않게");
        if (!Array.isArray(r.results) || r.results.length === 0) bad.push(`깨진 파일 뒤 검색이 빈손이다: ${JSON.stringify(r).slice(0, 120)}`);
        const st = await status(get);
        if (typeof st.corpus.error !== "string") bad.push("깨진 파일인데 error 가 없다");
        if (st.corpus.version !== v0) bad.push("깨진 파일로 version 이 올랐다");
        if (st.corpus.palettes !== 16) bad.push(`옛 코퍼스가 아니다: 팔레트 ${st.corpus.palettes}`);
        s.write("palettes.json", readFileSync(join(ROOT, "data/palettes.json"), "utf8") + "\n");
        await settle();
        await search(get, "병원 앱인데 차갑지 않게");
        const ok = await status(get);
        if (ok.corpus.error !== null) bad.push(`고쳤는데 error 가 남았다: ${ok.corpus.error}`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("깨진 JSON 에서 옛 코퍼스로 답하고 사유를 남김 · 고치면 회복");
    out("S27_G4_OK");
  },

  /* 지운 문서가 옛 벡터 창에서 안 나온다. 스텁 임베딩을 3초 늦춰 창을 넓힌다. */
  "S27-G5": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4355, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        const doc = s.read("palettes.json");
        const removed = doc.palettes.find((p) => p.id === "pair-10");
        // 질의 "zzqq" 는 코퍼스에 없어 BM25 가 빈손이고, 스텁이 그 질의에 pair-10 의 임베딩 문장 벡터를 돌려준다.
        // (임베딩 문장 모양은 palettes.js 의 embedText 사본이다 — 대상에서 가져오지 않는다)
        stub.set({ embedDelayMs: 3000, echo: `${removed.name}. ${removed.summary} ${removed.impression} ${removed.tags.join(" ")}` });
        if (!removed) bad.push("픽스처에 pair-10 이 없다 — 이 게이트가 헛돌고 있다");
        doc.palettes = doc.palettes.filter((p) => p.id !== "pair-10");
        // 삭제만 하면 남은 문서가 전부 캐시에 있어 임베딩 호출이 없고 옛 벡터 창도 없다. 하나를 고쳐 창을 연다.
        doc.palettes[0].summary = `${doc.palettes[0].summary} (창을 여는 수정)`;
        s.write("palettes.json", doc);
        await settle();
        // 재임베딩(3초)이 끝나기 전에 검색. 옛 벡터 창에서 pair-10 이 코사인 1 로 1위에 선다 — 필터가 없으면 반드시 새어 나온다.
        const r = await search(get, "zzqq");
        if (!Array.isArray(r.results)) bad.push(`검색이 깨졌다: ${JSON.stringify(r).slice(0, 160)}`);
        const ids = [...(r.results ?? []).map((x) => x.id), ...(r.diagnostics ?? []).map((x) => x.id)];
        out(`  창 안 검색: stage ${r.stage} route ${r.route} conf ${r.confident} hybrid ${JSON.stringify(r.hybrid)} err ${r.hybridError} ids ${ids.join(",")}`);
        if (ids.includes("pair-10")) bad.push(`지운 pair-10 이 결과에 있다: ${ids.join(",")}`);
        const st = await status(get);
        if (st.corpus.palettes !== 15) bad.push(`팔레트가 ${st.corpus.palettes} (15 여야)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("지운 문서가 옛 벡터 창에서도 안 나온다");
    out("S27_G5_OK");
  },

  /* 깨진 캐시는 옆으로 치우고 새로 만든다 · 캐시가 자라지 않는다. */
  "S27-G6": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      mkdirSync(s.data, { recursive: true });
      writeFileSync(join(s.data, CACHE_FILE), "{ not json", "utf8");
      await withServer(4356, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (st.embed.state !== "ready") bad.push("깨진 캐시로 기동이 안 됐다");
        if (!s.files().some((f) => f.startsWith(`${CACHE_FILE}.corrupt-`))) bad.push("깨진 캐시를 옆으로 안 치웠다");
        if (!s.cache() || Object.keys(s.cache().entries ?? {}).length !== CORPUS_DOCS) bad.push("새 캐시가 안 만들어졌다");
        for (const salt of ["a", "b"]) {
          const doc = s.read("palettes.json");
          doc.palettes[1].summary = `${doc.palettes[1].summary} ${salt}`;
          s.write("palettes.json", doc);
          await settle();
          await status(get); // 상태로 재적재를 일으킨다(질의 임베딩을 안 섞기 위해)
          await waitEmbedded(get, (x) => x.embed.embedded === 1);
        }
        const n = Object.keys(s.cache()?.entries ?? {}).length;
        if (n !== CORPUS_DOCS) bad.push(`캐시 항목이 ${n}개 (문서 수 ${CORPUS_DOCS} 여야 — 옛 해시가 남았다)`);
        // 삭제만 해도 디스크 캐시가 줄어야 한다. 처음 구현은 새로 만든 것이 있을 때만 써서 안 줄었다(리뷰 지적).
        const del = s.read("palettes.json");
        del.palettes = del.palettes.slice(0, 15);
        s.write("palettes.json", del);
        await settle();
        await status(get);
        await waitEmbedded(get, (x) => x.embed.count === CORPUS_DOCS - 1);
        const m = Object.keys(s.cache()?.entries ?? {}).length;
        if (m !== CORPUS_DOCS - 1) bad.push(`삭제만 한 뒤 디스크 캐시가 ${m}개 (${CORPUS_DOCS - 1} 이어야)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("깨진 캐시 → 옆으로 치우고 새로 · 항목 수 = 문서 수");
    out("S27_G6_OK");
  },

  /* 상태 필드 · 사다리 4 · 경계 · 경로 오버라이드가 실제로 쓰인다. */
  "S27-G7": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      const doc = s.read("palettes.json");
      doc.palettes = doc.palettes.slice(0, 15);
      s.write("palettes.json", doc);
      await withServer(4357, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (st.corpus?.palettes !== 15) bad.push(`TONEFIRST_CORPUS_DIR 이 안 쓰인다: 팔레트 ${st.corpus?.palettes}`);
        for (const k of ["version", "palettes", "diagnostics", "checkedAt", "reloadedAt", "error"]) if (!(k in (st.corpus ?? {}))) bad.push(`corpus.${k} 가 없다`);
        if (st.stage !== 4) bad.push(`stage 가 ${st.stage} (4 여야)`);
      });
      // 루프백 밖 — 정상 기동 뒤 깨뜨린다. 기동 시점에 깨진 코퍼스는 1단계 계약대로 기동 실패다.
      const server = await startServer(4358, { HOST: "0.0.0.0", OLLAMA_HOST: stub.host, ...env(s) });
      try {
        const get = (p) => fetch(`http://127.0.0.1:4358${p}`);
        await waitEmbedReady(get);
        s.write("palettes.json", "{ broken");
        await settle();
        await (await get("/api/status")).json(); // 확인을 일으킨다
        const st = await (await get("/api/status")).json();
        if (typeof st.corpus?.error !== "string") bad.push(`루프백 밖에서 error 가 문자열이 아니다 (${JSON.stringify(st.corpus?.error)})`);
        else if (st.corpus.error.includes(s.corpus) || /palettes\.json/.test(st.corpus.error)) bad.push(`루프백 밖인데 경로가 샌다: ${st.corpus.error}`);
      } finally {
        server.kill();
      }
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("corpus 필드 · stage 4 · 경계 · 오버라이드 실사용");
    out("S27_G7_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage27.mjs <${Object.keys(GATES).join("|")}>`);
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
