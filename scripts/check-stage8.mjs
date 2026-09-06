#!/usr/bin/env node
// 8단계(저장 메모) 완료 조건 검사기.
//   node scripts/check-stage8.mjs S8-G1

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { LIMITS } from "../src/store.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-check-"));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

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
const getText = async (base, path) => (await fetch(base + path)).text();

// 팔레트 id 를 코퍼스 파일에서 직접 읽는다.
// 검색 질의로 얻으면 라우팅(팔레트/진단)이 바뀔 때 검사가 엉뚱한 이유로 죽는다 — 실제로 한 번 그랬다.
// id 를 상수로 박는 것도 코퍼스가 바뀌면 조용히 무의미해지므로, 파일에서 첫 항목을 읽는다.
function firstPaletteId() {
  const { palettes } = JSON.parse(read("data/palettes.json"));
  const id = palettes?.[0]?.id;
  if (!id) throw new Error("data/palettes.json 에서 팔레트 id 를 못 읽었다 — 검사 전제가 깨졌다");
  return id;
}

// 서버를 띄우고 정리까지 책임진다. 데이터 디렉터리는 검사마다 새로 만든다.
// 죽인 자식이 실제로 끝난 뒤에 돌아온다 — 기다리지 않고 process.exit 로 가면 Windows 에서
// libuv 가 abort 하고(UV_HANDLE_CLOSING) 종료 코드가 1 이 아니라 127 이 된다. 실패는 실패대로
// 잡히지만 "게이트가 잡은 결함" 과 "검사기가 죽음" 이 구분되지 않아 신호가 흐려진다.
async function withServer(port, fn) {
  const dir = freshDataDir();
  const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn(base);
  } finally {
    const ended = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await ended;
    rmSync(dir, { recursive: true, force: true });
  }
}

// 서버가 실제로 쓰는 값을 그대로 가져온다. 여기에 200 을 박으면 서버가 바뀌어도 검사가
// 옛 값을 계속 옳다고 말한다 — 공급된 숫자를 기대값으로 베끼지 않는다.
const NOTE_LIMIT = LIMITS.noteChars;
const findEntry = async (base, paletteId) =>
  (await getJson(base, "/api/saved")).saved.find((s) => s.paletteId === paletteId);

const gates = {
  // 메모가 저장되고 목록에 실린다. 상한을 넘으면 잘린다.
  async "S8-G1"() {
    return withServer(4810, async (base) => {
      const bad = [];
      const id = firstPaletteId();

      const memo = "브랜드 1차 시안. 헤더 배경으로 검토";
      const res = await post(base, "/api/saved", { paletteId: id, note: memo });
      if (res.status !== 200) bad.push(`저장이 ${res.status} 로 실패했다`);

      const entry = await findEntry(base, id);
      if (!entry) bad.push("저장한 조합을 목록에서 못 찾았다");
      else if (entry.note !== memo) bad.push(`메모가 안 실렸다: ${JSON.stringify(entry.note)}`);

      // 상한 초과는 잘린다. 한 글자씩 세는 방식이라 코드포인트로 확인한다.
      const long = "가".repeat(NOTE_LIMIT + 50);
      await post(base, "/api/saved", { paletteId: id, note: long });
      const after = await findEntry(base, id);
      const len = [...(after?.note ?? "")].length;
      if (len !== NOTE_LIMIT) bad.push(`상한 초과가 안 잘렸다: ${len}자 (기대 ${NOTE_LIMIT})`);

      if (bad.length) throw new Error(bad.join(" / "));
      out("S8_G1_OK");
    });
  },

  // 메모를 안 보내고 재저장하면 이전 메모가 남는다. 비율 이어받기와 같은 규칙이다.
  async "S8-G2"() {
    return withServer(4811, async (base) => {
      const bad = [];
      const id = firstPaletteId();
      const memo = "재저장해도 남아야 한다";

      await post(base, "/api/saved", { paletteId: id, note: memo });
      // 비율만 바꿔 재저장한다 — 화면에서 슬라이더를 만지고 다시 누르는 흐름이다.
      const res = await post(base, "/api/saved", { paletteId: id, ratio: 60 });
      if (res.status !== 200) bad.push(`재저장이 ${res.status} 로 실패했다`);

      const entry = await findEntry(base, id);
      if (!entry) bad.push("재저장 뒤 조합을 못 찾았다");
      else {
        if (entry.note !== memo) bad.push(`메모가 사라졌다: ${JSON.stringify(entry.note)}`);
        if (entry.colors[0].ratio !== 60) bad.push(`비율이 안 바뀌었다: ${entry.colors[0].ratio}`);
      }

      if (bad.length) throw new Error(bad.join(" / "));
      out("S8_G2_OK");
    });
  },

  // 빈 메모를 명시적으로 보내면 지운다. S8-G2 가 "무조건 이어받기" 로 통과하는 것을 막는 음성 대조다.
  async "S8-G3"() {
    return withServer(4812, async (base) => {
      const bad = [];
      const id = firstPaletteId();

      await post(base, "/api/saved", { paletteId: id, note: "지워질 메모" });
      const res = await post(base, "/api/saved", { paletteId: id, note: "" });
      if (res.status !== 200) bad.push(`빈 메모 저장이 ${res.status} 로 실패했다`);

      const entry = await findEntry(base, id);
      if (!entry) bad.push("조합을 못 찾았다");
      else if (entry.note) bad.push(`빈 메모를 보냈는데 안 지워졌다: ${JSON.stringify(entry.note)}`);

      // 공백만 보낸 것도 지운 것으로 친다 — clip 이 trim 하므로 빈 문자열과 같아야 한다.
      await post(base, "/api/saved", { paletteId: id, note: "다시 쓴 메모" });
      await post(base, "/api/saved", { paletteId: id, note: "   " });
      const blank = await findEntry(base, id);
      if (blank?.note) bad.push(`공백 메모가 안 지워졌다: ${JSON.stringify(blank.note)}`);

      if (bad.length) throw new Error(bad.join(" / "));
      out("S8_G3_OK");
    });
  },

  // 홈 화면이 메모 입력을 만들고 저장 요청에 실어 보낸다.
  // 정적 검사다 — 회귀 스모크지 동작 증명이 아니다. GATES.md 의 알려진 한계를 함께 본다.
  async "S8-G4"() {
    const bad = [];
    const app = read("public/app.js");

    if (!/\bnote\b/.test(app)) bad.push("app.js 에 note 가 아예 없다");
    if (!/el\(\s*["'](?:textarea|input)["']/.test(app)) {
      bad.push("메모를 받을 input/textarea 를 만드는 곳이 없다");
    }

    // 저장 요청 본문에 note 를 싣는다.
    // **주석을 먼저 걷어낸다.** "구간 안에 note 라는 낱말이 있는가" 만 보면, 전송 코드를 지우고
    // 그 자리에 note 가 든 주석만 남겨도 통과한다. 이 게이트가 막으려는 바로 그 회귀다.
    const stripped = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const call = stripped.match(/api\(\s*["']\/api\/saved["'][\s\S]{0,400}?\n\s*\}\);/);
    if (!call) bad.push("/api/saved 호출 본문을 못 찾았다");
    // 낱말이 아니라 **객체에 실리는 형태**를 본다 — `note` 키이거나 `note` 를 펼치는 스프레드.
    else if (!/\bnote\b\s*[,:}]|\.\.\.\([^)]*\bnote\b/.test(call[0])) {
      bad.push("저장 요청 본문에 note 가 실리지 않는다");
    }

    // 상한을 화면에서도 건다 — 서버가 조용히 자르면 사용자는 잘린 줄 모른다.
    // 값이 서버와 어긋나는 것이 더 나쁘므로 숫자를 실제로 대조한다. 정규식으로 "있다" 만 보면
    // 클라이언트가 400, 서버가 200 이어도 통과한다.
    if (!/maxLength/.test(app)) {
      bad.push("입력에 길이 상한(maxLength)이 없다");
    } else {
      const declared = app.match(/NOTE_MAX\s*=\s*(\d+)/);
      if (!declared) bad.push("app.js 에서 NOTE_MAX 상수를 못 찾았다");
      else if (Number(declared[1]) !== NOTE_LIMIT) {
        bad.push(`화면 상한 ${declared[1]} 이 서버 상한 ${NOTE_LIMIT} 과 다르다`);
      }
      if (!/maxLength\s*=\s*NOTE_MAX/.test(app)) bad.push("maxLength 가 NOTE_MAX 를 안 쓴다");
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S8_G4_OK");
  },

  // 실제 저장 경로로 넣은 메모가 두 내보내기 형식에 모두 실린다.
  async "S8-G5"() {
    return withServer(4813, async (base) => {
      const bad = [];
      const id = firstPaletteId();
      const memo = "발표용 시안";

      await post(base, "/api/saved", { paletteId: id, note: memo });

      const css = await getText(base, "/api/export?format=css");
      if (!css.includes(memo)) bad.push("CSS 내보내기에 메모가 없다");

      const json = await getText(base, "/api/export?format=json");
      if (!JSON.stringify(JSON.parse(json)).includes(memo)) bad.push("JSON 내보내기에 메모가 없다");

      if (bad.length) throw new Error(bad.join(" / "));
      out("S8_G5_OK");
    });
  },

  // 저장이 겹쳐도 메모가 소실되지 않는다.
  // savePalette 를 직접 부른다 — HTTP 를 거치면 두 요청이 정말 겹치는지 검사기가 통제하지 못한다.
  async "S8-G6"() {
    const dir = freshDataDir();
    process.env.TONEFIRST_DATA_DIR = dir + "/";
    try {
      const bad = [];
      // 매번 새 데이터 디렉터리를 보게 하려고 쿼리스트링으로 모듈 캐시를 피한다.
      const { savePalette, listSaved } = await import(
        new URL("../src/store.js", import.meta.url).href + `?g6=${Date.now()}`
      );
      const { palettes } = JSON.parse(read("data/palettes.json"));
      const p = palettes[0];
      const lookup = (id) => (id === p.id ? p : null);
      const ratioFor = () => [50, 50];

      await savePalette({ paletteId: p.id, note: "먼저 적은 메모" }, lookup, ratioFor);

      // 하나는 새 메모를, 하나는 메모 없이 비율만 — 겹쳐 보낸다.
      await Promise.all([
        savePalette({ paletteId: p.id, note: "나중에 적은 메모" }, lookup, ratioFor),
        savePalette({ paletteId: p.id, ratio: 60 }, lookup, ratioFor),
      ]);

      const entry = listSaved().find((s) => s.paletteId === p.id);
      if (!entry) bad.push("조합을 못 찾았다");
      else if (entry.note !== "나중에 적은 메모") {
        bad.push(`겹친 저장에서 메모가 소실됐다: ${JSON.stringify(entry.note)}`);
      }

      if (bad.length) throw new Error(bad.join(" / "));
      out("S8_G6_OK");
    } finally {
      delete process.env.TONEFIRST_DATA_DIR;
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 저장 중에는 어떤 경로로도 버튼이 다시 열리지 않는다.
  // 정적 검사다 — 버튼을 여는 자리가 둘(memo 의 input, onRatio)인데 한쪽만 막혀 있던 것을 잡는다.
  async "S8-G7"() {
    const bad = [];
    const app = read("public/app.js");

    if (!/\bpending\b/.test(app)) bad.push("app.js 에 pending 상태가 없다");

    // button.disabled = false 로 버튼을 여는 자리를 전부 찾아, 각 자리 앞에 pending 가드가 있는지 본다.
    const opens = [...app.matchAll(/button\.disabled\s*=\s*false/g)];
    if (opens.length === 0) bad.push("버튼을 여는 자리를 못 찾았다");

    for (const m of opens) {
      const before = app.slice(Math.max(0, m.index - 300), m.index);
      // 실패 경로(catch)에서 여는 것은 정상이다 — 그때는 이미 pending 이 끝났다.
      const inCatch = /catch\s*\([\s\S]{0,40}$/.test(before) || /err\.message[\s\S]{0,120}$/.test(before);
      if (inCatch) continue;
      if (!/\bpending\b/.test(before)) {
        const line = app.slice(0, m.index).split("\n").length;
        bad.push(`${line}번째 줄에서 pending 확인 없이 버튼을 연다`);
      }
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S8_G7_OK");
  },
};

const wanted = process.argv[2];
const gate = Object.hasOwn(gates, wanted ?? "") ? gates[wanted] : null;
if (!gate) {
  out(`알 수 없는 게이트: ${wanted}. 가능한 값 — ${Object.keys(gates).join(", ")}`);
  process.exit(1);
}
gate().catch((err) => {
  out(`${wanted} 실패 — ${err.message}`);
  // process.exit 를 쓰지 않는다. 자식 stdio 파이프가 닫히는 중에 프로세스를 끊으면 Windows 에서
  // libuv 가 abort 해(UV_HANDLE_CLOSING) 종료 코드가 1 이 아니라 127 이 된다 — 실측.
  // exitCode 만 세우고 이벤트 루프가 비면 자연히 끝나게 둔다.
  process.exitCode = 1;
});
