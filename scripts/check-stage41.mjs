#!/usr/bin/env node
// 41단계(LLM 을 Ollama 에서 Claude API 로 · 임베딩은 로컬 Ollama bge-m3 그대로) 완료 조건 검사기.
//   node scripts/check-stage41.mjs S41-G1
//
// 설계: docs/superpowers/specs/2026-09-29-claude-voyage-api-design.md (2026-09-30 부록 — 임베딩을 되돌린 결정)
// 가짜 Claude 는 scripts/lib/stub-apis.mjs — 서버가 **실제로 보낸 요청 본문**을 기록한다. 가짜 Ollama(임베딩)는 이 파일 안에 있다.
// 진짜 API 는 부르지 않는다. 게이트가 돌 때마다 돈이 나가면 안 된다.

// 41단계 — 게이트의 가짜 Ollama 번역 · 키 비우기(유료 호출 차단). 이 파일은 stub-apis 를 직접 쓴다.
import "./lib/ollama-shim.mjs";
import "./lib/retired.mjs";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "node:http";

import { startStubApis } from "./lib/stub-apis.mjs";
import { RETIRED } from "./lib/retired.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
      HYBRID_TRUST_UNMEASURED: "",
      // 진짜 `ollama serve` 를 띄우지 않는다 — 임베딩은 아래 가짜 Ollama 로만.
      OLLAMA_AUTOSTART: "0",
      OLLAMA_WARMUP: "0",
      ...env,
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
        child.log = () => stdout;
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
    return await fn(async (path, init) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
      return { status: res.status, json: await res.json().catch(() => null) };
    }, child);
  } finally {
    child.kill();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitEmbed(api, want = "ready") {
  for (let i = 0; i < 40; i++) {
    const { json } = await api("/api/status");
    if (json?.embed?.state === want) return json;
    await sleep(150);
  }
  throw new Error(`임베딩이 ${want} 가 되지 않았다`);
}

/** 가짜 Ollama — `/api/tags` 와 `/api/embed` 만. embed(text) 가 벡터를 정한다. 받은 요청을 기록한다. */
function stubOllamaEmbed(embed) {
  const log = [];
  const server = createServer((req, res) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(buf || "{}");
      } catch {
        body = {};
      }
      log.push({ path: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "bge-m3:latest" }] }));
      if (req.url === "/api/embed") return res.end(JSON.stringify({ embeddings: (body.input ?? []).map((t) => embed(t)) }));
      res.writeHead(404);
      return res.end("{}");
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ host: `127.0.0.1:${server.address().port}`, log, close: () => server.close() })),
  );
}

const seedId = () => JSON.parse(read("data/palettes.json")).palettes[0].id;
const structureIds = () => JSON.parse(read("data/structures.json")).structures.map((s) => s.id);
const finishIds = () => JSON.parse(read("data/finishes.json")).finishes.map((f) => f.id);

/** 요청 본문의 스키마를 보고 어느 호출부인지 가른다 — 답도 그에 맞게 준다. */
const kindOf = (body) => {
  const props = body?.output_config?.format?.schema?.properties ?? {};
  if (props.intent) return "rewrite";
  if (props.ids) return "structure";
  if (props.assignments) return "finish";
  if (props.parts) return "describe";
  return "unknown";
};

// 질의가 한 어절도 코퍼스에 안 걸리게 — 1단계가 확신하지 못하고 재작성·결합으로 넘어간다.
const LOW_Q = "zzqq qqzz 흐릿흐릿";

const GATES = {
  /** LLM 이 Ollama 를 안 부른다 — 네 호출부는 llm.js(Claude API)만 거친다. 임베딩만 Ollama 에 남는다. */
  "S41-G1": async () => {
    const bad = [];
    for (const file of ["src/rewrite.js", "src/describe.js", "src/structure.js", "src/finish.js", "src/llm.js"]) {
      const code = stripComments(read(file));
      for (const needle of ["BASE}/api/", "/api/chat", "/api/generate", "ollama.js", "OLLAMA_", "pickModel"]) {
        if (code.includes(needle)) bad.push(`${file} 에 ${needle}`);
      }
      if (file !== "src/llm.js" && !code.includes('from "./llm.js"')) bad.push(`${file} 가 llm.js 를 안 거친다`);
    }
    for (const file of ["server.js", ...readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`)]) {
      if (stripComments(read(file)).includes("/api/generate")) bad.push(`${file} 에 /api/generate — LLM 워밍업이 남았다`);
    }
    // 음성 대조 — 검사가 실제로 무언가를 읽는가
    if (!stripComments(read("src/llm.js")).includes("messages.create")) bad.push("llm.js 에서 messages.create 를 못 찾았다 — 이 게이트가 헛돌고 있다");
    if (!stripComments(read("src/embed.js")).includes("/api/embed")) bad.push("embed.js 가 Ollama /api/embed 를 안 부른다 — 임베딩은 로컬이어야 한다");
    return bad;
  },

  /** 네 호출부가 Claude API 에 모델 · 스키마 · 키를 담아 보내고, 답은 기존 파서가 그대로 읽는다. */
  "S41-G2": async () => {
    const bad = [];
    const ids = structureIds();
    const fin = finishIds();
    const stub = await startStubApis({
      reply: (body) => {
        switch (kindOf(body)) {
          case "rewrite":
            return JSON.stringify({ intent: "palette", terms: ["봄", "파스텔"] });
          case "structure":
            return JSON.stringify({ ids: [...ids].reverse() });
          case "finish": {
            const roles = Object.keys(body.output_config.format.schema.properties.assignments.properties);
            return JSON.stringify({ assignments: Object.fromEntries(roles.map((r) => [r, fin[fin.length - 1]])) });
          }
          case "describe":
            return JSON.stringify({ parts: { 피부: null, 머리: "red", 눈: null, 상의: null, 하의: null, 강조: null }, impression: "차가운 기사" });
          default:
            return "{}";
        }
      },
    });
    try {
      await withServer(4411, { ...stub.env, EMBED_PREPARE: "0" }, async (api) => {
        const s = (await api(`/api/search?q=${encodeURIComponent(LOW_Q)}`)).json;
        if (s?.rewrite?.model !== "claude-haiku-4-5") bad.push(`재작성 모델이 ${s?.rewrite?.model} (claude-haiku-4-5 여야)`);
        if (JSON.stringify(s?.rewrite?.terms) !== JSON.stringify(["봄", "파스텔"])) bad.push(`재작성어가 스텁 답과 다르다: ${JSON.stringify(s?.rewrite?.terms)}`);

        const e = (await api(`/api/expand?seed=${encodeURIComponent(seedId())}&q=${encodeURIComponent("가을 카페 브랜딩")}`)).json;
        if (e?.selection?.from !== "llm") bad.push(`구조 선택 from=${e?.selection?.from} (llm 이어야)`);
        if (e?.selection?.ids?.[0] !== [...ids].reverse()[0]) bad.push(`모델이 고른 첫 구조가 안 실렸다: ${e?.selection?.ids?.[0]}`);

        const c = (await api(`/api/character?q=${encodeURIComponent("빨간 머리의 차가운 기사")}`)).json;
        if (c?.parse?.from !== "llm") bad.push(`캐릭터 파서 from=${c?.parse?.from} (llm 이어야)`);
      });

      const kinds = stub.messages.map((m) => kindOf(m.body));
      for (const k of ["rewrite", "structure", "finish", "describe"]) if (!kinds.includes(k)) bad.push(`${k} 호출이 가짜 Claude 에 안 왔다 (${kinds.join(",")})`);
      for (const m of stub.messages) {
        const k = kindOf(m.body);
        if (m.body.model !== "claude-haiku-4-5") bad.push(`${k}: model=${m.body.model}`);
        if (m.headers["x-api-key"] !== "stub-anthropic-key") bad.push(`${k}: x-api-key 헤더가 키가 아니다`);
        const fmt = m.body.output_config?.format;
        if (fmt?.type !== "json_schema") bad.push(`${k}: output_config.format 이 json_schema 가 아니다`);
        if (fmt?.schema?.additionalProperties !== false) bad.push(`${k}: 스키마 최상위에 additionalProperties:false 가 없다`);
        if (typeof m.body.system !== "string" || m.body.system.length < 50) bad.push(`${k}: 시스템 프롬프트가 비었다`);
        const user = m.body.messages?.[0];
        if (user?.role !== "user" || typeof user.content !== "string" || !user.content) bad.push(`${k}: 사용자 문장이 user 자리에 없다`);
        if (m.body.system.includes(user?.content ?? "\u0000")) bad.push(`${k}: 사용자 문장이 시스템 프롬프트에 섞였다`);
      }
      if (stub.messages.length === 0) bad.push("가짜 Claude 가 한 번도 불리지 않았다 — 이 게이트가 헛돌고 있다");
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 임베딩은 로컬 Ollama(bge-m3)로 간다 — Voyage 등 외부 임베딩 API 를 부르지 않는다(2026-09-30 대표 결정). */
  "S41-G3": async () => {
    const bad = [];
    for (const file of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".js"))) {
      if (/voyage/i.test(stripComments(read(`src/${file}`)))) bad.push(`src/${file} 코드에 voyage`);
    }
    const stub = await startStubApis({});
    const ollama = await stubOllamaEmbed(() => [1, 0, 0]);
    try {
      await withServer(4412, { ...stub.env, OLLAMA_HOST: ollama.host, ANTHROPIC_API_KEY: "" }, async (api) => {
        const st = await waitEmbed(api);
        if (st.embed.model !== "bge-m3") bad.push(`임베딩 모델이 ${st.embed.model} (bge-m3 여야)`);
        await api(`/api/search?q=${encodeURIComponent(LOW_Q)}&rewrite=0`);
      });
      const embeds = ollama.log.filter((e) => e.path === "/api/embed");
      if (embeds.length < 2) bad.push(`가짜 Ollama 에 임베딩 요청이 ${embeds.length}건 (코퍼스 + 질의 2건 이상이어야)`);
      if (embeds.some((e) => e.body.model !== "bge-m3")) bad.push("Ollama 임베딩 요청의 모델이 bge-m3 가 아니다");
      if (stub.embeddings.length) bad.push(`외부 임베딩 API(/v1/embeddings)가 ${stub.embeddings.length}번 불렸다`);
    } finally {
      stub.close();
      ollama.close();
    }
    return bad;
  },

  /** 키가 없으면 1단계로 돌고 죽지 않는다. 루프백 밖에서는 사유가 숨는다. */
  "S41-G4": async () => {
    const bad = [];
    await withServer(4413, { ANTHROPIC_API_KEY: "", OLLAMA_HOST: "" }, async (api) => {
      const st = (await api("/api/status")).json;
      if (st?.stage !== 1) bad.push(`키 없이 stage=${st?.stage} (1 이어야)`);
      if (st?.llm?.state !== "unavailable" || !/ANTHROPIC_API_KEY/.test(st?.llm?.detail ?? "")) bad.push(`LLM 상태·사유가 이상하다: ${JSON.stringify(st?.llm)}`);
      const s = await api(`/api/search?q=${encodeURIComponent(LOW_Q)}`);
      if (s.status !== 200) bad.push(`키 없이 검색이 ${s.status}`);
      if (!/Claude 를 쓸 수 없다/.test(s.json?.rewriteError ?? "")) bad.push(`재작성 사유가 키 없음을 말하지 않는다: ${s.json?.rewriteError}`);
      const c = await api(`/api/character?q=${encodeURIComponent("빨간 머리 기사")}`);
      if (c.status !== 200 || c.json?.parse?.from !== "fallback") bad.push(`키 없이 캐릭터가 ${c.status} · from=${c.json?.parse?.from}`);
    });
    await withServer(4414, { ANTHROPIC_API_KEY: "", OLLAMA_HOST: "", HOST: "0.0.0.0" }, async (api) => {
      const st = (await api("/api/status")).json;
      if (JSON.stringify(Object.keys(st?.llm ?? {})) !== JSON.stringify(["state"])) bad.push(`루프백 밖에서 llm 이 state 말고도 낸다: ${JSON.stringify(st?.llm)}`);
      const s = (await api(`/api/search?q=${encodeURIComponent(LOW_Q)}`)).json;
      if (/ANTHROPIC|Claude 를/.test(s?.rewriteError ?? "")) bad.push(`루프백 밖에서 재작성 사유 원문이 나간다: ${s?.rewriteError}`);
    });
    return bad;
  },

  /**
   * 기준값을 잰 모델(bge-m3)이 아니면 임베딩으로는 확신하지 않는다 · bge-m3 면 확신한다(양성 대조).
   * 임베딩을 한때 Voyage 로 바꿨을 때 들인 안전장치다 — 모델을 또 바꾸면 저절로 다시 걸린다.
   */
  "S41-G5": async () => {
    const bad = [];
    if (!/export const THRESHOLDS_MEASURED_ON = "bge-m3"/.test(read("src/hybrid.js"))) bad.push("hybrid.js 의 THRESHOLDS_MEASURED_ON 이 bge-m3 가 아니다");
    // 코퍼스 첫 문서와 질의를 같은 벡터로, 나머지는 서로 다른 축으로 — 질의가 첫 문서로 확 튀어나온다.
    const axis = new Map();
    const vec = (i) => Array.from({ length: 64 }, (_, k) => (k === i % 64 ? 1 : 0));
    const embed = (text) => {
      if (text === "zzqq") return vec(0);
      if (!axis.has(text)) axis.set(text, axis.size);
      return vec(axis.get(text));
    };
    for (const model of ["other-embed-model", "bge-m3"]) {
      axis.clear();
      const ollama = await stubOllamaEmbed(embed);
      try {
        await withServer(4415, { OLLAMA_HOST: ollama.host, OLLAMA_EMBED_MODEL: model, ANTHROPIC_API_KEY: "", HYBRID_TRUST_UNMEASURED: "" }, async (api) => {
          await waitEmbed(api);
          // 전문 검색이 한 건도 못 잡는 질의 — 임베딩만이 증거다(어절이 걸리면 BM25 순위가 결합 1위를 바꾼다).
          const s = (await api(`/api/search?q=zzqq&rewrite=0`)).json;
          if (model !== "bge-m3" && s?.confident) bad.push(`안 잰 모델(${model})로 확신했다 (stage ${s?.stage} · route ${s?.route})`);
          if (model === "bge-m3" && !s?.confident) bad.push(`양성 대조 실패 — bge-m3 인데 확신 안 함 (stage ${s?.stage}) · 이 게이트가 헛돌고 있다`);
        });
      } finally {
        ollama.close();
      }
    }
    return bad;
  },

  /** 화면이 LLM 을 "로컬 · Ollama" 라고 부르지 않는다 — 상태 필은 Claude 상태를 말하고, `/api/status` 에 llm 이 있다. */
  "S41-G6": async () => {
    const bad = [];
    for (const f of ["public/index.html", "public/history.html", "public/saved.html"]) {
      const html = read(f);
      if (html.includes('id="runtime-where">로컬<')) bad.push(`${f} 의 런타임 필 기본 문구가 "로컬"`);
      if (html.includes("로컬 LLM")) bad.push(`${f} 에 "로컬 LLM"`);
    }
    const ui = stripComments(read("public/ui.js"));
    if (/Ollama 준비됨|Ollama 없음|Ollama 기동/.test(ui)) bad.push("public/ui.js 가 LLM 상태를 Ollama 로 말한다");
    if (!ui.includes("data.llm")) bad.push("ui.js 가 /api/status 의 llm 을 안 읽는다");
    await withServer(4416, { ANTHROPIC_API_KEY: "", OLLAMA_HOST: "" }, async (api) => {
      const st = (await api("/api/status")).json;
      if (!st?.llm) bad.push("/api/status 에 llm 이 없다");
      if (st?.llm?.state !== "unavailable") bad.push(`키 없이 llm.state=${st?.llm?.state}`);
    });
    return bad;
  },

  /** Vercel 위에서는 설정 없이 맞게 돈다 — 루프백으로 치지 않고, 저장 폴더는 /tmp. */
  "S41-G7": async () => {
    const bad = [];
    // DATA_DIR 은 모듈 적재 때 정해진다 — 자식 프로세스에서 본다. 쓰지는 않는다(윈도우에서 /tmp 는 드라이브 루트다).
    const probe = (env) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", `import("./src/store.js").then((m) => process.stdout.write(m.DATA_DIR))`], {
          cwd: ROOT,
          env: { ...process.env, TONEFIRST_DATA_DIR: "", ...env },
        });
        let s = "";
        child.stdout.on("data", (c) => (s += c));
        child.on("exit", () => resolve(s));
      });
    const onVercel = await probe({ VERCEL: "1" });
    if (onVercel !== "/tmp/tonefirst") bad.push(`VERCEL=1 인데 저장 폴더가 ${onVercel}`);
    const local = await probe({ VERCEL: "" });
    if (!/var[\\/]?$/.test(local)) bad.push(`로컬 저장 폴더가 var/ 가 아니다: ${local}`);
    await withServer(4417, { ANTHROPIC_API_KEY: "", OLLAMA_HOST: "", VERCEL: "1" }, async (api) => {
      const st = (await api("/api/status")).json;
      if (JSON.stringify(Object.keys(st?.llm ?? {})) !== JSON.stringify(["state"])) bad.push(`VERCEL=1 인데 llm 상세가 나간다: ${JSON.stringify(st?.llm)}`);
      if (st?.embed?.detail !== undefined) bad.push("VERCEL=1 인데 embed 사유가 나간다");
      if (st?.ollama?.host !== undefined || st?.ollama?.detail !== undefined) bad.push("VERCEL=1 인데 ollama 호스트·사유가 나간다");
    });
    return bad;
  },

  /** 한도를 넘으면 모델을 안 부르고 모델 없는 결과를 준다. 로컬에서는 x-forwarded-for 로 우회할 수 없다. */
  "S41-G8": async () => {
    const bad = [];
    const ids = structureIds();
    const stub = await startStubApis({
      reply: (body) => (kindOf(body) === "structure" ? JSON.stringify({ ids: [...ids].reverse() }) : "{}"),
    });
    try {
      await withServer(4418, { ...stub.env, EMBED_PREPARE: "0", LLM_RATE_PER_MIN: "2" }, async (api) => {
        const url = `/api/expand?seed=${encodeURIComponent(seedId())}&q=${encodeURIComponent("가을 카페 브랜딩")}`;
        const first = await api(url);
        const second = await api(url, { headers: { "x-forwarded-for": "203.0.113.9" } });
        if (first.status !== 200 || second.status !== 200) bad.push(`한도에서 오류 응답: ${first.status}·${second.status} (200 이어야 — 모델 없이 물러선다)`);
        if (stub.messages.length !== 2) bad.push(`모델 호출이 ${stub.messages.length}회 (한도 2 — 첫 펼치기의 구조·재질 둘만)`);
        if (second.json?.selection?.from !== "fallback") bad.push(`한도 뒤 구조 선택 from=${second.json?.selection?.from} (fallback 이어야)`);
        if (first.json?.selection?.from !== "llm") bad.push(`양성 대조 — 한도 안의 첫 요청이 모델을 안 썼다 (${first.json?.selection?.from})`);
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 은퇴한 게이트는 GATES.md 에 이유와 함께 적혀 있고, 실행하면 RETIRED 를 찍는다. */
  "S41-G9": async () => {
    const bad = [];
    const gates = read("GATES.md");
    let count = 0;
    for (const [script, entries] of Object.entries(RETIRED)) {
      for (const id of Object.keys(entries)) {
        count += 1;
        const at = gates.indexOf(`\n${id} `);
        if (at < 0) {
          bad.push(`GATES.md 에 ${id} 가 없다`);
          continue;
        }
        const block = gates.slice(at, gates.indexOf("EXPECT:", at) + 60);
        if (!block.includes("41단계로 은퇴")) bad.push(`GATES.md 의 ${id} 에 "41단계로 은퇴" 표시가 없다`);
        if (!block.includes(`${id.replace(/-/g, "_")}_RETIRED`)) bad.push(`GATES.md 의 ${id} EXPECT 가 _RETIRED 가 아니다`);
        if (!block.includes(`scripts/${script}`)) bad.push(`${id} 의 CHECK 가 ${script} 가 아니다`);
      }
    }
    if (count === 0) bad.push("은퇴 목록이 비었다 — 이 게이트가 헛돌고 있다");
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
