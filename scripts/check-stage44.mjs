#!/usr/bin/env node
// 44단계(검색 장치 걷어내기) 완료 조건 검사기.
//   node scripts/check-stage44.mjs S44-G1
//
// 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md 4절(44단계)
// 가짜 Claude 는 scripts/lib/stub-apis.mjs — 서버가 **실제로 보낸 요청 본문**을 기록한다. 진짜 API 는 부르지 않는다.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStubApis } from "./lib/stub-apis.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REMOVED = ["bm25", "hybrid", "embed", "ollama", "pipeline", "rewrite", "vocabulary", "stopwords", "tokenize"];

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
      LLM_MAX_RETRIES: "0",
      ANTHROPIC_API_KEY: "",
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
    const api = async (path, body) => {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    return await fn(api, child);
  } finally {
    child.kill();
  }
}

const propsOf = (body) => body?.output_config?.format?.schema?.properties ?? {};
const isIntent = (body) => Boolean(propsOf(body).usage && propsOf(body).base);
const isDescribe = (body) => Boolean(propsOf(body).parts);

/** 가짜 Claude — 의도 질문에는 intent, 캐릭터 파서에는 describe, 나머지(구조 · 재질)는 빈 답. */
const stub = ({ intent = null, describe = null } = {}) =>
  startStubApis({
    reply: (body) => (isIntent(body) && intent ? JSON.stringify(intent) : isDescribe(body) && describe ? JSON.stringify(describe) : "{}"),
  });

const INTENT = { kind: "palette", usage: "general", count: 5, base: { hues: ["blue"], tone: "soft" }, accent: null, temperature: "neutral", contrast: "medium", avoid: [], reading: "읽음", basis: "new", diagnosis: null };
const ids = (await import("../src/diagnostics.js")).loadDiagnostics().map((d) => d.id);
const pairIds = (await import("../src/palettes.js")).loadPalettes().map((p) => p.id);

const GATES = {
  /** 검색 장치가 없다 — 모듈 파일 · 불러오기 · Ollama 호스트 · 임베딩 경로 · 프로세스 띄우기가 없고, `/api/search` 는 404. */
  "S44-G1": async () => {
    const bad = [];
    for (const m of REMOVED) if (existsSync(join(ROOT, "src", `${m}.js`))) bad.push(`src/${m}.js 가 남아 있다`);
    const files = ["server.js", ...readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`), ...readdirSync(join(ROOT, "public")).filter((f) => f.endsWith(".js")).map((f) => `public/${f}`)];
    for (const f of files) {
      const code = stripComments(read(f));
      for (const m of REMOVED) if (new RegExp(`["'./]${m}\\.js["']`).test(code)) bad.push(`${f} 가 ${m}.js 를 부른다`);
      for (const [pat, why] of [[/11434/, "Ollama 포트"], [/\/api\/embed/, "임베딩 경로"], [/bge-m3/, "임베딩 모델"], [/\bspawn\(/, "프로세스 띄우기"], [/OLLAMA_/, "Ollama 환경변수"]]) if (pat.test(code)) bad.push(`${f} 에 ${why}(${pat})`);
    }
    if (existsSync(join(ROOT, "scripts", "search.mjs"))) bad.push("scripts/search.mjs(검색 CLI)가 남아 있다");
    await withServer(4441, {}, async (api, child) => {
      const s = await api("/api/search?q=%EB%B4%84");
      if (s.status !== 404) bad.push(`/api/search 가 ${s.status} (404 여야)`);
      if (/Ollama|임베딩/.test(child.log())) bad.push(`기동 기록에 Ollama · 임베딩이 나온다: ${child.log().trim()}`);
    });
    return bad;
  },

  /** 의도의 진단 칸 — 스키마는 지금 진단표 id 의 enum(또는 null) · 시스템 프롬프트에 id 와 증상 · 검증은 모양만, 색 키에 안 닿는다. */
  "S44-G2": async () => {
    const bad = [];
    const I = await import("../src/intent.js");
    const C = await import("../src/compose.js");
    const d = I.INTENT_SCHEMA.properties.diagnosis;
    const en = d?.anyOf?.find((x) => x.type === "string")?.enum;
    if (JSON.stringify(en) !== JSON.stringify(ids)) bad.push(`진단 칸 enum 이 진단표 id 와 다르다 (${en?.length} vs ${ids.length})`);
    if (!d?.anyOf?.some((x) => x.type === "null")) bad.push("진단 칸이 null 을 못 받는다");
    if (!I.INTENT_SCHEMA.required.includes("diagnosis")) bad.push("진단 칸이 required 가 아니다");
    const custom = I.intentSchema(["dx-a", "dx-b"]).properties.diagnosis.anyOf[0].enum;
    if (JSON.stringify(custom) !== JSON.stringify(["dx-a", "dx-b"])) bad.push("intentSchema 가 넘긴 목록을 안 쓴다 — 코퍼스가 바뀌면 낡는다");
    const diags = (await import("../src/diagnostics.js")).loadDiagnostics();
    const sys = I.systemPrompt(diags);
    for (const x of diags) if (!sys.includes(x.id) || !sys.includes(x.symptom)) bad.push(`시스템 프롬프트에 ${x.id} · 증상이 없다`);
    if (I.systemPrompt(diags) !== sys) bad.push("시스템 프롬프트가 같은 코퍼스에서 다르게 나온다");
    const base = { kind: "diagnosis", base: { hues: ["blue"], tone: "soft" } };
    for (const [label, v, want] of [["정상", "dx-muddy", "dx-muddy"], ["대문자", "DX-MUDDY", null], ["경로", "../x", null], ["배열", ["dx-muddy"], null], ["숫자", 3, null], ["긺", "dx-" + "a".repeat(50), null]]) {
      const got = C.parseIntent({ ...base, diagnosis: v })?.diagnosis;
      if (got !== want) bad.push(`진단 칸 ${label}: ${got} (기대 ${want})`);
    }
    if (C.intentKey(C.parseIntent({ ...base, diagnosis: "dx-muddy" })) !== C.intentKey(C.parseIntent(base))) bad.push("진단 칸이 저장 키에 닿는다");
    return bad;
  },

  /** 진단 경로 — Claude 가 고른 id 가 맨 앞(from llm) · 연결 조합이 실린다 · 진단표에 없는 id 는 버리고 되묻는다 · 진단 답과 홈에 "축" 이 없다. */
  "S44-G3": async () => {
    const bad = [];
    let s = await stub({ intent: { ...INTENT, kind: "diagnosis", diagnosis: "dx-clinical" } });
    try {
      await withServer(4442, s.env, async (api) => {
        // **별칭과 Claude 의 선택이 다른 문장이어야 한다** — "탁해요" 의 별칭은 dx-muddy, Claude 는 dx-clinical 을 고른다.
        // 처음엔 "병원 같아요"(별칭도 dx-clinical)를 써서 "별칭이 앞" 변형이 살아남았다(변형 검사).
        const t = (await api("/api/chat", { text: "색이 너무 탁해요" })).json?.turn;
        const p = t?.payload;
        if (t?.route !== "diagnosis" || p?.kind !== "diagnosis" || p?.from !== "llm") bad.push(`진단 답이 ${t?.route}/${p?.kind}/${p?.from}`);
        if (p?.diagnostics?.[0]?.id !== "dx-clinical") bad.push(`Claude 가 고른 진단이 맨 앞이 아니다 (${p?.diagnostics?.map((d) => d.id)})`);
        if (p?.diagnostics?.[1]?.id !== "dx-muddy") bad.push(`별칭 진단이 둘째로 안 따라온다 (${p?.diagnostics?.map((d) => d.id)})`);
        if (!p?.diagnostics?.every((d) => d.bridge && Array.isArray(d.bridge.palettes))) bad.push("진단에 연결(bridge)이 없다");
        if (p?.diagnostics?.some((d) => "score" in d || "matched" in d)) bad.push("진단 답에 검색 점수 흔적(score · matched)이 남았다");
        for (const d of p?.diagnostics ?? []) for (const f of ["symptom", "axis", "prescription", "detail"]) if (String(d[f]).replace(/수축/g, "").includes("축")) bad.push(`${d.id}.${f} 에 "축"`);
      });
    } finally {
      s.close();
    }
    s = await stub({ intent: { ...INTENT, kind: "diagnosis", diagnosis: "dx-nope" } });
    try {
      await withServer(4443, s.env, async (api) => {
        const t = (await api("/api/chat", { text: "내가 만든 포스터 색 조합이 어딘가 어색해" })).json?.turn;
        if (t?.kind !== "ask" || t?.reason !== "unclear") bad.push(`진단표에 없는 id 인데 ${t?.kind}/${t?.reason} (되묻기여야)`);
      });
    } finally {
      s.close();
    }
    const home = read("public/index.html").replace(/수축/g, "");
    if (home.includes("축")) bad.push('홈 HTML 에 "축"');
    return bad;
  },

  /** 캐릭터 배색 쌍 — 파서가 16쌍 목록(enum)에서 고른 쌍을 쓴다(from llm) · 목록 밖 · 빈 답이면 기본 쌍(from fallback) · 스키마 · 프롬프트에 지금 목록. */
  "S44-G4": async () => {
    const bad = [];
    const D = await import("../src/describe.js");
    const { loadCharacterWords } = await import("../src/color-words.js");
    const words = loadCharacterWords();
    const sch = D.descriptionSchema(words, pairIds).properties.pair;
    if (JSON.stringify(sch?.anyOf?.[0]?.enum) !== JSON.stringify(pairIds)) bad.push("파서 스키마의 pair enum 이 16쌍 id 가 아니다");
    const pairs = (await import("../src/palettes.js")).loadPalettes();
    const sys = D.systemPrompt(words, pairs);
    for (const p of pairs) if (!sys.includes(p.id) || !sys.includes(p.name)) bad.push(`파서 프롬프트에 ${p.id} · ${p.name} 이 없다`);
    const parts = { 피부: null, 머리: "red", 눈: null, 상의: "black", 하의: null, 강조: null };
    for (const [label, pair, wantId, wantFrom] of [["목록 안", "pair-05", "pair-05", "llm"], ["목록 밖", "pair-99", "pair-01", "fallback"], ["null", null, "pair-01", "fallback"], ["__proto__", "__proto__", "pair-01", "fallback"]]) {
      const s = await stub({ describe: { parts, impression: "차가운 기사", pair } });
      try {
        await withServer(4444, s.env, async (api) => {
          const c = (await api(`/api/character?q=${encodeURIComponent("빨간 머리에 검은 갑옷 기사")}`)).json;
          if (c?.palette?.id !== wantId || c?.palette?.from !== wantFrom) bad.push(`${label}: 배색 쌍 ${c?.palette?.id}(${c?.palette?.from}) (기대 ${wantId}(${wantFrom}))`);
          if ("route" in (c?.palette ?? {}) || "confident" in (c?.palette ?? {})) bad.push(`${label}: 배색 쌍에 검색 흔적(route · confident)`);
        });
        const asked = s.messages.find((m) => isDescribe(m.body));
        if (!asked) bad.push(`${label}: 파서 호출이 없다`);
        else if (JSON.stringify(propsOf(asked.body).pair?.anyOf?.[0]?.enum) !== JSON.stringify(pairIds)) bad.push(`${label}: 보낸 스키마에 16쌍 enum 이 없다`);
      } finally {
        s.close();
      }
    }
    return bad;
  },

  /** 못 읽음 — 모델 답이 의도가 아니면 추천은 `unavailable`(지어낸 답 없음) · 기록은 topKind 없음 · 화면은 색 코드를 권한다. */
  "S44-G5": async () => {
    const bad = [];
    const s = await stub({ intent: { hello: "world" } });
    const dir = gateDataDir();
    try {
      await withServer(4445, { ...s.env, TONEFIRST_DATA_DIR: dir }, async (api) => {
        const r = (await api("/api/chat", { text: "봄 파스텔 카페" })).json;
        const t = r?.turn;
        if (t?.kind !== "answer" || t?.payload?.kind !== "unavailable") bad.push(`엉뚱한 답에 ${t?.kind}/${t?.payload?.kind} (answer/unavailable 여야)`);
        if (t?.payload?.palettes || t?.payload?.results) bad.push("못 읽었는데 색을 실었다");
        const conv = (await api(`/api/conversations?id=${encodeURIComponent(r?.conversationId)}`)).json?.conversation;
        const last = conv?.turns?.at(-1);
        if (last?.topKind !== null || last?.usedLlm !== false) bad.push(`기록이 ${JSON.stringify({ topKind: last?.topKind, usedLlm: last?.usedLlm })}`);
      });
    } finally {
      s.close();
    }
    const app = read("public/app.js");
    const block = app.match(/function unavailableBlock\(data\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    if (!/색 코드/.test(block)) bad.push("못 읽은 답이 색 코드를 권하지 않는다");
    if (/api\(/.test(block)) bad.push("못 읽은 답이 다른 요청을 부른다");
    return bad;
  },

  /** 코퍼스 다시 읽기(27단계 보장) — 별칭을 더해 저장하면 재시작 없이 채팅 진단이 잡고 version 이 오른다 · 깨진 JSON 이면 옛 것으로 답하고 사유를 남긴다 · 루프백 밖에서는 사유를 숨긴다. */
  "S44-G6": async () => {
    const bad = [];
    const corpus = mkdtempSync(join(tmpdir(), "tonefirst-corpus-"));
    cpSync(join(ROOT, "data", "palettes.json"), join(corpus, "palettes.json"));
    cpSync(join(ROOT, "data", "diagnostics.json"), join(corpus, "diagnostics.json"));
    const NEW = "삐걱삐걱";
    await withServer(4446, { TONEFIRST_CORPUS_DIR: corpus }, async (api) => {
      const before = (await api("/api/chat", { text: `${NEW}해요` })).json?.turn;
      if (before?.payload?.kind === "diagnosis" && before.payload.diagnostics.some((d) => d.id === "dx-muddy")) bad.push("더하기 전에 이미 잡힌다 — 검사 전제가 틀렸다");
      const v1 = (await api("/api/status")).json?.corpus?.version;
      const raw = JSON.parse(readFileSync(join(corpus, "diagnostics.json"), "utf8"));
      raw.diagnostics.find((d) => d.id === "dx-muddy").aliases.push(NEW);
      writeFileSync(join(corpus, "diagnostics.json"), JSON.stringify(raw, null, 2));
      await sleep(2300);
      const after = (await api("/api/chat", { text: `${NEW}해요`, fresh: true })).json?.turn;
      if (after?.payload?.kind !== "diagnosis" || after.payload.diagnostics[0]?.id !== "dx-muddy") bad.push(`별칭을 더했는데 채팅이 못 잡는다 (${after?.kind}/${after?.payload?.kind})`);
      const v2 = (await api("/api/status")).json?.corpus?.version;
      if (v2 !== v1 + 1) bad.push(`version 이 ${v1} → ${v2} (1 올라야)`);

      writeFileSync(join(corpus, "diagnostics.json"), "{ 깨진");
      await sleep(2300);
      const broken = (await api("/api/chat", { text: `${NEW}해요`, fresh: true })).json?.turn;
      if (broken?.payload?.diagnostics?.[0]?.id !== "dx-muddy") bad.push("깨진 파일 뒤에 옛 코퍼스로 답하지 않는다");
      const st = (await api("/api/status")).json?.corpus;
      if (!st?.error) bad.push("깨진 파일인데 corpus.error 가 비었다");
    });
    // 깨진 코퍼스로는 기동하지 않는다 — 스택 트레이스가 아니라 "기동 실패" 한 줄로(서버가 코퍼스를 검사한다).
    const boot = spawnSync(process.execPath, ["server.js"], { cwd: ROOT, encoding: "utf8", timeout: 8000, env: { ...process.env, TONEFIRST_CORPUS_DIR: corpus, PORT: "4447", ANTHROPIC_API_KEY: "", TONEFIRST_DATA_DIR: gateDataDir() } });
    if (boot.status !== 1) bad.push(`깨진 코퍼스로 기동했는데 종료 코드 ${boot.status} (1 이어야)`);
    if (!boot.stderr.includes("기동 실패") || /\n\s+at /.test(boot.stderr)) bad.push(`깨진 코퍼스 기동 실패가 한 줄이 아니다: ${boot.stderr.trim().slice(0, 120)}`);

    // 루프백 밖 — 정상으로 띄운 뒤 파일을 깨면 사유는 남되 원문(파일 경로)은 숨긴다. llm 은 state 만.
    cpSync(join(ROOT, "data", "diagnostics.json"), join(corpus, "diagnostics.json"));
    await withServer(4447, { TONEFIRST_CORPUS_DIR: corpus, HOST: "0.0.0.0" }, async (api) => {
      writeFileSync(join(corpus, "diagnostics.json"), "{ 깨진");
      await sleep(2300);
      const st = (await api("/api/status")).json;
      if (!st?.corpus?.error) bad.push("루프백 밖: 깨진 파일인데 corpus.error 가 비었다(양성 대조)");
      else if (st.corpus.error !== "코퍼스 파일을 읽을 수 없습니다") bad.push(`루프백 밖에서 코퍼스 사유 원문이 샌다: ${st.corpus.error.slice(0, 80)}`);
      if (st?.llm && Object.keys(st.llm).join() !== "state") bad.push(`루프백 밖에서 llm 이 ${Object.keys(st.llm)}`);
    });
    return bad;
  },

  /** 키 없음 — 상태는 llm · corpus 만(stage · embed · ollama 없음) · 추천은 못 읽음 · 진단 별칭 · 색 · 캐릭터(기본 쌍)는 돈다. */
  "S44-G7": async () => {
    const bad = [];
    await withServer(4448, {}, async (api) => {
      const st = (await api("/api/status")).json;
      for (const k of ["stage", "embed", "ollama"]) if (k in (st ?? {})) bad.push(`/api/status 에 ${k} 가 남았다`);
      if (st?.llm?.state !== "unavailable") bad.push(`키 없이 llm.state=${st?.llm?.state}`);
      const cases = [
        ["봄 파스텔 카페", (t) => t?.payload?.kind === "unavailable", "unavailable"],
        ["색이 너무 탁해요", (t) => t?.payload?.kind === "diagnosis" && t.payload.from === "alias" && t.payload.diagnostics[0]?.id === "dx-muddy", "별칭 진단 dx-muddy"],
        ["#E07A5F", (t) => t?.route === "color", "색 경로"],
        ["빨간 머리에 검은 갑옷을 입은 기사", (t) => t?.route === "character" && t.payload.palette.from === "fallback", "캐릭터 기본 쌍"],
      ];
      for (const [text, ok, want] of cases) {
        const t = (await api("/api/chat", { text })).json?.turn;
        if (!ok(t)) bad.push(`키 없음 "${text}": ${t?.kind}/${t?.route}/${t?.payload?.kind ?? ""} (${want} 여야)`);
      }
    });
    return bad;
  },

  /** 보이지 않는 문자만 있는 질의 — 채팅은 400 · 펼치기 구조 · 재질 고르기는 모델을 안 부른다(폭 0 문자는 지우는 것, 섞인 진짜 질의는 간다). */
  "S44-G8": async () => {
    const bad = [];
    const INVISIBLE = ["​", "⁠​", "﻿ ‍"];
    const s = await stub({ intent: INTENT });
    try {
      await withServer(4449, s.env, async (api) => {
        for (const q of INVISIBLE) {
          const r = await api("/api/chat", { text: q });
          if (r.status !== 400) bad.push(`채팅이 보이지 않는 질의 ${JSON.stringify(q)} 에 ${r.status} (400 이어야)`);
          const e = await api(`/api/expand?seed=pair-01&q=${encodeURIComponent(q)}`);
          if (e.json?.selection?.from === "llm" || e.json?.finishes?.from === "llm") bad.push(`펼치기가 보이지 않는 질의 ${JSON.stringify(q)} 에 모델을 썼다`);
        }
        if (s.messages.length) bad.push(`보이지 않는 질의에 모델을 ${s.messages.length}번 불렀다`);
        // 양성 대조 — 섞인 진짜 질의는 그 문자만 빠진 채 간다
        await api("/api/chat", { text: "봄​ 파스텔" });
        const asked = s.messages.find((m) => isIntent(m.body));
        if (asked?.body?.messages?.[0]?.content !== "봄 파스텔") bad.push(`섞인 질의가 ${JSON.stringify(asked?.body?.messages?.[0]?.content)} 로 갔다 ("봄 파스텔" 이어야)`);
      });
    } finally {
      s.close();
    }
    return bad;
  },

  /** 화면 · 문서 — 상태 배지에 BM25 가 없다 · 화면 코드에 임베딩 · 사다리 흔적이 없다 · 내역이 "N단계" 가 아니라 Claude/규칙 · README 가 검색 실험을 끝냈다고 말한다. */
  "S44-G9": async () => {
    const bad = [];
    for (const f of ["public/index.html", "public/history.html", "public/saved.html"]) {
      const html = read(f);
      if (/runtime__name">\s*BM25/.test(html)) bad.push(`${f} 상태 배지가 BM25`);
      if (/몇 단계/.test(html)) bad.push(`${f} 에 "몇 단계"`);
    }
    const ui = stripComments(read("public/ui.js"));
    if (/embed|임베딩/.test(ui)) bad.push("ui.js 에 임베딩 흔적");
    const app = stripComments(read("public/app.js"));
    for (const name of ["searchBlock", "resultCard", "expansionSection", "/api/search", "BM25", "hybrid"]) if (app.includes(name)) bad.push(`app.js 에 ${name}`);
    const history = stripComments(read("public/history.js"));
    if (/단계`/.test(history)) bad.push('history.js 가 아직 "N단계" 를 그린다');
    const readme = read("README.md");
    if (!/실험은 2026-10-02 에 끝냈다/.test(readme)) bad.push("README 가 검색 실험 종료를 말하지 않는다");
    if (/로컬 Ollama\(bge-m3\)라 서버가 켜질 때 Ollama 를 띄운다/.test(readme)) bad.push("README 가 아직 Ollama 를 띄운다고 말한다");
    return bad;
  },

  /** 은퇴 기록 — 44단계로 은퇴한 게이트가 GATES.md 에 이유 · `_RETIRED` · 제 스크립트로 적혀 있고, 실제로 `_RETIRED` 를 찍는다. */
  "S44-G10": async () => {
    const bad = [];
    const { RETIRED_44 } = await import("./lib/retired.mjs");
    const gates = read("GATES.md");
    let count = 0;
    for (const [script, entries] of Object.entries(RETIRED_44)) {
      for (const id of Object.keys(entries)) {
        count += 1;
        const at = gates.indexOf(`\n${id} `);
        if (at < 0) {
          bad.push(`GATES.md 에 ${id} 가 없다`);
          continue;
        }
        const block = gates.slice(at, gates.indexOf("EXPECT:", at) + 60);
        if (!block.includes("44단계로 은퇴")) bad.push(`${id} 에 "44단계로 은퇴" 표시가 없다`);
        if (!block.includes(`${id.replace(/-/g, "_")}_RETIRED`)) bad.push(`${id} EXPECT 가 _RETIRED 가 아니다`);
        if (!block.includes(`scripts/${script}`)) bad.push(`${id} 의 CHECK 가 ${script} 가 아니다`);
        const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), id], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
        if (!r.stdout.includes(`${id.replace(/-/g, "_")}_RETIRED`) || r.status !== 0) bad.push(`${id} 을 돌리면 _RETIRED 가 아니다 (${(r.stdout + r.stderr).trim().slice(0, 80)})`);
      }
    }
    if (count < 50) bad.push(`은퇴 목록이 ${count}개뿐이다 — 이 게이트가 헛돌고 있다`);
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
