#!/usr/bin/env node
// 11단계 A(색 파생 엔진) 완료 조건 검사기.
//   node scripts/check-stage11.mjs S11-G1

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expandAll,
  expandSeed,
  hexToHsl,
  hslToHex,
  loadStructures,
  perceivedChroma,
  structureIds,
} from "../src/expand.js";
import { loadSeeds } from "../src/seeds.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const palettes = () => JSON.parse(read("data/palettes.json")).palettes;

/**
 * **실제로 확장되는 씨앗 전부.** 코퍼스 16쌍 + 씨앗 풀 24쌍이다.
 *
 * 코퍼스만 돌면 씨앗 풀 24쌍이 아무 게이트도 없이 화면에 나간다 — 씨앗을 늘리면서 실제로
 * 그럴 뻔했다. 불변식(색 개수·색상축·명도 위계·지각 채도)은 출처가 어디든 똑같이 지켜야 한다.
 */
const allSeeds = () => [...palettes(), ...loadSeeds()];

/** 주석을 걷어낸 소스. 문자열 안의 URL 스킴은 남긴다 — check-stage10 이 같은 이유로 같은 예외를 둔다. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HEX_LITERAL = /#[0-9a-fA-F]{6}\b/g;
const wrapHue = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
};

// 명도 위계를 말하는 구조와, 인접 단계가 최소 얼마나 벌어져야 "덩어리"로 읽히는가.
// 값을 여기 독립적으로 적는 이유는, src/expand.js 의 앵커를 그대로 읽어 오면 앵커를 좁혔을 때
// 게이트도 함께 느슨해져 아무것도 검사하지 않게 되기 때문이다.
const TIERED = ["tone-on-tone", "value-scale"];
const MIN_TIER_GAP = 0.15;

// 8비트로 반올림하면 색상각이 미세하게 흔들린다. 저채도·고명도에서 가장 크다 —
// 밝은 바탕(l=0.93, s≤0.3)은 채널 폭이 10단계뿐이라 ±0.5 반올림이 몇 도로 증폭된다.
//
// 허용치를 실측 흔들림에 맞추지 않는다. 그러면 게이트가 구현을 따라다니느라 아무것도 못 가른다.
// **구조 사이의 최소 색상 차이(유사색 ±25도)의 절반 아래**로 잡는다 — 이 선을 넘으면 "안 움직였다"
// 를 더 이상 주장할 수 없다는 뜻이다. 지금 실측 최대는 5.6도로 이 선의 절반쯤이고,
// 게이트는 통과할 때도 그 값을 찍어 여유가 줄어드는 것을 보이게 한다.
const HUE_EPS = 10;

/** 파생 결과의 헥스를 다시 HSL 로 읽는다. 계산 중간값이 아니라 실제로 나간 색을 본다. */
const readBack = (structure) => structure.colors.map((c) => ({ ...c, ...hexToHsl(c.hex) }));

const gates = {
  "S11-G1": async () => {
    const raw = JSON.parse(read("data/structures.json"));
    const list = raw.structures;
    const bad = [];

    if (list.length !== 8) bad.push(`구조가 8개가 아니라 ${list.length}개다`);

    const ids = new Set();
    for (const s of list) {
      for (const field of ["id", "name", "principle", "detail", "source"]) {
        if (typeof s[field] !== "string" || s[field].trim() === "") {
          bad.push(`${s.id ?? "(id 없음)"} 의 ${field} 가 비었다`);
        }
      }
      // **모든 필드가 문자열이어야 한다.** 이게 "원전에 없는 파생 규칙이 데이터에 섞이지 않았다" 를
      // 실제로 검사하는 자리다 — hueShift: 180 같은 필드가 생기면 여기서 걸린다.
      for (const [k, v] of Object.entries(s)) {
        if (typeof v !== "string") bad.push(`${s.id} 의 ${k} 가 문자열이 아니다 (파생 규칙은 코드에 둔다)`);
      }
      if (HEX_LITERAL.test(JSON.stringify(s))) bad.push(`${s.id} 에 헥스가 박혀 있다`);
      HEX_LITERAL.lastIndex = 0;
      if (ids.has(s.id)) bad.push(`id 가 겹친다: ${s.id}`);
      ids.add(s.id);
    }

    // 카탈로그에만 있고 파생 규칙이 없으면 화면에 이름만 뜨고 색이 안 나온다.
    const runnable = new Set(structureIds());
    for (const s of list) if (!runnable.has(s.id)) bad.push(`${s.id} 에 파생 규칙이 없다`);
    if (runnable.size !== list.length) bad.push(`파생 규칙 ${runnable.size}개 ≠ 카탈로그 ${list.length}개`);

    if (bad.length) throw new Error(bad.join(" / "));
    out("S11_G1_OK");
  },

  "S11-G2": async () => {
    const colors = allSeeds().flatMap((p) => p.colors.map((c) => c.hex));
    if (colors.length !== 80) throw new Error(`원전 색이 80개(코퍼스 32 + 씨앗 48)가 아니라 ${colors.length}개다`);

    const broken = colors.filter((hex) => hslToHex(hexToHsl(hex)) !== hex.toLowerCase());
    if (broken.length) throw new Error(`왕복에서 값이 바뀐 색 ${broken.length}개 — ${broken.slice(0, 4).join(" ")}`);

    // 무채색과 양 끝은 코퍼스에 없다. 왕복이 여기서 깨지면 파생 결과(밝은 바탕)가 조용히 어긋난다.
    for (const hex of ["#000000", "#ffffff", "#808080", "#010203", "#fefdfc"]) {
      if (hslToHex(hexToHsl(hex)) !== hex) throw new Error(`경계값 왕복 실패: ${hex}`);
    }
    out("S11_G2_OK");
  },

  "S11-G3": async () => {
    const seeds = allSeeds();
    const once = JSON.stringify(seeds.map((p) => expandAll(p)));
    const twice = JSON.stringify(seeds.map((p) => expandAll(p)));
    if (once !== twice) throw new Error("같은 씨앗을 두 번 불렸는데 결과가 다르다");

    // 실행 비교만으로는 낮은 확률의 무작위를 못 잡는다. 원인이 될 수 있는 것을 소스에서 함께 본다.
    const src = stripComments(read("src/expand.js"));
    for (const forbidden of ["Math.random", "Date.now", "new Date", "performance.now"]) {
      if (src.includes(forbidden)) throw new Error(`파생에 ${forbidden} 가 들어 있다`);
    }
    out("S11_G3_OK");
  },

  "S11-G4": async () => {
    const bad = [];

    // 정적: 상수 헥스를 심지 않았다. 주석의 실측 기록은 걷어내고 본다.
    const src = stripComments(read("src/expand.js"));
    const literals = src.match(HEX_LITERAL) ?? [];
    if (literals.length) bad.push(`코드에 헥스가 박혀 있다: ${literals.slice(0, 3).join(" ")}`);

    // 행위: 씨앗이 다르면 결과가 다르다. 정적 검사만으로는 "씨앗을 안 읽는 상수 HSL" 을 못 잡는다.
    //
    // **자리마다 본다.** 처음엔 구조의 출력 전체를 문자열로 이어 두 씨앗끼리 비교했는데,
    // 세 색 중 하나를 고정값으로 바꾼 뮤테이션을 놓쳤다 — 나머지 두 색이 달라 전체 문자열은
    // 달라졌기 때문이다(실측). 16쌍 전부를 돌려 자리마다 값이 하나로 굳지 않았는지 본다.
    const list = allSeeds();
    for (const id of structureIds()) {
      const rows = list.map((seed) => expandSeed(seed, id).colors);
      const width = rows[0].length;
      for (let i = 0; i < width; i += 1) {
        const distinct = new Set(rows.map((r) => r[i].hex));
        if (distinct.size < 2) {
          bad.push(`${id} 의 ${rows[0][i].role} 가 씨앗 ${rows.length}쌍 전부에서 ${[...distinct][0]} 로 굳어 있다`);
        }
      }
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S11_G4_OK");
  },

  "S11-G5": async () => {
    const bad = [];
    for (const seed of allSeeds()) {
      for (const s of expandAll(seed)) {
        if (s.colors.length < 2 || s.colors.length > 4) {
          bad.push(`${seed.id}/${s.id} 가 ${s.colors.length}색이다`);
        }
        if (s.colors.some((c) => !/^#[0-9a-f]{6}$/.test(c.hex))) bad.push(`${seed.id}/${s.id} 헥스 형식`);
        if (s.colors.some((c) => typeof c.role !== "string" || !c.role)) bad.push(`${seed.id}/${s.id} 역할 이름`);
      }
    }
    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("S11_G5_OK");
  },

  "S11-G6": async () => {
    const bad = [];
    let worstToneOnTone = 0;

    for (const seed of allSeeds()) {
      // 톤온톤 — 색상축을 안 움직인다. 셋의 색상각이 모두 같아야 한다.
      const tot = readBack(expandSeed(seed, "tone-on-tone"));
      for (const c of tot.slice(1)) {
        const gap = hueGap(c.h, tot[0].h);
        worstToneOnTone = Math.max(worstToneOnTone, gap);
        if (gap > HUE_EPS) bad.push(`${seed.id} 톤온톤이 색상을 ${gap.toFixed(1)}도 움직였다`);
      }

      // 보색대비 — 강조가 나머지에서 180도다.
      const comp = readBack(expandSeed(seed, "complementary"));
      const accentGap = hueGap(comp.at(-1).h, comp[0].h);
      if (Math.abs(accentGap - 180) > 20) bad.push(`${seed.id} 보색이 ${accentGap.toFixed(0)}도다`);

      // 유사색대비 — 가장 먼 두 색도 인접 범위 안이다.
      const ana = readBack(expandSeed(seed, "analogous"));
      const spread = Math.max(...ana.flatMap((x) => ana.map((y) => hueGap(x.h, y.h))));
      if (spread > 60) bad.push(`${seed.id} 유사색이 ${spread.toFixed(0)}도로 벌어졌다`);
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`톤온톤 색상 흔들림 최대 ${worstToneOnTone.toFixed(2)}도 (허용 ${HUE_EPS})`);
    out("S11_G6_OK");
  },

  "S11-G7": async () => {
    const bad = [];
    let tightest = 1;

    for (const seed of allSeeds()) {
      for (const id of TIERED) {
        const tiers = readBack(expandSeed(seed, id));
        for (let i = 1; i < tiers.length; i += 1) {
          const gap = Math.abs(tiers[i].l - tiers[i - 1].l);
          tightest = Math.min(tightest, gap);
          if (gap < MIN_TIER_GAP) {
            bad.push(`${seed.id}/${id} 의 ${tiers[i - 1].role}→${tiers[i].role} 명도차가 ${gap.toFixed(3)}`);
          }
        }
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`가장 좁은 명도 단계 ${tightest.toFixed(3)} (최소 ${MIN_TIER_GAP})`);
    out("S11_G7_OK");
  },

  "S11-G8": async () => {
    const good = palettes()[0];
    const three = { ...good, colors: [...good.colors, { name: "덤", hex: "#123456" }] };
    const one = { ...good, colors: [good.colors[0]] };
    const brokenHex = { ...good, colors: [{ ...good.colors[0], hex: "#12345" }, good.colors[1]] };
    const missingHex = { ...good, colors: [{ name: "이름만" }, good.colors[1]] };
    const nullColors = { ...good, colors: null };

    const cases = [
      ["3색 씨앗", () => expandSeed(three, "tone-on-tone")],
      ["1색 씨앗", () => expandSeed(one, "tone-on-tone")],
      ["깨진 헥스", () => expandSeed(brokenHex, "tone-on-tone")],
      ["헥스 없음", () => expandSeed(missingHex, "tone-on-tone")],
      ["colors 가 null", () => expandSeed(nullColors, "tone-on-tone")],
      ["팔레트가 null", () => expandSeed(null, "tone-on-tone")],
      ["없는 구조", () => expandSeed(good, "no-such-structure")],
      // 6단계에서 format=__proto__ 한 번에 서버가 죽었다. 같은 형태의 입력을 여기서도 막는다.
      ["__proto__", () => expandSeed(good, "__proto__")],
      ["constructor", () => expandSeed(good, "constructor")],
      ["구조 id 가 undefined", () => expandSeed(good, undefined)],
    ];

    const bad = [];
    for (const [label, run] of cases) {
      let value;
      try {
        value = run();
      } catch (err) {
        bad.push(`${label} 에서 던졌다 — ${err.message}`);
        continue;
      }
      if (value !== null) bad.push(`${label} 가 null 이 아니라 ${JSON.stringify(value)?.slice(0, 60)} 를 냈다`);
    }

    // 3색 씨앗이 expandAll 을 통째로 죽이지 않는지도 본다. 화면은 이 함수를 부른다.
    try {
      if (expandAll(three).length !== 0) bad.push("3색 씨앗에 expandAll 이 결과를 냈다");
    } catch (err) {
      bad.push(`expandAll 이 3색 씨앗에서 던졌다 — ${err.message}`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S11_G8_OK");
  },

  // 형광 방지선. **상한을 여기 숫자로 적지 않고 원전 색에서 읽는다** — 적어 두면 구현을 고칠 때
  // 게이트도 함께 느슨해진다. 기준은 "배색사전이 실제로 쓰는 것보다 쨍한 색은 만들지 않는다" 다.
  //
  // 이 게이트가 없던 동안 톤인톤이 0.776 을 내고 있었고(그때 상한 0.729), 주석만으로는 아무도
  // 못 잡았다. 원래 사고였던 #00ffee 는 1.000 이다.
  "S11-G9": async () => {
    const seeds = allSeeds();
    const chromaOf = (hex) => perceivedChroma(hexToHsl(hex));
    const ceiling = Math.max(...seeds.flatMap((p) => p.colors.map((c) => chromaOf(c.hex))));

    const over = [];
    let worst = { v: -1 };
    for (const seed of seeds) {
      for (const s of expandAll(seed)) {
        for (const c of s.colors) {
          const v = chromaOf(c.hex);
          if (v > worst.v) worst = { v, where: `${seed.id}/${s.id}/${c.role} ${c.hex}` };
          // 반올림으로 마지막 자리가 흔들리므로 코퍼스 색 자체를 그대로 내보내는 자리
          // (강조 = 씨앗 원본)가 오차로 걸리지 않게 아주 좁은 여유만 둔다.
          if (v > ceiling + 1e-9) over.push(`${seed.id}/${s.id}/${c.role} ${c.hex} C=${v.toFixed(3)}`);
        }
      }
    }

    if (over.length) {
      throw new Error(`원전 최대 지각 채도 ${ceiling.toFixed(3)} 을 넘는 파생색 ${over.length}개 — ${over.slice(0, 3).join(" / ")}`);
    }
    out(`파생색 최대 지각 채도 ${worst.v.toFixed(3)} / 원전 상한 ${ceiling.toFixed(3)} (씨앗 ${seeds.length}쌍) — ${worst.where}`);
    out("S11_G9_OK");
  },

  /*
   * 톤을 씨앗에서 그대로 가져오는 구조는 **자기 씨앗보다 쨍해지지 않는다.**
   *
   * S11-G9 하나로는 부족하다는 것이 리뷰에서 드러났다. G9 의 상한은 원전 전체에서 읽는 값 하나라,
   * 씨앗 풀이 들어오며 0.729 → 0.871 로 올라갔다. 그 결과 **G9 가 원래 잡았던 회귀(톤인톤 0.776)가
   * 이제 상한 아래로 들어가 안 잡힌다**(실측). 느슨해진 만큼을 되돌리려면 전역 값이 아니라 씨앗별로 본다.
   *
   * 씨앗별 상한을 여덟 구조 전부에 걸 수는 없다. 40쌍 실측:
   *   톤온톤 31/40 초과(최대 +0.341) · 공기원근 15/40(+0.290) · 유사색대비 12/40(+0.239)
   * 밝기를 옮기는 구조가 더 쨍해지는 것은 그 구조가 하는 일 자체다.
   *
   * 넘지 않아야 하는 것은 톤 좌표를 씨앗에서 그대로 가져오는 셋이다:
   *   톤인톤 2/40(최대 +0.004, 8비트 반올림) · 강조색 0/40 · 따뜻한 뉴트럴 0/40
   *
   * 허용치 0.02 는 반올림(+0.004)의 다섯 배이고 과거 회귀(+0.070)의 3분의 1 아래다.
   * 두 값 사이가 비어 있어 이 선이 둘을 가른다.
   */
  "S11-G10": async () => {
    const TONE_FROM_SEED = ["tone-in-tone", "accent-by-chroma", "warm-neutral"];
    const EPS = 0.02;

    const chromaOf = (hex) => perceivedChroma(hexToHsl(hex));
    const bad = [];
    let worst = { over: -1, where: "(없음)" };

    for (const seed of allSeeds()) {
      const seedMax = Math.max(...seed.colors.map((c) => chromaOf(c.hex)));
      for (const id of TONE_FROM_SEED) {
        for (const c of expandSeed(seed, id).colors) {
          const over = chromaOf(c.hex) - seedMax;
          if (over > worst.over) worst = { over, where: `${seed.id}/${id}/${c.role}` };
          if (over > EPS) {
            bad.push(`${seed.id}/${id}/${c.role} ${c.hex} 가 씨앗보다 ${over.toFixed(3)} 쨍하다`);
          }
        }
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 4).join(" / "));
    out(`씨앗 대비 최대 초과 ${worst.over.toFixed(3)} (허용 ${EPS}) — ${worst.where}`);
    out("S11_G10_OK");
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
