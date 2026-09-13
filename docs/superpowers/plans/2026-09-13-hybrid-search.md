# 검색 3단계 하이브리드 구현 계획 (26단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BM25 가 흔한 어절 하나로 우기던 거짓 확신을 임베딩이 거르고, 저신뢰 질의를 LLM 보다 먼저 임베딩 결합 재순위(3단계)로 잡는다.

**Architecture:** 서버가 뜰 때 코퍼스 34건(팔레트 16 · 진단 18)을 Ollama `bge-m3` 로 벡터화해 메모리에 둔다. 질의마다 BM25 와 코사인을 둘 다 보고, 둘이 같은 답이면 1단계, 어긋나거나 저신뢰면 RRF 결합 재순위(3단계), 그래도 저신뢰면 LLM 재작성 뒤 다시 3단계(2단계). 실행 순서는 1→3→2, 응답 `stage` 는 가장 높이 쓴 칸.

**Tech Stack:** Node 24 ESM · 의존성 0 · Ollama `/api/embed` (`bge-m3`) · 기존 BM25(`src/bm25.js`) · 게이트 검사기 `scripts/check-stage26.mjs`

**Spec:** `docs/superpowers/specs/2026-09-13-hybrid-search-design.md`

## Global Constraints

- 의존성 0 — `node_modules` 없이 `node` 만으로 돈다 (`S1-G4`).
- 던지지 않는다 — 임베딩 실패(모델 없음 · Ollama 죽음 · 타임아웃 · 준비 중)는 전부 "3단계 건너뜀" 이고 결과는 지금의 1·2단계와 같다.
- 확신 검색은 1초 미만 (`S3-G8`). 1단계 경로의 임베딩 예산은 **1500ms**, 넘기면 BM25 답 그대로.
- 게이트는 구현보다 먼저 쓴다. 감시 값(문턱 · 픽스처)은 대상에서 import 하지 않고 검사기에 사본으로 적는다.
- 사용자 입력이 `spawn` 에 닿지 않는다 (`S3-G5`). 임베딩 호출은 HTTP 뿐이다.
- 루프백 밖에 바인딩했을 때 오류 원문(`hybridError`)을 내보내지 않는다 — `rewriteError` 와 같은 경계.
- 문턱 상수는 `[실측]` 태그와 함께 두고, 값은 G1 실측으로 정한다. 관측: 정답 1위 코사인 0.44~0.74, 오답 1위 0.38~0.53.
- 커밋은 대표 확인 뒤에 한다. 브랜치는 `stage-26-hybrid-search`, `main` 에 `--ff-only` 머지.
- 설명은 쉬운 말 먼저, 정확한 용어는 뒤에 (프로젝트 `CLAUDE.md`).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/hybrid.js` (새) | 순수 함수. 동의 판정 `agrees` · 결합 재순위 `fuse` · 확신·라우팅 판정 `decide` · 코사인 `cosine`. Ollama 를 모른다 |
| `src/embed.js` (새) | Ollama `/api/embed` 호출 · 코퍼스 벡터 준비 `prepare` · 질의 벡터 `embedQuery` · 유사도 `similarities` · 상태 `status`. 던지지 않는다 |
| `src/palettes.js` · `src/diagnostics.js` | 임베딩용 문장 `embedText` 추가. BM25 색인 문장 `indexText` 는 그대로 |
| `src/pipeline.js` | 1→3→2 흐름. 응답에 `hybrid` · `hybridError` |
| `src/store.js` | 턴 기록에 `stage` 3 허용 · `usedLlm` 불리언 |
| `server.js` | 기동 시 `prepare()` · `/api/status` 에 `embed` · `maxStage` 3 · `/api/search` 응답에 `hybrid`·`hybridError`(경계 적용) |
| `public/app.js` · `public/history.js` · `public/app.css` | 3단계 배지·문구 · 시간 줄에 임베딩 ms · 사다리 3칸 · LLM 횟수는 `usedLlm` 로 |
| `scripts/check-stage26.mjs` (새) | S26-G1~G7 |
| `GATES.md` · `README.md` · `docs/com/open-work.md` · `docs/session-resume/2026-09-13-hybrid-search-26.md` | 게이트 193 → 200 · 기록 |

---

### Task 0: 게이트를 먼저 적는다 (GATES.md 26단계 절 + 검사기 골격)

**Files:**
- Modify: `GATES.md` (끝에 절 추가)
- Create: `scripts/check-stage26.mjs`

**Interfaces:**
- Produces: `node scripts/check-stage26.mjs S26-G<n>` → 통과 시 `S26_G<n>_OK` 출력 · exit 0. 게이트 본문은 Task 1~4 가 채운다. 이 태스크는 **골격 + 픽스처 + 스텁 서버**만 만든다.

- [ ] **Step 1: `GATES.md` 끝에 26단계 절을 붙인다**

```markdown

## 26단계 — 검색 3단계 하이브리드 · BM25 와 임베딩이 어긋나면 확신을 거둔다

코퍼스 어휘와 겹치지 않는 질의 18건을 1·2단계에 넣었더니 **7건만 맞았다** `[실측]`. 틀린 11건 중
9건은 3단계가 없어서가 아니라 **1단계가 "색"·"브랜드"·"같아요" 같은 흔한 어절 하나로 확신해**
LLM 까지 안 내려간 것이다. 그래서 3단계를 붙이면서 그 거짓 확신도 함께 거둔다(대표 결정).

임베딩(`bge-m3`)만으로 같은 질의 23건(실측 18 + `S1-G2` 5)에서 top1 17 · 라우팅 22 `[실측]`.
지연은 따뜻할 때 45ms, 간헐적 2.2초. 그래서 확신 검색 경로의 임베딩은 1.5초 예산으로 부르고
넘기면 BM25 답을 그대로 쓴다 — `S3-G8` 의 "1초 미만" 을 지킨다.

설계: `docs/superpowers/specs/2026-09-13-hybrid-search-design.md`

S26-G1 실측 질의 23건에서 정답이 7 보다 늘고, 거짓 확신 9건이 1단계에 안 남는다 · 두 방법이 같은 답이면 1단계 그대로 (양성 대조) · 실제 bge-m3 필요
    CHECK: node scripts/check-stage26.mjs S26-G1
    EXPECT: S26_G1_OK

S26-G2 정확 매칭 회귀 — `S1-G2` 다섯 건이 여전히 1단계·같은 답이고 LLM 을 안 부른다
    CHECK: node scripts/check-stage26.mjs S26-G2
    EXPECT: S26_G2_OK

S26-G3 임베딩이 없으면(모델 없음 · 죽은 호스트) 1·2단계가 그대로 돌고 상태가 `unavailable` 로 정직하다 (양성 대조: 있으면 `ready`)
    CHECK: node scripts/check-stage26.mjs S26-G3
    EXPECT: S26_G3_OK

S26-G4 확신 검색이 느린 임베딩(3초)에 안 끌린다 — 1초 안에 1단계로 답한다 (양성 대조: 저신뢰 질의는 기다린다)
    CHECK: node scripts/check-stage26.mjs S26-G4
    EXPECT: S26_G4_OK

S26-G5 `hybrid.js` 가 스텁 벡터로 결정적이다 — 동의 판정 · RRF 결합 · 문턱 · 라우팅 (감시 값 사본)
    CHECK: node scripts/check-stage26.mjs S26-G5
    EXPECT: S26_G5_OK

S26-G6 루프백 밖에 바인딩하면 `hybridError` 원문이 안 샌다 (루프백 양성 대조)
    CHECK: node scripts/check-stage26.mjs S26-G6
    EXPECT: S26_G6_OK

S26-G7 화면 — 3단계 배지·문구 · 사다리 3칸 · LLM 횟수가 `usedLlm` 기준 · 턴 기록이 stage 3 을 받는다
    CHECK: node scripts/check-stage26.mjs S26-G7
    EXPECT: S26_G7_OK
```

- [ ] **Step 2: 검사기 골격을 쓴다 — 픽스처 · 스텁 Ollama · 자식 프로세스 · 서버 하네스**

`scripts/check-stage26.mjs`:

```js
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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **감시할 값을 여기 다시 적는다.** `hybrid.js` 에서 가져오면 그 상수를 바꾸는 순간 게이트가 함께
 * 느슨해진다. 값이 바뀌면 여기와 거기를 함께 고치고, 그 이유를 GATES.md 알려진 한계에 적는다.
 */
const AGREE_TOP = 3;
const COS_MIN = 0.44; // [실측] 정답 1위 최솟값. G1 이 이 값으로 정답 수를 잰다
const RRF_K = 60;
const FAST_BUDGET_MS = 1500;

/**
 * 실측 질의 23건. `want` 가 정답, `bm25Wrong` 은 지금 1단계가 틀린 답을 확신하는 9건,
 * `vocabGap` 은 코퍼스 별칭에 없어 임베딩도 못 잡는 것이 맞는 3건(정답 수에 안 넣는다).
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
  { q: "명절 저녁 식탁의 온기", want: "pair-09", bm25Wrong: true },
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
  let cfg = { embedDelayMs: 0, embedStatus: 200, ...initial };
  let chatCalls = 0;
  let embedCalls = 0;
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
    env: { ...process.env, OLLAMA_AUTOSTART: "0", ...env },
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
  throw new Error("임베딩 준비가 30초 안에 안 끝났다");
}

const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();
const topOf = (r) => (r.route === "diagnosis" ? r.diagnostics[0]?.id : r.results[0]?.id) ?? null;

const GATES = {
  "S26-G1": async () => { throw new Error("아직 안 씀 (Task 3)"); },
  "S26-G2": async () => { throw new Error("아직 안 씀 (Task 3)"); },
  "S26-G3": async () => { throw new Error("아직 안 씀 (Task 2)"); },
  "S26-G4": async () => { throw new Error("아직 안 씀 (Task 3)"); },
  "S26-G5": async () => { throw new Error("아직 안 씀 (Task 1)"); },
  "S26-G6": async () => { throw new Error("아직 안 씀 (Task 3)"); },
  "S26-G7": async () => { throw new Error("아직 안 씀 (Task 4)"); },
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
```

- [ ] **Step 3: 일곱 게이트가 전부 실패하는지 본다**

Run: `for g in 1 2 3 4 5 6 7; do node scripts/check-stage26.mjs S26-G$g; echo "exit=$?"; done`
Expected: 일곱 줄 모두 `S26-G<n> 실패: 아직 안 씀 ...` · `exit=1`

- [ ] **Step 4: `S22-G6` 이 우는지 본다 (게이트 수 불일치 — README 는 Task 5 에서 맞춘다)**

Run: `node scripts/check-stage22.mjs S22-G6`
Expected: exit 1, `README 선언이 193 — 실제 200` 류의 메시지. 이것이 Task 5 의 할 일을 고정한다.

- [ ] **Step 5: 커밋 (대표 확인 뒤)**

```bash
git checkout -b stage-26-hybrid-search
git add GATES.md scripts/check-stage26.mjs
git commit -m "test: 26단계 게이트를 구현보다 먼저 적는다 (하이브리드 검색)"
```

---

### Task 1: `src/hybrid.js` — 순수 함수 (동의 · RRF 결합 · 판정) + S26-G5

**Files:**
- Create: `src/hybrid.js`
- Modify: `scripts/check-stage26.mjs` (`S26-G5` 본문)

**Interfaces:**
- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `agrees(top: {id:string}, sims: {id:string}[], within = AGREE_TOP): boolean` — `top.id` 가 `sims` 앞 `within` 개 안에 있는가
  - `fuse(bm25: {id:string, kind:"palette"|"diagnosis"}[], sims: {id, kind, cosine}[]): {id, kind, cosine, rrf}[]` — RRF 내림차순
  - `decide(fused): {route:"palette"|"diagnosis"|"none", confident:boolean, top: fused[0]|null}`
  - 상수 `AGREE_TOP = 3`, `COS_MIN = 0.44`, `RRF_K = 60`
- Consumes: 없음 (순수)

- [ ] **Step 1: G5 본문을 쓴다 — 스텁 벡터로 결정적 검사**

`scripts/check-stage26.mjs` 의 `"S26-G5"` 를 다음으로 바꾼다:

```js
  /*
   * 순수 함수라 Ollama 없이 검사한다. 감시 값(AGREE_TOP·COS_MIN·RRF_K)은 위 사본으로 계산해
   * 구현과 대조한다 — 구현이 상수를 바꾸면 여기가 운다.
   */
  "S26-G5": async () => {
    const { cosine, agrees, fuse, decide, AGREE_TOP: A, COS_MIN: C, RRF_K: K } = await import("../src/hybrid.js");
    const bad = [];
    if (A !== AGREE_TOP || C !== COS_MIN || K !== RRF_K) bad.push(`상수가 사본과 다르다: ${A}/${C}/${K} (사본 ${AGREE_TOP}/${COS_MIN}/${RRF_K})`);

    // 코사인 — 문헌 값 셋
    const close = (x, y) => Math.abs(x - y) < 1e-9;
    if (!close(cosine([1, 0], [1, 0]), 1)) bad.push("같은 벡터의 코사인이 1 이 아니다");
    if (!close(cosine([1, 0], [0, 1]), 0)) bad.push("직교 벡터의 코사인이 0 이 아니다");
    if (!close(cosine([1, 0], [-1, 0]), -1)) bad.push("반대 벡터의 코사인이 -1 이 아니다");

    // 동의 판정 — 앞 AGREE_TOP 안이면 참, 바로 그다음이면 거짓
    const sims = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, kind: "palette", cosine: 0.9 - i * 0.1 }));
    if (!agrees({ id: "c" }, sims)) bad.push("상위 3 안(3위)인데 동의하지 않는다");
    if (agrees({ id: "d" }, sims)) bad.push("4위인데 동의한다");
    if (agrees({ id: "zzz" }, sims)) bad.push("없는 문서인데 동의한다");

    // RRF — BM25 에만 있는 문서, 코사인에만 있는 문서, 둘 다에 있는 문서
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

    // 판정 — 문턱 바로 위는 확신, 바로 아래는 저신뢰, 빈 목록은 none
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node scripts/check-stage26.mjs S26-G5`
Expected: `S26-G5 실패: Cannot find module ... hybrid.js` · exit 1

- [ ] **Step 3: `src/hybrid.js` 를 쓴다**

```js
// 3단계의 순수한 부분 — BM25 결과와 임베딩 유사도를 **어떻게 합치고 어떻게 판정하는가**.
// Ollama 를 모른다. 그래서 스텁 벡터로 결정적으로 검사할 수 있다(S26-G5).
//
// 왜 RRF(Reciprocal Rank Fusion)인가 — 두 점수의 단위가 다르다. BM25 는 0~수십, 코사인은 -1~1.
// 값을 섞으면 어느 한쪽 단위가 이긴다. 순위만 쓰면 단위가 사라진다. k=60 은 원 논문의 값이다 [문헌].

/** 동의 범위 — BM25 1위가 임베딩 상위 몇 안에 있어야 "같은 답" 으로 보나. */
export const AGREE_TOP = 3;
/** 확신 문턱 — 결합 1위의 코사인이 이 값 이상이면 3단계가 확신한다. [실측] 정답 1위 최솟값 0.44 */
export const COS_MIN = 0.44;
/** RRF 상수. [문헌] Cormack et al. 2009 */
export const RRF_K = 60;

export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const norm = Math.sqrt(na) * Math.sqrt(nb);
  return norm === 0 ? 0 : dot / norm;
}

/** @param {{id:string}} top BM25 1위 @param {{id:string}[]} sims 코사인 내림차순 */
export function agrees(top, sims, within = AGREE_TOP) {
  return sims.slice(0, within).some((s) => s.id === top.id);
}

/**
 * @param {{id:string, kind:"palette"|"diagnosis"}[]} bm25 BM25 순위(두 코퍼스를 이은 목록)
 * @param {{id:string, kind:"palette"|"diagnosis", cosine:number}[]} sims 코사인 내림차순
 * @returns {{id:string, kind:string, cosine:number, rrf:number}[]} RRF 내림차순
 */
export function fuse(bm25, sims) {
  const score = new Map();
  const meta = new Map();
  const add = (id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank));
  bm25.forEach((h, i) => {
    add(h.id, i + 1);
    meta.set(h.id, { kind: h.kind, cosine: 0 });
  });
  sims.forEach((s, i) => {
    add(s.id, i + 1);
    meta.set(s.id, { kind: s.kind, cosine: s.cosine });
  });
  return [...score.entries()]
    .map(([id, rrf]) => ({ id, ...meta.get(id), rrf }))
    .sort((a, b) => b.rrf - a.rrf);
}

/** 결합 1위의 코퍼스가 route, 그 코사인이 문턱 이상이면 확신. */
export function decide(fused) {
  const top = fused[0] ?? null;
  if (!top) return { route: "none", confident: false, top: null };
  return { route: top.kind, confident: top.cosine >= COS_MIN, top };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node scripts/check-stage26.mjs S26-G5`
Expected: `S26_G5_OK` · exit 0

- [ ] **Step 5: 음성 대조 — `RRF_K` 를 50 으로 바꿔 G5 가 우는지 본다. 확인 뒤 되돌린다**

Run: `sed -i 's/RRF_K = 60/RRF_K = 50/' src/hybrid.js && node scripts/check-stage26.mjs S26-G5; git checkout src/hybrid.js`
Expected: `상수가 사본과 다르다` 로 실패, 되돌린 뒤 통과

- [ ] **Step 6: 커밋**

```bash
git add src/hybrid.js scripts/check-stage26.mjs
git commit -m "feat: 하이브리드 결합·판정을 순수 함수로 둔다 (26단계 · hybrid.js)"
```

---

### Task 2: `src/embed.js` + 임베딩 문장 + S26-G3

**Files:**
- Create: `src/embed.js`
- Modify: `src/palettes.js` (`embedText` 추가, `indexText` 아래)
- Modify: `src/diagnostics.js` (`embedText` 추가)
- Modify: `scripts/check-stage26.mjs` (`S26-G3` 본문)

**Interfaces:**
- Produces:
  - `embedText(p)` (팔레트) → `"${name}. ${summary} ${impression} ${tags.join(" ")}"` · `embedText(d)` (진단) → `"${symptom}. ${aliases.join(", ")}. ${prescription}"`
  - `embed.status(): {state:"unknown"|"ready"|"unavailable", detail:string, model:string, count:number}`
  - `embed.prepare(docs: {id, kind, text}[]): Promise<status>` — 던지지 않는다. 실패는 `unavailable`
  - `embed.embedQuery(text, {timeoutMs}): Promise<{vector:number[]|null, error:string|null, elapsedMs:number}>`
  - `embed.similarities(vector): {id, kind, cosine}[]` 내림차순 (준비 안 됐으면 `[]`)
  - `embed.EMBED_MODEL`, `embed.EMBED_TIMEOUT_MS`
- Consumes: `cosine` from `src/hybrid.js`

- [ ] **Step 1: G3 본문을 쓴다 — 죽은 호스트 · 없는 모델 · 양성 대조(스텁)**

```js
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
say({ state: st.state, detail: st.detail, qv: q.vector, qerr: q.error, sims: sims.length, stage: r.stage, top: r.paletteHits[0]?.doc.id ?? null, hybrid: r.hybrid ?? null });
`;
    // 1. 죽은 호스트
    const gone = await runChild(code, { OLLAMA_HOST: dead });
    if (gone.state !== "unavailable") bad.push(`죽은 호스트인데 상태가 ${gone.state}`);
    if (!String(gone.detail).includes(dead)) bad.push(`사유에 호스트가 없다: "${gone.detail}"`);
    if (gone.qv !== null || typeof gone.qerr !== "string") bad.push("죽은 호스트에서 질의 벡터가 null/사유가 아니다");
    if (gone.sims !== 0) bad.push("준비 안 됐는데 유사도가 나온다");
    if (gone.stage !== 1 || gone.top !== "pair-10") bad.push(`임베딩 없이 1단계가 깨졌다: stage=${gone.stage} top=${gone.top}`);
    if (gone.hybrid !== null) bad.push("임베딩 없는데 hybrid 가 null 이 아니다");

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

    if (bad.length) throw new Error(bad.join(" / "));
    out(`죽은 호스트·모델 없음에서 unavailable + 1단계 그대로 · 살아 있으면 ready`);
    out("S26_G3_OK");
  },
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node scripts/check-stage26.mjs S26-G3`
Expected: `Cannot find module ... embed.js` · exit 1

- [ ] **Step 3: 임베딩 문장을 두 코퍼스에 더한다**

`src/palettes.js` 의 `indexText` 바로 아래:

```js
// 임베딩용 문장. BM25 색인 문장(indexText)과 **다르다** — 색 이름·헥스·유형 라벨을 빼고 뜻이 있는
// 문장만 남긴다. 실측: 전체 색인 문장으로 임베딩하면 23건 top1 13, 이 문장으로 17 [실측].
// 헥스와 유형 라벨은 임베딩에 잡음이고, 정확 매칭은 BM25 가 맡는다.
export const embedText = (p) => `${p.name}. ${p.summary} ${p.impression} ${p.tags.join(" ")}`;
```

`src/diagnostics.js` 의 `indexText` 바로 아래:

```js
// 임베딩용 문장. 네 변형(증상+별칭 · +상세 · +처방 · 전체)이 10건에서 전부 7/10 로 같았다 [실측].
// 가장 짧고 사용자 말투(별칭)와 처방을 함께 담는 것을 고른다.
export const embedText = (d) => `${d.symptom}. ${d.aliases.join(", ")}. ${d.prescription}`;
```

- [ ] **Step 4: `src/embed.js` 를 쓴다**

```js
// 임베딩 — Ollama `/api/embed` 로 코퍼스와 질의를 벡터로 만들고 코사인으로 비교한다.
//
// 규칙 셋 — ollama.js 와 같은 정신이다.
//   1. 던지지 않는다. 실패는 상태와 사유로 남는다. 임베딩이 없어도 1·2단계는 그대로 돈다(S26-G3).
//   2. 프로세스를 띄우지 않는다. 기동은 ollama.js 의 몫이고 여기는 HTTP 뿐이다.
//   3. 사용자 입력은 요청 본문으로만 간다. spawn 에 닿는 경로가 없다(S3-G5).
//
// 코퍼스 벡터는 캐시하지 않는다 — 34건이 따뜻할 때 0.5초다 [실측]. 필요가 생기면 그때(스펙 "버린 대안").

import { cosine } from "./hybrid.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "bge-m3";
/** 저신뢰 경로의 예산. 처음 적재 때 7초까지 봤다 [실측]. 확신 경로는 호출부가 더 짧게 준다. */
export const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 8000);

/** @type {{state:"unknown"|"ready"|"unavailable", detail:string, model:string, count:number}} */
let current = { state: "unknown", detail: "아직 확인하지 않았다", model: EMBED_MODEL, count: 0 };
/** @type {{id:string, kind:"palette"|"diagnosis", vector:number[]}[]} */
let corpus = [];

export const status = () => ({ ...current });

/** 벡터 배열을 돌려주거나 던진다. 던지는 것은 이 파일 안에서만 잡는다. */
async function callEmbed(input, timeoutMs) {
  const res = await fetch(`${BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error ? `${EMBED_MODEL}: ${json.error}` : `Ollama 가 ${res.status}`);
  if (!Array.isArray(json?.embeddings)) throw new Error("임베딩 응답에 embeddings 배열이 없다");
  return json.embeddings;
}

const reason = (err) => (err.name === "TimeoutError" || err.name === "AbortError" ? `${HOST} 가 제때 답하지 않았다` : err.message);

/**
 * 코퍼스를 벡터화한다. 기동 때 한 번 부르고 기다리지 않는다 — 준비 전 질의는 3단계를 건너뛴다.
 * @param {{id:string, kind:"palette"|"diagnosis", text:string}[]} docs
 */
export async function prepare(docs) {
  try {
    const vectors = await callEmbed(docs.map((d) => d.text), EMBED_TIMEOUT_MS * 4);
    if (vectors.length !== docs.length) throw new Error(`벡터 ${vectors.length}개, 문서 ${docs.length}개`);
    corpus = docs.map((d, i) => ({ id: d.id, kind: d.kind, vector: vectors[i] }));
    current = { ...current, state: "ready", detail: `${HOST} 응답 · ${EMBED_MODEL}`, count: corpus.length };
  } catch (err) {
    corpus = [];
    // 연결 거부와 모델 없음을 가른다 — 사용자가 고칠 것이 다르다(Ollama 를 띄우기 vs ollama pull).
    const detail = err.cause?.code === "ECONNREFUSED" || /fetch failed/.test(err.message)
      ? `${HOST} 가 응답하지 않는다`
      : reason(err);
    current = { ...current, state: "unavailable", detail, count: 0 };
  }
  return status();
}

/** 질의 하나를 벡터로. 실패해도 던지지 않는다 — { vector: null, error } 로 돌아온다. */
export async function embedQuery(text, { timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  const started = Date.now();
  if (current.state !== "ready") {
    return { vector: null, error: `임베딩을 쓸 수 없다 (${current.detail})`, elapsedMs: 0 };
  }
  try {
    const [vector] = await callEmbed([text], timeoutMs);
    return { vector, error: null, elapsedMs: Date.now() - started };
  } catch (err) {
    return { vector: null, error: reason(err), elapsedMs: Date.now() - started };
  }
}

/** 코퍼스 전체와의 코사인. 내림차순. 준비 안 됐으면 빈 배열. */
export function similarities(vector) {
  if (!vector || corpus.length === 0) return [];
  return corpus
    .map((d) => ({ id: d.id, kind: d.kind, cosine: cosine(vector, d.vector) }))
    .sort((a, b) => b.cosine - a.cosine);
}
```

- [ ] **Step 5: G3 는 파이프라인의 `hybrid` 필드를 보므로 아직 실패한다 — 어느 줄에서 실패하는지 확인한다**

Run: `node scripts/check-stage26.mjs S26-G3`
Expected: exit 1. 실패 사유가 `hybrid` 관련이 아니라면(예: `state` 가 `unavailable` 이 아님) 이 태스크의 결함이다. `hybrid` 가 `undefined` 라 `null 이 아니다` 로만 실패하면 정상 — Task 3 이 닫는다.

- [ ] **Step 6: 커밋**

```bash
git add src/embed.js src/palettes.js src/diagnostics.js scripts/check-stage26.mjs
git commit -m "feat: 코퍼스와 질의를 bge-m3 로 벡터화한다 (26단계 · embed.js)"
```

---

### Task 3: `pipeline.js` 1→3→2 + `server.js` 연결 + S26-G1·G2·G4·G6

**Files:**
- Modify: `src/pipeline.js` (`resolve` 전체 · `createPipeline` 반환에 `embedDocs`)
- Modify: `server.js` — `maxStage`(줄 43) · `handleSearch` 응답(줄 171~197) · `handleStatus`(줄 413~423) · 기동 블록(줄 603~624) · import
- Modify: `scripts/check-stage26.mjs` (`S26-G1`·`G2`·`G4`·`G6` 본문)

**Interfaces:**
- Consumes: `embed.*`, `hybrid.*`, `embedText`(팔레트·진단)
- Produces:
  - `pipeline.resolve(query, limit, {allowRewrite})` 결과에 `hybrid: {model, cosine, elapsedMs} | null`, `hybridError: string | null` 추가. `stage` 는 1 · 2 · 3
  - `pipeline.embedDocs: {id, kind, text}[]` — 서버가 `prepare()` 에 넘긴다
  - `/api/search` 응답에 `hybrid`, `hybridError`, `usedLlm: boolean`
  - `/api/status` 응답에 `embed: {state, detail?, model?, count}` (루프백 밖에서는 `state` 만) · `stage` 가 임베딩 준비 시 3

- [ ] **Step 1: G1·G2·G4·G6 본문을 쓴다**

```js
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
        if (f.bm25Wrong && r.stage === 1 && top !== f.want) bad.push(`거짓 확신이 남았다: "${f.q}" → 1단계 ${top}`);
        if (r.stage === 3 && r.hybrid === null) bad.push(`3단계인데 hybrid 가 null: "${f.q}"`);
        rows.push(`  ${ok ? "O" : f.vocabGap ? "-" : "X"} ${f.q} → ${r.stage}단계 ${top ?? "-"} (기대 ${f.want})`);
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
   * 정확 매칭 회귀. S1-G2 의 다섯이 여전히 1단계·같은 답·LLM 0회. 임베딩이 살아 있는 상태에서 잰다 —
   * 죽은 상태에서 재면 3단계가 아예 안 돌아 늘 통과한다.
   */
  "S26-G2": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      await withServer(4342, { OLLAMA_HOST: stub.host }, async (get) => {
        await waitEmbedReady(get);
        for (const f of FIXTURE.filter((x) => x.exact)) {
          const r = await search(get, f.q);
          if (r.stage !== 1) bad.push(`"${f.q}" 가 ${r.stage}단계`);
          if (topOf(r) !== f.want) bad.push(`"${f.q}" → ${topOf(r)} (기대 ${f.want})`);
          if (r.rewrite !== null || r.usedLlm) bad.push(`"${f.q}" 에서 LLM 을 불렀다`);
        }
        if (stub.chatCalls() !== 0) bad.push(`LLM 호출 ${stub.chatCalls()}회`);
      });
    } finally {
      stub.close();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`정확 매칭 5건 1단계 유지 · LLM 0회`);
    out("S26_G2_OK");
  },

  /*
   * 느린 임베딩이 확신 검색을 느리게 하면 안 된다. 스텁이 3초 뒤에 답하게 하고, 확신 질의가 1초 안에
   * 1단계로 답하는지 잰다. 양성 대조 — 저신뢰 질의는 기다린다(3초 넘게 걸리고 3단계 또는 hybridError).
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
        if (r.hybridError === null) bad.push("예산을 넘겼는데 hybridError 가 없다 — 조용히 넘어간다");

        const s2 = Date.now();
        const low = await search(get, "zzqq 없는말");
        const wall2 = Date.now() - s2;
        if (wall2 < 2500) bad.push(`저신뢰 질의가 ${wall2}ms 만에 답했다 — 임베딩을 기다리지 않았다 (이 게이트가 헛돌고 있다)`);
      });
    } finally {
      stub.close();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`확신 질의 1초 안 · 저신뢰 질의는 임베딩을 기다림`);
    out("S26_G4_OK");
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
      // 루프백: 원문. 스텁에 3초 지연을 걸어 확신 경로에서 hybridError 를 만든다.
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
    // 루프백 밖: 원문 숨김. 죽은 호스트로 unavailable 을 만든다.
    const server = await startServer(4345, { HOST: "0.0.0.0", OLLAMA_HOST: dead });
    try {
      const get = (p) => fetch(`http://127.0.0.1:4345${p}`);
      const r = await (await get(`/api/search?q=${encodeURIComponent("zzqq 없는말")}`)).json();
      if (r.hybridError !== null && r.hybridError.includes(dead)) bad.push(`루프백 밖인데 원문이 샌다: ${r.hybridError}`);
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
```

- [ ] **Step 2: 넷 다 실패하는지 본다**

Run: `for g in 1 2 4 6; do node scripts/check-stage26.mjs S26-G$g; echo "exit=$?"; done`
Expected: 전부 exit 1 (`임베딩 준비가 30초 안에 안 끝났다` 또는 `embed` 없음)

- [ ] **Step 3: `src/pipeline.js` 를 1→3→2 로 고친다**

파일 머리 주석 아래 import 에 더한다:

```js
import { embedText as paletteEmbedText } from "./palettes.js";
import { embedText as diagnosticEmbedText } from "./diagnostics.js";
import { embedQuery, similarities, status as embedStatus, EMBED_MODEL } from "./embed.js";
import { agrees, decide, fuse } from "./hybrid.js";

/** 확신 경로의 임베딩 예산. 넘기면 BM25 답을 그대로 쓴다 — S3-G8 의 "1초 미만" 을 지킨다. [실측] 따뜻할 때 45ms, 튐 2.2초 */
const FAST_BUDGET_MS = 1500;
```

`createPipeline()` 반환 객체에 더한다:

```js
    embedDocs: [
      ...palettes.palettes.map((p) => ({ id: p.id, kind: "palette", text: paletteEmbedText(p) })),
      ...diagnostics.diagnostics.map((d) => ({ id: d.id, kind: "diagnosis", text: diagnosticEmbedText(d) })),
    ],
```

`resolve` 를 통째로 바꾼다:

```js
    /**
     * @returns 항상 결과 객체. 던지지 않는다.
     *   route: "palette" | "diagnosis" | "none"
     *   stage: 1 (전문 검색만) | 3 (임베딩 결합까지) | 2 (LLM 재작성까지) — 가장 높이 쓴 칸.
     *          실행 순서는 1→3→2 다. 번호는 문서의 비용 사다리를 따른다(스펙).
     *   hybrid: {model, cosine, elapsedMs} | null — 3단계가 답을 정했을 때만
     *   hybridError: string | null — 임베딩을 못 썼을 때의 사유 (경계는 서버가 적용)
     *   usedLlm: boolean
     */
    async resolve(query, limit = 3, { allowRewrite = true } = {}) {
      const started = process.hrtime.bigint();
      const byId = new Map([
        ...palettes.palettes.map((p) => [p.id, { doc: p, kind: "palette" }]),
        ...diagnostics.diagnostics.map((d) => [d.id, { doc: d, kind: "diagnosis" }]),
      ]);

      const paletteHits = palettes.search(query, limit);
      const diagnosticHits = diagnostics.search(query, 2);
      const paletteOk = isConfident(paletteHits);
      const diagnosisOk = isConfident(diagnosticHits);

      // 1단계 후보 — 둘 다 걸리면 어절 전체로 겹친 항이 더 많은 쪽. 동점이면 팔레트(아래 주석 참조).
      let stage1 = null;
      if (paletteOk || diagnosisOk) {
        const paletteWhole = paletteHits[0]?.wholeMatches ?? 0;
        const diagnosisWhole = diagnosticHits[0]?.wholeMatches ?? 0;
        const takeDiagnosis = diagnosisOk && (!paletteOk || diagnosisWhole > paletteWhole);
        stage1 = takeDiagnosis
          ? { route: "diagnosis", top: diagnosticHits[0].doc.id, paletteHits: [], diagnosticHits }
          : { route: "palette", top: paletteHits[0].doc.id, paletteHits, diagnosticHits: [] };
      }

      // 임베딩 — 확신 후보가 있으면 짧은 예산, 없으면 긴 예산. 준비 안 됐으면 바로 사유만 남는다.
      const budget = stage1 ? FAST_BUDGET_MS : undefined;
      const q = embedStatus().state === "ready" ? await embedQuery(query, budget ? { timeoutMs: budget } : {}) : { vector: null, error: `임베딩을 쓸 수 없다 (${embedStatus().detail})`, elapsedMs: 0 };
      const sims = similarities(q.vector);
      const hybridError = q.error;

      // 1단계 — 확신 후보가 있고, 임베딩이 없거나(사유는 남긴다) 동의하면 지금까지와 같다.
      if (stage1 && (sims.length === 0 || agrees({ id: stage1.top }, sims))) {
        return {
          stage: 1, route: stage1.route, confident: true,
          paletteHits: stage1.paletteHits, diagnosticHits: stage1.diagnosticHits,
          searchMs: ms(started), hybrid: null, hybridError, usedLlm: false,
        };
      }

      const searchMs = ms(started);
      // 약한 증거 둘 다 담는다 — 팔레트만 담고 진단만 버리면 비대칭이다.
      const base = { stage: 1, route: "none", confident: false, paletteHits, diagnosticHits, searchMs, hybrid: null, hybridError, usedLlm: false };

      // 3단계 — 결합 재순위. 임베딩이 없으면 여기를 못 하고 바로 2단계로 간다.
      const rerank = (pHits, dHits) => {
        const bm25 = [...pHits.map((h) => ({ id: h.doc.id, kind: "palette" })), ...dHits.map((h) => ({ id: h.doc.id, kind: "diagnosis" }))];
        const fused = fuse(bm25, sims);
        const verdict = decide(fused);
        const pick = (kind, n) => fused.filter((f) => f.kind === kind).slice(0, n).map((f) => ({ doc: byId.get(f.id).doc, score: f.rrf, matched: [], wholeMatches: 0, cosine: f.cosine }));
        return {
          route: verdict.route, confident: verdict.confident,
          paletteHits: verdict.route === "diagnosis" ? [] : pick("palette", limit),
          diagnosticHits: verdict.route === "diagnosis" ? pick("diagnosis", 2) : [],
          hybrid: verdict.top ? { model: EMBED_MODEL, cosine: Number(verdict.top.cosine.toFixed(3)), elapsedMs: q.elapsedMs } : null,
        };
      };

      if (sims.length > 0) {
        const h = rerank(paletteHits, diagnosticHits);
        if (h.confident) return { ...base, ...h, stage: 3, searchMs: ms(started) };
        if (!allowRewrite) return { ...base, ...h, stage: 3, searchMs: ms(started) };
      } else if (!allowRewrite) {
        return base;
      }

      // 2단계 — 그래도 저신뢰일 때만 LLM 을 부른다. 재작성어로 BM25 를 다시 돌리고, 임베딩은 원 질의 벡터를 그대로 쓴다.
      const rw = await rewrite(query);
      if (rw.error) return { ...base, rewriteError: rw.error, ...(sims.length ? { stage: 3, ...rerank(paletteHits, diagnosticHits), confident: false } : {}) };

      const rewritten = expandTerms(rw.terms, vocabulary) || query;
      const after = process.hrtime.bigint();

      if (rw.intent === "other") {
        return { ...base, stage: 2, route: "none", confident: false, paletteHits: [], diagnosticHits: [], rewrite: rw, usedLlm: true };
      }

      const pHits2 = rw.intent === "diagnosis" ? [] : palettes.search(rewritten, limit);
      const dHits2 = rw.intent === "diagnosis" ? diagnostics.search(`${query} ${rewritten}`, 2) : [];

      if (sims.length > 0) {
        const h = rerank(pHits2, dHits2);
        // 재작성이 의도를 갈랐으면 그 코퍼스만 본다 — 결합이 반대 코퍼스를 1위로 올려도 의도를 이기지 못한다.
        const wantKind = rw.intent === "diagnosis" ? "diagnosis" : "palette";
        const stuck = h.route !== "none" && h.route !== wantKind;
        return {
          ...base, ...h, stage: 3, rewrite: rw, usedLlm: true,
          route: stuck ? "none" : h.route, confident: stuck ? false : h.confident,
          searchMs: searchMs + ms(after),
        };
      }

      // 임베딩 없이 재작성만 — 지금까지의 2단계 그대로.
      if (rw.intent === "diagnosis") {
        return { ...base, stage: 2, route: dHits2.length ? "diagnosis" : "none", confident: isConfident(dHits2), paletteHits: [], diagnosticHits: dHits2, rewrite: rw, usedLlm: true, searchMs: searchMs + ms(after) };
      }
      return { ...base, stage: 2, route: pHits2.length ? "palette" : "none", confident: isConfident(pHits2), paletteHits: pHits2, diagnosticHits: [], rewrite: rw, usedLlm: true, searchMs: searchMs + ms(after) };
    },
```

- [ ] **Step 4: `server.js` 를 연결한다**

import 에 더한다:

```js
import { prepare as prepareEmbeddings, status as embedStatus } from "./src/embed.js";
```

`maxStage` 를 바꾼다 (줄 43):

```js
// 3단계는 임베딩이 준비됐을 때, 2단계는 Ollama 가 준비됐을 때만 가능하다.
const maxStage = (ollamaState, embedState) => (embedState === "ready" ? 3 : ollamaState === "ready" ? 2 : 1);
```

`handleSearch` 의 `sendJson(res, 200, {...})` 에 세 필드를 더한다 (`rewriteError` 줄 아래):

```js
    hybrid: r.hybrid ?? null,
    // rewriteError 와 같은 경계 — 사유에 OLLAMA_HOST 가 들어간다.
    hybridError: r.hybridError ? (LOOPBACK_ONLY ? r.hybridError : "임베딩을 쓸 수 없습니다") : null,
    usedLlm: r.usedLlm === true,
```

`handleStatus` 를 바꾼다:

```js
async function handleStatus(res) {
  // refresh 는 확인만 한다 — 요청이 프로세스 기동을 유발하지 않는다(S3-G5).
  const ollama = await refreshOllama();
  const embed = embedStatus();
  sendJson(res, 200, {
    stage: maxStage(ollama.state, embed.state),
    corpus: pipeline.palettes.length,
    diagnostics: pipeline.diagnostics.length,
    ollama: LOOPBACK_ONLY ? ollama : { state: ollama.state, startedByUs: ollama.startedByUs },
    // 같은 경계. 모델명·호스트가 들어간 사유는 루프백에서만.
    embed: LOOPBACK_ONLY ? embed : { state: embed.state, count: embed.count },
  });
}
```

기동 블록의 `ensureRunning().then((s) => { ... })` 안, 워밍업 `if` **앞**에 더한다:

```js
      // 코퍼스 벡터를 미리 만든다. 기다리지 않는다 — 준비 전 질의는 3단계를 건너뛴다.
      if (s.state === "ready" && process.env.EMBED_PREPARE !== "0") {
        prepareEmbeddings(pipeline.embedDocs).then((e) => {
          process.stdout.write(Buffer.from(`임베딩 ${e.state === "ready" ? `준비됨 — ${e.model} ${e.count}건` : `쓸 수 없음 — ${e.detail}`}\n`, "utf8"));
        });
      }
```

그리고 `OLLAMA_AUTOSTART=0` 일 때도 준비해야 게이트(스텁 호스트)가 성립한다. `if (process.env.OLLAMA_AUTOSTART !== "0") {...}` 블록 **뒤**에 더한다:

```js
  if (process.env.OLLAMA_AUTOSTART === "0" && process.env.EMBED_PREPARE !== "0") {
    // 자동 기동을 껐어도 떠 있는 Ollama 가 있으면 임베딩은 쓴다. 없으면 unavailable 로 남는다.
    prepareEmbeddings(pipeline.embedDocs).then((e) => {
      process.stdout.write(Buffer.from(`임베딩 ${e.state === "ready" ? `준비됨 — ${e.model} ${e.count}건` : `쓸 수 없음 — ${e.detail}`}\n`, "utf8"));
    });
  }
```

- [ ] **Step 5: 게이트를 돌린다 — G3 · G5 · G2 · G4 · G6 (스텁) 그리고 G1 (실제 bge-m3)**

Run: `for g in 3 5 2 4 6 1; do node scripts/check-stage26.mjs S26-G$g; echo "exit=$?"; done`
Expected: 전부 `S26_G<n>_OK`. G1 이 `정답 N` 을 찍는데, **N 이 7 이하이거나 거짓 확신이 남으면 `COS_MIN`·`AGREE_TOP` 을 실측으로 조정한다** — 두 파일(`hybrid.js` · 검사기 사본)을 함께 고치고 `[실측]` 값을 갱신한다. 값을 바꾼 이유와 관측치를 GATES.md 알려진 한계에 적는다.

- [ ] **Step 6: 회귀 — 1·2·3단계 전체**

Run: `node -e 'const {spawnSync}=require("node:child_process");const g=require("node:fs").readFileSync("GATES.md","utf8").match(/^S(1|2|3)-G\d+ /gm).map(s=>s.trim());let bad=[];for(const id of g){const st=id.match(/^S(\d+)-/)[1];const r=spawnSync(process.execPath,[`scripts/check-stage${st}.mjs`,id],{encoding:"utf8"});const ok=r.status===0&&r.stdout.includes(id.replace(/-/g,"_")+"_OK");console.log((ok?"통과 ":"실패 ")+id);if(!ok)bad.push(id)}console.log(bad.length?"실패: "+bad.join(", "):"전부 통과");process.exitCode=bad.length?1:0'`
Expected: 전부 통과. `S3-G8`(확신 검색 1초 미만)이 특히 중요하다 — 실패하면 `FAST_BUDGET_MS` 경로가 안 걸린 것이다.

- [ ] **Step 7: 커밋**

```bash
git add src/pipeline.js server.js scripts/check-stage26.mjs
git commit -m "feat: 검색이 1→3→2 로 돈다 — 임베딩이 거짓 확신을 거른다 (26단계)"
```

---

### Task 4: 기록 · 화면 — `store.js` · `app.js` · `history.js` · `app.css` + S26-G7

**Files:**
- Modify: `src/store.js:181` (`stage`), 턴 객체에 `usedLlm`
- Modify: `public/app.js` — `renderStatus`(3단계 분기 · 시간 줄) · `recordTurn`(`usedLlm`) · `showThread`(LLM 횟수)
- Modify: `public/history.js:36-37` (LLM 횟수)
- Modify: `public/app.css` (`.turn__stage--3` — `--2` 옆에)
- Modify: `public/index.html:91` 사다리 주석 문구
- Modify: `scripts/check-stage26.mjs` (`S26-G7` 본문)

**Interfaces:**
- Consumes: `/api/search` 의 `stage` 3 · `hybrid` · `usedLlm`
- Produces: 턴 기록 `{stage: 1|2|3, usedLlm: boolean, ...}`

- [ ] **Step 1: G7 본문을 쓴다 — 정적 검사 + 턴 기록 왕복**

```js
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

    // 턴 기록 — stage 3 과 usedLlm 이 저장되고, 위조(stage 99 · usedLlm "yes")는 막힌다.
    const stub = await stubOllama();
    try {
      await withServer(4346, { OLLAMA_HOST: stub.host }, async (get) => {
        const post = (body) => fetch(`http://127.0.0.1:4346/api/conversations/turn`, {
          method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4346" }, body: JSON.stringify(body),
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
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node scripts/check-stage26.mjs S26-G7`
Expected: `app.js 에 3단계 분기가 없다 / ... / 턴1이 1/undefined ...` · exit 1

- [ ] **Step 3: `src/store.js` — 턴 기록**

줄 181 `stage: input.stage === 2 ? 2 : 1,` 을 바꾸고 `usedLlm` 을 더한다:

```js
    // 3단계(임베딩 결합)가 생겼다. 열거값 위조는 여전히 1 로 떨어진다(S4-G5).
    stage: [1, 2, 3].includes(input.stage) ? input.stage : 1,
    route: VALID_ROUTES.has(input.route) ? input.route : "none",
    confident: input.confident === true,
    // LLM 을 썼는가는 stage 로 못 센다 — 3단계 뒤에 재작성이 올 수 있다. 따로 받되 불리언만 믿는다.
    usedLlm: input.usedLlm === true,
```

- [ ] **Step 4: `public/app.js` — 상태 문구 · 시간 줄 · 기록 · 스레드 메타**

`renderStatus` 의 `} else if (data.stage === 1) {` 블록 **뒤**, 마지막 `else` **앞**에 더한다:

```js
  } else if (data.stage === 3) {
    statusBox.append(
      el("span", "status__badge", "3단계"),
      el(
        "span",
        "status__text",
        data.usedLlm
          ? "전문 검색과 임베딩이 못 잡아 로컬 LLM 이 질문을 다시 썼고, 그 검색어를 임베딩과 결합해 골랐습니다."
          : "전문 검색만으로는 근거가 어긋나 임베딩과 결합해 다시 골랐습니다. LLM 을 부르지 않았습니다.",
      ),
    );
```

시간 줄을 바꾼다 (`BM25 ${data.elapsedMs}ms · ${count}건`):

```js
  const timing = [`BM25 ${data.elapsedMs}ms`];
  if (data.hybrid) timing.push(`임베딩 ${data.hybrid.elapsedMs}ms · 코사인 ${data.hybrid.cosine}`);
  statusBox.append(el("span", "status__timing", `${timing.join(" · ")} · ${count}건`));
```

`hybridError` 가 있고 확신 결과일 때는 조용히 넘기지 않는다 — `if (data.rewrite) {` 앞에:

```js
  if (data.hybridError && data.confident) {
    statusBox.append(el("span", "status__note", `임베딩은 못 썼습니다 — ${data.hybridError}`));
  }
```

`recordTurn` 의 본문에 `usedLlm` 을 더한다 (`stage: data.stage,` 아래):

```js
    usedLlm: data.usedLlm === true,
```

`showThread` 의 LLM 횟수:

```js
  const usedLlm = conversation.turns.filter((t) => t.usedLlm === true).length;
```

- [ ] **Step 5: `public/history.js` · `public/app.css` · `public/index.html`**

`history.js` 줄 36~37:

```js
  const usedLlm = conversation.turns.filter((t) => t.usedLlm === true).length;
```

`app.css` 의 `.turn__stage--2 {` 규칙 아래에 같은 모양으로 더한다 (색은 `--2` 와 구분되는 기존 토큰을 쓴다 — 새 색을 만들지 않는다):

```css
.turn__stage--3 {
  /* 2단계와 구분되되 경고색은 아니다 — 3단계는 LLM 없이 로컬에서 끝난 것이다 */
  background: var(--color-surface-2);
  color: var(--color-text);
}
```

(토큰 이름은 `app.css` 상단 `:root` 의 실제 이름으로 맞춘다. 없는 토큰을 쓰지 않는다.)

`index.html` 줄 91 의 사다리 주석:

```html
      <span class="ladder__note">코퍼스 34건. 3단계까지 올렸습니다 — 실측 18건 중 11건이 틀려서.</span>
```

- [ ] **Step 6: G7 통과 · 4·7단계 회귀**

Run: `node scripts/check-stage26.mjs S26-G7 && for g in $(grep -o '^S[47]-G[0-9]*' GATES.md); do node scripts/check-stage$(echo $g | sed 's/S\([0-9]*\)-.*/\1/').mjs $g | tail -1; done`
Expected: `S26_G7_OK` · S4-G1~G7 · S7-G1~G4 전부 `_OK`

- [ ] **Step 7: 브라우저 실측 — `tonefirst` 로 띄워 "빈티지 레코드 가게" 를 넣고 3단계 배지 · 시간 줄 · 사다리 3칸을 읽는다. `/history` 에서 LLM 횟수가 0 인지 본다.** 결과를 세션 재개 문서에 적는다.

- [ ] **Step 8: 커밋**

```bash
git add src/store.js public/app.js public/history.js public/app.css public/index.html scripts/check-stage26.mjs
git commit -m "feat: 3단계를 화면과 기록이 안다 — LLM 횟수는 usedLlm 로 센다 (26단계)"
```

---

### Task 5: 문서 · 게이트 수 · 격리 리뷰

**Files:**
- Modify: `README.md` — 게이트 수 193 → 200 · S26 행 · `check-stage{1..26}` · 파일 지도에 `src/embed.js`·`src/hybrid.js` · 환경변수 절에 `OLLAMA_EMBED_MODEL`·`EMBED_TIMEOUT_MS`·`EMBED_PREPARE`
- Modify: `GATES.md` — 26단계 알려진 한계
- Modify: `docs/com/open-work.md` — "지금 하는 것" 을 26단계로, 새로 드러난 것(어휘 부재 3건 → 별칭 보강 후보)
- Create: `docs/session-resume/2026-09-13-hybrid-search-26.md`

- [ ] **Step 1: README 를 고치고 `S22-G6` 을 돌린다**

S26 행:

```markdown
| S26 | 7 | **거짓 확신 9건이 1단계에 안 남음** · 정확 매칭 회귀 · **임베딩 없어도 그대로** · 느린 임베딩에 안 끌림 · 결합·판정 결정적 · 오류 원문 경계 · 화면·기록 |
```

Run: `node scripts/check-stage22.mjs S22-G6`
Expected: `게이트 200개가 네 곳에서 같다`

- [ ] **Step 2: GATES.md 알려진 한계 (26단계) 를 적는다** — 최소 다음 넷:

```markdown
### 알려진 한계 (26단계)

- **`COS_MIN`·`AGREE_TOP` 은 23건 실측에서 나온 값이다.** 씨앗·코퍼스가 늘면 다시 잰다. 값을 바꾸면
  `hybrid.js` 와 `check-stage26.mjs` 사본을 함께 고친다 — 한쪽만 고치면 `S26-G5` 가 운다.
- **어휘 부재 3건은 임베딩도 못 잡는 것이 맞다.** "죽어 보여요" 는 `dx-flat-value` 별칭에 없고,
  "색이 서로 싸워요" 는 `dx-mismatch` 도 맞는 답이다. 별칭 보강은 코퍼스 작업이라 이 단계 밖이다.
- **간헐적 2.2초 튐의 원인을 못 잡았다.** GPU 8GB 에 두 모델이 같이 올라간 상태에서 관측됐고,
  확신 경로는 1.5초 예산으로 피하지만 저신뢰 경로는 그대로 기다린다. 화면이 시간을 그대로 보여 준다.
- **코퍼스 벡터를 캐시하지 않는다.** 서버가 뜰 때마다 34건을 다시 만든다(따뜻할 때 0.5초, 처음 7초).
  게이트가 서버를 여러 번 띄우므로 게이트 시간이 그만큼 는다.
```

- [ ] **Step 3: 격리 리뷰 두 건** — `review-fanout.sh` 로 라운드를 새로 고정해(마지막은 43) worktree 둘을 열고 `typescript-reviewer`·`code-reviewer` 를 돌린다. 완료 조건(S26-G1~G7)과 본 트리 실측(정답 수 · 회귀 목록)을 프롬프트에 직접 넣는다. Critical·High 는 고치고 게이트를 다시 돌린다. 리뷰어가 트리를 바꾸지 않았는지(`git status` clean) 확인한다.

- [ ] **Step 4: 세션 재개 문서 + open-work** — 무엇을 했나 · 왜(버린 대안은 스펙 지목) · 게이트 실측 표(구현 전/후 · G1 정답 수) · 브라우저 실측 · 리뷰 지적과 처리 · 지금 상태 · 다음 할 일 · 확인 질문 3개.

- [ ] **Step 5: 전체 게이트 · 커밋 · 머지 (대표 확인 뒤)**

Run: 26단계 7개 + 회귀(S1·S2·S3·S4·S7·S22-G6) 전부.

```bash
git add README.md GATES.md docs/com/open-work.md docs/session-resume/2026-09-13-hybrid-search-26.md
git commit -m "docs: 26단계 세션 기록 · 게이트 200"
git checkout main && git merge --ff-only stage-26-hybrid-search && git push origin main
```

---

## 자체 검토

**스펙 대조**
- 데이터 흐름 1→3→2, `stage` = 가장 높이 쓴 칸 → Task 3
- 동의 판정 · RRF · `COS_MIN` `[실측]` → Task 1 (상수) · Task 3 Step 5 (값 조정 절차)
- 확신 경로 1.5초 예산 → Task 3 (`FAST_BUDGET_MS`) · G4
- 2단계 뒤 재검색은 원 질의 벡터 재사용 → Task 3 `rerank(pHits2, dHits2)` 가 `sims` 를 그대로 씀
- 라우팅 = 결합 1위의 코퍼스 → `decide`
- 임베딩 문장(요약 · 증상+별칭+처방) → Task 2
- 오류 처리(던지지 않음 · 준비 중 건너뜀 · `hybridError` 경계) → Task 2 · Task 3 · G6
- `/api/status` `embed` · `maxStage` 3 → Task 3
- 화면 · `usedLlm` · 턴 기록 → Task 4
- 게이트 G1~G7 · 회귀 → Task 0~5
- 되돌리는 법 → 스펙에 있음

**빈칸** — 없음. 토큰 이름 하나(`app.css` 색 토큰)는 실제 파일에서 맞추라고 적어 뒀다.

**이름 일치** — `embedQuery`·`similarities`·`prepare`·`status`(embed) · `agrees`·`fuse`·`decide`·`cosine` · `embedText` · `usedLlm` · `hybrid`·`hybridError` 가 Task 1~4 와 검사기에서 같은 이름이다. `pipeline.embedDocs` 는 Task 3 에서 만들고 같은 태스크의 `server.js` 가 쓴다.
