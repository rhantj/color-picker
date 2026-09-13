#!/usr/bin/env node
// 3단계 완료 조건 검사기 — Ollama 수명주기(G1~G6, G10) + 의도 분기·재작성(G7~G9).
//   node scripts/check-stage3.mjs S3-G1

// 서버마다 빈 임시 데이터 폴더를 준다(27단계). 임베딩 캐시가 var/ 에 남게 되면서 게이트가 저장소 var/ 를
// 더럽히게 됐다(리뷰 지적). 명시적으로 넘긴 TONEFIRST_DATA_DIR 이 있으면 그것이 이긴다(뒤의 ...env).
import { mkdtempSync as gateMkdtemp } from "node:fs";
import { tmpdir as gateTmpdir } from "node:os";
import { join as gateJoin } from "node:path";
const gateDataDir = () => gateMkdtemp(gateJoin(gateTmpdir(), "tonefirst-gate-"));
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 사용자가 이미 쓰고 있는 11434 는 건드리지 않는다. 검사는 빈 포트에서만 프로세스를 띄운다.
const DEAD_HOST = process.env.CHECK_OLLAMA_HOST ?? "127.0.0.1:11435";
const LIVE_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1", ...env },
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

// 모듈 상태(단일 비행·자식 핸들)가 검사끼리 섞이지 않게, 매번 새 프로세스에서 돌린다.
function runInChild(source, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c) => (stderr += c.toString("utf8")));
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`자식이 코드 ${code}: ${stderr.trim()}`));
      try {
        resolve(JSON.parse(stdout.trim().split("\n").pop()));
      } catch {
        reject(new Error(`자식 출력이 JSON 이 아니다: ${stdout.trim()} ${stderr.trim()}`));
      }
    });
  });
}

const ENSURE = `
import { ensureRunning } from "${new URL("../src/ollama.js", import.meta.url).href}";
const s = await ensureRunning();
console.log(JSON.stringify({ state: s.state, startedByUs: s.startedByUs, detail: s.detail, models: s.models.length }));
process.exit(0);
`;

const gates = {
  // 가장 중요한 것부터 — Ollama 가 없어도 사이트는 서비스되어야 한다.
  async "S3-G1"() {
    const port = 4310;
    const server = await startServer(port, { OLLAMA_BIN: "definitely-not-ollama", OLLAMA_HOST: "127.0.0.1:11499" });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent("병원 앱인데 차갑지 않게")}`);
      if (res.status !== 200) return `Ollama 가 없을 때 검색이 ${res.status}`;
      const hit = await res.json();
      if (hit.results?.[0]?.id !== "pair-10") return `Ollama 가 없을 때 결과가 달라졌다: ${hit.results?.[0]?.id}`;

      const home = await fetch(`http://127.0.0.1:${port}/`);
      if (home.status !== 200) return `Ollama 가 없을 때 홈 화면이 ${home.status}`;

      const st = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
      if (st.ollama?.state === "ready") return "미설치인데 ready 로 보고한다";
      return null;
    } finally {
      server.kill();
    }
  },

  // 죽어 있으면 띄운다.
  async "S3-G2"() {
    const r = await runInChild(ENSURE, { OLLAMA_HOST: DEAD_HOST });
    if (r.state !== "ready") return `자동 기동 실패: ${r.state} — ${r.detail}`;
    if (r.startedByUs !== true) return "우리가 띄웠는데 startedByUs 가 false";
    return null;
  },

  // 이미 떠 있으면 새로 띄우지 않는다 — 사용자가 직접 띄운 Ollama 를 건드리지 않기 위해서다.
  async "S3-G3"() {
    const r = await runInChild(ENSURE, { OLLAMA_HOST: LIVE_HOST });
    if (r.state !== "ready") {
      return `${LIVE_HOST} 에 Ollama 가 떠 있어야 이 검사가 성립한다 (지금 ${r.state}: ${r.detail})`;
    }
    if (r.startedByUs !== false) return "이미 떠 있는데 새로 띄웠다";
    return null;
  },

  // 단일 비행 — 동시 호출이 프로세스를 여러 개 띄우면 포트가 충돌한다.
  async "S3-G4"() {
    const source = `
      import { ensureRunning } from "${new URL("../src/ollama.js", import.meta.url).href}";
      const a = ensureRunning();
      const b = ensureRunning();
      const c = ensureRunning();
      const shared = a === b && b === c;
      const results = await Promise.all([a, b, c]);
      console.log(JSON.stringify({ shared, states: results.map((r) => r.state) }));
      process.exit(0);
    `;
    const r = await runInChild(source, { OLLAMA_HOST: DEAD_HOST });
    if (!r.shared) return "동시 호출이 같은 시도를 공유하지 않는다 (프로세스가 여러 개 뜰 수 있다)";
    if (new Set(r.states).size !== 1) return `공유했는데 결과가 갈렸다: ${r.states.join(", ")}`;
    return null;
  },

  // 사용자 입력이 프로세스 실행에 닿지 않는다.
  //
  // 아래 정적 검사는 **회귀 스모크지 보안 통제가 아니다.** 정규식으로 코드를 읽어 "무엇이 실행될지"
  // 판정하는 것은 원리적으로 불가능하고, 인자 이름만 바꿔도 빠져나간다. 그래서 마지막에
  // **행위 검사**를 붙였다 — 요청을 아무리 때려도 프로세스가 뜨지 않는다는 것을 실제로 확인한다.
  async "S3-G5"() {
    const src = readFileSync(new URL("../src/ollama.js", import.meta.url), "utf8");
    const bad = [];
    if (!/spawn\(BIN, \["serve"\]/.test(src)) bad.push("spawn 인자가 리터럴 [\"serve\"] 가 아니다");
    if (/shell:\s*true/.test(src)) bad.push("셸을 거쳐 실행한다");
    if (/exec\(|execSync\(/.test(src)) bad.push("exec 계열을 쓴다 — 문자열이 셸로 간다");
    // spawn 호출부에 템플릿 리터럴이 섞여 있으면 값이 조립되고 있다는 뜻이다.
    const spawnCall = src.match(/spawn\([^)]*\)/s)?.[0] ?? "";
    if (spawnCall.includes("`")) bad.push("spawn 인자에 템플릿 리터럴이 있다");

    const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
    if (/ensureRunning\([^)]*(query|params|url|req)/.test(server)) {
      bad.push("요청 데이터가 ensureRunning 으로 넘어간다");
    }
    // 요청 처리기가 기동을 유발하면 안 된다 — 기동은 서버 부팅 때 한 번만이다.
    const handlerSection = server.slice(server.indexOf("const server = createServer"), server.indexOf("server.listen"));
    if (handlerSection.includes("ensureRunning")) bad.push("요청 처리 경로에서 ensureRunning 을 부른다");
    if (bad.length) return bad.join(" / ");

    // 행위 검사 — 자동 기동을 끈 채 죽은 호스트를 가리키고 요청을 퍼붓는다.
    // 요청이 기동을 유발한다면 상태가 starting/ready 로 바뀌거나 startedByUs 가 켜진다.
    const port = 4311;
    const srv = await startServer(port, { OLLAMA_AUTOSTART: "0", OLLAMA_HOST: "127.0.0.1:11498" });
    try {
      for (let i = 0; i < 12; i++) {
        await fetch(`http://127.0.0.1:${port}/api/status`);
        await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent("느와르 포스터")}`);
      }
      const st = await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
      if (st.ollama?.startedByUs) return "요청이 프로세스를 띄웠다";
      if (["ready", "starting"].includes(st.ollama?.state)) {
        return `요청 후 상태가 ${st.ollama.state} — 죽은 호스트인데 기동이 일어났다`;
      }
      return null;
    } finally {
      srv.kill();
    }
  },

  // ready 로 확정된 뒤 Ollama 가 죽으면 상태가 따라가야 한다.
  // 안 그러면 /api/status 가 죽은 인스턴스를 영원히 "준비됨" 으로 보고한다.
  async "S3-G6"() {
    const source = `
      import { spawn } from "node:child_process";
      import { ensureRunning, refresh } from "${new URL("../src/ollama.js", import.meta.url).href}";
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // 우리가 아니라 '외부'가 띄운 것처럼 만든다 — startedByUs 가 false 인 경로까지 함께 본다.
      const ext = spawn("ollama", ["serve"], {
        env: { ...process.env, OLLAMA_HOST: process.env.OLLAMA_HOST },
        stdio: "ignore",
        windowsHide: true,
      });

      // 고정 대기는 타이밍에 걸린다. 실제로 응답할 때까지 폴링한다.
      const url = "http://" + process.env.OLLAMA_HOST + "/api/tags";
      const deadline = Date.now() + 20000;
      let up = false;
      while (Date.now() < deadline) {
        await sleep(400);
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
          if (r.ok) { up = true; break; }
        } catch {}
      }
      if (!up) {
        console.log(JSON.stringify({ before: "외부 인스턴스가 뜨지 않았다", startedByUs: false, after: "-" }));
        ext.kill();
        process.exit(0);
      }

      const before = await ensureRunning();
      ext.kill();
      await sleep(6500); // 상태 캐시 TTL(5초)을 넘긴다
      const after = await refresh();
      console.log(JSON.stringify({ before: before.state, startedByUs: before.startedByUs, after: after.state, detail: after.detail }));
      process.exit(0);
    `;
    const r = await runInChild(source, { OLLAMA_HOST: DEAD_HOST });
    if (r.before !== "ready") return `사전 조건 실패 — 기동되지 않았다: ${r.before}`;
    if (r.startedByUs !== false) return "외부가 띄웠는데 startedByUs 가 true";
    if (r.after === "ready") return "Ollama 가 죽었는데 여전히 ready 로 보고한다";
    return null;
  },
  // 의도 분기 — 진단 질의를 팔레트 검색으로 보내지 않는다. 이 게이트가 3단계의 존재 이유다.
  // 재작성만 붙였을 때 진단 질의가 그럴듯한 팔레트를 자신 있게 받았던 것이 설계를 바꾼 계기다.
  async "S3-G7"() {
    const port = 4312;
    const server = await startServer(port);
    try {
      // (1) 1단계에서 진단 코퍼스가 직접 잡는 경우 — LLM 없이도 팔레트로 새지 않아야 한다.
      for (const q of ["대시보드가 탁해 보여요", "화면이 유치해 보여요", "색이 너무 요란해요"]) {
        const r = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(q)}&rewrite=0`)).json();
        if (r.route === "palette") return `"${q}" 가 팔레트로 라우팅됐다`;
        if (r.results?.length) return `"${q}" 에 팔레트 결과가 섞여 나왔다`;
      }

      // (2) 1단계가 못 잡아 LLM 까지 가는 경우 — 그래도 팔레트로 새면 안 된다.
      // 진단 코퍼스를 늘릴 때마다 여기 쓰던 질의가 1단계에서 잡히기 시작한다(실제로 "답답해" 가 그랬다).
      // 그래서 두 코퍼스 어디에도 표면형이 없는 질의를 쓴다. 이것마저 1단계에서 잡히면
      // 아래 사전 조건이 FAIL 로 알려 주므로 게이트가 조용히 무력해지지 않는다.
      const FALLTHROUGH = "우리 앱이 경쟁사보다 저렴해 보인다는 말을 들었어요";
      const fell = await (
        await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(FALLTHROUGH)}`)
      ).json();
      // 사전 조건: LLM 이 실제로 돌았어야 이 검사가 성립한다. 이걸 안 보면 Ollama 가 죽어
      // route 가 "none" 으로 떨어져도 게이트가 조용히 통과한다.
      if (!fell.rewrite) {
        return fell.stage === 1 && fell.confident
          ? `LLM 경로를 검사하지 못했다 — "${FALLTHROUGH}" 가 이제 1단계에서 잡힌다. 다른 질의로 바꿔라`
          : `LLM 경로를 검사하지 못했다 — 재작성이 돌지 않았다 (${fell.rewriteError ?? "이유 불명"})`;
      }
      if (fell.stage !== 2) return `재작성이 돌았는데 stage 가 ${fell.stage}`;
      if (fell.route === "palette") {
        return `LLM 경로에서 진단 질의가 팔레트로 갔다 (의도 ${fell.rewrite.intent})`;
      }

      // 양성 대조 — 팔레트 질의는 팔레트로 가야 한다. 아니면 "전부 차단"으로도 통과한다.
      const pal = await (
        await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent("느와르 포스터 만들건데 고급스러운 빨강")}&rewrite=0`)
      ).json();
      if (pal.route !== "palette") return `양성 대조 실패 — 팔레트 질의가 ${pal.route}`;
      return null;
    } finally {
      server.kill();
    }
  },

  // 전문 검색이 잡으면 LLM 을 아예 부르지 않는다. 문서의 "60% 는 2단계에서 끝난다" 가
  // 실제로 성립하는지를 보는 게이트다.
  async "S3-G8"() {
    const port = 4313;
    const server = await startServer(port);
    try {
      const quick = ["병원 앱인데 차갑지 않게", "느와르 포스터 만들건데 고급스러운 빨강", "대시보드가 탁해 보여요"];
      for (const q of quick) {
        const started = Date.now();
        const r = await (await fetch(`http://127.0.0.1:${port}/api/search?q=${encodeURIComponent(q)}`)).json();
        const wall = Date.now() - started;
        if (r.stage !== 1) return `"${q}" 가 ${r.stage}단계까지 갔다`;
        if (r.rewrite !== null) return `"${q}" 에서 LLM 을 불렀다`;
        // LLM 을 부르면 최소 수백 ms 다. 왕복이 1초를 넘으면 어딘가에서 부르고 있다는 뜻이다.
        if (wall > 1000) return `"${q}" 왕복이 ${wall}ms — LLM 을 거친 것으로 보인다`;
      }
      return null;
    } finally {
      server.kill();
    }
  },

  // 재작성어의 붙여쓰기를 코퍼스 어휘로 되돌린다. 모델에 의존하지 않는 결정적 검사다 —
  // 프롬프트에 "붙여 쓰지 마라"를 적어 두는 것만으로는 보장되지 않기 때문에 코드로 되돌린다.
  async "S3-G9"() {
    const { splitGlued, expandTerms } = await import("../src/vocabulary.js");
    const { createPipeline } = await import("../src/pipeline.js");
    const { createSearcher } = await import("../src/palettes.js");
    const vocab = createPipeline().vocabulary;

    const bad = [];
    if (JSON.stringify(splitGlued("톤비대칭", vocab)) !== JSON.stringify(["톤", "비대칭"])) {
      bad.push(`톤비대칭 -> ${JSON.stringify(splitGlued("톤비대칭", vocab))}`);
    }
    // 코퍼스에 그대로 있는 말은 건드리지 않는다.
    for (const keep of ["살구", "공기원근", "따뜻한뉴트럴"]) {
      if (splitGlued(keep, vocab).length !== 1) bad.push(`${keep} 을 쪼갰다`);
    }
    // 사전에 없는 말은 억지로 쪼개지 않는다.
    if (splitGlued("여름네일색조합", vocab).length !== 1) bad.push("사전에 없는 말을 쪼갰다");

    // 되돌리면 신뢰 판정이 회복되는가 — 이게 이 기능의 목적이다.
    const { search } = createSearcher();
    const glued = search("톤비대칭 명도차이", 1)[0];
    const fixed = search(expandTerms(["톤비대칭", "명도차이"], vocab), 1)[0];
    if (!(glued?.wholeMatches === 0)) bad.push("사전 조건 실패 — 붙여 쓴 질의가 이미 고신뢰다");
    if (!(fixed?.wholeMatches > 0)) bad.push("되돌렸는데도 어절 전체 매칭이 0 이다");
    return bad.length ? bad.join(" / ") : null;
  },
  // 워밍업이 실제로 돈다. 리뷰에서 "정의·import 만 있고 호출부가 없다"가 HIGH 로 나왔던 자리다 —
  // 함수가 존재한다는 것과 불린다는 것은 다르다. 서버 표준출력으로 확인한다.
  async "S3-G10"() {
    const port = 4314;
    const child = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const line = await new Promise((resolve) => {
        let buf = "";
        const timer = setTimeout(() => resolve(null), 90000);
        child.stdout.on("data", (c) => {
          buf += c.toString("utf8");
          if (buf.includes("모델 워밍업")) {
            clearTimeout(timer);
            resolve(buf.split(/\r?\n/).find((l) => l.includes("모델 워밍업")));
          }
        });
      });
      if (!line) return "90초 안에 워밍업 로그가 나오지 않았다 (호출부가 없을 수 있다)";
      if (line.includes("건너뜀")) return `워밍업이 건너뛰어졌다 — ${line.trim()}`;
      return null;
    } finally {
      child.kill();
    }
  },
};

const id = process.argv[2];
if (!gates[id]) {
  out(`알 수 없는 게이트: ${id}. 가능한 값 — ${Object.keys(gates).join(", ")}`);
  process.exit(2);
}

try {
  const failure = await gates[id]();
  if (failure) {
    out(`${id}_FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    out(`${id.replace(/-/g, "_")}_OK`);
  }
} catch (err) {
  out(`${id}_FAIL ${err.message}`);
  process.exitCode = 1;
}
