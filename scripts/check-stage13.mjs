#!/usr/bin/env node
// 13단계(파생 팔레트를 화면에서 만지기) 완료 조건 검사기.
//   node scripts/check-stage13.mjs S13-G1

// 서버마다 빈 임시 데이터 폴더를 준다(27단계). 임베딩 캐시가 var/ 에 남게 되면서 게이트가 저장소 var/ 를
// 더럽히게 됐다(리뷰 지적). 명시적으로 넘긴 TONEFIRST_DATA_DIR 이 있으면 그것이 이긴다(뒤의 ...env).
import { mkdtempSync as gateMkdtemp } from "node:fs";
import { tmpdir as gateTmpdir } from "node:os";
import { join as gateJoin } from "node:path";
const gateDataDir = () => gateMkdtemp(gateJoin(gateTmpdir(), "tonefirst-gate-"));
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandAll, hexToHsl } from "../src/expand.js";
import { loadPalettes } from "../src/palettes.js";
import { loadSeeds } from "../src/seeds.js";
import { contrast, labelColor, chroma } from "../public/color.js";
import { MIN_SHARE, equalShares, ratioFor, redistribute, shareBounds } from "../public/ratio.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const allSeeds = () => [...loadPalettes(), ...loadSeeds()];
const sum = (a) => a.reduce((x, y) => x + y, 0);

/** 주석을 걷어낸 소스. 문자열 안의 URL 스킴은 남긴다 — check-stage10 이 같은 이유로 같은 예외를 둔다. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function startServer(port) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0" },
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

const gates = {
  // 3색 이상은 균등 분할이고 합이 정확히 100 이다. 합이 100 이 아니면 스와치 바에 틈이 생기거나
  // 마지막 색이 잘려, 화면이 말하는 비율과 보이는 비율이 달라진다.
  "S13-G1": async () => {
    const bad = [];

    for (let n = 1; n <= 8; n += 1) {
      const shares = equalShares(n);
      if (shares.length !== n) bad.push(`${n}색: 길이 ${shares.length}`);
      if (sum(shares) !== 100) bad.push(`${n}색: 합 ${sum(shares)}`);
      if (shares.some((v) => !Number.isInteger(v))) bad.push(`${n}색: 정수가 아니다`);
      // 균등이라면 가장 큰 것과 가장 작은 것의 차가 1 을 넘지 않는다(나머지 배분).
      if (Math.max(...shares) - Math.min(...shares) > 1) bad.push(`${n}색: 균등하지 않다 ${shares}`);
    }

    // 실제 파생 팔레트가 이 경로를 탄다.
    let checked = 0;
    for (const seed of allSeeds()) {
      for (const st of expandAll(seed)) {
        const r = ratioFor(st);
        checked += 1;
        if (r.length !== st.colors.length) bad.push(`${seed.id}/${st.id}: 길이가 색 수와 다르다`);
        if (sum(r) !== 100) bad.push(`${seed.id}/${st.id}: 합 ${sum(r)}`);
        if (Math.max(...r) - Math.min(...r) > 1) bad.push(`${seed.id}/${st.id}: 균등하지 않다`);
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`파생 팔레트 ${checked}장 전부 균등 · 합 100`);
    out("S13_G1_OK");
  },

  // 2색 규칙은 배색사전 D형 9쌍을 실측해 얻은 것이다. 다색을 붙이면서 이게 바뀌면 안 된다.
  "S13-G2": async () => {
    const bad = [];
    const corpus = loadPalettes();

    for (const p of corpus) {
      const r = ratioFor(p);
      if (r.length !== 2) bad.push(`${p.id}: 2색인데 ${r.length}개가 나왔다`);
      if (sum(r) !== 100) bad.push(`${p.id}: 합 ${sum(r)}`);

      if (p.type !== "D") {
        if (r[0] !== 50 || r[1] !== 50) bad.push(`${p.id}(${p.type}형): 대등인데 ${r} 이다`);
        continue;
      }
      // D형은 70:30 이고 바탕은 채도가 낮은 쪽이다.
      if (Math.max(...r) !== 70 || Math.min(...r) !== 30) bad.push(`${p.id}(D형): ${r} 이다`);
      const groundFirst = chroma(p.colors[0].hex) <= chroma(p.colors[1].hex);
      if ((groundFirst ? r[0] : r[1]) !== 70) bad.push(`${p.id}(D형): 바탕이 저채도 쪽이 아니다`);
    }

    // 양성 대조 — D형과 대등형이 둘 다 실제로 있어야 이 검사가 의미가 있다.
    const types = new Set(corpus.map((p) => p.type));
    if (!types.has("D")) bad.push("코퍼스에 D형이 없다 — 이 게이트가 헛돌고 있다");
    if (![...types].some((t) => t !== "D")) bad.push("코퍼스에 대등형이 없다 — 이 게이트가 헛돌고 있다");

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`코퍼스 ${corpus.length}쌍 면적 규칙 그대로`);
    out("S13_G2_OK");
  },

  // 슬라이더를 아무렇게나 움직여도 합은 100 이고 어느 색도 최소 지분 아래로 안 간다.
  // 정해진 몇 케이스만 보면 반올림·바닥 충돌이 겹치는 조합을 놓친다 — 무작위로 오래 굴린다.
  "S13-G3": async () => {
    const bad = [];
    const seen = { min: 100, max: 0 };

    // 경계와 이상값을 먼저 못 박는다.
    const fixed = [
      [[50, 50], 0, 99, 2],
      [[50, 50], 0, -50, 2],
      [[25, 25, 25, 25], 0, 100, 4],
      [[34, 33, 33], 1, 60, 3],
      [[90, 10], 1, 90, 2],
      // 최소 지분과 색 개수가 동시에 성립하지 않는 구간. 하한이 개수에 맞춰 내려간다.
      [Array(11).fill(9).map((v, i) => (i === 0 ? 10 : v)), 0, 10, 11],
      [Array(20).fill(5), 0, 60, 20],
      [Array(50).fill(2), 0, 90, 50],
    ];
    for (const [shares, i, next, n] of fixed) {
      const r = redistribute(shares, i, next);
      if (r.length !== n) bad.push(`고정 케이스 길이 ${r.length}`);
      if (sum(r) !== 100) bad.push(`고정 케이스 합 ${sum(r)} — ${JSON.stringify(r)}`);
      if (Math.min(...r) < shareBounds(n).min) bad.push(`고정 케이스(n=${n}) 최소 지분 위반 ${JSON.stringify(r)}`);
    }

    // 잘못된 입력에 던지지 않는다.
    for (const [shares, i, next] of [
      [[], 0, 50],
      [[100], 0, 50],
      [[50, 50], -1, 50],
      [[50, 50], 9, 50],
      [[50, 50], 0, NaN],
      [[50, 50], 1.5, 50],
    ]) {
      try {
        const r = redistribute(shares, i, next);
        if (!Array.isArray(r)) bad.push(`이상 입력이 배열을 안 냈다: ${JSON.stringify([shares, i, next])}`);
      } catch (err) {
        bad.push(`이상 입력에서 던졌다 ${JSON.stringify([shares, i, next])} — ${err.message}`);
      }
    }

    // 결정적 난수 — 실패하면 같은 씨앗으로 재현된다. Math.random 을 쓰면 재현이 안 된다.
    let state = 20260906;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    let runs = 0;
    for (let t = 0; t < 40000 && bad.length === 0; t += 1) {
      // **색 개수를 3~4 로 묶지 않는다.** 지금 구조는 3~4색뿐이지만 이건 화면과 서버가 함께 쓰는
      // 공유 계산이고, 다음 단계에서 색이 늘면 조용히 깨진다 — n=11 에서 합이 110 이 나왔다(리뷰 지적).
      const n = 2 + Math.floor(rand() * 30);
      let shares = equalShares(n);
      for (let k = 0; k < 6; k += 1) {
        shares = redistribute(shares, Math.floor(rand() * n), Math.floor(rand() * 140) - 20);
        runs += 1;
        const total = sum(shares);
        const lo = Math.min(...shares);
        const floor = shareBounds(n).min;
        seen.min = Math.min(seen.min, lo);
        seen.max = Math.max(seen.max, Math.max(...shares));
        if (total !== 100) bad.push(`합 ${total} — ${JSON.stringify(shares)}`);
        if (lo < floor) bad.push(`n=${n} 최소 지분(${floor}) 위반 ${JSON.stringify(shares)}`);
        if (shares.length !== n) bad.push(`길이가 변했다 ${JSON.stringify(shares)}`);
        if (shares.some((v) => !Number.isInteger(v))) bad.push(`정수가 아니다 ${JSON.stringify(shares)}`);
        if (bad.length) break;
      }
    }

    if (bad.length) throw new Error(bad.slice(0, 3).join(" / "));
    out(`무작위 ${runs}회 (색 2~31개) — 합 100 유지, 지분 ${seen.min}~${seen.max} · 기본 하한 ${MIN_SHARE}`);
    out("S13_G3_OK");
  },

  // /api/expand 가 코퍼스와 씨앗 풀 **양쪽**에서 찾는다. 한쪽만 보면 24쌍이 통째로 사라진다.
  "S13-G4": async () => {
    const corpusId = loadPalettes()[0].id;
    const pool = loadSeeds();
    const poolId = pool[0]?.id;
    if (!poolId) throw new Error("씨앗 풀이 비어 있어 이 게이트가 검사할 것이 없다");

    const bad = await withServer(4197, async (get) => {
      const found = [];
      for (const [label, id] of [["코퍼스", corpusId], ["씨앗 풀", poolId]]) {
        const res = await get(`/api/expand?seed=${encodeURIComponent(id)}`);
        if (res.status !== 200) {
          found.push(`${label} ${id}: ${res.status}`);
          continue;
        }
        const body = await res.json();
        if (body.seed?.id !== id) found.push(`${label}: 다른 씨앗을 줬다 ${body.seed?.id}`);
        if (!body.seed?.label) found.push(`${label}: 이름이 없다`);
        if (body.structures?.length !== 8) found.push(`${label}: 구조 ${body.structures?.length}개`);
        for (const st of body.structures ?? []) {
          if (!st.name || !st.principle || !st.source) found.push(`${label}/${st.id}: 이름·원리·출처 누락`);
          if (!Array.isArray(st.colors) || st.colors.length < 2) found.push(`${label}/${st.id}: 색이 없다`);
          for (const c of st.colors ?? []) {
            if (!/^#[0-9a-f]{6}$/.test(c.hex ?? "")) found.push(`${label}/${st.id}: 헥스 ${c.hex}`);
            if (!c.role) found.push(`${label}/${st.id}: 역할 이름이 없다`);
          }
        }
        // 면적은 응답에 없다. 검색 응답과 같은 규칙 — 화면이 public/ratio.js 로 계산한다.
        if (body.structures?.some((st) => "ratio" in st)) found.push(`${label}: 응답이 면적을 들고 나온다`);
      }

      // 서버가 요청의 색을 믿지 않는다 — 색을 보내도 무시하고 코퍼스 값을 쓴다.
      const spoof = await get(`/api/expand?seed=${encodeURIComponent(corpusId)}&hex=%23ff0000`);
      const spoofed = await spoof.json();
      const real = loadPalettes()[0].colors.map((c) => c.hex.toLowerCase());
      const got = spoofed.seed.colors.map((c) => c.hex.toLowerCase());
      if (JSON.stringify(got) !== JSON.stringify(real)) found.push(`요청이 준 색이 응답에 섞였다: ${got}`);

      return found;
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`코퍼스·씨앗 풀 양쪽에서 8구조 · 요청 색은 무시`);
    out("S13_G4_OK");
  },

  // 잘못된 입력에 4xx 로 답하고, 무엇보다 서버가 죽지 않는다.
  // 6단계에서 format=__proto__ 한 번에 프로세스가 끝난 적이 있다.
  "S13-G5": async () => {
    const cases = [
      ["없는 씨앗", "?seed=nope", 404],
      ["빈 씨앗", "?seed=", 400],
      ["seed 없음", "", 400],
      ["공백만", "?seed=%20%20", 400],
      ["너무 김", `?seed=${"a".repeat(61)}`, 400],
      ["__proto__", "?seed=__proto__", 404],
      ["constructor", "?seed=constructor", 404],
      ["toString", "?seed=toString", 404],
      ["경로 이탈", "?seed=..%2F..%2Fserver.js", 404],
    ];

    const bad = await withServer(4198, async (get) => {
      const found = [];
      for (const [label, query, want] of cases) {
        const res = await get(`/api/expand${query}`);
        if (res.status !== want) found.push(`${label}: ${res.status} (기대 ${want})`);
        const body = await res.text();
        // 내부 경로가 새지 않는다.
        if (/[A-Za-z]:\\|\/home\/|node_modules/.test(body)) found.push(`${label}: 응답에 내부 경로가 있다`);
      }
      // 위를 전부 맞고도 서버가 살아 있어야 한다.
      const alive = await get("/api/status");
      if (alive.status !== 200) found.push(`이상 요청 뒤 서버가 죽었다 (${alive.status})`);
      // 양성 대조 — 정상 요청은 여전히 200 이다.
      const ok = await get(`/api/expand?seed=${encodeURIComponent(loadPalettes()[0].id)}`);
      if (ok.status !== 200) found.push(`정상 요청이 ${ok.status} — 이 게이트가 헛돌고 있다`);
      return found;
    });

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`이상 입력 ${cases.length}종 4xx · 서버 생존`);
    out("S13_G5_OK");
  },

  /*
   * 파생색은 코퍼스에 없던 색이다. S2-G5 는 코퍼스 32색만 보므로 여기가 그 밖을 덮는다.
   *
   * **첫 판은 아무것도 검사하지 않았다.** "labelColor 결과가 4.5 를 넘는가" 만 봤는데,
   * labelColor 는 후보에 흰색과 순검정을 함께 들고 있고 그 둘은 어떤 배경에서도 최소 4.58 을
   * 보장한다(public/color.js). 그래서 파생 색이 어떻게 바뀌든 통과한다 — 실제로 명도 앵커를
   * 0.55~0.7 로 뭉개는 뮤테이션을 통째로 놓쳤다.
   *
   * 그래서 두 가지를 더 본다.
   *   1. **후보가 실제로 4.5 를 넘겨서** 골라졌는가. labelColor 는 아무도 못 넘기면 그중 나은
   *      것으로 물러선다(`??` 뒤). 그 자리로 떨어지면 화면 글자가 안 읽힌다. 후보 집합을
   *      건드리는 회귀는 여기서 걸린다.
   *   2. **이 계산에 이빨이 있는가.** 고정 회색 라벨을 대조로 넣어, 파생색 중 적어도 하나는
   *      실제로 4.5 아래로 떨어지는 것을 확인한다. 안 떨어지면 대비 계산 자체가 죽은 것이다.
   */
  "S13-G6": async () => {
    let worst = { c: 99 };
    let fellBack = 0;
    let count = 0;
    let naiveFails = 0;
    const NAIVE = "#888888"; // 고정 라벨을 썼다면 어땠을지 — 이 검사의 음성 대조

    for (const seed of allSeeds()) {
      for (const st of expandAll(seed)) {
        for (const c of st.colors) {
          count += 1;
          const picked = labelColor(c.hex);
          const ratio = contrast(picked, c.hex);
          if (ratio < worst.c) worst = { c: ratio, where: `${seed.id}/${st.id}/${c.role} ${c.hex}` };
          // 후보 셋 중 4.5 를 넘긴 것이 하나도 없어 물러선 경우.
          if (ratio < 4.5) fellBack += 1;
          if (contrast(NAIVE, c.hex) < 4.5) naiveFails += 1;
        }
      }
    }

    if (fellBack) {
      throw new Error(`labelColor 가 4.5 를 못 넘겨 물러선 색 ${fellBack}개 — 최악 ${worst.c.toFixed(2)} ${worst.where}`);
    }
    // 이 검사가 살아 있다는 증거. 고정 라벨이 전부 통과한다면 대비 계산이 죽은 것이다.
    if (naiveFails === 0) {
      throw new Error("고정 회색 라벨조차 파생색 전부에서 4.5 를 넘는다 — 대비 계산이 죽었다");
    }

    out(`파생색 ${count}개 · 대비 최솟값 ${worst.c.toFixed(2)} — ${worst.where}`);
    out(`음성 대조: 고정 라벨 ${NAIVE} 였다면 ${naiveFails}개가 4.5 미만`);
    out("S13_G6_OK");
  },

  // 정적 검사다 — 회귀 스모크지 동작 증명이 아니다. 실제 동작은 브라우저에서 따로 확인했다.
  "S13-G7": async () => {
    const bad = [];
    const ui = stripComments(read("public/ui.js"));
    const app = stripComments(read("public/app.js"));
    const css = read("public/app.css");

    if (!/export function shareControl/.test(ui)) bad.push("shareControl 이 없다");
    if (!/export function structureCard/.test(ui)) bad.push("structureCard 가 없다");
    // 색마다 슬라이더를 만든다 — colors 를 돌면서 range 를 만드는 형태여야 한다.
    if (!/colors\.map\(/.test(ui)) bad.push("색마다 줄을 만드는 곳이 없다");
    if (!/type = "range"/.test(ui)) bad.push("슬라이더가 없다");
    // 합 100 은 redistribute 가 지킨다. 화면이 직접 계산하기 시작하면 두 곳이 갈린다.
    if (!/redistribute\(/.test(ui)) bad.push("ui 가 redistribute 를 안 쓴다");
    if (/100 - .*shares\[/.test(ui)) bad.push("화면이 비율을 직접 계산한다 — redistribute 로 모은다");
    // **슬라이더 범위도 계산과 같은 곳에서 와야 한다.** 두 곳이 각자 계산하면 사용자가 움직인
    // 값을 계산이 조용히 되돌린다 — 2색에서 S5-G4 가 같은 이유로 같은 규칙을 건다.
    if (!/shareBounds\(/.test(ui)) bad.push("ui 가 shareBounds 를 안 쓴다");
    if (!/slider\.min = String\(bounds\.min\)/.test(ui)) bad.push("슬라이더 하한이 shareBounds 에서 오지 않는다");
    if (!/slider\.max = String\(bounds\.max\)/.test(ui)) bad.push("슬라이더 상한이 shareBounds 에서 오지 않는다");
    // 슬라이더가 스와치를 실제로 갱신해야 만져 보는 의미가 있다.
    if (!/onInput/.test(ui)) bad.push("슬라이더 입력을 받는 곳이 없다");
    if (!/view\.set\(/.test(ui)) bad.push("슬라이더가 스와치를 갱신하지 않는다");

    if (!/\/api\/expand\?seed=/.test(app)) bad.push("화면이 /api/expand 를 부르지 않는다");
    if (!/structureCard\(/.test(app)) bad.push("구조 카드를 그리는 곳이 없다");
    // **색을 보내지 않는다.** 씨앗 id 만 보낸다.
    if (/\/api\/expand\?[^`"']*hex=/.test(app)) bad.push("화면이 색을 서버로 보낸다");
    // 실패를 삼키면 사용자는 빈 칸을 보고 구조가 없다고 읽는다.
    if (!/펼치지 못했습니다/.test(app)) bad.push("펼치기 실패를 알리는 곳이 없다");

    for (const cls of ["expand__toggle", "expand__grid", "struct__name", "shares__slider"]) {
      if (!css.includes(`.${cls}`)) bad.push(`${cls} 스타일이 없다`);
    }

    // **펼치기 버튼은 눈에 띄어야 한다.** 평범한 회색 버튼이었을 때 사용자가 3색 조합을 못 찾았다 —
    // 카드 맨 끝(문서 Y=1203, 뷰포트 724)에 있고 앞에 2색 면적 슬라이더가 있어서, 그것을 보고
    // "면적 조절은 이게 전부" 로 읽힌다. 강조가 조용히 걷히면 그 증상이 그대로 돌아온다.
    const toggleRule = css.match(/\.expand__toggle\s*\{[^}]*\}/)?.[0] ?? "";
    if (!toggleRule) bad.push("expand__toggle 규칙을 찾지 못했다");
    if (!/var\(--accent-soft\)/.test(toggleRule)) bad.push("펼치기 버튼이 강조색 면을 쓰지 않는다");
    if (!/var\(--accent-ink\)/.test(toggleRule)) bad.push("펼치기 버튼 글자가 강조색이 아니다");
    // 접힘·펼침을 aria-expanded 하나로 나타낸다. 화면 표시와 보조기술이 같은 값에서 나와야 한다.
    //
    // **선택자가 있는지가 아니라 규칙 본문을 본다.** 처음엔 이름만 찾았는데, 규칙을 통째로 지워도
    // `[aria-expanded="true"]:hover` 와 reduced-motion 블록의 `::after` 가 대신 걸려 통과했다(실측).
    const expandedRule = css.match(/\.expand__toggle\[aria-expanded="true"\]\s*\{[^}]*\}/)?.[0] ?? "";
    if (!/color:/.test(expandedRule)) bad.push("펼친 상태 스타일이 없다");

    const chevron = css.match(/\.expand__toggle::after\s*\{[^}]*\}/)?.[0] ?? "";
    if (!/content:/.test(chevron)) bad.push("방향 표시(화살표)가 없다");
    if (!/\.expand__toggle\[aria-expanded="true"\]::after\s*\{[^}]*transform/.test(css)) {
      bad.push("펼쳤을 때 화살표 방향이 안 바뀐다");
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("S13_G7_OK");
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
