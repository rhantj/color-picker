# 캐릭터 외형 설명 → 부위별 색 추천 구현 계획 (34단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈에 "색감 추천 · 캐릭터 색감" 탭 둘을 두고, 캐릭터 외형 문장에서 부위 여섯(피부·머리·눈·상의·하의·강조)의 색과 재질을 코퍼스 80색만으로 골라 카드 한 장으로 주고, 저장·`/saved`·엔진 내보내기까지 지금 파생 저장의 길로 태운다.

**Architecture:** LLM(`src/describe.js`)은 문장에서 *부위 → 색 낱말 id* 와 *인상 한 줄* 만 뽑고 색에 닿지 않는다. 인상은 기존 검색(`pipeline.resolve`)으로 배색 쌍 하나를 고르고, `src/character.js` 의 순수 함수가 말한 색(코퍼스 최근접) · 배색 쌍 · 종족표 · HSL 규칙으로 여섯 색을 만든다. 저장은 부위·종족·배색 쌍 id 만 받아 서버가 색을 다시 계산한다. 화면은 `structureCard` 를 그대로 재사용한다.

**Tech Stack:** Node 24 ESM · 의존성 0 · Ollama `/api/chat`(`exaone3.5:7.8b`, `format: "json"`) · 기존 BM25+임베딩 검색 · 게이트 검사기 `scripts/check-stage34.mjs` · DOM 스텁 `scripts/lib/dom-stub.mjs`

**Spec:** `docs/superpowers/specs/2026-09-13-character-colors-design.md`

## Global Constraints

- 의존성 0 (`S1-G4`). `node_modules` 없이 돈다.
- **LLM 은 색에 닿지 않는다.** 응답의 모든 헥스는 코퍼스 80색(팔레트 16쌍 32색 + 씨앗 24쌍 48색)이거나 `basis`(코퍼스 헥스)에서 HSL 연산한 값이다.
- **화면이 보낸 색을 안 믿는다.** `POST /api/saved/character` 는 `query · parts · creature · paletteId · shares? · finishes? · note?` 만 받는다.
- **없어도 돈다.** Ollama 부재·시간 초과·응답 불량은 정규식 폴백(`parse.from: "fallback"`), 검색이 배색 쌍을 못 고르면 `pair-01`(`palette.from: "fallback"`). 어느 경우도 500 이 아니다.
- **화면에 "LLM" 이라는 글자가 없다**(S31-G1 이 index.html · app.js · ui.js 를 본다).
- **숫자는 `src/` 에, 낱말은 `data/` 에.** 데이터 파일에 숫자·헥스가 생기면 안 된다(S34-G2).
- `localStorage` 를 만지는 자리는 `public/ui.js` 의 `defaultStorage` **한 곳**이다(S23-G6 이 글자 수를 센다 — **새 주석에도 그 낱말을 쓰지 않는다**).
- `DEFAULT_FINISH_BY_ROLE` 은 **안 건드린다**(S16-G11·S17-G8 이 파생 역할과 정확히 같다고 잠갔다). 캐릭터는 `CHARACTER_FINISH_BY_ROLE` 별도 표.
- 감시 값(수치·픽스처·역할 목록·재질 목록)은 검사기에 **사본**으로 적는다. 대상에서 import 하지 않는다.
- 게이트는 구현보다 먼저 쓰고 전부 실패하는 것을 본다. 게이트 수 227 → 237 을 네 곳(실제 실행 · `GATES.md` · README 선언 · README 표)에 맞춘다(S22-G6).
- 게이트가 저장소 `data/`·`var/` 를 오염시키지 않는다 — 서버는 임시 `TONEFIRST_DATA_DIR` 로 띄운다.
- 커밋은 대표 확인 뒤. 브랜치 `stage-34-character-colors`, `main` 에 `--ff-only` 머지.
- 설명은 쉬운 말 먼저(프로젝트 `CLAUDE.md`). 주석은 WHY 만.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `data/character-words.json` (새) | 색 낱말 id → 표면형 · 부위 id → 표면형 · 복합어(금발 …). 낱말만, 숫자 없음 |
| `data/creatures.json` (새) | 종족 낱말 → 피부 색 낱말 id · 재질. 낱말만 |
| `src/color-words.js` (새) | 낱말 id → 범위 숫자 `RANGES` · `nearestCorpus` · `loadCharacterWords` · `loadCreatures` · `findCreature` |
| `src/character.js` (새) | `CHARACTER_ROLES` · `composeCharacter` 순수 함수 · 규칙 수치 전부 |
| `src/describe.js` (새) | 프롬프트 · `parseDescription` · `fallbackParse` · `describe` |
| `src/material.js` | `CHARACTER_FINISH_BY_ROLE` · `EV_BY_ROLE` 다섯 역할 |
| `src/finish.js` | `selectFinishes(query, roles, defaults)` · `fallbackAssignment(roles, defaults)` |
| `src/store.js` | `saveCharacter` · `recordTurn` 의 `character` 경로 |
| `src/export.js` | 캐릭터 항목의 엔진 id 를 저장 id 로 |
| `server.js` | `GET /api/character` · `POST /api/saved/character` · 코퍼스 80색 · `resolveCharacter` |
| `public/index.html` · `app.css` | 탭 둘 · 캐릭터 결과 영역 · 예시 칩 |
| `public/ui.js` | `tabStore` · `characterStructure` · `sourceLine` · `savedFields` 캐릭터 분기 |
| `public/app.js` | 탭 전환 · `/api/character` 호출 · 카드 · 저장 · 턴 기록 |
| `public/history.js` | 라벨 "캐릭터" · 다시 묻기 링크 `&tab=character` |
| `scripts/check-stage34.mjs` (새) | S34-G1 ~ G10 |
| `GATES.md` · `README.md` · `docs/session-resume/2026-09-13-character-colors-34.md` · `docs/com/open-work.md` | 기록 |

---

### Task 0: 게이트를 먼저 적는다 (GATES.md 34단계 절 + 검사기 전체)

**Files:**
- Modify: `GATES.md` (끝에 절 추가)
- Create: `scripts/check-stage34.mjs`

**Interfaces:**
- Produces: `node scripts/check-stage34.mjs S34-G<n>` → 통과 시 `S34_G<n>_OK` · exit 0. 인자 없이 부르면 id 목록(S22-G6 이 그렇게 센다).
- Consumes (Task 1~7 이 만들 것): `src/color-words.js` — `RANGES`, `nearestCorpus(wordId, corpus, used)`, `loadCharacterWords()`, `loadCreatures()`, `findCreature(text, creatures)`; `src/describe.js` — `parseDescription(raw, words, query)`, `fallbackParse(query, words)`; `src/character.js` — `CHARACTER_ROLES`, `composeCharacter({parts, creature, pair, corpus})`; `public/ui.js` — `tabStore`, `characterStructure`, `savedFields`.

- [ ] **Step 1: `GATES.md` 끝에 34단계 절을 붙인다**

```markdown

## 34단계 — 캐릭터 외형 설명 → 부위별 색 (대표 요청)

"붉은 머리에 검은 갑옷, 차가운 성격의 기사" 처럼 캐릭터 외형을 문장으로 쓰면 **부위 여섯**(피부·머리·눈·상의·하의·강조)의
색과 재질을 카드 한 장으로 준다. 홈 검색창 위에 탭 둘(색감 추천 · 캐릭터 색감). LLM 은 문장에서 *부위 → 색 낱말* 과
*인상* 만 뽑고, 헥스는 전부 코퍼스 80색이거나 그 HSL 연산 결과다. 저장은 부위·종족·배색 쌍 id 만 받아 서버가 색을 다시
계산한다(`store.js` 규칙 4). 설계: `docs/superpowers/specs/2026-09-13-character-colors-design.md`

S34-G1 파서가 표 밖의 것을 버린다 — 없는 부위·없는 색 낱말·헥스·프로토타입 이름 · 인상은 비면 문장 전체 · 정규식 폴백이 "빨간 머리"·"검은 갑옷"·"금발" 을 잡고 "머리 빨간" 은 안 잡는다
    CHECK: node scripts/check-stage34.mjs S34-G1
    EXPECT: S34_G1_OK

S34-G2 낱말표(`data/character-words.json`)와 범위표(`src/color-words.js`)의 id 집합이 같다 · 종족표의 피부 낱말이 전부 낱말표에 있다 · 모든 낱말이 코퍼스 80색 중 하나로 결정적으로 간다 · 두 데이터 파일에 숫자·헥스가 없다
    CHECK: node scripts/check-stage34.mjs S34-G2
    EXPECT: S34_G2_OK

S34-G3 **지어낸 색 0** — 픽스처 10건의 모든 헥스가 코퍼스 80색이거나 `basis`(코퍼스)에서 검사기 사본 규칙(l −0.18 · s ×0.85)으로 다시 계산한 값과 같다
    CHECK: node scripts/check-stage34.mjs S34-G3
    EXPECT: S34_G3_OK

S34-G4 말한 부위는 고정된다 · 종족이 피부를 정한다(로봇 → gray · 트롤 → green) · 말한 피부가 종족을 이긴다 · 종족 없으면 따뜻한 뉴트럴(음성 대조)
    CHECK: node scripts/check-stage34.mjs S34-G4
    EXPECT: S34_G4_OK

S34-G5 픽스처마다 색상각 30° 구획이 정한 수 이상 · 규칙으로 고른 이웃끼리 명도차 ≥ 0.12 · 여섯 부위 순서 고정 · 헥스 중복 없음(말한 색 제외)
    CHECK: node scripts/check-stage34.mjs S34-G5
    EXPECT: S34_G5_OK

S34-G6 Ollama 없이 `/api/character` 가 돈다 — 폴백 파서 · 배색 쌍 · 6색 · 빈 q 400 · 홈 HTML 에 "LLM" 없음
    CHECK: node scripts/check-stage34.mjs S34-G6
    EXPECT: S34_G6_OK

S34-G7 스텁 Ollama 가 헥스·엉뚱한 부위를 실어 보내도 응답에 안 닿는다 · 모델이 준 인상이 검색에 쓰여 배색 쌍이 그 인상의 답과 같다(`parse.from: "llm"`)
    CHECK: node scripts/check-stage34.mjs S34-G7
    EXPECT: S34_G7_OK

S34-G8 저장 왕복 — 본문의 가짜 색을 무시하고 재계산 · 종족 재질이 기본으로 실림 · `/api/saved` 에 6색 파생 항목 · unreal/unity 에 6역할(로봇 피부 metallic 1) · CSS/JSON 은 건너뜀 · `savedFields` 가 "캐릭터"
    CHECK: node scripts/check-stage34.mjs S34-G8
    EXPECT: S34_G8_OK

S34-G9 화면 — 탭 둘("색감 추천"·"캐릭터 색감") · 캐릭터 탭이 `/api/character` 로 감 · 저장소 접근은 여전히 ui.js 한 곳 · `tabStore` 가 모르는 값을 안 믿음 · 내역 라벨 · `structureCard` 재사용 (정적 + DOM 스텁)
    CHECK: node scripts/check-stage34.mjs S34-G9
    EXPECT: S34_G9_OK

S34-G10 회귀 — S4 7 · S16 11 · S17 12 · S18 13 · S20 7 · S22 6 · S23 6 · S31 3 = 65
    CHECK: node scripts/check-stage34.mjs S34-G10
    EXPECT: S34_G10_OK

### 알려진 한계 (34단계)

- (구현하면서 채운다 — 최소한 코퍼스에 흰색이 없어 "흰" 이 아이보리 부근이 되는 것 · 80항목 중 유일 헥스 70 · 탭 클릭 핸들러는 DOM 스텁이 못 타서 브라우저 실측으로 대신한 것을 적는다)
```

- [ ] **Step 2: 검사기를 통째로 쓴다**

`scripts/check-stage34.mjs`:

```js
#!/usr/bin/env node
// 34단계(캐릭터 외형 → 부위별 색) 완료 조건 검사기.
//   node scripts/check-stage34.mjs S34-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 열 게이트가 전부 실패하는 것을 확인한 뒤에 src·public 을 고쳤다.
//
// 감시 값(역할 목록·재질 목록·규칙 수치·픽스처)은 대상에서 import 하지 않고 여기 사본으로 적는다 —
// 이 저장소가 "게이트가 감시 대상에서 값을 가져오면 함께 느슨해진다" 로 여러 번 뚫렸다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { hexToHsl, hslToHex } from "../src/expand.js";
import { installDom } from "./lib/dom-stub.mjs";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const gateDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-gate-"));
const stripJs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const stripHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");

/* ── 사본 ─────────────────────────────────────────────────── */
const ROLES = Object.freeze(["피부", "머리", "눈", "상의", "하의", "강조"]);
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const LOWER_L_DELTA = 0.18; // 하의 = 상의 명도 −0.18
const LOWER_S_FACTOR = 0.85; // 하의 = 상의 채도 ×0.85
const LOWER_L_FLOOR = 0.08;
const NEIGHBOR_MIN_L_GAP = 0.12;
const HUE_BUCKET = 30;
const CHROMATIC_MIN_S = 0.15;
const IMPRESSION_MAX = 120;
const TAB_KEY = "tonefirst:tab";
const TAB_LABELS = ["색감 추천", "캐릭터 색감"];

/** 코퍼스 80색. 팔레트 16쌍 + 씨앗 24쌍. 대상(server.js)이 아니라 데이터에서 직접 읽는다. */
function corpus() {
  const { palettes } = JSON.parse(read("data/palettes.json"));
  const { seeds } = JSON.parse(read("data/seeds.json"));
  return [
    ...palettes.flatMap((p) => p.colors.map((c) => ({ hex: c.hex, name: c.name }))),
    ...seeds.flatMap((s) => s.colors.map((c) => ({ hex: c.hex, name: c.origName }))),
  ];
}
const pairById = (id) => JSON.parse(read("data/palettes.json")).palettes.find((p) => p.id === id);
const up = (hex) => String(hex).toUpperCase();
const hueGap = (a, b) => {
  const d = Math.abs(((a % 360) + 360) % 360 - (((b % 360) + 360) % 360));
  return d > 180 ? 360 - d : d;
};

/**
 * 픽스처 10건. `parts` 는 정규식 폴백이 잡아야 하는 것(G1 이 따로 본다) — 여기서는 파서를 거치지 않고
 * 그 결과를 직접 넣어 규칙만 잰다. `pair` 는 검색 대신 고정한다(결정적). `minHues` 는 30° 구획 수 하한 —
 * 회색·검정을 말한 픽스처는 낮다.
 */
const FIXTURES = Object.freeze([
  // minHues 는 손으로 센 예상값이다 — 검정·회색은 구획에 안 세고, 하의·눈은 상의·강조 구획에 앉는다. 구현 뒤 실측이 더 크면 올린다.
  { q: "붉은 머리에 검은 갑옷, 차가운 성격의 기사", parts: { 머리: "red", 상의: "black" }, creature: null, pair: "pair-02", minHues: 3 },
  { q: "로봇 병사, 은색 갑옷", parts: { 상의: "gray" }, creature: "robot", pair: "pair-03", minHues: 1 },
  { q: "트롤 전사", parts: {}, creature: "troll", pair: "pair-05", minHues: 3 },
  { q: "파란 피부의 로봇", parts: { 피부: "blue" }, creature: "robot", pair: "pair-07", minHues: 2 },
  { q: "금발에 초록 눈, 흰 드레스의 공주", parts: { 머리: "gold", 눈: "green", 상의: "white" }, creature: null, pair: "pair-01", minHues: 3 },
  { q: "좀비 해적, 갈색 코트", parts: { 상의: "brown" }, creature: "zombie", pair: "pair-09", minHues: 3 },
  { q: "보라 로브의 마법사, 신비로운", parts: { 상의: "purple" }, creature: "human", pair: "pair-11", minHues: 3 },
  { q: "분홍 머리 소녀, 밝고 상큼한", parts: { 머리: "pink" }, creature: null, pair: "pair-13", minHues: 3 },
  { q: "검은 옷의 암살자, 붉은 눈", parts: { 상의: "black", 눈: "red" }, creature: null, pair: "pair-15", minHues: 3 },
  { q: "유령 소년, 창백하고 슬픈", parts: {}, creature: "ghost", pair: "pair-16", minHues: 2 },
]);

const fullParts = (partial) => Object.fromEntries(ROLES.map((r) => [r, partial[r] ?? null]));

async function loadTargets() {
  const cw = await import("../src/color-words.js");
  const ch = await import("../src/character.js");
  const creatures = cw.loadCreatures();
  const byId = (id) => (id ? creatures.find((c) => c.id === id) ?? null : null);
  const compose = (f) => ch.composeCharacter({ parts: fullParts(f.parts), creature: byId(f.creature), pair: pairById(f.pair), corpus: corpus() });
  return { cw, ch, creatures, compose };
}

/* ── 서버·스텁 ────────────────────────────────────────────── */
function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", EMBED_PREPARE: "0", ...env },
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

/** 가짜 Ollama. 시스템 프롬프트로 파서 호출과 재질 호출을 가른다. */
function stubOllama(port, { parserReply, finishReply }) {
  const seen = { parser: 0, finish: 0, bodies: [] };
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }] }));
    }
    if (req.url === "/api/chat") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      seen.bodies.push(raw);
      const isParser = raw.includes("파서");
      if (isParser) seen.parser += 1;
      else seen.finish += 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: isParser ? parserReply : finishReply } }));
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, seen })));
}

const post = (port, path, body) =>
  fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) });

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

/* ── 게이트 ───────────────────────────────────────────────── */
const GATES = {
  "S34-G1": async () => {
    const bad = [];
    const { parseDescription, fallbackParse } = await import("../src/describe.js");
    const { loadCharacterWords } = await import("../src/color-words.js");
    const words = loadCharacterWords();
    const q = "시험 문장";

    // 쓰레기 응답 — 헥스·없는 부위·없는 낱말·프로토타입 이름·문자열 아닌 값
    const garbage = '{"parts":{"머리":"#FF0000","상의":"black","손":"red","__proto__":"red","눈":3,"피부":"velvet"},"impression":"어두운 느와르","hex":"#123456"}';
    const g = parseDescription(garbage, words, q);
    if (Object.keys(g.parts).length !== 6 || ROLES.some((r) => !Object.hasOwn(g.parts, r))) bad.push(`parts 가 여섯 부위 전부를 담지 않는다: ${Object.keys(g.parts).join(",")}`);
    if (g.parts.머리 !== null) bad.push(`헥스가 색 낱말로 통과했다: ${g.parts.머리}`);
    if (g.parts.상의 !== "black") bad.push(`정상 낱말 black 이 안 남았다: ${g.parts.상의}`);
    if (Object.hasOwn(g.parts, "손")) bad.push("없는 부위 '손' 이 남았다");
    if (g.parts.눈 !== null || g.parts.피부 !== null) bad.push("문자열 아닌 값·없는 낱말이 남았다");
    if (g.impression !== "어두운 느와르") bad.push(`인상이 그대로 안 왔다: ${g.impression}`);
    if (JSON.stringify(g).includes("#")) bad.push("파서 결과에 헥스가 있다");
    if (g.matched !== 1) bad.push(`matched 가 ${g.matched} (기대 1)`);

    for (const raw of ["not json", "[]", "null", '{"parts":[]}', '{"parts":{"머리":"red"},"impression":""}']) {
      const p = parseDescription(raw, words, q);
      if (!ROLES.every((r) => Object.hasOwn(p.parts, r))) bad.push(`${raw}: 부위 여섯이 없다`);
      if (typeof p.impression !== "string" || !p.impression) bad.push(`${raw}: 인상이 비었다`);
    }
    const emptyImp = parseDescription('{"parts":{},"impression":"   "}', words, q);
    if (emptyImp.impression !== q) bad.push(`빈 인상이 문장 전체로 안 돌아왔다: ${emptyImp.impression}`);
    const longImp = parseDescription(JSON.stringify({ parts: {}, impression: "가".repeat(500) }), words, q);
    if ([...longImp.impression].length > IMPRESSION_MAX) bad.push(`인상이 ${[...longImp.impression].length}자 — ${IMPRESSION_MAX} 이하여야 한다`);

    // 정규식 폴백
    const cases = [
      ["빨간 머리에 검은 갑옷을 입은 기사", { 머리: "red", 상의: "black" }],
      ["금발에 초록 눈", { 머리: "gold", 눈: "green" }],
      ["머리 빨간", {}],
      ["파란색 눈동자, 갈색 바지", { 눈: "blue", 하의: "brown" }],
      ["은발의 마법사", { 머리: "white" }],
      ["차가운 성격의 기사", {}],
    ];
    for (const [text, want] of cases) {
      const r = fallbackParse(text, words);
      for (const role of ROLES) {
        const got = r.parts[role] ?? null;
        const exp = want[role] ?? null;
        if (got !== exp) bad.push(`폴백 "${text}" ${role}: ${got} (기대 ${exp})`);
      }
      if (r.impression !== text) bad.push(`폴백 인상이 문장 전체가 아니다: ${r.impression}`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("파서가 표 밖의 것을 버리고 · 인상 폴백 · 정규식 폴백 6건");
    out("S34_G1_OK");
  },

  "S34-G2": async () => {
    const bad = [];
    const { RANGES, nearestCorpus, loadCharacterWords, loadCreatures } = await import("../src/color-words.js");
    const words = loadCharacterWords();
    const dataIds = Object.keys(words.colorWords).sort();
    const srcIds = Object.keys(RANGES).sort();
    if (JSON.stringify(dataIds) !== JSON.stringify(srcIds)) bad.push(`낱말표 ${dataIds.join(",")} ≠ 범위표 ${srcIds.join(",")}`);
    for (const role of ROLES) if (!Array.isArray(words.parts[role]) || words.parts[role].length === 0) bad.push(`부위 ${role} 의 표면형이 없다`);
    for (const [form, c] of Object.entries(words.compounds ?? {})) {
      if (!ROLES.includes(c.part) || !Object.hasOwn(RANGES, c.color)) bad.push(`복합어 ${form} 이 모르는 부위·색을 가리킨다`);
    }
    const creatures = loadCreatures();
    if (creatures.length < 8) bad.push(`종족이 ${creatures.length}개 — 8개 이상`);
    for (const c of creatures) {
      if (c.skin !== null && !Object.hasOwn(RANGES, c.skin)) bad.push(`종족 ${c.id} 의 피부 낱말 ${c.skin} 이 범위표에 없다`);
      if (c.finish !== null && !FINISH_IDS.includes(c.finish)) bad.push(`종족 ${c.id} 의 재질 ${c.finish} 이 없는 재질이다`);
      if (!Array.isArray(c.words) || c.words.length === 0) bad.push(`종족 ${c.id} 에 낱말이 없다`);
    }
    for (const id of ["robot", "troll", "zombie", "ghost", "human"]) if (!creatures.some((c) => c.id === id)) bad.push(`종족 ${id} 가 없다`);

    // 데이터 파일에 숫자·헥스가 없다 — 숫자는 src 에 둔다는 규칙
    for (const p of ["data/character-words.json", "data/creatures.json"]) {
      const raw = read(p);
      if (/#[0-9a-fA-F]{6}/.test(raw)) bad.push(`${p} 에 헥스가 있다`);
      if (/:\s*-?\d/.test(raw) || /\[\s*-?\d/.test(raw)) bad.push(`${p} 에 숫자 값이 있다`);
    }

    // 모든 낱말이 코퍼스 80색으로 간다 · 결정적 · 범위 안이면 범위를 지킨다
    const all = corpus();
    if (all.length !== 80) bad.push(`코퍼스가 ${all.length}색 (기대 80)`);
    const hexes = new Set(all.map((c) => up(c.hex)));
    for (const id of srcIds) {
      const a = nearestCorpus(id, all, new Set());
      const b = nearestCorpus(id, all, new Set());
      if (!a || !hexes.has(up(a.hex))) bad.push(`${id} → ${a?.hex} 가 코퍼스에 없다`);
      if (a?.hex !== b?.hex) bad.push(`${id} 가 결정적이지 않다`);
      const hsl = hexToHsl(a.hex);
      const r = RANGES[id];
      if (r.hue && hsl.s >= CHROMATIC_MIN_S) {
        const [lo, hi] = r.hue;
        const inside = lo <= hi ? hsl.h >= lo && hsl.h <= hi : hsl.h >= lo || hsl.h <= hi;
        if (!inside) out(`  참고: ${id} 는 범위 안 후보가 없어 중심 거리로 ${a.hex}(h ${hsl.h.toFixed(0)}) 를 골랐다`);
      }
      // 이미 쓴 색은 피한다
      const c = nearestCorpus(id, all, new Set([up(a.hex)]));
      if (!c || up(c.hex) === up(a.hex)) bad.push(`${id} 가 used 를 무시한다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`낱말 ${srcIds.length}개 ↔ 범위 일치 · 종족 ${creatures.length} · 코퍼스 80색으로 결정적`);
    out("S34_G2_OK");
  },

  "S34-G3": async () => {
    const bad = [];
    const { compose } = await loadTargets();
    const hexes = new Set(corpus().map((c) => up(c.hex)));
    const darken = (basis) => {
      const { h, s, l } = hexToHsl(basis);
      return hslToHex({ h, s: s * LOWER_S_FACTOR, l: Math.max(LOWER_L_FLOOR, l - LOWER_L_DELTA) });
    };
    let checked = 0;
    for (const f of FIXTURES) {
      const { colors } = compose(f);
      for (const c of colors) {
        checked += 1;
        if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) bad.push(`${f.q} ${c.role}: 헥스 형식 아님 ${c.hex}`);
        if (typeof c.basis !== "string" || !hexes.has(up(c.basis))) bad.push(`${f.q} ${c.role}: basis ${c.basis} 가 코퍼스에 없다`);
        if (hexes.has(up(c.hex))) continue;
        if (c.source !== "rule") bad.push(`${f.q} ${c.role}: 코퍼스 밖 헥스 ${c.hex} 인데 출처가 ${c.source}`);
        if (up(darken(c.basis)) !== up(c.hex)) bad.push(`${f.q} ${c.role}: ${c.hex} 가 basis ${c.basis} 의 규칙 결과 ${darken(c.basis)} 와 다르다`);
      }
      // 결정적
      const again = compose(f);
      if (JSON.stringify(again.colors) !== JSON.stringify(colors)) bad.push(`${f.q}: 두 번 계산이 다르다`);
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`픽스처 ${FIXTURES.length}건 · 색 ${checked}개 전부 코퍼스이거나 basis 의 규칙 결과 · 결정적`);
    out("S34_G3_OK");
  },

  "S34-G4": async () => {
    const bad = [];
    const { cw, compose } = await loadTargets();
    const all = corpus();
    const byRole = (f) => Object.fromEntries(compose(f).colors.map((c) => [c.role, c]));

    // 말한 부위는 고정 — 그 낱말의 최근접과 같다
    const knight = byRole(FIXTURES[0]);
    if (up(knight.머리.hex) !== up(cw.nearestCorpus("red", all, new Set()).hex) || knight.머리.source !== "spoken") bad.push(`붉은 머리가 고정되지 않았다: ${knight.머리.hex} ${knight.머리.source}`);
    if (up(knight.상의.hex) !== up(cw.nearestCorpus("black", all, new Set()).hex) || knight.상의.source !== "spoken") bad.push(`검은 갑옷이 고정되지 않았다: ${knight.상의.hex}`);
    if (hexToHsl(knight.상의.hex).l > 0.3) bad.push(`검은 상의 명도가 ${hexToHsl(knight.상의.hex).l.toFixed(2)} — 어둡지 않다`);

    // 종족 → 피부
    const robot = byRole(FIXTURES[1]);
    if (robot.피부.source !== "creature") bad.push(`로봇 피부 출처가 ${robot.피부.source}`);
    if (hexToHsl(robot.피부.hex).s > 0.3) bad.push(`로봇 피부가 회색이 아니다: ${robot.피부.hex}`);
    const troll = byRole(FIXTURES[2]);
    const th = hexToHsl(troll.피부.hex);
    if (troll.피부.source !== "creature" || th.h < 60 || th.h > 180) bad.push(`트롤 피부가 초록이 아니다: ${troll.피부.hex} (h ${th.h.toFixed(0)})`);

    // 말한 피부가 종족을 이긴다
    const blueRobot = byRole(FIXTURES[3]);
    const bh = hexToHsl(blueRobot.피부.hex);
    if (blueRobot.피부.source !== "spoken" || bh.h < 180 || bh.h > 270) bad.push(`파란 피부가 로봇 회색에 졌다: ${blueRobot.피부.hex} ${blueRobot.피부.source}`);

    // 음성 대조 — 종족 없음·피부 말 안 함 → 따뜻한 뉴트럴 (h 10~50 · l ≥ 0.55)
    for (const i of [0, 7, 8]) {
      const skin = byRole(FIXTURES[i]).피부;
      const h = hexToHsl(skin.hex);
      if (skin.source !== "rule") bad.push(`${FIXTURES[i].q}: 피부 출처가 ${skin.source} (기대 rule)`);
      if (h.h < 10 || h.h > 50 || h.l < 0.55) bad.push(`${FIXTURES[i].q}: 피부가 따뜻한 뉴트럴이 아니다 ${skin.hex} (h ${h.h.toFixed(0)} l ${h.l.toFixed(2)})`);
    }
    // 사람 종족(human, skin null)도 뉴트럴
    const wizard = byRole(FIXTURES[6]);
    if (wizard.피부.source !== "rule") bad.push(`사람 종족 피부 출처가 ${wizard.피부.source}`);

    // 배색 쌍 출처
    if (knight.강조.source !== "pair") bad.push(`강조 출처가 ${knight.강조.source} (기대 pair)`);
    const pair = pairById(FIXTURES[0].pair);
    if (!pair.colors.some((c) => up(c.hex) === up(knight.강조.hex))) bad.push(`강조 ${knight.강조.hex} 가 배색 쌍 ${pair.id} 의 색이 아니다`);
    if (bad.length) throw new Error(bad.join(" / "));
    out("말한 색 고정 · 로봇 회색 · 트롤 초록 · 말한 피부 > 종족 · 뉴트럴 음성 대조 · 배색 쌍 출처");
    out("S34_G4_OK");
  },

  "S34-G5": async () => {
    const bad = [];
    const { compose } = await loadTargets();
    const NEIGHBORS = [["피부", "머리"], ["피부", "상의"], ["상의", "하의"]];
    for (const f of FIXTURES) {
      const { colors, warnings } = compose(f);
      if (colors.map((c) => c.role).join(",") !== ROLES.join(",")) bad.push(`${f.q}: 부위 순서 ${colors.map((c) => c.role).join(",")}`);
      const byRole = Object.fromEntries(colors.map((c) => [c.role, c]));
      const buckets = new Set(colors.filter((c) => hexToHsl(c.hex).s >= CHROMATIC_MIN_S).map((c) => Math.floor(hexToHsl(c.hex).h / HUE_BUCKET)));
      if (buckets.size < f.minHues) bad.push(`${f.q}: 색상각 구획 ${buckets.size} (하한 ${f.minHues})`);
      const spokenHex = new Set(colors.filter((c) => c.source === "spoken").map((c) => up(c.hex)));
      const rest = colors.filter((c) => c.source !== "spoken").map((c) => up(c.hex));
      if (new Set(rest).size !== rest.length || rest.some((h) => spokenHex.has(h))) bad.push(`${f.q}: 헥스 중복 ${rest.join(",")}`);
      for (const [a, b] of NEIGHBORS) {
        const ruled = [byRole[a], byRole[b]].some((c) => c.source === "rule");
        if (!ruled) continue;
        const gap = Math.abs(hexToHsl(byRole[a].hex).l - hexToHsl(byRole[b].hex).l);
        const warned = (warnings ?? []).some((w) => w.includes(a) || w.includes(b));
        if (gap < NEIGHBOR_MIN_L_GAP - 1e-9 && !warned) bad.push(`${f.q}: ${a}↔${b} 명도차 ${gap.toFixed(2)} < ${NEIGHBOR_MIN_L_GAP} 인데 warnings 에 없다`);
      }
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out(`픽스처 ${FIXTURES.length}건 — 순서 고정 · 색상각 구획 하한 · 이웃 명도차 · 중복 없음`);
    out("S34_G5_OK");
  },

  "S34-G6": async () => {
    const bad = [];
    const port = 4421;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      const hexes = new Set(corpus().map((c) => up(c.hex)));
      const r = await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("붉은 머리에 검은 갑옷, 차가운 성격의 기사")}`);
      if (r.status !== 200) bad.push(`응답이 ${r.status}`);
      const data = await r.json();
      if (data.parse?.from !== "fallback") bad.push(`Ollama 없이 parse.from 이 ${data.parse?.from}`);
      if (data.parse?.parts?.머리 !== "red" || data.parse?.parts?.상의 !== "black") bad.push(`폴백 파서가 못 잡았다: ${JSON.stringify(data.parse?.parts)}`);
      if (data.parse?.impression !== data.query) bad.push("폴백 인상이 문장 전체가 아니다");
      if (!data.palette?.id || !["search", "fallback"].includes(data.palette.from)) bad.push(`배색 쌍이 없다: ${JSON.stringify(data.palette)}`);
      if (!Array.isArray(data.colors) || data.colors.length !== 6) bad.push(`색이 ${data.colors?.length}개`);
      for (const c of data.colors ?? []) {
        if (!hexes.has(up(c.hex)) && c.source !== "rule") bad.push(`${c.role} ${c.hex} 가 코퍼스 밖인데 rule 이 아니다`);
        if (!hexes.has(up(c.basis))) bad.push(`${c.role} basis ${c.basis} 가 코퍼스 밖`);
      }
      if (data.finishes?.from !== "fallback") bad.push(`재질이 ${data.finishes?.from}`);
      for (const role of ROLES) if (!FINISH_IDS.includes(data.finishes?.assignments?.[role])) bad.push(`재질 폴백에 ${role} 이 없다`);
      if (typeof data.finishes?.names?.matte !== "string") bad.push("재질 이름표가 없다");

      const empty = await fetch(`http://127.0.0.1:${port}/api/character?q=%E2%80%8B`);
      if (empty.status !== 400) bad.push(`빈 q 가 ${empty.status}`);
      const none = await fetch(`http://127.0.0.1:${port}/api/character`);
      if (none.status !== 400) bad.push(`q 없음이 ${none.status}`);

      // 종족 낱말은 LLM 없이도 잡힌다
      const robot = await (await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("로봇 병사")}`)).json();
      if (robot.parse?.creature !== "robot") bad.push(`종족이 ${robot.parse?.creature}`);
      if (robot.finishes?.assignments?.피부 !== "metal") bad.push(`로봇 피부 재질이 ${robot.finishes?.assignments?.피부} (기대 metal)`);

      const html = stripHtml(await (await fetch(`http://127.0.0.1:${port}/`)).text());
      if (/LLM/.test(html)) bad.push("홈 HTML 에 'LLM' 이 있다");
      if (!html.includes("캐릭터 색감")) bad.push("홈 HTML 에 캐릭터 탭이 없다");
    } finally {
      server.kill();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("Ollama 없이 — 폴백 파서 · 배색 쌍 · 6색 · 종족 · 400 · 홈에 LLM 없음");
    out("S34_G6_OK");
  },

  "S34-G7": async () => {
    const bad = [];
    const stubPort = 4422;
    const port = 4423;
    const parserReply = '{"parts":{"머리":"#FF0000","상의":"black","손":"red","__proto__":"red"},"impression":"느와르 포스터 만들건데 고급스러운 빨강","hex":"#123456"}';
    const finishReply = '{"assignments":{"피부":"gloss","머리":"metal","눈":"gloss","상의":"matte","하의":"matte","강조":"emissive","바탕":"metal"}}';
    const { server: stub, seen } = await stubOllama(stubPort, { parserReply, finishReply });
    const server = await startServer(port, { OLLAMA_HOST: `127.0.0.1:${stubPort}`, OLLAMA_MODEL: "stub-model:1b" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/character?q=${encodeURIComponent("붉은 머리 검객")}`);
      const text = await res.text();
      const data = JSON.parse(text);
      if (/#FF0000|#123456/i.test(text)) bad.push("모델이 실어 보낸 헥스가 응답에 닿았다");
      if (data.parse?.from !== "llm") bad.push(`parse.from 이 ${data.parse?.from}`);
      if (data.parse?.parts?.머리 !== null) bad.push(`헥스가 색 낱말로 통과했다: ${data.parse?.parts?.머리}`);
      if (data.parse?.parts?.상의 !== "black") bad.push("정상 낱말이 안 남았다");
      if (Object.hasOwn(data.parse?.parts ?? {}, "손")) bad.push("없는 부위가 응답에 남았다");
      if (data.parse?.impression !== "느와르 포스터 만들건데 고급스러운 빨강") bad.push(`인상이 ${data.parse?.impression}`);
      // 모델이 준 인상이 검색에 쓰였다 — 같은 문장을 /api/search 에 물은 답과 같다
      const search = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(data.parse.impression)}&rewrite=0`)).json();
      if (search.route !== "palette" || !search.results?.[0]) bad.push(`양성 대조 실패 — 인상 문장이 팔레트로 안 갔다 (${search.route})`);
      if (data.palette?.from !== "search" || data.palette?.id !== search.results?.[0]?.id) bad.push(`배색 쌍 ${data.palette?.id}(${data.palette?.from}) ≠ 검색 1위 ${search.results?.[0]?.id}`);
      if (data.finishes?.from !== "llm" || data.finishes?.assignments?.머리 !== "metal") bad.push(`재질 배정이 모델에서 안 왔다: ${JSON.stringify(data.finishes?.assignments)}`);
      if (Object.hasOwn(data.finishes?.assignments ?? {}, "바탕")) bad.push("캐릭터에 없는 역할 '바탕' 이 배정에 남았다");
      if (seen.parser !== 1 || seen.finish !== 1) bad.push(`모델 호출 파서 ${seen.parser} · 재질 ${seen.finish} (기대 1·1)`);
      const parserBody = JSON.parse(seen.bodies.find((b) => b.includes("파서")) ?? "{}");
      if (parserBody.format !== "json") bad.push("파서 호출이 format: json 이 아니다");
      if (!/red|black|gray/.test(parserBody.messages?.[0]?.content ?? "")) bad.push("프롬프트에 색 낱말 id 가 없다");
    } finally {
      server.kill();
      stub.close();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("스텁 모델의 헥스·없는 부위가 응답에 안 닿음 · 인상이 검색에 쓰임 · 호출 1·1");
    out("S34_G7_OK");
  },

  "S34-G8": async () => {
    const bad = [];
    const port = 4424;
    const server = await startServer(port, { OLLAMA_HOST: "127.0.0.1:1" });
    try {
      // 가짜 색을 실어 보낸다 — 무시돼야 한다
      const body = { query: "트롤 전사", parts: { 상의: "red", 손: "blue" }, creature: "troll", paletteId: "pair-03", colors: [{ role: "피부", hex: "#000000" }], finishes: { 피부: "metal", 바탕: "gloss" } };
      const r1 = await post(port, "/api/saved/character", body);
      if (r1.status !== 200) bad.push(`저장이 ${r1.status}: ${await r1.text()}`);
      const e1 = await r1.json();
      if (e1.kind !== "derived" || e1.structureId !== "character" || e1.seedId !== "pair-03" || e1.mode !== "light") bad.push(`항목 모양: ${JSON.stringify({ kind: e1.kind, structureId: e1.structureId, seedId: e1.seedId })}`);
      if (e1.colors?.length !== 6 || e1.colors.map((c) => c.role).join(",") !== ROLES.join(",")) bad.push(`색 ${e1.colors?.length}개`);
      const skin = e1.colors?.find((c) => c.role === "피부");
      if (up(skin?.hex) === "#000000") bad.push("본문의 가짜 피부색이 저장됐다");
      const sh = hexToHsl(skin.hex);
      if (sh.h < 60 || sh.h > 180) bad.push(`트롤 피부가 초록이 아니다: ${skin.hex}`);
      if (e1.finishes?.피부 !== "metal") bad.push(`보낸 재질이 안 실렸다: ${e1.finishes?.피부}`);
      if (Object.hasOwn(e1.finishes ?? {}, "바탕")) bad.push("없는 역할 재질이 저장됐다");
      if (e1.character?.parts?.상의 !== "red" || Object.hasOwn(e1.character?.parts ?? {}, "손")) bad.push(`저장된 parts: ${JSON.stringify(e1.character?.parts)}`);
      if (e1.colors.reduce((n, c) => n + c.ratio, 0) !== 100) bad.push("비율 합이 100 이 아니다");
      if (!e1.name?.startsWith("캐릭터 — ")) bad.push(`이름 ${e1.name}`);

      // 종족 재질이 기본으로 실린다 (재질 안 보냄)
      const r2 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01" });
      const e2 = await r2.json();
      if (e2.finishes?.피부 !== "metal") bad.push(`로봇 피부 기본 재질이 ${e2.finishes?.피부} (기대 metal)`);
      if (e2.finishes?.강조 !== "emissive" || e2.finishes?.머리 !== "gloss") bad.push(`캐릭터 기본 재질표가 안 쓰였다: ${JSON.stringify(e2.finishes)}`);

      // 같은 키로 다시 저장하면 덮어쓰고 비율·메모를 이어받는다
      const r3 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01", shares: [30, 20, 10, 15, 15, 10], note: "메모" });
      const e3 = await r3.json();
      if (e3.colors?.map((c) => c.ratio).join(",") !== "30,20,10,15,15,10" || e3.note !== "메모") bad.push("비율·메모가 안 실렸다");
      const r4 = await post(port, "/api/saved/character", { query: "로봇 병사", parts: {}, creature: "robot", paletteId: "pair-01" });
      const e4 = await r4.json();
      if (e4.colors?.map((c) => c.ratio).join(",") !== "30,20,10,15,15,10" || e4.note !== "메모") bad.push("재저장이 비율·메모를 안 이어받았다");

      // 잘못된 요청
      for (const [label, b, want] of [
        ["배색 쌍 없음", { query: "x", parts: {}, creature: null, paletteId: "pair-99" }, 400],
        ["문장 없음", { parts: {}, paletteId: "pair-01" }, 400],
        ["비율 합 틀림", { query: "x", parts: {}, creature: null, paletteId: "pair-01", shares: [50, 10, 10, 10, 10, 20] }, 400],
      ]) {
        const r = await post(port, "/api/saved/character", b);
        if (r.status !== want) bad.push(`${label}: ${r.status} (기대 ${want})`);
      }

      // 목록 · 내보내기
      const { saved, finishNames } = await (await fetch(`http://127.0.0.1:${port}/api/saved`)).json();
      const mine = saved.filter((e) => e.structureId === "character");
      if (mine.length !== 2) bad.push(`캐릭터 항목이 ${mine.length}개 (기대 2 — 같은 키는 덮어쓴다)`);
      if (typeof finishNames?.metal !== "string") bad.push("재질 이름표가 없다");
      for (const fmt of ["unreal", "unity"]) {
        const ex = JSON.parse(await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text());
        const robot = ex.palettes.find((p) => p.name === e2.name);
        if (!robot) bad.push(`${fmt} 에 로봇 항목이 없다`);
        else {
          if (robot.colors.length !== 6) bad.push(`${fmt} 로봇 색 ${robot.colors.length}개`);
          const s = robot.colors.find((c) => c.role === "피부");
          if (s?.metallic !== 1) bad.push(`${fmt} 로봇 피부 metallic 이 ${s?.metallic}`);
          if (robot.id !== e2.id) bad.push(`${fmt} 항목 id 가 저장 id 가 아니다: ${robot.id}`);
        }
        if (ex.skippedBroken !== 0) bad.push(`${fmt} skippedBroken ${ex.skippedBroken}`);
        const ids = ex.palettes.map((p) => p.id);
        if (new Set(ids).size !== ids.length) bad.push(`${fmt} 에 id 가 겹친다`);
      }
      for (const fmt of ["css", "json"]) {
        const text = await (await fetch(`http://127.0.0.1:${port}/api/export?format=${fmt}`)).text();
        if (text.includes("캐릭터 — ")) bad.push(`${fmt} 에 캐릭터 항목이 새어 나갔다`);
      }
    } finally {
      server.kill();
    }

    // /saved 화면 필드
    installDom();
    const { savedFields } = await import("../public/ui.js");
    const f = savedFields({ kind: "derived", structureId: "character", seedLabel: "세이지그린 × 연분홍", character: { query: "트롤 전사" }, colors: ROLES.map((role, i) => ({ role, hex: "#123456", ratio: i === 0 ? 20 : 16 })), finishes: { 피부: "metal" } });
    if (f.badge !== "캐릭터") bad.push(`savedFields 배지가 ${f.badge}`);
    if (!f.coords.some(([k, v]) => k === "배색 쌍" && v === "세이지그린 × 연분홍")) bad.push("좌표에 배색 쌍이 없다");
    if (!f.coords.some(([k, v]) => k === "설명" && v === "트롤 전사")) bad.push("좌표에 설명이 없다");
    if (f.finishes?.[0]?.id !== "metal") bad.push("재질 줄이 안 나온다");
    const plain = savedFields({ kind: "derived", structureId: "tone-on-tone", mode: "dark", colors: [] });
    if (plain.badge !== "어두운 배경") bad.push(`파생 배지 회귀: ${plain.badge}`);
    if (bad.length) throw new Error(bad.join(" / "));
    out("저장 왕복 — 가짜 색 무시 · 종족 재질 기본 · 덮어쓰기·이어받기 · 400 · 엔진 6역할·id 유일 · CSS/JSON 제외 · 화면 필드");
    out("S34_G8_OK");
  },

  "S34-G9": async () => {
    const bad = [];
    const html = stripHtml(read("public/index.html"));
    if (!/role="tablist"/.test(html)) bad.push("tablist 가 없다");
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
    if (tabs.join("|") !== TAB_LABELS.join("|")) bad.push(`탭이 ${tabs.join("|")} (기대 ${TAB_LABELS.join("|")})`);
    if (!/data-tab-select="palette"/.test(html) || !/data-tab-select="character"/.test(html)) bad.push("탭 버튼에 data-tab-select 가 없다");
    if (!/id="results-character"/.test(html) || !/id="results-palette"/.test(html)) bad.push("탭별 결과 영역이 없다");
    if (!/data-tab="character"/.test(html)) bad.push("캐릭터 예시 칩이 없다");
    if (/LLM/.test(html)) bad.push("index.html 에 'LLM'");

    const app = stripJs(read("public/app.js"));
    if (!app.includes("/api/character?q=")) bad.push("app.js 가 /api/character 를 안 부른다");
    if (!app.includes("/api/saved/character")) bad.push("app.js 가 캐릭터 저장을 안 부른다");
    if (!/tabStore\(/.test(app)) bad.push("app.js 가 tabStore 를 안 쓴다");
    if (!/characterStructure\(/.test(app) || !/structureCard\(/.test(app)) bad.push("캐릭터 카드가 structureCard 를 재사용하지 않는다");
    if (!/route:\s*"character"/.test(app)) bad.push("캐릭터 턴 기록에 route character 가 없다");
    if (/LLM/.test(app)) bad.push("app.js 에 'LLM'");
    if (!app.includes("인상을 못 읽어 기본 배색을 썼습니다")) bad.push("폴백 안내 문장이 없다");

    const ui = read("public/ui.js");
    const hits = [...ui.matchAll(/localStorage/g)].length;
    if (hits !== 1) bad.push(`ui.js 가 저장소를 ${hits}곳에서 만진다 (한 곳이어야 한다 — 주석 포함)`);
    if (!ui.includes(`"${TAB_KEY}"`)) bad.push(`ui.js 에 탭 키 ${TAB_KEY} 가 없다`);
    for (const p of ["public/app.js", "public/history.js", "public/saved.js"]) if (/localStorage|sessionStorage/.test(stripJs(read(p)))) bad.push(`${p} 가 저장소를 직접 만진다`);

    const hist = stripJs(read("public/history.js"));
    if (!/character:\s*"캐릭터"/.test(hist)) bad.push("history.js 라벨에 캐릭터가 없다");
    if (!hist.includes("tab=character")) bad.push("다시 묻기 링크가 탭을 안 넘긴다");

    // DOM 스텁으로 순수 함수를 직접 부른다
    installDom();
    const { tabStore, characterStructure, sourceLine } = await import("../public/ui.js");
    const mem = new Map();
    const fake = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const store = tabStore(fake);
    if (store.read() !== "palette") bad.push(`빈 저장소에서 ${store.read()} (기대 palette)`);
    store.write("character");
    if (mem.get(TAB_KEY) !== "character" || store.read() !== "character") bad.push("탭 저장·읽기가 안 된다");
    store.write("purple");
    if (mem.get(TAB_KEY) !== "character") bad.push("모르는 탭 값을 저장했다");
    mem.set(TAB_KEY, "purple");
    if (store.read() !== "palette") bad.push("저장된 이상한 값을 믿었다");
    const throwing = { getItem: () => { throw new Error("막힘"); }, setItem: () => { throw new Error("막힘"); } };
    const t = tabStore(throwing);
    if (t.read() !== "palette") bad.push("던지는 저장소에서 안 돈다");
    t.write("character");

    const sample = {
      query: "q", parse: { parts: {}, creature: null, impression: "차가운 기사", from: "fallback" },
      palette: { id: "pair-01", name: "세이지그린 × 연분홍", from: "search" },
      colors: ROLES.map((role, i) => ({ role, hex: `#${(i + 1).toString(16).repeat(6)}`, name: role, source: i < 2 ? "spoken" : "rule", basis: "#111111" })),
    };
    const st = characterStructure(sample);
    if (st.id !== "character" || st.colors?.length !== 6 || st.colors[0].role !== "피부" || typeof st.name !== "string" || typeof st.principle !== "string") bad.push(`characterStructure: ${JSON.stringify({ id: st.id, n: st.colors?.length })}`);
    if (!st.source?.includes("세이지그린 × 연분홍")) bad.push("구조 source 에 배색 쌍 이름이 없다");
    const line = sourceLine(sample.colors);
    if (!line || line.childElementCount !== 6) bad.push("출처 줄이 여섯이 아니다");
    if (!/말한 색/.test(line.textContent) || !/규칙/.test(line.textContent)) bad.push(`출처 줄 문구: ${line.textContent}`);
    if (/LLM|llm/.test(line.textContent)) bad.push("출처 줄에 LLM");
    if (bad.length) throw new Error(bad.join(" / "));
    out("탭 둘 · /api/character · 저장소 한 곳 · tabStore 불신 · 내역 라벨 · structureCard 재사용 · 출처 줄");
    out("S34_G9_OK");
  },

  "S34-G10": async () => {
    const targets = [];
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage4.mjs", `S4-G${i}`]);
    for (let i = 1; i <= 11; i += 1) targets.push(["scripts/check-stage16.mjs", `S16-G${i}`]);
    for (let i = 1; i <= 12; i += 1) targets.push(["scripts/check-stage17.mjs", `S17-G${i}`]);
    for (let i = 1; i <= 13; i += 1) targets.push(["scripts/check-stage18.mjs", `S18-G${i}`]);
    for (let i = 1; i <= 7; i += 1) targets.push(["scripts/check-stage20.mjs", `S20-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage22.mjs", `S22-G${i}`]);
    for (let i = 1; i <= 6; i += 1) targets.push(["scripts/check-stage23.mjs", `S23-G${i}`]);
    for (let i = 1; i <= 3; i += 1) targets.push(["scripts/check-stage31.mjs", `S31-G${i}`]);
    const results = [];
    for (const [script, id] of targets) results.push(await runChecker(script, id));
    for (const r of results) out(`${r.ok ? "통과" : "실패"} ${r.id} — ${r.tail}`);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) throw new Error(`회귀 ${failed.length}개 실패: ${failed.map((r) => r.id).join(", ")}`);
    out("S34_G10_OK");
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage34.mjs <${Object.keys(GATES).join("|")}>`);
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
```

- [ ] **Step 3: 전부 실패하는 것을 본다**

Run (PowerShell): `1..10 | % { node scripts/check-stage34.mjs "S34-G$_" }`
Expected: G1~G9 는 `Cannot find module` 이거나 `실패:` 로 exit 1. **G10 은 회귀라 지금도 통과한다** — 그것이 이 게이트의 성격이다(음성 대조는 Task 8 에서 한다). 이 출력을 세션 재개 문서에 남긴다.

- [ ] **Step 4: 브랜치**

```bash
git checkout -b stage-34-character-colors
```

(커밋은 대표 확인 뒤. 이 계획의 태스크는 커밋 단계를 두지 않는다 — 전역 규칙.)

---

### Task 1: 낱말표 · 종족표 · 범위표 (`src/color-words.js`) — S34-G2

**Files:**
- Create: `data/character-words.json`
- Create: `data/creatures.json`
- Create: `src/color-words.js`

**Interfaces:**
- Produces:
  - `RANGES: Record<id, {hue?: [lo, hi], s?: [lo, hi], l?: [lo, hi]}>`
  - `loadCharacterWords(): {colorWords: Record<id, string[]>, parts: Record<role, string[]>, compounds: Record<form, {part, color}>}` — 던진다(`CharacterError`)
  - `loadCreatures(): {id, words: string[], skin: id|null, finish: finishId|null}[]` — 던진다
  - `findCreature(text, creatures): creature|null` — 문장에서 **가장 앞에** 나온 종족
  - `nearestCorpus(wordId, corpus, used = new Set()): {hex, name}|null` — 결정적

- [ ] **Step 1: `data/character-words.json`**

```json
{
  "_grade": "[판단]",
  "_source": "원전(배색사전 · light.md)에 없는 표다. 한국어에서 색과 부위를 부르는 흔한 말을 내가 골랐다. 구현하며 사용자 문장에서 못 잡는 말이 보이면 여기에 더한다 — 코드는 안 고친다.",
  "_noNumbersHere": "색상각 범위·명도 조건 같은 숫자는 src/color-words.js 에 둔다. data/structures.json ↔ src/expand.js 와 같은 나눔이다. 이 파일에 숫자나 헥스가 생기면 그 규칙이 깨진 것이다(S34-G2 가 검사한다).",
  "_why": "LLM 은 색 낱말 id 만 고른다. 표면형은 정규식 폴백(Ollama 없을 때)이 문장에서 '빨간 머리' 처럼 색+부위가 붙은 것을 잡는 데 쓴다. 낱자 하나짜리('은'·'금'·'적')는 조사와 겹쳐 오탐이 나므로 넣지 않는다.",
  "colorWords": {
    "red": ["빨간", "빨강", "붉은", "적색", "레드", "진홍"],
    "orange": ["주황", "오렌지", "주홍", "귤색"],
    "yellow": ["노란", "노랑", "황색", "옐로"],
    "gold": ["금색", "금빛", "황금", "골드"],
    "green": ["초록", "녹색", "연두", "풀색", "그린"],
    "teal": ["청록", "옥색", "틸"],
    "blue": ["파란", "파랑", "푸른", "남색", "하늘색", "블루", "청색"],
    "purple": ["보라", "자주", "라벤더", "퍼플", "자색"],
    "pink": ["분홍", "핑크", "장미색", "연분홍"],
    "brown": ["갈색", "밤색", "브라운", "구릿빛", "고동색"],
    "black": ["검은", "검정", "까만", "흑색", "블랙"],
    "white": ["흰", "하얀", "백색", "화이트", "새하얀"],
    "gray": ["회색", "잿빛", "은색", "은빛", "그레이", "쥐색"]
  },
  "parts": {
    "피부": ["피부", "살결", "살갗"],
    "머리": ["머리카락", "머릿결", "머리", "헤어"],
    "눈": ["눈동자", "눈"],
    "상의": ["상의", "갑옷", "셔츠", "코트", "망토", "드레스", "로브", "재킷", "윗옷", "옷"],
    "하의": ["하의", "바지", "치마", "스커트"],
    "강조": ["강조", "포인트", "장식", "무기", "검", "지팡이", "보석"]
  },
  "compounds": {
    "금발": { "part": "머리", "color": "gold" },
    "은발": { "part": "머리", "color": "white" },
    "백발": { "part": "머리", "color": "white" },
    "흑발": { "part": "머리", "color": "black" },
    "적발": { "part": "머리", "color": "red" },
    "갈발": { "part": "머리", "color": "brown" }
  }
}
```

- [ ] **Step 2: `data/creatures.json`**

```json
{
  "_grade": "[판단]",
  "_source": "원전에 없는 표다. 대표 지시 — '피부색은 로봇, 트롤 등의 키워드가 있으면 그 키워드의 대표적인 색으로 적용'. 대표 색은 통념으로 내가 정했고, skin 은 data/character-words.json 의 색 낱말 id 다. 낱말을 더하려면 이 파일만 고친다.",
  "_noNumbersHere": "헥스를 적지 않는다. 색 낱말 id 가 src/color-words.js 를 거쳐 코퍼스 80색 중 하나로 간다 — 그래서 종족 피부도 지어낸 색이 아니다.",
  "_nullSkin": "skin 이 null 인 종족은 사람 피부다 — 종족 낱말이 없을 때와 같은 따뜻한 뉴트럴이 된다. finish 가 null 이면 캐릭터 기본 재질표를 따른다.",
  "creatures": [
    { "id": "robot", "words": ["로봇", "기계", "안드로이드", "사이보그", "메카"], "skin": "gray", "finish": "metal" },
    { "id": "troll", "words": ["트롤", "오크", "고블린", "오우거"], "skin": "green", "finish": null },
    { "id": "zombie", "words": ["좀비", "언데드", "구울"], "skin": "gray", "finish": "matte" },
    { "id": "demon", "words": ["악마", "데몬", "마족"], "skin": "red", "finish": null },
    { "id": "ghost", "words": ["유령", "고스트", "망령"], "skin": "white", "finish": "emissive" },
    { "id": "slime", "words": ["슬라임"], "skin": "green", "finish": "gloss" },
    { "id": "alien", "words": ["외계인", "에일리언"], "skin": "green", "finish": "gloss" },
    { "id": "angel", "words": ["천사"], "skin": "white", "finish": "gloss" },
    { "id": "human", "words": ["엘프", "드워프", "인간", "사람", "기사", "마법사", "소녀", "소년", "공주", "왕자"], "skin": null, "finish": null }
  ]
}
```

- [ ] **Step 3: `src/color-words.js`**

```js
// 색 낱말("빨간"·"회색")을 코퍼스 80색 중 하나로 보낸다.
//
// **낱말은 data/character-words.json 에, 숫자는 여기에.** data/structures.json ↔ src/expand.js 와 같은 나눔이다.
// 범위는 전부 `[판단]` — 원전은 색 이름의 색상각 경계를 말하지 않는다.
//
// **헥스를 지어내지 않는다.** 이 파일이 내는 것은 언제나 코퍼스에 실제로 있는 색 하나다. 범위 안에 후보가 없으면
// 범위 중심과의 HSL 거리로 전체에서 고른다 — 코퍼스에 흰색이 없어서 "흰" 은 아이보리 부근이 된다 [실측].
// 그것은 알려진 한계이지 결함이 아니다: 코퍼스에 없는 색을 지어내는 대신 가장 가까운 실재하는 색을 보인다.
//
// 회색·흰색은 HSL 채도가 아니라 지각 채도(`c` = (1-|2l-1|)·s)로 가른다 — HSL s ≤ 0.2 로 두면 세이지그린(s 0.14)이 회색에 든다 [실측].

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { hexToHsl } from "./expand.js";

const WORDS_PATH = fileURLToPath(new URL("../data/character-words.json", import.meta.url));
const CREATURES_PATH = fileURLToPath(new URL("../data/creatures.json", import.meta.url));

export class CharacterError extends Error {}

/**
 * 낱말 id → 범위 `[판단]`. `hue` 는 [시작, 끝] 도(끝이 시작보다 작으면 0° 를 넘는다), `l` 은 HSL 명도, `c` 는 지각 채도
 * [하한, 상한]. hue 가 있는 낱말은 유채색이라 HSL 채도 하한(`CHROMATIC_MIN_S`)을 함께 건다 — 안 걸면 회색이 "빨강" 범위에 든다.
 * 코퍼스 실측(2026-09-13): red 10 · orange 13 · yellow 8 · green 6 · teal 11 · blue 17 · purple 7 · pink 3 · brown 3 · black 10 후보.
 */
export const RANGES = Object.freeze({
  red: { hue: [345, 15] },
  orange: { hue: [15, 45], l: [0.4, 1] },
  yellow: { hue: [45, 70] },
  gold: { hue: [36, 60], l: [0.4, 0.8] },
  green: { hue: [70, 170] },
  teal: { hue: [160, 200] },
  blue: { hue: [195, 260] },
  purple: { hue: [260, 320] },
  pink: { hue: [320, 350], l: [0.5, 1] },
  brown: { hue: [15, 45], l: [0, 0.45] },
  black: { l: [0, 0.25] },
  white: { l: [0.8, 1], c: [0, 0.3] },
  gray: { c: [0, 0.12], l: [0.3, 0.85] },
});

export const CHROMATIC_MIN_S = 0.15;
const chromaOf = ({ s, l }) => (1 - Math.abs(2 * l - 1)) * s;

const wrap = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return d > 180 ? 360 - d : d;
};
const hueInside = ([lo, hi], h) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);
const hueCenter = ([lo, hi]) => (lo <= hi ? (lo + hi) / 2 : wrap((lo + hi + 360) / 2));
const mid = (range, fallback) => (range ? (range[0] + range[1]) / 2 : fallback);

function inside(range, hsl) {
  if (range.hue && (hsl.s < CHROMATIC_MIN_S || !hueInside(range.hue, hsl.h))) return false;
  if (range.c && (chromaOf(hsl) < range.c[0] || chromaOf(hsl) > range.c[1])) return false;
  if (range.l && (hsl.l < range.l[0] || hsl.l > range.l[1])) return false;
  return true;
}

/** 범위 중심과의 거리. 무채색 낱말은 색상각을 안 보고 지각 채도로 잰다. */
function distance(range, hsl) {
  const dh = range.hue ? hueGap(hueCenter(range.hue), hsl.h) / 180 : 0;
  const dc = range.hue ? Math.abs(0.5 - chromaOf(hsl)) : Math.abs(mid(range.c, 0.05) - chromaOf(hsl));
  const dl = Math.abs(mid(range.l, 0.5) - hsl.l);
  return dh + dc * 0.5 + dl;
}

/**
 * 낱말 하나를 코퍼스 색 하나로. **결정적** — 같은 낱말·같은 코퍼스·같은 used 면 늘 같은 색.
 *
 * @param {string} wordId RANGES 의 키
 * @param {{hex:string, name:string}[]} corpus 코퍼스 80색
 * @param {Set<string>} used 이미 쓴 헥스(대문자). 피한다
 * @returns {{hex:string, name:string}|null} 모르는 낱말이거나 코퍼스가 비면 null
 */
export function nearestCorpus(wordId, corpus, used = new Set()) {
  if (typeof wordId !== "string" || !Object.hasOwn(RANGES, wordId)) return null;
  const range = RANGES[wordId];
  const free = corpus.filter((c) => !used.has(String(c.hex).toUpperCase()));
  const pool = free.length ? free : corpus;
  if (pool.length === 0) return null;
  const scored = pool.map((c) => ({ c, hsl: hexToHsl(c.hex) }));
  const fits = scored.filter((x) => inside(range, x.hsl));
  const candidates = fits.length ? fits : scored;
  candidates.sort((a, b) => distance(range, a.hsl) - distance(range, b.hsl) || (a.c.hex < b.c.hex ? -1 : 1));
  return { hex: candidates[0].c.hex, name: candidates[0].c.name };
}

const isStringList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "");

export function loadCharacterWords(path = WORDS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new CharacterError("낱말표를 읽지 못했다 (data/character-words.json)", { cause });
  }
  const { colorWords, parts, compounds = {} } = parsed ?? {};
  if (!colorWords || typeof colorWords !== "object" || !parts || typeof parts !== "object") {
    throw new CharacterError("낱말표에 colorWords·parts 가 없다 (data/character-words.json)");
  }
  for (const [id, forms] of Object.entries(colorWords)) {
    if (!Object.hasOwn(RANGES, id)) throw new CharacterError(`낱말 ${id} 에 범위가 없다 (src/color-words.js)`);
    if (!isStringList(forms)) throw new CharacterError(`낱말 ${id} 의 표면형이 비었다`);
  }
  for (const id of Object.keys(RANGES)) {
    if (!Object.hasOwn(colorWords, id)) throw new CharacterError(`범위 ${id} 에 낱말이 없다 (data/character-words.json)`);
  }
  for (const [role, forms] of Object.entries(parts)) if (!isStringList(forms)) throw new CharacterError(`부위 ${role} 의 표면형이 비었다`);
  for (const [form, c] of Object.entries(compounds)) {
    if (!c || !Object.hasOwn(parts, c.part) || !Object.hasOwn(RANGES, c.color)) throw new CharacterError(`복합어 ${form} 이 모르는 부위·색을 가리킨다`);
  }
  return { colorWords, parts, compounds };
}

export function loadCreatures(path = CREATURES_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new CharacterError("종족표를 읽지 못했다 (data/creatures.json)", { cause });
  }
  if (!Array.isArray(parsed?.creatures)) throw new CharacterError("종족표에 creatures 배열이 없다");
  const seen = new Set();
  return parsed.creatures.map((c) => {
    if (typeof c?.id !== "string" || seen.has(c.id)) throw new CharacterError(`종족 id 가 없거나 겹친다: ${c?.id}`);
    seen.add(c.id);
    if (!isStringList(c.words)) throw new CharacterError(`종족 ${c.id} 에 낱말이 없다`);
    const skin = c.skin ?? null;
    if (skin !== null && !Object.hasOwn(RANGES, skin)) throw new CharacterError(`종족 ${c.id} 의 피부 낱말 ${skin} 이 범위표에 없다`);
    const finish = c.finish ?? null;
    if (finish !== null && typeof finish !== "string") throw new CharacterError(`종족 ${c.id} 의 재질이 문자열이 아니다`);
    return { id: c.id, words: [...c.words], skin, finish };
  });
}

/** 문장에서 가장 앞에 나온 종족. LLM 을 거치지 않는다 — Ollama 없이도 같은 답이어야 한다. */
export function findCreature(text, creatures) {
  const s = typeof text === "string" ? text : "";
  let best = null;
  for (const c of creatures) {
    for (const w of c.words) {
      const at = s.indexOf(w);
      if (at >= 0 && (best === null || at < best.at)) best = { at, c };
    }
  }
  return best ? best.c : null;
}
```

- [ ] **Step 4: 게이트**

Run: `node scripts/check-stage34.mjs S34-G2`
Expected: `S34_G2_OK`. "참고:" 줄은 유채색 낱말에만 찍힌다(범위 안 후보 없음) — 실측으로는 없어야 한다. white 는 무채색이라 참고 줄 없이 아이보리 부근으로 간다 — 그것을 알려진 한계에 적는다.

---

### Task 2: 파서 `src/describe.js` — S34-G1

**Files:**
- Create: `src/describe.js`
- Create: `src/character.js` 의 **`CHARACTER_ROLES` 만** 먼저(Task 3 이 나머지를 채운다)

**Interfaces:**
- Consumes: `loadCharacterWords`, `loadCreatures`, `findCreature` (Task 1); `refresh` (`src/ollama.js`); `pickModel` (`src/rewrite.js`); `cleanQuery` (`src/query.js`)
- Produces:
  - `CHARACTER_ROLES = ["피부","머리","눈","상의","하의","강조"]` (`src/character.js`)
  - `IMPRESSION_MAX = 120`
  - `systemPrompt(words): string` — "파서" 라는 낱말을 담는다(스텁이 그것으로 호출을 가른다)
  - `parseDescription(raw, words, query): {parts: Record<role, id|null>, impression: string, matched: number}`
  - `fallbackParse(query, words): {parts, impression: query}`
  - `describe(query): Promise<{parts, creature: {id, skin, finish}|null, impression, from: "llm"|"fallback", model?, elapsedMs?, error?}>` — 던지지 않는다

- [ ] **Step 1: `src/character.js` 골격**

```js
// 캐릭터 부위별 색. 규칙 본체는 Task 3 에서 채운다.
export const CHARACTER_ROLES = Object.freeze(["피부", "머리", "눈", "상의", "하의", "강조"]);
```

- [ ] **Step 2: `src/describe.js`**

```js
// 캐릭터 외형 문장에서 **부위마다 말해진 색 낱말**과 **인상 한 줄**을 뽑는다.
//
// **LLM 은 색에 닿지 않는다.** 모델이 고르는 것은 색 낱말 id(red·black …)뿐이고, 헥스는 src/color-words.js 가
// 코퍼스에서 찾는다. 모델이 응답에 헥스를 실어 보내도 `parseDescription` 이 버린다 — 재질 배정(finish.js)과 같은 경계.
//
// **없어도 돈다.** Ollama 가 없거나 응답을 못 알아들으면 정규식 폴백 — 색 낱말 바로 뒤에 부위가 오는 것("빨간 머리")만
// 잡고 인상은 문장 전체다. 종족 낱말은 어느 길이든 표를 직접 대조한다(결정적).

import { refresh } from "./ollama.js";
import { pickModel } from "./rewrite.js";
import { cleanQuery } from "./query.js";
import { CHARACTER_ROLES } from "./character.js";
import { findCreature, loadCharacterWords, loadCreatures } from "./color-words.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
// 구조 선택·재질 배정과 같은 값을 독립적으로 적는다. 물러설 자리(정규식)가 분명하다.
const TIMEOUT_MS = Number(process.env.DESCRIBE_TIMEOUT_MS ?? 20000);

/** 인상 한 줄의 상한. 검색 질의로 들어가므로 길면 BM25 가 흐려진다. */
export const IMPRESSION_MAX = 120;

const emptyParts = () => Object.fromEntries(CHARACTER_ROLES.map((r) => [r, null]));

export const systemPrompt = (words) => `너는 한국어 캐릭터 외형 설명을 읽는 파서다.

문장에서 **부위마다 말해진 색**과 **전체 인상 한 줄**을 뽑는다.

부위: ${CHARACTER_ROLES.join(", ")}
색 낱말 id: ${Object.entries(words.colorWords).map(([id, forms]) => `${id}(${forms.slice(0, 3).join("·")})`).join(", ")}

규칙:
- 문장이 그 부위의 색을 말했을 때만 적는다. 안 말한 부위는 null.
- 위 색 낱말 id 만 쓴다. 헥스나 새 이름을 쓰지 않는다. 색은 이 도구가 따로 계산한다.
- impression 은 색 이름을 뺀 분위기·성격·장면을 한 문장(40자 안팎)으로 쓴다.
- 설명하지 않는다.

JSON 으로만 답한다: {"parts":{"피부":null,"머리":"red","눈":null,"상의":"black","하의":null,"강조":null},"impression":"차가운 성격의 기사"}`;

const clipChars = (s, max) => Array.from(s).slice(0, max).join("");

/**
 * 모델이 뭘 뱉든 여기서 걸러 낸다 — 없는 부위 · 없는 색 낱말 · 문자열 아닌 값 · 프로토타입 이름.
 * 인상은 문자열만 받고 비면 **문장 전체**로 물러선다 — 검색이 빈 질의를 받으면 안 된다.
 */
export function parseDescription(raw, words, query) {
  const parts = emptyParts();
  let matched = 0;
  let impression = "";
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const p = parsed.parts;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      for (const role of CHARACTER_ROLES) {
        if (!Object.hasOwn(p, role)) continue;
        const id = p[role];
        if (typeof id !== "string" || !Object.hasOwn(words.colorWords, id)) continue;
        parts[role] = id;
        matched += 1;
      }
    }
    if (typeof parsed.impression === "string") impression = clipChars(parsed.impression.trim(), IMPRESSION_MAX);
  }
  return { parts, impression: impression || query, matched };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byLength = (a, b) => b.length - a.length;

/** 낱말표에서 정규식 둘을 만든다. 표면형은 긴 것부터 — "머리카락" 이 "머리" 보다 먼저 맞아야 한다. */
function buildMatchers(words) {
  const colorForm = new Map();
  for (const [id, forms] of Object.entries(words.colorWords)) for (const f of forms) colorForm.set(f, id);
  const partForm = new Map();
  for (const [role, forms] of Object.entries(words.parts)) for (const f of forms) partForm.set(f, role);
  const colors = [...colorForm.keys()].sort(byLength).map(escapeRe).join("|");
  const parts = [...partForm.keys()].sort(byLength).map(escapeRe).join("|");
  const compounds = Object.keys(words.compounds ?? {}).sort(byLength).map(escapeRe).join("|");
  return {
    colorForm,
    partForm,
    pair: new RegExp(`(${colors})(?:색|빛)?\\s?(${parts})`, "g"),
    compound: compounds ? new RegExp(`(${compounds})`, "g") : null,
  };
}

let matchers = null;

/** Ollama 없이 쓰는 파서. 색 낱말 바로 뒤에 부위가 온 것만 잡는다. 먼저 나온 것이 이긴다. */
export function fallbackParse(query, words) {
  if (!matchers || matchers.words !== words) matchers = { words, ...buildMatchers(words) };
  const parts = emptyParts();
  const text = typeof query === "string" ? query : "";
  for (const m of text.matchAll(matchers.pair)) {
    const role = matchers.partForm.get(m[2]);
    const id = matchers.colorForm.get(m[1]);
    if (role && id && parts[role] === null) parts[role] = id;
  }
  if (matchers.compound) {
    for (const m of text.matchAll(matchers.compound)) {
      const c = words.compounds[m[1]];
      if (c && parts[c.part] === null) parts[c.part] = c.color;
    }
  }
  return { parts, impression: text };
}

async function callModel(model, words, query, signal) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.2, num_predict: 200 },
      messages: [
        { role: "system", content: systemPrompt(words) },
        { role: "user", content: query },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama 가 ${res.status}`);
  return (await res.json()).message?.content ?? "";
}

/**
 * @param {string} query 캐릭터 외형 문장
 * @returns {Promise<{parts, creature, impression, from: "llm"|"fallback", model?, elapsedMs?, error?}>}
 *   모델·네트워크 실패로는 던지지 않는다. 낱말표·종족표가 깨졌으면 던진다(호출부가 기동 때 알아야 한다).
 */
export async function describe(query) {
  const words = loadCharacterWords();
  const creature = findCreature(query, loadCreatures());
  const text = cleanQuery(query);
  const fallback = (error, extra = {}) => ({ ...fallbackParse(text, words), creature, from: "fallback", ...(error ? { error } : {}), ...extra });
  if (!text) return fallback(null);

  const state = await refresh();
  if (state.state !== "ready") return fallback(`Ollama 를 쓸 수 없다 (${state.detail})`);
  const model = pickModel(state.models);
  if (!model) return fallback("쓸 수 있는 로컬 모델이 없다");

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const raw = await callModel(model, words, text, controller.signal);
    const { parts, impression, matched } = parseDescription(raw, words, text);
    const elapsedMs = Date.now() - started;
    // 모델이 부위를 하나도 안 줬어도 인상은 썼을 수 있다 — 인상이 문장과 다르면 모델이 일한 것이다.
    if (matched === 0 && impression === text) return fallback("모델 응답에서 쓸 수 있는 것이 없었다", { model, elapsedMs });
    // 폴백 파서가 잡은 것 중 모델이 놓친 부위를 채운다 — "빨간 머리" 는 규칙이 더 확실하다.
    const regex = fallbackParse(text, words).parts;
    for (const role of CHARACTER_ROLES) if (parts[role] === null && regex[role] !== null) parts[role] = regex[role];
    return { parts, creature, impression, from: "llm", model, elapsedMs };
  } catch (err) {
    const reason = err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 응답하지 않았다` : err.message;
    return fallback(reason, { model });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: 게이트**

Run: `node scripts/check-stage34.mjs S34-G1`
Expected: `S34_G1_OK`. 실패하면 표면형이나 정규식을 고친다 — 특히 "은발의 마법사" 는 복합어 표가, "머리 빨간" 은 순서가 잡는다.

---

### Task 3: 규칙 `src/character.js` — S34-G3 · G4 · G5

**Files:**
- Modify: `src/character.js`

**Interfaces:**
- Consumes: `hexToHsl`, `hslToHex`, `perceivedChroma` (`src/expand.js`); `nearestCorpus` (Task 1)
- Produces: `composeCharacter({parts, creature, pair, corpus}): {colors: {role, hex, name, source, basis}[], warnings: string[]}` — 순수 함수, 던지지 않는다(배색 쌍이 2색이 아니면 코퍼스 앞 두 색으로 물러선다)

- [ ] **Step 1: 규칙 본체**

`src/character.js` 를 이렇게 바꾼다:

```js
// 캐릭터 부위 여섯의 색을 정한다. **순수 함수** — 같은 입력이면 같은 색(S34-G3 이 두 번 계산해 대조한다).
//
// 색은 세 곳에서 온다. ① 말한 색(코퍼스 최근접) ② 인상으로 고른 배색 쌍(상의·강조) ③ 규칙 — 코퍼스 풀에서 고르거나
// (머리·눈·피부) 상의를 HSL 로 어둡게(하의). 어느 길도 헥스를 지어내지 않는다: 코퍼스 80색이거나 `basis`(코퍼스) 의 연산 결과다.
//
// **수치는 전부 여기 있다** `[판단]`. 원전은 캐릭터 부위를 말하지 않는다. 낱말은 data/ 에 있다.
//
// 처음 안(배색 쌍 하나를 HSL 로만 벌리기)은 두 색상각 안에서만 돌아 "두 색만 추천되지 않나" 는 지적을 받았다. 그래서
// 머리·눈·피부는 코퍼스 풀에서 고른다 — 4~5 색상각이 나온다(S34-G5).

import { hexToHsl, hslToHex, perceivedChroma } from "./expand.js";
import { nearestCorpus } from "./color-words.js";

export const CHARACTER_ROLES = Object.freeze(["피부", "머리", "눈", "상의", "하의", "강조"]);

/* ── 규칙 수치 [판단] ─────────────────────────────────────── */
const LOWER = { lDelta: 0.18, sFactor: 0.85, lFloor: 0.08 }; // 하의 = 상의 한 단 어둡게
const HAIR = { hueSpan: 40, minDarker: 0.15 }; // 머리 = 상의 근처 색상각, 상의보다 어둡게
const EYE = { hueSpan: 30 }; // 눈 = 강조 근처 색상각 중 가장 쨍한 것
const SKIN = { hue: [10, 50], maxChroma: 0.35, minL: 0.6, center: { h: 30, s: 0.3, l: 0.75 } }; // 따뜻한 뉴트럴
/** 규칙으로 고른 부위와 이미 정해진 이웃의 명도차 하한. 하의는 −0.18 이라 늘 넘는다. */
export const NEIGHBOR_MIN_L_GAP = 0.12;
const NEIGHBORS = Object.freeze({ 머리: ["피부"], 피부: ["머리", "상의"] });

const up = (hex) => String(hex).toUpperCase();
const wrap = (h) => ((h % 360) + 360) % 360;
const hueGap = (a, b) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return d > 180 ? 360 - d : d;
};
const hslDistance = (a, b) => hueGap(a.h, b.h) / 180 + Math.abs(a.s - b.s) * 0.5 + Math.abs(a.l - b.l);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** 배색 쌍을 바탕(채도 낮은 쪽)·강조로 가른다. expand.js 의 splitSeed 와 같은 기준이되 지각 채도로 본다. */
function splitPair(pair, corpus) {
  const colors = Array.isArray(pair?.colors) && pair.colors.length === 2 && pair.colors.every((c) => HEX.test(c?.hex ?? "")) ? pair.colors : corpus.slice(0, 2);
  const [a, b] = colors.map((c) => ({ hex: c.hex, name: c.name ?? c.origName ?? c.hex }));
  return perceivedChroma(hexToHsl(a.hex)) <= perceivedChroma(hexToHsl(b.hex)) ? { ground: a, accent: b } : { ground: b, accent: a };
}

/**
 * @param {{parts: Record<string, string|null>, creature: {skin: string|null}|null, pair: {colors: {hex, name}[]}, corpus: {hex, name}[]}} input
 * @returns {{colors: {role, hex, name, source: "spoken"|"pair"|"creature"|"rule", basis}[], warnings: string[]}}
 */
export function composeCharacter({ parts = {}, creature = null, pair, corpus }) {
  const pool = Array.isArray(corpus) ? corpus.filter((c) => HEX.test(c?.hex ?? "")) : [];
  const used = new Set();
  const out = Object.create(null);
  const warnings = [];
  const take = (role, color, source, basis = color.hex) => {
    out[role] = { role, hex: color.hex, name: color.name, source, basis };
    used.add(up(color.hex));
  };
  const hslOf = (role) => hexToHsl(out[role].hex);
  const fresh = (color) => {
    if (!used.has(up(color.hex))) return color;
    const target = hexToHsl(color.hex);
    const free = pool.filter((c) => !used.has(up(c.hex)));
    if (free.length === 0) return color;
    return free.map((c) => ({ c, d: hslDistance(target, hexToHsl(c.hex)) })).sort((x, y) => x.d - y.d || (x.c.hex < y.c.hex ? -1 : 1))[0].c;
  };
  /** 이미 정해진 이웃과 명도차를 지키는 후보만. 없으면 그대로 두고 경고를 남긴다. */
  const guarded = (role, candidates) => {
    const fixed = (NEIGHBORS[role] ?? []).filter((n) => out[n]);
    if (fixed.length === 0 || candidates.length === 0) return candidates;
    const ok = candidates.filter((x) => fixed.every((n) => Math.abs(x.hsl.l - hslOf(n).l) >= NEIGHBOR_MIN_L_GAP));
    if (ok.length) return ok;
    warnings.push(`${role}: 이웃(${fixed.join("·")})과 명도차 ${NEIGHBOR_MIN_L_GAP} 이상인 후보가 없다`);
    return candidates;
  };
  const scored = () => pool.filter((c) => !used.has(up(c.hex))).map((c) => ({ c, hsl: hexToHsl(c.hex) }));
  const pick = (list, cmp) => (list.length ? [...list].sort((a, b) => cmp(a, b) || (a.c.hex < b.c.hex ? -1 : 1))[0].c : null);

  // ① 말한 색. 같은 색을 두 부위에 말할 수 있으므로 used 를 안 넘긴다.
  for (const role of CHARACTER_ROLES) {
    const word = parts?.[role];
    if (typeof word !== "string") continue;
    const color = nearestCorpus(word, pool);
    if (color) take(role, color, "spoken");
  }
  // ① ' 종족 피부 — 머리를 고르기 전에 정해야 이웃 명도차가 잡힌다.
  if (!out.피부 && creature?.skin) {
    const color = nearestCorpus(creature.skin, pool, used);
    if (color) take("피부", color, "creature");
  }
  // ② 배색 쌍
  const { ground, accent } = splitPair(pair, pool);
  if (!out.상의) take("상의", fresh(ground), "pair");
  if (!out.강조) take("강조", fresh(accent), "pair");
  // ③ 하의 — 상의를 한 단 어둡게. 코퍼스 밖 헥스가 나오는 유일한 자리라 basis 를 든다.
  if (!out.하의) {
    const { h, s, l } = hslOf("상의");
    take("하의", { hex: hslToHex({ h, s: s * LOWER.sFactor, l: Math.max(LOWER.lFloor, l - LOWER.lDelta) }), name: `${out.상의.name} 어둡게` }, "rule", out.상의.hex);
  }
  // ③ 머리 — 상의 근처 색상각, 상의보다 어둡게. 없으면 근처 색상각 아무거나, 그것도 없으면 가장 어두운 것.
  if (!out.머리) {
    const top = hslOf("상의");
    const all = scored();
    const near = all.filter((x) => hueGap(x.hsl.h, top.h) <= HAIR.hueSpan);
    const darker = near.filter((x) => x.hsl.l <= top.l - HAIR.minDarker);
    const list = guarded("머리", darker.length ? darker : near.length ? near : all);
    const color = pick(list, (a, b) => hueGap(a.hsl.h, top.h) - hueGap(b.hsl.h, top.h) || a.hsl.l - b.hsl.l);
    if (color) take("머리", color, "rule");
  }
  // ③ 눈 — 강조 근처 색상각 중 지각 채도가 가장 높은 것.
  if (!out.눈) {
    const acc = hslOf("강조");
    const all = scored();
    const near = all.filter((x) => hueGap(x.hsl.h, acc.h) <= EYE.hueSpan);
    const color = pick(near.length ? near : all, (a, b) => perceivedChroma(b.hsl) - perceivedChroma(a.hsl));
    if (color) take("눈", color, "rule");
  }
  // ③ 피부 — 따뜻한 뉴트럴. 상의와 명도차가 가장 큰 것. 조건에 드는 색이 없으면 중심에 가장 가까운 것.
  if (!out.피부) {
    const top = hslOf("상의");
    const all = scored();
    const fits = all.filter((x) => x.hsl.h >= SKIN.hue[0] && x.hsl.h <= SKIN.hue[1] && perceivedChroma(x.hsl) <= SKIN.maxChroma && x.hsl.l >= SKIN.minL);
    const list = guarded("피부", fits);
    const color = list.length
      ? pick(list, (a, b) => Math.abs(b.hsl.l - top.l) - Math.abs(a.hsl.l - top.l))
      : pick(all, (a, b) => hslDistance(a.hsl, SKIN.center) - hslDistance(b.hsl, SKIN.center));
    if (color) take("피부", color, "rule");
  }

  return { colors: CHARACTER_ROLES.map((r) => out[r]), warnings };
}
```

- [ ] **Step 2: 게이트 셋**

Run: `node scripts/check-stage34.mjs S34-G3` · `S34-G4` · `S34-G5`
Expected: 셋 다 `_OK`. G5 의 `minHues` 가 실패하면 **하한을 낮추지 말고** 실측 구획 수를 세션 재개 문서에 적고 대표에게 보고한다 — 규칙(머리·눈이 상의·강조 근처만 본다)이 색상각을 못 벌린 것이면 EYE.hueSpan 을 넓히는 쪽을 먼저 시도한다.
Run: `node scripts/check-stage34.mjs S34-G2` — 회귀.

---

### Task 4: 재질 — `CHARACTER_FINISH_BY_ROLE` · `selectFinishes` 기본표 인자

**Files:**
- Modify: `src/material.js:97-131` (EV 표 · 기본 배정 표 옆)
- Modify: `src/finish.js:52-80, 188-227`

**Interfaces:**
- Produces: `CHARACTER_FINISH_BY_ROLE` (material.js) · `selectFinishes(query, roles, defaults = DEFAULT_FINISH_BY_ROLE)` · `fallbackAssignment(roles, defaults = DEFAULT_FINISH_BY_ROLE)`

- [ ] **Step 1: `src/material.js` — EV 다섯 역할 · 캐릭터 기본표**

`EV_BY_ROLE` 안, `"먼 쪽": 0.5,` 뒤에:

```js
  // 캐릭터 부위(34단계) `[판단]`. 강조는 위 4 를 그대로 쓴다 — 캐릭터에서도 빛나는 자리는 하나다.
  눈: 2,
  머리: 1,
  상의: 1,
  피부: 0.5,
  하의: 0.5,
```

`DEFAULT_FINISH_BY_ROLE` 정의 바로 뒤에:

```js
/**
 * 캐릭터 부위의 기본 재질 `[판단]`(34단계). **위 표에 섞지 않는다** — S16-G11·S17-G8 이 위 표를 "파생 구조의 실제
 * 역할과 정확히 같다" 로 잠갔고, 그 잠금은 죽은 항목을 잡는 데 쓸모가 있다. 위계는 같다 — 피부·옷은 조용하고(무광),
 * 머리·눈은 반사가 있어 살아 있고(광택), 강조만 빛난다. 종족표가 재질을 주면(로봇 → metal) 그것이 이 표를 덮는다.
 */
export const CHARACTER_FINISH_BY_ROLE = Object.freeze({
  피부: "matte",
  머리: "gloss",
  눈: "gloss",
  상의: "matte",
  하의: "matte",
  강조: "emissive",
});
```

- [ ] **Step 2: `src/finish.js` — 기본표를 인자로**

`assertRoles(roles)` → `assertRoles(roles, defaults)` 로 바꾸고 안의 `DEFAULT_FINISH_BY_ROLE` 두 곳을 `defaults` 로. `fallbackAssignment`:

```js
export function fallbackAssignment(roles, defaults = DEFAULT_FINISH_BY_ROLE) {
  assertRoles(roles, defaults);
  return Object.fromEntries(roles.map((role) => [role, defaults[role]]));
}
```

`selectFinishes`:

```js
export async function selectFinishes(query, roles, defaults = DEFAULT_FINISH_BY_ROLE) {
  assertRoles(roles, defaults);
  const fallback = (error, extra = {}) =>
    result({
      assignments: fallbackAssignment(roles, defaults),
      ...
```

(나머지 본문은 그대로. JSDoc 에 `@param {Record<string,string>} [defaults] 역할별 기본 재질표 — 화면 파생은 DEFAULT_FINISH_BY_ROLE, 캐릭터는 CHARACTER_FINISH_BY_ROLE` 한 줄.)

- [ ] **Step 3: 회귀**

Run: `node scripts/check-stage34.mjs S34-G10`
Expected: 65개 전부 통과 — 특히 S16-G11 · S17-G8(기본표 무변경) · S17-G2(폴백 완전성).

---

### Task 5: 서버 — `GET /api/character` — S34-G6 · G7

**Files:**
- Modify: `server.js` (import · `handleCharacter` · `dispatch`)

**Interfaces:**
- Consumes: `describe` · `composeCharacter` · `CHARACTER_ROLES` · `CHARACTER_FINISH_BY_ROLE` · `selectFinishes` · `pipeline.resolve` · `seedPool` · `FINISH_NAMES`
- Produces: 응답 형태(스펙 "흐름과 API"). `corpusColors()` · `CHARACTER_MATERIALS` · `FALLBACK_PAIR_ID` 는 Task 6 도 쓴다.

- [ ] **Step 1: import**

```js
import { describe } from "./src/describe.js";
import { CHARACTER_ROLES, composeCharacter } from "./src/character.js";
import { loadCreatures } from "./src/color-words.js";
```

`material.js` import 에 `CHARACTER_FINISH_BY_ROLE` 를 더한다.

- [ ] **Step 2: 상수·헬퍼 (`FINISH_NAMES` 정의 아래)**

```js
/**
 * 코퍼스 80색 — 팔레트 16쌍 32색 + 씨앗 24쌍 48색. 캐릭터 색은 전부 이 안에서 고른다(S34-G3).
 * 팔레트는 재적재될 수 있어(27단계) 요청마다 모은다. 80개라 비용이 없다.
 */
const corpusColors = () => [
  ...pipeline.palettes.flatMap((p) => p.colors.map((c) => ({ hex: c.hex, name: c.name }))),
  ...seedPool.flatMap((s) => s.colors.map((c) => ({ hex: c.hex, name: c.origName }))),
];

/** 검색이 배색 쌍을 못 고르면 여기로 물러선다. 코퍼스 1번이고, 없으면 첫 항목. */
const FALLBACK_PAIR_ID = "pair-01";
const fallbackPair = () => paletteById(FALLBACK_PAIR_ID) ?? pipeline.palettes[0];

/** 캐릭터 저장이 쓰는 재질 규칙. `MATERIALS` 와 같은 모양, 표만 캐릭터 것. */
const CHARACTER_MATERIALS = {
  finishes: [...MATERIAL_FINISHES],
  defaultFor: (role) => (Object.hasOwn(CHARACTER_FINISH_BY_ROLE, role) ? CHARACTER_FINISH_BY_ROLE[role] : MATERIAL_FINISHES[0]),
};

// 종족표는 기동 때 한 번 읽는다. 깨져 있으면 여기서 죽는 것이 맞다 — 낱말표와 함께 코퍼스 급 자산이다.
const creatureTable = loadCreatures();
const creatureById = (id) => (typeof id === "string" ? creatureTable.find((c) => c.id === id) ?? null : null);
```

- [ ] **Step 3: `handleCharacter`** (`handleExpand` 아래)

```js
/**
 * 캐릭터 외형 문장 → 부위 여섯의 색과 재질.
 *
 * **LLM 은 색에 닿지 않는다.** `describe` 가 주는 것은 부위별 색 낱말 id 와 인상 한 줄이고, 헥스는 `composeCharacter` 가
 * 코퍼스 80색에서 고른다. 인상은 기존 검색으로 배색 쌍 하나를 고르는 데 쓴다 — 검색이 진단으로 가거나 못 잡으면
 * 코퍼스 1번 쌍으로 물러서고 `palette.from` 에 그렇게 적는다.
 *
 * 파서와 재질 배정은 서로의 결과를 안 쓰므로 나란히 부른다(`/api/expand` 와 같은 이유). 검색은 인상이 있어야 하므로 그 뒤다.
 */
async function handleCharacter(res, params) {
  pipeline.reloadIfChanged();
  const query = cleanQuery(params.get("q"));
  if (!query) return sendJson(res, 400, { error: "q 가 비어 있다" });
  if (query.length > LIMITS.queryChars) return sendJson(res, 400, { error: `q 는 ${LIMITS.queryChars}자까지` });

  const started = Date.now();
  const [parsed, finishes] = await Promise.all([
    describe(query),
    selectFinishes(query, [...CHARACTER_ROLES], CHARACTER_FINISH_BY_ROLE).catch((err) => ({
      assignments: {},
      from: "fallback",
      matched: 0,
      error: `재질 배정을 준비하지 못했다 — ${err.message}`,
    })),
  ]);

  const r = await pipeline.resolve(parsed.impression, 3);
  const hit = r.route === "palette" ? r.paletteHits[0]?.doc ?? null : null;
  const pair = hit ?? fallbackPair();
  const { colors, warnings } = composeCharacter({ parts: parsed.parts, creature: parsed.creature, pair, corpus: corpusColors() });
  // 종족표의 재질은 결정적 규칙이라 모델 판단보다 앞선다(로봇 피부는 금속이다).
  const assignments = parsed.creature?.finish && Object.hasOwn(finishes.assignments, "피부")
    ? { ...finishes.assignments, 피부: parsed.creature.finish }
    : finishes.assignments;

  sendJson(res, 200, {
    query,
    parse: {
      parts: parsed.parts,
      creature: parsed.creature?.id ?? null,
      impression: parsed.impression,
      from: parsed.from,
      model: parsed.model ?? null,
      elapsedMs: parsed.elapsedMs ?? null,
      // /api/expand 와 같은 경계 — 사유에 OLLAMA_HOST 가 들어간다.
      error: parsed.error ? (LOOPBACK_ONLY ? parsed.error : "설명 읽기를 쓸 수 없습니다") : null,
    },
    palette: { id: pair.id, name: pair.name, from: hit ? "search" : "fallback", route: r.route, confident: r.confident === true },
    colors,
    warnings,
    finishes: {
      assignments,
      names: FINISH_NAMES(),
      ids: [...MATERIAL_FINISHES],
      from: finishes.from,
      matched: finishes.matched ?? 0,
      model: finishes.model ?? null,
      elapsedMs: finishes.elapsedMs ?? null,
      error: finishes.error ? (LOOPBACK_ONLY ? finishes.error : "재질 배정을 쓸 수 없습니다") : null,
    },
    elapsedMs: Date.now() - started,
  });
}
```

`dispatch` 의 `/api/expand` 줄 뒤에:

```js
  if (url.pathname === "/api/character") return handleCharacter(res, url.searchParams);
```

- [ ] **Step 4: 게이트**

Run: `node scripts/check-stage34.mjs S34-G6` — 홈 HTML 검사(캐릭터 탭)는 Task 7 전이라 **그 항목만 실패**한다. 나머지 항목이 없는지 출력을 본다.
Run: `node scripts/check-stage34.mjs S34-G7`
Expected: G7 `_OK`. 스텁 프롬프트 판별은 시스템 프롬프트의 "파서" 낱말이다 — `systemPrompt` 를 고치면 그 낱말을 남긴다.

---

### Task 6: 저장 · `/saved` · 내보내기 — S34-G8

**Files:**
- Modify: `src/store.js` (`VALID_ROUTES` · `recordTurn` 의 `topKind` · 새 `saveCharacter`)
- Modify: `src/export.js:246` (`enginePalette` 의 `id`)
- Modify: `public/ui.js:297-360` (`savedFields`)
- Modify: `server.js` (`resolveCharacter` · `handleWrite` 분기)

**Interfaces:**
- Produces: `saveCharacter(input, resolve, ratioFor, materials): Promise<entry>`; `resolveCharacter(input): {seedId, seedLabel, name, principle, source, colors, parts, creature, finishDefaults}|null`

- [ ] **Step 1: `src/store.js`**

`VALID_ROUTES` 에 `"character"` 를 더한다. `recordTurn` 의 `topKind`:

```js
    topKind: ["diagnosis", "palette", "character"].includes(input.topKind) ? input.topKind : null,
```

`saveDerived` 뒤에:

```js
/**
 * 캐릭터 부위별 색을 저장한다(34단계). **파생 저장과 같은 규칙** — 화면이 보낸 색은 안 믿고 `resolve` 가 부위·종족·배색 쌍
 * id 로 다시 계산한다. 항목은 `kind: "derived"` · `structureId: "character"` 라 `/saved` 와 엔진 내보내기가 그대로 돈다.
 *
 * 같은 키(배색 쌍 · 부위 · 종족)면 덮어쓰고 비율·재질·메모를 이어받는다 — `saveDerived` 와 같은 병합.
 * 종족표가 준 재질(`finishDefaults`)은 기본표보다 앞선다 — 로봇 피부를 안 보내도 금속으로 남는다.
 */
export function saveCharacter(input, resolve, ratioFor, materials) {
  if (typeof input.query !== "string" || typeof input.paletteId !== "string") {
    return Promise.reject(new Error("문장과 배색 쌍은 문자열이어야 한다"));
  }
  const query = clip(input.query, LIMITS.noteChars);
  if (!query) return Promise.reject(new Error("문장이 비어 있다"));

  const found = resolve(input);
  if (!found) return Promise.reject(new Error("모르는 배색 쌍이다"));

  const count = found.colors.length;
  const defaults = ratioFor({ colors: found.colors });
  const adjusted = input.shares === undefined ? null : normalizeShares(input.shares, count);
  if (input.shares !== undefined && !adjusted) {
    return Promise.reject(new Error(`면적 비율은 ${count}칸 정수 배열이고 합이 100 이어야 한다`));
  }
  const key = JSON.stringify([found.seedId, found.parts, found.creature]);

  return serialize(() => {
    const all = listSaved();
    const previous = all.find((e) => e.structureId === "character" && e.characterKey === key);
    const merged = mergeWithPrevious(previous, { adjusted, defaults, note: input.note });
    const ratio = merged.ratio;

    const roles = found.colors.map((c) => c.role);
    const sent = pickFinishes(input.finishes, roles, materials.finishes);
    const inheritFinishes = previous?.finishesAdjusted ? previous.finishes : null;
    const defaultFor = (role) => found.finishDefaults?.[role] ?? materials.defaultFor(role);
    const finishes = {};
    for (const role of roles) finishes[role] = sent[role] ?? inheritFinishes?.[role] ?? defaultFor(role);
    const finishesAdjusted = roles.some((role) => finishes[role] !== defaultFor(role));

    const entry = {
      id: newId("save"),
      savedAt: now(),
      kind: "derived",
      seedId: found.seedId,
      structureId: "character",
      mode: "light",
      seedLabel: found.seedLabel,
      name: `캐릭터 — ${clip(query, 40)}`,
      principle: found.principle,
      source: found.source,
      colors: found.colors.map((c, i) => ({ role: c.role, hex: c.hex, ratio: ratio[i] })),
      finishes,
      finishesAdjusted,
      ratioAdjusted: merged.ratioAdjusted,
      defaultRatio: defaults,
      note: merged.note,
      character: { query, parts: found.parts, creature: found.creature },
      characterKey: key,
    };

    const rest = all.filter((e) => e !== previous);
    writeJson("saved.json", [entry, ...rest].slice(0, LIMITS.saved));
    return entry;
  });
}
```

- [ ] **Step 2: `src/export.js` — 캐릭터 항목의 id**

`enginePalette` 의 `id:` 줄을:

```js
    // 캐릭터(34단계)는 같은 배색 쌍에서 여럿이 나오므로 저장 id 가 유일한 이름이다.
    id: entry.structureId === "character" ? String(entry.id) : `${entry.seedId}-${entry.structureId}-${entry.mode}`,
```

- [ ] **Step 3: `server.js` — `resolveCharacter` · 라우트**

`CHARACTER_MATERIALS` 아래:

```js
/**
 * 저장 요청의 부위·종족·배색 쌍 id 로 **색을 다시 계산한다**(`store.js` 규칙 4). 모르는 부위·낱말은 걸러 내고(거부가 아니라
 * 걸러내기 — `pickFinishes` 와 같은 태도) 배색 쌍이 없으면 null 이다.
 */
function resolveCharacter(input) {
  const pair = paletteById(String(input.paletteId ?? ""));
  if (!pair) return null;
  const raw = input.parts && typeof input.parts === "object" && !Array.isArray(input.parts) ? input.parts : {};
  const parts = Object.fromEntries(CHARACTER_ROLES.map((role) => [role, Object.hasOwn(raw, role) && typeof raw[role] === "string" ? raw[role] : null]));
  const creature = creatureById(input.creature);
  const { colors } = composeCharacter({ parts, creature, pair, corpus: corpusColors() });
  // 낱말표 밖의 낱말은 composeCharacter 가 무시한다 — 저장에도 남기지 않는다.
  const kept = Object.fromEntries(CHARACTER_ROLES.map((role) => [role, colors.find((c) => c.role === role)?.source === "spoken" ? parts[role] : null]));
  return {
    seedId: pair.id,
    seedLabel: pair.name,
    principle: `배색 쌍 ${pair.name} 의 인상으로 맞춘 부위별 색`,
    source: "캐릭터 규칙 [판단]",
    colors: colors.map((c) => ({ role: c.role, hex: c.hex })),
    parts: kept,
    creature: creature?.id ?? null,
    finishDefaults: creature?.finish ? { 피부: creature.finish } : {},
  };
}
```

`handleWrite` 의 `/api/saved/derived` 분기 뒤에:

```js
    if (pathname === "/api/saved/character") {
      return sendJson(res, 200, await saveCharacter(body, resolveCharacter, ratioFor, CHARACTER_MATERIALS));
    }
```

`store.js` import 에 `saveCharacter` 를 더한다.

- [ ] **Step 4: `public/ui.js` — `savedFields` 캐릭터 분기**

`if (e.kind === "derived") {` 블록의 `return { kind: "derived", ... }` 를:

```js
    // 캐릭터(34단계)는 모드가 정체가 아니다 — 배색 쌍과 문장이 정체다.
    const isCharacter = e.structureId === "character";
    return {
      kind: "derived",
      title: or(e.name, isCharacter ? "이름 없는 캐릭터" : "이름 없는 구조"),
      badge: isCharacter ? "캐릭터" : e.mode === "dark" ? "어두운 배경" : "밝은 배경",
      text: or(e.principle, ""),
      coords: isCharacter
        ? [
            ["배색 쌍", or(e.seedLabel, or(e.seedId, "모름"))],
            ["설명", or(e.character?.query, "모름")],
          ]
        : [
            ["씨앗", or(e.seedLabel, or(e.seedId, "모름"))],
            ["출처", or(e.source, "모름")],
          ],
      colors,
      finishes,
      finishesAdjusted: Boolean(e.finishesAdjusted),
    };
```

- [ ] **Step 5: 게이트**

Run: `node scripts/check-stage34.mjs S34-G8`
Expected: `S34_G8_OK`. 흔한 실패: `e1.finishes.바탕` — `pickFinishes` 가 역할 목록 밖을 버리므로 통과해야 한다; `unity` 의 `metallic` 필드 이름은 `toUnity` 가 정한다 — 검사기가 `metallic` 을 읽으므로 유니티 변환이 그 이름을 쓰는지 `src/material.js:335` 를 확인하고, 다르면 **검사기를** 그 이름에 맞춘다(엔진 필드 이름은 20단계가 정한 것이다).
Run: `node scripts/check-stage34.mjs S34-G10` — S18·S20·S22 회귀.

---

### Task 7: 화면 — 탭 둘 · 캐릭터 카드 · 내역 — S34-G9 · G6 마무리

**Files:**
- Modify: `public/index.html:40-63, 76-84`
- Modify: `public/app.css` (`.examples` 앞 · `.struct` 근처)
- Modify: `public/ui.js` (`tabStore` — `modeStore` 바로 아래 · `characterStructure` · `sourceLine`)
- Modify: `public/app.js`
- Modify: `public/history.js:7, 26`

**Interfaces:**
- Produces (ui.js): `tabStore(storage = defaultStorage()): {read(): "palette"|"character", write(tab)}` · `characterStructure(data): {id:"character", name, source, principle, colors}` · `sourceLine(colors): HTMLElement`

- [ ] **Step 1: `public/index.html`**

`<form class="searchbar"` 바로 앞에:

```html
    <div class="tabs" role="tablist" aria-label="무엇을 물을지">
      <button class="tabs__tab" type="button" role="tab" id="tab-palette" data-tab-select="palette" aria-selected="true" aria-controls="results-palette">색감 추천</button>
      <button class="tabs__tab" type="button" role="tab" id="tab-character" data-tab-select="character" aria-selected="false" aria-controls="results-character" tabindex="-1">캐릭터 색감</button>
    </div>
```

예시 칩 다섯에 `data-tab="palette"` 를 붙이고, 그 뒤에:

```html
      <button class="chip" type="button" data-tab="character" data-example="붉은 머리에 검은 갑옷, 차가운 성격의 기사" hidden>붉은 머리의 기사</button>
      <button class="chip" type="button" data-tab="character" data-example="금발에 초록 눈, 흰 드레스의 공주" hidden>금발의 공주</button>
      <button class="chip" type="button" data-tab="character" data-example="녹슨 로봇 병사, 은색 갑옷" hidden>녹슨 로봇</button>
```

결과 영역 `<section aria-labelledby="results-title">` 에 `id="results-palette"` 를 붙이고, 그 뒤에:

```html
  <section class="character" id="results-character" aria-labelledby="character-title" hidden>
    <div class="results__head" id="character-head" hidden>
      <h2 class="results__title" id="character-title">캐릭터 부위별 색</h2>
      <span class="results__note">말한 색은 그대로, 나머지는 인상에 맞는 배색 쌍과 규칙으로 채웠습니다</span>
    </div>
    <div class="status" id="character-status" hidden aria-live="polite"></div>
    <div class="character__card" id="character-card"></div>
  </section>
```

- [ ] **Step 2: `public/app.css`** (`.examples {` 앞)

```css
/* ── 탭 (34단계) — 검색창 위, 무엇을 물을지 ────────────────── */
.tabs {
  display: flex;
  gap: 4px;
  margin-top: 36px;
  max-width: 1000px;
  border-bottom: 1px solid var(--line);
}
.tabs__tab {
  padding: 10px 18px;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  font: inherit;
  font-size: 15px;
  color: var(--ink-muted);
  cursor: pointer;
}
.tabs__tab:hover {
  color: var(--ink);
}
.tabs__tab[aria-selected="true"] {
  color: var(--ink);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.tabs__tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.tabs + .searchbar {
  margin-top: 16px;
}
.character__card {
  margin-top: 16px;
  max-width: 760px;
}
.character__note {
  font-size: 13px;
  color: var(--ink-muted);
}
.sources {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ink-muted);
}
.sources__item b {
  color: var(--ink);
  font-weight: 600;
}
```

- [ ] **Step 3: `public/ui.js`**

`modeStore` 정의 바로 뒤(`defaultStorage` 앞):

```js
/* ── 탭 기억하기(34단계) — 모드와 같은 문, 같은 불신 ─────────── */
const TABS = Object.freeze(["palette", "character"]);
const TAB_KEY = "tonefirst:tab";
const asTab = (value) => (typeof value === "string" && TABS.includes(value) ? value : "palette");

/** 마지막으로 고른 탭. 저장소가 없거나 던져도 돌고, 저장값은 아는 값만 믿는다 — `modeStore` 와 같은 규칙. */
export function tabStore(storage = defaultStorage()) {
  return {
    read() {
      try {
        return asTab(storage?.getItem?.(TAB_KEY));
      } catch {
        return "palette";
      }
    },
    write(tab) {
      if (!TABS.includes(tab)) return;
      try {
        storage?.setItem?.(TAB_KEY, tab);
      } catch {
        // 못 저장해도 탭 전환은 그대로 된다.
      }
    },
  };
}
```

`structureCard` 앞에:

```js
/**
 * 캐릭터 응답을 `structureCard` 가 그릴 수 있는 구조 모양으로(34단계). 카드를 새로 만들지 않는다 — 스와치·다색 슬라이더·
 * 재질 고르개·저장 버튼이 전부 그 카드에 있다. 순수 함수라 게이트가 직접 부른다.
 */
export function characterStructure(data) {
  return {
    id: "character",
    name: "캐릭터 부위별 색",
    source: `배색 쌍 ${data?.palette?.name ?? "모름"}`,
    principle: data?.parse?.impression ? `인상 — ${data.parse.impression}` : "",
    colors: (data?.colors ?? []).map((c) => ({ role: c.role, hex: c.hex })),
  };
}

const SOURCE_LABEL = Object.freeze({ spoken: "말한 색", pair: "배색 쌍에서", creature: "종족", rule: "규칙" });

/** 부위마다 색이 어디서 왔는지. 사용자가 "왜 이 색이지" 를 답할 수 있어야 한다. */
export function sourceLine(colors) {
  const line = el("div", "sources");
  for (const c of colors ?? []) {
    const item = el("span", "sources__item");
    item.append(el("b", null, c.role), document.createTextNode(` ${c.name ?? c.hex} · ${SOURCE_LABEL[c.source] ?? c.source}`));
    line.append(item);
  }
  return line;
}
```

- [ ] **Step 4: `public/app.js`**

import 줄에 `characterStructure, sourceLine, tabStore` 를 더한다. 상단 DOM 참조 아래에:

```js
/* ── 탭(34단계) ───────────────────────────────────────────── */
const tabs = tabStore();
const tabButtons = [...document.querySelectorAll("[data-tab-select]")];
const paletteSection = document.getElementById("results-palette");
const characterSection = document.getElementById("results-character");
const characterHead = document.getElementById("character-head");
const characterStatus = document.getElementById("character-status");
const characterCard = document.getElementById("character-card");
const TAB_UI = {
  palette: { placeholder: input.placeholder, submit: "추천 받기" },
  character: { placeholder: "캐릭터 외형을 문장으로 — 예: 붉은 머리에 검은 갑옷, 차가운 성격의 기사", submit: "색 맞추기" },
};
let tab = "palette";

/** 탭을 바꾼다. 입력은 그대로 두고 안내문·버튼·보이는 결과 영역·예시 칩만 바뀐다 — 결과는 탭마다 따로 남는다. */
function applyTab(next) {
  tab = next;
  tabs.write(next);
  for (const btn of tabButtons) {
    const on = btn.dataset.tabSelect === next;
    btn.setAttribute("aria-selected", String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  paletteSection.hidden = next !== "palette";
  statusBox.hidden = next !== "palette" || statusBox.childElementCount === 0;
  characterSection.hidden = next !== "character";
  input.placeholder = TAB_UI[next].placeholder;
  submit.textContent = TAB_UI[next].submit;
  for (const chip of document.querySelectorAll("[data-example]")) chip.hidden = chip.dataset.tab !== next;
}
for (const btn of tabButtons) {
  btn.addEventListener("click", () => applyTab(btn.dataset.tabSelect));
  btn.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const i = tabButtons.indexOf(btn);
    const next = tabButtons[(i + (event.key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length];
    applyTab(next.dataset.tabSelect);
    next.focus();
  });
}
```

`render(data)` 뒤에:

```js
/* ── 캐릭터(34단계) ───────────────────────────────────────── */
function renderCharacter(data) {
  characterStatus.replaceChildren();
  characterStatus.hidden = false;
  characterStatus.append(el("span", "status__timing", `${data.elapsedMs}ms · 배색 쌍 ${data.palette.name}`));
  if (data.palette.from === "fallback") {
    characterStatus.append(el("span", "character__note", "인상을 못 읽어 기본 배색을 썼습니다"));
  }
  for (const w of data.warnings ?? []) characterStatus.append(el("span", "character__note", w));

  const struct = characterStructure(data);
  const base = data.finishes?.assignments && Object.keys(data.finishes.assignments).length ? data.finishes.assignments : null;
  const overrides = finishOverrides();
  const editing = base ? finishEditing(overrides, struct, base) : null;
  const finishes = base ? { assignments: base, names: data.finishes.names, ids: data.finishes.ids } : null;
  // 색은 안 보낸다 — 부위·종족·배색 쌍 id 로 서버가 다시 계산한다(S34-G8).
  const onSave = (shares) =>
    api("/api/saved/character", {
      query: data.query,
      parts: data.parse.parts,
      creature: data.parse.creature,
      paletteId: data.palette.id,
      shares,
      finishes: overrides.forStructure(struct, base),
    });
  const card = structureCard(struct, "light", finishes, onSave, editing);
  card.append(sourceLine(data.colors));
  characterCard.replaceChildren(card);
  characterHead.hidden = false;
}

async function recordCharacterTurn(data) {
  const saved = await api("/api/conversations/turn", {
    conversationId,
    query: data.query,
    stage: 1,
    usedLlm: data.parse.from === "llm",
    route: "character",
    confident: data.palette.from === "search",
    topKind: "character",
    topId: data.palette.id,
    topLabel: data.palette.name,
  });
  conversationId = saved.conversationId;
}

async function runCharacter(query) {
  await ready;
  const ticket = ++latestTicket;
  submit.disabled = true;
  lastQuery = query;
  try {
    const data = await api(`/api/character?q=${encodeURIComponent(query)}`);
    if (ticket !== latestTicket) return;
    renderCharacter(data);
    recordCharacterTurn(data).catch((err) => {
      threadMeta.textContent = `기록하지 못했습니다 — ${err.message}`;
    });
  } catch (err) {
    if (ticket === latestTicket) {
      characterStatus.replaceChildren(el("span", "status__badge status__badge--warn", "오류"), el("span", "status__text", err.message ?? "서버에 닿지 못했습니다"));
      characterStatus.hidden = false;
    }
  } finally {
    if (ticket === latestTicket) submit.disabled = false;
  }
}
```

제출·칩 핸들러를 탭으로 가른다:

```js
const go = (query) => (tab === "character" ? runCharacter(query) : run(query));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim() || input.placeholder;
  input.value = query;
  go(query);
});

for (const chip of document.querySelectorAll("[data-example]")) {
  chip.addEventListener("click", () => {
    input.value = chip.dataset.example;
    go(input.value);
  });
}
```

`ready` 안, `return params.get("q");` 앞에:

```js
  // ?tab= 이 있으면 그것, 없으면 마지막으로 고른 탭. 내역의 "다시 묻기" 가 캐릭터 질문을 캐릭터 탭으로 보낸다.
  applyTab(params.get("tab") === "character" ? "character" : tabs.read());
```

`renderStatus` 의 `statusBox.hidden = false;` 는 팔레트 탭에서만 뜻이 있다 — `applyTab` 이 숨김을 다시 잡으므로 그대로 둔다.

- [ ] **Step 5: `public/history.js`**

```js
const ROUTE_LABEL = { palette: "팔레트", diagnosis: "진단", character: "캐릭터", none: "못 잡음" };
```

`again.href` 를:

```js
  again.href = `/?conv=${encodeURIComponent(conversationId)}&q=${encodeURIComponent(turn.query)}${turn.route === "character" ? "&tab=character" : ""}`;
```

- [ ] **Step 6: 게이트**

Run: `node scripts/check-stage34.mjs S34-G9` · `S34-G6`
Expected: 둘 다 `_OK`.
Run (PowerShell): `1..10 | % { node scripts/check-stage34.mjs "S34-G$_" }` — 열 개 전부.

- [ ] **Step 7: 브라우저 실측** (`preview_start` `tonefirst`, http://localhost:4173)

1. 홈에 탭 둘. 캐릭터 탭 클릭 → 안내문·버튼 "색 맞추기"·예시 칩 셋으로 바뀜, 검색 결과 영역 숨김.
2. "붉은 머리에 검은 갑옷, 차가운 성격의 기사" → 카드 한 장: 스와치 여섯(라벨 `피부 · 16%` …), 재질 고르개 여섯, 출처 줄(머리 말한 색 · 상의 말한 색 · 강조 배색 쌍에서 · …), 저장 버튼.
3. "녹슨 로봇 병사" → 피부 회색, 재질 고르개 피부 = 메탈릭 (처음 값).
4. 저장 → `/saved` 에 배지 "캐릭터", 배색 쌍·설명 좌표, 6색 슬라이더, 재질 줄. 언리얼 내보내기에 6역할.
5. 색감 추천 탭으로 돌아가면 이전 검색 결과가 그대로. 새로고침 → 마지막 탭이 열린다.
6. `/history` 에서 캐릭터 턴 라벨 "캐릭터", "다시 묻기" → 캐릭터 탭으로 열린다.
7. 폭 375 · 700 · 1280 에서 탭이 넘치지 않는다.
8. Ollama 를 끄고(`tonefirst-no-ollama` 설정, 4399) 2 를 반복 — 카드가 뜨고 "인상을 못 읽어 …" 는 검색이 팔레트를 잡았으면 안 뜬다.
스크린샷을 세션 재개 문서에 적는다(파일은 안 넣는다 — 실측 수치·문구만).

---

### Task 8: 음성 대조 · 문서 · 게이트 수 · 리뷰

**Files:**
- Modify: `GATES.md` (알려진 한계 채우기) · `README.md` (227 → 237 · S34 행 · `{1..34}` · 파일 표) · `docs/com/open-work.md`
- Create: `docs/session-resume/2026-09-13-character-colors-34.md`

- [ ] **Step 1: 음성 대조 — 일부러 깨뜨려 게이트가 우는지 본다** (각각 되돌린다)

| 변형 | 울어야 하는 게이트 |
|---|---|
| `parseDescription` 에서 `Object.hasOwn(words.colorWords, id)` 검사 제거 | G1 · G7 |
| `data/creatures.json` 의 로봇 `skin` 을 `"steel"` 로 | G2 |
| `composeCharacter` 하의를 `l - 0.3` 으로 | G3 |
| 종족 피부 블록 삭제 | G4 · G8 |
| `app.js` 의 `/api/character` 를 `/api/search` 로 | G9 |
| `savedFields` 캐릭터 분기 제거 | G8 |
| `enginePalette` id 를 옛 식으로 | G8 (id 겹침) |
| `ui.js` 에 `localStorage` 를 한 번 더 쓰기 | G9 · S23-G6 |

결과를 세션 재개 문서 표로 남긴다.

- [ ] **Step 2: 게이트 수 네 곳**

README: `## 게이트 237개` · 85행 `237개가` · 표에 행 추가:

```markdown
| S34 | 10 | **캐릭터 외형 → 부위 여섯의 색 — 지어낸 색 0 · 말한 색 고정 · 종족이 피부를 정함 · 색상각 구획 하한(대부분 3)** · 파서 검증 · Ollama 없이 · 저장 왕복·엔진 6역할 · 탭 화면 · 회귀 65 |
```

파일 표 `check-stage{1..33}` → `{1..34}`. README 의 기능 설명 절에 캐릭터 탭 한 문단(홈 탭 둘 · 부위 여섯 · 코퍼스 80색).
Run: `node scripts/check-stage22.mjs S22-G6` → `S22_G6_OK`.

- [ ] **Step 3: `GATES.md` 알려진 한계 (34단계)** 를 실측으로 채운다 — 최소:
  - "검은"·"흰" 이 코퍼스 최암·최명색으로 가는 것(실제 헥스 적기)
  - G2 가 "참고:" 로 찍은 낱말 목록
  - 탭 클릭·키보드 핸들러는 DOM 스텁이 못 탄다 → 브라우저 실측으로 대신
  - 진짜 모델의 파싱 품질은 게이트가 못 잰다(답이 매번 다르다) — 브라우저 실측 문장 3건과 결과
  - `characterKey` 가 문장을 안 본다 — 같은 부위·종족·쌍이면 다른 문장도 덮어쓴다(의도)

- [ ] **Step 4: 격리 리뷰 2인**

```bash
~/.claude/scripts/review-fanout.sh open --round 52 --reviewer typescript-reviewer --no-prior --base main
~/.claude/scripts/review-fanout.sh open --round 52 --reviewer code-reviewer --no-prior --base main
```

리뷰어 프롬프트에 완료 조건을 직접 넣는다 — 위 게이트 표 열 줄 + "LLM 은 색에 닿지 않는다 · 화면이 보낸 색을 안 믿는다 · 화면에 LLM 글자 없음 · `DEFAULT_FINISH_BY_ROLE` 무변경". 산출물 경로를 리뷰어마다 다르게. 끝나면 `close --path`, 종료 코드와 산출물 둘 다 확인. Critical·High 는 고치고 해당 게이트를 다시 돌린다. 안 고치는 지적은 이유를 세션 재개 문서에 적는다.

- [ ] **Step 5: 세션 재개 문서 · 작업 목록**

`docs/session-resume/2026-09-13-character-colors-34.md` — 무엇을 했나(파일 표) · 왜(버린 대안은 스펙 참조) · 게이트 10 과 음성 대조 표 · 브라우저 실측 · 리뷰 지적과 처리 · 지금 상태 · 확인 질문 2~3개. `docs/com/open-work.md` 의 "지금 하는 것" 에 34단계 한 문단, 리뷰가 남긴 것이 있으면 새 항목.

- [ ] **Step 6: 전체 게이트 재확인 뒤 대표 확인**

Run (PowerShell): `1..10 | % { node scripts/check-stage34.mjs "S34-G$_" }` 그리고 `node scripts/check-stage22.mjs S22-G6`.
전부 `_OK` 인 출력을 보고에 붙인다. **커밋·머지는 대표 확인 뒤** — 확인되면 `stage-34-character-colors` 에서 커밋하고 `main` 에 `--ff-only` 머지, 푸시.

---

## 자기 점검 (계획을 쓴 뒤 스펙과 대조)

- 스펙 "부위 여섯과 출처" 표 → Task 3. 피부 우선순위 셋 → Task 3 ①·①'·③ + Task 1 종족표. 이웃 명도차 → Task 3 `guarded` + G5.
- 색 낱말 → 코퍼스 → Task 1 + G2. 종족표 → Task 1 + G4·G6·G8. 파서·폴백 → Task 2 + G1·G6·G7.
- API 응답 형태 → Task 5. 재질 별도 표 → Task 4. 저장·`/saved`·내보내기 → Task 6 + G8. 화면 탭·카드·내역 → Task 7 + G9. Ollama 없을 때 → G6.
- 형 일치: `composeCharacter({parts, creature, pair, corpus})` 를 Task 0(검사기)·Task 5·Task 6 이 같은 이름으로 부른다. `nearestCorpus(wordId, corpus, used)` 도 같다. `describe` 의 반환에 `creature` 객체가 있고 서버는 `.id`·`.finish`·`.skin` 을 읽는다.
- 자리표시자 없음. "TBD" 없음. 알려진 한계는 실측 뒤 채우는 것이라 Task 8 에 목록으로 박아 두었다.
