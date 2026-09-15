// 31단계 게이트 — 화면에서 검색 사다리와 "LLM 이 …" 문구를 뺀다 (대표 지시).
//
// 문구를 빼는 일은 "없다" 를 재야 한다. 주석은 벗기고 코드·마크업의 문자열만 본다 — 주석에 남은 설명은 사용자가 안 본다.
// 감시 대상에서 값을 가져오지 않는다 — 고르개 표시 "(처음 값)" 은 여기 사본이다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

/** 재질 고르개에서 처음 배정된 항목에 붙는 표시. 옛 "(LLM 배정)" 을 대신한다. */
const ORIGIN_MARK = "(처음 값)";

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", EMBED_PREPARE: "0", ...env },
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

const GATES = {
  /* 정적. 있어야 할 것(검색 폼·결과 자리)이 남아 있는지도 함께 본다 — 파일을 비워도 통과하면 안 된다. */
  "S31-G1": async () => {
    const bad = [];
    const html = stripHtml(read("public/index.html"));
    const app = stripJs(read("public/app.js"));
    const ui = stripJs(read("public/ui.js"));
    const css = stripCss(read("public/app.css"));

    if (!/id="search-form"/.test(html) || !html.includes('<ol class="chat"')) bad.push("index.html 에 검색 폼·채팅 목록이 없다 — 파일이 비었나(39단계가 옛 결과 영역 단정을 대체)");
    if (/ladder|stage-label|사전임베딩|온디맨드|핫·콜드/.test(html)) bad.push("index.html 에 사다리가 남아 있다");
    if (/LLM/.test(html)) bad.push("index.html 에 'LLM' 이 남아 있다");
    if (/벡터DB도 쓰지 않습니다/.test(html)) bad.push("소개 문장이 아직 '임베딩도 벡터DB도 쓰지 않습니다' 다 — 사실과 다르다");

    if (/ladder|stage-label|renderLadder/.test(app)) bad.push("app.js 가 아직 사다리를 그린다");
    if (/LLM/.test(app)) bad.push(`app.js 문자열에 'LLM' 이 남아 있다: ${(app.match(/.*LLM.*/g) ?? []).slice(0, 3).map((l) => l.trim()).join(" | ")}`);
    if (/"[123]단계"/.test(app)) bad.push("app.js 에 단계 배지가 남아 있다");
    if (/부르지 않았습니다|질문을 다시 썼/.test(app)) bad.push("app.js 에 단계 문장이 남아 있다");
    if (!/status__timing/.test(app)) bad.push("app.js 에서 시간 줄까지 사라졌다 — 지우는 범위가 넓다");
    if (!/usedLlm/.test(app)) bad.push("app.js 의 usedLlm 집계까지 사라졌다 — 기록은 그대로여야 한다");

    if (/LLM/.test(ui)) bad.push("ui.js 문자열에 'LLM' 이 남아 있다");
    if (!ui.includes(ORIGIN_MARK)) bad.push(`ui.js 의 고르개 표시가 ${ORIGIN_MARK} 가 아니다`);
    if (/\.ladder/.test(css)) bad.push("app.css 에 사다리 스타일이 남아 있다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("사다리 · LLM 문구 · 단계 배지 없음 · 검색 폼·시간 줄·usedLlm 은 그대로");
    out("S31_G1_OK");
  },

  /* 서버가 실제로 내주는 것으로. 고르개 표시는 ui.js 의 함수를 직접 부른다(S21-G1 과 같은 자리). */
  "S31-G2": async () => {
    const bad = [];
    const server = await startServer(4391);
    try {
      const html = stripHtml(await (await fetch("http://127.0.0.1:4391/")).text());
      if (!html.includes('id="search-form"')) bad.push("홈에 검색 폼이 없다");
      if (/ladder/.test(html)) bad.push("홈에 사다리가 있다");
      if (/LLM/.test(html)) bad.push("홈에 'LLM' 이 있다");
    } finally {
      server.kill();
    }
    const { finishOptions } = await import("../public/ui.js");
    const names = { matte: "무광", gloss: "광택", metal: "메탈릭", emissive: "발광" };
    const list = finishOptions(["matte", "gloss", "metal", "emissive"], names, "gloss");
    for (const o of list) {
      const marked = String(o.label).includes(ORIGIN_MARK);
      if (o.id === "gloss" && !marked) bad.push(`처음 배정된 항목에 ${ORIGIN_MARK} 가 없다 (${o.label})`);
      if (o.id !== "gloss" && marked) bad.push(`${o.id} 에 엉뚱한 표시가 붙었다 (${o.label})`);
      if (/LLM/.test(String(o.label))) bad.push(`${o.id} 라벨에 'LLM' 이 남아 있다 (${o.label})`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`홈에 사다리·LLM 없음 · 고르개 표시 ${ORIGIN_MARK}`);
    out("S31_G2_OK");
  },

  "S31-G3": async () => {
    const targets = [["scripts/check-stage2.mjs", "S2-G1"], ["scripts/check-stage14.mjs", "S14-G7"], ["scripts/check-stage21.mjs", "S21-G1"], ["scripts/check-stage26.mjs", "S26-G7"], ["scripts/check-stage27.mjs", "S27-G7"]];
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`화면 게이트 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S31_G3_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage31.mjs <${Object.keys(GATES).join("|")}>`);
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
