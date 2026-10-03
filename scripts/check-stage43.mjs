#!/usr/bin/env node
// 43단계(대화로 다듬기) 완료 조건 검사기.
//   node scripts/check-stage43.mjs S43-G1
//
// 설계: docs/superpowers/specs/2026-10-02-intent-palette-design.md 6절
// 가짜 Claude 는 scripts/lib/stub-apis.mjs — 서버가 **실제로 보낸 요청 본문**을 기록한다. 진짜 API 는 부르지 않는다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStubApis } from "./lib/stub-apis.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

const C = await import("../src/compose.js");

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
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    return await fn(api);
  } finally {
    child.kill();
  }
}

const isIntentAsk = (body) => {
  const p = body?.output_config?.format?.schema?.properties ?? {};
  return Boolean(p.usage && p.base);
};
const userOf = (m) => m.body.messages?.[0]?.content ?? "";
const hasPrevious = (m) => userOf(m).includes("<previous_intent>");

/** 첫 의도(직전 의도 없음)는 A, 직전 의도가 실려 오면 B. 재작성 질문에는 팔레트 재작성어. */
const stubAB = (A, B) =>
  startStubApis({
    reply: (body) => {
      if (isIntentAsk(body)) return JSON.stringify(String(body.messages?.[0]?.content ?? "").includes("<previous_intent>") ? B : A);
      if (body?.output_config?.format?.schema?.properties?.terms) return JSON.stringify({ intent: "palette", terms: ["봄", "파스텔"] });
      return "{}";
    },
  });

const A = { kind: "palette", usage: "ui", count: 5, base: { hues: ["blue", "cyan"], tone: "strong" }, accent: { hue: "orange", tone: "bright" }, temperature: "cool", contrast: "high", avoid: [], reading: "신뢰감 있는 파랑", basis: "new" };
const B = { ...A, base: { hues: ["cyan", "orange"], tone: "strong" }, temperature: "warm", avoid: ["blue"], reading: "따뜻하게, 파랑 뺌", basis: "refine" };

/** 첫 턴을 보내고 대화 id 를 돌려준다. */
async function firstTurn(api, text = "핀테크 대시보드") {
  const r = (await api("/api/chat", { text })).json;
  return r?.conversationId;
}

const hexes = (ps) => (ps ?? []).map((p) => p.colors.map((c) => c.hex).join()).join("|");

const GATES = {
  /** basis 검증 — 기본 new · 모르는 값은 new · refine 은 남는다 · 색 키(intentKey)에 안 닿는다 · 직전 의도가 없으면 refine 이라고 해도 new. */
  "S43-G1": async () => {
    const bad = [];
    const base = { kind: "palette", base: { hues: ["blue"], tone: "vivid" } };
    for (const [label, v, want] of [["없음", undefined, "new"], ["refine", "refine", "refine"], ["new", "new", "new"], ["모름", "edit", "new"], ["배열", ["refine"], "new"], ["__proto__", "__proto__", "new"]]) {
      const got = C.parseIntent({ ...base, basis: v })?.basis;
      if (got !== want) bad.push(`basis ${label}: ${got} (기대 ${want})`);
    }
    if (C.intentKey(C.parseIntent({ ...base, basis: "refine" })) !== C.intentKey(C.parseIntent({ ...base, basis: "new" }))) bad.push("basis 가 저장 키를 바꾼다 — 같은 색이 다른 항목이 된다");

    const stub = await stubAB({ ...A, basis: "refine" }, B);
    try {
      await withServer(4431, stub.env, async (api) => {
        const p = (await api("/api/chat", { text: "핀테크 대시보드" })).json?.turn?.payload;
        if (p?.kind !== "generated") bad.push(`첫 턴이 generated 가 아니다 (${p?.kind})`);
        if (p?.intent?.basis !== "new") bad.push(`직전 의도가 없는데 basis=${p?.intent?.basis} (new 여야)`);
        if (p?.refine) bad.push("직전 의도가 없는데 바뀐 것 칩이 생겼다");
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 바뀐 것 칩 — 칸마다 맞고, 같으면 비고, 색에 안 닿는 칸(kind · reading · basis)은 안 본다. */
  "S43-G2": async () => {
    const bad = [];
    const a = C.parseIntent(A);
    const cases = [
      ["쓰임새", { usage: "illustration" }, ["쓰임새 UI→일러스트"]],
      ["개수", { count: 3 }, ["색 5→3"]],
      ["바탕 색", { base: { hues: ["green"], tone: "strong" } }, ["바탕 색 파랑·하늘→초록"]],
      ["바탕 톤", { base: { hues: ["blue", "cyan"], tone: "pale" } }, ["바탕 톤 강한→아주 연한"]],
      ["포인트 없앰", { accent: null }, ["포인트 주황 밝은→없음"]],
      ["포인트 톤", { accent: { hue: "orange", tone: "vivid" } }, ["포인트 주황 밝은→주황 선명한"]],
      ["온도", { temperature: "warm" }, ["온도 차갑게→따뜻하게"]],
      ["대비", { contrast: "low" }, ["대비 강하게→약하게"]],
      ["뺀 색 더함", { avoid: ["red", "green"] }, ["뺀 색 +빨강", "뺀 색 +초록"]],
      ["색과 무관한 칸만", { reading: "다른 말", kind: "other", basis: "refine" }, []],
    ];
    for (const [label, over, want] of cases) {
      const got = C.diffIntent(a, C.parseIntent({ ...A, ...over }));
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${label}: ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`);
    }
    const removed = C.diffIntent(C.parseIntent({ ...A, avoid: ["red"] }), a);
    if (JSON.stringify(removed) !== JSON.stringify(["뺀 색 −빨강"])) bad.push(`뺀 색 지움: ${JSON.stringify(removed)}`);
    const many = C.diffIntent(a, C.parseIntent(B));
    for (const want of ["바탕 색 파랑·하늘→하늘·주황", "온도 차갑게→따뜻하게", "뺀 색 +파랑"]) if (!many.includes(want)) bad.push(`A→B 에 "${want}" 가 없다 (${many})`);
    if (many.some((m) => /#[0-9A-F]{6}/i.test(m))) bad.push("칩에 헥스가 섞였다");
    return bad;
  },

  /** 고른 안이 맨 앞 — 그 안은 compose(의도, 안) 그대로, 나머지는 composeAll 순서, 같은 안은 한 번만. */
  "S43-G3": async () => {
    const bad = [];
    const samples = [A, B, { ...A, usage: "general", count: 6 }, { ...A, base: { hues: ["neutral"], tone: "grayish" }, accent: null }].map((x) => C.parseIntent(x));
    for (const it of samples)
      for (const focus of [0, 1, 2]) {
        const ps = C.composeFocused(it, focus);
        const want = C.compose(it, focus).colors.map((c) => c.hex).join();
        if (ps[0]?.variant !== focus || ps[0].colors.map((c) => c.hex).join() !== want) bad.push(`${it.usage} ${it.base.hues}: 고른 안 ${focus} 이 맨 앞이 아니다 (${ps[0]?.variant})`);
        const keys = ps.map((p) => p.colors.map((c) => c.hex).join());
        if (new Set(keys).size !== keys.length) bad.push(`${it.usage} ${it.base.hues} 고른 안 ${focus}: 같은 안이 두 번`);
        const restOrder = ps.slice(1).map((p) => p.variant);
        const expected = C.composeAll(it).map((p) => p.variant).filter((v) => v !== focus && restOrder.includes(v));
        if (JSON.stringify(restOrder) !== JSON.stringify(expected)) bad.push(`나머지 순서 ${restOrder} (기대 ${expected})`);
      }
    return bad;
  },

  /** 자리 — 첫 턴은 문장 그대로, 둘째 턴은 <previous_intent>(검증한 첫 의도, 색 칸만) + <message>(문장). 시스템 프롬프트는 두 턴이 같고 문장도 자료도 안 섞인다. */
  "S43-G4": async () => {
    const bad = [];
    const stub = await stubAB(A, B);
    const T1 = "핀테크 대시보드";
    const T2 = "좀 더 따뜻하게, 파랑은 빼줘";
    try {
      await withServer(4432, stub.env, async (api) => {
        const id = await firstTurn(api, T1);
        await api("/api/chat", { text: T2, conversationId: id });
      });
      const asks = stub.messages.filter((m) => isIntentAsk(m.body));
      if (asks.length !== 2) return [`의도 질문이 ${asks.length}번 (2번이어야)`];
      const [m1, m2] = asks;
      if (userOf(m1) !== T1) bad.push(`첫 턴 user 가 문장 그대로가 아니다: ${userOf(m1).slice(0, 60)}`);
      const u2 = userOf(m2);
      const prevJson = u2.match(/<previous_intent>\n([\s\S]*?)\n<\/previous_intent>/)?.[1];
      const msg = u2.match(/<message>\n([\s\S]*?)\n<\/message>/)?.[1];
      if (msg !== T2) bad.push(`둘째 턴 <message> 가 문장이 아니다: ${msg}`);
      let prev = null;
      try {
        prev = JSON.parse(prevJson);
      } catch {
        bad.push(`<previous_intent> 가 JSON 이 아니다: ${String(prevJson).slice(0, 60)}`);
      }
      if (prev) {
        const { kind, basis, ...want } = C.parseIntent(A);
        if (JSON.stringify(prev) !== JSON.stringify(want)) bad.push(`직전 의도가 검증한 첫 의도와 다르다: ${prevJson}`);
        if ("kind" in prev || "basis" in prev) bad.push("직전 의도에 kind · basis 가 실렸다");
      }
      if (m1.body.system !== m2.body.system) bad.push("두 턴의 시스템 프롬프트가 다르다 — 자료가 섞였다");
      // 블록 이름("<previous_intent>")은 시스템 프롬프트가 설명하느라 들어 있다 — 금지할 것은 **실제 내용**(문장 · 직전 의도 JSON)이다.
      for (const s of [T1, T2, A.reading, prevJson ?? "\u0000"]) if (m2.body.system.includes(s)) bad.push(`시스템 프롬프트에 "${String(s).slice(0, 40)}" 가 섞였다`);
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 다듬기 응답 — refine 이면 칩이 diffIntent 그대로, 기준 안을 안 보내면 충실(0)이 맨 앞, 색은 composeFocused 그대로. */
  "S43-G5": async () => {
    const bad = [];
    const stub = await stubAB(A, B);
    try {
      await withServer(4433, stub.env, async (api) => {
        const id = await firstTurn(api);
        const t = (await api("/api/chat", { text: "좀 더 따뜻하게, 파랑은 빼줘", conversationId: id })).json?.turn;
        const p = t?.payload;
        if (t?.route !== "palette" || p?.kind !== "generated") return bad.push(`둘째 턴이 ${t?.kind}/${t?.route} kind=${p?.kind}`);
        const a = C.parseIntent(A);
        const b = C.parseIntent(B);
        if (JSON.stringify(p.refine?.changes) !== JSON.stringify(C.diffIntent(a, b))) bad.push(`칩이 ${JSON.stringify(p.refine?.changes)} (기대 ${JSON.stringify(C.diffIntent(a, b))})`);
        if (p.refine?.focus !== 0) bad.push(`기준 안을 안 보냈는데 focus=${p.refine?.focus}`);
        if (hexes(p.palettes) !== hexes(C.composeFocused(b, 0))) bad.push("색이 composeFocused(B, 0) 과 다르다");
        if (p.intent?.basis !== "refine") bad.push(`basis=${p.intent?.basis}`);
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 고른 안 — variant 2 면 대담안이 맨 앞. 정수 0~2 가 아니면 충실(0)로. */
  "S43-G6": async () => {
    const bad = [];
    const stub = await stubAB(A, B);
    const b = C.parseIntent(B);
    try {
      await withServer(4434, stub.env, async (api) => {
        for (const [label, variant, want] of [["2", 2, 2], ["1", 1, 1], ['"2"', "2", 0], ["5", 5, 0], ["-1", -1, 0], ["1.5", 1.5, 0], ["__proto__", "__proto__", 0], ["null", null, 0], ["[2]", [2], 0]]) {
          const id = await firstTurn(api);
          const p = (await api("/api/chat", { text: "더 따뜻하게", conversationId: id, variant })).json?.turn?.payload;
          if (p?.refine?.focus !== want) bad.push(`variant ${label}: focus=${p?.refine?.focus} (기대 ${want})`);
          if (p?.palettes?.[0]?.variant !== want) bad.push(`variant ${label}: 맨 앞 안이 ${p?.palettes?.[0]?.variant}`);
          if (hexes(p?.palettes) !== hexes(C.composeFocused(b, want))) bad.push(`variant ${label}: 색이 composeFocused(B, ${want}) 와 다르다`);
        }
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 새 요청 — 직전 의도가 있어도 Claude 가 new 로 읽으면 칩 없음 · 고른 안 무시 · 3안 그대로. */
  "S43-G7": async () => {
    const bad = [];
    const C2 = { ...A, usage: "illustration", base: { hues: ["purple", "orange"], tone: "deep" }, reading: "할로윈 포스터", basis: "new" };
    const stub = await stubAB(A, C2);
    try {
      await withServer(4435, stub.env, async (api) => {
        const id = await firstTurn(api);
        const p = (await api("/api/chat", { text: "이번엔 할로윈 파티 포스터", conversationId: id, variant: 2 })).json?.turn?.payload;
        if (p?.refine) bad.push(`new 인데 바뀐 것 칩이 생겼다 (${JSON.stringify(p.refine)})`);
        if (hexes(p?.palettes) !== hexes(C.composeAll(C.parseIntent(C2)))) bad.push("new 인데 3안이 composeAll 순서가 아니다 (고른 안이 샜다)");
      });
      if (!stub.messages.filter((m) => isIntentAsk(m.body)).some(hasPrevious)) bad.push("둘째 턴에 직전 의도가 안 실렸다 — 이 검사가 헛돈다");
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 같은 대화 안에서만 — 새 대화 · fresh · 마지막 답이 색 경로 · 10턴 롤오버면 직전 의도가 안 실린다. */
  "S43-G8": async () => {
    const bad = [];
    const stub = await stubAB(A, B);
    try {
      await withServer(4436, stub.env, async (api) => {
        const count = () => stub.messages.filter((m) => isIntentAsk(m.body) && hasPrevious(m)).length;
        await firstTurn(api);
        await api("/api/chat", { text: "좀 더 따뜻하게" }); // 대화 id 없음 = 새 대화
        if (count() !== 0) bad.push("새 대화인데 직전 의도가 실렸다");

        const id = await firstTurn(api);
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: id, fresh: true });
        if (count() !== 0) bad.push("fresh 인데 직전 의도가 실렸다");

        const id2 = await firstTurn(api);
        const c = (await api("/api/chat", { text: "#E07A5F", conversationId: id2 })).json?.turn;
        if (c?.route !== "color") bad.push(`색 경로 준비가 ${c?.route}`);
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: id2 });
        if (count() !== 0) bad.push("마지막 답이 색 경로인데 그 전 팔레트의 의도가 실렸다");

        // 양성 대조 — 같은 대화 이어 쓰기면 실린다
        const id3 = await firstTurn(api);
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: id3 });
        if (count() !== 1) bad.push(`같은 대화 이어 쓰기인데 직전 의도가 ${count()}번 실렸다 (1번이어야)`);

        // 10턴 롤오버 — 열 번째 답 뒤의 말은 새 대화로 간다
        let id4 = await firstTurn(api);
        for (let i = 0; i < 9; i++) id4 = (await api("/api/chat", { text: `더 따뜻하게 ${i}`, conversationId: id4 })).json?.conversationId;
        const before = count();
        const r = (await api("/api/chat", { text: "더 따뜻하게 끝", conversationId: id4 })).json;
        if (r?.conversationId === id4) bad.push("10턴이 찼는데 같은 대화에 이어 붙었다 — 검사 전제가 틀렸다");
        if (count() !== before) bad.push("10턴 롤오버로 새 대화가 됐는데 직전 의도가 실렸다");
      });
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 조작된 기록 — 파일의 의도가 뼈대가 없으면 안 싣고, 헥스 · 모르는 값이 섞였으면 걸러진 것만 싣는다. */
  "S43-G9": async () => {
    const bad = [];
    const dir = gateDataDir();
    const at = new Date().toISOString();
    const turn = (intent) => ({ at, query: "옛 질문", kind: "answer", stage: 2, route: "palette", confident: true, usedLlm: true, topKind: "generated", topId: null, topLabel: "x", intent });
    writeFileSync(
      join(dir, "conversations.json"),
      JSON.stringify([
        { id: "conv-broken", startedAt: at, updatedAt: at, pending: null, turns: [turn({ kind: "palette", base: "파랑" })] },
        { id: "conv-dirty", startedAt: at, updatedAt: at, pending: null, turns: [turn({ ...A, usage: "__proto__", hex: "#FF0000", base: { ...A.base, hues: ["blue", "#00FF00"], hex: "#0000FF" }, count: 99 })] },
      ]),
    );
    const stub = await stubAB(A, B);
    try {
      await withServer(4437, { ...stub.env, TONEFIRST_DATA_DIR: dir }, async (api) => {
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: "conv-broken" });
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: "conv-dirty" });
      });
      const asks = stub.messages.filter((m) => isIntentAsk(m.body));
      if (asks.length !== 2) return [`의도 질문이 ${asks.length}번 (2번이어야)`];
      if (hasPrevious(asks[0])) bad.push("뼈대가 없는 기록인데 직전 의도로 실렸다");
      const u = userOf(asks[1]);
      if (!hasPrevious(asks[1])) bad.push("걸러 쓸 수 있는 기록인데 안 실렸다");
      if (/#[0-9A-Fa-f]{6}/.test(u)) bad.push(`기록에 섞인 헥스가 모델에게 갔다: ${u.slice(0, 160)}`);
      const prev = JSON.parse(u.match(/<previous_intent>\n([\s\S]*?)\n<\/previous_intent>/)?.[1] ?? "{}");
      if (prev.usage !== "general" || prev.count !== 5 || JSON.stringify(prev.base?.hues) !== JSON.stringify(["blue"])) bad.push(`걸러진 값이 아니다: ${JSON.stringify(prev)}`);
    } finally {
      stub.close();
    }
    return bad;
  },

  /** 기록 · 트레이스 · 화면 — 턴에 의도가 남고, 트레이스에 basis · 직전 의도 유무, 화면은 고른 안 번호만 보내고 옛 답의 고르개를 잠근다. */
  "S43-G10": async () => {
    const bad = [];
    const dir = gateDataDir();
    const stub = await stubAB(A, B);
    try {
      await withServer(4438, { ...stub.env, TONEFIRST_DATA_DIR: dir }, async (api) => {
        const id = await firstTurn(api);
        await api("/api/chat", { text: "좀 더 따뜻하게", conversationId: id });
        const conv = (await api(`/api/conversations?id=${encodeURIComponent(id)}`)).json?.conversation;
        const [t1, t2] = conv?.turns ?? [];
        if (t1?.intent?.usage !== "ui" || t1?.intent?.temperature !== "cool") bad.push(`첫 턴 기록에 의도가 없다 (${JSON.stringify(t1?.intent)})`);
        if (t2?.intent?.temperature !== "warm" || t2?.intent?.basis !== "refine") bad.push(`둘째 턴 기록의 의도가 B 가 아니다 (${JSON.stringify(t2?.intent)})`);
      });
    } finally {
      stub.close();
    }
    const traces = readFileSync(join(dir, "traces.jsonl"), "utf8");
    if (!/"previous":true/.test(traces)) bad.push("트레이스에 직전 의도를 실었다는 표시(previous:true)가 없다");
    if (!/"basis":"refine"/.test(traces)) bad.push("트레이스에 basis:refine 이 없다");

    const app = read("public/app.js");
    if (!/api\("\/api\/chat", \{ conversationId, variant: pinnedVariant, \.\.\.body \}\)/.test(app)) bad.push("보내는 요청에 고른 안 번호(variant)가 없다");
    const send = app.match(/async function send\(body\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
    if (/intent/.test(send)) bad.push("화면이 의도를 보낸다 — 직전 의도는 서버가 기록에서 꺼내야 한다");
    if (!/retirePins\?\.\(\);[\s\S]{0,200}const pins = \[\]/.test(app)) bad.push("새 답을 그릴 때 옛 답의 고르개를 잠그지 않는다");
    if (!/aria-pressed/.test(app) || !/이 안으로 다듬기/.test(app)) bad.push("카드에 다듬기 기준 고르개가 없다");
    if (!/data\.refine\.changes/.test(app)) bad.push("바뀐 것 칩을 그리지 않는다");
    if (!/다른 결/.test(app)) bad.push("다듬은 답의 나머지 결을 접어 두지 않는다");
    // 접은 격자가 정말 숨는가 — .expand__grid 의 display: grid 가 hidden 속성을 덮어, 접힌 채로도 다 보였다(브라우저 실측, 14단계부터).
    const css = read("public/app.css");
    if (!/\.expand__grid\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css)) bad.push("접은 격자(.expand__grid[hidden])를 숨기는 규칙이 없다 — display: grid 가 hidden 을 덮는다");
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
