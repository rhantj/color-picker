// 32단계 게이트 — 사이트 이름을 "톤먼저" 에서 "Color Picker" 로 (대표 지시).
//
// 이름 바꾸기는 "옛 이름이 없다" 와 "새 이름이 있다" 를 둘 다 재야 한다 — 한쪽만 재면 파일을 비워도 통과한다.
// 환경변수(TONEFIRST_DATA_DIR)·임시 폴더 접두(tonefirst-gate-)는 내부 식별자라 대상이 아니다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

const NAME = "Color Picker";
/** 내려받는 파일 이름 사본 — src/export.js 와 public/saved.js 둘 다 이것이어야 한다. */
const FILES = Object.freeze({ css: "color-picker-palettes.css", json: "color-picker-palettes.json", unreal: "color-picker-unreal.json", unity: "color-picker-unity.json" });
const OLD = /톤먼저|TONEFIRST(?!_)|tonefirst-(?!gate|check|\d)|tonefirst\./;

const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", EMBED_PREPARE: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`서버가 5초 안에 뜨지 않았다. stderr: ${stderr.trim() || "(없음)"}`));
    }, 5000);
    child.stdout.on("data", (c) => {
      stdout += c.toString("utf8");
      if (stdout.includes(String(port))) {
        clearTimeout(timer);
        resolve({ child, banner: stdout });
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
  "S32-G1": async () => {
    const bad = [];
    for (const p of ["public/index.html", "public/history.html", "public/saved.html"]) {
      const html = stripHtml(read(p));
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      if (!title.includes(NAME)) bad.push(`${p} 제목이 "${title}"`);
      if (!new RegExp(`class="wordmark__name">${NAME}<`).test(html)) bad.push(`${p} 워드마크가 ${NAME} 가 아니다`);
      if (/wordmark__en/.test(html)) bad.push(`${p} 에 라틴 워드마크가 남아 있다`);
      if (OLD.test(html)) bad.push(`${p} 에 옛 이름이 남아 있다`);
    }
    for (const p of ["public/app.js", "public/saved.js", "public/history.js", "public/ui.js", "server.js", "src/export.js"]) {
      const js = stripJs(read(p));
      const hit = js.match(OLD);
      if (hit) bad.push(`${p} 에 옛 이름 "${hit[0]}" 이 남아 있다`);
    }
    for (const [fmt, name] of Object.entries(FILES)) {
      if (!read("src/export.js").includes(`"${name}"`)) bad.push(`src/export.js 에 ${fmt} 파일 이름 ${name} 이 없다`);
      if (!read("public/saved.js").includes(`"${name}"`)) bad.push(`public/saved.js 에 ${fmt} 파일 이름 ${name} 이 없다`);
    }
    if (/\.wordmark__en/.test(read("public/app.css").replace(/\/\*[\s\S]*?\*\//g, " "))) bad.push("app.css 에 라틴 워드마크 스타일이 남아 있다");
    if (bad.length) throw new Error(bad.join(" / "));
    out(`세 화면 제목·워드마크 ${NAME} · 옛 이름 0 · 내려받기 이름 4개 일치`);
    out("S32_G1_OK");
  },

  "S32-G2": async () => {
    const bad = [];
    const { child, banner } = await startServer(4401);
    try {
      if (!banner.includes(NAME) || OLD.test(banner)) bad.push(`기동 문구가 "${banner.trim().split("\n")[0]}"`);
      for (const path of ["/", "/history", "/saved"]) {
        const html = stripHtml(await (await fetch(`http://127.0.0.1:4401${path}`)).text());
        if (!html.includes(NAME)) bad.push(`${path} 에 ${NAME} 가 없다`);
        if (OLD.test(html)) bad.push(`${path} 에 옛 이름이 있다`);
      }
      // 저장이 하나 있어야 내보내기가 비지 않는다. 저장은 seed 로 한다(S6 와 같은 자리).
      const first = (await (await fetch("http://127.0.0.1:4401/api/search?q=%EC%A0%95%EC%9B%90")).json());
      const paletteId = first.results?.[0]?.id ?? "pair-01";
      await fetch("http://127.0.0.1:4401/api/saved", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:4401" }, body: JSON.stringify({ paletteId, fromQuery: "게이트" }) });
      // 파일 이름은 서버 헤더가 아니라 화면(saved.js 의 download 속성)이 정한다 — 서버 쪽 사양(FORMATS)과 화면 사본이 같은지 본다.
      const { FORMATS } = await import("../src/export.js");
      for (const [fmt, name] of Object.entries(FILES)) {
        const res = await fetch(`http://127.0.0.1:4401/api/export?format=${fmt}`);
        const body = await res.text();
        if (FORMATS[fmt]?.filename !== name) bad.push(`${fmt} 의 서버 파일 이름이 "${FORMATS[fmt]?.filename}" (사본 ${name})`);
        if (OLD.test(body)) bad.push(`${fmt} 본문에 옛 이름이 있다`);
        if (!body.includes(NAME)) bad.push(`${fmt} 본문에 ${NAME} 가 없다`);
      }
    } finally {
      child.kill();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`기동 문구 · 세 화면 · 내보내기 4형식이 ${NAME}`);
    out("S32_G2_OK");
  },

  "S32-G3": async () => {
    const targets = [];
    for (let i = 1; i <= 8; i += 1) targets.push(["scripts/check-stage2.mjs", `S2-G${i}`]);
    for (let i = 1; i <= 8; i += 1) targets.push(["scripts/check-stage6.mjs", `S6-G${i}`]);
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage20.mjs", `S20-G${i}`]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S32_G3_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage32.mjs <${Object.keys(GATES).join("|")}>`);
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
