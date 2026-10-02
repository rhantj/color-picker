#!/usr/bin/env node
// GATES.md 의 게이트를 전부 돌린다(open-work I7 · 42단계).
//   node scripts/run-gates.mjs            전부
//   node scripts/run-gates.mjs S42 S41    그 단계만 (접두어)
//
// 같은 검사기 파일의 게이트는 **순서대로**, 다른 파일끼리는 나란히 돈다. 같은 파일 안의 게이트는 고정 포트를
// 나눠 쓰므로 나란히 돌리면 포트가 부딪혀 거짓 실패가 난다. "1초 안" 같은 시간 게이트(S26-G4 등)는 부하에 흔들리므로
// 동시에 도는 파일 수를 낮게 둔다(`GATE_JOBS`, 기본 3).

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const JOBS = Math.max(1, Number(process.env.GATE_JOBS ?? 3));
// "회귀" 게이트(S34-G10 · S39-G10 · S40-G9)는 검사기 여러 개를 통째로 다시 돌려 2분을 넘는다 `[실측]`.
const TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS ?? 600_000);

/** GATES.md 에서 {id, script, expect} 를 읽는다. CHECK·EXPECT 가 빠진 항목은 그 자체로 실패로 센다. */
function readGates() {
  const text = readFileSync(new URL("../GATES.md", import.meta.url), "utf8");
  const gates = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = /^(S\d+-G\d+) /.exec(lines[i]);
    if (!head) continue;
    const check = /CHECK:\s*node\s+(scripts\/\S+\.mjs)\s+(\S+)/.exec(lines[i + 1] ?? "");
    const expect = /EXPECT:\s*(\S+)/.exec(lines[i + 2] ?? "");
    gates.push({ id: head[1], title: lines[i], script: check?.[1] ?? null, arg: check?.[2] ?? null, expect: expect?.[1] ?? null });
  }
  return gates;
}

function runOne(gate) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [gate.script, gate.arg], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      const ok = stdout.includes(gate.expect);
      resolve({ ...gate, ok, code, ms: Date.now() - started, output: (stdout + stderr).trim() });
    });
  });
}

const filters = process.argv.slice(2);
const all = readGates().filter((g) => filters.length === 0 || filters.some((f) => g.id.startsWith(f + "-") || g.id === f));
const malformed = all.filter((g) => !g.script || !g.expect);
const runnable = all.filter((g) => g.script && g.expect);

/*
 * **"회귀" 게이트는 맨 끝에 혼자 돈다.** S34-G10 · S39-G10 · S40-G9 같은 게이트는 다른 검사기를 통째로 다시 돌리는데, 그것이
 * 같은 검사기를 도는 다른 일꾼과 겹치면 고정 포트가 부딪힌다 — S27-G7 이 4358 에서 EADDRINUSE 로 죽었다(10-02 실측, 기준선에서도).
 */
const isRegression = (g) => /회귀 —|게이트 d+개가 그대로 통과/.test(g.title);
const groups = new Map();
for (const g of runnable.filter((g) => !isRegression(g))) groups.set(g.script, [...(groups.get(g.script) ?? []), g]);
const queue = [...groups.values()];
const results = [];

async function worker() {
  for (let group = queue.shift(); group; group = queue.shift()) {
    for (const gate of group) {
      const r = await runOne(gate);
      results.push(r);
      out(`${r.ok ? "ok  " : "FAIL"} ${r.id} (${r.ms}ms)`);
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: JOBS }, worker));
queue.push(runnable.filter(isRegression));
await worker();

const failed = results.filter((r) => !r.ok);
out("");
for (const g of malformed) out(`형식 오류: ${g.id} — CHECK/EXPECT 를 못 읽었다`);
for (const r of failed) {
  out(`── ${r.id} (기대 ${r.expect}) ──`);
  out(r.output.split("\n").slice(-15).join("\n"));
}
out("");
out(`${results.length - failed.length}/${results.length} 통과 · 형식 오류 ${malformed.length} · ${((Date.now() - started) / 1000).toFixed(1)}초`);
if (failed.length || malformed.length) process.exitCode = 1;
