#!/usr/bin/env node
// 24단계(구조가 약속한 대비를 지킨다) · C1 완료 조건 검사기.
//   node scripts/check-stage24.mjs S24-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** `S24-G1` 이 실패하는 것을 확인한 뒤에 고쳤다.
//
// ── 작업 목록의 C1 진술은 틀렸다 ─────────────────────────────
//
// 거기 이렇게 적혀 있었다: *"파생색끼리의 대비를 안 본다. 밝은 243건 · 어두운 169건이
// 바탕 대비 3:1 미만이다. 잘 안 보이는 배색이 나가고 있다."*
//
// **일괄 기준을 세우면 배색사전의 기법을 지운다.** `tone-in-tone` 의 정의가
// *"명도·채도를 고정하고 색상만 가로로 움직인다"* 인데, 대비 비율은 **명도 비율**이라
// 그 기법은 **정의상 1:1 근처**가 나온다(실측 중앙값 1.30). 낮은 것이 그 기법이다.
//
// ── 그래서 구조를 셋으로 나눈다 ──────────────────────────────
//
//   ① 명도로 가른다고 말한 구조   → 본문이 바탕 위에서 읽혀야 한다        (S24-G1·G2)
//   ② 명도를 고정한다고 말한 구조 → 요구하지 않는다. 요구하면 기법이 사라진다 (S24-G3)
//   ③ 아무 말도 안 한 구조        → 요구도 금지도 안 한다
//
// **분류는 카탈로그의 `principle` 에서 읽지만 실측이 교정한다.** `aerial` 을 ②로 넣었다가
// `S24-G3` 이 잡았다 — 원리가 *"먼 쪽은 대비·채도를 낮추고"* 라 평평한 줄 알았는데
// 중앙값 4.75 로 가르고 있었다. 그것은 **층끼리의 상대 순서**를 말하는 것이었다.
//
// **①은 이미 `S11-G7` 이 `TIERED` 로 같은 분류를 하고 있다.** 그 게이트는 인접 단계의
// **명도차 0.15** 를 요구하는데, 그것은 *"덩어리로 안 읽힌다"* 는 기준이지 *"글자가 읽힌다"*
// 는 기준이 아니다 — 그래서 이 단계가 생겼다.
//
//   value-scale   바탕·면·본문  → 바탕과 본문이 **두 단계** 떨어져 0.30 이상 → 4.71:1  ✓
//   tone-on-tone  바탕·본문     → **인접**이라 0.15 만 넘으면 통과      → 1.58:1  ✗
//
// 실측: `tone-on-tone` 의 본문이 **80건 중 62건**에서 4.5:1 미만이었다(씨앗 40 × 모드 2).
// `value-scale` 은 0건.
// **둘 다 같은 것을 약속했는데 하나만 지킨다** — 대조군이 있으니 "원래 그런 것" 이 아니다.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandSeed, hexToHsl, loadStructures } from "../src/expand.js";
import { loadSeeds } from "../src/seeds.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **분류와 문턱을 여기 다시 적는다.** 감시할 대상에서 가져오면 그것을 바꾸는 순간 게이트가
 * 함께 느슨해진다. 이 저장소가 같은 부류로 다섯 번 뚫렸다.
 *
 * 분류의 근거는 `data/structures.json` 의 `principle` 이다 — 지어낸 것이 아니라
 * **카탈로그가 스스로 말한 것**이다. `S24-G4` 가 여덟 구조를 전부 덮는지 확인한다.
 */
const PROMISES = Object.freeze({
  // ① 명도로 가른다고 말했다 → 본문이 읽혀야 한다
  "tone-on-tone": "value", // "색상을 고정하고 명도·채도만 세로로 움직인다"
  "value-scale": "value", //  "색상 팔레트가 아니라 명도 스케일이 먼저다"

  // ② 명도를 고정한다고 말했다 → 요구하면 그 기법이 사라진다
  "tone-in-tone": "flat", //  "명도·채도를 고정하고 색상만 가로로 움직인다"

  /*
   * ③ 명도를 약속하지도 부정하지도 않았다 → 요구도 금지도 안 한다
   *
   * **`aerial` 은 처음에 ②로 넣었다가 게이트가 교정했다.** 원리가 *"먼 쪽은 대비·채도를
   * 낮추고"* 라고 해서 평평한 줄 알았는데, 실측 중앙값이 4.75 로 **가르고 있었다.**
   * 다시 읽으면 그것은 **층끼리의 순서**를 말한다 — 먼 쪽이 가까운 쪽보다 낮다는 것이지
   * 전부 평평하게 두라는 것이 아니다. 그 순서는 실제로 32/32 로 지켜진다(실측).
   *
   * **절대 문턱이 아니라 상대 순서라 이 게이트의 도구가 안 맞는다.** 여기서는 요구도
   * 금지도 하지 않고, 순서 검사는 열어 둔 것으로 적는다(`GATES.md` 의 알려진 한계).
   */
  aerial: "other", //         "먼 쪽은 대비·채도를 낮추고 한색으로" — 층끼리의 상대 순서
  complementary: "other", //  "색상환에서 180° 벌린다"
  analogous: "other", //      "색상환에서 인접한 각도만 벌린다"
  "accent-by-chroma": "other", // "나머지를 탁하게 눌러야 하나가 산다"
  "warm-neutral": "other", // "차갑게 보이면 따뜻한 뉴트럴을 놓는다"
});

/**
 * 글자가 읽히는 문턱 `[문헌]` — WCAG 2.2 의 일반 크기 글자 기준(1.4.3).
 * 눈에 띄어야 하는 것의 문턱 `[문헌]` — 글자 아닌 요소 기준(1.4.11).
 * 이 저장소가 스와치 글자색에 이미 4.5 를 쓴다(`S2-G5`·`S13-G6`).
 */
const TEXT_MIN = 4.5;
const MARK_MIN = 3;

/** WCAG 상대 휘도·대비. **여기서 다시 구현한다** — 감시할 대상을 가져오면 검사가 공허해진다. */
const relLuminance = (hex) => {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};
const ratio = (a, b) => {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * **실제로 펼쳐지는 씨앗 전부** — 코퍼스 16쌍 + 씨앗 풀 24쌍.
 *
 * 처음엔 코퍼스만 봤고 리뷰가 잡았다. 씨앗 풀은 `/api/expand` 로 **이미 나가고 있는데**
 * (`S12-G6`) 게이트 밖에 있었다 — 오늘은 우연히 안전하지만 앵커를 건드리면 풀 쪽에서만
 * 깨져도 조용하다. `check-stage15.mjs` 의 `allSeeds()` 와 같은 집합이다.
 *
 * **`loadSeeds` 는 파일이 깨지면 빈 배열로 물러선다.** 그러면 이 게이트가 조용히 코퍼스만
 * 보게 되므로, 두 출처가 각각 비지 않았는지 여기서 막는다.
 */
const seeds = () => {
  const corpus = JSON.parse(read("data/palettes.json")).palettes;
  const pool = loadSeeds();
  if (!corpus?.length) throw new Error("코퍼스가 비었다 — 이 게이트가 공허해진다");
  if (!pool?.length) throw new Error("씨앗 풀이 비었다 — loadSeeds 가 물러섰거나 data/seeds.json 이 깨졌다");
  return [...corpus, ...pool];
};
const MODES = ["light", "dark"];

/** 구조 하나를 씨앗 전부 × 모드 둘로 펼쳐, 바탕과 나머지의 대비를 잰다. */
function pairs(structureId, structures) {
  const rows = [];
  for (const seed of seeds()) {
    for (const mode of MODES) {
      const got = expandSeed(seed, structureId, structures, { mode });
      if (!got) continue;
      // 바탕은 늘 첫 색이다. 나머지가 그 위에 놓인다.
      const ground = got.colors[0];
      for (const c of got.colors.slice(1)) {
        rows.push({ seed: seed.id, mode, role: c.role, hex: c.hex, ground: ground.hex, ratio: ratio(c.hex, ground.hex) });
      }
    }
  }
  return rows;
}

const byPromise = (want) => Object.keys(PROMISES).filter((id) => PROMISES[id] === want);

const GATES = {
  /*
   * **명도로 가른다고 말한 구조는 본문이 바탕 위에서 읽혀야 한다.**
   *
   * `tone-on-tone` 의 설명이 *"바탕부터 본문까지 한 색으로 덮을 때 쓴다"* 이고,
   * `value-scale` 은 *"명·중·암을 확보하면 가독성 문제가 대부분 여기서 끝난다"* 이다.
   * **둘 다 글자를 올릴 자리라고 스스로 말한다.** 그러면 읽혀야 한다.
   *
   * `S11-G7` 이 이미 같은 두 구조를 골라 **인접 단계 명도차 0.15** 를 요구하지만,
   * 그것은 덩어리로 안 읽히는 기준이다. 3색 구조에서는 바탕과 본문이 인접이라
   * 0.15 만 넘으면 통과하고, 그때 대비가 1.58:1 까지 내려간다(실측).
   */
  "S24-G1": async () => {
    const structures = loadStructures();
    const bad = [];
    let worst = { ratio: Infinity };
    let checked = 0;

    for (const id of byPromise("value")) {
      for (const r of pairs(id, structures)) {
        if (r.role !== "본문") continue;
        checked += 1;
        if (r.ratio < worst.ratio) worst = { ...r, structure: id };
        if (r.ratio < TEXT_MIN) {
          bad.push(`${id}/${r.seed}/${r.mode} 본문 ${r.hex} 이 바탕 ${r.ground} 위에서 ${r.ratio.toFixed(2)}:1`);
        }
      }
    }
    if (checked === 0) {
      out("검사한 것이 0건이다 — 이 게이트가 공허하다");
      return false;
    }
    out(
      bad.length
        ? `${bad.length}/${checked}건이 ${TEXT_MIN}:1 미만\n` + bad.slice(0, 5).join("\n")
        : `명도를 약속한 구조 ${byPromise("value").length}개 × ${checked}건에서 본문이 ${TEXT_MIN}:1 이상 (최솟값 ${worst.ratio.toFixed(2)} — ${worst.structure}/${worst.seed}/${worst.mode})`,
    );
    return bad.length === 0;
  },

  /*
   * **강조도 바탕에서 보여야 한다.** 글자는 아니므로 문턱이 낮다(3:1).
   *
   * 지금은 통과한다 — `tone-on-tone` 이 강조를 `dark` 로 멀리 보내기 때문이다(실측 9.56 이상).
   * **본문을 고치면서 강조까지 흔들지 않았는지**를 보는 회귀 게이트다.
   */
  "S24-G2": async () => {
    const structures = loadStructures();
    const bad = [];
    let worst = { ratio: Infinity };
    let checked = 0;

    for (const id of byPromise("value")) {
      for (const r of pairs(id, structures)) {
        if (r.role !== "강조") continue;
        checked += 1;
        if (r.ratio < worst.ratio) worst = { ...r, structure: id };
        if (r.ratio < MARK_MIN) {
          bad.push(`${id}/${r.seed}/${r.mode} 강조 ${r.hex} 이 바탕 ${r.ground} 위에서 ${r.ratio.toFixed(2)}:1`);
        }
      }
    }
    if (checked === 0) {
      out("검사한 것이 0건이다 — 이 게이트가 공허하다");
      return false;
    }
    out(
      bad.length
        ? `${bad.length}/${checked}건이 ${MARK_MIN}:1 미만\n` + bad.slice(0, 5).join("\n")
        : `강조가 ${checked}건에서 ${MARK_MIN}:1 이상 (최솟값 ${worst.ratio.toFixed(2)} — ${worst.structure}/${worst.seed}/${worst.mode})`,
    );
    return bad.length === 0;
  },

  /*
   * **명도를 고정하거나 낮춘다고 말한 구조에는 그것을 요구하지 않는다. 음성 대조다.**
   *
   * 여기에 대비를 요구하면 **배색사전의 기법을 지운다.** `tone-in-tone` 은 명도를 고정하는
   * 것이 정의다 — 색상만 움직이므로 명도 비율인 대비는 1:1 근처에 머문다.
   *
   * 그래서 반대로 **실제로 낮은지**를 확인한다. 높아졌다면 그 기법이 아니게 된 것이고,
   * 그것도 결함이다 — 조용히 다른 배색이 되어 나간다.
   *
   * `S11-G6`("구조가 이름값을 한다")과 같은 부류의 검사이고, 대비 축에서 그것을 한다.
   */
  "S24-G3": async () => {
    const structures = loadStructures();
    const bad = [];
    const lines = [];

    for (const id of byPromise("flat")) {
      const rows = pairs(id, structures);
      if (rows.length === 0) {
        bad.push(`${id} 을 한 건도 못 펼쳤다`);
        continue;
      }
      const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      /*
       * **중앙값으로 본다.** 최솟값은 한 건만 낮아도 만족하고, 최댓값은 한 건만 높아도
       * 깨진다. "이 기법이 전반적으로 명도를 안 가르는가" 를 묻는 것이므로 중앙값이 맞다.
       *
       * 문턱 3:1 은 `MARK_MIN` 과 같은 값을 **반대 방향으로** 쓴 것이다 — 눈에 띄게
       * 가르는 수준에 이르렀다면 더 이상 "고정" 도 "낮춤" 도 아니다.
       */
      if (median >= MARK_MIN) {
        bad.push(`${id} 의 대비 중앙값이 ${median.toFixed(2)} — 명도를 안 가른다던 기법이 가르고 있다`);
      }
      lines.push(`    ${id.padEnd(14)} 중앙값 ${median.toFixed(2)} · 최소 ${ratios[0].toFixed(2)} · 최대 ${ratios[ratios.length - 1].toFixed(2)}`);
    }

    /*
     * **양성 대조.** 명도를 약속한 구조는 같은 자로 재면 훨씬 높아야 한다. 안 그러면
     * 이 검사가 "무엇이든 낮다" 를 말하는 것이 되어 공허하다.
     */
    for (const id of byPromise("value")) {
      const ratios = pairs(id, structures).map((r) => r.ratio).sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      if (median < MARK_MIN) bad.push(`양성 대조 실패 — ${id} 의 중앙값도 ${median.toFixed(2)} 다`);
    }

    out(bad.length ? bad.slice(0, 5).join("\n") : "명도를 고정·낮춘다고 한 구조는 실제로 안 가른다 (요구하지 않는다)\n" + lines.join("\n"));
    return bad.length === 0;
  },

  /*
   * **분류가 구조 전부를 덮는다.**
   *
   * 새 구조가 생겼는데 분류표에 없으면 **아무 검사도 안 받는다** — 조용히 빠지는 것이
   * 이 저장소가 여러 번 겪은 부류다(`S18-G13` 의 형식 목록이 같은 이유로 손으로 적혀 있다).
   *
   * **`S11-G7` 의 `TIERED` 와도 맞춰 본다.** 같은 분류를 두 게이트가 따로 적고 있으므로,
   * 한쪽만 고치면 두 게이트가 다른 것을 지키게 된다.
   */
  "S24-G4": async () => {
    const bad = [];
    const structures = loadStructures();
    const known = Object.keys(PROMISES).sort();
    const actual = structures.map((s) => s.id).sort();

    if (String(known) !== String(actual)) {
      bad.push(`분류표가 아는 것 [${known}]\n실제 카탈로그 [${actual}]\n둘이 다르다 — 새 구조는 어느 갈래인지 정해야 검사를 받는다`);
    }
    for (const [id, kind] of Object.entries(PROMISES)) {
      if (!["value", "flat", "other"].includes(kind)) bad.push(`${id} 의 갈래가 ${kind}`);
    }
    /*
     * **`value` 와 `flat` 만 0개를 막고 `other` 는 안 막는다. 일부러 다르다.**
     *
     * 앞의 둘이 비면 `S24-G1`·`S24-G3` 이 아무것도 안 재면서 통과한다 — 게이트가 공허해지는
     * 자리라 막는다. `other` 는 **요구도 금지도 안 하는 갈래**라 비어도 검사가 줄지 않는다.
     * 오히려 언젠가 0개가 되는 것이 정상이다(모든 구조가 무엇을 약속하는지 정해졌다는 뜻).
     */
    if (byPromise("value").length === 0) bad.push("명도를 약속한 구조가 0개다 — S24-G1 이 공허해진다");
    if (byPromise("flat").length === 0) bad.push("명도를 고정한다는 구조가 0개다 — S24-G3 이 공허해진다");

    /*
     * `S11-G7` 은 같은 분류를 `TIERED` 라는 이름으로 갖고 있다. **거기서 값을 가져오지 않고**
     * 소스에서 읽어 대조만 한다 — 가져오면 그쪽이 바뀔 때 이 검사가 함께 느슨해진다.
     *
     * **글자로 읽는 것이 약한 자리인 것은 맞다.** 저쪽이 여러 줄로 바뀌거나 이름이 바뀌면
     * 정규식이 빗나간다. 다만 빗나가면 **조용해지지 않고 실패한다** — 못 찾으면 아래에서
     * 바로 지적을 쌓고, 빈 목록으로 읽히면 이쪽 목록과 달라서 또 지적이 쌓인다.
     */
    const s11 = read("scripts/check-stage11.mjs");
    const m = s11.match(/const TIERED = \[([^\]]*)\]/);
    if (!m) bad.push("check-stage11.mjs 에서 TIERED 를 못 찾았다 — 이 대조가 공허하다");
    else {
      const tiered = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
      const mine = byPromise("value").sort();
      if (String(tiered) !== String(mine)) {
        bad.push(`S11-G7 의 TIERED [${tiered}] 와 이 분류 [${mine}] 가 다르다 — 두 게이트가 다른 것을 지킨다`);
      }
    }

    out(bad.length ? bad.slice(0, 5).join("\n") : `구조 ${actual.length}개가 세 갈래에 전부 들어 있고 S11-G7 의 분류와 같다 (명도 ${byPromise("value").length} · 고정 ${byPromise("flat").length} · 그 밖 ${byPromise("other").length})`);
    return bad.length === 0;
  },

  /*
   * **대비 계산이 맞는가.**
   *
   * 위 게이트들이 전부 이 계산에 기대므로, 그것이 틀리면 넷 다 조용히 거짓이 된다.
   * `public/color.js` 의 구현과 **여기 다시 쓴 구현**을 알려진 값으로 함께 대조한다 —
   * 둘이 같은 방식으로 틀렸을 가능성을 문헌 값이 막는다.
   */
  "S24-G5": async () => {
    const bad = [];
    const { contrast } = await import("../public/color.js");

    /*
     * WCAG 2.2 가 정의하는 값 `[문헌]`. 흑백은 정확히 21, 같은 색은 1.
     * 나머지는 공식에서 바로 나오는 값이라 손으로 계산해 적었다.
     */
    const cases = [
      ["#000000", "#ffffff", 21],
      ["#ffffff", "#ffffff", 1],
      ["#000000", "#000000", 1],
      ["#767676", "#ffffff", 4.54], // WCAG 문서가 예로 드는 회색 — AA 경계
      ["#ff0000", "#ffffff", 3.998],
      ["#0000ff", "#ffffff", 8.592],
    ];
    for (const [a, b, want] of cases) {
      const mine = ratio(a, b);
      const theirs = contrast(a, b);
      if (Math.abs(mine - want) > 0.01) bad.push(`게이트 계산: ${a}↔${b} 가 ${mine.toFixed(3)} (${want} 이어야 한다)`);
      if (Math.abs(theirs - want) > 0.01) bad.push(`color.js: ${a}↔${b} 가 ${theirs.toFixed(3)} (${want} 이어야 한다)`);
    }

    // 순서를 바꿔도 같아야 한다. 밝은 쪽을 먼저 놓는 정렬이 빠지면 1 미만이 나온다.
    for (const [a, b] of cases) {
      if (Math.abs(ratio(a, b) - ratio(b, a)) > 1e-9) bad.push(`${a}↔${b} 가 순서에 따라 다르다`);
      if (Math.abs(contrast(a, b) - contrast(b, a)) > 1e-9) bad.push(`color.js 가 ${a}↔${b} 에서 순서를 탄다`);
    }

    // 실제 파생색에서도 두 구현이 일치한다. 문헌 값만 보면 경로가 좁다.
    const structures = loadStructures();
    let compared = 0;
    for (const id of Object.keys(PROMISES)) {
      for (const r of pairs(id, structures)) {
        compared += 1;
        if (Math.abs(ratio(r.hex, r.ground) - contrast(r.hex, r.ground)) > 1e-9) {
          bad.push(`${id}: ${r.hex}↔${r.ground} 에서 두 구현이 갈린다`);
        }
      }
    }
    if (compared < 100) bad.push(`대조한 파생색이 ${compared}건뿐이다 — 이 검사가 얕다`);

    out(bad.length ? bad.slice(0, 5).join("\n") : `문헌 값 ${cases.length}가지와 파생색 ${compared}건에서 두 구현이 일치한다 (순서 무관)`);
    return bad.length === 0;
  },

  /*
   * **기준선을 깬 것이 기록과 맞는가.**
   *
   * `scripts/fixtures/expand-baseline.json` 은 스스로 이렇게 경고한다 —
   * *"게이트가 실패할 때 이 파일을 다시 만들면 게이트가 아무것도 검사하지 않게 된다."*
   *
   * 24단계는 그 파일을 **일부러** 바꿨다. 그래서 통째로 다시 만들지 않고 **바뀐 줄만 갈고
   * 옛 값을 `_revisions` 에 남겼다.** 이 게이트가 그 기록이 정직한지 본다:
   *
   *   1. 기록한 구조는 **실제로** 옛 값과 다르다 (안 바꿔 놓고 바꿨다고 적지 않았는가)
   *   2. 기록에 없는 구조는 옛 값 그대로다 — 즉 **범위를 넘어 바꾸지 않았는가**
   *   3. 기록에 이유와 범위가 적혀 있다
   *
   * **2번이 이 게이트의 값이다.** "이것만 바꿨다" 는 말을 기계가 확인한다.
   */
  "S24-G6": async () => {
    const bad = [];
    const fixture = JSON.parse(read("scripts/fixtures/expand-baseline.json"));
    const revisions = fixture._revisions ?? [];
    if (revisions.length === 0) {
      out("_revisions 가 비었다 — 기준선을 바꿨다면 무엇을 왜 바꿨는지 남아야 한다");
      return false;
    }

    const structures = loadStructures();
    /*
     * **위 게이트들과 같은 씨앗 집합을 쓴다.** 여기서만 `data/seeds.json` 을 직접 읽었더니
     * `loadSeeds` 의 스키마 검사를 우회해서, 규격 밖 씨앗이 들어오면 `S24-G1`~`G5` 는
     * 안 보고 `S24-G6` 만 보는 상태가 됐다. 지금은 둘 다 24개로 같지만(실측) 두 게이트가
     * "같은 씨앗 40개" 라고 서로 다른 것을 가리키게 되는 자리라 하나로 모은다.
     */
    const seedList = seeds();
    const revised = new Set(revisions.map((r) => r.structure));

    for (const rev of revisions) {
      for (const field of ["stage", "date", "structure", "why", "scope", "before"]) {
        if (!rev[field]) bad.push(`revision(${rev.structure ?? "?"})에 ${field} 가 없다`);
      }
      if (!rev.before) continue;

      // ① 기록한 것이 실제로 달라졌는가.
      let same = 0;
      for (const [seedId, then] of Object.entries(rev.before)) {
        const seed = seedList.find((x) => x.id === seedId);
        if (!seed) {
          bad.push(`기록에 있는 씨앗 ${seedId} 가 실재하지 않는다`);
          continue;
        }
        const got = expandSeed(seed, rev.structure, structures);
        if (!got) {
          bad.push(`${seedId}/${rev.structure} 을 못 펼쳤다`);
          continue;
        }
        const now = got.colors.map((c) => `${c.role} ${c.hex}`);
        if (now.join("|") === then.join("|")) same += 1;
      }
      if (same > 0) bad.push(`${rev.structure}: 바꿨다고 기록한 ${same}건이 옛 값과 같다 — 기록이 부풀려졌다`);

      /*
       * **색상이 보존됐는가.** 이 수정은 명도와 채도만 건드린다 — 씨앗의 색을 잃지 않는 것이
       * 이 저장소의 규칙이다(`S11-G4`·`S11-G6`).
       *
       * 이 검사가 **기록이 엉뚱한 구조를 가리키는 것도 잡는다.** 처음엔 "옛 값과 다르기만
       * 하면 통과" 였는데, 그러면 안 바꾼 구조 이름을 적어도 다르니까 통과했다(변형으로 확인).
       * 색상까지 보면 다른 구조의 옛 값을 갖다 붙일 수 없다 — 구조마다 색상을 다르게 돌린다.
       */
      for (const [seedId, then] of Object.entries(rev.before)) {
        const seed = seedList.find((x) => x.id === seedId);
        const got = seed && expandSeed(seed, rev.structure, structures);
        if (!got) continue;
        for (const [i, line] of then.entries()) {
          const oldHex = String(line).match(/#[0-9a-fA-F]{6}/)?.[0];
          const nowHex = got.colors[i]?.hex;
          if (!oldHex || !nowHex) {
            bad.push(`${seedId}/${rev.structure}: 기록의 ${i + 1}번째 색을 못 읽었다 (${line})`);
            continue;
          }
          const a = hexToHsl(oldHex);
          const b = hexToHsl(nowHex);
          // 거의 무채색이면 색상각이 흔들린다. 채도가 있는 것만 본다.
          if (a.s < 0.08 || b.s < 0.08) continue;
          const gap = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
          if (gap > 6) {
            bad.push(`${seedId}/${rev.structure}: ${got.colors[i].role} 의 색상이 ${Math.round(a.h)}° → ${Math.round(b.h)}° 로 옮겼다 — 명도·채도만 건드린 것이 아니다`);
          }
        }
      }

      if (Object.keys(rev.before).length !== rev.changed) {
        bad.push(`${rev.structure}: changed 가 ${rev.changed} 인데 before 는 ${Object.keys(rev.before).length}개다`);
      }
    }

    /*
     * ② **기록에 없는 것은 안 바뀌었어야 한다 — 이것이 이 게이트의 값이다.**
     *
     * **처음 쓴 것은 죽은 코드였다.** 검사할 집합을 `revisions` 에서 만들고 같은
     * `revisions` 를 훑었으니 조건이 언제나 참이었다. 리뷰어 둘이 각자 다른 구조의 앵커를
     * 바꿔 기준선을 다시 만들고도 이 게이트가 통과하는 것을 재현했다.
     *
     * **자기 자신만 보고는 원리적으로 못 잡는다.** 지금 파일 안에는 '안 바꾼 구조의 옛 값'
     * 이 없다. 통째로 다시 만들면 기록도 함께 다시 쓸 수 있으니, 무엇을 넣어도 자기참조다.
     * **바깥의 고정점이 하나 필요하고, 이 저장소에 있는 것은 git 이력뿐이다.**
     *
     * 그래서 기록마다 `baseSha` 를 적는다 — **그 수정이 고친 대상 커밋**이다. 여기서
     * 그 커밋의 기준선을 꺼내 지금 파일과 칸 단위로 대조하고, **달라진 칸이 전부 기록에
     * 적힌 것인지** 본다. 기록 없이 갈아 버리면 안 적힌 칸이 남아서 걸린다.
     *
     * 커밋한 뒤에도 살아 있다. `baseSha` 는 고정된 값이라 HEAD 가 움직여도 같은 것을 가리킨다.
     */
    const gitShow = (sha) => {
      const r = spawnSync("git", ["show", `${sha}:scripts/fixtures/expand-baseline.json`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (r.status !== 0) return { err: (r.stderr || r.error?.message || "git 실패").trim().split("\n")[0] };
      try {
        return { json: JSON.parse(r.stdout) };
      } catch (e) {
        return { err: `${sha} 의 기준선이 JSON 이 아니다 (${e.message})` };
      }
    };

    /**
     * **고정점은 감시 대상에서 읽지 않는다 — git 에게 직접 묻는다.**
     *
     * 처음엔 `_revisions[0].baseSha` 를 고정점으로 썼고 2차 리뷰가 그것으로 뚫었다:
     * 몰래 재생성한 커밋을 먼저 만들고, 그 위에 정당한 수정을 올린 뒤, `baseSha` 를
     * **자기가 만든 그 커밋**으로 가리키면 둘 사이의 차이가 0 이라 조용히 통과했다.
     * **검사할 기준점을 검사 대상이 고르게 두면 안 된다** — 이 저장소가 게이트마다 지키는
     * 규칙(감시 대상에서 값을 import 하지 않는다)을 여기서 어긴 것이었다.
     *
     * 그래서 **이 파일이 태어난 커밋**을 git 이력에서 구한다. 그것은 기록이 못 고른다.
     */
    const birth = () => {
      const r = spawnSync("git", ["log", "--diff-filter=A", "--format=%H", "--", "scripts/fixtures/expand-baseline.json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      if (r.status !== 0) return { err: (r.stderr || r.error?.message || "git 실패").trim().split("\n")[0] };
      const shas = r.stdout.trim().split("\n").filter(Boolean);
      if (shas.length === 0) return { err: "이 파일이 태어난 커밋을 못 찾았다 — 얕은 클론이면 이력이 없다" };
      return { sha: shas[shas.length - 1] }; // 가장 오래된 것
    };

    // 기록마다 baseSha 가 있어야 하고, 오래된 것부터 적혀 있어야 한다.
    for (const rev of revisions) {
      if (!rev.baseSha) bad.push(`revision(${rev.structure ?? "?"})에 baseSha 가 없다 — 무엇을 고친 것인지 못 가린다`);
    }
    for (let i = 1; i < revisions.length; i += 1) {
      if (Number(revisions[i].stage) < Number(revisions[i - 1].stage)) {
        bad.push("_revisions 가 단계 오름차순이 아니다 — 사람이 읽는 순서다");
      }
    }

    if (revisions.every((r) => r.baseSha) && bad.length === 0) {
      // ②-a 기록한 옛 값이 그 커밋의 실제 값과 같은가. 기록 자체를 위조하면 여기서 걸린다.
      for (const rev of revisions) {
        const { json, err } = gitShow(rev.baseSha);
        if (err) {
          bad.push(`${rev.baseSha} 의 기준선을 못 꺼냈다 — ${err}`);
          continue;
        }
        for (const [seedId, then] of Object.entries(rev.before)) {
          const was = json.baseline?.[seedId]?.[rev.structure];
          if (!was) {
            bad.push(`${rev.baseSha} 에 ${seedId}/${rev.structure} 가 없다 — 기록이 엉뚱한 커밋을 가리킨다`);
            continue;
          }
          if (was.join("|") !== then.join("|")) {
            bad.push(`${seedId}/${rev.structure}: 기록한 옛 값이 ${rev.baseSha.slice(0, 7)} 의 실제 값과 다르다`);
          }
        }
      }

      /*
       * ②-b **이 파일이 태어난 시점과 지금을 통째로 대조한다.** 달라진 칸 전부가 어느
       * 기록엔가 적혀 있어야 한다. 이것이 "이것만 바꿨다" 를 기계가 확인하는 자리다.
       *
       * 고정점이 **파일의 출생 커밋**이므로 기록이 그것을 옮길 수 없다. 씨앗이 늘어 칸이
       * 새로 생기는 것도 기록을 요구한다 — 기준선이 조용히 커지는 것도 같은 부류다.
       */
      const { sha: anchorSha, err: birthErr } = birth();
      const { json: anchor, err } = anchorSha ? gitShow(anchorSha) : { err: birthErr };
      if (err) bad.push(`고정점(이 파일이 태어난 커밋)을 못 꺼냈다 — ${err}`);
      else {
        const claimed = new Set();
        for (const rev of revisions) {
          for (const seedId of Object.keys(rev.before ?? {})) claimed.add(`${seedId}/${rev.structure}`);
        }
        const unclaimed = [];
        for (const [seedId, byStructure] of Object.entries(anchor.baseline ?? {})) {
          for (const [structureId, then] of Object.entries(byStructure)) {
            const now = fixture.baseline?.[seedId]?.[structureId];
            const changed = !now || now.join("|") !== then.join("|");
            if (changed && !claimed.has(`${seedId}/${structureId}`)) unclaimed.push(`${seedId}/${structureId}`);
          }
        }
        // 고정점에 없던 칸이 생긴 것도 기록 밖의 변경이다.
        for (const [seedId, byStructure] of Object.entries(fixture.baseline ?? {})) {
          for (const structureId of Object.keys(byStructure)) {
            if (!anchor.baseline?.[seedId]?.[structureId] && !claimed.has(`${seedId}/${structureId}`)) {
              unclaimed.push(`${seedId}/${structureId} (새로 생겼다)`);
            }
          }
        }
        if (unclaimed.length) {
          bad.push(
            `기록에 없는 칸 ${unclaimed.length}개가 ${anchorSha.slice(0, 7)} 이후 바뀌었다 — ` +
              `"이것만 바꿨다" 가 거짓이거나 기준선을 통째로 다시 만들었다\n      ${unclaimed.slice(0, 5).join(", ")}`,
          );
        }
      }
    }

    // 기록된 구조 밖의 이름이 revision 에 섞이지 않았는가.
    for (const id of revised) {
      if (!structures.some((s) => s.id === id)) bad.push(`기록된 구조 ${id} 가 카탈로그에 없다`);
    }

    out(
      bad.length
        ? bad.slice(0, 6).join("\n")
        : `기준선 수정 ${revisions.length}건이 기록과 맞는다 — ${[...revised].join(", ")} 의 ${revisions.reduce((n, r) => n + (r.changed ?? 0), 0)}장, 이유와 범위가 적혀 있다`,
    );
    return bad.length === 0;
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage24.mjs <${Object.keys(GATES).join("|")}>`);
  process.exitCode = 1;
} else {
  const ok = await GATES[id]();
  if (ok) out(id.replace(/-/g, "_") + "_OK");
  process.exitCode = ok ? 0 : 1;
}
