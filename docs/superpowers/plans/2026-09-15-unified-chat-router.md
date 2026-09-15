# 탭 통합 · 결정적 라우터 · 되묻기 (39단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈의 탭 셋을 없애고, 입력 한 줄을 서버가 네 경로(추천·진단·캐릭터·색)로 가르며, 겹치거나 모자라면 한 번만 되묻는 대화형 화면을 만든다. 판정과 입출력은 LangSmith 에서 본다.

**Architecture:** 새 모듈 셋 — `src/route.js`(어휘표만으로 가르는 순수 라우터) · `src/chat.js`(되묻기 상태 기계, 대화 기록 위에 얹음) · `src/trace.js`(LangSmith REST + `var/traces.jsonl`). 서버는 세 처리기를 "계산 함수"로 떼어 `POST /api/chat` 이 안에서 부른다. 기존 GET 엔드포인트 셋은 남긴다. 화면은 대화 기록 하나로 바뀌고 카드 부품은 그대로 쓴다.

**Tech Stack:** Node 24 ESM · 의존성 0 · `node --env-file-if-exists=.env server.js` · 검사기 `scripts/check-stage39.mjs` (기존 검사기와 같은 틀).

**Spec:** `docs/superpowers/specs/2026-09-15-unified-chat-router-design.md`

## Global Constraints

- 의존성 0. `npm install` 없음. LangSmith 는 `fetch` 로 REST 직접.
- 헥스를 지어내지 않는다. 라우터·상태 기계는 색을 만들지 않고 기존 처리기만 부른다.
- 화면에 "LLM" 이라는 글자를 쓰지 않는다(31단계). 검사기가 본다.
- 코퍼스(`data/*.json`)에 숫자·헥스를 넣지 않는다. 이 단계는 `data/` 를 **안 건드린다.**
- 검사기는 구현보다 먼저 쓰고 전부 실패하는 것을 본다(CLAUDE.md · `unlazy`). 아래 Task 1 이 그 자리다.
- 대화 상한 사용자 턴 10 · 되묻기는 같은 원문에 1회 · 응답의 `turn.kind` 는 `answer` | `ask`.
- 키 값은 대표가 직접 넣는다. `.env` 는 커밋하지 않는다.
- 커밋은 각 Task 끝에 한다. 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- 모든 검사기·서버는 `TONEFIRST_DATA_DIR` 를 임시 폴더로 준다(`gateDataDir()`) — 사용자 `var/` 를 오염시키지 않는다.

---

## 파일 구조

| 파일 | 책임 | 상태 |
|---|---|---|
| `scripts/check-stage39.mjs` | 39단계 게이트 10개 | 신규 (Task 1) |
| `GATES.md` | 39단계 절 | 수정 (Task 1, 10) |
| `src/store.js` | 대화 상한 10 · `pending` · `kind` · `findConversation` · `DATA_DIR` 노출 | 수정 (Task 2) |
| `src/route.js` | 라우터 순수 함수 | 신규 (Task 3) |
| `src/trace.js` | 트레이서 (JSONL + LangSmith) | 신규 (Task 4) |
| `server.js` | 계산 함수 분리 · `POST /api/chat` · 트레이서 배선 | 수정 (Task 5, 6) |
| `src/chat.js` | 상태 기계 | 신규 (Task 6) |
| `.gitignore` · `.env.example` · `README.md` | `.env` · 기동 명령 | 수정 (Task 7) |
| `public/index.html` · `app.js` · `app.css` · `ui.js` | 탭 제거 · 대화 기록 · 칩 | 수정 (Task 8) |
| `public/history.js` | 경로 배지 · `?tab=` 제거 | 수정 (Task 9) |
| `scripts/check-stage3{4,5,6}.mjs` | 탭 단정을 39단계 구조로 대체 | 수정 (Task 10) |
| `docs/session-resume/` · `docs/com/open-work.md` | 세션 기록 | 신규/수정 (Task 11) |

---

### Task 1: 게이트 문서와 검사기 뼈대 — 전부 실패하는 것을 본다

**Files:**
- Create: `scripts/check-stage39.mjs`
- Modify: `GATES.md` (끝에 39단계 절 추가)

**Interfaces:**
- Produces: `node scripts/check-stage39.mjs S39-G1` … `S39-G10`. 성공 시 stdout 에 `S39_G1_OK`, 종료 0. 실패 시 종료 1 과 사유.
- 검사기가 기대하는 인터페이스(뒤 Task 가 맞춘다):
  - `src/route.js`: `createRouter({ words, diagnostics, corpus }).route(text)` → `{ kind: "redirect", route }` 또는 `{ kind: "route", routes: string[], unclear: false | "character", signals }`
  - `src/chat.js`: `createChat({ router, handlers, trace, limit })` — 서버가 쓴다. 검사기는 HTTP 로만 본다.
  - `POST /api/chat` `{ conversationId?, text?, choice? }` → `{ conversationId, turn }`
  - `src/store.js`: `LIMITS.turnsPerConversation === 10`, `export const DATA_DIR`
  - `src/trace.js`: `createTracer({ apiKey, project, endpoint, file, fetchImpl })`

- [ ] **Step 1: GATES.md 에 39단계 절을 붙인다**

파일 끝에 추가:

```markdown
## 39단계 — 탭 통합 · 결정적 라우터 · 되묻기 (대표 결정)

홈의 탭 셋을 없앤다. 입력 한 줄을 서버가 어휘표만으로 네 경로(추천·진단·캐릭터·색)로 가르고, 겹치거나(캐릭터×진단)
모자라면(부위 낱말만 · 검색 끝까지 저신뢰) **한 번만 되묻는다.** 화면은 대화 기록 하나(사용자 턴 10개). 판정과 입출력은
LangSmith 로 보내되 키가 없으면 아무 데도 안 보낸다. 설계: `docs/superpowers/specs/2026-09-15-unified-chat-router-design.md`.

S39-G1 라우터 입력표 — 고정 입력 16건(양성·음성·겹침·불명·바로잡기)이 기대 경로와 같다 · 음성 사례가 절반 이상
    CHECK: node scripts/check-stage39.mjs S39-G1
    EXPECT: S39_G1_OK

S39-G2 결정성 — 같은 입력 16건을 두 번 넣으면 판정이 같다 · 라우터가 `fetch`·파일을 안 부른다(순수)
    CHECK: node scripts/check-stage39.mjs S39-G2
    EXPECT: S39_G2_OK

S39-G3 되묻기 1회 — "도적 상의가 탁해" 가 `ask`(ambiguous · 후보 character,diagnosis) · 칩 `diagnosis` 로 답하면 `answer` · 문장으로 또 애매하게 답해도 다시 안 묻고 첫 후보(character)로 답한다 · "머리" 가 `ask`(unclear) 이고 "빨간" 을 이어 쓰면 character 로 답한다
    CHECK: node scripts/check-stage39.mjs S39-G3
    EXPECT: S39_G3_OK

S39-G4 대화 상한 — 같은 대화에 10턴을 넣은 뒤 11번째는 새 `conversationId` 로 오고 옛 대화는 10턴 그대로 · `LIMITS.turnsPerConversation === 10`
    CHECK: node scripts/check-stage39.mjs S39-G4
    EXPECT: S39_G4_OK

S39-G5 키 없음 — `LANGSMITH_API_KEY` 없이 `LANGSMITH_ENDPOINT` 를 가짜 서버로 주고 `/api/chat` 4건을 부르면 가짜 서버에 요청 0건 · 응답은 정상
    CHECK: node scripts/check-stage39.mjs S39-G5
    EXPECT: S39_G5_OK

S39-G6 키 있음 — 가짜 서버에 부모 런(name `chat.turn`)과 자식 런(`route`, `ask` 또는 `search`/`color`/`character`)이 `x-api-key` 와 함께 오고 `parent_run_id`·`trace_id`·`dotted_order`·`session_name` 이 맞다 · 엔드포인트가 죽은 포트여도 `/api/chat` 이 1초 안에 200
    CHECK: node scripts/check-stage39.mjs S39-G6
    EXPECT: S39_G6_OK

S39-G7 로컬 기록 — `var/traces.jsonl`(TONEFIRST_DATA_DIR 아래)에 턴마다 한 줄 · G1 입력 중 6건을 넣으면 각 줄의 `route.outputs.routes` 가 G1 기대와 같다
    CHECK: node scripts/check-stage39.mjs S39-G7
    EXPECT: S39_G7_OK

S39-G8 탭 소멸 — `index.html` 에 `tablist`·`data-tab-select` 없음 · `<ol class="chat"` 있음 · `app.js`·`ui.js` 에 `RUN_BY_TAB`·`tabStore`·`asTab`·`applyTab`·`tab=` 없음 · `app.js` 가 `/api/chat` 을 부르고 `/api/conversations/turn` 은 안 부름 · 홈 HTML·app.js 에 "LLM" 없음
    CHECK: node scripts/check-stage39.mjs S39-G8
    EXPECT: S39_G8_OK

S39-G9 바로잡기 — "여름 화장품 브랜드" 로 답한 뒤 "캐릭터로" 를 보내면 같은 원문을 character 로 다시 푼 `answer` 가 오고 `original` 이 첫 문장이다 · 직전 답이 없는 대화에서 "색으로 봐줘" 는 보통 문장으로 처리된다
    CHECK: node scripts/check-stage39.mjs S39-G9
    EXPECT: S39_G9_OK

S39-G10 회귀 — S4 · S22 · S34 · S35 · S36 검사기 전부 통과(수는 Task 10 에서 확정해 이 줄에 적는다)
    CHECK: node scripts/check-stage39.mjs S39-G10
    EXPECT: S39_G10_OK
```

- [ ] **Step 2: 검사기를 쓴다**

`scripts/check-stage39.mjs`:

```js
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
      ["scripts/check-stage4.mjs", 6],
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
```

- [ ] **Step 3: 열 게이트가 전부 실패하는 것을 본다**

Run: `for i in 1 2 3 4 5 6 7 8 9 10; do node scripts/check-stage39.mjs S39-G$i | tail -1; done`
Expected: 열 줄 전부 `S39-G<n> 실패` (G1·G2 는 `route.js` 없음, G3~G7·G9 는 `/api/chat` 404, G8 은 tablist 있음, G10 은 S4 의 게이트 수가 6인지 확인해 다르면 그 수로 고친다 — 실측이 우선).

- [ ] **Step 4: 커밋**

```bash
git add GATES.md scripts/check-stage39.mjs
git commit -m "test: 39단계 게이트 10개 — 구현 전 전부 실패

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 대화 저장소 — 상한 10 · pending · kind

**Files:**
- Modify: `src/store.js` (LIMITS · VALID_ROUTES · recordTurn · 신규 export)

**Interfaces:**
- Produces: `LIMITS.turnsPerConversation === 10`, `export const DATA_DIR`, `export function findConversation(id) → conversation|null`, `recordTurn(input)` 가 `input.kind`("answer"|"ask", 기본 "answer") 와 `input.pending`(객체|null, 주면 대화의 `pending` 을 덮는다) 를 받는다. 반환 `{ conversationId, turn }` 그대로.

- [ ] **Step 1: 실패 확인**

Run: `node scripts/check-stage39.mjs S39-G4 | head -3`
Expected: `turnsPerConversation 이 100` 이 첫 줄.

- [ ] **Step 2: store.js 를 고친다**

`LIMITS`:

```js
export const LIMITS = {
  ratioMin: RATIO_MIN,
  ratioMax: RATIO_MAX,
  conversations: 50,
  // 39단계: 대화 하나는 사용자 턴 10개. 넘으면 chat.js 가 새 대화를 연다 — 여기의 slice 는 안전망일 뿐이다.
  turnsPerConversation: 10,
  saved: 200,
  queryChars: 500,
  noteChars: 200,
};
```

`DATA_DIR` 선언을 `export const DATA_DIR = …` 로 바꾼다.

`VALID_ROUTES`:

```js
// 39단계: 되물은 턴은 route "ask" 로 남긴다.
const VALID_ROUTES = new Set(["palette", "diagnosis", "character", "color", "ask", "none"]);
```

`listConversations` 아래에 추가:

```js
/** id 로 대화 하나. 없으면 null. chat.js 가 pending 과 턴 수를 읽는 데 쓴다. */
export function findConversation(id) {
  if (typeof id !== "string") return null;
  return listConversations().find((c) => c.id === id) ?? null;
}

/** 되묻기 상태의 형태를 강제한다. 화면이 아니라 서버(chat.js)가 만들지만, 파일에서 읽어 올 때도 이 꼴이어야 한다. */
function normalizePending(value) {
  if (!value || typeof value !== "object") return null;
  const original = clip(value.original, LIMITS.queryChars);
  if (!original) return null;
  const choices = Array.isArray(value.choices) ? value.choices.filter((c) => VALID_ROUTES.has(c) && c !== "ask" && c !== "none") : [];
  return { original, choices, reason: value.reason === "unclear" ? "unclear" : "ambiguous", askedAt: now() };
}
```

`recordTurn` 의 `turn` 객체에 한 줄 추가하고, 대화에 `pending` 을 쓴다:

```js
  const turn = {
    at: now(),
    query,
    kind: input.kind === "ask" ? "ask" : "answer", // 39단계
    stage: [1, 2, 3].includes(input.stage) ? input.stage : 1,
    route: VALID_ROUTES.has(input.route) ? input.route : "none",
    confident: input.confident === true,
    usedLlm: input.usedLlm === true,
    topKind: ["diagnosis", "palette", "character", "color"].includes(input.topKind) ? input.topKind : null,
    topId: clip(input.topId, 40) || null,
    topLabel: clip(input.topLabel, 80) || null,
  };
```

그리고 `conversation.turns.push(turn);` 바로 뒤에:

```js
    // 39단계: pending 을 명시적으로 주면 덮는다(null 포함). 안 주면 그대로 — 옛 호출부(/api/conversations/turn)가 지우지 않게.
    if (Object.hasOwn(input, "pending")) conversation.pending = normalizePending(input.pending);
```

새 대화를 만드는 줄은 `pending: null` 을 넣는다:

```js
      conversation = { id: newId("conv"), startedAt: turn.at, updatedAt: turn.at, turns: [], pending: null };
```

- [ ] **Step 3: 상한만 통과하는지 본다**

Run: `node scripts/check-stage39.mjs S39-G4 | head -3`
Expected: 첫 줄이 더는 `turnsPerConversation` 이 아니고 `1턴 404` 류(아직 `/api/chat` 없음).

Run: `node scripts/check-stage4.mjs S4-G5`
Expected: `S4_G5_OK` (열거값 위조가 여전히 `none`).

- [ ] **Step 4: 커밋**

```bash
git add src/store.js
git commit -m "feat: 대화 상한 10 · 되묻기 상태 pending · 턴 kind (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 라우터 `src/route.js`

**Files:**
- Create: `src/route.js`

**Interfaces:**
- Consumes: `parseColorInput(text, corpus)` (`src/from-color.js`, 입력 전체가 색이면 객체, 아니면 null) · `data/character-words.json` 의 `parts`·`colorWords`·`compounds` · `data/creatures.json` 의 `words` · `data/diagnostics.json` 의 `aliases`.
- Produces:
  ```js
  export function createRouter({ words, diagnostics, corpus, creatures = [] })
  router.route(text) →
    { kind: "redirect", route: "color"|"character"|"diagnosis"|"palette" }
    | { kind: "route", routes: string[], unclear: false | "character", signals: { color, parts, colorWords, compounds, creatures, diagnosis, partsOnly } }
  export const ROUTE_LABEL = { palette: "추천", diagnosis: "진단", character: "캐릭터", color: "색" }
  ```

- [ ] **Step 1: 실패 확인**

Run: `node scripts/check-stage39.mjs S39-G1 | tail -1`
Expected: `검사 자체가 실패: Cannot find module … route.js`.

- [ ] **Step 2: 라우터를 쓴다**

```js
// 입력 한 줄을 네 경로로 가른다. **LLM 없이, 어휘표만으로.** 39단계.
//
// 왜 결정적인가: 같은 입력이 같은 경로로 가야 게이트가 표로 검사할 수 있다(S39-G1·G2). 판정에 모델을 쓰면
// 헥스 하나 넣어도 모델을 부르고 답이 매번 달라진다.
// 왜 되묻는가: 겹침(캐릭터×진단)을 규칙표로 하나 고르면 경계 사례를 계속 더해야 한다. 판정은 규칙이 하고
// 해소는 사용자가 한다(설계 문서 "버린 대안").
//
// **순수 함수다.** 파일·네트워크·시간·난수를 안 쓴다 — S39-G2 가 본문에서 그 낱말을 찾는다.

import { parseColorInput } from "./from-color.js";

export const ROUTES = Object.freeze(["palette", "diagnosis", "character", "color"]);
export const ROUTE_LABEL = Object.freeze({ palette: "추천", diagnosis: "진단", character: "캐릭터", color: "색" });

/** 바로잡기 낱말. 문장 앞이나 끝에 오고 어절이 셋 이하일 때만 바로잡기다 — "빨강 어울리는 색으로 가자" 는 아니다. */
const REDIRECT = Object.freeze({ 색으로: "color", 캐릭터로: "character", 진단으로: "diagnosis", 추천으로: "palette" });
const REDIRECT_MAX_WORDS = 3;

const words = (text) => text.split(/\s+/).filter(Boolean);

/** 어절 하나가 별칭에 걸리는가. 활용형("요란해")이 표제("요란")로 시작하면 걸린다. 띄어쓴 별칭("물 빠진")은 문장 포함으로 본다. */
function diagnosisHits(text, tokens, diagnostics) {
  const hits = [];
  for (const d of diagnostics) {
    for (const alias of d.aliases ?? []) {
      const hit = alias.includes(" ") ? text.includes(alias) : tokens.some((t) => t.startsWith(alias));
      if (hit) {
        hits.push(d.id);
        break;
      }
    }
  }
  return hits;
}

/** 표면형 목록 중 문장에 든 것. 긴 형태부터 본다 — "머리카락" 이 "머리" 에 먼저 먹히지 않게. */
function surfaceHits(text, forms) {
  return [...forms].sort((a, b) => b.length - a.length).filter((f) => text.includes(f));
}

export function createRouter({ words: table, diagnostics, corpus, creatures = [] }) {
  const partForms = Object.values(table.parts ?? {}).flat();
  const colorForms = Object.values(table.colorWords ?? {}).flat();
  const compoundForms = Object.keys(table.compounds ?? {});
  const creatureForms = creatures.flatMap((c) => c.words ?? []);

  function route(raw) {
    const text = String(raw ?? "").trim();
    const tokens = words(text);

    // 1. 바로잡기
    if (tokens.length > 0 && tokens.length <= REDIRECT_MAX_WORDS) {
      const first = REDIRECT[tokens[0]];
      const last = REDIRECT[tokens.at(-1)];
      if (first || last) return { kind: "redirect", route: first ?? last };
    }

    // 2. 입력 전체가 색 하나 — 다른 신호와 겹칠 수 없다
    const color = parseColorInput(text, corpus);
    if (color) return { kind: "route", routes: ["color"], unclear: false, signals: { color: color.hex, parts: [], colorWords: [], compounds: [], creatures: [], diagnosis: [], partsOnly: false } };

    // 3. 캐릭터 신호
    const parts = surfaceHits(text, partForms);
    const colorWords = surfaceHits(text, colorForms);
    const compounds = surfaceHits(text, compoundForms);
    const creatureHits = surfaceHits(text, creatureForms);
    // 부위 낱말을 걷어내면 아무것도 안 남는가 — "머리" 처럼 부위만 말한 것
    const stripped = parts.reduce((acc, f) => acc.replaceAll(f, ""), text).replace(/\s+/g, "");
    const partsOnly = parts.length > 0 && colorWords.length === 0 && compounds.length === 0 && stripped.length === 0;
    const strong = compounds.length > 0 || (parts.length > 0 && (colorWords.length > 0 || creatureHits.length > 0)) || new Set(parts).size >= 2;
    const weak = parts.length > 0 && !strong && !partsOnly;

    // 4. 진단 신호
    const diagnosis = diagnosisHits(text, tokens, diagnostics);

    const signals = { color: null, parts, colorWords, compounds, creatures: creatureHits, diagnosis, partsOnly };

    if (partsOnly) return { kind: "route", routes: ["character"], unclear: "character", signals };
    const routes = [];
    if (strong || weak) routes.push("character");
    if (diagnosis.length > 0) routes.push("diagnosis");
    // 약한 캐릭터 신호 하나만 있으면("눈에 띄는 색") 캐릭터가 아니라 추천이다
    if (routes.length === 1 && routes[0] === "character" && weak) return { kind: "route", routes: ["palette"], unclear: false, signals };
    if (routes.length === 0) routes.push("palette");
    return { kind: "route", routes, unclear: false, signals };
  }

  return { route };
}
```

- [ ] **Step 3: G1·G2 통과 확인**

Run: `node scripts/check-stage39.mjs S39-G1 && node scripts/check-stage39.mjs S39-G2`
Expected: `S39_G1_OK` · `S39_G2_OK`. 실패하면 **표를 고치지 말고 규칙을 고친다** — 단, "도적" 이 `creatures.json` 에 없으므로 "빨간 머리 도적" 은 부위+색으로 strong 이어야 한다. "눈에 띄는 색" 은 `stripped` 가 "에띄는색" 이라 weak → palette 여야 한다.

- [ ] **Step 4: 커밋**

```bash
git add src/route.js
git commit -m "feat: 결정적 라우터 — 어휘표만으로 네 경로·겹침·불명·바로잡기 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 트레이서 `src/trace.js`

**Files:**
- Create: `src/trace.js`

**Interfaces:**
- Produces:
  ```js
  export function createTracer({ apiKey = "", project = "color-picker", endpoint = "https://api.smith.langchain.com", file, fetchImpl = fetch, log = (msg) => process.stderr.write(msg + "\n") })
  const run = tracer.begin("chat.turn", inputs)     // 부모
  const child = run.child("route", inputs); child.end(outputs)
  run.end(outputs)   // JSONL 한 줄 append + (키 있을 때) 부모·자식 POST /runs. 기다리지 않는다.
  ```
- JSONL 한 줄: `{ id, name, inputs, outputs, startedAt, endedAt, children: [{ id, name, inputs, outputs, startedAt, endedAt }] }`

- [ ] **Step 1: 실패 확인**

Run: `node scripts/check-stage39.mjs S39-G7 | tail -1`
Expected: 실패(`/api/chat` 404 → traces.jsonl 없음).

- [ ] **Step 2: 트레이서를 쓴다**

```js
// 턴 하나의 판정·입출력을 기록한다. 39단계.
//
// 두 겹이다. ① `var/traces.jsonl` — 늘 쓴다. 게이트가 "이 입력은 이 경로로 갔는가" 를 여기서 대조한다(S39-G7).
// ② LangSmith — `LANGSMITH_API_KEY` 가 있을 때만 REST 로 보낸다. SDK 없음(의존성 0). 응답을 기다리지 않고
// 실패는 로그 한 줄이다 — 관측이 사용자 응답을 막으면 안 된다(S39-G6).
//
// LangSmith 런 필드: id · trace_id(루트 id) · dotted_order(시각+id 를 "." 로 이은 것) · parent_run_id · session_name(프로젝트).
// 자식이 부모보다 먼저 닿아도 되게 부모를 먼저 보낸다.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const POST_TIMEOUT_MS = 3000;

/** dotted_order 의 시각 조각: 20260915T101530123456Z 꼴(마이크로초 6자리 — ms 뒤에 000). */
function orderStamp(iso) {
  return iso.replace(/[-:]/g, "").replace(".", "").replace("Z", "000Z");
}

export function createTracer({ apiKey = "", project = "color-picker", endpoint = "https://api.smith.langchain.com", file, fetchImpl = fetch, log = (msg) => process.stderr.write(Buffer.from(msg + "\n", "utf8")) } = {}) {
  const enabled = typeof apiKey === "string" && apiKey.length > 0;
  const base = String(endpoint).replace(/\/+$/, "");

  function post(body) {
    if (!enabled) return;
    fetchImpl(`${base}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) log(`LangSmith 가 ${res.status} 를 돌려줬다 (${body.name})`);
      })
      .catch((err) => log(`LangSmith 전송 실패 (${body.name}): ${err.message}`));
  }

  function appendLine(record) {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
      log(`트레이스 파일 쓰기 실패: ${err.message}`);
    }
  }

  function begin(name, inputs = {}) {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const dotted = `${orderStamp(startedAt)}${id}`;
    const children = [];

    const child = (childName, childInputs = {}) => {
      const cid = randomUUID();
      const cStart = new Date().toISOString();
      const rec = { id: cid, name: childName, inputs: childInputs, outputs: null, startedAt: cStart, endedAt: null };
      children.push(rec);
      return {
        end(outputs = {}) {
          rec.outputs = outputs;
          rec.endedAt = new Date().toISOString();
          return rec;
        },
      };
    };

    const end = (outputs = {}) => {
      const endedAt = new Date().toISOString();
      appendLine({ id, name, inputs, outputs, startedAt, endedAt, children });
      post({ id, trace_id: id, dotted_order: dotted, name, run_type: "chain", inputs, outputs, start_time: startedAt, end_time: endedAt, session_name: project });
      for (const c of children) {
        post({
          id: c.id,
          trace_id: id,
          parent_run_id: id,
          dotted_order: `${dotted}.${orderStamp(c.startedAt)}${c.id}`,
          name: c.name,
          run_type: c.name.startsWith("llm") ? "llm" : "tool",
          inputs: c.inputs,
          outputs: c.outputs ?? {},
          start_time: c.startedAt,
          end_time: c.endedAt ?? endedAt,
          session_name: project,
        });
      }
    };

    return { id, child, end };
  }

  return { enabled, begin };
}
```

- [ ] **Step 3: 단독으로 돌려 본다 (임시 확인, 커밋 안 함)**

Run:
```bash
node -e "import('./src/trace.js').then(({createTracer})=>{const t=createTracer({apiKey:'k',endpoint:'http://127.0.0.1:9',file:process.env.TEMP+'/t.jsonl'});const r=t.begin('chat.turn',{text:'x'});r.child('route',{}).end({routes:['palette']});r.end({kind:'answer'});setTimeout(()=>console.log(require('fs').readFileSync(process.env.TEMP+'/t.jsonl','utf8')),200)})"
```
Expected: JSONL 한 줄이 찍히고 stderr 에 `LangSmith 전송 실패 (chat.turn)` 두 줄(부모·자식). 프로세스가 죽지 않는다.

- [ ] **Step 4: 커밋**

```bash
git add src/trace.js
git commit -m "feat: 트레이서 — traces.jsonl + LangSmith REST(옵트인·비대기) (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 서버 — 세 처리기를 계산 함수로 뗀다 (동작 변화 없음)

**Files:**
- Modify: `server.js:187-221` (`handleSearch`), `server.js:402-485` (`handleColor`), `server.js:486-540` (`handleCharacter`)

**Interfaces:**
- Produces (모듈 안 함수, export 안 함):
  - `async function computeSearch(query, limit, { allowRewrite = true } = {}) → body` — 지금 `handleSearch` 가 `sendJson(res, 200, …)` 에 넣던 객체 그대로
  - `async function computeColor(query) → body | null` — 색을 못 읽으면 null
  - `async function computeCharacter(query) → body`
- `handleSearch`·`handleColor`·`handleCharacter` 는 파라미터 검증 + `sendJson` 만 남긴다.

- [ ] **Step 1: 기준선 확인 (바꾸기 전)**

Run: `node scripts/check-stage35.mjs S35-G4 && node scripts/check-stage34.mjs S34-G1 && node scripts/check-stage3.mjs S3-G8`
Expected: 셋 다 `_OK`. (실패하면 이 Task 를 시작하지 않고 원인을 먼저 본다 — 회귀 기준선이 없어진다.)

- [ ] **Step 2: handleSearch 를 가른다**

```js
/** 검색 응답 본문. `/api/search` 와 `/api/chat` 이 함께 쓴다(39단계). */
async function computeSearch(query, limit, { allowRewrite = true } = {}) {
  pipeline.reloadIfChanged();
  const r = await pipeline.resolve(query, limit, { allowRewrite });
  return {
    query,
    stage: r.stage,
    route: r.route,
    confident: r.confident,
    elapsedMs: r.searchMs,
    rewrite: r.rewrite ? { intent: r.rewrite.intent, terms: r.rewrite.terms, model: r.rewrite.model, elapsedMs: r.rewrite.elapsedMs } : null,
    rewriteError: r.rewriteError ? (LOOPBACK_ONLY ? r.rewriteError : "질의 재작성을 쓸 수 없습니다") : null,
    hybrid: r.hybrid ?? null,
    hybridError: r.hybridError ? (LOOPBACK_ONLY ? r.hybridError : "임베딩을 쓸 수 없습니다") : null,
    usedLlm: r.usedLlm === true,
    results: r.paletteHits.map(shapePalette),
    diagnostics: r.diagnosticHits.map(shapeDiagnostic),
  };
}

async function handleSearch(res, params) {
  const query = cleanQuery(params.get("q"));
  if (!query) return sendJson(res, 400, { error: "q 가 비어 있다" });
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 5 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    return sendJson(res, 400, { error: "limit 는 1~10 의 정수" });
  }
  sendJson(res, 200, await computeSearch(query, limit, { allowRewrite: params.get("rewrite") !== "0" }));
}
```

기존 `handleSearch` 본문의 주석(경계 설명)은 `computeSearch` 안 같은 줄로 옮긴다.

- [ ] **Step 3: handleColor 를 가른다**

`handleColor` 에서 `const started = Date.now();` 부터 `sendJson(res, 200, {…})` 까지를 `computeColor` 로 옮긴다:

```js
/** 색 응답 본문. 못 읽는 색이면 null — 호출부가 400 을 낼지(GET) 다른 경로로 갈지(chat) 정한다. */
async function computeColor(query) {
  pipeline.reloadIfChanged();
  const started = Date.now();
  const corpus = corpusColors();
  const input = parseColorInput(query, corpus);
  if (!input) return null;
  // … 기존 본문 그대로(partners · structures · finishes · nearest …) …
  return { /* 기존 sendJson 두 번째 인자 객체 그대로 */ };
}

async function handleColor(res, params) {
  const query = cleanQuery(params.get("q"));
  if (!query) return sendJson(res, 400, { error: "q 가 비어 있다" });
  if (query.length > LIMITS.queryChars) return sendJson(res, 400, { error: `q 는 ${LIMITS.queryChars}자까지` });
  const body = await computeColor(query);
  if (!body) return sendJson(res, 400, { error: "색을 못 읽었다 — #RRGGBB 헥스나 색 이름(테라코타 · 빨강)을 넣는다" });
  sendJson(res, 200, body);
}
```

"기존 본문 그대로" 는 `server.js:409-485` 의 줄을 옮기는 것이다 — `sendJson(res, 200, {` 를 `return {` 로, 닫는 `});` 를 `};` 로 바꾸는 것 외에 한 글자도 안 바꾼다.

- [ ] **Step 4: handleCharacter 를 가른다**

같은 방식. `computeCharacter(query)` 는 `server.js:491-539` 의 본문(`const started` 부터)을 담고 `return {…}` 로 끝난다. `handleCharacter` 는 검증 두 줄 + `sendJson(res, 200, await computeCharacter(query))`.

- [ ] **Step 5: 회귀 확인**

Run: `node scripts/check-stage35.mjs S35-G4 && node scripts/check-stage34.mjs S34-G1 && node scripts/check-stage3.mjs S3-G8 && node scripts/check-stage36.mjs S36-G3`
Expected: 전부 `_OK`.

- [ ] **Step 6: 커밋**

```bash
git add server.js
git commit -m "refactor: 검색·색·캐릭터 처리기를 계산 함수로 분리 (39단계 준비)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 상태 기계 `src/chat.js` + `POST /api/chat`

**Files:**
- Create: `src/chat.js`
- Modify: `server.js` (import · 기동 시 라우터·트레이서·chat 생성 · `handleWrite` 분기)

**Interfaces:**
- Consumes: Task 2 의 `findConversation`·`recordTurn`·`LIMITS`·`DATA_DIR`, Task 3 의 `createRouter`·`ROUTE_LABEL`, Task 4 의 `createTracer`, Task 5 의 `computeSearch`·`computeColor`·`computeCharacter`.
- Produces:
  ```js
  export function createChat({ router, handlers, trace, store, limit })
  // handlers: { search(query) → body, character(query) → body, color(query) → body|null }
  // store: { findConversation, recordTurn }
  chat.step({ conversationId, text, choice }) → { conversationId, turn }
  ```
  `turn` 은 설계 문서 3절 모양.

- [ ] **Step 1: 실패 확인**

Run: `node scripts/check-stage39.mjs S39-G3 | head -2`
Expected: `1턴 404`.

- [ ] **Step 2: chat.js 를 쓴다**

```js
// 되묻기 상태 기계. 39단계. 손으로 쓴 표 하나다 — 설계 문서 3절의 표를 코드로 옮겼다.
//
//   pending 없음 + 문장      → 라우터. 하나면 답. 겹침·불명이면 되묻고 pending 을 남긴다
//   pending 없음 + 바로잡기  → 직전 답의 원문을 지정 경로로 다시 답한다
//   pending 있음 + 칩        → 원문을 그 경로로 답한다. pending 을 지운다
//   pending 있음 + 문장      → 원문에 이어 붙여 라우터. 또 애매해도 **다시 안 묻고** 첫 후보(겹침)·추천(불명)으로 답한다
//   턴 10개                  → 새 대화
//
// 색·헥스는 여기서 안 만든다. 처리기(handlers)가 내는 것을 그대로 payload 로 싣는다.

import { cleanQuery } from "./query.js";
import { ROUTE_LABEL, ROUTES } from "./route.js";

const CHOICE_LABEL = Object.freeze({ palette: "분위기로 색 찾기", diagnosis: "고칠 원인 보기", character: "캐릭터 색 짜기", color: "색 코드로 찾기" });

const QUESTION = Object.freeze({
  ambiguous: "두 가지로 읽혀요. 어느 쪽으로 할까요?",
  unclearPalette: "무엇을 찾으시는지 못 잡았어요. 어느 쪽인가요?",
  unclearCharacter: "머리색이나 옷 색 하나만 더 알려 주시면 캐릭터 색을 짤 수 있어요.",
});

const askTurn = (reason, choices, question) => ({ kind: "ask", reason, question, choices: choices.map((id) => ({ id, label: CHOICE_LABEL[id] })), allowFreeText: true });

/** 답한 턴을 내역에 남길 요약. app.js 가 하던 것을 서버로 옮겼다. */
function summarize(route, payload) {
  if (route === "color") return { stage: 1, usedLlm: false, confident: true, topKind: "color", topId: payload.partners[0]?.pairId ?? null, topLabel: payload.partners[0]?.pairName ?? null };
  if (route === "character") return { stage: 1, usedLlm: payload.parse.from === "llm", confident: payload.palette.from === "search", topKind: "character", topId: payload.palette.id, topLabel: payload.palette.name };
  const top = payload.route === "diagnosis" ? payload.diagnostics[0] : payload.results[0];
  return { stage: payload.stage, usedLlm: payload.usedLlm === true, confident: payload.confident === true, topKind: top ? payload.route : null, topId: top?.id ?? null, topLabel: top ? (top.name ?? top.symptom) : null };
}

/** 검색이 끝까지 저신뢰이고 모델도 "other" 이거나 없으면 정보 부족이다. */
const searchUnclear = (payload) => payload.confident !== true && (payload.rewrite == null || payload.rewrite.intent === "other");

export function createChat({ router, handlers, trace, store, limit }) {
  /** 경로 하나로 실제 답을 만든다. color 인데 색이 아니면 추천으로 내려간다. */
  async function answer(route, query, span) {
    if (route === "color") {
      const body = await handlers.color(query);
      if (body) {
        span.child("color", { query }).end({ input: body.input?.hex ?? null, partners: body.partners.length });
        return { route: "color", payload: body };
      }
      route = "palette";
    }
    if (route === "character") {
      const body = await handlers.character(query);
      span.child("character", { query }).end({ parts: body.parse.parts, palette: body.palette.id, from: body.parse.from });
      if (body.parse.from === "llm") span.child("llm.character", { query, model: body.parse.model }).end({ parts: body.parse.parts, impression: body.parse.impression });
      return { route: "character", payload: body };
    }
    const body = await handlers.search(query);
    span.child("search", { query }).end({ stage: body.stage, route: body.route, confident: body.confident, topId: body.route === "diagnosis" ? body.diagnostics[0]?.id : body.results[0]?.id });
    if (body.rewrite) span.child("llm.rewrite", { query, model: body.rewrite.model }).end({ intent: body.rewrite.intent, terms: body.rewrite.terms });
    return { route: ROUTES.includes(body.route) ? body.route : "palette", payload: body };
  }

  async function step(input) {
    const text = cleanQuery(input?.text);
    const choice = ROUTES.includes(input?.choice) ? input.choice : null;
    if (!text && !choice) throw new Error("text 나 choice 가 있어야 한다");
    if (text.length > limit.queryChars) throw new Error(`text 는 ${limit.queryChars}자까지`);

    let conversation = store.findConversation(input?.conversationId);
    // 사용자 턴 10개가 찼으면 새 대화. 옛 대화는 손대지 않는다.
    if (conversation && conversation.turns.length >= limit.turnsPerConversation) conversation = null;
    const conversationId = conversation?.id ?? null;
    const pending = conversation?.pending ?? null;

    const span = trace.begin("chat.turn", { text, choice, conversationId, pending: pending ? { original: pending.original, reason: pending.reason } : null });
    const record = async (turn, fields) => {
      const saved = await store.recordTurn({ conversationId, query: text || `[${ROUTE_LABEL[choice]}]`, ...fields });
      span.end({ kind: turn.kind, route: turn.route ?? null, reason: turn.reason ?? null, conversationId: saved.conversationId });
      return { conversationId: saved.conversationId, turn };
    };
    const answerAndRecord = async (route, query) => {
      const { route: finalRoute, payload } = await answer(route, query, span);
      const turn = { kind: "answer", route: finalRoute, original: query, payload, trace: { routes: [finalRoute] } };
      return record(turn, { kind: "answer", route: finalRoute, pending: null, ...summarize(finalRoute, payload) });
    };

    // ── pending 있음 ──
    if (pending) {
      if (choice) {
        span.child("route", { text, choice, pending: true }).end({ routes: [choice], resolvedBy: "choice" });
        return answerAndRecord(choice, pending.original);
      }
      const combined = `${pending.original} ${text}`;
      const r = router.route(combined);
      const routes = r.kind === "redirect" ? [r.route] : r.routes;
      span.child("route", { text: combined, pending: true }).end({ routes, resolvedBy: "text" });
      // 두 번째는 안 묻는다. 겹침이면 첫 후보, 불명이면 추천.
      const route = r.kind === "route" && r.unclear ? "palette" : routes[0];
      return answerAndRecord(route, combined);
    }

    // ── pending 없음 ──
    const r = router.route(text);
    const routeSpan = span.child("route", { text });

    if (r.kind === "redirect") {
      const last = [...(conversation?.turns ?? [])].reverse().find((t) => t.kind !== "ask");
      if (last) {
        routeSpan.end({ routes: [r.route], redirect: true, original: last.query });
        return answerAndRecord(r.route, last.query);
      }
      // 되돌릴 답이 없으면 보통 문장이다
      routeSpan.end({ routes: ["palette"], redirect: false });
      return answerAndRecord("palette", text);
    }

    routeSpan.end({ routes: r.routes, unclear: r.unclear, signals: r.signals });

    if (r.unclear === "character") {
      const turn = { ...askTurn("unclear", [], QUESTION.unclearCharacter), original: text };
      span.child("ask", { reason: "unclear" }).end({ choices: [] });
      return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: [], reason: "unclear" } });
    }
    if (r.routes.length > 1) {
      const turn = { ...askTurn("ambiguous", r.routes, QUESTION.ambiguous), original: text };
      span.child("ask", { reason: "ambiguous" }).end({ choices: r.routes });
      return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: r.routes, reason: "ambiguous" } });
    }

    const route = r.routes[0];
    if (route === "palette" || route === "diagnosis") {
      const { route: finalRoute, payload } = await answer(route, text, span);
      if (searchUnclear(payload)) {
        const turn = { ...askTurn("unclear", ["palette", "diagnosis", "character", "color"], QUESTION.unclearPalette), original: text };
        span.child("ask", { reason: "unclear" }).end({ choices: turn.choices.map((c) => c.id) });
        return record(turn, { kind: "ask", route: "ask", pending: { original: text, choices: turn.choices.map((c) => c.id), reason: "unclear" } });
      }
      const turn = { kind: "answer", route: finalRoute, original: text, payload, trace: { routes: [finalRoute] } };
      return record(turn, { kind: "answer", route: finalRoute, pending: null, ...summarize(finalRoute, payload) });
    }
    return answerAndRecord(route, text);
  }

  return { step };
}
```

**주의 — 되묻기 뒤 칩으로 `palette` 를 고르면** `answer("palette", original)` 이 다시 검색하고 `searchUnclear` 가 또 참이어도 pending 경로라 묻지 않는다. 이것이 "같은 원문에 1회" 다.

- [ ] **Step 3: server.js 에 배선한다**

import 추가:

```js
import { DATA_DIR, findConversation } from "./src/store.js"; // 기존 import 목록에 두 이름을 더한다
import { createRouter } from "./src/route.js";
import { createChat } from "./src/chat.js";
import { createTracer } from "./src/trace.js";
import { join } from "node:path"; // 기존 node:path import 에 join 을 더한다
```

기동 부분(`pipeline` 생성 뒤, `corpusColors`·`loadDiagnostics` 가 쓸 수 있는 자리):

```js
// 39단계 — 라우터·트레이서·상태 기계. 라우터는 코퍼스 재적재(27단계)와 무관한 어휘표만 쓴다.
const router = createRouter({ words: loadCharacterWords(), diagnostics: pipeline.diagnostics.diagnostics, corpus: corpusColors(), creatures: loadCreatures() });
const tracer = createTracer({
  apiKey: process.env.LANGSMITH_API_KEY ?? "",
  project: process.env.LANGSMITH_PROJECT || "color-picker",
  endpoint: process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
  file: join(DATA_DIR, "traces.jsonl"),
});
const chat = createChat({
  router,
  handlers: { search: (q) => computeSearch(q, 3), character: computeCharacter, color: computeColor },
  trace: tracer,
  store: { findConversation, recordTurn },
  limit: LIMITS,
});
```

`pipeline.diagnostics` 가 getter 로 노출되는지 `src/pipeline.js` 의 `return {` 아래를 확인한다. 없으면 `loadDiagnostics()` 를 `src/diagnostics.js` 에서 import 해 쓴다. `loadCreatures` 는 이미 import 돼 있다.

`handleWrite` 의 try 안 첫 분기로:

```js
    if (pathname === "/api/chat") {
      return sendJson(res, 200, await chat.step(body));
    }
```

- [ ] **Step 4: 게이트 확인**

Run: `for g in 3 4 5 6 7 9; do node scripts/check-stage39.mjs S39-G$g | tail -1; done`
Expected: 여섯 줄 전부 `_OK`. G5 가 실패하면 `LANGSMITH_API_KEY: ""` 가 `enabled=false` 로 가는지 본다. G6 의 두 번째 절(죽은 포트)이 1초를 넘기면 `post()` 가 await 되고 있는 것이다.

- [ ] **Step 5: 커밋**

```bash
git add src/chat.js server.js
git commit -m "feat: POST /api/chat — 되묻기 상태 기계와 트레이스 배선 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `.env` · 기동 명령 · README

**Files:**
- Modify: `.gitignore`, `README.md` (돌리기 절 · 화면 표 · 파일 지도)
- Create: `.env.example`

- [ ] **Step 1: .gitignore 에 추가**

```
# 로컬 비밀 (LangSmith 키 등). 저장소에는 .env.example 만 둔다
.env
```

- [ ] **Step 2: .env.example**

```
# LangSmith — 비우면 아무 데도 안 보낸다. 키는 직접 넣는다.
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=color-picker
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
```

- [ ] **Step 3: README 돌리기 절**

```markdown
## 돌리기

```bash
node --env-file-if-exists=.env server.js
```

`http://127.0.0.1:4173`. **의존성 0개다** — `npm install` 이 필요 없다. Node 24, ESM.
`.env` 는 없어도 된다. LangSmith 로 판정과 입출력을 보려면 `.env.example` 을 `.env` 로 복사해 키를 넣는다.
```

- [ ] **Step 4: README 화면 표의 `/` 행을 바꾼다**

```markdown
| `/` | **채팅창 하나.** 문장을 쓰면 서버가 어휘표만으로 네 경로 중 하나로 가른다 — **추천**(인상·분위기 → 팔레트), **진단**(증상 → 원인과 처방), **캐릭터**(외형 묘사 → 부위 여섯의 색과 재질), **색**(`#E07A5F`·"테라코타" → 배색사전 짝 셋과 배색 구조 여덟). 캐릭터와 진단으로 함께 읽히거나("도적 상의가 탁해") 정보가 모자라면 **한 번만 되묻는다.** 대화는 사용자 턴 10개까지, 넘으면 새 대화. "색으로 봐줘" 처럼 말하면 직전 질문을 그 경로로 다시 푼다. 카드의 저장·펼치기·비율·재질은 전과 같다 |
```

파일 지도 표에 한 행:

```markdown
| 대화 | `src/route.js`(어휘표 라우터 · 순수) · `src/chat.js`(되묻기 상태 기계) · `src/trace.js`(`var/traces.jsonl` + LangSmith REST) |
```

- [ ] **Step 5: 커밋**

```bash
git add .gitignore .env.example README.md
git commit -m "docs: .env 옵트인 · 기동 명령 · 채팅창 설명 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 화면 — 탭을 지우고 대화 기록 하나

**Files:**
- Modify: `public/index.html:37-108`, `public/app.js` (전면), `public/app.css`, `public/ui.js:559-587`

**Interfaces:**
- Consumes: `POST /api/chat`.
- Produces: `app.js` 의 `send({ text } | { choice })`. `ui.js` 에서 `TABS`·`asTab`·`tabStore` 제거(`modeStore`·`defaultStorage` 는 남긴다).

- [ ] **Step 1: 실패 확인**

Run: `node scripts/check-stage39.mjs S39-G8 | head -3`
Expected: `index.html 에 role="tablist"` 등.

- [ ] **Step 2: index.html 의 `<main>` 을 바꾼다**

`<section class="hero">` 안의 `.tabs` div 와 `form.searchbar` 를 지우고, `results-palette`·`results-character`·`results-color` 세 section 과 `status` section 을 지운다. `thread` section 은 남긴다. 그 자리에:

```html
  <ol class="chat" id="chat" aria-live="polite"></ol>

  <form class="searchbar searchbar--dock" id="search-form" role="search">
    <label class="searchbar__field" for="q">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" style="color: var(--ink-faint)">
        <circle cx="11" cy="11" r="7"></circle><path d="M16.5 16.5 L21 21"></path>
      </svg>
      <input class="searchbar__input" id="q" name="q" type="search" autocomplete="off"
             placeholder="찾는 색, 고칠 배색, 캐릭터 외형, 또는 #RRGGBB"
             aria-label="문장으로 입력">
    </label>
    <button class="searchbar__submit" type="submit">보내기</button>
  </form>
```

`hero__title` 은 "찾는 색을 문장으로 쓰세요" 그대로.

- [ ] **Step 3: ui.js 에서 탭 저장소를 지운다**

`public/ui.js:559-587` 의 `TABS`·`TAB_KEY`·`asTab`·`tabStore` 를 지운다. `defaultStorage` 는 `modeStore` 가 쓰므로 남긴다.

- [ ] **Step 4: app.js 를 다시 쓴다**

**남기는 것(그대로 복사):** `resultCard`(현재 91-186줄) · `expansionSection`(187-370줄) · `inputCard`·`partnerCard`(518-567줄) · `NOTE_MAX` · `INTENT_LABEL` · `latestTicket` 개념. **지우는 것:** 탭 상수·`applyTab`·`tabButtons` 루프·`TAB_UI`·`render`·`renderStatus`·`renderCharacter`·`renderColor`·`recordTurn`·`recordCharacterTurn`·`recordColorTurn`·`run`·`runCharacter`·`runColor`·`RUN_BY_TAB`·`go`.

새 머리:

```js
// 홈 화면 — 채팅창 하나(39단계). 렌더 조각은 ui.js 가 세 화면과 공유한다.

import { api, applyModeButton, characterStructure, diagnosisCard, el, finishEditing, finishOverrides, modeStore, nextMode, paletteCard, refreshRuntime, sourceLine, structureCard, swatchView } from "./ui.js";

const form = document.getElementById("search-form");
const input = document.getElementById("q");
const submit = form.querySelector(".searchbar__submit");
const chatList = document.getElementById("chat");

const INTENT_LABEL = { palette: "팔레트 탐색", diagnosis: "진단", other: "색과 무관" };
const ROUTE_LABEL = { palette: "추천", diagnosis: "진단", character: "캐릭터", color: "색" };
const NOTE_MAX = 200;

let conversationId = null;
let lastQuery = "";

const threadBox = document.getElementById("thread");
const threadTitle = document.getElementById("thread-title");
const threadMeta = document.getElementById("thread-meta");
```

카드 만들기 — 기존 `render*` 를 **요소를 돌려주는** 함수로 바꾼다:

```js
/** 검색 답(추천·진단) 한 덩어리. 전의 renderStatus + render 를 합쳐 요소로 돌려준다. */
function searchBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  if (!data.confident) {
    const hasAny = data.results.length > 0 || data.diagnostics.length > 0;
    status.append(
      el("span", "status__badge status__badge--warn", "못 잡음"),
      el("span", "status__text", data.rewriteError ? `전문 검색이 못 잡았고 재작성도 실패했습니다 — ${data.rewriteError}` : hasAny ? "어절 전체로 겹친 항이 없습니다 — 아래 결과는 근거가 약하니 그대로 믿지 마세요." : "팔레트 코퍼스에도 진단표에도 걸리는 것이 없습니다."),
    );
  }
  const count = data.route === "diagnosis" ? data.diagnostics.length : data.results.length;
  const timing = [`BM25 ${data.elapsedMs}ms`];
  if (data.hybrid) timing.push(`임베딩 ${data.hybrid.elapsedMs}ms · 코사인 ${data.hybrid.cosine}`);
  status.append(el("span", "status__timing", `${timing.join(" · ")} · ${count}건`));
  if (data.hybridError && data.confident) status.append(el("span", "status__timing", `임베딩은 못 썼습니다 — ${data.hybridError}`));
  if (data.rewrite) {
    const strip = el("div", "rewrite");
    strip.append(el("span", "status__badge", "재작성"), el("span", "rewrite__label", `의도 ${INTENT_LABEL[data.rewrite.intent] ?? data.rewrite.intent} · 검색어`));
    for (const term of data.rewrite.terms) strip.append(el("span", "rewrite__term", term));
    strip.append(el("span", "rewrite__meta", `${data.rewrite.model} · ${data.rewrite.elapsedMs}ms`));
    status.append(strip);
  }
  box.append(status);

  if (data.route === "diagnosis") {
    box.append(el("h2", "results__title", "진단"), el("p", "results__note", "색 조합이 아니라 어느 원인을 의심할지가 답입니다"));
    data.diagnostics.forEach((dx, i) => box.append(diagnosisCard(dx, i + 1)));
    return box;
  }
  if (data.results.length) box.append(el("h2", "results__title", "추천 조합"), el("p", "results__note", "색상각과 톤 좌표를 따로 찍어 정렬했습니다"));
  const [first, ...rest] = data.results;
  if (first) box.append(resultCard(first, 1, true));
  rest.forEach((r, i) => box.append(resultCard(r, i + 2, false)));
  return box;
}

/** 캐릭터 답. 전의 renderCharacter 를 요소로. */
function characterBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · 배색 쌍 ${data.palette.name}`));
  if (data.palette.from === "fallback") status.append(el("span", "character__note", "인상을 못 읽어 기본 배색을 썼습니다"));
  for (const w of data.warnings ?? []) status.append(el("span", "character__note", w));
  box.append(status, el("h2", "results__title", "캐릭터 부위별 색"));

  const struct = characterStructure(data);
  const base = data.finishes?.assignments && Object.keys(data.finishes.assignments).length ? data.finishes.assignments : null;
  const overrides = finishOverrides();
  const editing = base ? finishEditing(overrides, struct, base) : null;
  const finishes = base ? { assignments: base, names: data.finishes.names, ids: data.finishes.ids } : null;
  const onSave = (shares) => api("/api/saved/character", { query: data.query, parts: data.parse.parts, creature: data.parse.creature, paletteId: data.palette.id, shares, finishes: overrides.forStructure(struct, base) });
  const card = structureCard(struct, "light", finishes, onSave, editing);
  card.append(sourceLine(data.colors));
  box.append(card);
  return box;
}

/** 색 답. 전의 renderColor 를 요소로. */
function colorBlock(data) {
  const box = el("div", "answer");
  const status = el("div", "status");
  status.append(el("span", "status__timing", `${data.elapsedMs}ms · 짝 ${data.partners.length}쌍 · 구조 ${data.structures.length}가지`));
  box.append(status, inputCard(data));
  if (data.partners.length) box.append(el("h2", "results__title", "배색사전에서 어울리는 짝"));
  data.partners.forEach((p, i) => box.append(partnerCard(p, i + 1)));

  const modes = modeStore();
  let mode = modes.read();
  const overrides = finishOverrides();
  const fin = data.finishes?.assignments ? data.finishes : null;
  const seedId = `hex-${data.input.hex.slice(1)}`;
  const saveDerived = (st) => (shares) => api("/api/saved/derived", { seedId, structureId: st.id, mode, shares, finishes: overrides.forStructure(st, fin?.assignments) });
  const modeBtn = el("button", "expand__mode-toggle");
  modeBtn.type = "button";
  applyModeButton(modeBtn, mode);
  const grid = el("div", "expand__grid");
  const redraw = () => grid.replaceChildren(...data.structures.map((st) => structureCard(st, mode, fin, saveDerived(st), fin ? finishEditing(overrides, st, fin.assignments) : null)));
  modeBtn.addEventListener("click", () => {
    mode = nextMode(modes, mode);
    applyModeButton(modeBtn, mode);
    modeBtn.focus();
    redraw();
  });
  redraw();
  const modeBox = el("div", "expand__mode");
  modeBox.append(modeBtn);
  box.append(el("h2", "results__title", "배색 구조 여덟"), modeBox, grid);
  return box;
}

const BLOCK_BY_ROUTE = { palette: searchBlock, diagnosis: searchBlock, character: characterBlock, color: colorBlock };
```

대화 항목과 보내기:

```js
/* ── 대화 기록 ─────────────────────────────────────────────── */
function userItem(text) {
  const li = el("li", "chat__item chat__item--user");
  li.append(el("p", "chat__bubble", text));
  return li;
}

function agentItem(...children) {
  const li = el("li", "chat__item chat__item--agent");
  li.append(...children);
  return li;
}

/** 확인 질문. 칩을 누르면 choice 로, 문장을 치면 text 로 간다 — 입력창은 그대로 쓴다. */
function askItem(turn) {
  const box = el("div", "ask");
  box.append(el("p", "ask__question", turn.question));
  if (turn.choices.length) {
    const chips = el("div", "ask__chips");
    for (const c of turn.choices) {
      const chip = el("button", "ask__chip", c.label);
      chip.type = "button";
      chip.dataset.choice = c.id;
      chip.addEventListener("click", () => {
        for (const b of chips.querySelectorAll("button")) b.disabled = true;
        chip.classList.add("ask__chip--picked");
        send({ choice: c.id });
      });
      chips.append(chip);
    }
    box.append(chips);
  }
  return agentItem(box);
}

function answerItem(turn) {
  const head = el("p", "answer__route", `${ROUTE_LABEL[turn.route] ?? turn.route}으로 읽었습니다`);
  const block = (BLOCK_BY_ROUTE[turn.route] ?? searchBlock)(turn.payload);
  return agentItem(head, block);
}

function errorItem(message) {
  const box = el("div", "status");
  box.append(el("span", "status__badge status__badge--warn", "오류"), el("span", "status__text", message));
  return agentItem(box);
}

let latestTicket = 0;

/** 서버에 한 턴을 보낸다. 사용자 말풍선은 먼저 붙이고, 답이 오면 그 아래에 붙인다. */
async function send(body) {
  await ready;
  const ticket = ++latestTicket;
  submit.disabled = true;
  if (body.text) {
    lastQuery = body.text;
    chatList.append(userItem(body.text));
  }
  const waiting = agentItem(el("p", "chat__waiting", "생각 중…"));
  chatList.append(waiting);
  waiting.scrollIntoView({ block: "end" });
  try {
    const data = await api("/api/chat", { conversationId, ...body });
    if (ticket !== latestTicket) return;
    if (data.conversationId !== conversationId) {
      conversationId = data.conversationId;
      showThread({ id: conversationId, turns: [] });
    }
    waiting.replaceWith(data.turn.kind === "ask" ? askItem(data.turn) : answerItem(data.turn));
    if (data.turn.kind === "answer") lastQuery = data.turn.original;
    chatList.lastElementChild?.scrollIntoView({ block: "end" });
  } catch (err) {
    if (ticket === latestTicket) waiting.replaceWith(errorItem(err.message ?? "서버에 닿지 못했습니다"));
  } finally {
    if (ticket === latestTicket) {
      submit.disabled = false;
      input.focus();
    }
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  input.value = "";
  send({ text });
});
```

`api()` 는 `ui.js:14` 의 것 — `api(path, body)` 에 body 를 주면 POST 다. 확인한다.

대화 이어하기(`showThread`·`thread-new`·`ready`)는 기존 코드에서 `applyTab` 줄만 빼고 그대로 둔다. `ready.then` 은:

```js
ready.then((query) => {
  if (!query) return;
  send({ text: query });
});
refreshRuntime(0, () => {});
```

`?conv=` 로 들어왔을 때 옛 턴을 그리는 것: `showThread(conversation)` 안에서 `conversation.turns` 를 `userItem(t.query)` 로만 붙인다(답은 저장돼 있지 않다 — 다시 묻기가 그 역할이다).

- [ ] **Step 5: CSS**

`.tabs` … `.tabs + .searchbar` 블록(app.css 236-270 근처)을 지우고 추가:

```css
/* ── 대화(39단계) ───────────────────────────────────────── */
.chat { list-style: none; margin: 0; padding: 0 0 6rem; display: grid; gap: 1.25rem; }
.chat__item { display: grid; gap: .5rem; }
.chat__item--user { justify-items: end; }
.chat__bubble { margin: 0; padding: .6rem .9rem; border-radius: 1rem 1rem .25rem 1rem; background: var(--ink); color: var(--paper); max-width: 42rem; }
.chat__waiting { margin: 0; color: var(--ink-faint); }
.answer { display: grid; gap: .75rem; }
.answer__route { margin: 0; font-size: .85rem; color: var(--ink-faint); }
.ask { display: grid; gap: .6rem; padding: .9rem 1rem; border: 1px solid var(--line); border-radius: .75rem; }
.ask__question { margin: 0; }
.ask__chips { display: flex; flex-wrap: wrap; gap: .5rem; }
.ask__chip { padding: .45rem .8rem; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: inherit; cursor: pointer; }
.ask__chip:hover, .ask__chip:focus-visible { border-color: var(--ink); }
.ask__chip--picked { background: var(--ink); color: var(--paper); }
.ask__chip:disabled { cursor: default; opacity: .7; }
.searchbar--dock { position: sticky; bottom: 0; background: var(--paper); padding-block: .75rem; }
```

토큰 이름(`--ink`·`--paper`·`--line`·`--ink-faint`)은 `app.css` 상단 `:root` 에서 실제 이름을 확인해 맞춘다.

- [ ] **Step 6: 게이트 · 브라우저**

Run: `node scripts/check-stage39.mjs S39-G8`
Expected: `S39_G8_OK`.

브라우저: `preview_start` 로 서버를 띄우고 `/` 에서 "도적 상의가 탁해" → 칩 둘 → "고칠 원인 보기" 클릭 → 진단 카드. "#E07A5F" → 색 답. "캐릭터로" → 직전 원문을 캐릭터로. 콘솔 오류 0. 모바일 폭(375)에서 입력창이 하단에 붙고 가로 스크롤 없음. 스크린샷을 남긴다.

- [ ] **Step 7: 커밋**

```bash
git add public/index.html public/app.js public/app.css public/ui.js
git commit -m "feat: 탭 셋을 지우고 채팅창 하나 — 확인 질문 칩 · 답 카드 재사용 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 내역 — 경로 배지 · `?tab=` 제거

**Files:**
- Modify: `public/history.js:7-27`

- [ ] **Step 1: ROUTE_LABEL 과 다시 묻기 링크**

```js
const ROUTE_LABEL = { palette: "추천", diagnosis: "진단", character: "캐릭터", color: "색", ask: "되물음", none: "못 잡음" };
```

`again.href` 줄을:

```js
  again.href = `/?conv=${encodeURIComponent(conversationId)}&q=${encodeURIComponent(turn.query)}`;
```

되물은 턴에는 "다시 묻기" 를 붙이지 않는다 — 그 질문은 원문 턴이 따로 있다:

```js
  if (turn.kind !== "ask") meta.append(again);
```

- [ ] **Step 2: 확인**

Run: `node scripts/check-stage4.mjs S4-G1` … `S4-G6` 와 `grep -n "tab=" public/history.js`
Expected: 전부 `_OK`, grep 결과 없음.

- [ ] **Step 3: 커밋**

```bash
git add public/history.js
git commit -m "feat: 내역에 되물음 배지 · tab 파라미터 제거 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 옛 게이트의 탭 단정을 대체하고 회귀를 닫는다

**Files:**
- Modify: `scripts/check-stage34.mjs`, `scripts/check-stage35.mjs`(S35-G5), `scripts/check-stage36.mjs`(S36-G4), `GATES.md`(해당 게이트 문장 · 39단계 G10 수 · 총계), `README.md`(게이트 수)

**왜:** S34·S35-G5·S36-G4 는 "탭 셋이 있고 `tabStore` 가 있다" 를 단정한다. 39단계가 그 구조를 없앴으므로 **게이트가 지키려던 뜻**(색 결과가 그려진다 · 저장소 접근은 ui.js 한 곳 · 화면에 "LLM" 없음)만 남기고 탭 단정은 새 구조의 단정으로 바꾼다. 게이트 수는 유지한다.

- [ ] **Step 1: 어느 단정이 깨지는지 실측**

Run: `for s in 34 35 36; do for i in 1 2 3 4 5 6 7 8 9 10; do node scripts/check-stage$s.mjs S$s-G$i 2>/dev/null | tail -1; done; done | grep -v _OK`
Expected: 깨진 게이트 목록. 그리고 `grep -n "tab" scripts/check-stage34.mjs scripts/check-stage35.mjs scripts/check-stage36.mjs` 로 단정 줄을 찾는다.

- [ ] **Step 2: 단정을 대체한다 — 대응표**

| 옛 단정 | 새 단정 |
|---|---|
| `index.html` 에 탭 셋 문구 | `index.html` 에 `<ol class="chat"` |
| 결과 영역이 `tabpanel` | `app.js` 에 `BLOCK_BY_ROUTE` 와 `colorBlock`·`characterBlock` |
| 탭이 `/api/color`·`/api/character` 로 감 | `app.js` 가 `"/api/chat"` 을 부름 |
| `?tab=` 을 `asTab` 으로 읽음 · `tabStore` 가 `color` 를 받음 | `ui.js`·`app.js` 에 `tabStore`·`asTab` 없음 |
| 내역 `tab=color` 링크 | 내역 `ROUTE_LABEL` 에 `ask: "되물음"` |
| `applyTab` 이 탭이 바뀔 때만 검색창을 비움 | `form` submit 이 `input.value = ""` 뒤 `send({ text })` |

각 게이트의 **나머지 단정**(`structureCard`·`swatchView` 재사용 · 저장소 접근은 ui.js 한 곳 · "LLM" 없음 · `hex-` 씨앗으로 `/api/saved/derived`)은 그대로 둔다. `GATES.md` 의 그 게이트 문장도 같은 표로 고치고 문장 끝에 `(39단계가 탭 단정을 대체)` 를 붙인다.

- [ ] **Step 3: 회귀 게이트 수를 확정한다**

Run: `for s in 4 22 34 35 36; do ls scripts/check-stage$s.mjs >/dev/null && node -e "const s=require('fs').readFileSync('scripts/check-stage$s.mjs','utf8');console.log($s,(s.match(/\"S$s-G\\d+\"/g)||[]).length)"; done`
Expected: 단계별 게이트 수. `check-stage39.mjs` 의 `S39-G10` 표와 `GATES.md` 의 G10 문장을 그 수로 맞춘다.

- [ ] **Step 4: 게이트 수 세 곳**

Run: `node scripts/check-stage22.mjs S22-G6`
Expected: 실패하며 어느 문서의 수가 실제와 다른지 말한다. 그 세 곳(README 의 "게이트 N개" · GATES.md 총계 · 단계별 수)을 검사기가 센 값으로 고친다. 다시 돌려 `S22_G6_OK`.

- [ ] **Step 5: 39단계 전부 + 회귀**

Run: `for i in 1 2 3 4 5 6 7 8 9 10; do node scripts/check-stage39.mjs S39-G$i | tail -1; done`
Expected: 열 줄 전부 `_OK`.

- [ ] **Step 6: 음성 대조 — 일부러 깨뜨려 게이트가 우는지**

1. `src/route.js` 에서 `if (routes.length === 1 && routes[0] === "character" && weak)` 줄을 주석 처리 → `S39-G1` 이 "눈에 띄는 색" 으로 실패해야 한다. 되돌린다.
2. `src/chat.js` 의 pending 분기에서 `const route = …` 를 `return record(askTurn(...))` 로 바꿔 두 번 묻게 → `S39-G3` 실패. 되돌린다.
3. `src/trace.js` 의 `if (!enabled) return;` 을 지움 → `S39-G5` 실패. 되돌린다.
4. `src/trace.js` 의 `post` 를 `await` 하게 바꾸고 `LANGSMITH_ENDPOINT` 를 죽은 포트로 → `S39-G6` 두 번째 절 실패. 되돌린다.

각각 실패 출력 첫 줄을 세션 재개 문서에 적는다(Task 11).

- [ ] **Step 7: 커밋**

```bash
git add scripts/check-stage34.mjs scripts/check-stage35.mjs scripts/check-stage36.mjs scripts/check-stage39.mjs GATES.md README.md
git commit -m "test: 옛 탭 단정을 채팅 구조로 대체 · 39단계 회귀 확정 · 게이트 수 동기화

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 격리 리뷰 · 세션 재개 문서 · 작업 목록

**Files:**
- Create: `docs/session-resume/2026-09-15-unified-chat-router-39.md`
- Modify: `docs/com/open-work.md`

- [ ] **Step 1: 격리 리뷰 2인**

`~/.claude/scripts/review-fanout.sh` 로 이 브랜치의 39단계 커밋 범위를 리뷰한다(CLAUDE.md 규칙 — 본 트리에서 리뷰어를 돌리지 않는다). 리뷰어 프롬프트에 **완료 조건을 직접 넣는다**: 설계 문서 7절 게이트 표 열 줄과 "의존성 0 · 헥스 안 지어냄 · 화면에 LLM 없음 · 같은 원문에 되묻기 1회". 산출물 경로는 둘이 겹치지 않게 한다. 종료 코드와 산출물 둘 다 확인한다.

Critical·High 는 고치고 해당 게이트를 다시 돌린다. 안 고치는 지적은 이유를 세션 재개 문서에 적는다.

- [ ] **Step 2: 세션 재개 문서**

`docs/session-resume/2026-09-15-unified-chat-router-39.md`:

```markdown
# 39단계 — 탭 통합 · 결정적 라우터 · 되묻기

## 무엇을 했나
- 탭 셋 제거, `POST /api/chat` 하나. `src/route.js`(어휘표 라우터) · `src/chat.js`(되묻기 상태 기계) · `src/trace.js`(traces.jsonl + LangSmith REST).
- 대화 상한 10턴, 되묻기는 같은 원문에 1회. 바로잡기 낱말("색으로"·"캐릭터로"·"진단으로"·"추천으로").
- 세 GET 엔드포인트는 남겼다 — 옛 게이트와 저장·내보내기 흐름이 붙어 있다.

## 왜 그렇게 했나 (버린 대안은 설계 문서에)
- 설계: docs/superpowers/specs/2026-09-15-unified-chat-router-design.md
- 계획: docs/superpowers/plans/2026-09-15-unified-chat-router.md

## 지금 상태
- 39단계 게이트 10/10 `[실측]`. 회귀 S4·S22·S34·S35·S36 통과 `[실측]`.
- 음성 대조 4건: (Task 10 Step 6 의 실패 첫 줄을 여기 적는다)
- 리뷰 지적과 처리: (Task 11 Step 1 결과)
- LangSmith 실제 전송은 **키가 없어 미실측.** 가짜 서버로만 형식을 확인했다. 키를 넣은 뒤 대시보드에서 `chat.turn` 런이 보이는지 한 번 봐야 한다.

## 알려진 한계
- LLM 자식 런에 프롬프트 원문이 없다 — 처리기 응답에서 모델명·결과만 옮긴다. 프롬프트까지 보내려면 rewrite.js·describe.js 에 훅이 필요하다.
- 라우터의 짧은 부위 낱말("눈"·"옷")은 색 낱말이나 다른 부위가 함께 있어야 캐릭터다. "눈이 요란해" 는 겹침으로 되묻는다 — 의도된 것.
- `?conv=` 로 이어 열 때 옛 답 카드는 안 그린다. 저장돼 있지 않다.

## 다음에 할 일
- 대표가 `.env` 에 LangSmith 키를 넣고 실제 전송을 본다.
- B1 OKLCH 좌표계 브레인스토밍(설계 문서 머리의 순서).
```

- [ ] **Step 3: open-work.md**

"지금 하는 것" 절에 39단계 완료 항목을 더하고, 새 항목으로 **F4 LangSmith 실전송 미실측** · **F5 LLM 런에 프롬프트 없음** 을 적절한 표에 더한다. 끝난 것은 없으므로 지울 항목은 없다.

- [ ] **Step 4: 커밋 · 대표 확인 뒤 머지**

```bash
git add docs/session-resume/2026-09-15-unified-chat-router-39.md docs/com/open-work.md
git commit -m "docs: 39단계 세션 기록 · 작업 목록 갱신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

머지·푸시·서버 재기동은 대표 확인 뒤(메모리 `workflow-merge-and-run-per-stage`).

---

## 자체 점검

- **스펙 대조:** 1절 라우터 → Task 3. 2절 상태 기계 → Task 2·6. 3절 `/api/chat` → Task 5·6. 4절 관측·`.env` → Task 4·6·7. 5절 화면 → Task 8. 6절 내역 → Task 9. 7절 게이트 → Task 1·10. 8절 파일 → 파일 구조 표. 9절 되돌리기 → 세션 문서.
- **스펙과 다른 점 하나:** 4절의 LLM 자식 런에 "프롬프트" 를 넣기로 했으나 처리기 응답에는 프롬프트가 없다. 모델명·결과만 보내고 한계로 적는다(Task 11). 프롬프트가 꼭 필요하면 rewrite.js·describe.js 에 훅을 넣는 별도 작업이다.
- **이름 일치:** `createRouter`·`route()`·`createChat`·`step()`·`createTracer`·`begin()`·`child()`·`end()`·`computeSearch`·`computeColor`·`computeCharacter`·`findConversation`·`DATA_DIR`·`BLOCK_BY_ROUTE`·`send()` — 선언한 Task 와 쓰는 Task 가 같은 이름이다.
- **실측이 우선인 자리:** S39-G10 의 단계별 게이트 수, CSS 토큰 이름, `pipeline.diagnostics` getter 존재 여부 — 셋 다 계획이 아니라 실행 중 확인해 맞춘다고 적었다.
