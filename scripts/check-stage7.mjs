#!/usr/bin/env node
// 7단계(대화 이어하기) 완료 조건 검사기.
//   node scripts/check-stage7.mjs S7-G1

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-check-"));

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

const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
const getJson = async (base, path) => (await fetch(base + path)).json();

const turn = (query, extra = {}) => ({ query, stage: 1, route: "palette", confident: true, ...extra });

const gates = {
  // id 로 대화 하나만 가져올 수 있다. 없는 id 는 404 로 분명히 알린다.
  async "S7-G1"() {
    const dir = freshDataDir();
    const port = 4710;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      const first = await (await post(base, "/api/conversations/turn", turn("병원 앱인데 차갑지 않게"))).json();
      await post(base, "/api/conversations/turn", turn("느와르 포스터")); // 다른 대화

      const one = await fetch(`${base}/api/conversations?id=${encodeURIComponent(first.conversationId)}`);
      if (one.status !== 200) bad.push(`id 조회가 ${one.status}`);
      const body = await one.json();
      if (body.conversation?.id !== first.conversationId) bad.push("다른 대화가 왔다");
      if (body.conversations) bad.push("id 를 줬는데 전체 목록도 함께 왔다");

      // 없는 id 는 404 여야 한다. 빈 결과로 돌려주면 화면이 '이어 쓰는 중' 이라고 거짓말한다.
      const missing = await fetch(`${base}/api/conversations?id=conv-none-none`);
      if (missing.status !== 404) bad.push(`없는 id 가 ${missing.status}`);
      const missingBody = await missing.text();
      if (/[A-Za-z]:\\|node:internal/.test(missingBody)) bad.push("내부 경로가 샜다");

      // 양성 대조 — id 없이 부르면 전체 목록이 온다.
      const all = await getJson(base, "/api/conversations");
      if (all.conversations?.length !== 2) bad.push(`전체 목록이 ${all.conversations?.length}개`);
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 이어 쓴 턴이 같은 대화에 붙는다. 새 대화를 만들지 않는다.
  async "S7-G2"() {
    const dir = freshDataDir();
    const port = 4711;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      const first = await (await post(base, "/api/conversations/turn", turn("첫 질문"))).json();
      const id = first.conversationId;

      for (const q of ["이어서 둘", "이어서 셋"]) {
        const res = await (await post(base, "/api/conversations/turn", turn(q, { conversationId: id }))).json();
        if (res.conversationId !== id) bad.push(`"${q}" 가 새 대화(${res.conversationId})로 갔다`);
      }

      const { conversations } = await getJson(base, "/api/conversations");
      if (conversations.length !== 1) bad.push(`대화가 ${conversations.length}개로 늘었다`);
      const queries = conversations[0].turns.map((t) => t.query);
      if (queries.join("|") !== "첫 질문|이어서 둘|이어서 셋") bad.push(`턴 순서가 ${queries.join("|")}`);

      // 없는 id 로 보내면 새 대화가 열린다(저장소 동작). 화면은 그 전에 404 로 걸러야 한다 — S7-G1·G4.
      const orphan = await (await post(base, "/api/conversations/turn", turn("고아", { conversationId: "conv-none-none" }))).json();
      if (orphan.conversationId === "conv-none-none") bad.push("없는 id 를 그대로 썼다");
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 내역 화면이 이어서·다시 묻기 링크를 만든다.
  async "S7-G3"() {
    const history = readFileSync(new URL("../public/history.js", import.meta.url), "utf8");
    const bad = [];
    if (!/이어서 묻기/.test(history)) bad.push("‘이어서 묻기’ 가 없다");
    if (!/다시 묻기/.test(history)) bad.push("‘다시 묻기’ 가 없다");
    if (!/\/\?conv=\$\{encodeURIComponent\(conversation\.id\)\}/.test(history)) {
      bad.push("이어서 묻기 링크가 대화 id 를 인코딩해 싣지 않는다");
    }
    if (!/q=\$\{encodeURIComponent\(turn\.query\)\}/.test(history)) {
      bad.push("다시 묻기 링크가 질의를 인코딩해 싣지 않는다");
    }
    // 앵커가 있어야 홈의 '내역에서 보기' 가 그 대화로 간다.
    if (!/block\.id = conversation\.id/.test(history)) bad.push("대화 블록에 앵커 id 가 없다");
    return bad.length ? bad.join(" / ") : null;
  },

  // 홈 화면이 ?conv= 를 확인하고, 못 이어 쓰면 그렇다고 말한다.
  async "S7-G4"() {
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const bad = [];

    if (!/URLSearchParams\(location\.search\)/.test(app)) bad.push("URL 파라미터를 읽지 않는다");
    if (!/\/api\/conversations\?id=/.test(app)) bad.push("대화가 실재하는지 확인하지 않는다");
    // 실패를 조용히 넘기면 '이어 쓰는 중' 이라고 표시한 채 새 대화가 열린다.
    if (!/catch[\s\S]{0,200}이어 쓸 수 없습니다/.test(app)) bad.push("이어 쓸 수 없을 때 알리지 않는다");
    if (!/thread-new/.test(app)) bad.push("새 대화로 빠져나올 방법이 없다");
    // 기록 실패를 삼키면 안 된다.
    // 정확한 옛 형태만 찾으면 `.catch(() => undefined)` 로 바꿔도 통과한다.
    // catch 본문이 화면에 무언가를 쓰는지를 본다.
    const recordCatch = app.match(/recordTurn\([^)]*\)\s*\.catch\(([\s\S]{0,300}?)\);/);
    if (!recordCatch) bad.push("recordTurn 의 실패 처리를 찾지 못했다");
    else if (!/textContent/.test(recordCatch[1])) bad.push("기록 실패를 화면에 알리지 않는다");

    // 대화 확인이 끝나기 전에 기록하면 그 턴이 엉뚱한 대화로 간다. run 이 그것을 기다려야 한다.
    if (!/async function run\([\s\S]{0,400}?await ready;/.test(app)) {
      bad.push("run 이 대화 확인(ready)을 기다리지 않는다 — 경합이 생긴다");
    }
    if (!/const ready = \(async \(\) =>/.test(app)) bad.push("ready 프로미스가 없다");

    for (const id of ["thread", "thread-title", "thread-meta", "thread-open", "thread-new"]) {
      if (!html.includes(`id="${id}"`)) bad.push(`화면에 ${id} 가 없다`);
    }
    return bad.length ? bad.join(" / ") : null;
  },
};

const id = process.argv[2];
if (!gates[id]) {
  out(`알 수 없는 게이트: ${id}. 가능한 값 — ${Object.keys(gates).join(", ")}`);
  process.exit(2);
}

try {
  const failure = await gates[id]();
  if (failure) {
    out(`${id}_FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    out(`${id.replace(/-/g, "_")}_OK`);
  }
} catch (err) {
  out(`${id}_FAIL ${err.message}`);
  process.exitCode = 1;
}
