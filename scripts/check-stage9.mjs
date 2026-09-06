#!/usr/bin/env node
// 9단계(저장 화면 메모 편집) 완료 조건 검사기.
//   node scripts/check-stage9.mjs S9-G1

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

// 같은 화면에서 보낸 요청. 출처 헤더를 뺀 판은 S9-G5 가 따로 만든다.
const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
const getJson = async (base, path) => (await fetch(base + path)).json();

function firstPaletteId() {
  const { palettes } = JSON.parse(read("data/palettes.json"));
  const id = palettes?.[0]?.id;
  if (!id) throw new Error("data/palettes.json 에서 팔레트 id 를 못 읽었다 — 검사 전제가 깨졌다");
  return id;
}

// 자식이 실제로 끝난 뒤 돌아온다. process.exit 로 끊으면 Windows 에서 libuv 가 abort 한다.
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

// 메모가 달린 저장 항목 하나를 심고 그것을 돌려준다.
async function seedOne(base, note = "처음 적은 메모") {
  const paletteId = firstPaletteId();
  await post(base, "/api/saved", { paletteId, note });
  const { saved } = await getJson(base, "/api/saved");
  const entry = saved.find((s) => s.paletteId === paletteId);
  if (!entry) throw new Error("심어 둔 항목을 못 찾았다 — 검사 전제가 깨졌다");
  return entry;
}

const noteOf = async (base, id) =>
  (await getJson(base, "/api/saved")).saved.find((s) => s.id === id)?.note;

const gates = {
  // 메모를 바꾸고 지울 수 있다.
  async "S9-G1"() {
    return withServer(4910, async (base) => {
      const bad = [];
      const entry = await seedOne(base);

      const res = await post(base, "/api/saved/note", { id: entry.id, note: "고쳐 적은 메모" });
      if (res.status !== 200) bad.push(`편집이 ${res.status} 로 실패했다`);
      if ((await noteOf(base, entry.id)) !== "고쳐 적은 메모") {
        bad.push(`메모가 안 바뀌었다: ${JSON.stringify(await noteOf(base, entry.id))}`);
      }

      // 빈 값은 지우기다.
      await post(base, "/api/saved/note", { id: entry.id, note: "" });
      if (await noteOf(base, entry.id)) bad.push("빈 값을 보냈는데 안 지워졌다");

      // 공백만 보낸 것도 지운 것으로 친다 — clip 이 trim 하므로 빈 값과 같아야 한다.
      await post(base, "/api/saved/note", { id: entry.id, note: "다시 적음" });
      await post(base, "/api/saved/note", { id: entry.id, note: "   " });
      if (await noteOf(base, entry.id)) bad.push("공백만 보냈는데 안 지워졌다");

      if (bad.length) throw new Error(bad.join(" / "));
      out("S9_G1_OK");
    });
  },

  // 잘못된 입력을 거른다.
  async "S9-G2"() {
    return withServer(4911, async (base) => {
      const bad = [];
      const entry = await seedOne(base);

      // 형식이 깨진 id 와 형식은 맞지만 없는 id 를 나눠 본다 — 한 덩어리로 보면
      // 검증이 어디서 걸렸는지 모른 채 통과할 수 있다.
      for (const [label, id] of [
        ["빈 id", ""],
        ["형식이 깨진 id", "../../etc/passwd"],
        ["형식은 맞지만 없는 id", "save-zzzzzz-000000"],
      ]) {
        const res = await post(base, "/api/saved/note", { id, note: "아무거나" });
        if (res.status === 200) bad.push(`${label} 가 200 으로 통과했다`);
        const body = await res.text();
        if (/[A-Za-z]:\\|node:internal/.test(body)) bad.push(`${label}: 내부 경로가 샜다`);
      }

      // 상한을 넘는 메모는 잘라 낸다. 거부가 아니라 절단이 저장 경로와 같은 규칙이다.
      const long = "가".repeat(LIMITS.noteChars + 50);
      const res = await post(base, "/api/saved/note", { id: entry.id, note: long });
      if (res.status !== 200) bad.push(`상한 초과가 ${res.status} 로 거부됐다 (잘라 내야 한다)`);
      const len = [...((await noteOf(base, entry.id)) ?? "")].length;
      if (len !== LIMITS.noteChars) bad.push(`상한 초과가 안 잘렸다: ${len}자 (기대 ${LIMITS.noteChars})`);

      if (bad.length) throw new Error(bad.join(" / "));
      out("S9_G2_OK");
    });
  },

  // 메모 편집이 다른 필드를 건드리지 않는다.
  async "S9-G3"() {
    return withServer(4912, async (base) => {
      const bad = [];
      const entry = await seedOne(base);

      // 비율을 먼저 손대 둔다 — 기본값과 다른 상태여야 덮어쓰기를 관찰할 수 있다.
      await post(base, "/api/saved/ratio", { id: entry.id, ratio: 70 });
      const before = (await getJson(base, "/api/saved")).saved.find((s) => s.id === entry.id);

      await post(base, "/api/saved/note", { id: entry.id, note: "메모만 바꾼다" });
      const after = (await getJson(base, "/api/saved")).saved.find((s) => s.id === entry.id);

      if (after.note !== "메모만 바꾼다") bad.push("메모가 안 바뀌었다");
      for (const key of ["id", "savedAt", "paletteId", "name", "type", "ratioAdjusted", "fromQuery"]) {
        if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) {
          bad.push(`${key} 가 바뀌었다: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
        }
      }
      if (JSON.stringify(after.colors) !== JSON.stringify(before.colors)) {
        bad.push(`색·비율이 바뀌었다: ${JSON.stringify(after.colors.map((c) => c.ratio))}`);
      }
      if (JSON.stringify(after.defaultRatio) !== JSON.stringify(before.defaultRatio)) {
        bad.push("defaultRatio 가 바뀌었다");
      }

      if (bad.length) throw new Error(bad.join(" / "));
      out("S9_G3_OK");
    });
  },

  // 저장 화면이 메모 입력과 저장 경로를 만든다. 정적 검사다 — 회귀 스모크지 동작 증명이 아니다.
  async "S9-G4"() {
    const bad = [];
    // 주석을 걷어낸다. 주석에 낱말만 남겨도 통과하는 것을 막는다.
    const saved = read("public/saved.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    if (!/el\(\s*["'](?:textarea|input)["']/.test(saved)) {
      bad.push("메모를 받을 input/textarea 를 만드는 곳이 없다");
    }
    if (!/["']\/api\/saved\/note["']/.test(saved)) bad.push("/api/saved/note 를 부르는 곳이 없다");
    if (!/\bnote\b\s*[,:}]/.test(saved)) bad.push("요청 본문에 note 가 실리지 않는다");

    // 화면 상한이 서버와 어긋나면 사용자는 다 썼다고 보는데 서버가 조용히 자른다.
    const declared = saved.match(/NOTE_MAX\s*=\s*(\d+)/);
    if (!declared) bad.push("saved.js 에서 NOTE_MAX 상수를 못 찾았다");
    else if (Number(declared[1]) !== LIMITS.noteChars) {
      bad.push(`화면 상한 ${declared[1]} 이 서버 상한 ${LIMITS.noteChars} 과 다르다`);
    }
    if (!/maxLength\s*=\s*NOTE_MAX/.test(saved)) bad.push("maxLength 가 NOTE_MAX 를 안 쓴다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("S9_G4_OK");
  },

  // 요청이 준 id 가 조회 비교 밖으로 새지 않는다.
  //
  // 이 저장소의 id 검증(ID_SHAPE)은 **방어 심층화이지 유일 방어가 아니다** — 빼도 없는 항목으로
  // 거부되므로 관측 가능한 동작이 같다(리뷰에서 실측으로 확인했다). 그래서 검증을 없애는 회귀는
  // 어떤 게이트도 못 잡는다. 진짜로 지켜야 하는 것은 그 아래 불변식이다 — **id 가 파일 경로 조립·
  // 동적 프로퍼티 접근·직렬화 어디로도 안 간다.** 그것이 깨지면 검증이 유일 방어가 되고, 그때는
  // 검증을 빼는 것이 곧 취약점이 된다. 지금 못 박아 둔다.
  async "S9-G6"() {
    const bad = [];
    const store = read("src/store.js");

    // updateSavedNote · updateSavedRatio · deleteSaved 세 함수 본문만 떼어 본다.
    for (const name of ["updateSavedNote", "updateSavedRatio", "deleteSaved"]) {
      const start = store.indexOf(`export function ${name}(`);
      if (start < 0) {
        bad.push(`${name} 을 못 찾았다 — 검사 전제가 깨졌다`);
        continue;
      }
      const end = store.indexOf("\nexport function ", start + 1);
      const bodyText = store.slice(start, end < 0 ? undefined : end);

      // wanted 를 쓰는 줄을 전부 모아, 조회 비교 말고 다른 데 쓰는 것이 있는지 본다.
      const uses = bodyText
        .split("\n")
        .filter((l) => /\bwanted\b/.test(l) && !/^\s*(\/\/|\*)/.test(l));

      for (const line of uses) {
        const ok =
          /const wanted = clip\(/.test(line) || // 만드는 줄
          /ID_SHAPE\.test\(wanted\)/.test(line) || // 형식 검사
          /\.id\s*[=!]==\s*wanted\b/.test(line) || // 조회 비교 (찾기는 ===, 걸러내기는 !==)
          /return \{ deleted: wanted \}/.test(line); // 지운 id 를 그대로 돌려주는 것
        if (!ok) bad.push(`${name}: wanted 를 예상 밖으로 쓴다 — ${line.trim()}`);
      }

      // 경로 조립·동적 접근이 이 함수 안에 있으면 안 된다.
      if (/join\(|resolve\(|readFileSync|writeFileSync/.test(bodyText)) {
        bad.push(`${name}: 함수 안에서 직접 파일 경로를 다룬다`);
      }
      if (/\[\s*wanted\s*\]/.test(bodyText)) bad.push(`${name}: wanted 로 동적 프로퍼티에 접근한다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S9_G6_OK");
  },

  // 새 쓰기 경로가 출처 검사를 물려받는다. 쓰기 경로를 늘릴 때 조용히 빠지는 자리다.
  async "S9-G5"() {
    return withServer(4913, async (base) => {
      const bad = [];
      const entry = await seedOne(base, "건드리면 안 되는 메모");

      // 출처 헤더 없이 보낸다.
      const naked = await fetch(base + "/api/saved/note", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        body: JSON.stringify({ id: entry.id, note: "밖에서 밀어 넣은 메모" }),
      });
      if (naked.status !== 403) bad.push(`외부 출처 요청이 ${naked.status} (403 이어야 한다)`);
      if ((await noteOf(base, entry.id)) !== "건드리면 안 되는 메모") {
        bad.push("거부됐는데도 메모가 바뀌었다");
      }

      // 양성 대조 — 같은 화면에서 보낸 요청은 통과해야 한다. 통째로 막아 놓고
      // 방어에 성공했다고 보고하는 것을 막는다.
      const ok = await post(base, "/api/saved/note", { id: entry.id, note: "정상 경로" });
      if (ok.status !== 200) bad.push(`정상 요청까지 ${ok.status} 로 막혔다`);

      if (bad.length) throw new Error(bad.join(" / "));
      out("S9_G5_OK");
    });
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
  // process.exit 를 쓰지 않는다. 자식 stdio 가 닫히는 중에 끊으면 종료 코드가 127 이 된다.
  process.exitCode = 1;
});
