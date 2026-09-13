#!/usr/bin/env node
// 25단계(오류 문구가 거짓말하지 않고, 보이지 않는 질의가 모델을 안 부른다) · D1·D2 완료 조건 검사기.
//   node scripts/check-stage25.mjs S25-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** G1·G3 이 실패하는 것을 확인한 뒤에 src 를 고쳤다.
// G2 는 전 코드가 사유를 아예 안 건드려 고치기 전에도 통과했고, 덮어쓰는 변형으로 우는 것을 확인했다.
// G4 는 회귀 게이트라 고치기 전에도 통과해야 한다 — 그것이 "회귀" 의 뜻이다.
// G5 는 리뷰 지적에서 나왔다 — ready 사유를 매번 덮어쓰던 첫 구현에서 실패하는 것을 확인한 뒤 고쳤다.
//
// **`src/*.js` 를 정적으로 import 하지 않는다.** `ollama.js` 가 `OLLAMA_HOST`·`OLLAMA_BIN` 을
// 모듈 적재 시점에 읽고 상태를 모듈 변수에 들고 있으며, 탐지에 5초 TTL 이 있다. 한 프로세스
// 안에서 상황을 바꿔 가며 재면 앞 상황의 상태가 뒤 상황에 새어 들어간다. 그래서 상황마다
// **자식 프로세스 하나**를 띄워 환경변수를 먼저 세우고 그 안에서 모듈을 불러 온다.
// check-stage3 이 같은 이유로 같은 모양을 쓴다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * **감시할 문구를 여기 다시 적는다.** 대상에서 가져오면 그 문구를 바꾸는 순간 게이트가 함께
 * 느슨해진다. `ollama.js` 의 초기 사유가 이 문장이고, 결함은 이것이 **탐지한 뒤에도** 남는 것이다.
 */
const LIE = "아직 확인하지 않았다";

/** TTL 은 `ollama.js` 의 상수(5000)다. 감시 대상에서 읽지 않고 여기 다시 적는다. */
const AFTER_TTL_MS = 5200;

/** `finish.js` 가 아는 역할. `material.js` 의 표를 가져오지 않고 사본으로 적는다(S17 과 같은 이유). */
const ROLES = Object.freeze(["바탕", "면", "본문", "강조", "먼 쪽", "중간", "가까운 쪽"]);

/** `selectStructures` 에 넘길 카탈로그 모양. 내용은 무관하다 — 재는 것은 "부르는가" 다. */
const CATALOG = Object.freeze(
  ["a", "b", "c", "d", "e", "f"].map((id) => ({ id: `s-${id}`, name: `구조 ${id}`, principle: "게이트용" })),
);

/**
 * 폭 0 문자만으로 된 질의들. 전부 유니코드 서식 문자(Cf)이거나 그것과 공백의 조합이다.
 *   U+200B zero-width space · U+200C/U+200D zero-width (non-)joiner · U+2060 word joiner · U+FEFF BOM
 * `.trim()` 은 이 중 U+FEFF 만 공백으로 본다.
 */
const INVISIBLE = Object.freeze(["\u200B", "\u200C\u200D", "\u2060", "\uFEFF", " \u200B\t", "\u200B\u200B\u200B", "\u200B \u2060 \u200C"]);

/**
 * 가짜 Ollama. `/api/tags` 로 준비됨을 만들고 `/api/chat` 호출을 **센다.**
 * check-stage14·17 의 것과 같은 모양을 독립적으로 적는다 — 한쪽에서 읽어 오면 그쪽 하네스가
 * 바뀔 때 이 단계 게이트가 조용히 다른 것을 검사하게 된다.
 */
function stubOllama() {
  let chatCalls = 0;
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }] }));
    }
    if (req.url === "/api/chat") {
      chatCalls += 1;
      for await (const _ of req) void _;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: "{}" } }));
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
        calls: () => chatCalls,
        reset: () => {
          chatCalls = 0;
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
 * 자식 프로세스에서 ESM 코드를 돌리고 `RESULT {json}` 한 줄을 결과로 받는다.
 * 환경변수를 먼저 세우고 그 안에서 `src/*.js` 를 불러 오게 한다(파일 머리 주석).
 *
 * `selfExit` — 자식이 `process.exit` 로 스스로 끝나기를 기다린다. 부모가 죽이면 exit 훅이 안 돌아
 * 자식이 띄운 Ollama 가 고아로 남는다(Windows 의 kill 은 TerminateProcess 다). S25-G5 만 쓴다.
 */
function runChild(code, env, { timeoutMs = 30000, selfExit = false } = {}) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: ROOT,
    env: { ...process.env, OLLAMA_AUTOSTART: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let result = null;
    const finish = (fn) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!selfExit) child.kill();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`자식이 ${timeoutMs}ms 안에 안 끝났다. stderr: ${stderr.trim()}`))), timeoutMs);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (!line) return;
      try {
        const parsed = JSON.parse(line.slice("RESULT ".length));
        if (selfExit) result = parsed; // exit 를 기다렸다가 그때 돌려준다
        else finish(() => resolve(parsed));
      } catch (err) {
        finish(() => reject(new Error(`자식 출력이 JSON 이 아니다: ${line}`)));
      }
    });
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => {
      if (done) return;
      if (selfExit && result !== null && code === 0) return finish(() => resolve(result));
      finish(() => reject(new Error(`자식이 ${result === null ? "결과 없이 " : ""}코드 ${code} 로 끝났다: ${stderr.trim()}`)));
    });
  });
}

const IMPORTS = `
import { refresh, ensureRunning } from "${new URL("../src/ollama.js", import.meta.url).href}";
import { selectStructures } from "${new URL("../src/structure.js", import.meta.url).href}";
import { selectFinishes } from "${new URL("../src/finish.js", import.meta.url).href}";
import { rewrite } from "${new URL("../src/rewrite.js", import.meta.url).href}";
const CATALOG = ${JSON.stringify(CATALOG)};
const ROLES = ${JSON.stringify(ROLES)};
// 자식은 스스로 exit 하지 않는다. fetch 소켓이 닫히는 도중에 exit 하면 Windows libuv 가 어서션으로
// 죽는다(실측, 한 틱 미뤄도 같다). 결과 한 줄을 찍으면 부모가 그 줄을 받고 자식을 죽인다.
const say = (o) => { console.log("RESULT " + JSON.stringify(o)); };
`;

/** 서버를 띄워 실제 응답을 본다. check-stage17 과 같은 모양을 독립적으로 적는다. */
function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", ...env },
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

/** check-stage3 의 게이트 하나를 돌려 종료 코드와 OK 표식을 함께 본다. */
function runStage3(id) {
  const child = spawn(process.execPath, ["scripts/check-stage3.mjs", id], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => resolve({ id, code, ok: code === 0 && stdout.includes(id.replace(/-/g, "_") + "_OK"), tail: (stdout + stderr).trim().split("\n").pop() ?? "" }));
  });
}

const GATES = {
  /*
   * 죽어 있으면 **확인한 뒤** "없다" 고 말해야 한다. "아직 확인하지 않았다" 는 확인 전에만 참이다.
   *
   * **양성 대조가 필수다.** 문구만 없애는 구현(사유를 통째로 비우기)도 "없다" 는 통과시킨다.
   * 그래서 죽은 쪽은 사유에 호스트가 있어야 하고, 산 쪽은 ready 이면서 사유가 그 문구가 아니어야 한다.
   */
  "S25-G1": async () => {
    const bad = [];
    const dead = await deadHost();

    const probeCode = `${IMPORTS}
const s = await refresh();
const st = await selectStructures("가을 카페 브랜딩", CATALOG);
const fi = await selectFinishes("가을 카페 브랜딩", ROLES);
const rw = await rewrite("가을 카페 브랜딩");
say({ state: s.state, detail: s.detail, errors: [st.error ?? null, fi.error ?? null, rw.error ?? null] });
`;
    const gone = await runChild(probeCode, { OLLAMA_HOST: dead });
    if (gone.state !== "unavailable") bad.push(`죽은 호스트를 탐지한 뒤 상태가 ${gone.state} (unavailable 이어야)`);
    if (typeof gone.detail !== "string" || gone.detail.includes(LIE)) bad.push(`탐지한 뒤 사유가 "${gone.detail}" — 확인했는데 안 했다고 말한다`);
    if (!String(gone.detail).includes(dead)) bad.push(`사유에 호스트(${dead})가 없다: "${gone.detail}"`);
    gone.errors.forEach((e, i) => {
      const who = ["selectStructures", "selectFinishes", "rewrite"][i];
      if (typeof e !== "string") bad.push(`${who} 가 죽은 호스트에서 사유를 안 준다`);
      else if (e.includes(LIE)) bad.push(`${who} 사유가 거짓말한다: "${e}"`);
    });

    // 양성 대조 — 떠 있으면 ready 이고, 그 사유도 처음 문구가 아니다.
    const stub = await stubOllama();
    try {
      const alive = await runChild(`${IMPORTS}
const s = await refresh();
say({ state: s.state, detail: s.detail });
`, { OLLAMA_HOST: stub.host });
      if (alive.state !== "ready") bad.push(`떠 있는데 ${alive.state} — 이 게이트가 헛돌고 있다`);
      if (typeof alive.detail !== "string" || alive.detail.includes(LIE) || !alive.detail.includes(stub.host)) {
        bad.push(`ready 인데 사유가 "${alive.detail}" — 성공도 사유에 적어야 한다`);
      }
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`죽은 호스트: ${gone.state} — "${gone.detail}" · 호출부 셋의 사유에 "${LIE}" 없음 · 떠 있으면 ready`);
    out("S25_G1_OK");
  },

  /*
   * 기동 실패의 사유("찾을 수 없다")는 재탐지 실패("응답하지 않는다")보다 구체적이다.
   * TTL 이 지나 다시 탐지해 실패해도 **더 구체적인 쪽이 남아야** 한다.
   */
  "S25-G2": async () => {
    const bad = [];
    const dead = await deadHost();
    const got = await runChild(`${IMPORTS}
const first = await ensureRunning();
await new Promise((r) => setTimeout(r, ${AFTER_TTL_MS}));
const second = await refresh();
say({ s1: first.state, d1: first.detail, s2: second.state, d2: second.detail });
`, { OLLAMA_HOST: dead, OLLAMA_BIN: "tonefirst-no-such-binary-25", OLLAMA_READY_TIMEOUT_MS: "3000" }, { timeoutMs: 20000 });

    if (got.s1 !== "unavailable") bad.push(`없는 실행 파일로 기동했는데 ${got.s1}`);
    if (!String(got.d1).includes("찾을 수 없다")) bad.push(`기동 실패 사유가 구체적이지 않다: "${got.d1}"`);
    if (got.s2 !== "unavailable") bad.push(`재탐지 뒤 상태가 ${got.s2}`);
    if (got.d2 !== got.d1) bad.push(`재탐지가 사유를 덮어썼다: "${got.d1}" → "${got.d2}"`);

    if (bad.length) throw new Error(bad.join(" / "));
    out(`기동 실패 "${got.d1}" 가 ${AFTER_TTL_MS}ms 뒤 재탐지에도 남는다`);
    out("S25_G2_OK");
  },

  /*
   * 폭 0 문자만 있는 질의는 빈 질의다. 세 경로 어디서도 모델에 닿으면 안 된다.
   *
   * **양성 대조가 필수다.** "안 부른다" 는 아예 못 부르는 구현도 통과시킨다. 그리고 폭 0 문자가
   * **섞인** 진짜 질의는 거부가 아니라 그 문자만 빠진 채 가야 한다 — 지우는 것이지 막는 것이 아니다.
   */
  "S25-G3": async () => {
    const bad = [];
    const stub = await stubOllama();
    try {
      // 1·2. 구조 선택 · 재질 배정 — 직접 호출.
      const blanks = await runChild(`${IMPORTS}
const froms = [];
for (const q of ${JSON.stringify(INVISIBLE)}) {
  const st = await selectStructures(q, CATALOG);
  const fi = await selectFinishes(q, ROLES);
  froms.push([st.from, fi.from]);
}
say({ froms });
`, { OLLAMA_HOST: stub.host });
      blanks.froms.forEach(([st, fi], i) => {
        if (st !== "fallback") bad.push(`구조 선택: 보이지 않는 질의 ${i} 에 from=${st}`);
        if (fi !== "fallback") bad.push(`재질 배정: 보이지 않는 질의 ${i} 에 from=${fi}`);
      });
      if (stub.calls() !== 0) bad.push(`보이지 않는 질의 ${INVISIBLE.length}가지 × 2경로에 모델을 ${stub.calls()}회 불렀다`);

      // 양성 대조 — 폭 0 문자가 섞인 진짜 질의는 부른다.
      stub.reset();
      await runChild(`${IMPORTS}
await selectStructures("가을\\u200B 카페 브랜딩", CATALOG);
await selectFinishes("네온\\u2060 사인의 사이버펑크", ROLES);
say({});
`, { OLLAMA_HOST: stub.host });
      if (stub.calls() !== 2) bad.push(`진짜 질의 2건에 모델 호출 ${stub.calls()}회 (2회여야) — 지우는 것이지 막는 것이 아니다`);

      // 3. /api/search — 서버가 400 으로 거르고 재작성이 모델에 닿지 않는다.
      stub.reset();
      await withServer(4325, { OLLAMA_HOST: stub.host }, async (get) => {
        for (const q of INVISIBLE) {
          const res = await get(`/api/search?q=${encodeURIComponent(q)}`);
          if (res.status !== 400) bad.push(`/api/search 가 보이지 않는 질의 ${JSON.stringify(q)} 에 ${res.status} (400 이어야)`);
          await res.text();
        }
        if (stub.calls() !== 0) bad.push(`/api/search 가 보이지 않는 질의에 모델을 ${stub.calls()}회 불렀다`);

        // 양성 대조 — 코퍼스에 없는 말은 저신뢰라 재작성이 모델을 부른다.
        const low = await get(`/api/search?q=${encodeURIComponent("qwxz")}`);
        if (low.status !== 200) bad.push(`저신뢰 질의에 ${low.status}`);
        await low.text();
        if (stub.calls() === 0) bad.push("저신뢰 질의에도 모델을 안 부른다 — 이 게이트가 헛돌고 있다");

        // 섞인 진짜 질의는 그 문자만 빠진 채 간다.
        const mixed = await get(`/api/search?q=${encodeURIComponent("가을\u200B 카페")}`);
        if (mixed.status !== 200) bad.push(`섞인 질의에 ${mixed.status}`);
        const body = await mixed.json();
        if (body.query !== "가을 카페") bad.push(`섞인 질의가 ${JSON.stringify(body.query)} 로 갔다 ("가을 카페" 여야)`);
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`보이지 않는 질의 ${INVISIBLE.length}가지 × 3경로에 모델 호출 0회 · 진짜 질의는 호출됨 · 섞인 문자는 빠진다`);
    out("S25_G3_OK");
  },

  /*
   * 우리가 띄운 Ollama 의 사유 "자동 기동함" 은 재확인의 "응답" 보다 구체적이다. TTL 이 지나
   * 다시 확인해 성공해도 **그 사유가 남아야** 한다. 처음 구현이 이것을 매번 덮어썼고 리뷰가 잡았다 —
   * 상태값은 안 바뀌어 다른 게이트는 전부 조용했다.
   *
   * **실제 Ollama 를 띄운다.** S3-G2 와 같은 전제 — 이 기계에 `ollama` 가 있어야 성립하고,
   * 없으면 통과가 아니라 실패다. 포트는 S3-G2(11498)와 겹치지 않게 11499 를 쓴다.
   * 자식이 `process.exit` 로 끝나야 exit 훅이 띄운 프로세스를 정리하므로 `selfExit` 로 돌린다.
   */
  "S25-G5": async () => {
    const bad = [];
    const host = "127.0.0.1:11499";
    const got = await runChild(`${IMPORTS}
const first = await ensureRunning();
await new Promise((r) => setTimeout(r, ${AFTER_TTL_MS}));
const second = await refresh();
say({ s1: first.state, d1: first.detail, by: first.startedByUs, s2: second.state, d2: second.detail });
process.exit(0);
`, { OLLAMA_HOST: host }, { timeoutMs: 45000, selfExit: true });

    if (got.s1 !== "ready") throw new Error(`이 기계에서 Ollama 를 띄우지 못했다 — ${got.s1}: ${got.d1}. S3-G2 와 같은 전제(ollama 설치)가 필요하다`);
    if (!got.by || !String(got.d1).includes("자동 기동함")) bad.push(`우리가 띄웠는데 사유가 "${got.d1}" (startedByUs=${got.by})`);
    if (got.s2 !== "ready") bad.push(`재확인 뒤 상태가 ${got.s2}`);
    if (got.d2 !== got.d1) bad.push(`재확인이 ready 사유를 덮어썼다: "${got.d1}" → "${got.d2}"`);

    if (bad.length) throw new Error(bad.join(" / "));
    out(`"${got.d1}" 가 ${AFTER_TTL_MS}ms 뒤 재확인에도 남는다`);
    out("S25_G5_OK");
  },

  /*
   * `refresh()` 를 건드렸다. 3단계가 그 함수로 지키는 것(없어도 서비스 · 요청이 기동을 안 함 ·
   * 죽으면 따라감 …)이 그대로인지 3단계 검사기 자체를 돌려 본다.
   */
  "S25-G4": async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `S3-G${i + 1}`);
    const results = [];
    for (const id of ids) results.push(await runStage3(id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`3단계 게이트 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out(`3단계 게이트 ${ids.length}개 전부 통과`);
    out("S25_G4_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage25.mjs <${Object.keys(GATES).join("|")}>`);
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
