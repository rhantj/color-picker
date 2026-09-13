// 29단계 게이트 — 사용자 말투가 별칭에 없으면 임베딩도 못 잡는다 (E2).
//
// 코퍼스만 바꾼다. 게이트는 저장소 data/ 를 읽기만 하고, 서버는 임시 TONEFIRST_DATA_DIR 로 띄운다.
// 감시 대상에서 값을 가져오지 않는다 — 더한 별칭은 여기 사본으로 둔다. 코퍼스에서 별칭이 빠지면 G2 가 운다.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));

/** 더한 별칭 사본. 어절 전체 매치가 2개 이상 나와야 1단계 확신이 선다(26단계 AGREE 규칙과 무관한 BM25 판정). */
const ADDED = Object.freeze({
  "dx-flat-value": ["죽어 보인다", "죽어 보여요", "죽었다", "생기 없어요"],
  "dx-stifling": ["숨이 막혀요", "숨 막혀요", "숨막혀", "막힌다"],
});

/** 어휘 부재 2건 — 26단계 픽스처의 `vocabGap` 그대로. */
const GAP = Object.freeze([
  { q: "화면이 죽어 보여요", want: "dx-flat-value" },
  { q: "숨이 막혀요 화면이", want: "dx-stifling" },
]);

/** 실제 모델 목표. 28단계 14 에 어휘 부재 2건이 더해진다 — 15 면 하나가 아직 안 잡힌 것이라 회귀다. */
const TARGET_CORRECT = 16;

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", ...env },
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

const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();
const topOf = (r) => (r.route === "diagnosis" ? r.diagnostics[0]?.id : r.results[0]?.id) ?? null;

function runChecker(script, id) {
  const child = spawn(process.execPath, [script, id], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => resolve({ id, ok: code === 0 && stdout.includes(id.replace(/-/g, "_") + "_OK"), stdout, tail: (stdout.trim() || stderr.trim()).split("\n").pop() ?? "" })); // stdout 이 있으면 그 마지막 줄 — stderr 경고가 게이트 메시지를 가리지 않게(리뷰 지적)
  });
}

const GATES = {
  /* Ollama 없이. 어절 전체 매치가 2개라 BM25 만으로 1단계 확신이 서야 한다 — 임베딩이 없으면 하이브리드 판정은 건너뛴다(S26-G3). */
  "S29-G1": async () => {
    const bad = [];
    await withServer(4371, { EMBED_PREPARE: "0" }, async (get) => {
      for (const g of GAP) {
        const r = await search(get, g.q);
        const top = topOf(r);
        out(`  ${g.q} → ${r.stage}단계 ${r.route} ${top ?? "-"} 확신 ${r.confident} (기대 ${g.want})`);
        if (r.stage !== 1 || r.route !== "diagnosis" || top !== g.want || r.confident !== true) bad.push(`"${g.q}" → ${r.stage}단계 ${r.route} ${top} 확신 ${r.confident}`);
      }
    });
    if (bad.length) throw new Error(bad.join(" / "));
    out("S29_G1_OK");
  },

  /* 코퍼스에 사본의 별칭이 전부 있고, 유일성(S4-G6)·무결성(S1-G1) 게이트가 그대로 통과한다. */
  "S29-G2": async () => {
    const bad = [];
    const { diagnostics } = JSON.parse(readFileSync(join(ROOT, "data", "diagnostics.json"), "utf8"));
    const byId = new Map(diagnostics.map((d) => [d.id, d]));
    for (const [id, aliases] of Object.entries(ADDED)) {
      const dx = byId.get(id);
      if (!dx) { bad.push(`${id} 가 코퍼스에 없다`); continue; }
      for (const a of aliases) if (!dx.aliases.includes(a)) bad.push(`${id} 에 별칭 "${a}" 가 없다`);
    }
    for (const [script, id] of [["scripts/check-stage4.mjs", "S4-G6"], ["scripts/check-stage1.mjs", "S1-G1"]]) {
      const r = await runChecker(script, id);
      out(`  ${r.ok ? "통과" : "실패"} ${id} — ${r.tail}`);
      if (!r.ok) bad.push(`${id} 실패`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`더한 별칭 ${Object.values(ADDED).flat().length}개가 코퍼스에 있고 유일하다`);
    out("S29_G2_OK");
  },

  /* 실제 bge-m3. 28단계 G1 을 그대로 돌리고 그 출력에서 정답 수와 어휘 부재 2건을 다시 읽는다 — 픽스처를 복제하지 않는다. */
  "S29-G3": async () => {
    const bad = [];
    const r = await runChecker("scripts/check-stage28.mjs", "S28-G1");
    out(r.stdout.trimEnd());
    if (!r.ok) bad.push(`S28-G1 이 실패했다: ${r.tail}`);
    const m = r.stdout.match(/정답 (\d+)\/\d+/); // 분모(비정확 매칭 수)에 안 기댄다 — 28단계 픽스처가 자라도 파서는 그대로(리뷰 지적)
    const correct = m ? Number(m[1]) : -1;
    if (correct < TARGET_CORRECT) bad.push(`정답 ${correct} < ${TARGET_CORRECT}`);
    for (const g of GAP) {
      const line = r.stdout.split("\n").find((l) => l.includes(`${g.q} →`)) ?? "";
      if (!line.trimStart().startsWith("O") || !line.includes(` ${g.want} `)) bad.push(`어휘 부재 "${g.q}" 가 아직 안 잡힌다: ${line.trim() || "(줄 없음)"}`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`정답 ${correct}/18 (목표 ${TARGET_CORRECT} 이상 · 28단계 14)`);
    out("S29_G3_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage29.mjs <${Object.keys(GATES).join("|")}>`);
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
