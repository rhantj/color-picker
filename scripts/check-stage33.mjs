// 33단계 게이트 — "축" 이라는 말을 "원인" 으로 (대표 지시).
//
// "수축"(색이 줄어드는 성질)·"축축하다" 는 다른 낱말이라 남는다. 그래서 "축" 을 통째로 세지 않고, 앞이 "수" 이거나
// 뒤가 "축" 인 자리는 빼고 센다. JSON 필드 `axis` 와 CSS 클래스 `dx__axis` 는 내부 식별자라 대상이 아니다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

/** "축" 이되 "수축"·"축축" 이 아닌 자리. */
const AXIS_WORD = /(?<![수축])축(?!축)/; // "축축하다" 의 둘째 글자도 뺀다(첫 실행에서 pair-13 이 걸렸다)
const NEW_PHRASE = "의심할 원인";

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");
/** JS 원본에서 문자열 리터럴 안의 글만 모은다 — 식별자(dx__axis 같은)는 한글이 아니라 어차피 안 걸리지만, 주석은 벗긴다. */
const hitsIn = (text) => text.split("\n").filter((l) => AXIS_WORD.test(l)).map((l) => l.trim().slice(0, 80));

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
  "S33-G1": async () => {
    const bad = [];
    for (const p of ["public/index.html", "public/history.html", "public/saved.html"]) {
      const h = hitsIn(stripHtml(read(p)));
      if (h.length) bad.push(`${p}: ${h.join(" | ")}`);
    }
    for (const p of ["public/app.js", "public/ui.js", "public/history.js", "public/saved.js"]) {
      const h = hitsIn(stripJs(read(p)));
      if (h.length) bad.push(`${p}: ${h.join(" | ")}`);
    }
    const ui = stripJs(read("public/ui.js"));
    if (!ui.includes(NEW_PHRASE)) bad.push(`ui.js 에 "${NEW_PHRASE}" 이 없다`);
    if (!stripHtml(read("public/index.html")).includes("의심할 원인")) bad.push("index.html 소개 문장에 '원인' 이 없다");

    const { diagnostics } = JSON.parse(read("data/diagnostics.json"));
    if (!Array.isArray(diagnostics) || diagnostics.length < 18) bad.push("진단표가 비었다");
    for (const d of diagnostics) {
      for (const k of ["symptom", "axis", "prescription", "detail"]) if (AXIS_WORD.test(String(d[k]))) bad.push(`${d.id}.${k}: ${String(d[k]).slice(0, 60)}`);
      for (const a of d.aliases) if (AXIS_WORD.test(a)) bad.push(`${d.id} 별칭 "${a}"`);
    }
    const { palettes } = JSON.parse(read("data/palettes.json"));
    for (const p of palettes) for (const [k, v] of Object.entries(p)) if (typeof v === "string" && AXIS_WORD.test(v)) bad.push(`${p.id}.${k}: ${v.slice(0, 60)}`);
    if (bad.length) throw new Error(bad.join(" / "));
    out(`화면 원본·진단표 ${diagnostics.length}건·팔레트 ${palettes.length}쌍에 "축" 없음("수축"·"축축" 제외) · "${NEW_PHRASE}" 있음`);
    out("S33_G1_OK");
  },

  "S33-G2": async () => {
    const bad = [];
    const server = await startServer(4411);
    try {
      const html = stripHtml(await (await fetch("http://127.0.0.1:4411/")).text());
      const h = hitsIn(html);
      if (h.length) bad.push(`홈: ${h.join(" | ")}`);
      const r = await (await fetch("http://127.0.0.1:4411/api/search?q=%EB%8B%B5%EB%8B%B5%ED%95%B4%EC%9A%94")).json();
      if (r.route !== "diagnosis" || !r.diagnostics?.length) bad.push(`"답답해요" 가 진단으로 안 갔다 (${r.route})`);
      for (const d of r.diagnostics ?? []) for (const k of ["symptom", "axis", "prescription", "detail"]) if (AXIS_WORD.test(String(d[k]))) bad.push(`응답 ${d.id}.${k} 에 "축"`);
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out('홈 HTML 과 "답답해요" 진단 응답에 "축" 없음');
    out("S33_G2_OK");
  },

  "S33-G3": async () => {
    const targets = [];
    for (let i = 1; i <= 4; i += 1) targets.push(["scripts/check-stage1.mjs", `S1-G${i}`]);
    targets.push(["scripts/check-stage4.mjs", "S4-G6"]);
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage10.mjs", `S10-G${i}`]);
    targets.push(["scripts/check-stage29.mjs", "S29-G1"], ["scripts/check-stage29.mjs", "S29-G2"]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S33_G3_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage33.mjs <${Object.keys(GATES).join("|")}>`);
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
