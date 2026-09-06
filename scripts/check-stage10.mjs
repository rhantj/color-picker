#!/usr/bin/env node
// 10단계(진단에서 팔레트로) 완료 조건 검사기.
//   node scripts/check-stage10.mjs S10-G1

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { palettesForAxis, relationVocabulary, relationsInAxis } from "../src/bridge.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-check-"));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const corpora = () => ({
  palettes: JSON.parse(read("data/palettes.json")).palettes,
  diagnostics: JSON.parse(read("data/diagnostics.json")).diagnostics,
});

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

const gates = {
  // 관계어를 쓰는 축은 그 관계의 조합을 **전부** 그리고 **그것만** 가리킨다.
  // "붙는다" 만 보면 아무거나 붙여도 통과한다. 집합이 정확히 같은지 본다.
  async "S10-G1"() {
    const { palettes, diagnostics } = corpora();
    const vocab = relationVocabulary(palettes);
    const bad = [];

    const linked = diagnostics.filter((d) => {
      const { hue, tone } = relationsInAxis(d.axis, vocab);
      return hue || tone;
    });
    if (linked.length === 0) bad.push("관계어를 쓰는 진단이 하나도 없다 — 검사 전제가 깨졌다");

    for (const d of linked) {
      const { hue, tone, matches } = palettesForAxis(d.axis, palettes, vocab);
      // 기대 집합을 게이트가 스스로 계산한다. 구현이 준 값을 그대로 베끼지 않는다.
      const expected = palettes.filter(
        (p) => (!hue || p.hueRelation === hue) && (!tone || p.toneRelation === tone),
      );
      if (expected.length === 0) bad.push(`${d.id}: 관계는 잡혔는데 맞는 조합이 하나도 없다`);
      const got = matches.map((p) => p.id).sort().join(",");
      const want = expected.map((p) => p.id).sort().join(",");
      if (got !== want) bad.push(`${d.id}: 조합 집합이 다르다 — ${got} vs ${want}`);

      // 가리킨 것이 정말 그 관계인지 하나하나 본다.
      for (const p of matches) {
        if (hue && p.hueRelation !== hue) bad.push(`${d.id}: ${p.id} 의 색상각이 ${p.hueRelation}`);
        if (tone && p.toneRelation !== tone) bad.push(`${d.id}: ${p.id} 의 톤이 ${p.toneRelation}`);
      }
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G1_OK");
  },

  // 관계를 말하지 않는 축에는 아무것도 안 붙는다. 이 게이트가 이 단계의 무게중심이다 —
  // 지어낸 연결은 "붙는다" 쪽 검사를 전부 통과하면서 여기서만 걸린다.
  async "S10-G2"() {
    const { palettes, diagnostics } = corpora();
    const vocab = relationVocabulary(palettes);
    const bad = [];

    const unlinked = diagnostics.filter((d) => {
      const { hue, tone } = relationsInAxis(d.axis, vocab);
      return !hue && !tone;
    });
    if (unlinked.length === 0) bad.push("관계를 안 쓰는 진단이 하나도 없다 — 검사 전제가 깨졌다");

    for (const d of unlinked) {
      const { matches } = palettesForAxis(d.axis, palettes, vocab);
      if (matches.length) bad.push(`${d.id}(${d.axis}): 관계가 없는데 ${matches.length}개가 붙었다`);
    }

    // 축이 비었거나 관계어와 무관한 문자열이어도 마찬가지다.
    for (const axis of ["", "   ", "아무 말", "작업 순서", null, undefined]) {
      const { matches } = palettesForAxis(axis, palettes, vocab);
      if (matches.length) bad.push(`축 ${JSON.stringify(axis)} 에 ${matches.length}개가 붙었다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G2_OK");
  },

  // 어휘를 코퍼스에서 읽는다. 손으로 쓴 대응표가 소스에 있으면 코퍼스가 바뀔 때 조용히 어긋난다.
  async "S10-G3"() {
    const { palettes } = corpora();
    const bad = [];
    // **연결을 만드는 경로 전체를 본다.** bridge.js 만 보면 그 파일을 정직하게 둔 채
    // server.js 에 `if (doc.id === "dx-...")` 를 넣어 우회할 수 있다. 실제로 그 구멍이 있었다.
    const src = ["src/bridge.js", "server.js", "public/ui.js", "public/app.js"]
      .map(read)
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");

    // 관계어가 코드에 문자열 리터럴로 박혀 있으면 안 된다.
    for (const value of [...new Set([...palettes.map((p) => p.hueRelation), ...palettes.map((p) => p.toneRelation)])]) {
      if (src.includes(`"${value}"`) || src.includes(`'${value}'`)) {
        bad.push(`관계어 ${JSON.stringify(value)} 가 소스에 박혀 있다`);
      }
    }
    // 진단 id 를 보고 분기하면 그것도 손으로 쓴 대응표다.
    if (/\bdx-[a-z-]+/.test(src)) bad.push("소스가 진단 id 를 직접 언급한다");

    // 실제로 코퍼스를 따라가는지 본다 — 팔레트에 없는 관계를 만들어 넣으면 어휘도 늘어야 한다.
    const fake = [...palettes, { hueRelation: "무지개색", toneRelation: "톤 통일" }];
    if (!relationVocabulary(fake).hues.includes("무지개색")) {
      bad.push("어휘가 코퍼스를 따라가지 않는다");
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G3_OK");
  },

  // 긴 어휘가 먼저 잡힌다. `보색에 가까움` 을 `보색` 으로 읽으면 다른 조합을 가리킨다.
  async "S10-G4"() {
    const { palettes } = corpora();
    const vocab = relationVocabulary(palettes);
    const bad = [];

    // 코퍼스에서 한쪽이 다른 쪽의 부분 문자열인 쌍을 찾아 전부 시험한다. 특정 값을 박지 않는다.
    const pairs = [];
    for (const list of [vocab.hues, vocab.tones]) {
      for (const a of list) for (const b of list) if (a !== b && a.includes(b)) pairs.push([a, b]);
    }
    if (pairs.length === 0) bad.push("부분 문자열 쌍이 없다 — 이 게이트가 검사할 것이 없다");

    for (const [long, short] of pairs) {
      const { hue, tone } = relationsInAxis(long, vocab);
      const got = hue === long || tone === long;
      if (!got) bad.push(`"${long}" 이 "${short}" 로 읽혔다 — ${JSON.stringify({ hue, tone })}`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G4_OK");
  },

  // API 가 연결을 담는다. 연결이 없으면 **없다는 사실**을 담는다 — 필드를 빼면 화면이 구분 못 한다.
  async "S10-G5"() {
    return withServer(4920, async (base) => {
      const bad = [];
      const { palettes, diagnostics } = corpora();
      const vocab = relationVocabulary(palettes);

      const linked = diagnostics.find((d) => {
        const r = relationsInAxis(d.axis, vocab);
        return r.hue || r.tone;
      });
      const unlinked = diagnostics.find((d) => {
        const r = relationsInAxis(d.axis, vocab);
        return !r.hue && !r.tone;
      });

      for (const [label, dx] of [["연결되는", linked], ["연결 안 되는", unlinked]]) {
        const res = await fetch(`${base}/api/search?q=${encodeURIComponent(dx.symptom)}&rewrite=0`);
        const data = await res.json();
        const hit = data.diagnostics?.find((x) => x.id === dx.id);
        if (!hit) {
          bad.push(`${label} 진단 ${dx.id} 를 증상으로 못 찾았다 — 검사 전제가 깨졌다`);
          continue;
        }
        if (!Object.hasOwn(hit, "bridge")) {
          bad.push(`${label} 진단에 bridge 필드가 없다`);
          continue;
        }
        const expected = palettesForAxis(dx.axis, palettes, vocab);
        if (expected.matches.length !== (hit.bridge.palettes?.length ?? 0)) {
          bad.push(`${label} 진단의 조합 수가 ${hit.bridge.palettes?.length} (기대 ${expected.matches.length})`);
        }
        if (hit.bridge.hue !== expected.hue || hit.bridge.tone !== expected.tone) {
          bad.push(`${label} 진단의 관계가 ${JSON.stringify([hit.bridge.hue, hit.bridge.tone])}`);
        }
      }

      if (bad.length) throw new Error(bad.join(" / "));
      out("S10_G5_OK");
    });
  },

  // 코퍼스의 관계값이 비었거나 없어도 **연결을 지어내지 않고 죽지도 않는다.**
  // 두 결함이 실제로 있었다 — 빈 문자열은 `"".includes("")` 가 참이라 모든 축에 걸리면서
  // `!hue` 도 참이라 색상각 필터가 조용히 무시됐고, null 이 섞이면 정렬 비교에서 던져
  // `server.js` 최상단 호출이 부팅을 죽였다. `loadPalettes` 도 S1-G1 도 이 필드를 안 본다.
  async "S10-G7"() {
    const bad = [];
    const { palettes } = corpora();
    const two = palettes.slice(0, 2).map((p) => ({ ...p }));

    const cases = [
      ["빈 문자열", [{ ...two[0], hueRelation: "" }, two[1]]],
      ["공백만", [{ ...two[0], hueRelation: "   " }, two[1]]],
      ["필드 없음", [{ ...two[0], hueRelation: undefined }, two[1]]],
      ["null", [{ ...two[0], hueRelation: null }, two[1], { ...two[0], id: "x", hueRelation: "유사색" }]],
      ["톤도 빈 문자열", [{ ...two[0], toneRelation: "" }, two[1]]],
    ];

    for (const [label, list] of cases) {
      let vocab;
      try {
        vocab = relationVocabulary(list);
      } catch (err) {
        bad.push(`${label}: 어휘를 만들다 죽었다 — ${err.message}`);
        continue;
      }
      // 빈 값은 어휘에 들어오면 안 된다. 들어오면 모든 축에 걸린다.
      for (const v of [...vocab.hues, ...vocab.tones]) {
        if (typeof v !== "string" || v.trim() === "") {
          bad.push(`${label}: 빈 관계값이 어휘에 들어갔다 — ${JSON.stringify(v)}`);
        }
      }
      // 관계를 말하지 않는 축에는 여전히 아무것도 안 붙어야 한다.
      try {
        const { matches } = palettesForAxis("면적·순서", list, vocab);
        if (matches.length) bad.push(`${label}: 관계 없는 축에 ${matches.length}개가 붙었다`);
      } catch (err) {
        bad.push(`${label}: 조합을 고르다 죽었다 — ${err.message}`);
      }
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G7_OK");
  },

  // 화면이 둘을 구분해 만든다. 정적 검사다 — 회귀 스모크지 동작 증명이 아니다.
  async "S10-G6"() {
    const bad = [];
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const ui = strip(read("public/ui.js"));
    const app = strip(read("public/app.js"));
    const both = ui + "\n" + app;

    if (!/\bbridge\b/.test(both)) bad.push("화면이 bridge 를 아예 안 쓴다");
    // 연결된 조합을 그리는 자리
    if (!/bridge\.palettes|bridge\?\.palettes/.test(both)) bad.push("bridge.palettes 를 그리는 곳이 없다");
    // 연결이 없을 때 **없다고 말하는** 자리. 비워 두면 사용자는 로딩 중인지 없는 건지 모른다.
    if (!/dx__bridge-none/.test(both)) bad.push("연결이 없다는 것을 알리는 곳이 없다");
    // 연결된 것임을 밝힌다 — 검색 결과와 근거가 다르므로 그 자리를 구분해 부른다.
    if (!/이 축에 맞는|축에 맞는 조합/.test(both)) bad.push("연결된 조합임을 알리는 문구가 없다");
    // **처방을 검색어로 넣는 폴백을 두지 않는다.** 18개 전부 자기 자신으로 돌아온다(실측).
    // 처방을 **단독 인자로 넘기는 호출**만 본다. `el("p", "dx__prescription", dx.prescription)`
    // 같은 정상 렌더를 물면 거짓 실패가 난다 — 처음 쓴 정규식이 실제로 그랬다.
    if (/\(\s*dx\.prescription\s*\)/.test(both)) {
      bad.push("처방을 검색으로 넘기는 코드가 되살아났다");
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S10_G6_OK");
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
  process.exitCode = 1;
});
