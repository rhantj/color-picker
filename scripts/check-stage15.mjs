#!/usr/bin/env node
// 15단계(12-A0 — 파생 팔레트의 명도 방향) 완료 조건 검사기.
//   node scripts/check-stage15.mjs S15-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 다섯 게이트가 전부 실패하는 것을 확인한 뒤에
// src/expand.js 를 고쳤다. 통과부터 하는 게이트는 무엇을 지키는지 알 수 없다.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ANCHORS, MIRROR, expandAll, expandSeed, hexToHsl, perceivedChroma, structureIds } from "../src/expand.js";
import { loadSeeds } from "../src/seeds.js";
import { contrast, labelColor } from "../public/color.js";
import { structureColors } from "../public/ui.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const palettes = () => JSON.parse(read("data/palettes.json")).palettes;

/** 실제로 확장되는 씨앗 전부 — 코퍼스 16쌍 + 씨앗 풀 24쌍. check-stage11 과 같은 집합이다. */
const allSeeds = () => [...palettes(), ...loadSeeds()];

/**
 * 어두운 모드 바탕이 만족해야 하는 선. **구조를 두 부류로 나눈다.**
 *
 * 처음엔 전부에 0.5 하나를 걸었고, 리뷰가 그것으로 뚫었다 — `MIRROR` 를
 * `{light:"mid", mid:"light", ...}` (여전히 대합)로 바꾸면 바탕이 L.mid(0.5)로만 옮겨가는데
 * 320장 중 319장이 통과했다. **"딱 중간 회색" 이 "어둡다" 로 합격한 것이다.**
 *
 * 앵커를 쓰는 일곱 구조의 어두운 모드 바탕은 실측이 **0.1510(193장) · 0.1490(87장)** 두 값이다
 * (= L.dark 0.15 를 8비트로 반올림한 결과가 색상에 따라 위아래로 갈린다). 둘 다 0.2 아래이고,
 * 다음 앵커(lower 0.32)와는 멀다 — 그래서 0.2 가 "암부에 속한다" 와 "중간 회색" 을 가른다.
 *
 * **처음엔 "전부 0.1510" 이라고 적었고 틀렸다.** 2라운드 리뷰가 전수로 재서 잡았다.
 * 같은 부류(표본 일부를 전체로 옮겨 적기)의 오류가 이 단계에서 두 번째다 — 첫 번째는
 * S15-G2 주석의 0.471 이었다. **`[실측]` 을 적을 때는 전수를 돌린다.**
 */
const DARK_GROUND_MAX = 0.2;

/** 톤인톤만 다른 선을 쓴다 — 접기라 씨앗 명도를 그대로 물려받는다. 정확한 검사는 아래 FOLD 쪽이다. */
const FOLDED_GROUND_MAX = 0.5;

/**
 * **거울이 닿으면 안 되는 자리.** S15-G5(앵커 정확성)와 S15-G8(불변)이 같은 목록을 쓴다.
 *
 * 목록을 코드에서 유도하지 않고 손으로 적는다. 유도하면 "지금 같은 것" 을 정답으로 삼게 되어
 * 아무것도 검사하지 않는다. 그리고 유도가 불가능하기도 하다 — 이 자리들의 명도가 **우연히
 * 앵커 값에 앉는 경우가 20건 있다**(실측). 명도만 보고 가르려 하면 그 20건이 거짓 실패가 된다.
 */
const NO_MIRROR = [
  ["accent-by-chroma", "강조"], // 씨앗 원본 그대로
  ["warm-neutral", "강조"], //     씨앗 원본 그대로
  ["complementary", "강조"], //    at(accent, {h:+180}) — 앵커를 안 탄다
  ["analogous", "강조"], //        at(accent, {h:+25})  — 앵커를 안 탄다
];
const noMirror = (id, role) => NO_MIRROR.some(([a, b]) => a === id && b === role);

/** 명도 단계의 최소 간격. check-stage11 의 MIN_TIER_GAP 과 **같은 값을 독립적으로 적는다** —
    한쪽에서 읽어 오면 앵커를 좁혔을 때 두 게이트가 함께 느슨해진다. */
const MIN_TIER_GAP = 0.15;
const TIERED = ["tone-on-tone", "value-scale"];

/**
 * 톤인톤은 거울이 아니라 접기다(`min(l, 1-l)`).
 *
 * 톤을 씨앗 명도의 평균에서 가져오므로 앵커가 없고, 그대로 반사하면 **어두운 씨앗이 오히려
 * 밝아진다** — pair-06 의 톤인톤은 l=0.38 이라 반사하면 0.62 다. 접기는 대합이 아니므로
 * S15-G5(두 번 뒤집으면 제자리)에서 제외한다. 제외를 여기 한 줄로 두어, 나중에 톤인톤이
 * 진짜 거울로 바뀌면 이 목록에서 빼는 것만으로 게이트가 다시 조여지게 한다.
 */
const NOT_INVOLUTIVE = ["tone-in-tone"];

/** 파생 결과의 바탕(첫 자리). 역할 이름은 구조마다 다르므로 순서로 잡는다. */
const groundOf = (structure) => structure.colors[0];

/**
 * 서버를 띄워 실제 응답을 본다. check-stage13 의 것과 같은 형태를 **독립적으로** 적는다 —
 * 한쪽에서 읽어 오면 그쪽 하네스가 바뀔 때 이 단계 게이트가 조용히 다른 것을 검사하게 된다.
 */
function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0" },
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
  const child = await startServer(port);
  try {
    return await fn((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    child.kill();
  }
}

/** 주석을 걷어낸 소스. check-stage13 과 같은 예외(문자열 안 URL 스킴)를 같은 이유로 둔다. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const GATES = {
  /*
   * 이 단계의 안전장치다.
   *
   * expand.js 에는 이미 S11 게이트 10개가 걸려 있다. 기본 모드 출력이 한 글자도 안 변한다면
   * 그 열이 회귀할 경로가 없다 — 그래서 새 게이트 넷보다 이것 하나가 먼저다.
   *
   * 기준선은 **src/expand.js 를 고치기 전에** 생성했다(scripts/fixtures/expand-baseline.json).
   * 게이트가 실패할 때 그 파일을 다시 만들면 게이트가 아무것도 검사하지 않게 된다.
   */
  "S15-G1": async () => {
    const fixture = JSON.parse(read("scripts/fixtures/expand-baseline.json"));
    const base = fixture.baseline;
    const seeds = allSeeds();

    if (seeds.length !== fixture.seeds) {
      throw new Error(`씨앗 수가 기준선과 다르다 — 지금 ${seeds.length}, 기준선 ${fixture.seeds}`);
    }

    const diffs = [];
    let checked = 0;
    for (const seed of seeds) {
      const row = base[seed.id];
      if (!row) throw new Error(`기준선에 없는 씨앗 ${seed.id}`);
      for (const st of expandAll(seed)) {
        const now = st.colors.map((c) => `${c.role} ${c.hex}`);
        const then = row[st.id];
        checked++;
        if (!then) throw new Error(`기준선에 없는 구조 ${seed.id}/${st.id}`);
        if (now.join("|") !== then.join("|")) {
          diffs.push(`${seed.id}/${st.id}\n      지금: ${now.join("  ")}\n      기준: ${then.join("  ")}`);
        }
      }
    }

    const expected = fixture.seeds * fixture.structures;
    if (checked !== expected) throw new Error(`대조한 장 수가 다르다 — ${checked} / 기준선 ${expected}`);
    if (diffs.length) {
      throw new Error(`기본 모드 출력이 기준선과 다른 것 ${diffs.length}장 —\n    ${diffs.slice(0, 3).join("\n    ")}`);
    }

    out(`기본 모드 ${checked}장이 변경 전 기준선과 완전히 같다 (씨앗 ${seeds.length} × 구조 ${fixture.structures})`);
    out("S15_G1_OK");
  },

  /*
   * 어두운 모드가 이름값을 하는가. 불변식 셋을 함께 본다.
   *
   *   ① 앵커 기반 일곱 구조의 어두운 모드 바탕은 l <= 0.2, 톤인톤은 <= 0.5
   *   ② 어두운 모드가 밝은 모드보다 **밝아지지는 않는다**
   *   ③ 앵커 기반에서 0.2 를 넘던 바탕은 **전부 실제로 낮아졌다**
   *   ④ 톤인톤은 접기 정의(`min(l, 1-l)`)와 **정확히** 일치한다
   *
   * **처음엔 ②를 "전부 엄격히 낮아진다" 로 썼고, 그건 보편 규칙으로 틀렸다.** 톤인톤은
   * 톤을 씨앗 명도의 평균에서 가져와 세 색이 같은 l 을 쓰므로 **애초에 명도 위계가 없다.**
   * 위계가 없는 것에 방향을 강제하면 원전에 없는 톤을 지어내게 된다 — 씨앗이 이미 어두우면
   * 그대로 두는 것이 그 구조의 정의다(실측 22건, 최대 0.4804 — pair-09).
   *
   * **처음엔 최대를 0.471 이라고 적었고 틀렸다.** 게이트 실패 출력에 찍힌 앞 세 건 중 최댓값을
   * 전체 최댓값으로 옮겨 적었다. 리뷰가 전수로 다시 재서 잡았다 — 이 저장소는 `[실측]` 수치를
   * 근거로 인용하는 규율을 쓰므로, 틀린 실측치는 다음 사람을 잘못 인도한다.
   *
   * 그래서 ③을 따로 둔다. ②만 있으면 "아무것도 안 하는" 구현이 통과하지만, ③이 그것을
   * 막는다 — 밝은 모드 바탕의 87.5% 가 l >= 0.90 이므로 ③은 대다수 장(280)을 실제로 검사한다.
   *
   * 그리고 톤인톤은 느슨한 상한(0.5) 아래에서 **접기의 정의를 정확히** 대조한다
   * (`darkL === min(lightL, 1-lightL)`). 그러지 않으면 그 구조에 대해서는 상한이 공허하다 —
   * 접기가 정의상 0.5 를 넘을 수 없으므로 아무 구현이나 통과한다.
   */
  "S15-G2": async () => {
    const seeds = allSeeds();
    const bad = [];
    let worst = { l: -1 };
    let checked = 0;
    let mustDrop = 0;
    let foldChecked = 0;
    // 8비트 반올림으로 마지막 자리가 흔들린다. 앵커 간 최소 간격(0.17)의 20분의 1 아래.
    const TOL = 0.01;

    for (const seed of seeds) {
      for (const id of structureIds()) {
        const light = expandSeed(seed, id);
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!light || !dark) throw new Error(`확장 실패 ${seed.id}/${id}`);
        checked++;

        const folded = NOT_INVOLUTIVE.includes(id);
        const cap = folded ? FOLDED_GROUND_MAX : DARK_GROUND_MAX;
        const lightL = hexToHsl(groundOf(light).hex).l;
        const darkL = hexToHsl(groundOf(dark).hex).l;
        if (darkL > worst.l) worst = { l: darkL, where: `${seed.id}/${id} ${groundOf(dark).hex}` };

        if (darkL > cap + TOL) {
          bad.push(`${seed.id}/${id} 바탕 l=${darkL.toFixed(3)} > ${cap}`);
          continue;
        }
        if (darkL > lightL + TOL) {
          bad.push(`${seed.id}/${id} 바탕이 오히려 밝아졌다 ${lightL.toFixed(3)} → ${darkL.toFixed(3)}`);
          continue;
        }

        if (folded) {
          // 접기의 정의를 그대로 대조한다. 이것이 이 구조에 대한 실질 검사다.
          foldChecked++;
          const expectedL = Math.min(lightL, 1 - lightL);
          if (Math.abs(darkL - expectedL) > TOL) {
            bad.push(`${seed.id}/${id} 접기가 정의와 다르다 — min(${lightL.toFixed(3)}, ${(1 - lightL).toFixed(3)}) = ${expectedL.toFixed(3)} 이어야 하는데 ${darkL.toFixed(3)}`);
          }
        } else if (lightL > DARK_GROUND_MAX) {
          mustDrop++;
          if (darkL >= lightL) bad.push(`${seed.id}/${id} 밝던 바탕이 안 낮아졌다 ${lightL.toFixed(3)} → ${darkL.toFixed(3)}`);
        }
      }
    }

    if (bad.length) throw new Error(`어두운 모드 바탕이 조건을 못 지킨 것 ${bad.length}개 — ${bad.slice(0, 3).join(" / ")}`);
    // 양성 대조 — 두 갈래가 각자 실제로 무언가를 검사했는가. 0 이면 공짜로 통과한 것이다.
    if (mustDrop === 0) throw new Error(`앵커 기반 구조의 밝은 모드 바탕이 전부 ${DARK_GROUND_MAX} 이하다 — 이 갈래가 아무것도 검사하지 않았다`);
    if (foldChecked === 0) throw new Error("접기 정의를 대조한 장이 하나도 없다 — NOT_INVOLUTIVE 가 코드와 어긋났다");

    out(`앵커 기반 구조의 어두운 모드 바탕은 l <= ${DARK_GROUND_MAX}, 톤인톤은 <= ${FOLDED_GROUND_MAX} (최대 ${worst.l.toFixed(3)} — ${worst.where})`);
    out(`밝던 바탕 ${mustDrop}장이 전부 실제로 낮아졌고, 접기 ${foldChecked}장이 min(l, 1-l) 정의와 정확히 일치한다 (총 ${checked}장)`);
    out("S15_G2_OK");
  },

  /* 거울은 반사일 뿐 압축이 아니다 — 뒤집어도 덩어리 사이가 그대로 벌어져 있어야 한다. */
  "S15-G3": async () => {
    const seeds = allSeeds();
    const tight = [];
    let narrowest = { gap: Infinity };

    for (const seed of seeds) {
      for (const id of TIERED) {
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!dark) throw new Error(`확장 실패 ${seed.id}/${id}`);
        const ls = dark.colors.map((c) => hexToHsl(c.hex).l).sort((a, b) => a - b);
        for (let i = 1; i < ls.length; i++) {
          const gap = ls[i] - ls[i - 1];
          if (gap < narrowest.gap) narrowest = { gap, where: `${seed.id}/${id}` };
          if (gap < MIN_TIER_GAP) tight.push(`${seed.id}/${id} 간격 ${gap.toFixed(3)}`);
        }
      }
    }

    if (tight.length) throw new Error(`어두운 모드에서 명도 단계가 ${MIN_TIER_GAP} 아래로 붙은 것 ${tight.length}개 — ${tight.slice(0, 3).join(" / ")}`);
    out(`어두운 모드 가장 좁은 명도 단계 ${narrowest.gap.toFixed(3)} (최소 ${MIN_TIER_GAP}) — ${narrowest.where}`);
    out("S15_G3_OK");
  },

  /*
   * 명도를 뒤집으면 지각 채도 C = (1-|2l-1|)·s 가 달라진다. 상한을 **원전에서 읽는다** —
   * 숫자로 적어 두면 구현을 고칠 때 게이트도 함께 느슨해진다. S11-G9 와 같은 자리다.
   */
  "S15-G4": async () => {
    const seeds = allSeeds();
    const chromaOf = (hex) => perceivedChroma(hexToHsl(hex));
    const ceiling = Math.max(...seeds.flatMap((p) => p.colors.map((c) => chromaOf(c.hex))));

    const over = [];
    let worst = { v: -1 };
    for (const seed of seeds) {
      for (const id of structureIds()) {
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!dark) throw new Error(`확장 실패 ${seed.id}/${id}`);
        for (const c of dark.colors) {
          const v = chromaOf(c.hex);
          if (v > worst.v) worst = { v, where: `${seed.id}/${id}/${c.role} ${c.hex}` };
          if (v > ceiling + 1e-9) over.push(`${seed.id}/${id}/${c.role} ${c.hex} C=${v.toFixed(3)}`);
        }
      }
    }

    if (over.length) throw new Error(`원전 최대 지각 채도 ${ceiling.toFixed(3)} 을 넘는 어두운 모드 색 ${over.length}개 — ${over.slice(0, 3).join(" / ")}`);
    out(`어두운 모드 최대 지각 채도 ${worst.v.toFixed(3)} / 원전 상한 ${ceiling.toFixed(3)} — ${worst.where}`);
    out("S15_G4_OK");
  },

  /*
   * 거울이 실제로 거울인가. 세 갈래로 본다.
   *   ① 앵커 매핑이 대합이고 앵커 집합 밖으로 나가지 않는다 (MIRROR ∘ MIRROR = 항등)
   *   ② 앵커만 쓰는 구조는 어두운 모드 명도가 **밝은 모드 명도를 앵커 거울로 옮긴 것과 같다** —
   *      앵커 밖의 명도를 새로 지어내지 않는다는 뜻이다
   *   ③ 양성 대조: 어두운 모드가 기본과 실제로 다르다 (mode 가 무시되면 ①②가 공짜로 통과한다)
   *
   * **"두 번 뒤집으면 제자리" 를 제품 인자로 만들지 않았다.** 그렇게 하려면 화면도 API 도
   * 쓰지 않는 `flip` 같은 인자를 expandSeed 에 넣어야 하고, 게이트 편의를 위해 제품 표면을
   * 넓히는 것이 된다. 같은 성질을 ①(순수 매핑)과 ②(결과 대조)로 나눠 본다.
   */
  "S15-G5": async () => {
    const keys = Object.keys(MIRROR);
    if (keys.length === 0) throw new Error("MIRROR 가 비어 있다");
    for (const k of keys) {
      if (!Object.hasOwn(MIRROR, MIRROR[k])) throw new Error(`MIRROR 가 앵커 밖으로 나간다 — ${k} → ${MIRROR[k]}`);
      if (MIRROR[MIRROR[k]] !== k) throw new Error(`앵커 매핑이 대합이 아니다 — ${k} → ${MIRROR[k]} → ${MIRROR[MIRROR[k]]}`);
    }

    // **여덟 구조 전부를 본다.** 처음엔 TIERED 둘만 봤고 리뷰가 그 공백으로 뚫었다 —
    // `complementary` 의 어두운 모드 앵커를 "lower" 대신 "upper" 로 주면 step 안의 anchorFor 가
    // 다시 거울을 태워 이중 반전이 되고, 본문이 l=0.72 대신 0.32 로 나오는데 게이트 다섯이
    // 전부 조용했다(리뷰 지적). 정확성을 보는 게이트가 이것 하나인데 6/8 이 범위 밖이었다.
    //
    // 톤인톤은 앵커를 아예 안 쓰므로(톤이 씨앗 평균) 여전히 제외한다 — S15-G2 가 접기 정의를
    // 정확히 대조하는 쪽을 맡는다. 그리고 NO_MIRROR 자리는 거울이 닿지 않는 것이 의도다.
    const anchored = structureIds().filter((id) => !NOT_INVOLUTIVE.includes(id));
    if (anchored.length === 0) throw new Error("앵커 거울을 검사할 구조가 하나도 없다");

    // 8비트 반올림으로 l 의 마지막 자리가 흔들린다. 앵커 간 최소 간격(0.17)의 20분의 1 아래로 잡는다.
    const TOL = 0.01;
    const anchorNames = Object.keys(ANCHORS);
    const nameOf = (l) => anchorNames.find((k) => Math.abs(ANCHORS[k] - l) <= TOL);

    const seeds = allSeeds();
    const bad = [];
    let checked = 0;
    let skipped = 0;
    for (const seed of seeds) {
      for (const id of anchored) {
        const light = expandSeed(seed, id);
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!light || !dark) throw new Error(`확장 실패 ${seed.id}/${id}`);

        for (let i = 0; i < light.colors.length; i++) {
          const role = light.colors[i].role;
          if (noMirror(id, role)) {
            skipped++;
            continue;
          }
          const lightL = hexToHsl(light.colors[i].hex).l;
          const darkL = hexToHsl(dark.colors[i].hex).l;
          const name = nameOf(lightL);
          if (!name) {
            bad.push(`${seed.id}/${id}/${role} 밝은 모드 l=${lightL.toFixed(3)} 이 앵커가 아니다`);
            continue;
          }
          checked++;
          const expected = ANCHORS[MIRROR[name]];
          if (Math.abs(darkL - expected) > TOL) {
            bad.push(`${seed.id}/${id}/${role} ${name}→${MIRROR[name]} 이면 l=${expected} 여야 하는데 ${darkL.toFixed(3)}`);
          }
        }
      }
    }

    // 양성 대조 — 어두운 모드가 기본과 같으면 mode 가 무시되고 있는 것이다.
    const sample = seeds[0];
    const probe = anchored[0];
    const once = expandSeed(sample, probe, undefined, { mode: "dark" });
    const plain = expandSeed(sample, probe);
    if (once.colors.map((c) => c.hex).join("|") === plain.colors.map((c) => c.hex).join("|")) {
      throw new Error(`어두운 모드 결과가 기본과 같다 — mode 가 무시되고 있다 (${sample.id}/${probe})`);
    }

    if (bad.length) throw new Error(`앵커 거울을 벗어난 것 ${bad.length}개 — ${bad.slice(0, 3).join(" / ")}`);
    if (checked === 0) throw new Error("앵커 거울을 대조한 자리가 하나도 없다");
    out(`앵커 ${keys.length}개가 대합이고, 구조 ${anchored.length}개 × 씨앗 ${seeds.length} 의 앵커 자리 ${checked}곳이 전부 거울 그대로다 (거울이 안 닿는 자리 ${skipped}곳 제외)`);
    out("S15_G5_OK");
  },
  /*
   * 옵션 인자를 무엇으로 주든 던지지 않고, 알 수 없는 값은 기본 모드로 읽는가.
   *
   * **`{ mode = "light" } = {}` 로 받았다가 여기서 걸렸다.** 구조 분해 기본값은 undefined 만
   * 막고 null 은 못 막아 `expandSeed(p, id, cat, null)` 이 던졌다 — 이 함수의 계약이
   * "던지지 않는다" 인데 정면으로 깨진 것이다. 호출부가 `opts ?? null` 을 쓰면 바로 닿는다.
   *
   * **양성 대조를 함께 둔다** — 유효한 "dark" 는 반드시 어두운 모드로 읽혀야 한다.
   * 그게 없으면 "전부 light 로 떨어뜨리는" 구현이 이 게이트를 만점으로 통과한다.
   */
  "S15-G6": async () => {
    const seed = palettes()[0];
    const id = structureIds()[0];
    const expected = expandSeed(seed, id).colors.map((c) => c.hex).join("|");

    const probes = [
      ["생략", undefined],
      ["null", null],
      ["빈 객체", {}],
      ['mode:"DARK" (대문자)', { mode: "DARK" }],
      ["mode:null", { mode: null }],
      ["mode:{}", { mode: {} }],
      ['mode:"__proto__"', { mode: "__proto__" }],
      ['mode:"constructor"', { mode: "constructor" }],
      ["mode:0", { mode: 0 }],
      ["mode:true", { mode: true }],
      ["Object.create(null)", Object.assign(Object.create(null), { mode: "dark!" })],
      ["배열", []],
      ["문자열", "dark"],
    ];

    const bad = [];
    for (const [label, opt] of probes) {
      let r;
      try {
        r = expandSeed(seed, id, undefined, opt);
      } catch (err) {
        bad.push(`${label} 에서 던졌다 — ${err.message}`);
        continue;
      }
      if (!r) {
        bad.push(`${label} 에서 null 이 나왔다 (씨앗과 구조는 유효한데)`);
        continue;
      }
      if (r.mode !== "light") bad.push(`${label} 이 mode="${r.mode}" 로 읽혔다`);
      const got = r.colors.map((c) => c.hex).join("|");
      if (got !== expected) bad.push(`${label} 의 색이 기본과 다르다 — ${got}`);
    }

    // 양성 대조 — 유효한 "dark" 는 실제로 어두운 모드여야 한다.
    const dark = expandSeed(seed, id, undefined, { mode: "dark" });
    if (!dark || dark.mode !== "dark") throw new Error(`유효한 mode:"dark" 가 어두운 모드로 안 읽혔다`);
    if (dark.colors.map((c) => c.hex).join("|") === expected) {
      throw new Error("mode:\"dark\" 결과가 기본과 같다 — 모든 옵션이 무시되고 있다");
    }

    // expandAll 이 옵션을 실제로 넘기는가. 넘기지 않아도 **여섯 게이트가 전부 조용했다**(실측) —
    // 나머지가 전부 expandSeed 로만 봤기 때문이다. 화면·API 가 쓰는 것은 expandAll 쪽이다.
    for (const seed of palettes()) {
      const viaAll = expandAll(seed, undefined, { mode: "dark" });
      const viaOne = structureIds().map((sid) => expandSeed(seed, sid, undefined, { mode: "dark" }));
      if (viaAll.length !== viaOne.length) throw new Error(`expandAll 과 expandSeed 의 구조 수가 다르다 (${seed.id})`);
      for (let i = 0; i < viaAll.length; i++) {
        const a = viaAll[i].colors.map((c) => c.hex).join("|");
        const b = viaOne[i].colors.map((c) => c.hex).join("|");
        if (viaAll[i].mode !== "dark") throw new Error(`expandAll 이 옵션을 안 넘긴다 — ${seed.id}/${viaAll[i].id} mode="${viaAll[i].mode}"`);
        if (a !== b) throw new Error(`expandAll 과 expandSeed 의 결과가 다르다 — ${seed.id}/${viaAll[i].id}`);
      }
    }

    if (bad.length) throw new Error(`옵션 인자 방어가 뚫린 것 ${bad.length}개 — ${bad.slice(0, 3).join(" / ")}`);
    out(`옵션 ${probes.length}가지가 전부 던지지 않고 기본 모드로 읽혔다 (양성 대조: mode:"dark" 는 어두운 모드)`);
    out(`expandAll 이 옵션을 그대로 넘기고 expandSeed 와 같은 색을 낸다 (코퍼스 ${palettes().length}쌍)`);
    out("S15_G6_OK");
  },
  /*
   * 채도 상한이 거울을 타지 않는가.
   *
   * `src/expand.js` 는 **명도만 뒤집고 채도 상한(S_CAP)은 규칙이 요청한 원래 키를 따른다.**
   * S_CAP 은 앵커가 맡는 *역할*에 맞춘 값이라 — `light` 가 가장 낮은 것은 그 자리가 언제나
   * 바탕이라 조용해야 하기 때문이다 — 바탕이 어느 명도로 가든 상한은 바탕의 것이어야 한다.
   *
   * **이 결정에 게이트가 없었다.** 뮤테이션으로 `S_CAP[key]` 를 `S_CAP[anchorFor(key, mode)]`
   * 로 바꿨을 때 게이트 여섯이 전부 조용했다(실측). 상한이 0.3 에서 0.85 로 열리는데도다.
   *
   * 상한을 expand.js 에서 읽어 오지 않고 **여기 독립적으로 적는다.** 읽어 오면 S_CAP.light 를
   * 올렸을 때 게이트도 함께 느슨해져 아무것도 검사하지 않게 된다 — MIN_TIER_GAP 과 같은 이유다.
   */
  "S15-G7": async () => {
    const GROUND_S_CAP = 0.3; // = src/expand.js 의 S_CAP.light
    // 톤인톤은 step 을 쓰지 않는다 — 톤을 씨앗 명도·채도에서 직접 가져오므로 앵커 상한이 걸릴 자리가
    // 없다(어두운 모드 바탕 s 최대 0.939, 실측). 상한을 강제하면 그 구조의 정의를 깬다.
    const NO_ANCHOR_CAP = ["tone-in-tone"];
    const subject = structureIds().filter((id) => !NO_ANCHOR_CAP.includes(id));
    if (subject.length === 0) throw new Error("채도 상한을 검사할 구조가 하나도 없다");

    const seeds = allSeeds();
    const over = [];
    let worst = { s: -1 };
    let checked = 0;

    for (const seed of seeds) {
      for (const id of subject) {
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!dark) throw new Error(`확장 실패 ${seed.id}/${id}`);
        checked++;
        const s = hexToHsl(groundOf(dark).hex).s;
        if (s > worst.s) worst = { s, where: `${seed.id}/${id} ${groundOf(dark).hex}` };
        // 8비트 반올림으로 마지막 자리가 흔들린다. 상한과 다음 상한(0.5) 사이가 넓어 여유는 좁게 둔다.
        if (s > GROUND_S_CAP + 0.005) over.push(`${seed.id}/${id} 바탕 s=${s.toFixed(3)}`);
      }
    }

    if (over.length) {
      throw new Error(`어두운 모드 바탕이 바탕 역할의 채도 상한 ${GROUND_S_CAP} 을 넘은 것 ${over.length}개 — ${over.slice(0, 3).join(" / ")}`);
    }
    out(`어두운 모드 바탕 최대 채도 ${worst.s.toFixed(3)} / 바탕 역할 상한 ${GROUND_S_CAP} (구조 ${subject.length} × 씨앗 ${seeds.length} = ${checked}장) — ${worst.where}`);
    out("S15_G7_OK");
  },
  /*
   * 거울이 **닿으면 안 되는 자리**에 닿지 않는가.
   *
   * 이 단계의 설계 의도 셋 중 하나 — "씨앗 원본을 그대로 내보내는 자리는 뒤집지 않는다".
   * 뒤집으면 씨앗에 없는 색을 지어내게 되고, 그건 `src/expand.js` 맨 위가 "헥스를 지어내지
   * 않는다" 로 금지한 것과 같은 부류다.
   *
   * **이 의도에 게이트가 없었다.** `{ role: "강조", hsl: accent }` 를 거울을 타게 바꿔도
   * S11 열 개와 S15 일곱 개가 전부 조용했다 — S11 은 어두운 모드를 아예 안 돌리고,
   * S15 는 바탕의 명도·채도만 봤기 때문이다(리뷰 지적 H2).
   *
   * 세 부류를 나눠 선언한다. 목록을 코드에서 유도하지 않고 **손으로 적는다** — 유도하면
   * "지금 같은 것" 을 정답으로 삼게 되어 아무것도 검사하지 않는다.
   */
  "S15-G8": async () => {
    // ① 씨앗 원본을 그대로 내보내는 자리. 두 모드 모두에서 씨앗의 강조색과 **정확히 같아야** 한다.
    const SEED_RAW = NO_MIRROR.filter(([id]) => id === "accent-by-chroma" || id === "warm-neutral");
    // ② 앵커를 안 타는 자리(`at(accent, {h: ...})`). 씨앗 원본은 아니지만 명도를 앵커에서 받지
    //    않으므로 거울이 닿지 않는다 — 두 모드에서 같아야 한다.
    const NO_ANCHOR = NO_MIRROR.filter(([id]) => id === "complementary" || id === "analogous");
    if (SEED_RAW.length + NO_ANCHOR.length !== NO_MIRROR.length) {
      throw new Error("NO_MIRROR 에 이 게이트가 분류하지 못하는 항목이 있다 — 목록이 늘었으면 여기도 늘린다");
    }
    /*
     * ③ 거울의 고정점(mid→mid)을 쓰는 자리. 거울은 타지만 결과가 같다.
     *    MIRROR 에서 mid 가 고정점이 아니게 되면 여기서 먼저 운다.
     *
     * **`tone-on-tone/본문` 이 여기 있었는데 24단계에서 빠졌다.** 그 자리를 `mid` 에서
     * `lower` 로 내렸기 때문이다 — `light`(0.93)와 `mid`(0.5)의 대비는 순수 회색으로도
     * 최대 3.37:1 이라 **어떤 색으로도 글자가 안 읽히는 자리**였다.
     *
     * **이 게이트가 그 이동을 잡았다.** 목록이 손으로 적혀 있어서다(아래 참조).
     * 빼는 것은 검사를 약하게 만드는 것이 아니라 **그 자리가 더 이상 `mid` 가 아니라서**다.
     * 이제 그 본문은 모드에 따라 달라진다 — 어두운 바탕에는 밝은 본문이 놓이는 것이 맞고,
     * 전에는 두 모드에서 같아서 어두운 모드의 대비가 3.02 까지 내려갔다(실측).
     */
    const MID_FIXED = [["aerial", "중간"]];

    const seeds = allSeeds();
    const bad = [];
    let checked = 0;
    const differed = {};

    const pick = (structure, role) => structure.colors.find((c) => c.role === role);

    for (const seed of seeds) {
      for (const id of structureIds()) {
        const light = expandSeed(seed, id);
        const dark = expandSeed(seed, id, undefined, { mode: "dark" });
        if (!light || !dark) throw new Error(`확장 실패 ${seed.id}/${id}`);

        // 양성 대조용 — 이 구조에서 모드에 따라 실제로 달라지는 자리가 있는가.
        differed[id] = (differed[id] ?? 0) + light.colors.filter((c, i) => c.hex !== dark.colors[i].hex).length;

        for (const [group, label, extra] of [
          [SEED_RAW, "씨앗 원본", true],
          [NO_ANCHOR, "앵커 밖", false],
          [MID_FIXED, "거울 고정점", false],
        ]) {
          for (const [sid, role] of group) {
            if (sid !== id) continue;
            const a = pick(light, role);
            const b = pick(dark, role);
            if (!a || !b) throw new Error(`${id} 에 역할 "${role}" 이 없다 — 목록이 코드와 어긋났다`);
            checked++;
            if (a.hex !== b.hex) bad.push(`${seed.id}/${id}/${role} ${label} 인데 모드에 따라 달라졌다 ${a.hex} → ${b.hex}`);
            if (extra && a.hex.toLowerCase() !== light.seed.accent.toLowerCase()) {
              bad.push(`${seed.id}/${id}/${role} 이 씨앗 원본(${light.seed.accent})이 아니다 — ${a.hex}`);
            }
          }
        }
      }
    }

    // 양성 대조 — 어느 구조든 모드에 따라 달라지는 자리가 하나도 없으면 이 게이트는 공짜다.
    const frozen = Object.entries(differed).filter(([, n]) => n === 0).map(([k]) => k);
    if (frozen.length) throw new Error(`모드가 바뀌어도 한 자리도 안 달라진 구조가 있다 — ${frozen.join(", ")}`);
    if (checked === 0) throw new Error("검사한 자리가 하나도 없다 — 목록이 비었거나 구조 id 가 어긋났다");

    if (bad.length) throw new Error(`거울이 닿으면 안 되는 자리에 닿았다 ${bad.length}건 — ${bad.slice(0, 3).join(" / ")}`);
    out(`거울이 안 닿아야 하는 ${SEED_RAW.length + NO_ANCHOR.length + MID_FIXED.length}자리 × 씨앗 ${seeds.length} = ${checked}건이 두 모드에서 동일하고, 씨앗 원본 자리는 씨앗 강조색 그대로다`);
    out("S15_G8_OK");
  },
  /*
   * 카드 스와치 규칙이 파생 카드까지 잡아먹지 않는가. **정적 검사다.**
   *
   * 무엇이 있었나: `.card--featured .swatch { width: 460px }` 와
   * `.card:not(.card--featured) .swatch { height: 128px }` 는 카드 **자신의** 스와치를 겨냥해
   * 쓰였고, 그때는 카드 안에 다른 스와치가 없었다.
   *
   * 무엇이 깨졌나: 13단계에서 파생 팔레트가 카드 **안**(`.expand__grid > .struct`)으로 들어왔다.
   * 자손 선택자라 그 안의 스와치까지 함께 걸렸고, 실측으로
   *   featured 카드 안 8장 — 폭이 460px 로 고정되어 카드(298px) 밖으로 **176px 넘침**
   *   normal   카드 안 8장 — 높이가 128px 로 고정 (정상 42px 의 3배)
   * 이 됐다. 규칙을 고친 쪽이 아니라 **주변이 바뀌어 조용히 잘못 걸리기 시작한** 결함이다.
   *
   * **이 게이트는 실행 시점 넘침을 못 본다.** 의존성 0 이라 헤드리스 브라우저가 없다
   * (GATES.md '알려진 한계'가 같은 이유로 같은 말을 한다). 선택자가 자손 형태로 되돌아가는
   * 것만 본다 — 다르게 쓴 같은 누수는 못 잡는다. 실제 넘침 확인은 브라우저에서 손으로 한다.
   */
  "S15-G9": async () => {
    const css = read("public/app.css").replace(/\/\*[\s\S]*?\*\//g, " ");

    /*
     * 중괄호를 걸으며 선택자를 모은다.
     *
     * **처음엔 `/(^|[};])([^{}@;]+)\{/g` 로 읽었고 리뷰가 뚫었다.** 그 정규식은 선택자 앞에
     * `}`·`;`·문자열 시작 중 하나를 요구하는데, `@media (...) {` 바로 다음에 오는 **그 블록의
     * 첫 규칙**은 앞이 `{` 이라 셋 중 무엇에도 안 걸린다. 그래서 목록에 아예 안 들어가고,
     * 그 자리에 자손 선택자를 되돌려 놓아도 게이트가 통과했다(실측: 최소 반례에서 목록이 빈 배열).
     *
     * 따옴표 안은 건너뛴다 — `content: "{"` 같은 값이 구분자로 오인되지 않게.
     */
    const scanSelectors = (src) => {
      const found = [];
      let buf = "";
      let quote = null;
      for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
          buf += ch;
          if (ch === "\\") {
            buf += src[++i] ?? "";
          } else if (ch === quote) {
            quote = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          buf += ch;
          continue;
        }
        if (ch === "{") {
          const prelude = buf.trim().replace(/\s+/g, " ");
          // at-rule 프렐류드(`@media ...`)는 선택자가 아니다. 그 안쪽 규칙은 계속 걸린다.
          if (prelude && !prelude.startsWith("@")) {
            for (const one of prelude.split(",")) {
              const s = one.trim().replace(/\s+/g, " ");
              if (s) found.push(s);
            }
          }
          buf = "";
          continue;
        }
        if (ch === "}" || ch === ";") {
          buf = "";
          continue;
        }
        buf += ch;
      }
      return found;
    };

    const selectors = scanSelectors(css);
    if (selectors.length === 0) throw new Error("app.css 에서 선택자를 하나도 못 읽었다 — 파싱이 깨졌다");

    // 스캐너 자체의 양성 대조. at-rule 첫 규칙을 다시 놓치기 시작하면 여기서 먼저 운다.
    const probe = scanSelectors('@media (max-width: 1px) {\n  .a .b { color: red; }\n  .c > .d { color: red; }\n}');
    if (probe.join("|") !== ".a .b|.c > .d") {
      throw new Error(`선택자 스캐너가 at-rule 안을 제대로 못 읽는다 — 얻은 것: ${JSON.stringify(probe)}`);
    }

    // `.swatch` 토큰만. `.swatch__part` · `.swatch--mini` 는 다른 것이다.
    const SWATCH = /\.swatch(?![\w-])/;
    const cardScoped = selectors.filter((s) => SWATCH.test(s) && /\.card(?![\w-])|\.card--featured/.test(s));
    if (cardScoped.length === 0) throw new Error("카드 스코프의 .swatch 규칙이 하나도 없다 — 규칙이 통째로 사라졌거나 파싱이 깨졌다");

    // `.swatch` 바로 앞의 결합자가 `>` 인가. 공백이면 자손 선택자이고, 카드 안의 파생 스와치까지 잡는다.
    const leaks = cardScoped.filter((s) => {
      const i = s.search(SWATCH);
      return !/>\s*$/.test(s.slice(0, i));
    });

    if (leaks.length) {
      throw new Error(
        `카드 스와치 규칙이 자손 선택자다 — 카드 안의 파생 스와치(.struct .swatch)까지 잡는다. ` +
          `\`>\` 로 직속 자식만 겨냥한다: ${leaks.join(" / ")}`,
      );
    }

    /*
     * 양성 대조 — 검사 대상이 실제로 있었는가.
     *
     * **처음엔 개수만 봤고(`child.length < 2`) 리뷰가 뚫었다.** 버그를 만든 바로 그 규칙
     * (`.card--featured > .swatch { width: 460px }`) **하나만** 지워도 나머지 둘이 남아
     * 문턱을 만족했다(실측: `S15_G9_OK`). 개수는 "무엇이 남았는가" 를 말하지 않는다.
     *
     * 그래서 **선택자별 개수를 손으로 적고 정확히 대조한다.** `.card--featured > .swatch` 가
     * 둘인 것은 데스크톱(폭 460px)과 좁은 화면 미디어쿼리(폭 auto·높이 148px) 두 벌이기 때문이다.
     * 규칙을 정당하게 늘리거나 줄이면 이 표를 함께 고친다 — NO_MIRROR 와 같은 규율이다.
     */
    const EXPECTED = new Map([
      [".card--featured > .swatch", 2],
      [".card:not(.card--featured) > .swatch", 1],
    ]);

    const actual = new Map();
    for (const s of cardScoped) actual.set(s, (actual.get(s) ?? 0) + 1);

    const mismatch = [];
    for (const [sel, want] of EXPECTED) {
      const got = actual.get(sel) ?? 0;
      if (got !== want) mismatch.push(`${sel} — ${want}개여야 하는데 ${got}개`);
    }
    for (const [sel, got] of actual) {
      if (!EXPECTED.has(sel)) mismatch.push(`${sel} — 표에 없는 규칙 ${got}개. 정당한 추가라면 EXPECTED 에 적는다`);
    }
    if (mismatch.length) {
      throw new Error(`카드 스와치 규칙 구성이 표와 다르다 — ${mismatch.join(" / ")}`);
    }

    out(`카드 스코프 .swatch 규칙 ${cardScoped.length}개가 전부 직속 자식(\`>\`)이고 구성이 표와 같다 — ${[...EXPECTED].map(([s, n]) => `${s} ×${n}`).join(" / ")}`);
    out("S15_G9_OK");
  },

  /**
   * **두 모드를 한 번에 내려보낸다.** 토글이 모드를 서버에 보내지 않기로 한 결정(S15-G11)의
   * 반대쪽 절반이다 — 보내지 않으려면 이미 받아 둔 것이 있어야 한다.
   *
   * 검사는 셋이다.
   *   1. `colors` 가 **엔진 기본 모드 출력과 정확히 같다** — 기존 필드가 안 바뀌었다는 회귀 검사.
   *      S13-G4·S14-G4 는 응답 "형태" 를 보지 값까지는 안 본다.
   *   2. `colorsDark` 가 **엔진 어두운 모드 출력과 정확히 같다.** `colors` 를 그대로 복사해
   *      내려보내는 구현은 여기서 죽는다.
   *   3. 두 필드가 실제로 다른 장 수가 **엔진이 다른 장 수와 일치한다.**
   *
   * ③의 기준값을 상수로 박지 않고 엔진에서 매번 다시 센다. 박아 두면 앵커를 고쳤을 때
   * 게이트가 옛 숫자를 지키느라 거짓 실패한다. **실측 320장 중 298장이 다르다** — 같은 22장은
   * 전부 `톤인톤` 이고, 접기(`min(l, 1-l)`)라 이미 어두운 씨앗에서는 항등이기 때문이다.
   */
  "S15-G10": async () => {
    // **씨앗 전부를 본다.** 처음엔 코퍼스·씨앗 풀에서 하나씩 두 개만 물었고(구조 16장),
    // 리뷰가 지적했다 — 주석은 "320장 중 298장" 이라는 전수 실측을 근거로 인용하는데 게이트가
    // 실제로 도는 범위는 16장이었다. 서버는 한 번만 띄우고 요청만 40번 보내면 되므로 값이 싸다.
    const seeds = allSeeds();
    if (seeds.length < 2) throw new Error("씨앗이 둘 미만이라 이 게이트가 검사할 것이 없다");

    const bad = [];
    let checked = 0;
    let differing = 0;
    let expectedDiffering = 0;

    await withServer(4930, async (get) => {
      for (const seed of seeds) {
        const label = seed.id;
        const res = await get(`/api/expand?seed=${encodeURIComponent(seed.id)}`);
        if (res.status !== 200) {
          bad.push(`${label} ${seed.id}: HTTP ${res.status}`);
          continue;
        }
        const body = await res.json();
        const light = expandAll(seed);
        const dark = expandAll(seed, undefined, { mode: "dark" });
        const byId = new Map((body.structures ?? []).map((st) => [st.id, st]));
        const shape = (list) =>
          Array.isArray(list) ? list.map((c) => `${c.role}:${c.hex}`).join(",") : `(배열아님 ${typeof list})`;

        for (let i = 0; i < light.length; i += 1) {
          const id = light[i].id;
          const got = byId.get(id);
          if (!got) {
            bad.push(`${label}/${id}: 응답에 없다`);
            continue;
          }
          checked += 1;

          const wantLight = shape(light[i].colors);
          const wantDark = shape(dark[i].colors);
          const gotLight = shape(got.colors);
          const gotDark = shape(got.colorsDark);

          if (gotLight !== wantLight) bad.push(`${label}/${id} colors 회귀: ${gotLight} != ${wantLight}`);
          if (gotDark !== wantDark) bad.push(`${label}/${id} colorsDark 불일치: ${gotDark} != ${wantDark}`);
          if (gotLight !== gotDark) differing += 1;
          if (wantLight !== wantDark) expectedDiffering += 1;
        }
      }
    });

    if (bad.length) throw new Error(bad.slice(0, 6).join(" / ") + (bad.length > 6 ? ` … 총 ${bad.length}건` : ""));
    if (checked !== seeds.length * 8) {
      throw new Error(`대조한 장 수가 ${checked} — 씨앗 ${seeds.length} × 구조 8 = ${seeds.length * 8} 이어야 한다`);
    }
    if (differing !== expectedDiffering) {
      throw new Error(`응답에서 두 모드가 다른 장 ${differing} — 엔진 기준 ${expectedDiffering}`);
    }
    // 앵커가 통째로 무너져 엔진마저 두 모드가 같아진 경우를 여기서 한 번 더 문다.
    if (differing === 0) throw new Error("두 모드가 한 장도 다르지 않다 — 어두운 모드가 없는 것과 같다");

    out(`씨앗 ${seeds.length} × 구조 8 = ${checked}장 · colors 회귀 0 · colorsDark 가 엔진 어두운 모드와 일치 · 두 모드가 다른 장 ${differing}/${checked}`);
    out("S15_G10_OK");
  },

  /**
   * **`mode` 를 서버 파라미터로 만들지 않는다.** 만드는 순간 토글이 `/api/expand` 재요청을 부를
   * 경로가 생기고, `q` 가 붙어 있으면 그 요청이 **LLM 재선택을 다시 돌린다** — 같은 질의인데
   * 토글 한 번에 보이는 다섯이 바뀐다. 게다가 매번 ~500ms 다.
   *
   * **양성 대조가 이 게이트의 절반이다.** "쿼리를 붙여도 응답이 같다" 는 비교하는 코드가 죽어
   * 있어도 통과한다. 그래서 **실제로 응답을 바꾸는 파라미터(`seed`)** 를 같은 비교에 넣어 그쪽은
   * 반드시 달라지는 것을 확인한다.
   *
   * `q` 는 안 붙인다 — 붙이면 LLM 이 끼어 응답이 요청마다 달라져 비교 자체가 성립하지 않는다.
   */
  "S15-G11": async () => {
    const corpus = palettes()[0];
    const other = palettes()[1];
    if (!other) throw new Error("팔레트가 하나뿐이라 양성 대조를 만들 수 없다");

    const bad = [];
    await withServer(4931, async (get) => {
      const body = async (qs) => {
        const res = await get(`/api/expand?${qs}`);
        if (res.status !== 200) throw new Error(`HTTP ${res.status} — ${qs}`);
        return JSON.stringify(await res.json());
      };

      const base = await body(`seed=${encodeURIComponent(corpus.id)}`);
      for (const extra of ["mode=dark", "mode=light", "mode=", "mode=%EA%B9%80", "mode=dark&mode=light"]) {
        const got = await body(`seed=${encodeURIComponent(corpus.id)}&${extra}`);
        if (got !== base) bad.push(`${extra} 를 붙였더니 응답이 달라졌다 — mode 가 서버에 닿는다`);
      }

      // 양성 대조: 응답을 실제로 바꾸는 파라미터는 반드시 달라져야 한다.
      const changed = await body(`seed=${encodeURIComponent(other.id)}`);
      if (changed === base) bad.push("씨앗을 바꿨는데 응답이 같다 — 이 비교가 아무것도 검사하지 않는다");
    });

    // 정적 대조: 응답이 같아도 handleExpand 가 mode 를 읽고 있으면 다음 사람이 그것을 쓰게 된다.
    const server = stripComments(read("server.js"));
    const from = server.indexOf("async function handleExpand");
    if (from < 0) throw new Error("server.js 에서 handleExpand 를 못 찾았다 — 이 검사가 공허하다");
    const to = server.indexOf("function dispatch", from);
    const head = server.slice(from, to > 0 ? to : undefined);
    if (/params\.get\(\s*['"`]mode['"`]\s*\)/.test(head)) bad.push("handleExpand 가 mode 파라미터를 읽는다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("mode=dark|light|빈값|한글|중복 다섯 가지가 응답을 바꾸지 않는다 · 양성 대조(seed 변경) 통과 · handleExpand 가 mode 를 안 읽는다");
    out("S15_G11_OK");
  },

  /**
   * **어두운 색이 화면에 나가는 순간 라벨이 안 읽히면 기능이 아니라 결함이다.**
   * `S13-G6` 과 같은 기준·같은 음성 대조를 쓰되 어두운 모드 파생색을 본다 — 지금 S13-G6 은
   * 밝은 모드만 본다.
   *
   * 음성 대조가 없으면 이 게이트는 아무것도 검사하지 않는다. `labelColor` 는 후보에 흰색과
   * 순검정을 함께 들고 있어 어떤 배경에서도 최소 4.58 을 낸다 — S13-G6 주석이 같은 이유로
   * 같은 말을 한다. 고정 회색 라벨이 **실제로 실패하는 것**을 함께 확인한다.
   */
  "S15-G12": async () => {
    const NAIVE = "#888888";
    let worst = { c: 99 };
    let fellBack = 0;
    let count = 0;
    let naiveFails = 0;

    for (const seed of allSeeds()) {
      for (const st of expandAll(seed, undefined, { mode: "dark" })) {
        for (const c of st.colors) {
          count += 1;
          const ratio = contrast(labelColor(c.hex), c.hex);
          if (ratio < worst.c) worst = { c: ratio, where: `${seed.id}/${st.id}/${c.role} ${c.hex}` };
          if (ratio < 4.5) fellBack += 1;
          if (contrast(NAIVE, c.hex) < 4.5) naiveFails += 1;
        }
      }
    }

    if (fellBack) {
      throw new Error(`어두운 모드에서 labelColor 가 4.5 를 못 넘겨 물러선 색 ${fellBack}개 — 최악 ${worst.c.toFixed(2)} ${worst.where}`);
    }
    if (naiveFails === 0) {
      throw new Error("고정 회색 라벨조차 어두운 모드 파생색 전부에서 4.5 를 넘는다 — 대비 계산이 죽었다");
    }

    out(`어두운 모드 파생색 ${count}개 · 대비 최솟값 ${worst.c.toFixed(2)} — ${worst.where}`);
    out(`음성 대조: 고정 라벨 ${NAIVE} 였다면 ${naiveFails}개가 4.5 미만`);
    out("S15_G12_OK");
  },

  /**
   * **토글은 이미 받아 둔 데이터로만 다시 그린다** — 네트워크 0, LLM 재호출 0.
   * S15-G11 이 서버 쪽(파라미터가 없다)을 막고 이 게이트가 화면 쪽(다시 부르지 않는다)을 막는다.
   * 둘 중 하나만 있으면 `mode` 를 쿼리에 안 붙이면서 그냥 재요청하는 구현이 통과한다.
   *
   * **정적 검사다** — 회귀 스모크지 동작 증명이 아니다. S13-G7 이 같은 이유로 같은 말을 한다.
   * 표기가 다른 동등 구현(`fetch` 직접 호출)은 잡지만 우회로 전부를 막지는 못한다.
   * 실제 동작은 브라우저에서 따로 본다.
   */
  "S15-G13": async () => {
    const bad = [];
    const app = stripComments(read("public/app.js"));
    const css = read("public/app.css");

    const between = (src, from, to, what) => {
      const a = src.indexOf(from);
      if (a < 0) throw new Error(`${what} 를 못 찾았다 — 이 검사가 공허하다`);
      const b = src.indexOf(to, a + from.length);
      return src.slice(a, b > 0 ? b : undefined);
    };

    /*
     * ① 모드에 따라 어느 색을 그리는지는 **불러서** 확인한다.
     *
     * 처음엔 이것도 정적 검사였고, 뮤테이션이 뚫었다 — `mode === "dark"` 를 `"light"` 로
     * 뒤바꾼 변형(토글이 정반대로 도는 결함)이 게이트 아홉을 **전부** 통과했다. 그래서 색 고르기를
     * `structureColors` 로 빼내 여기서 직접 호출한다. DOM 이 필요한 카드 조립만 정적으로 남는다.
     */
    const A = [{ role: "바탕", hex: "#ffffff" }];
    const B = [{ role: "바탕", hex: "#111111" }];
    const cases = [
      ["dark", { colors: A, colorsDark: B }, B, "dark 는 colorsDark 를 준다"],
      ["light", { colors: A, colorsDark: B }, A, "light 는 colors 를 준다"],
      [undefined, { colors: A, colorsDark: B }, A, "모드를 안 주면 밝은 쪽이 기본"],
      ["dark", { colors: A }, A, "colorsDark 가 없으면 colors 로 물러선다"],
      ["dark", { colors: A, colorsDark: null }, A, "colorsDark 가 null 이어도 물러선다"],
    ];
    for (const [mode, st, want, what] of cases) {
      const got = structureColors(st, mode);
      if (got !== want) bad.push(`${what} — 아니다 (${JSON.stringify(got)})`);
    }

    // ② 카드 조립이 그 함수를 실제로 쓰고, 모드를 인자로 받는다. 여기는 DOM 이 필요해 정적이다.
    const ui = stripComments(read("public/ui.js"));
    const cardBody = between(ui, "export function structureCard", "export function paletteCard", "structureCard");
    if (!/function structureCard\(\s*structure\s*,\s*mode/.test(cardBody)) {
      bad.push("structureCard 가 mode 를 인자로 안 받는다");
    }
    if (!/=\s*structureColors\(\s*structure\s*,\s*mode\s*\)/.test(cardBody)) {
      bad.push("structureCard 가 structureColors(structure, mode) 의 반환을 안 받는다 — ①의 검사가 화면에 안 닿는다");
    }
    /*
     * **카드가 색에 닿는 경로는 `structureColors` 하나뿐이다.**
     *
     * 처음엔 호출이 있는지만 봤고, 리뷰가 그것으로 뚫었다 — `structureColors(structure, mode);`
     * 로 부르기만 하고 반환을 버린 뒤 `const colors = structure.colors;` 를 쓰면 **토글을 눌러도
     * 화면이 전혀 안 바뀌는데** 게이트 넷이 전부 조용했다(재현 확인).
     *
     * 반환을 받는지(위 줄)만 조이면 표기를 바꿔 또 빠져나간다. 그래서 **우회로 자체를 막는다** —
     * 카드 본문에 `structure.colors` 가 나오면 실패다. 헬퍼 밖에서 씨앗 색에 직접 닿을 이유가 없다.
     */
    const bypass = cardBody.match(/structure\.colors\b/g);
    if (bypass) {
      bad.push(`structureCard 가 structure.colors 에 직접 닿는다 ${bypass.length}곳 — 색은 structureColors 로만 가져온다`);
    }

    // ③ 펼침 영역에 모드 상태가 있고, 토글 구간이 네트워크를 다시 부르지 않는다.
    const secBody = between(app, "function expansionSection", "function renderStatus", "expansionSection");
    if (!/let\s+mode\s*=/.test(secBody)) bad.push("펼침 영역에 mode 상태가 없다 (재대입 가능해야 한다)");

    const modeArea = between(secBody, "expand__mode", "expand__more", "모드 토글 구간");
    if (/\bapi\s*\(/.test(modeArea) || /\bfetch\s*\(/.test(modeArea)) {
      bad.push("모드 토글이 네트워크를 다시 부른다 — 이미 받아 둔 데이터로만 그려야 한다");
    }

    /*
     * ④ 화면이 쓰는 `expand__mode*` 클래스가 **전부** 스타일시트에 있다.
     *
     * 처음엔 `.expand__mode` 규칙이 CSS 에 있는지만 봤고, 뮤테이션이 뚫었다 — JS 쪽 컨테이너
     * 클래스만 딴 이름으로 바꿔도 버튼 문자열(`expand__mode-toggle`)이 부분 문자열로 걸려
     * 통과했고, CSS 규칙은 아무도 안 쓰는 채로 남았다. **양쪽 목록을 대조한다.**
     */
    const used = [...new Set((app.match(/expand__mode[\w-]*/g) ?? []))];
    if (used.length < 2) bad.push(`모드 토글 클래스가 ${used.length}개뿐이다 — 컨테이너와 버튼 둘이어야 한다`);
    const missing = used.filter((cls) => !new RegExp(`\\.${cls}(?![\\w-])`).test(css));
    if (missing.length) bad.push(`화면이 쓰는데 스타일시트에 없는 클래스: ${missing.join(", ")}`);

    if (bad.length) throw new Error(bad.join(" / "));
    out(`structureColors 동작 ${cases.length}가지 일치 · structureCard 가 그 반환을 받고 structure.colors 에 직접 안 닿음 · mode 상태 · 토글 구간에 api(/fetch( 없음`);
    out(`클래스 대조: ${used.join(" · ")} 가 전부 app.css 에 있다`);
    out("S15_G13_OK");
  },

  /**
   * **요청 핸들러가 카탈로그를 다시 읽지 않는다.**
   *
   * `expandAll(palette, catalog = loadStructures(), options)` 라 **두 번째 인자를 생략하면
   * 요청마다 readFileSync + JSON.parse 가 돈다.** 어두운 모드를 붙이며 호출이 둘이 되면서 그
   * 동기 I/O 가 요청당 2회로 늘었고, 리뷰가 잡았다. `server.js` 는 바로 그 위에서 "구조 카탈로그는
   * 기동 시 한 번만 읽는다" 고 적어 두고 있었는데 새 코드가 그 캐시를 안 썼다.
   *
   * **이름을 고정하지 않는다.** `fullCatalog` 라는 특정 식별자를 요구하면 이름만 바꿔도 실패한다.
   * 무는 것은 구조다 — `handleExpand` 안의 모든 `expandAll(` 호출이 **두 번째 인자를 갖고, 그것이
   * `undefined` 가 아니다.**
   *
   * 정적 검사다. 실행 시점 읽기 횟수는 못 센다 — 프로세스 밖에서 `readFileSync` 를 셀 방법이
   * 없기 때문이다. 다른 경로로 파일을 다시 읽는 구현은 못 잡는다.
   */
  "S15-G14": async () => {
    const server = stripComments(read("server.js"));
    const from = server.indexOf("async function handleExpand");
    if (from < 0) throw new Error("server.js 에서 handleExpand 를 못 찾았다 — 이 검사가 공허하다");
    const to = server.indexOf("function dispatch", from);
    const body = server.slice(from, to > 0 ? to : undefined);

    // `expandAll(` 부터 짝이 맞는 닫는 괄호까지를 걸어서 읽는다. 정규식으로는 중첩 인자를 못 가른다.
    const calls = [];
    for (let i = body.indexOf("expandAll("); i >= 0; i = body.indexOf("expandAll(", i + 1)) {
      let depth = 0;
      let j = i + "expandAll".length;
      for (; j < body.length; j += 1) {
        if (body[j] === "(") depth += 1;
        else if (body[j] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      calls.push(body.slice(i + "expandAll(".length, j));
    }

    if (calls.length === 0) throw new Error("handleExpand 에 expandAll 호출이 없다 — 이 검사가 공허하다");

    // 최상위 쉼표로만 인자를 가른다. 중첩 괄호·중괄호 안의 쉼표는 인자 경계가 아니다.
    const argsOf = (src) => {
      const out = [];
      let depth = 0;
      let cur = "";
      for (const ch of src) {
        if ("([{".includes(ch)) depth += 1;
        else if (")]}".includes(ch)) depth -= 1;
        if (ch === "," && depth === 0) {
          out.push(cur.trim());
          cur = "";
          continue;
        }
        cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    };

    const bad = [];
    for (const call of calls) {
      const args = argsOf(call);
      if (args.length < 2) bad.push(`expandAll(${call}) — 카탈로그 인자가 없다 (요청마다 파일을 다시 읽는다)`);
      else if (args[1] === "undefined" || args[1] === "") {
        bad.push(`expandAll(${call}) — 카탈로그 자리가 ${args[1] || "빈칸"} 이다 (기본값이 loadStructures() 를 부른다)`);
      }
    }
    if (bad.length) throw new Error(bad.join(" / "));

    out(`handleExpand 의 expandAll 호출 ${calls.length}개가 전부 카탈로그를 넘겨받는다 — ${calls.map((c) => argsOf(c)[1]).join(" · ")}`);
    out("S15_G14_OK");
  },

  /**
   * **모드 토글이 포커스를 자기에게 확정한 뒤 다시 그린다.**
   *
   * `redraw` 가 격자를 통째로 갈아서, 카드 안 비율 슬라이더에 포커스가 있었다면 그 요소가 DOM 에서
   * 사라지고 **포커스가 body 로 떨어진다**(브라우저 실측). Chrome·Firefox 는 버튼 클릭이 포커스를
   * 옮겨 주지만 **Safari(WebKit)는 마우스 클릭으로 button 에 포커스를 주지 않는다** — 그 경로가
   * 실제로 열려 있고, 스크린리더에게는 포커스가 조용히 사라지는 것으로 보인다(리뷰 지적).
   *
   * 정적 검사다. **순서까지 본다** — `focus()` 가 `redraw` 뒤에 있으면 이미 지워진 뒤라 늦다.
   */
  "S15-G15": async () => {
    const app = stripComments(read("public/app.js"));
    const from = app.indexOf("function expansionSection");
    if (from < 0) throw new Error("expansionSection 을 못 찾았다 — 이 검사가 공허하다");
    const to = app.indexOf("function renderStatus", from);
    const sec = app.slice(from, to > 0 ? to : undefined);

    const start = sec.indexOf("expand__mode");
    const stop = sec.indexOf("expand__more", start);
    if (start < 0) throw new Error("모드 토글 구간을 못 찾았다 — 이 검사가 공허하다");
    const area = sec.slice(start, stop > 0 ? stop : undefined);

    const focusAt = area.search(/\.focus\(\s*\)/);
    const redrawAt = area.search(/redraw\s*\?\.\s*\(\s*\)|redraw\s*\(\s*\)/);
    if (focusAt < 0) throw new Error("모드 토글이 포커스를 확정하지 않는다 — Safari 에서 포커스가 body 로 떨어진다");
    if (redrawAt < 0) throw new Error("모드 토글 구간에 redraw 호출이 없다 — 이 검사가 공허하다");
    if (focusAt > redrawAt) throw new Error("focus() 가 redraw 뒤에 있다 — 격자가 이미 갈린 뒤라 늦다");

    out("모드 토글이 redraw 전에 포커스를 자기에게 확정한다");
    out("S15_G15_OK");
  },
};

const id = process.argv[2];
const gate = Object.hasOwn(GATES, String(id)) ? GATES[id] : null;
if (!gate) {
  out(`쓰는 법: node scripts/check-stage15.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(2);
}

try {
  await gate();
} catch (err) {
  out(`${id} 실패: ${err.message}`);
  process.exit(1);
}
