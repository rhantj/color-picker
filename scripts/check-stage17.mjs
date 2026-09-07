#!/usr/bin/env node
// 17단계(LLM 이 역할별 재질을 배정한다) · 17-A 완료 조건 검사기.
//   node scripts/check-stage17.mjs S17-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 여덟 게이트가 전부 실패하는 것을 확인한 뒤에
// src/finish.js 를 만들었다. 통과부터 하는 게이트는 무엇을 지키는지 알 수 없다.
//
// 17-A 는 배정 엔진까지다. `/api/expand` 에 얹는 것과 화면 표시는 17-B 다.
//
// **`src/finish.js` 를 정적으로 import 하지 않는다.** 그 모듈이 `OLLAMA_HOST` 를 모듈 적재
// 시점에 읽으므로, 가짜 Ollama 로 향하게 하려면 **환경변수를 먼저 세우고 동적으로 불러야** 한다.
// 정적 import 로 두면 진짜 포트(11434)를 물고 올라와 이 기계에 Ollama 가 떠 있는지에 따라
// 게이트 결과가 달라진다 — 그건 검사가 아니라 운이다.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandAll } from "../src/expand.js";
import { applyFinish } from "../src/material.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **`material.js` 의 기본 배정과 같은 표를 독립적으로 적는다.**
 *
 * 기대값을 `DEFAULT_FINISH_BY_ROLE` 에서 가져오면 그 표를 통째로 뒤집어도 기대값이 함께
 * 따라가 게이트가 아무것도 검사하지 않는다. check-stage14 가 폴백 순서에 대해 정확히 같은
 * 지적을 받았고(`fallbackSelection()` 으로 기대값을 만들었다가 뮤테이션에 뚫렸다),
 * 16단계에서도 `METAL_MIN` 을 게이트가 감시 대상에서 import 하다가 같은 부류로 뚫렸다.
 *
 * **세 번째다. 이번에는 처음부터 사본으로 적는다.**
 */
const EXPECTED_FALLBACK = Object.freeze({
  바탕: "matte",
  면: "metal",
  본문: "gloss",
  강조: "emissive",
  "먼 쪽": "matte",
  중간: "gloss",
  "가까운 쪽": "metal",
});
const ROLES = Object.freeze(Object.keys(EXPECTED_FALLBACK));

/** 재질 id 도 같은 이유로 여기 다시 적는다. */
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);

/**
 * 가짜 Ollama. `/api/tags` 로 준비됨을 만들고 `/api/chat` 호출을 **센다.**
 * check-stage14 의 것과 같은 모양을 독립적으로 적는다 — 한쪽에서 읽어 오면 그쪽 하네스가
 * 바뀔 때 이 단계 게이트가 조용히 다른 것을 검사하게 된다.
 *
 * 진짜 모델을 쓰면 답이 매번 달라 게이트가 흔들린다. 여기서 재는 것은 "부르는가 · 응답을
 * 어떻게 다루는가" 이지 "잘 배정하는가" 가 아니다.
 */
function stubOllama(initial = {}) {
  let cfg = { chatDelayMs: 0, reply: null, status: 200, ...initial };
  let chatCalls = 0;
  let lastBody = null;
  const sockets = new Set();

  const server = createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "stub-model:1b" }] }));
    }
    if (req.url === "/api/chat") {
      chatCalls += 1;
      let raw = "";
      for await (const chunk of req) raw += chunk;
      lastBody = raw;
      const { chatDelayMs, reply, status } = cfg;
      if (chatDelayMs) await new Promise((r) => setTimeout(r, chatDelayMs));
      if (res.writableEnded || res.destroyed) return undefined;
      if (status !== 200) {
        res.writeHead(status, { "content-type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ message: { content: reply ?? "{}" } }));
    }
    res.writeHead(404).end("{}");
    return undefined;
  });
  server.on("connection", (sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        // **한 스텁을 계속 쓰면서 행동만 바꾼다.** 아래 withStub 주석이 이유를 적는다.
        set: (next) => {
          cfg = { chatDelayMs: 0, reply: null, status: 200, ...next };
        },
        calls: () => chatCalls,
        resetCalls: () => {
          chatCalls = 0;
        },
        lastPrompt: () => lastBody,
        // 지연 응답이 떠 있는 채로 닫으면 Windows 에서 libuv 어서션이 뜬다. 소켓을 먼저 끊는다.
        close: () => {
          for (const sock of sockets) sock.destroy();
          server.close();
        },
      }),
    );
  });
}

/**
 * 가짜 Ollama 를 **한 번만** 세우고, 그 뒤에 finish.js 를 불러 온다.
 *
 * **한 게이트 안에서 스텁을 두 번 세우면 안 된다.** `finish.js` 와 `ollama.js` 는 둘 다
 * `OLLAMA_HOST` 를 모듈 적재 시점에 읽고 ESM 은 모듈을 캐시한다. 두 번째 스텁은 새 포트를
 * 받지만 모듈은 **첫 포트를 계속 문다** — 요청이 닫힌 포트로 가서 연결 거부로 폴백한다.
 *
 * 처음에 그렇게 썼고 **S17-G4 가 우연히 통과했다.** HTTP 500 을 검사한다고 적어 놓고 실제로는
 * 연결 거부를 재고 있었다. 폴백이라는 결과가 같아서 눈으로는 안 보였다.
 * 그래서 스텁 하나를 세워 두고 **행동만 바꾼다**(`stub.set`).
 */
async function withStub(initial, fn) {
  const stub = await stubOllama(initial);
  process.env.OLLAMA_HOST = `127.0.0.1:${stub.port}`;
  try {
    const mod = await import("../src/finish.js");
    return await fn(mod, stub);
  } finally {
    stub.close();
  }
}

/** Ollama 가 아예 없는 자리. 닫힌 포트로 향하게 한다. */
async function withoutOllama(fn) {
  // 잠깐 열었다 닫아 **아무도 안 듣는 포트 번호**를 얻는다.
  const probe = await stubOllama({});
  const dead = probe.port;
  probe.close();
  await new Promise((r) => setTimeout(r, 30));
  process.env.OLLAMA_HOST = `127.0.0.1:${dead}`;
  const mod = await import("../src/finish.js");
  return fn(mod);
}

const sameTable = (a, b) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

const GATES = {
  /*
   * 모델이 뭘 뱉든 걸러 낸다. **순수 함수라 네트워크 없이 전수로 돌릴 수 있다.**
   *
   * 걸러야 하는 것 넷 — 없는 역할 · 없는 재질 · 문자열이 아닌 값 · 프로토타입 이름.
   * 통과시키면 화면이 이름 없는 재질을 그리거나 `applyFinish` 가 던진다.
   *
   * **빠진 자리는 기본 배정으로 채운다.** 모델이 셋만 맞혔다고 통째로 버리면 그 판단까지 잃는다 —
   * `parseSelection` 이 모자란 자리를 카탈로그 순서로 채우는 것과 같은 선택이다.
   *
   * **음성 대조가 이 게이트의 절반이다.** "걸러 낸다" 는 아무것도 안 걸러도 통과할 수 있다.
   * 쓰레기만 준 응답이 **정확히 기본 배정과 같아지는지**를 함께 확인한다.
   */
  "S17-G1": async () => {
    const { parseAssignment } = await import("../src/finish.js");
    const bad = [];

    const cases = [
      ["빈 객체", "{}", 0],
      ["JSON 아님", "이건 JSON 이 아니다", 0],
      ["assignments 없음", '{"note":"x"}', 0],
      ["assignments 가 배열", '{"assignments":[]}', 0],
      ["없는 역할만", '{"assignments":{"손잡이":"matte","지붕":"gloss"}}', 0],
      ["없는 재질만", '{"assignments":{"바탕":"velvet","본문":"suede"}}', 0],
      ["값이 문자열 아님", '{"assignments":{"바탕":3,"본문":null,"강조":{"id":"matte"}}}', 0],
      ["프로토타입 이름", '{"assignments":{"__proto__":"matte","constructor":"gloss"}}', 0],
      ["재질 자리에 프로토타입", '{"assignments":{"바탕":"__proto__"}}', 0],
      ["쓸 만한 것 하나", '{"assignments":{"바탕":"gloss","손잡이":"matte"}}', 1],
      ["절반", '{"assignments":{"바탕":"gloss","본문":"metal","강조":"matte"}}', 3],
      ["전부", `{"assignments":${JSON.stringify(Object.fromEntries(ROLES.map((r) => [r, "matte"])))}}`, ROLES.length],
    ];

    for (const [label, raw, wantMatched] of cases) {
      const got = parseAssignment(raw, ROLES, FINISH_IDS);
      if (got.matched !== wantMatched) bad.push(`${label}: matched ${got.matched} (기대 ${wantMatched})`);

      const keys = Object.keys(got.assignments);
      if (keys.length !== ROLES.length) bad.push(`${label}: 역할이 ${keys.length}개 (기대 ${ROLES.length})`);
      for (const role of ROLES) {
        const v = got.assignments[role];
        if (!FINISH_IDS.includes(v)) bad.push(`${label}: ${role} 에 ${v}`);
      }
      // 프로토타입이 새어 들어오지 않았는가.
      if (Object.getPrototypeOf(got.assignments) !== Object.prototype && Object.getPrototypeOf(got.assignments) !== null) {
        bad.push(`${label}: assignments 의 프로토타입이 오염됐다`);
      }
    }

    // 음성 대조 — 쓸 것을 하나도 안 준 응답은 기본 배정과 **정확히** 같아야 한다.
    for (const [label, raw] of cases.filter(([, , m]) => m === 0)) {
      const got = parseAssignment(raw, ROLES, FINISH_IDS);
      if (!sameTable(got.assignments, EXPECTED_FALLBACK)) {
        bad.push(`${label}: 쓸 것이 없는데 기본 배정과 다르다 — ${JSON.stringify(got.assignments)}`);
      }
    }
    // 그리고 쓸 것을 준 응답은 기본과 **달라야** 한다. 안 그러면 위 검사가 공허하다.
    const useful = parseAssignment('{"assignments":{"바탕":"emissive"}}', ROLES, FINISH_IDS);
    if (sameTable(useful.assignments, EXPECTED_FALLBACK)) {
      bad.push("모델이 준 배정이 반영되지 않는다 — 기본 배정과 같다");
    }

    if (bad.length) throw new Error(bad.slice(0, 6).join(" / "));
    out(`불량 응답 ${cases.filter(([, , m]) => m === 0).length}가지가 전부 기본 배정으로 · 쓸 만한 응답 ${cases.filter(([, , m]) => m > 0).length}가지가 반영됨`);
    out(`역할 ${ROLES.length}개가 언제나 전부 채워지고 값이 전부 실재하는 재질`);
    out("S17_G1_OK");
  },

  /*
   * Ollama 를 못 쓰면 **기본 배정으로 물러서고, 배정은 완전하다.**
   *
   * 이 사이트의 전제다 — Ollama 가 없어도 전문 검색과 파생이 그대로 돌아야 한다(S3-G1).
   * 재질도 같다. 물러선 배정이 불완전하면 그 역할이 화면에서 재질 없이 남는다.
   *
   * 기대값을 **위 독립 사본과 대조한다.** `DEFAULT_FINISH_BY_ROLE` 에서 가져오면 그 표를
   * 뒤집어도 게이트가 함께 따라간다.
   */
  "S17-G2": async () => {
    const bad = [];
    const got = await withoutOllama(async ({ selectFinishes }) => selectFinishes("네온 사이버펑크", ROLES));

    if (got.from !== "fallback") bad.push(`from 이 ${got.from}`);
    /*
     * **사유의 내용까지 본다.** 처음엔 `got.error` 가 있기만 하면 통과시켰고 뮤테이션이 뚫었다 —
     * Ollama 준비 검사를 지워도 `pickModel([])` 이 null 을 내 결국 폴백은 된다. 다만 사유가
     * "쓸 수 있는 로컬 모델이 없다" 로 바뀐다. **결과는 같고 진단만 틀린다** — 사용자는 모델을
     * 받으러 가지만 실제 문제는 Ollama 가 안 떠 있는 것이다. 틀린 진단은 침묵보다 나쁘다.
     */
    if (!/Ollama 를 쓸 수 없다/.test(got.error ?? "")) {
      bad.push(`사유가 Ollama 를 가리키지 않는다 — ${got.error}`);
    }
    if (got.matched !== 0) bad.push(`matched 가 ${got.matched}`);
    if (!sameTable(got.assignments, EXPECTED_FALLBACK)) {
      bad.push(`기본 배정과 다르다 — ${JSON.stringify(got.assignments)}`);
    }

    // 물러선 배정으로 실제 파생 결과를 전부 칠할 수 있는가. 못 하면 화면이 빈다.
    const seed = JSON.parse(read("data/palettes.json")).palettes[0];
    let painted = 0;
    for (const st of expandAll(seed)) {
      for (const c of st.colors) {
        const id = got.assignments[c.role];
        if (!id) {
          bad.push(`역할 ${c.role} 에 배정이 없다`);
          continue;
        }
        applyFinish(c.hex, id, c.role);
        painted += 1;
      }
    }
    if (painted === 0) bad.push("칠한 자리가 0개다 — 이 검사가 공허하다");

    if (bad.length) throw new Error(bad.join(" / "));
    out(`Ollama 없이 from=fallback · 사유 있음 · 역할 ${Object.keys(got.assignments).length}개가 독립 사본과 일치`);
    out(`물러선 배정으로 파생 ${painted}자리를 전부 칠했다 — ${got.error}`);
    out("S17_G2_OK");
  },

  /*
   * 질의가 없으면 **모델을 아예 안 부른다.** 고를 근거가 없는데 부르면 비용만 쓰고 답을 지어낸다.
   * `selectStructures` 가 같은 자리에서 같은 판단을 한다(S14-G3).
   *
   * **양성 대조가 필수다.** "안 부른다" 는 아예 못 부르는 구현도 통과시킨다.
   */
  "S17-G3": async () => {
    const bad = [];
    await withStub({ reply: JSON.stringify({ assignments: {} }) }, async ({ selectFinishes }, stub) => {
      for (const blank of [undefined, null, "", "   ", "\t\n", 0, {}, []]) {
        const got = await selectFinishes(blank, ROLES);
        if (got.from !== "fallback") bad.push(`질의 ${JSON.stringify(blank)} 에 from=${got.from}`);
        if (!sameTable(got.assignments, EXPECTED_FALLBACK)) bad.push(`질의 ${JSON.stringify(blank)} 에 배정이 기본과 다르다`);
      }
      if (stub.calls() !== 0) bad.push(`질의가 없는데 모델을 ${stub.calls()}회 불렀다`);

      // 양성 대조 — 질의가 있으면 실제로 부른다.
      await selectFinishes("네온 사인 빛의 어두운 사이버펑크", ROLES);
      if (stub.calls() === 0) bad.push("질의가 있어도 모델을 안 부른다 — 이 게이트가 헛돌고 있다");
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("빈 질의 8가지에 모델 호출 0회 · 질의가 있으면 호출됨");
    out("S17_G3_OK");
  },

  /*
   * 느린 모델·실패한 모델이 배정을 막지 않는다. **타임아웃을 실제로 지키는지도 잰다** —
   * 안 지키면 사용자가 모델을 기다린다.
   */
  "S17-G4": async () => {
    const bad = [];
    process.env.FINISH_TIMEOUT_MS = "700";

    // **스텁 하나로 두 상황을 만든다.** 두 번 세우면 모듈이 첫 포트를 계속 문다(위 withStub 주석).
    await withStub({ chatDelayMs: 8000, reply: "{}" }, async ({ selectFinishes }, stub) => {
      const started = Date.now();
      const got = await selectFinishes("느린 모델", ROLES);
      const took = Date.now() - started;

      if (got.from !== "fallback") bad.push(`시간 초과에 from=${got.from}`);
      if (!/응답하지 않았다/.test(got.error ?? "")) bad.push(`시간 초과라고 안 말한다 — ${got.error}`);
      if (!sameTable(got.assignments, EXPECTED_FALLBACK)) bad.push("시간 초과인데 배정이 기본과 다르다");
      if (took > 4000) bad.push(`${took}ms 걸렸다 — 타임아웃이 안 걸린다`);
      out(`시간 초과 ${took}ms 만에 폴백 (상한 700ms 설정)`);

      // HTTP 오류도 같은 자리로 온다. **같은 포트**라 이번엔 실제로 500 을 받는다.
      stub.set({ status: 500 });
      const broken = await selectFinishes("망가진 모델", ROLES);
      if (broken.from !== "fallback") bad.push(`HTTP 500 에 from=${broken.from}`);
      if (!/500/.test(broken.error ?? "")) bad.push(`500 이라고 안 말한다 — ${broken.error}`);
      if (!sameTable(broken.assignments, EXPECTED_FALLBACK)) bad.push("HTTP 오류인데 배정이 기본과 다르다");

      // 양성 대조 — 같은 스텁이 멀쩡해지면 llm 이 나와야 한다. 아니면 위 둘은
      // "이 스텁으로는 늘 폴백" 을 재고 있는 것이다.
      stub.set({ reply: JSON.stringify({ assignments: { 바탕: "emissive" } }) });
      const ok = await selectFinishes("정상 모델", ROLES);
      if (ok.from !== "llm") bad.push(`스텁이 멀쩡한데 from=${ok.from} — 이 게이트가 폴백만 재고 있다`);
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out("느린 모델·HTTP 500 둘 다 폴백 · 사유 있음 · 배정 완전 · 양성 대조(정상 응답→llm) 통과");
    out("S17_G4_OK");
  },

  /*
   * **배지가 거짓말하지 않는다.** 모델이 응답은 했지만 쓸 수 있는 배정을 하나도 안 줬다면
   * 결과가 기본 배정과 똑같으므로 `from` 은 `"fallback"` 이다.
   *
   * `selectStructures` 가 같은 이유로 같은 판단을 한다(S14-G8) — 그렇게 안 하면 화면이
   * "질문에 맞춰 골랐다" 고 말하는데 실제로는 아무것도 고르지 않은 상태가 된다.
   *
   * **양성 대조 둘.** 하나라도 쓸 만하면 `"llm"` 이어야 하고, 그때 `matched` 가 실제 개수여야 한다.
   */
  "S17-G5": async () => {
    const bad = [];
    const useless = [
      ["빈 배정", JSON.stringify({ assignments: {} })],
      ["없는 역할만", JSON.stringify({ assignments: { 손잡이: "matte" } })],
      ["없는 재질만", JSON.stringify({ assignments: { 바탕: "velvet" } })],
      ["JSON 아님", "미안하지만 도와줄 수 없습니다"],
    ];

    // **스텁 하나로 전부 돈다.** 두 번 세우면 모듈이 첫 포트를 계속 문다(위 withStub 주석).
    await withStub({}, async ({ selectFinishes }, stub) => {
      for (const [label, reply] of useless) {
        stub.set({ reply });
        const got = await selectFinishes("아무 질의", ROLES);
        if (got.from !== "fallback") bad.push(`${label}: from=${got.from} — 아무것도 안 골랐는데 LLM 이 골랐다고 한다`);
        if (got.matched !== 0) bad.push(`${label}: matched=${got.matched}`);
        if (!got.model) bad.push(`${label}: 모델 이름이 없다 — 불렀다는 사실은 남겨야 한다`);
        if (!sameTable(got.assignments, EXPECTED_FALLBACK)) bad.push(`${label}: 배정이 기본과 다르다`);
      }

      // 양성 대조 ① 하나라도 쓸 만하면 llm
      stub.set({ reply: JSON.stringify({ assignments: { 바탕: "emissive", 손잡이: "matte" } }) });
      const one = await selectFinishes("아무 질의", ROLES);
      if (one.from !== "llm") bad.push(`쓸 만한 배정 하나인데 from=${one.from}`);
      if (one.matched !== 1) bad.push(`matched 가 ${one.matched} (기대 1)`);
      if (one.assignments["바탕"] !== "emissive") bad.push("모델이 준 배정이 반영 안 됐다");

      // 양성 대조 ② 전부 주면 matched 가 전부
      stub.set({ reply: JSON.stringify({ assignments: Object.fromEntries(ROLES.map((r) => [r, "gloss"])) }) });
      const all = await selectFinishes("아무 질의", ROLES);
      if (all.from !== "llm") bad.push(`전부 줬는데 from=${all.from}`);
      if (all.matched !== ROLES.length) bad.push(`matched 가 ${all.matched} (기대 ${ROLES.length})`);
      if (Object.values(all.assignments).some((v) => v !== "gloss")) bad.push("전부 줬는데 반영이 안 된 자리가 있다");
    });

    if (bad.length) throw new Error(bad.join(" / "));
    out(`쓸 것을 안 준 응답 ${useless.length}가지가 전부 from=fallback · matched=0 · 모델 이름은 남음`);
    out(`양성 대조: 하나만 줘도 llm(matched=1) · 전부 주면 matched=${ROLES.length}`);
    out("S17_G5_OK");
  },

  /*
   * 프롬프트에 **재질 넷의 이름·원리·detail 과 역할 이름이 전부** 들어 있다.
   *
   * S14-G9 가 같은 것을 구조 카탈로그에 대해 본다. 그때 `detail` 을 떨어뜨렸다가 프롬프트의
   * 그 자리가 늘 빈 문자열이라 개선이 통째로 무효였던 사고가 있었다. 같은 자리에 같은 검사를 둔다.
   *
   * **음성 대조** — detail 을 뺀 카탈로그로 만들면 그 낱말이 사라져야 한다. 안 사라지면 위
   * 검사는 다른 곳에서 우연히 걸린 것이다.
   */
  "S17-G6": async () => {
    const { systemPrompt } = await import("../src/finish.js");
    const bad = [];
    const catalog = JSON.parse(read("data/finishes.json")).finishes;

    const prompt = systemPrompt(ROLES, catalog);
    for (const f of catalog) {
      if (!prompt.includes(f.id)) bad.push(`프롬프트에 ${f.id} 가 없다`);
      if (!prompt.includes(f.name)) bad.push(`프롬프트에 ${f.id} 의 이름이 없다`);
      if (!prompt.includes(f.principle)) bad.push(`프롬프트에 ${f.id} 의 principle 이 없다`);
      if (!prompt.includes(f.detail)) bad.push(`프롬프트에 ${f.id} 의 detail 이 없다`);
    }
    for (const role of ROLES) if (!prompt.includes(role)) bad.push(`프롬프트에 역할 ${role} 이 없다`);

    // detail 에만 있는 낱말이 실제로 도달하는가 — detail 을 넣는 이유가 이것이다.
    const words = ["콘크리트", "아스팔트", "네온관", "반사"];
    for (const w of words) if (!prompt.includes(w)) bad.push(`프롬프트에 낱말 "${w}" 가 없다`);

    const without = systemPrompt(ROLES, catalog.map(({ detail, ...rest }) => rest));
    for (const w of ["콘크리트", "네온관"]) {
      if (without.includes(w)) bad.push(`detail 없이도 "${w}" 가 프롬프트에 있다 — 이 게이트가 헛돌고 있다`);
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`프롬프트에 재질 ${catalog.length}개의 id·이름·원리·detail 과 역할 ${ROLES.length}개가 전부 실림`);
    out(`음성 대조: detail 을 빼면 "콘크리트"·"네온관" 이 사라진다`);
    out("S17_G6_OK");
  },

  /*
   * **LLM 은 색에 닿지 않는다.** 이 사이트에서 가장 중요한 경계이고, 사용자가 고른 것이다.
   *
   * 모델이 고르는 것은 **재질 id 뿐**이고 헥스는 전부 씨앗의 HSL 연산에서 나온다.
   * `structure.js` 가 같은 경계를 지고 있다 — "모델이 무엇을 뱉든 화면에 없는 색이 생기지 않는다".
   *
   * 검사 방법 둘.
   *   ① 모델이 **헥스를 주입하려 드는** 응답을 뱉게 하고, 그래도 나오는 색이 "같은 재질 id 를
   *      직접 적용한 결과" 와 한 글자도 다르지 않은지 본다.
   *   ② **`selectFinishes` 가 돌려주는 객체 전체**가 닫힌 모양인지 본다.
   *
   * **②가 없었고 리뷰가 그것으로 뚫었다.** 반환에 `debugHex` 같은 필드를 더해 모델 응답의
   * 헥스를 실어도 게이트 여덟이 전부 통과했다(재현 확인) — ①은 `assignments` 만 보기 때문이다.
   * 17-B 가 이 객체를 응답에 얹는 순간 그 누수가 그대로 화면까지 간다.
   */
  "S17-G7": async () => {
    const bad = [];
    const seed = JSON.parse(read("data/palettes.json")).palettes[0];

    /**
     * **응답 본문에서 재질 id 만 꺼낸다.** 게이트가 직접 뽑은 값과 `selectFinishes` 가 준 값이
     * 같아야 한다 — 그 사이에 응답의 다른 필드(colors·baseColor·emission)가 끼어들 자리가 없다는 뜻이다.
     */
    const fromCleanRoom = (reply, role) => {
      let table = {};
      try {
        table = JSON.parse(reply)?.assignments ?? {};
      } catch {
        table = {};
      }
      const picked = typeof table === "object" && !Array.isArray(table) ? table[role] : undefined;
      return FINISH_IDS.includes(picked) ? picked : EXPECTED_FALLBACK[role];
    };

    /**
     * 결과 객체가 **닫힌 모양**인지 본다. 키가 목록 밖이거나, 값 어디에든 주입 헥스가 있으면 실패.
     *
     * 키 목록을 `finish.js` 에서 **읽어 오지 않고 여기 다시 적는다** — 읽어 오면 그쪽에 키를
     * 더하는 순간 이 검사도 함께 넓어져 아무것도 막지 않는다. 이 저장소가 같은 부류로 세 번
     * 지적받았다(`fallbackSelection()` · `METAL_MIN` · `DEFAULT_FINISH_BY_ROLE`).
     */
    const ALLOWED_KEYS = ["assignments", "from", "matched", "model", "elapsedMs", "error"];
    const shapeProblems = (got) => {
      const found = [];
      for (const key of Object.keys(got)) {
        if (!ALLOWED_KEYS.includes(key)) found.push(`결과에 모르는 키 ${key} — 모델 원문이 샐 자리다`);
      }
      const flat = JSON.stringify(got).toLowerCase();
      for (const inject of ["ff0000", "00ff00", "ff00ff"]) {
        if (flat.includes(inject)) found.push(`결과 어딘가에 주입된 ${inject} 가 있다`);
      }
      return found;
    };

    // 색을 주입하려 드는 응답들.
    const attacks = [
      JSON.stringify({ assignments: { 바탕: "matte" }, colors: { 바탕: "#ff0000" } }),
      JSON.stringify({ assignments: { 바탕: "#ff0000", 본문: "gloss" } }),
      JSON.stringify({ assignments: { 바탕: "matte" }, baseColor: "#00ff00", emission: "#ff00ff" }),
    ];

    await withStub({}, async ({ selectFinishes }, stub) => {
      for (const reply of attacks) {
        stub.set({ reply });
        const got = await selectFinishes("색을 지어내 봐", ROLES);
        let checked = 0;
        for (const st of expandAll(seed)) {
          for (const c of st.colors) {
            const id = got.assignments[c.role];
            // 배정된 재질 id 를 **직접** 적용한 것과 같아야 한다. 응답 본문이 끼어들 자리가 없다.
            const viaLlm = applyFinish(c.hex, id, c.role);
            // **응답 본문을 통째로 넣어도** 결과가 안 바뀌어야 한다. 앞서 두 식을 똑같이 써서
            // 늘 참인 검사를 만든 적이 있다 — 그건 검사가 아니라 항등식이다.
            const clean = applyFinish(c.hex, fromCleanRoom(reply, c.role), c.role);
            if (JSON.stringify(viaLlm) !== JSON.stringify(clean)) bad.push(`${c.role}: 결과가 다르다`);
            // 응답에 있던 헥스가 결과 어디에도 없어야 한다.
            const flat = JSON.stringify(viaLlm);
            for (const inject of ["ff0000", "00ff00", "ff00ff"]) {
              if (flat.toLowerCase().includes(inject)) bad.push(`${c.role}: 주입된 ${inject} 가 결과에 있다`);
            }
            checked += 1;
          }
        }
        if (checked === 0) bad.push("검사한 자리가 0개다");
        // 배정 값은 전부 실재하는 재질이어야 한다 — 헥스가 재질 자리에 앉으면 안 된다.
        for (const [role, id] of Object.entries(got.assignments)) {
          if (!FINISH_IDS.includes(id)) bad.push(`${role} 에 재질이 아닌 값 ${id}`);
        }

        // ② 반환 객체 전체 — 키가 닫혀 있고, 어디에도 주입 헥스가 없다.
        for (const problem of shapeProblems(got)) bad.push(problem);
      }
    });

    // **판정기 자체 대조.** 위 검사가 느슨해지면 게이트는 조용히 통과만 한다.
    const clean = { assignments: {}, from: "llm", matched: 1, model: "m", elapsedMs: 1 };
    if (shapeProblems(clean).length) bad.push(`판정기 자체 대조 실패 — 멀쩡한 결과를 막는다`);
    for (const [label, dirty] of [
      ["모르는 키", { ...clean, debugHex: "#ff0000" }],
      ["모르는 키(색 없이)", { ...clean, raw: "모델이 한 말" }],
      ["아는 키에 숨긴 헥스", { ...clean, model: "stub #ff0000" }],
    ]) {
      if (!shapeProblems(dirty).length) bad.push(`판정기 자체 대조 실패 — ${label} 을 통과시킨다`);
    }

    if (bad.length) throw new Error(bad.slice(0, 5).join(" / "));
    out(`색 주입 시도 ${attacks.length}가지에서 결과 색이 씨앗 HSL 연산 그대로 — 주입된 헥스 0건`);
    out(`반환 객체가 닫힌 모양(${ALLOWED_KEYS.join(" · ")}) · 판정기 자체 대조 1+3건 통과`);
    out("배정 값이 전부 실재하는 재질 id");
    out("S17_G7_OK");
  },

  /*
   * **폴백이 16단계의 기본 배정과 같은 표다.** 두 번 만들지 않는다 — 스펙 4.5 가 그렇게 정했다.
   *
   * 그리고 그 표가 **실제로 나오는 역할 전부**를 덮는지 여기서 다시 본다. S16-G11 이 같은 것을
   * 보지만, 이 단계는 그 표를 **폴백으로** 쓰므로 빠진 역할이 곧 배정 없는 자리가 된다.
   *
   * 기대값은 이 파일 맨 위의 독립 사본이다. `DEFAULT_FINISH_BY_ROLE` 에서 가져오지 않는다.
   */
  "S17-G8": async () => {
    const bad = [];
    const { fallbackAssignment } = await import("../src/finish.js");
    const { DEFAULT_FINISH_BY_ROLE } = await import("../src/material.js");

    const fb = fallbackAssignment(ROLES);
    if (!sameTable(fb, EXPECTED_FALLBACK)) bad.push(`폴백이 독립 사본과 다르다 — ${JSON.stringify(fb)}`);
    if (!sameTable(DEFAULT_FINISH_BY_ROLE, EXPECTED_FALLBACK)) {
      bad.push(`material.js 의 기본 배정이 독립 사본과 다르다 — ${JSON.stringify(DEFAULT_FINISH_BY_ROLE)}`);
    }

    // 실제로 나오는 역할 전부를 덮는가. 두 모드 · 씨앗 전부.
    const seeds = JSON.parse(read("data/palettes.json")).palettes;
    const seen = new Set();
    for (const seed of seeds) {
      for (const mode of ["light", "dark"]) {
        for (const st of expandAll(seed, undefined, { mode })) for (const c of st.colors) seen.add(c.role);
      }
    }
    for (const role of seen) if (!fb[role]) bad.push(`실제 역할 ${role} 이 폴백에 없다`);
    for (const role of Object.keys(fb)) if (!seen.has(role)) bad.push(`폴백에 있는 ${role} 이 실제 출력에 없다 — 죽은 항목`);
    if (seen.size === 0) bad.push("실제 역할이 0개다 — 이 검사가 공허하다");

    // 없는 역할을 물으면 던진다. 조용히 빈 자리를 만들지 않는다.
    for (const wrong of [["손잡이"], ["__proto__"], [1], [null]]) {
      let threw = null;
      try {
        fallbackAssignment(wrong);
      } catch (err) {
        threw = err;
      }
      if (!threw) bad.push(`없는 역할 ${JSON.stringify(wrong)} 에 던지지 않았다`);
    }

    if (bad.length) throw new Error(bad.join(" / "));
    out(`폴백이 독립 사본·material.js 기본 배정 셋 다 일치 — ${Object.entries(fb).map(([r, i]) => `${r}→${i}`).join(" · ")}`);
    out(`실제 역할 ${seen.size}가지를 전부 덮고 죽은 항목 없음 · 없는 역할 4가지에 던진다`);
    out("S17_G8_OK");
  },
};

const id = process.argv[2];
const gate = Object.hasOwn(GATES, String(id)) ? GATES[id] : null;
if (!gate) {
  out(`쓰는 법: node scripts/check-stage17.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(2);
}

try {
  await gate();
} catch (err) {
  out(`${id} 실패: ${err.message}`);
  process.exit(1);
}
