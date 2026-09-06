#!/usr/bin/env node
// 12단계(씨앗 전용 풀) 완료 조건 검사기.
//   node scripts/check-stage12.mjs S12-G1

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandAll, hexToHsl, perceivedChroma } from "../src/expand.js";
import { createSearcher, indexText, loadPalettes } from "../src/palettes.js";
import { loadSeeds, seedLabel } from "../src/seeds.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const chromaOf = (hex) => perceivedChroma(hexToHsl(hex));
const accentChroma = (p) => Math.max(...p.colors.map((c) => chromaOf(c.hex)));
const pairKey = (colors) => colors.map((c) => c.hex.toUpperCase()).sort().join("+");

/** 임시 디렉터리에 픽스처를 쓰고 콜백에 경로를 넘긴다. 저장소의 data/ 는 건드리지 않는다. */
function withFixture(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-seeds-"));
  try {
    const path = join(dir, "seeds.json");
    if (contents !== null) writeFileSync(path, contents, "utf8");
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gates = {
  // 씨앗 풀은 헥스와 원명만 든다. **해설이 하나라도 있으면 지어낸 것이다** — 전사본은 그것을 주지 않는다.
  "S12-G1": async () => {
    const raw = JSON.parse(read("data/seeds.json"));
    const list = raw.seeds;
    const bad = [];

    if (!Array.isArray(list) || list.length !== 24) {
      bad.push(`씨앗이 24쌍이 아니라 ${list?.length}개다`);
    }

    const ids = new Set();
    const pairs = new Set();
    for (const s of list ?? []) {
      if (typeof s.id !== "string" || !/^wada-\d{3}$/.test(s.id)) bad.push(`id 형식: ${s.id}`);
      if (!Number.isInteger(s.no) || s.no < 1 || s.no > 348) bad.push(`${s.id} 조합 번호가 1~348 밖이다: ${s.no}`);
      if (ids.has(s.id)) bad.push(`id 중복: ${s.id}`);
      ids.add(s.id);

      if (!Array.isArray(s.colors) || s.colors.length !== 2) {
        bad.push(`${s.id} 가 2색이 아니다`);
        continue;
      }
      for (const c of s.colors) {
        if (!/^#[0-9A-F]{6}$/.test(c.hex ?? "")) bad.push(`${s.id} 헥스 형식: ${c.hex}`);
        if (typeof c.origName !== "string" || c.origName.trim() === "") bad.push(`${s.id} 원명 없음`);
        // 색에는 원명과 헥스만 둔다. 코퍼스는 색마다 한국어 name 을 드는 스키마라
        // 여기가 가장 그럴듯한 오염 경로다 — 허용 목록으로 본다.
        for (const k of Object.keys(c)) {
          if (k !== "origName" && k !== "hex") bad.push(`${s.id} 의 색에 ${k} 가 있다 (원명·헥스만 둔다)`);
        }
      }
      // 해설 필드가 붙으면 loadSeeds 가 걷어내므로 조용히 개수가 줄어든다 — 여기서 먼저 운다.
      const PROSE = ["summary", "impression", "type", "hueRelation", "toneRelation", "tags", "name"];
      for (const k of Object.keys(s)) {
        if (["id", "no", "colors"].includes(k)) continue;
        bad.push(
          PROSE.includes(k)
            ? `${s.id} 에 ${k} 가 있다 — 전사본에 없는 해설이다`
            : `${s.id} 에 ${k} 가 있다 — 전사본에 없는 값이다`,
        );
      }
      const key = pairKey(s.colors);
      if (pairs.has(key)) bad.push(`쌍 중복: ${s.id}`);
      pairs.add(key);

    }

    // 출처 표기가 있어야 한다. 없으면 어디서 온 값인지 다음 사람이 알 방법이 없다.
    for (const f of ["_source", "_whySeparate", "_notIndexed", "_noProse", "_howPicked"]) {
      if (typeof raw[f] !== "string" || raw[f].trim() === "") bad.push(`${f} 가 비었다`);
    }

    if (bad.length) throw new Error(bad.slice(0, 6).join(" / "));
    if (loadSeeds().length !== list.length) {
      throw new Error(`loadSeeds 가 ${loadSeeds().length}쌍만 통과시켰다 (파일에는 ${list.length}쌍)`);
    }
    out("S12_G1_OK");
  },

  // **씨앗 풀은 검색 색인에 들어가지 않는다.** 해설이 없어 자연어 질의로 잡힐 근거가 없고,
  // 억지로 넣으면 색 이름 하나로 걸려 16쌍의 정답을 밀어낸다.
  "S12-G2": async () => {
    const bad = [];

    // **실제 검색기를 본다.** 처음엔 loadPalettes() 로 색인을 재구성해서 봤는데, createSearcher()
    // 에 씨앗을 합치는 뮤테이션을 통째로 놓쳤다(실측) — 게이트가 보는 것과 서버가 쓰는 것이
    // 달랐기 때문이다. 재구성한 값이 아니라 서버가 실제로 검색하는 그 목록을 본다.
    const searcher = createSearcher();
    const corpus = searcher.palettes;
    if (corpus.length !== 16) bad.push(`색인 대상이 16쌍이 아니라 ${corpus.length}쌍이다`);

    const indexed = corpus.map(indexText).join(" ").toUpperCase();
    const seeds = loadSeeds();
    const corpusHex = new Set(loadPalettes().flatMap((p) => p.colors.map((c) => c.hex.toUpperCase())));

    // **헥스로 본다. 색 이름으로 보지 않는다.**
    // 처음엔 원명도 대조했는데 거짓 양성이 났다 — 씨앗의 `Black` 이 코퍼스 원명 `Blackish Olive`
    // 안에 부분 문자열로 들어 있어 "색인에 있다" 로 걸렸다(실측). 낱말 경계를 넣어도 원서는
    // 같은 이름을 여러 조합에 재사용하므로 이름은 애초에 결정적 증거가 아니다.
    // 헥스는 유일하고, `indexText` 가 언제나 헥스를 함께 넣으므로 색인 유입은 반드시 헥스로 드러난다.
    for (const s of seeds) {
      for (const c of s.colors) {
        if (corpusHex.has(c.hex.toUpperCase())) continue; // 코퍼스와 공유하는 색은 이 검사의 대상이 아니다
        if (indexed.includes(c.hex.toUpperCase())) bad.push(`${s.id} 의 ${c.hex} 가 색인에 있다`);
      }
      if (indexed.includes(s.id.toUpperCase())) bad.push(`${s.id} 가 색인에 있다`);
    }

    // 행위 검사 — 씨앗의 헥스로 실제로 검색해도 그 씨앗이 나오지 않는다.
    // 목록 검사만 두면 "합치지는 않았지만 다른 경로로 색인된" 형태를 놓친다.
    for (const s of seeds.slice(0, 5)) {
      const hex = s.colors[0].hex;
      if (corpusHex.has(hex.toUpperCase())) continue;
      for (const hit of searcher.search(hex, 3)) {
        if (String(hit.doc?.id ?? "").startsWith("wada-")) bad.push(`${hex} 검색에 ${hit.doc.id} 이 나왔다`);
        if (hit.wholeMatches > 0) bad.push(`${hex} 가 색인 어휘에 있다 (${hit.doc?.id})`);
      }
    }

    // 양성 대조 둘 — 이게 없으면 위 검사들은 "검색이 아무것도 안 찾는다" 로도 통과한다.
    const probe = loadPalettes()[0].colors[0].hex;
    if (!indexed.includes(probe.toUpperCase())) bad.push("코퍼스 색조차 색인 텍스트에 없다 — 이 게이트가 헛돌고 있다");
    if (!(searcher.search(probe, 1)[0]?.wholeMatches > 0)) {
      bad.push(`코퍼스 헥스 ${probe} 검색이 안 걸린다 — 헥스 검색 자체가 죽었으므로 위 행위 검사는 무의미하다`);
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`색인 ${corpus.length}쌍 · 씨앗 풀 ${seeds.length}쌍은 색인 밖`);
    out("S12_G2_OK");
  },

  // 씨앗 풀은 코퍼스와 겹치지 않고, 색상축 구조가 의미를 가질 만큼 색이 있다.
  "S12-G3": async () => {
    const bad = [];
    const corpus = loadPalettes();
    const seeds = loadSeeds();

    const corpusPairs = new Set(corpus.map((p) => pairKey(p.colors)));
    const corpusHex = new Set(corpus.flatMap((p) => p.colors.map((c) => c.hex.toUpperCase())));

    // 하한을 상수로 적지 않고 코퍼스에서 읽는다 — 적어 두면 코퍼스가 바뀔 때 둘이 갈린다.
    const floor = Math.min(...corpus.map(accentChroma));

    for (const s of seeds) {
      if (corpusPairs.has(pairKey(s.colors))) bad.push(`${s.id} 이 코퍼스와 같은 쌍이다`);
      for (const c of s.colors) {
        if (corpusHex.has(c.hex.toUpperCase())) bad.push(`${s.id} 이 코퍼스 색 ${c.hex} 을 다시 쓴다`);
      }
      const a = accentChroma(s);
      if (a < floor) {
        bad.push(`${s.id} 의 강조 채도 ${a.toFixed(3)} 가 코퍼스 하한 ${floor.toFixed(3)} 아래다 (색상각이 무의미해진다)`);
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`강조 채도 하한 ${floor.toFixed(3)} · 씨앗 풀 최솟값 ${Math.min(...seeds.map(accentChroma)).toFixed(3)}`);
    out("S12_G3_OK");
  },

  // **씨앗 풀은 없어도 된다.** 코퍼스가 아니라 부가 자산이라 한 항목의 오타가 사이트를 내리면 안 된다.
  "S12-G4": async () => {
    const bad = [];
    const cases = [
      ["파일이 없음", null],
      ["JSON 이 아님", "{{{"],
      ["seeds 가 배열이 아님", '{"seeds":{}}'],
      ["seeds 가 없음", '{"note":"x"}'],
      ["빈 배열", '{"seeds":[]}'],
    ];
    for (const [label, contents] of cases) {
      let got;
      try {
        got = withFixture(contents, (p) => loadSeeds(p));
      } catch (err) {
        bad.push(`${label} 에서 던졌다 — ${err.message}`);
        continue;
      }
      if (!Array.isArray(got) || got.length !== 0) bad.push(`${label} 가 빈 배열이 아니다`);
    }

    // 서버가 이 파일 없이도 기동 가능한 상태인가 — 검색 경로가 씨앗 풀을 import 하지 않아야 한다.
    for (const rel of ["src/palettes.js", "src/pipeline.js", "src/bm25.js"]) {
      if (read(rel).includes("seeds.js")) bad.push(`${rel} 가 씨앗 풀을 읽는다 — 검색이 이 파일에 묶인다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S12_G4_OK");
  },

  // 해설이 섞인 항목은 통과시키지 않는다. 이게 없으면 지어낸 해설이 조용히 씨앗 풀에 눌러앉는다.
  "S12-G5": async () => {
    const good = loadSeeds()[0];
    const bad = [];

    const make = (extra, colorExtra = {}) =>
      JSON.stringify({
        seeds: [
          { ...good, ...extra, colors: good.colors.map((c) => ({ ...c, ...colorExtra })) },
          { ...good, id: "wada-999" },
        ],
      });

    const cases = [
      ["summary 가 붙음", make({ summary: "지어낸 요약" })],
      ["impression 이 붙음", make({ impression: "지어낸 인상" })],
      ["type 이 붙음", make({ type: "A" })],
      ["hueRelation 이 붙음", make({ hueRelation: "보색" })],
      ["toneRelation 이 붙음", make({ toneRelation: "톤 통일" })],
      ["tags 가 붙음", make({ tags: ["숲"] })],
      ["한국어 name 이 붙음", make({ name: "지어낸 이름" })],
      // **색 안쪽에 붙은 것.** 첫 판이 이걸 안 봤고, 구현도 안 막고 있었다 — 코퍼스는 색마다
      // 한국어 name 을 드는 스키마라 여기가 가장 그럴듯한 오염 경로인데 둘 다 비어 있었다.
      ["색 안쪽에 한국어 name", make({}, { name: "지어낸 한국어 이름" })],
      ["색 안쪽에 tags", make({}, { tags: ["숲"] })],
      ["색에 모르는 필드", make({}, { cmyk: [0, 30, 6, 0] })],
      ["씨앗에 모르는 필드", make({ note: "메모" })],
      ["헥스가 깨짐", JSON.stringify({ seeds: [{ ...good, colors: [{ origName: "x", hex: "#12345" }, good.colors[1]] }, { ...good, id: "wada-999" }] })],
      ["원명이 없음", JSON.stringify({ seeds: [{ ...good, colors: [{ hex: good.colors[0].hex }, good.colors[1]] }, { ...good, id: "wada-999" }] })],
      ["3색", JSON.stringify({ seeds: [{ ...good, colors: [...good.colors, { origName: "덤", hex: "#123456" }] }, { ...good, id: "wada-999" }] })],
      ["id 중복", JSON.stringify({ seeds: [good, { ...good }] })],
    ];

    for (const [label, contents] of cases) {
      const got = withFixture(contents, (p) => loadSeeds(p));
      // 오염된 항목만 빠지고 멀쩡한 하나는 남아야 한다 — 통째로 버리면 파일 하나가 전부를 지운다.
      if (got.length !== 1) bad.push(`${label}: 통과 ${got.length}쌍 (1쌍이어야 한다)`);
    }

    // 양성 대조 — 멀쩡한 둘은 둘 다 통과해야 한다. 아니면 위 검사는 늘 참이다.
    const clean = withFixture(JSON.stringify({ seeds: [good, { ...good, id: "wada-999" }] }), (p) => loadSeeds(p));
    if (clean.length !== 2) bad.push(`양성 대조 실패: 멀쩡한 2쌍 중 ${clean.length}쌍만 통과`);

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("S12_G5_OK");
  },

  // 씨앗 풀 24쌍이 실제로 8구조 전부로 확장되고, 화면에 쓸 이름이 나온다.
  "S12-G6": async () => {
    const seeds = loadSeeds();
    const bad = [];
    for (const s of seeds) {
      const expanded = expandAll(s);
      if (expanded.length !== 8) bad.push(`${s.id} 이 ${expanded.length}구조로만 확장됐다`);
      const label = seedLabel(s);
      if (!label.includes("×") || label.trim().length < 3) bad.push(`${s.id} 이름이 이상하다: ${label}`);
      // 이름은 데이터가 아니라 조립된 것이다 — 두 원명이 그대로 들어 있어야 한다.
      for (const c of s.colors) if (!label.includes(c.origName)) bad.push(`${s.id} 이름에 ${c.origName} 이 없다`);
    }
    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`씨앗 ${seeds.length}쌍 × 8구조 = ${seeds.length * 8}장`);
    out("S12_G6_OK");
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
