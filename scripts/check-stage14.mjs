#!/usr/bin/env node
// 14단계(LLM 이 배색 구조 다섯을 고른다) 완료 조건 검사기.
//   node scripts/check-stage14.mjs S14-G1

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadStructures } from "../src/expand.js";
import { PICK_COUNT, fallbackSelection, parseSelection, systemPrompt } from "../src/structure.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const catalog = () => loadStructures().map((s) => ({ id: s.id, name: s.name, principle: s.principle }));

/**
 * **폴백 순서를 데이터에서 직접 읽는다. fallbackSelection 을 부르지 않는다.**
 *
 * 처음엔 기대값을 `fallbackSelection()` 으로 만들었는데, 그러면 그 함수가 무엇을 내든 기대값도
 * 같이 따라가 게이트가 아무것도 검사하지 않는다 — 폴백 순서를 통째로 뒤집는 뮤테이션에서
 * G1·G2 가 둘 다 통과했다(리뷰 지적, 재현 확인).
 *
 * 폴백은 "카탈로그 파일에 적힌 순서의 앞 다섯" 이고, 그 다섯은 원전 1절 기법표 넷과 4절 첫
 * 항목이다. 그러니 파일에서 읽는 것이 정의 그대로다.
 */
const expectedFallback = (count = PICK_COUNT) =>
  JSON.parse(read("data/structures.json")).structures.slice(0, count).map((s) => s.id);

/**
 * 가짜 Ollama. `/api/tags` 로 준비됨을 만들고 `/api/chat` 호출을 **센다.**
 * 진짜 모델을 쓰면 답이 매번 달라 게이트가 흔들린다 — 여기서 재는 것은 "부르는가" 이지
 * "잘 고르는가" 가 아니다.
 */
function stubOllama({ chatDelayMs = 0, reply = null } = {}) {
  let chatCalls = 0;
  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }] }));
    }
    if (req.url === "/api/chat") {
      chatCalls += 1;
      req.resume();
      if (chatDelayMs) await new Promise((r) => setTimeout(r, chatDelayMs));
      if (res.writableEnded || res.destroyed) return undefined;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: reply ?? "{}" } }));
    }
    res.writeHead(404).end("{}");
    return undefined;
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ port: server.address().port, calls: () => chatCalls, close: () => server.close() }),
    );
  });
}

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", OLLAMA_WARMUP: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`서버가 6초 안에 뜨지 않았다. stderr: ${stderr.trim() || "(없음)"}`));
    }, 6000);
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
  const child = await startServer(port, env);
  try {
    return await fn((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    child.kill();
  }
}

const seedId = () => JSON.parse(read("data/palettes.json")).palettes[0].id;
const ask = (get, q) =>
  get(`/api/expand?seed=${encodeURIComponent(seedId())}${q === undefined ? "" : `&q=${encodeURIComponent(q)}`}`);

const gates = {
  // 모델이 뭘 뱉든 여기서 걸러 낸다. 통과시키면 화면이 이름 없는 칸을 그리거나 그 자리가 조용히 빈다.
  "S14-G1": async () => {
    const ids = catalog().map((s) => s.id);
    const known = new Set(ids);
    const bad = [];

    const check = (label, raw, wantMatched = null) => {
      let got;
      try {
        got = parseSelection(raw, ids);
      } catch (err) {
        bad.push(`${label}: 던졌다 — ${err.message}`);
        return null;
      }
      const picked = got?.ids;
      if (!Array.isArray(picked)) {
        bad.push(`${label}: ids 가 배열이 아니다`);
        return null;
      }
      if (picked.length !== PICK_COUNT) bad.push(`${label}: ${picked.length}개 (${PICK_COUNT} 이어야 한다)`);
      if (picked.some((id) => !known.has(id))) bad.push(`${label}: 카탈로그에 없는 id — ${picked}`);
      if (new Set(picked).size !== picked.length) bad.push(`${label}: 중복 — ${picked}`);
      // **모델이 몇 개를 보탰는지도 본다.** 이게 없으면 "쓸 수 있는 게 하나도 없었다" 를
      // 호출부가 모르고, 화면이 폴백을 "LLM 이 골랐다" 고 말하게 된다(리뷰 지적).
      if (!Number.isInteger(got.matched) || got.matched < 0 || got.matched > PICK_COUNT) {
        bad.push(`${label}: matched 가 ${got.matched}`);
      }
      if (wantMatched !== null && got.matched !== wantMatched) {
        bad.push(`${label}: matched 가 ${got.matched} (${wantMatched} 이어야 한다)`);
      }
      return got;
    };

    check("정상 5개", JSON.stringify({ ids: ids.slice(3, 8) }), 5);
    check("없는 id 섞임", JSON.stringify({ ids: ["없는거", ids[2], "__proto__", ids[7], "toString"] }), 2);
    check("프로토타입 이름만", JSON.stringify({ ids: ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"] }), 0);
    check("중복만", JSON.stringify({ ids: [ids[0], ids[0], ids[0], ids[0], ids[0]] }), 1);
    check("모자람", JSON.stringify({ ids: ids.slice(0, 2) }), 2);
    check("넘침", JSON.stringify({ ids: [...ids, ...ids] }));
    check("빈 배열", JSON.stringify({ ids: [] }), 0);
    check("ids 가 문자열", JSON.stringify({ ids: ids[0] }));
    check("ids 없음", JSON.stringify({ picked: ids.slice(0, 5) }));
    check("JSON 아님", "그냥 말로 답했습니다", 0);
    check("null", "null");
    check("문자열 아닌 원소", JSON.stringify({ ids: [1, null, { a: 1 }, [], ids[7]] }));

    // 모델이 맞힌 것은 순서까지 살아야 한다. 다 버리고 카탈로그 순서로 덮으면 LLM 을 쓸 이유가 없다.
    const kept = parseSelection(JSON.stringify({ ids: [ids[7], ids[6]] }), ids);
    if (kept.ids[0] !== ids[7] || kept.ids[1] !== ids[6]) bad.push(`모델이 맞힌 순서가 안 지켜졌다 — ${kept.ids}`);
    if (kept.matched !== 2) bad.push(`모델이 둘을 맞혔는데 matched=${kept.matched}`);

    // 음성 대조 — 카탈로그에 없는 id 만 준 경우가 폴백과 같아야 이 검사가 살아 있다.
    const junk = parseSelection(JSON.stringify({ ids: ["a", "b", "c"] }), ids);
    if (junk.ids.join() !== expectedFallback().join()) bad.push(`쓰레기 입력이 카탈로그 앞 다섯과 다르다 — ${junk.ids}`);
    if (junk.matched !== 0) bad.push(`쓰레기 입력인데 matched=${junk.matched}`);
    // fallbackSelection 자체도 카탈로그 파일과 맞아야 한다 — 이 검사가 그 함수를 실제로 본다.
    if (fallbackSelection(ids).join() !== expectedFallback().join()) {
      bad.push(`fallbackSelection 이 카탈로그 앞 다섯과 다르다 — ${fallbackSelection(ids)}`);
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`이상 입력 12종 전부 ${PICK_COUNT}개·실재 id·중복 없음`);
    out("S14_G1_OK");
  },

  // Ollama 를 못 쓰면 카탈로그 앞 다섯으로 물러선다. 이 사이트의 전제다 — 없으면 안 쓴다.
  "S14-G2": async () => {
    const bad = [];
    const expected = expectedFallback().join();

    // 아무도 듣지 않는 포트를 가리킨다.
    await withServer(4291, { OLLAMA_HOST: "127.0.0.1:11599" }, async (get) => {
      const res = await ask(get, "병원 앱, 차갑지 않게");
      if (res.status !== 200) bad.push(`Ollama 없이 ${res.status}`);
      const body = await res.json();
      if (body.selection?.from !== "fallback") bad.push(`from 이 ${body.selection?.from}`);
      if (body.selection?.ids?.join() !== expected) bad.push(`폴백 순서가 다르다 — ${body.selection?.ids}`);
      if (body.structures?.length !== 8) bad.push(`구조가 ${body.structures?.length}개`);
      if (!body.selection?.error) bad.push("못 쓴 이유를 안 알린다");

      // 검색은 그대로 돌아야 한다.
      const search = await get(`/api/search?q=${encodeURIComponent("가을 카페")}`);
      if (search.status !== 200) bad.push(`Ollama 없이 검색이 ${search.status}`);
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out(`Ollama 없이도 200 · 폴백 ${PICK_COUNT}개 · 검색 정상`);
    out("S14_G2_OK");
  },

  // 질의가 없으면 부르지 않는다. 고를 근거가 없는데 부르면 비용만 쓰고 답을 지어낸다.
  "S14-G3": async () => {
    const stub = await stubOllama({ reply: JSON.stringify({ ids: [] }) });
    const bad = [];
    try {
      await withServer(4292, { OLLAMA_HOST: `127.0.0.1:${stub.port}` }, async (get) => {
        // 질의 없이 여러 번 — 한 번도 모델에 닿으면 안 된다.
        for (let i = 0; i < 8; i += 1) {
          const res = await ask(get, undefined);
          if (res.status !== 200) bad.push(`질의 없이 ${res.status}`);
          const body = await res.json();
          if (body.selection?.from !== "fallback") bad.push(`질의 없는데 from=${body.selection?.from}`);
        }
        // 공백만 있는 질의도 같다.
        for (const blank of ["", "   ", "\t\n"]) {
          await (await ask(get, blank)).json();
        }
        if (stub.calls() !== 0) bad.push(`질의가 없는데 모델을 ${stub.calls()}회 불렀다`);

        // 양성 대조 — 질의가 있으면 실제로 부른다. 이게 없으면 위 검사는 "아예 안 부른다" 로도 통과한다.
        await (await ask(get, "가을 카페 브랜딩")).json();
        if (stub.calls() === 0) bad.push("질의가 있어도 모델을 안 부른다 — 이 게이트가 헛돌고 있다");
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`질의 없는 요청 11회에 모델 호출 0회 · 질의 있으면 호출됨`);
    out("S14_G3_OK");
  },

  // 선택이 구조를 지우거나 지어내지 않는다. 여덟은 그대로 있고 고른 것은 별도 필드다.
  "S14-G4": async () => {
    const stub = await stubOllama({ reply: JSON.stringify({ ids: ["없는거", "__proto__"] }) });
    const bad = [];
    try {
      await withServer(4293, { OLLAMA_HOST: `127.0.0.1:${stub.port}` }, async (get) => {
        const body = await (await ask(get, "아무 질의")).json();
        const structureIds = (body.structures ?? []).map((s) => s.id);

        if (structureIds.length !== 8) bad.push(`구조가 ${structureIds.length}개`);
        if (new Set(structureIds).size !== structureIds.length) bad.push("구조 id 가 중복이다");
        // 카탈로그와 정확히 같은 집합이어야 한다 — 선택이 구조 목록을 건드리면 안 된다.
        const want = catalog().map((s) => s.id).sort().join();
        if (structureIds.slice().sort().join() !== want) bad.push("구조 목록이 카탈로그와 다르다");

        for (const id of body.selection?.ids ?? []) {
          if (!structureIds.includes(id)) bad.push(`고른 id ${id} 가 구조에 없다`);
        }
        if (body.selection?.count !== PICK_COUNT) bad.push(`count 가 ${body.selection?.count}`);
        // 구조마다 색이 그대로 있어야 한다 — 선택이 색을 건드리지 않는다.
        for (const st of body.structures ?? []) {
          if (!Array.isArray(st.colors) || st.colors.length < 2) bad.push(`${st.id} 에 색이 없다`);
          if (st.colors?.some((c) => !/^#[0-9a-f]{6}$/.test(c.hex ?? ""))) bad.push(`${st.id} 헥스 형식`);
        }
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("구조 8개 그대로 · 선택은 별도 필드 · 고른 id 가 전부 실재");
    out("S14_G4_OK");
  },

  // 모델이 고른 순서가 응답에 그대로 실린다. 안 실리면 LLM 을 쓸 이유가 없다.
  "S14-G5": async () => {
    const ids = catalog().map((s) => s.id);
    const wanted = [ids[7], ids[5], ids[2], ids[6], ids[1]];
    const stub = await stubOllama({ reply: JSON.stringify({ ids: wanted }) });
    const bad = [];
    try {
      await withServer(4294, { OLLAMA_HOST: `127.0.0.1:${stub.port}` }, async (get) => {
        const body = await (await ask(get, "가을 카페 브랜딩")).json();
        if (body.selection?.from !== "llm") bad.push(`from 이 ${body.selection?.from}`);
        if (body.selection?.ids?.join() !== wanted.join()) {
          bad.push(`순서가 다르다 — 받은 ${body.selection?.ids} / 보낸 ${wanted}`);
        }
        if (body.selection?.ids?.length !== PICK_COUNT) bad.push(`${body.selection?.ids?.length}개`);
        if (!body.selection?.model) bad.push("어느 모델이 골랐는지 안 알린다");

        // 음성 대조 — 폴백 순서와 같으면 "그냥 카탈로그 순서" 를 통과시키고 있는 것이다.
        if (body.selection?.ids?.join() === expectedFallback().join()) {
          bad.push("고른 결과가 폴백과 같다 — 이 게이트가 헛돌고 있다");
        }
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`모델이 고른 순서가 그대로 실림 — ${wanted.join(" › ")}`);
    out("S14_G5_OK");
  },

  // 모델이 느리거나 죽어도 펼치기가 막히지 않는다.
  "S14-G6": async () => {
    // 타임아웃보다 훨씬 오래 끄는 모델.
    const stub = await stubOllama({ chatDelayMs: 8000, reply: JSON.stringify({ ids: [] }) });
    const bad = [];
    try {
      await withServer(4295, { OLLAMA_HOST: `127.0.0.1:${stub.port}`, STRUCTURE_TIMEOUT_MS: "700" }, async (get) => {
        const started = Date.now();
        const res = await ask(get, "느린 모델");
        const took = Date.now() - started;
        if (res.status !== 200) bad.push(`시간 초과에 ${res.status}`);
        const body = await res.json();
        if (body.structures?.length !== 8) bad.push(`구조가 ${body.structures?.length}개`);
        if (body.selection?.from !== "fallback") bad.push(`from 이 ${body.selection?.from}`);
        if (!/응답하지 않았다/.test(body.selection?.error ?? "")) {
          bad.push(`시간 초과라고 안 말한다 — ${body.selection?.error}`);
        }
        // 타임아웃을 실제로 지켰는가. 안 지키면 사용자가 8초를 기다린다.
        if (took > 4000) bad.push(`${took}ms 걸렸다 — 타임아웃이 안 걸린다`);
      });
    } finally {
      stub.close();
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out("느린 모델에서도 200 · 폴백 · 타임아웃 준수");
    out("S14_G6_OK");
  },

  // 정적 검사다 — 회귀 스모크지 동작 증명이 아니다. 실제 동작은 브라우저에서 따로 확인했다.
  "S14-G7": async () => {
    const bad = [];
    const app = stripComments(read("public/app.js"));
    const css = read("public/app.css");

    // 질의를 함께 보낸다. 안 보내면 서버가 LLM 을 부를 근거가 없어 늘 폴백이 된다.
    if (!/&q=\$\{encodeURIComponent/.test(app)) bad.push("화면이 질의를 안 보낸다");
    if (!/selection/.test(app)) bad.push("화면이 selection 을 안 읽는다");
    // 고른 것만 먼저 그린다.
    if (!/selection\?\.ids/.test(app)) bad.push("고른 id 로 거르는 곳이 없다");
    // 나머지를 지우지 않고 접어 둔다.
    if (!/expand__more/.test(app)) bad.push("나머지를 보여줄 자리가 없다");
    // **무엇이 골랐는지 밝힌다.** 안 밝히면 폴백일 때도 사용자는 LLM 이 고른 줄 안다.
    if (!/from === "llm"/.test(app)) bad.push("LLM 이 골랐는지 구분하지 않는다");
    if (!/LLM 이 고름/.test(app)) bad.push("LLM 이 골랐다는 표시가 없다");
    if (!/기본 순서/.test(app)) bad.push("폴백이라는 표시가 없다");

    for (const cls of ["expand__more-toggle", "expand__note-text"]) {
      if (!css.includes(`.${cls}`)) bad.push(`${cls} 스타일이 없다`);
    }
    const moreRule = css.match(/\.expand__more-toggle\s*\{[^}]*\}/)?.[0] ?? "";
    if (!/font-size/.test(moreRule)) bad.push("나머지 버튼 규칙을 찾지 못했다");

    if (bad.length) throw new Error(bad.join(" / "));
    out("S14_G7_OK");
  },

  /*
   * **모델이 응답했지만 쓸 수 있는 게 없으면 "LLM 이 골랐다" 고 말하지 않는다.**
   *
   * 이게 없던 동안, 카탈로그에 없는 id 만 받아도 `from: "llm"` 에 `error: null` 이었다.
   * 결과는 카탈로그 앞 다섯과 **바이트 단위로 같은데** 화면은 "질문에 맞는 5가지를 로컬 LLM 이
   * 골랐습니다" 라고 말했다(리뷰 지적, 재현 확인). 배지를 단 이유가 바로 이것이었는데
   * 그 배지가 거짓말을 하고 있었다.
   *
   * 정적 검사(S14-G7)로는 못 잡는다 — 배지 문구는 있고 값이 틀린 것이기 때문이다.
   * 그래서 실제 서버를 세워 응답을 본다.
   */
  "S14-G8": async () => {
    const ids = catalog().map((s) => s.id);
    const bad = [];

    const cases = [
      ["쓸 수 있는 id 0개", JSON.stringify({ ids: ["없는거1", "__proto__", "없는거2"] }), "fallback", 0],
      ["빈 배열", JSON.stringify({ ids: [] }), "fallback", 0],
      ["JSON 이 아님", "그냥 말로 답했습니다", "fallback", 0],
      // 양성 대조 — 하나라도 건지면 llm 이다. 아니면 이 게이트는 "늘 fallback" 을 통과시킨다.
      ["하나만 맞힘", JSON.stringify({ ids: [ids[7], "없는거"] }), "llm", 1],
      ["다섯 다 맞힘", JSON.stringify({ ids: ids.slice(3, 8) }), "llm", 5],
    ];

    let port = 4297;
    for (const [label, reply, wantFrom, wantMatched] of cases) {
      const stub = await stubOllama({ reply });
      try {
        await withServer(port, { OLLAMA_HOST: `127.0.0.1:${stub.port}` }, async (get) => {
          const body = await (await ask(get, "가을 카페 브랜딩")).json();
          const sel = body.selection ?? {};
          if (sel.from !== wantFrom) bad.push(`${label}: from 이 ${sel.from} (${wantFrom} 이어야 한다)`);
          if (sel.matched !== wantMatched) bad.push(`${label}: matched 가 ${sel.matched} (${wantMatched})`);

          if (wantFrom === "fallback") {
            // 폴백이면 이유를 말해야 한다. 안 말하면 화면이 왜 기본 순서인지 못 알린다.
            if (!sel.error) bad.push(`${label}: 폴백인데 이유가 없다`);
            if (sel.ids?.join() !== expectedFallback().join()) bad.push(`${label}: 폴백 순서가 다르다`);
          } else if (sel.error) {
            bad.push(`${label}: 성공인데 오류가 있다 — ${sel.error}`);
          }
        });
      } finally {
        stub.close();
      }
      port += 1;
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out("모델이 못 고르면 from=fallback · 하나라도 고르면 from=llm");
    out("S14_G8_OK");
  },

  /*
   * **서버가 실제로 넘기는 카탈로그로 만든 프롬프트에 detail 이 들어 있는가.**
   *
   * `principle` 은 기법만 말하고 증상 낱말이 없다 — 공기원근의 principle 은
   * "먼 쪽은 대비·채도를 낮추고…" 라서 `평면`·`깊이` 가 없고 그 낱말은 detail 에만 있다.
   *
   * 프롬프트에 detail 을 넣도록 고쳐 놓고 **server.js 가 카탈로그를 만들 때 그 필드를 떨어뜨려**
   * 개선이 통째로 무효였다. 이 저장소가 이미 기록한 것과 같은 부류다 — `warmUp` 이 import 만
   * 되고 호출부가 없었는데 "워밍업으로 빨라졌다" 고 보고한 일. **필드를 넣는 것과 그 필드가
   * 실제로 쓰이는 것은 다르다.**
   *
   * 그래서 코드 모양을 보지 않고 **완성된 프롬프트 문자열**을 본다.
   */
  "S14-G9": async () => {
    const bad = [];
    const full = loadStructures();

    // server.js 가 실제로 만드는 카탈로그를 그 소스에서 확인한다 — 여기서 따로 만들면
    // 게이트만 통과하고 제품은 안 고쳐진 채로 남는다(방금 그렇게 됐다).
    const serverSrc = stripComments(read("server.js"));
    // **무엇에서 map 하는지는 안 고정한다.** 처음엔 `loadStructures().map(` 로 앵커를 박았고,
    // 15단계에서 요청당 파일 재읽기를 없애려고 모듈 캐시(`fullCatalog.map(`)로 바꾸자 이 게이트가
    // 통째로 실패했다 — 투영은 그대로였는데 앵커만 안 맞았다. 무는 것은 **투영에 네 필드가 있는가**다.
    const projection = serverSrc.match(/const structureCatalog = [^;=]{0,60}\.map\([\s\S]{0,220}?\);/)?.[0] ?? "";
    if (!projection) bad.push("server.js 의 카탈로그 조립부를 못 찾았다");
    for (const field of ["id", "name", "principle", "detail"]) {
      if (!new RegExp(`\\b${field}\\b`).test(projection)) bad.push(`서버 카탈로그가 ${field} 를 안 넘긴다`);
    }

    // 완성된 프롬프트에 각 구조의 detail 문장이 실제로 들어 있는가.
    const catalogForPrompt = full.map((s) => ({ id: s.id, name: s.name, principle: s.principle, detail: s.detail }));
    const prompt = systemPrompt(catalogForPrompt);
    for (const s of full) {
      if (!prompt.includes(s.id)) bad.push(`프롬프트에 ${s.id} 가 없다`);
      if (!prompt.includes(s.principle)) bad.push(`프롬프트에 ${s.id} 의 principle 이 없다`);
      if (!prompt.includes(s.detail)) bad.push(`프롬프트에 ${s.id} 의 detail 이 없다`);
    }

    // 증상 낱말이 실제로 프롬프트에 도달하는가 — 이게 detail 을 넣는 이유다.
    for (const word of ["평면적", "깊이", "차갑고", "탁"]) {
      if (!prompt.includes(word)) bad.push(`프롬프트에 증상 낱말 "${word}" 가 없다`);
    }

    // 음성 대조 — detail 을 뺀 카탈로그로 만들면 그 낱말이 사라져야 한다.
    // 안 사라지면 위 검사는 다른 곳에서 우연히 걸린 것이다.
    const without = systemPrompt(full.map((s) => ({ id: s.id, name: s.name, principle: s.principle })));
    if (without.includes("평면적")) bad.push("detail 없이도 '평면적' 이 프롬프트에 있다 — 이 게이트가 헛돌고 있다");

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`프롬프트에 구조 ${full.length}개의 principle·detail 이 전부 실림`);
    out("S14_G9_OK");
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
