#!/usr/bin/env node
// 16단계(재질 엔진) 완료 조건 검사기.
//   node scripts/check-stage16.mjs S16-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 전부 실패하는 것을 확인한 뒤에
// src/material.js 를 만들었다. 통과부터 하는 게이트는 무엇을 지키는지 알 수 없다.
//
// 스펙(docs/superpowers/specs/2026-09-07-pbr-material-finish-design.md)이 배정한 G1~G10 을
// 두 번에 나눠 넣었다. 16-A 가 G1~G6·G10(비발광 셋), 16-B 가 G7~G9(발광·면제·엔진 변환)다.
// G7·G8 은 짝이라 나눠 넣으면 면제가 구멍이 되므로 함께 왔다. G11(기본 배정)은 스펙 4.5 가
// 요구하지만 번호를 안 준 것이라 뒤에 붙였다.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandAll, hexToHsl, perceivedChroma } from "../src/expand.js";
import { loadSeeds } from "../src/seeds.js";
import {
  DEFAULT_FINISH_BY_ROLE,
  DIELECTRIC_MAX,
  DIELECTRIC_MIN,
  EMISSIVE_BASE_MAX,
  EV_MAX,
  MATERIAL_FINISHES,
  METAL_MIN,
  MaterialError,
  applyFinish,
  assertEv,
  enginePayload,
  fromUnity,
  loadFinishes,
  toUnity,
  toUnreal,
} from "../src/material.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const palettes = () => JSON.parse(read("data/palettes.json")).palettes;

/** 실제로 확장되는 씨앗 전부 — 코퍼스 16쌍 + 씨앗 풀 24쌍. check-stage11·15 와 같은 집합이다. */
const allSeeds = () => [...palettes(), ...loadSeeds()];

/** 주석을 걷어낸 소스. check-stage13·15 와 같은 예외(문자열 안 URL 스킴)를 같은 이유로 둔다. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * **material.js 의 상수와 같은 값을 독립적으로 적는다.**
 *
 * 이것들을 그쪽에서 읽어 오기만 하면, 상수를 바꾸는 순간 **게이트의 문턱이 함께 움직여** 아무것도
 * 검사하지 않게 된다. 리뷰가 실측으로 보였다 — `METAL_MIN` 을 180 → 1 로 바꾸자 S16-G5 가
 * `금속 base 2000건이 전부 min >= 1` 이라고 찍으며 **통과했다.**
 *
 * 나는 이 교훈을 `EV_MAX` 에 대해 이미 적어 놓고(S16-G8) 나머지 셋에 일반화하지 않았다.
 * 하필 이 셋이 `[문헌]` 인용값이라 조용한 표류를 가장 막고 싶은 자리다.
 * check-stage15 가 check-stage11 의 `MIN_TIER_GAP` 을 다시 적는 것과 같은 규율이다.
 *
 * 값을 바꾸는 것은 **두 곳을 함께 고치는 의식적인 일**이어야 한다. 그 마찰이 목적이다.
 */
const EXPECTED = Object.freeze({
  DIELECTRIC_MIN: 50, //     [문헌] 언리얼 PBR 지침 — 비금속 base 하한
  DIELECTRIC_MAX: 243, //    [문헌] 언리얼 PBR 지침 — 비금속 base 상한
  METAL_MIN: 180, //         [문헌] 언리얼 PBR 지침 — 금속 base 하한
  EMISSIVE_BASE_MAX: 90, // [판단] 발광체의 꺼진 몸체 상한
});

/** 상수가 그대로인지 먼저 확인한다. 어긋나면 그 뒤 검사는 다른 것을 재고 있다. */
function assertConstants(bad, names) {
  const actual = { DIELECTRIC_MIN, DIELECTRIC_MAX, METAL_MIN, EMISSIVE_BASE_MAX };
  for (const name of names) {
    if (actual[name] !== EXPECTED[name]) {
      bad.push(`${name} 이 ${actual[name]} 다 — 이 게이트가 아는 값은 ${EXPECTED[name]}. 바꿨다면 여기도 함께 고친다`);
    }
  }
}

/** 씨앗(안료)의 지각 채도 상한. **check-stage11 에서 읽어 오지 않고 여기서 다시 잰다** —
    한쪽에서 가져오면 그쪽이 느슨해질 때 이 게이트가 함께 느슨해진다. 실측 0.8706. */
const pigmentCap = () => {
  let cap = 0;
  for (const seed of allSeeds()) for (const c of seed.colors) cap = Math.max(cap, perceivedChroma(hexToHsl(c.hex)));
  return cap;
};

/** 임시 디렉터리에 픽스처를 쓰고 콜백에 경로를 넘긴다. 저장소의 data/ 는 건드리지 않는다.
    check-stage12 의 withFixture 와 같은 모양을 **독립적으로** 적는다 — 한쪽에서 읽어 오면
    그쪽이 바뀔 때 이 게이트가 조용히 다른 것을 검사하게 된다. */
function withFixture(contents, fn) {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-finishes-"));
  try {
    const path = join(dir, "finishes.json");
    if (contents !== null) writeFileSync(path, contents, "utf8");
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * **재질 엔진이 실제로 받는 입력 전부.**
 *
 * 씨앗 색 32개가 아니라 **파생 역할색**이다 — `applyFinish` 는 `expand.js` 의 출력을 받는다.
 * 두 모드를 다 돈다. 실측으로 어두운 모드 쪽이 훨씬 가혹하다(비금속 범위를 그냥 통과하는 것이
 * 밝은 모드 65.3% · 어두운 모드 53.1%). 밝은 모드만 보면 클램프의 절반을 안 보는 셈이다.
 */
function everyRoleColor() {
  const rows = [];
  for (const mode of ["light", "dark"]) {
    for (const seed of allSeeds()) {
      for (const st of expandAll(seed, undefined, { mode })) {
        for (const c of st.colors) rows.push({ hex: c.hex, role: c.role, where: `${seed.id}/${st.id}/${c.role}(${mode})` });
      }
    }
  }
  return rows;
}

const GATES = {
  /*
   * data/finishes.json 에 숫자도 헥스도 없다.
   *
   * data/structures.json 이 같은 규칙을 지고 있고 S11-G1 이 그것을 검사한다. 규칙의 이유도 같다 —
   * 러프니스를 몇으로 두는지는 원전(light.md)에 없다. 원전에 없는 값이 데이터 파일에 앉으면
   * "원전이 그렇게 말했다" 로 읽히고, 그 순간 근거 없는 숫자가 근거 있는 것처럼 유통된다.
   *
   * **메타 키(_ 로 시작)는 빼고 본다.** 거기에는 이 규칙을 설명하는 산문이 들어가고,
   * 산문에 "50~243" 같은 숫자가 나오는 것은 규칙 위반이 아니라 규칙의 설명이다.
   *
   * **S11-G1 보다 한 겹 조인다.** 그쪽은 "모든 필드가 문자열" 과 "헥스 없음" 만 보는데,
   * `"roughness": "0.85"` 처럼 **문자열로 위장한 수치**는 둘 다 통과한다. 그래서 여기서는
   * 숫자 자체를 금한다.
   *
   * **`source` 만 예외다.** 원전 인용은 절 번호를 쓴다 — `structures.json` 이 이미
   * `"1절 기법표"` 로 그렇게 하고 있다. 절 번호는 "어디서 왔나" 이지 "얼마로 두라" 가 아니다.
   *
   * **예외는 화이트리스트다.** 처음엔 막을 것을 열거했고(소수점·퍼센트), 리뷰가 그것으로 뚫었다 —
   * `"light.md 1절 180 이상 반사율 근거"` 가 통과했다. 소수점도 퍼센트도 없는 **순수 정수**로
   * 임계값을 인용문처럼 적으면 그대로 새어 들어온다. 이 게이트의 존재 이유를 정면으로 우회한다.
   *
   * 그래서 무엇을 막을지가 아니라 **무엇을 허용할지**를 적는다: `<한두 자리>절` 형태만 지우고
   * 그래도 숫자가 남으면 실패다. 셸 명령 필터에서 배운 것과 같은 교훈이다 — 막을 것을 열거하면
   * 열거하지 않은 형태가 늘 남는다.
   *
   * **판정기 자체의 대조를 게이트 안에 넣는다.** 이 정규식이 나중에 느슨해지면 게이트는 조용히
   * 통과만 하게 된다. 알려진 나쁜 문자열이 실제로 걸리는지를 매번 함께 확인한다.
   */
  "S16-G1": async () => {
    const raw = JSON.parse(read("data/finishes.json"));
    const bad = [];

    // 허용하는 것: `<한두 자리>절`. 그것만 지우고도 숫자가 남으면 수치가 섞인 것이다.
    const sourceHasNumber = (v) => /\d/.test(v.replace(/\d{1,2}절/g, ""));

    // **판정기 자체의 대조.** 이것이 없으면 위 정규식이 느슨해져도 게이트는 통과만 한다.
    const mustPass = ["light.md 1절 하이라이트 표", "4절 첫 항목", "1절 기법표"];
    const mustFail = [
      "light.md 1절 180 이상 반사율 근거", // 리뷰가 실제로 뚫은 문자열
      "light.md 1절 러프니스 0.85",
      "light.md 1절 채도 85%",
      "light.md 180절 근거", // 세 자리는 절 번호로 안 본다
      "반사율 180",
    ];
    for (const v of mustPass) if (sourceHasNumber(v)) bad.push(`판정기 자체 대조 실패 — 멀쩡한 인용을 막는다: ${v}`);
    for (const v of mustFail) if (!sourceHasNumber(v)) bad.push(`판정기 자체 대조 실패 — 수치를 통과시킨다: ${v}`);

    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("_")) continue;
      if (key !== "finishes") bad.push(`알 수 없는 최상위 키 ${key} — 메타는 _ 로 시작한다`);
    }

    const list = raw.finishes;
    if (!Array.isArray(list) || list.length === 0) throw new Error("finishes 가 비었다 — 이 검사가 공허하다");

    let fields = 0;
    for (const item of list) {
      for (const [key, value] of Object.entries(item)) {
        fields += 1;
        if (typeof value !== "string") {
          bad.push(`${item.id}/${key} 가 ${typeof value} 다 — 문자열만 둔다`);
          continue;
        }
        if (/#[0-9a-fA-F]{3,8}\b/.test(value)) bad.push(`${item.id}/${key} 에 헥스가 있다: ${value}`);
        if (key === "source") {
          if (sourceHasNumber(value)) bad.push(`${item.id}/source 에 절 번호가 아닌 숫자가 있다: ${value}`);
        } else if (/\d/.test(value)) {
          bad.push(`${item.id}/${key} 에 숫자가 있다: ${value}`);
        }
      }
      for (const need of ["id", "name", "principle", "detail", "source"]) {
        if (!item[need]) bad.push(`${item.id ?? "(id없음)"} 에 ${need} 가 없다`);
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 6).join(" / "));
    out(`재질 ${list.length}개 · 필드 ${fields}개가 전부 문자열이고 숫자·헥스가 없다 (판정기 자체 대조 ${mustPass.length}+${mustFail.length}건 통과)`);
    out(`출처: ${list.map((f) => `${f.id}←${f.source}`).join(" · ")}`);
    out("S16_G1_OK");
  },

  /*
   * 파생이 결정론적이다. 같은 입력이 늘 같은 출력이고, 소스에 난수가 없다.
   *
   * S11-G3 이 expand.js 에 대해 같은 것을 본다. 재질이 이 성질을 잃으면 그 위의 모든 게이트가
   * 무의미해진다 — 두 번 돌려 다른 값이 나오면 "지금 통과했다" 가 아무것도 보장하지 않는다.
   *
   * **호출 순서를 섞어서 두 번째를 돌린다.** 순서대로 두 번 돌리면 호출 사이에 상태를 들고
   * 있는 구현(직전 결과를 캐시해 그대로 돌려주기)도 통과한다.
   */
  "S16-G2": async () => {
    const rows = everyRoleColor();
    const shot = (hex, id, role) => JSON.stringify(applyFinish(hex, id, role));

    const first = new Map();
    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) first.set(`${where}|${id}`, shot(hex, id, role));
    }

    const bad = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const { hex, role, where } = rows[i];
      for (const id of [...MATERIAL_FINISHES].reverse()) {
        const key = `${where}|${id}`;
        if (shot(hex, id, role) !== first.get(key)) bad.push(`${key} 가 두 번째 호출에서 달라졌다`);
      }
    }

    const src = read("src/material.js");
    if (/Math\.random|crypto\.|Date\.now|performance\.now/.test(stripComments(src))) {
      bad.push("material.js 에 난수·시각 의존이 있다");
    }

    if (bad.length) throw new Error(bad.slice(0, 4).join(" / "));
    out(`역할색 ${rows.length} × 재질 ${MATERIAL_FINISHES.length} = ${first.size}건이 호출 순서를 뒤집어도 동일`);
    out("S16_G2_OK");
  },

  /*
   * **코드에 상수 헥스가 없다.** 모든 색이 씨앗에서 계산돼 나온다.
   *
   * S11-G2 가 expand.js 에 대해 같은 것을 본다. 정적 검사만으로는 부족하다 — 헥스를 쓰지 않고도
   * 상수를 만들 수 있다(`rgb(128,0,0)`, 채널 정수 세 개). 그래서 **행위 대조를 함께 한다:
   * 입력 헥스를 바꾸면 출력 baseColor 가 반드시 달라져야 한다.**
   *
   * 대조군을 무채색으로 잡지 않는다. 무채색은 색상각이 없어 hue 를 무시하는 구현도 통과시킨다.
   */
  "S16-G3": async () => {
    const bad = [];
    const src = stripComments(read("src/material.js"));
    const literals = src.match(/#[0-9a-fA-F]{6}\b/g);
    if (literals) bad.push(`material.js 에 상수 헥스 ${literals.length}개: ${[...new Set(literals)].join(", ")}`);

    // 행위 대조 — 서로 다른 유채색 입력이 서로 다른 출력을 낸다.
    const probes = [];
    for (const seed of allSeeds()) for (const c of seed.colors) probes.push(c.hex);
    const ROLE = "강조"; // 씨앗 색에는 역할이 없다. 발광 EV 가 가장 높은 역할로 고정해 대조한다.
    for (const id of MATERIAL_FINISHES) {
      const seen = new Map();
      for (const hex of probes) {
        const base = applyFinish(hex, id, ROLE).baseColor;
        seen.set(base, (seen.get(base) ?? 0) + 1);
      }
      // 상수를 반환하는 구현이면 서로 다른 씨앗 색이 전부 한 값으로 뭉친다.
      if (seen.size <= 1) bad.push(`${id}: 씨앗 색 ${probes.length}개가 baseColor ${seen.size}가지로 뭉쳤다 — 상수를 내고 있다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    const spread = MATERIAL_FINISHES.map((id) => `${id} ${new Set(probes.map((h) => applyFinish(h, id, ROLE).baseColor)).size}가지`);
    out(`material.js 에 상수 헥스 0개 · 씨앗 색 ${probes.length}개가 재질별로 ${spread.join(" · ")}`);
    out("S16_G3_OK");
  },

  /*
   * **네 재질의 base 가 각자의 창 안에 있다.**
   *
   * 창은 재질마다 다르고, 그 차이가 곧 재질의 정의다.
   *   matte · gloss  50~243   실재하는 비금속의 반사율 범위 `[문헌]`
   *   metal         180~255   금속의 base 는 안료색이 아니라 반사율(F0)이라 밝은 구간뿐 `[문헌]`
   *   emissive       50~90    **발광체는 꺼졌을 때 어둡다** `[판단]`
   *
   * **처음엔 matte·gloss 만 봤고 리뷰 둘이 각각 같은 구멍을 찾았다.** `EMISSIVE_BASE_MAX` 를
   * 90 → 243 으로 바꾸면 발광체의 몸체가 밝아지는데 **게이트 열한 개가 전부 통과했다**(재현 확인:
   * `#ffe4a1` → base `#f3d895`). 그런데 그 어두움은 `data/finishes.json` 의 원리 서술과 코드
   * 주석이 반복해 강조하는 핵심 불변식이다 — **발광은 주변이 어두워야 발광으로 읽힌다.**
   * 말로만 있고 게이트가 없으면 리팩터링 한 번에 조용히 사라진다.
   *
   * 재질마다 양성 대조를 따로 센다. 하나로 묶으면 어느 재질의 클램프가 죽었는지 안 보인다.
   */
  "S16-G4": async () => {
    const rows = everyRoleColor();
    const bad = [];
    assertConstants(bad, ["DIELECTRIC_MIN", "DIELECTRIC_MAX", "METAL_MIN", "EMISSIVE_BASE_MAX"]);
    if (bad.length) throw new Error(bad.join(" / "));

    // **창을 여기서 다시 적는다.** material.js 의 RULES 에서 유도하면 그쪽이 바뀔 때 함께 바뀐다.
    const WINDOW = {
      matte: [EXPECTED.DIELECTRIC_MIN, EXPECTED.DIELECTRIC_MAX],
      gloss: [EXPECTED.DIELECTRIC_MIN, EXPECTED.DIELECTRIC_MAX],
      metal: [EXPECTED.METAL_MIN, 255],
      emissive: [EXPECTED.DIELECTRIC_MIN, EXPECTED.EMISSIVE_BASE_MAX],
    };
    for (const id of MATERIAL_FINISHES) {
      if (!WINDOW[id]) bad.push(`재질 ${id} 의 창이 이 게이트에 없다 — 새 재질을 넣었다면 여기도 적는다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));

    const stat = new Map(MATERIAL_FINISHES.map((id) => [id, { checked: 0, wasOut: 0, moved: 0, untouched: 0 }]));

    for (const { hex, role, where } of rows) {
      const before = channels(hex);
      for (const id of MATERIAL_FINISHES) {
        const [lo, hi] = WINDOW[id];
        const st = stat.get(id);
        st.checked += 1;

        const wasOut = Math.min(...before) < lo || Math.max(...before) > hi;
        if (wasOut) st.wasOut += 1;

        const { baseColor } = applyFinish(hex, id, role);
        const after = channels(baseColor);
        if (Math.min(...after) < lo || Math.max(...after) > hi) {
          bad.push(`${where}/${id}: ${hex} → ${baseColor} (${after.join(",")}) 가 ${lo}~${hi} 밖`);
        }
        if (wasOut && baseColor !== hex.toLowerCase()) st.moved += 1;
        if (!wasOut && baseColor !== hex.toLowerCase()) st.untouched += 1;
      }
    }

    if (bad.length) throw new Error(`${bad.length}건 — ${bad.slice(0, 3).join(" / ")}`);

    for (const [id, st] of stat) {
      if (st.wasOut === 0) bad.push(`${id}: 창 밖이던 역할색이 0장이다 — 이 재질에 대해 게이트가 공허하다`);
      if (st.moved !== st.wasOut) bad.push(`${id}: 창 밖이던 ${st.wasOut}장 중 ${st.moved}장만 움직였다`);
      if (st.untouched > 0) bad.push(`${id}: 이미 창 안이던 색을 ${st.untouched}건 건드렸다 — 클램프는 필요할 때만 움직인다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));

    const lines = [...stat].map(([id, st]) => `${id} ${WINDOW[id][0]}~${WINDOW[id][1]} (밖이던 ${st.wasOut}/${st.checked}장 전부 들어옴)`);
    out(`재질 ${stat.size}종 × 역할색 ${rows.length} = ${rows.length * stat.size}건이 전부 자기 창 안`);
    out(`  ${lines.join(" · ")}`);
    out("  창 안이던 색을 건드린 건수 0 — 클램프는 필요할 때만 움직인다");
    out("S16_G4_OK");
  },

  /*
   * 금속 base 가 min 채널 >= 180 이고, **색상각이 씨앗에서 벗어나지 않는다.**
   *
   * 뒤엣것이 이 게이트의 값어치다. 앞엣것만 보면 무엇을 넣든 회색을 뱉는 구현이 통과한다 —
   * 실제로 채널을 그냥 clamp(c, 180, 255) 하면 min>=180 을 만족하면서 색상각이 무너진다.
   *
   * 무채색(s=0)은 색상각이 정의되지 않으므로 뺀다. 뺀 장 수를 함께 찍어, 전부 빠져서
   * 검사가 공허해지는 것을 사람이 볼 수 있게 한다.
   *
   * **색상각은 네 재질 전부에서 본다.** 처음엔 금속만 봤고 리뷰가 지적했다 — `fitRange` 의
   * 독스트링과 `GATES.md` 는 색상각 보존을 **아핀 사상 전체의 성질**로 서술하는데 게이트는
   * 금속 경로만 검사했다. 리뷰어가 비금속 창(`hi === 243`)에서만 채널별 clamp 로 새는 변형을
   * 만들자 색상각이 **최대 12.33도** 틀어졌는데도 열한 게이트가 전부 통과했다.
   * 문서가 보편 성질이라고 말하면 게이트도 보편적으로 물어야 한다.
   *
   * 허용 오차는 8비트 반올림에서 온다. 씨앗 전수 실측으로 최댓값을 재서 여유를 확인한다.
   */
  "S16-G5": async () => {
    const rows = everyRoleColor();
    const bad = [];
    assertConstants(bad, ["METAL_MIN"]);
    let checked = 0;
    let skippedGray = 0;
    let worstHue = { d: -1 };
    const HUE_TOL = 1.5; // 도. 8비트 반올림 몫이고, 아래 실측 최댓값과 함께 찍는다.

    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) {
        const { baseColor, metallic } = applyFinish(hex, id, role);
        checked += 1;

        if (id === "metal") {
          const after = channels(baseColor);
          if (Math.min(...after) < EXPECTED.METAL_MIN) {
            bad.push(`${where}: ${hex} → ${baseColor} min ${Math.min(...after)} < ${EXPECTED.METAL_MIN}`);
          }
          if (metallic !== 1) bad.push(`${where}: metal 인데 metallic=${metallic}`);
        }

        const src = hexToHsl(hex);
        const dst = hexToHsl(baseColor);
        if (src.s < 0.02 || dst.s < 0.02) {
          skippedGray += 1;
          continue;
        }
        const raw = Math.abs(src.h - dst.h) % 360;
        const d = Math.min(raw, 360 - raw);
        if (d > worstHue.d) worstHue = { d, where: `${where}/${id}`, hex, baseColor };
        if (d > HUE_TOL) {
          bad.push(`${where}/${id}: 색상각이 ${d.toFixed(2)}도 움직였다 ${hex}(${src.h.toFixed(1)}) → ${baseColor}(${dst.h.toFixed(1)})`);
        }
      }
    }

    if (bad.length) throw new Error(`${bad.length}건 — ${bad.slice(0, 3).join(" / ")}`);
    if (checked - skippedGray === 0) throw new Error("색상각을 검사한 장이 0이다 — 전부 무채색으로 빠졌다");

    out(`금속 base 가 전부 min >= ${EXPECTED.METAL_MIN} [문헌: 언리얼 PBR 지침]`);
    out(`색상각을 **네 재질 전부**에서 검사 — ${checked}건 중 최대 이동 ${worstHue.d.toFixed(3)}도 / 허용 ${HUE_TOL} (${worstHue.where} ${worstHue.hex}→${worstHue.baseColor}) · 무채색 제외 ${skippedGray}장`);
    out("S16_G5_OK");
  },

  /*
   * metallic 이 0 아니면 1 뿐이다.
   *
   * PBR 에서 중간값은 **물리적으로 존재하는 재질이 아니다** — 텍스처 경계 픽셀을 블렌드하려고
   * 있는 것이지 "반쯤 금속" 이라는 물질이 있어서가 아니다. 0.5 를 내보내면 붙여넣는 사람이
   * 그것을 물질의 성질로 읽는다.
   *
   * 타입까지 본다. `"1"` 은 `== 1` 을 통과하지만 엔진에 넣으면 다른 것이 된다.
   */
  "S16-G6": async () => {
    const rows = everyRoleColor();
    const bad = [];
    const tally = new Map();

    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) {
        const { metallic } = applyFinish(hex, id, role);
        tally.set(`${id}=${metallic}`, (tally.get(`${id}=${metallic}`) ?? 0) + 1);
        if (typeof metallic !== "number") bad.push(`${where}/${id}: metallic 이 ${typeof metallic}`);
        else if (metallic !== 0 && metallic !== 1) bad.push(`${where}/${id}: metallic=${metallic}`);
      }
    }

    // 전부 0 이면 이 게이트가 "금속이 없다" 를 통과시키고 있는 것이다.
    const kinds = new Set([...tally.keys()].map((k) => k.split("=")[1]));
    if (kinds.size < 2) throw new Error(`metallic 이 ${[...kinds].join(",")} 한 가지뿐이다 — 금속과 비금속이 안 갈린다`);

    if (bad.length) throw new Error(bad.slice(0, 4).join(" / "));
    out(`metallic 이 0/1 뿐 — ${[...tally].map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
    out("S16_G6_OK");
  },

  /*
   * 불량 입력에서 **조용히 망가지지 않는다.**
   *
   * expand.js 의 StructureError 와 같은 자리다. 없는 재질 id 에 기본값을 물려주면 사용자는
   * 자기가 고른 것과 다른 재질의 수치를 붙여넣게 되고, 그것이 틀렸다는 신호가 어디에도 없다.
   *
   * **양성 대조를 함께 둔다** — 멀쩡한 입력이 던지면 이 게이트는 "전부 던진다" 를 통과시킨다.
   *
   * **카탈로그 파일이 손상된 경로도 여기서 본다.** 처음엔 `applyFinish` 만 봤고, 리뷰가 잡았다 —
   * `loadFinishes` 가 원시 `SyntaxError` 를 던져서 "불량 입력은 전부 MaterialError" 라는
   * 이 모듈의 계약이 절반만 걸려 있었다. 이 파일 3번 줄 주석이 이미 "StructureError 와 같은
   * 자리다" 라고 말하고 있었는데 코드가 그 말을 안 지켰다.
   *
   * 씨앗 풀(S12-G4)은 손상 시 **빈 배열로 물러서는** 것이 정답이지만 여기서는 **던지는** 것이
   * 정답이다. 씨앗 풀은 없어도 코퍼스 16쌍이 그대로 도는 선택 사항이고, 재질 카탈로그가 비면
   * 이 엔진이 할 일이 없다. 같은 모양의 게이트가 반대 결론을 검사하는 것은 그래서다.
   */
  "S16-G10": async () => {
    const bad = [];
    const shouldThrow = [
      ["없는 재질 id", () => applyFinish("#b73f74", "velvet", "강조")],
      ["빈 재질 id", () => applyFinish("#b73f74", "", "강조")],
      ["재질 id 없음", () => applyFinish("#b73f74")],
      ["재질 id 가 객체", () => applyFinish("#b73f74", { id: "matte" }, "강조")],
      ["헥스가 아님", () => applyFinish("빨강", "matte", "강조")],
      ["샵 없음", () => applyFinish("b73f74", "matte", "강조")],
      ["3자리 축약", () => applyFinish("#b37", "matte", "강조")],
      ["헥스 아닌 문자", () => applyFinish("#b73f7g", "matte", "강조")],
      ["헥스가 null", () => applyFinish(null, "matte", "강조")],
      ["헥스가 숫자", () => applyFinish(0xb73f74, "matte", "강조")],
      ["프로토타입 오염 시도", () => applyFinish("#b73f74", "__proto__", "강조")],
      ["없는 역할", () => applyFinish("#b73f74", "matte", "손잡이")],
      ["역할 없음", () => applyFinish("#b73f74", "matte")],
      ["역할이 프로토타입 이름", () => applyFinish("#b73f74", "matte", "__proto__")],
      // `Object.hasOwn` 은 키를 ToPropertyKey 로 강제 변환한다. 문자열 검사를 안 하면
      // 아래 둘이 통과한다(리뷰가 재현). JSDoc 이 string 이라고 선언한 이상 아닌 것은 막는다.
      ["역할이 toString 위장 객체", () => applyFinish("#b73f74", "emissive", { toString: () => "강조" })],
      ["역할이 배열", () => applyFinish("#b73f74", "emissive", ["강조"])],
      ["역할이 숫자", () => applyFinish("#b73f74", "matte", 0)],
    ];

    for (const [label, fn] of shouldThrow) {
      let threw = null;
      try {
        fn();
      } catch (err) {
        threw = err;
      }
      if (!threw) bad.push(`${label}: 던지지 않았다`);
      else if (!(threw instanceof MaterialError)) bad.push(`${label}: ${threw.constructor.name} 을 던졌다 (MaterialError 여야 한다)`);
    }

    // 양성 대조 — 멀쩡한 입력은 던지지 않는다.
    for (const id of MATERIAL_FINISHES) {
      try {
        const m = applyFinish("#b73f74", id, "강조");
        if (!/^#[0-9a-f]{6}$/.test(m.baseColor)) bad.push(`${id}: baseColor 형식이 ${m.baseColor}`);
      } catch (err) {
        bad.push(`양성 대조 ${id} 가 던졌다: ${err.message}`);
      }
    }

    /*
     * 엔진 변환의 입력 검증.
     *
     * `toUnity`·`toUnreal`·`fromUnity` 는 **stage 17 과 내보내기가 쓸 공개 API 다.**
     * `applyFinish` 가 만든 것만 들어온다는 보장이 없는데 처음엔 검증이 없었고, 리뷰가 실측으로
     * 보였다 — `roughness: 1.5` 는 `smoothness: -0.5` 가 되고 문자열 `"0.2"` 는 `1 - "0.2" = 0.8`
     * 로 강제 변환되어 타입이 소리 없이 바뀐다. **같은 모듈의 한 출구가 "던진다" 를 계약으로
     * 세웠으면 다른 출구도 지켜야 한다.**
     */
    const good = applyFinish("#b73f74", "emissive", "강조");
    const withField = (k, v) => ({ ...good, [k]: v });
    const engineBad = [
      ["toUnity 에 객체 아님", () => toUnity(null)],
      ["toUnity 에 배열", () => toUnity([good])],
      ["roughness 가 범위 밖", () => toUnity(withField("roughness", 1.5))],
      ["roughness 가 음수", () => toUnity(withField("roughness", -0.1))],
      ["roughness 가 문자열", () => toUnity(withField("roughness", "0.2"))],
      ["roughness 가 NaN", () => toUnity(withField("roughness", NaN))],
      ["metallic 이 중간값", () => toUnity(withField("metallic", 0.5))],
      ["baseColor 가 헥스 아님", () => toUnity(withField("baseColor", "빨강"))],
      ["emission 이 객체도 null 도 아님", () => toUnity(withField("emission", "x"))],
      ["emission.ev 가 상한 밖", () => toUnity(withField("emission", { color: "#ff0000", ev: 99 }))],
      ["toUnreal 에 잘못된 재질", () => toUnreal(withField("roughness", 2))],
      ["fromUnity 에 객체 아님", () => fromUnity("x")],
      ["fromUnity smoothness 범위 밖", () => fromUnity({ ...toUnity(good), smoothness: 1.5 })],
      ["fromUnity baseColor 손상", () => fromUnity({ ...toUnity(good), baseColor: "#zz0000" })],
    ];
    for (const [label, fn] of engineBad) {
      let threw = null;
      try {
        fn();
      } catch (err) {
        threw = err;
      }
      if (!threw) bad.push(`엔진 변환 ${label}: 던지지 않았다`);
      else if (!(threw instanceof MaterialError)) {
        bad.push(`엔진 변환 ${label}: ${threw.constructor.name} 을 던졌다 (MaterialError 여야 한다)`);
      }
    }
    // 양성 대조 — 멀쩡한 재질은 세 함수 전부 통과한다. 아니면 위 검사가 "전부 던진다" 로 공허해진다.
    for (const [label, fn] of [["toUnity", () => toUnity(good)], ["toUnreal", () => toUnreal(good)], ["fromUnity", () => fromUnity(toUnity(good))]]) {
      try {
        fn();
      } catch (err) {
        bad.push(`엔진 변환 양성 대조 ${label} 가 던졌다: ${err.message}`);
      }
    }

    // 카탈로그 파일이 손상됐을 때. 원시 SyntaxError 가 새어 나가면 호출부가 그것을 못 가른다.
    const brokenCatalog = [
      ["파일이 없음", null],
      ["JSON 이 아님", "{{{"],
      ["finishes 가 배열이 아님", '{"finishes":{}}'],
      ["finishes 가 없음", '{"note":"x"}'],
      ["빈 배열", '{"finishes":[]}'],
    ];
    for (const [label, contents] of brokenCatalog) {
      let threw = null;
      try {
        withFixture(contents, (path) => loadFinishes(path));
      } catch (err) {
        threw = err;
      }
      if (!threw) bad.push(`카탈로그 ${label}: 던지지 않았다`);
      else if (!(threw instanceof MaterialError)) {
        bad.push(`카탈로그 ${label}: ${threw.constructor.name} 을 던졌다 (MaterialError 여야 한다)`);
      }
    }

    // 양성 대조 — 멀쩡한 픽스처는 던지지 않고, 픽스처가 캐시를 오염시키지도 않는다.
    const probe = JSON.stringify({ finishes: [{ id: "probe", name: "x", principle: "y", detail: "z", source: "w" }] });
    const fromFixture = withFixture(probe, (path) => loadFinishes(path).map((f) => f.id));
    if (fromFixture.join() !== "probe") bad.push(`멀쩡한 픽스처를 못 읽었다: ${fromFixture}`);

    // 카탈로그와 코드가 같은 재질을 알고 있는가. 어긋나면 화면이 고를 수 있는데 엔진이 모르는
    // 재질이 생긴다. **픽스처를 읽은 뒤에 부른다** — 픽스처가 캐시에 남았다면 여기서 드러난다.
    const catalogIds = loadFinishes().map((f) => f.id);
    const only = (a, b) => a.filter((x) => !b.includes(x));
    if (only(catalogIds, [...MATERIAL_FINISHES]).length || only([...MATERIAL_FINISHES], catalogIds).length) {
      bad.push(`카탈로그 [${catalogIds}] 와 엔진 [${[...MATERIAL_FINISHES]}] 이 다르다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`불량 입력 ${shouldThrow.length}가지 + 엔진 변환 ${engineBad.length}가지 + 카탈로그 손상 ${brokenCatalog.length}가지가 전부 MaterialError`);
    out(`양성 대조: 멀쩡한 입력이 재질 ${MATERIAL_FINISHES.length}종 · 엔진 변환 3종에서 안 던진다`);
    out(`카탈로그와 엔진이 같은 재질을 안다 — ${catalogIds.join(" · ")}`);
    out("S16_G10_OK");
  },

  /**
   * **면제가 새지 않는다.** `emission` 만 안료 채도 상한을 벗어나고, `baseColor` 는 어떤 재질에서도
   * 벗어나지 않는다.
   *
   * 왜 면제가 있나: 11단계는 파생색의 지각 채도가 안료 상한(씨앗 실측 0.8706)을 못 넘게 막는
   * 게이트 둘(S11-G9·G10)을 갖고 있다. **네온은 정의상 그 위다.** 임의 예외가 아니라 원전이
   * 이미 나눠 놓은 구분이다 — 하이라이트와 발광에 실리는 것은 물체 색이 아니라 광원 색이고,
   * **광원은 안료가 아니다.**
   *
   * **이 게이트는 G8(EV 상한)과 짝이다.** 하나만 있으면 면제가 그냥 구멍이 된다.
   *
   * 양성 대조가 둘 다 필요하다.
   *   ① `baseColor` 쪽: 상한 아래인 것을 확인하되, **상한이 실제로 닿는 거리인지** 함께 찍는다.
   *      실측 최대가 0.7569(matte·gloss)라 여유가 0.11 이다 — 이 게이트는 헐겁지 않다.
   *   ② `emission` 쪽: **실제로 상한을 넘는 것이 있어야 한다.** 하나도 안 넘으면 면제가
   *      이름만 있고 아무 일도 안 하는 것이고, 그러면 G8 도 함께 공허해진다.
   */
  "S16-G7": async () => {
    const rows = everyRoleColor();
    const CAP = pigmentCap();
    const bad = [];
    assertConstants(bad, ["DIELECTRIC_MIN", "DIELECTRIC_MAX", "METAL_MIN", "EMISSIVE_BASE_MAX"]);

    let baseWorst = { c: 0 };
    let emitWorst = { c: 0 };
    let emitOverCap = 0;
    let baseChecked = 0;
    let emitChecked = 0;

    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) {
        const m = applyFinish(hex, id, role);

        baseChecked += 1;
        const bc = perceivedChroma(hexToHsl(m.baseColor));
        if (bc > baseWorst.c) baseWorst = { c: bc, where: `${where}/${id}`, hex: m.baseColor };
        if (bc > CAP + 1e-9) {
          bad.push(`${where}/${id} baseColor ${m.baseColor} 지각채도 ${bc.toFixed(4)} > 상한 ${CAP.toFixed(4)} — 면제가 base 로 샜다`);
        }

        if (m.emission) {
          emitChecked += 1;
          const ec = perceivedChroma(hexToHsl(m.emission.color));
          if (ec > emitWorst.c) emitWorst = { c: ec, where: `${where}/${id}`, hex: m.emission.color };
          if (ec > CAP + 1e-9) emitOverCap += 1;
        } else if (m.emission !== null) {
          bad.push(`${where}/${id}: emission 이 null 도 객체도 아니다`);
        }
      }
    }

    if (bad.length) throw new Error(`${bad.length}건 — ${bad.slice(0, 3).join(" / ")}`);
    if (emitChecked === 0) throw new Error("발광 재질이 하나도 안 돌았다 — 이 게이트가 공허하다");
    if (emitOverCap === 0) {
      throw new Error(`emission 이 안료 상한 ${CAP.toFixed(4)} 를 한 번도 안 넘는다 — 면제가 이름만 있다 (최대 ${emitWorst.c.toFixed(4)})`);
    }

    out(`baseColor ${baseChecked}건 최대 지각채도 ${baseWorst.c.toFixed(4)} <= 안료 상한 ${CAP.toFixed(4)} (여유 ${(CAP - baseWorst.c).toFixed(4)}) — ${baseWorst.where}`);
    out(`emission ${emitChecked}건 중 상한 초과 ${emitOverCap}건 · 최대 ${emitWorst.c.toFixed(4)} (${emitWorst.where} ${emitWorst.hex}) — 면제가 실제로 일한다`);
    out("S16_G7_OK");
  },

  /**
   * **면제한 자리에 새 상한이 실제로 걸린다.** 채도를 풀어 준 대신 에너지를 묶는다.
   *
   * 안 물면 상한이 그냥 사라진 것이고, 11단계에서 `#00ffee`(C=1.000) 사고를 만든 것이 정확히
   * 그런 빈자리였다.
   *
   * **`EV_MAX` 값 자체에는 근거가 없다 `[판단]`.** 인게임 블룸 실측으로 대체할 자리다.
   * 그래서 값이 헐겁지 않게 잡았다 — 가장 밝은 역할(강조)이 **상한에 딱 붙어 있다.**
   * 여유를 두면 상한이 아무것도 안 묶는다.
   *
   * 검사 셋:
   *   ① 실제 출력의 EV 가 전부 상한 안이고, **상한에 실제로 닿는 것이 있다**(헐겁지 않다)
   *   ② 검증기가 상한을 넘는 값을 **실제로 거부한다** — 이게 없으면 ①은 "지금 표가 작다" 만 말한다
   *   ③ 역할 7가지가 전부 EV 를 갖는다. 빠진 역할이 있으면 그 자리가 조용히 안 빛난다
   */
  "S16-G8": async () => {
    const rows = everyRoleColor();
    const bad = [];

    // **material.js 의 EV_MAX 와 같은 값을 독립적으로 적는다.** 읽어 오기만 하면 그쪽을 99 로
    // 올려도 이 게이트가 함께 느슨해진다 — 뮤테이션이 실제로 그렇게 뚫었다.
    // 상한을 바꾸는 것은 두 곳을 함께 고치는 의식적인 일이어야 한다.
    const EXPECTED_EV_MAX = 4;
    if (EV_MAX !== EXPECTED_EV_MAX) {
      bad.push(`EV_MAX 가 ${EV_MAX} 다 — 이 게이트가 아는 값은 ${EXPECTED_EV_MAX}. 상한을 바꿨다면 여기도 함께 고친다`);
    }
    const seen = new Map();
    let atCap = 0;

    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) {
        const m = applyFinish(hex, id, role);
        if (!m.emission) continue;
        const ev = m.emission.ev;
        if (typeof ev !== "number" || !Number.isFinite(ev)) {
          bad.push(`${where}/${id}: ev 가 ${ev}`);
          continue;
        }
        if (ev < 0) bad.push(`${where}/${id}: ev ${ev} < 0`);
        if (ev > EV_MAX) bad.push(`${where}/${id}: ev ${ev} > 상한 ${EV_MAX}`);
        if (ev === EV_MAX) atCap += 1;
        seen.set(role, ev);
      }
    }

    // ② 검증기 양성 대조 — 상한을 넘는 값을 실제로 거부하는가.
    for (const probe of [EV_MAX + 0.001, EV_MAX + 1, Infinity, NaN, -0.001, "4", null]) {
      let threw = null;
      try {
        assertEv(probe);
      } catch (err) {
        threw = err;
      }
      if (!threw) bad.push(`검증기가 ${String(probe)} 를 통과시킨다`);
      else if (!(threw instanceof MaterialError)) bad.push(`검증기가 ${threw.constructor.name} 을 던진다`);
    }
    // 음성 대조 — 멀쩡한 값은 통과해야 한다. 아니면 "전부 거부" 로 위 검사가 공허해진다.
    for (const okv of [0, EV_MAX / 2, EV_MAX]) {
      try {
        assertEv(okv);
      } catch (err) {
        bad.push(`검증기가 멀쩡한 값 ${okv} 를 막는다: ${err.message}`);
      }
    }

    // ③ 역할 전부가 EV 를 갖는가.
    const allRoles = new Set(rows.map((r) => r.role));
    for (const role of allRoles) if (!seen.has(role)) bad.push(`역할 ${role} 에 EV 가 없다`);

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    if (seen.size === 0) throw new Error("EV 를 잰 역할이 0개다 — 이 게이트가 공허하다");
    if (atCap === 0) throw new Error(`상한 ${EV_MAX} 에 닿는 역할이 없다 — 상한이 아무것도 안 묶는다`);

    const table = [...seen].sort((a, b) => b[1] - a[1]).map(([r, v]) => `${r} ${v}`).join(" · ");
    out(`역할 ${seen.size}가지 EV 가 전부 0~${EV_MAX} 안이고 상한에 닿는 것이 ${atCap}건 — ${table}`);
    out("S16_G8_OK");
  },

  /**
   * **엔진 변환이 왕복한다.** 언리얼 `Roughness`(0 = 거울)와 유니티 `Smoothness`(1 = 거울)는
   * 같은 값을 **반대로** 쓴다. `Roughness 0.2` 를 유니티 칸에 붙여넣으면 정반대 재질이 나오고,
   * 조용히 틀리므로 붙여넣은 사람은 모른다.
   *
   * **부동소수라 반올림이 필요하다 `[실측]`.** `1 - (1 - x)` 는 x 로 안 돌아온다 —
   * 0~1 을 0.001 간격으로 재면 **1001개 중 335개가 어긋난다**(최대 오차 5.6e-17).
   * 내 `gloss` 값 0.2 가 바로 그중 하나다(0.19999999999999996). 오차 자체는 무시할 크기지만,
   * **사람이 엔진 칸에 붙여넣을 값**이므로 그런 꼬리가 보이면 안 된다.
   *
   * 그래서 변환이 소수 셋째 자리로 반올림하고, 이 게이트는 **정확한 일치(===)** 를 요구한다.
   * 허용 오차를 두면 반올림이 없어져도 통과하므로, 반올림이 일을 한다는 사실이 안 지켜진다.
   * **음성 대조로 반올림 없는 순진한 변환이 실제로 실패하는 것을 함께 확인한다.**
   */
  "S16-G9": async () => {
    const rows = everyRoleColor();
    const bad = [];
    let checked = 0;
    const naiveFails = [];

    for (const { hex, role, where } of rows) {
      for (const id of MATERIAL_FINISHES) {
        const m = applyFinish(hex, id, role);
        checked += 1;

        const unity = toUnity(m);
        const back = fromUnity(unity);
        // **재질 이름은 왕복 대상이 아니다.** 엔진 표기에 없는 것이라 되돌릴 수 없고,
        // 되돌리는 척하면 그게 거짓말이다. 왕복은 엔진이 실제로 들고 가는 물리 값까지다.
        if (JSON.stringify(back) !== JSON.stringify(enginePayload(m))) {
          bad.push(`${where}/${id}: 왕복이 안 맞다 ${JSON.stringify(enginePayload(m))} → ${JSON.stringify(unity)} → ${JSON.stringify(back)}`);
        }

        // 방향이 실제로 뒤집히는가. 같으면 변환이 아무 일도 안 한 것이다.
        if (unity.smoothness !== 1 - m.roughness && Math.abs(unity.smoothness - (1 - m.roughness)) > 1e-9) {
          bad.push(`${where}/${id}: smoothness ${unity.smoothness} 가 1 - roughness ${m.roughness} 와 다르다`);
        }

        // 언리얼 쪽은 내부 표현과 같은 방향이다. 이름만 갈린다.
        const unreal = toUnreal(m);
        if (unreal.roughness !== m.roughness) bad.push(`${where}/${id}: 언리얼 roughness 가 바뀌었다`);
        if (unreal.baseColor !== m.baseColor) bad.push(`${where}/${id}: 언리얼 baseColor 가 바뀌었다`);

        // 발광이 있으면 양쪽에 실려 나가야 한다. 빠지면 네온이 조용히 사라진다.
        if (m.emission) {
          if (unity.emissionColor !== m.emission.color) bad.push(`${where}/${id}: 유니티에 발광색이 안 실렸다`);
          if (unity.emissionIntensity !== m.emission.ev) bad.push(`${where}/${id}: 유니티에 EV 가 안 실렸다`);
          if (unreal.emissiveColor !== m.emission.color) bad.push(`${where}/${id}: 언리얼에 발광색이 안 실렸다`);
        }

        // 음성 대조 — 반올림 없는 순진한 변환이 어긋나는 자리를 센다.
        if (1 - (1 - m.roughness) !== m.roughness) naiveFails.push(m.roughness);
      }
    }

    if (bad.length) throw new Error(`${bad.length}건 — ${bad.slice(0, 3).join(" / ")}`);
    if (checked === 0) throw new Error("변환한 재질이 0건이다 — 이 게이트가 공허하다");
    if (naiveFails.length === 0) {
      throw new Error("반올림 없는 순진한 변환도 전부 왕복한다 — 이 게이트가 반올림이 하는 일을 안 보고 있다");
    }

    const naiveVals = [...new Set(naiveFails)].join(", ");
    out(`재질 ${checked}건이 유니티 왕복에서 정확히 제자리 (Smoothness = 1 - Roughness, 소수 셋째 자리 반올림)`);
    out(`음성 대조: 반올림이 없었다면 ${naiveFails.length}건이 어긋난다 — 러프니스 ${naiveVals}`);
    out("S16_G9_OK");
  },

  /**
   * **기본 배정이 모든 역할을 덮는다.** 어느 역할에 어떤 재질인지가 없으면 이 엔진을 화면에서
   * 쓸 수 없다. 스펙 4.5 가 요구하지만 게이트 번호를 안 준 자리라 뒤에 붙였다.
   *
   * **이 표가 곧 17단계(LLM 배정)의 폴백이다.** 두 번 만들지 않는다 — Ollama 가 없거나 모델이
   * 쓸 수 있는 답을 안 주면 여기로 물러선다. `selectStructures` 가 카탈로그 순서로 물러서는
   * 것과 같은 자리다.
   *
   * 원전에 없는 값이라 데이터가 아니라 코드에 있다 `[판단]`.
   *
   * 검사 넷:
   *   ① 실제로 나오는 역할 7가지가 전부 표에 있다 (빠지면 그 자리가 조용히 재질 없이 남는다)
   *   ② 표의 재질이 전부 실재한다 (없는 id 를 배정하면 화면이 고를 수 있는데 엔진이 모른다)
   *   ③ 재질 4개가 **전부 한 번 이상 쓰인다** — 안 쓰이는 재질은 이 표가 그것을 잊었다는 뜻이다
   *   ④ 발광이 **소수 역할에만** 붙는다. 전장이 발광하면 아무것도 빛나지 않는다
   */
  "S16-G11": async () => {
    const rows = everyRoleColor();
    const bad = [];
    const roles = [...new Set(rows.map((r) => r.role))];

    for (const role of roles) {
      if (!Object.hasOwn(DEFAULT_FINISH_BY_ROLE, role)) bad.push(`역할 ${role} 에 기본 재질이 없다`);
    }
    for (const [role, id] of Object.entries(DEFAULT_FINISH_BY_ROLE)) {
      if (!MATERIAL_FINISHES.includes(id)) bad.push(`${role} 에 없는 재질 ${id} 가 배정됐다`);
      if (!roles.includes(role)) bad.push(`표에 있는 역할 ${role} 이 실제 출력에 없다 — 죽은 항목`);
    }

    const used = new Set(Object.values(DEFAULT_FINISH_BY_ROLE));
    for (const id of MATERIAL_FINISHES) if (!used.has(id)) bad.push(`재질 ${id} 이 어느 역할에도 안 쓰인다`);

    const emissiveRoles = Object.entries(DEFAULT_FINISH_BY_ROLE).filter(([, id]) => id === "emissive");
    if (emissiveRoles.length === 0) bad.push("발광이 어느 역할에도 없다 — 네온을 만들 수 없다");
    if (emissiveRoles.length > roles.length / 2) {
      bad.push(`발광이 ${emissiveRoles.length}/${roles.length} 역할에 붙었다 — 전장이 빛나면 아무것도 안 빛난다`);
    }

    // 표를 실제로 돌려 본다. 배정된 재질이 그 역할에서 던지지 않아야 한다.
    let applied = 0;
    for (const { hex, role } of rows) {
      const id = DEFAULT_FINISH_BY_ROLE[role];
      if (!id) continue;
      try {
        applyFinish(hex, id, role);
        applied += 1;
      } catch (err) {
        bad.push(`기본 배정 ${role}→${id} 가 ${hex} 에서 던졌다: ${err.message}`);
        break;
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    if (applied !== rows.length) throw new Error(`기본 배정으로 만든 재질이 ${applied}건 — 역할색 ${rows.length}건 전부여야 한다`);

    out(`역할 ${roles.length}가지가 전부 배정됨 — ${Object.entries(DEFAULT_FINISH_BY_ROLE).map(([r, i]) => `${r}→${i}`).join(" · ")}`);
    out(`재질 ${MATERIAL_FINISHES.length}개가 전부 쓰이고 발광은 ${emissiveRoles.length}/${roles.length} 역할 · 역할색 ${applied}건 전부 적용됨`);
    out("S16_G11_OK");
  },
};

const id = process.argv[2];
const gate = Object.hasOwn(GATES, String(id)) ? GATES[id] : null;
if (!gate) {
  out(`쓰는 법: node scripts/check-stage16.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(2);
}

try {
  await gate();
} catch (err) {
  out(`${id} 실패: ${err.message}`);
  process.exit(1);
}
