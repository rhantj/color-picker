#!/usr/bin/env node
// 6단계(내보내기) 완료 조건 검사기.
//   node scripts/check-stage6.mjs S6-G1

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const freshDataDir = () => mkdtempSync(join(tmpdir(), "tonefirst-check-"));

function startServer(port, env = {}) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", OLLAMA_AUTOSTART: "0", ...env },
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

const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });

/** 조정된 조합 하나와 대등 조합 하나를 심어 둔 서버를 띄운다. */
async function seeded(port) {
  const dir = freshDataDir();
  const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
  const base = `http://127.0.0.1:${port}`;
  await post(base, "/api/saved", { paletteId: "pair-10", ratio: 75, note: "확정 버튼에만 파랑" });
  await post(base, "/api/saved", { paletteId: "pair-01" }); // A형, 50:50
  return { server, base, dir };
}

const gates = {
  // 내보낸 CSS 가 면적과 역할을 담는다. 헥스만 담으면 이 사이트의 논지를 버리는 것이다.
  async "S6-G1"() {
    const { server, base, dir } = await seeded(4610);
    try {
      const res = await fetch(`${base}/api/export?format=css`);
      if (res.status !== 200) return `CSS 내보내기가 ${res.status}`;
      if (!res.headers.get("content-type")?.startsWith("text/css")) {
        return `content-type 이 ${res.headers.get("content-type")}`;
      }
      const css = await res.text();
      const bad = [];

      // 서열 조합: 넓은 쪽이 ground, 좁은 쪽이 accent 로 나온다.
      if (!css.includes("--pair-10-ground: #FDD4BD;")) bad.push("바탕 색 변수가 없다");
      if (!css.includes("--pair-10-ground-area: 75%;")) bad.push("바탕 면적 변수가 없다(조정한 75%)");
      if (!css.includes("--pair-10-accent: #006EB8;")) bad.push("강조 색 변수가 없다");
      if (!css.includes("--pair-10-accent-area: 25%;")) bad.push("강조 면적 변수가 없다");

      // 대등 조합: 서열이 없으므로 ground/accent 로 부르지 않는다.
      if (!css.includes("--pair-01-tone-1: #719470;")) bad.push("대등 조합 변수가 없다");
      if (/--pair-01-(ground|accent)/.test(css)) bad.push("대등 조합에 서열 이름을 붙였다");

      if (!css.includes("확정 버튼에만 파랑")) bad.push("메모가 주석에 안 들어갔다");
      if (!css.includes("직접 조정함")) bad.push("직접 조정한 비율이라는 표시가 없다");
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 내보낸 JSON 이 파싱되고, 색마다 비율과 역할을 담는다.
  async "S6-G2"() {
    const { server, base, dir } = await seeded(4611);
    try {
      const res = await fetch(`${base}/api/export?format=json`);
      if (res.status !== 200) return `JSON 내보내기가 ${res.status}`;
      if (!res.headers.get("content-type")?.startsWith("application/json")) {
        return `content-type 이 ${res.headers.get("content-type")}`;
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        return `내보낸 JSON 이 파싱되지 않는다: ${err.message}`;
      }

      const bad = [];
      if (data.count !== 2) bad.push(`count 가 ${data.count}`);
      const hospital = data.palettes.find((p) => p.id === "pair-10");
      if (!hospital) return "저장한 조합이 빠졌다";
      if (hospital.colors[0].ratio !== 75 || hospital.colors[1].ratio !== 25) {
        bad.push(`비율이 ${hospital.colors.map((c) => c.ratio).join(":")}`);
      }
      if (hospital.colors[0].role !== "ground" || hospital.colors[1].role !== "accent") {
        bad.push(`역할이 ${hospital.colors.map((c) => c.role).join(",")}`);
      }
      if (hospital.ratioAdjusted !== true) bad.push("조정 표시가 없다");
      if (hospital.note !== "확정 버튼에만 파랑") bad.push("메모가 없다");

      const equal = data.palettes.find((p) => p.id === "pair-01");
      if (equal.colors.some((c) => c.role === "ground" || c.role === "accent")) {
        bad.push("대등 조합에 서열 역할이 붙었다");
      }
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 내보낸 CSS 가 실제로 유효한 CSS 인가. 브라우저 없이 CSSOM 으로 파싱할 수 없으므로
  // 구조를 직접 센다 — 중괄호 균형, 선언마다 세미콜론, 주석이 닫히는지.
  async "S6-G3"() {
    const { server, base, dir } = await seeded(4612);
    try {
      const css = await (await fetch(`${base}/api/export?format=css`)).text();
      const bad = [];

      const opens = (css.match(/\{/g) ?? []).length;
      const closes = (css.match(/\}/g) ?? []).length;
      if (opens !== closes) bad.push(`중괄호 불균형 ${opens}/${closes}`);
      if ((css.match(/\/\*/g) ?? []).length !== (css.match(/\*\//g) ?? []).length) bad.push("주석이 안 닫혔다");

      // 주석을 걷어낸 뒤 선언만 본다.
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const declarations = stripped
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("--"));
      if (declarations.length !== 8) bad.push(`선언이 ${declarations.length}개 (조합 2개 × 4개여야 한다)`);
      for (const line of declarations) {
        if (!line.endsWith(";")) bad.push(`세미콜론 없음: ${line}`);
        if (!/^--[a-zA-Z0-9-]+:\s*\S/.test(line)) bad.push(`변수 이름·값 형식이 깨졌다: ${line}`);
      }
      // 주석 밖에 한글이 남으면 식별자로 새어 나온 것이다.
      const outsideComments = declarations.join("\n").replace(/\/\*.*$/gm, "");
      if (/[가-힣]/.test(outsideComments.replace(/\/\*[\s\S]*?\*\//g, ""))) {
        bad.push("변수 이름·값에 한글이 섞였다");
      }
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 형식 검증과 빈 상태. 알 수 없는 형식은 거부하고, 저장이 없으면 빈 결과를 알린다.
  async "S6-G4"() {
    const dir = freshDataDir();
    const port = 4613;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      for (const format of ["xml", "", "css;drop", "../../etc/passwd"]) {
        const res = await fetch(`${base}/api/export?format=${encodeURIComponent(format)}`);
        if (res.status !== 400) bad.push(`format=${JSON.stringify(format)} 가 ${res.status}`);
        const body = await res.text();
        if (/[A-Za-z]:\\|node:internal/.test(body)) bad.push(`format=${format}: 내부 경로가 샜다`);
      }

      // 저장이 없을 때도 200 이고, 빈 결과라는 것이 내용에 드러난다.
      const emptyCss = await fetch(`${base}/api/export?format=css`);
      if (emptyCss.status !== 200) bad.push(`빈 상태 CSS 가 ${emptyCss.status}`);
      const cssText = await emptyCss.text();
      if (!cssText.includes("저장한 조합이 없습니다")) bad.push("빈 상태를 알리지 않는다");

      const emptyJson = JSON.parse(await (await fetch(`${base}/api/export?format=json`)).text());
      if (emptyJson.count !== 0 || emptyJson.palettes.length !== 0) bad.push("빈 상태 JSON 이 비어 있지 않다");

      // 양성 대조 — 기본 형식(css)은 인자 없이도 200 이어야 한다.
      if ((await fetch(`${base}/api/export`)).status !== 200) bad.push("형식 인자가 없을 때 200 이 아니다");
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 화면이 서버 형식을 그대로 쓴다. 화면이 문자열을 조립하기 시작하면 곧 서버와 갈라진다.
  async "S6-G5"() {
    const saved = readFileSync(new URL("../public/saved.js", import.meta.url), "utf8");
    const html = readFileSync(new URL("../public/saved.html", import.meta.url), "utf8");
    const bad = [];

    if (!/\/api\/export\?format=/.test(saved)) bad.push("화면이 내보내기 API 를 부르지 않는다");
    // 화면이 CSS 를 직접 조립하면 서버 형식과 갈라진다.
    if (/--\$\{|`--/.test(saved)) bad.push("화면이 CSS 변수를 직접 만든다");
    if (!/navigator\.clipboard/.test(saved)) bad.push("복사 기능이 없다");
    if (!/URL\.createObjectURL/.test(saved)) bad.push("파일 저장 기능이 없다");
    // 클립보드 실패를 조용히 넘기면 안 된다 — 복사된 줄 알고 붙여넣는다.
    if (!/catch\s*\{[\s\S]{0,400}noteBox\.textContent/.test(saved)) bad.push("클립보드 실패를 사용자에게 알리지 않는다");

    for (const id of ["export-css", "export-json", "export-copy", "export-download", "export-close", "export-code"]) {
      if (!html.includes(`id="${id}"`)) bad.push(`화면에 ${id} 가 없다`);
    }
    return bad.length ? bad.join(" / ") : null;
  },

  // 요청 하나가 서버 프로세스를 죽이지 않는다.
  // 리뷰에서 CRITICAL 로 나온 자리다 — FORMATS["__proto__"] 가 프로토타입 체인에서 값을 내주는 바람에
  // 형식 검증을 통과하고 spec.build 에서 던져, 인증 없는 GET 한 번으로 서버가 끝났다(실측).
  async "S6-G6"() {
    const dir = freshDataDir();
    const port = 4614;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      // 객체의 프로토타입 체인에서 나오는 이름들. 전부 거부돼야 하고, 무엇보다 서버가 살아 있어야 한다.
      for (const format of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "prototype"]) {
        let status = 0;
        try {
          status = (await fetch(`${base}/api/export?format=${encodeURIComponent(format)}`)).status;
        } catch (err) {
          bad.push(`format=${format} 에서 연결이 끊겼다 (서버가 죽었을 수 있다): ${err.message}`);
          break;
        }
        if (status !== 400) bad.push(`format=${format} 가 ${status}`);
      }

      // 사후 확인 — 위 요청들을 겪고도 서버가 정상이어야 한다.
      try {
        const alive = await fetch(`${base}/api/export?format=css`);
        if (alive.status !== 200) bad.push(`이후 정상 요청이 ${alive.status}`);
        if ((await fetch(`${base}/`)).status !== 200) bad.push("이후 홈 화면이 200 이 아니다");
      } catch (err) {
        bad.push(`이후 요청에서 연결이 끊겼다 — 서버가 죽었다: ${err.message}`);
      }
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 메모가 CSS 주석을 조기에 닫지 못한다.
  // 내보낸 CSS 의 용도가 "다른 프로젝트에 붙여넣기" 라, 깨진 CSS 가 다른 신뢰 경계로 옮겨 간다.
  async "S6-G7"() {
    const dir = freshDataDir();
    const port = 4615;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const CLOSE = "*" + "/";
      const tail = ` } body::before { content: "INJECTED"; } .x{ /*`;
      const ctrl = (n) => String.fromCharCode(n);
      const bidi = (n) => String.fromCodePoint(n);

      // 페이로드를 여럿 둔다. **리터럴 */ 하나만 넣으면 이 게이트는 헛돈다** — 손질 함수가
      // 리터럴은 정확히 잡으므로 통과하고, 정작 취약한 경로(삭제되는 문자가 사이에 끼어
      // 손질이 끝난 뒤 */ 가 재조립되는 것)는 건드리지도 못한다. 실제로 그렇게 놓쳤다.
      const payloads = [
        ["리터럴", `메모 ${CLOSE}${tail}`],
        ["제어문자 끼움", `메모 *${ctrl(1)}/${tail}`],
        ["제어문자 둘", `메모 *${ctrl(2)}${ctrl(3)}/${tail}`],
        ["별표 둘", `메모 **${ctrl(4)}/${tail}`],
        ["DEL", `메모 *${ctrl(127)}/${tail}`],
        // 양방향 제어문자도 **지우는** 연산이라 같은 재조립 경로를 만든다.
        // 이것이 없으면 그 삭제를 아래로 내려도 게이트가 통과한다 - 실제로 그랬다.
        ["양방향 RLO", `메모 *${bidi(0x202e)}/${tail}`],
        ["양방향 LRM", `메모 *${bidi(0x200e)}/${tail}`],
      ];

      const bad = [];
      for (const [label, evil] of payloads) {
        await post(base, "/api/saved", { paletteId: "pair-10", note: evil });
        const one = await (await fetch(`${base}/api/export?format=css`)).text();
        const left = one.replace(/\/\*[\s\S]*?\*\//g, "");
        if (/INJECTED|body::before/.test(left)) bad.push(`${label}: 메모가 주석 밖으로 새어 나왔다`);
        const o = (one.match(/\{/g) ?? []).length;
        const c = (one.match(/\}/g) ?? []).length;
        if (o !== c) bad.push(`${label}: 중괄호 불균형 ${o}/${c}`);
      }

      // 마지막 페이로드 상태로 아래 기존 검사를 이어서 돌린다.
      const css = await (await fetch(`${base}/api/export?format=css`)).text();

      // 주석을 전부 걷어낸 뒤 남는 것은 :root 와 우리 변수뿐이어야 한다.
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      if (/INJECTED|body::before/.test(stripped)) bad.push("메모가 주석 밖으로 새어 나왔다");
      const leftover = stripped
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l !== ":root {" && l !== "}" && !l.startsWith("--"));
      if (leftover.length) bad.push(`주석 밖에 예상 못 한 것이 남았다: ${leftover.join(" | ")}`);

      // 중괄호 균형이 유지된다 — 주석이 조기에 닫히면 여기서 깨진다.
      const opens = (css.match(/\{/g) ?? []).length;
      const closes = (css.match(/\}/g) ?? []).length;
      if (opens !== closes) bad.push(`중괄호 불균형 ${opens}/${closes}`);

      // 양성 대조 — 메모 자체는 (손질된 형태로) 남아 있어야 한다. 통째로 지워 버리는 것도 답이 아니다.
      if (!css.includes("메모")) bad.push("메모가 통째로 사라졌다");
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 양방향 텍스트 제어문자는 CSS 파싱을 깨지 않는다. 대신 **에디터가 보여주는 순서**를 뒤집어,
  // 주석처럼 보이는 자리에 실제로는 살아 있는 선언을 숨길 수 있다(Trojan Source 계열).
  // 이 출력의 용도가 다른 프로젝트 스타일시트에 붙여넣는 것이라 표시가 곧 신뢰 근거가 된다.
  async "S6-G8"() {
    const dir = freshDataDir();
    const port = 4616;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const cp = (h) => String.fromCodePoint(h);
      // 재정렬(202A~202E) · 격리(2066~2069) · 표식(200E 200F 061C) 세 부류를 모두 넣는다.
      const marks = [
        0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
        0x2066, 0x2067, 0x2068, 0x2069,
        0x200e, 0x200f, 0x061c,
      ];
      const note = "안전한메모" + marks.map(cp).join("x") + "끝";
      await post(base, "/api/saved", { paletteId: "pair-10", note });

      const css = await (await fetch(`${base}/api/export?format=css`)).text();
      const bad = [];

      const left = marks.filter((m) => css.includes(cp(m)));
      if (left.length) {
        bad.push(`양방향 제어문자가 남았다: ${left.map((m) => "U+" + m.toString(16).toUpperCase()).join(" ")}`);
      }

      // 양성 대조 — 메모를 통째로 지워 버리는 것도 답이 아니다. 보이는 글자는 남아야 한다.
      if (!css.includes("안전한메모")) bad.push("메모의 보이는 부분까지 사라졌다");

      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
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
