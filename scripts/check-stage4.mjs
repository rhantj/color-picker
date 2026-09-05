#!/usr/bin/env node
// 4단계 완료 조건 검사기. 서버를 띄워 실제로 쓰고 읽는다.
//   node scripts/check-stage4.mjs S4-G2

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 사용자 데이터(var/)를 건드리지 않는다. 검사는 매번 새 임시 디렉터리에 쓴다.
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

// 화면이 보내는 것과 같은 헤더로 쓴다. 다른 헤더는 S4-G7 이 따로 시험한다.
const post = (base, path, body) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });

const getJson = async (base, path) => (await fetch(base + path)).json();

const gates = {
  // 두 화면이 실제로 뜬다.
  async "S4-G1"() {
    const dir = freshDataDir();
    const port = 4410;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      for (const [path, needle] of [["/history", "history.js"], ["/saved", "saved.js"], ["/", "app.js"]]) {
        const res = await fetch(base + path);
        if (res.status !== 200) return `${path} 가 ${res.status}`;
        if (!res.headers.get("content-type")?.startsWith("text/html")) return `${path} 의 content-type 이 다르다`;
        const html = await res.text();
        if (!html.includes(needle)) return `${path} 에 ${needle} 이 없다`;
      }
      for (const asset of ["/ui.js", "/history.js", "/saved.js"]) {
        if ((await fetch(base + asset)).status !== 200) return `${asset} 가 200 이 아니다`;
      }
      return null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 대화가 서버 재시작을 넘어 남는다.
  async "S4-G2"() {
    const dir = freshDataDir();
    const base = "http://127.0.0.1:4411";
    try {
      let server = await startServer(4411, { TONEFIRST_DATA_DIR: dir });

      const first = await (
        await post(base, "/api/conversations/turn", {
          query: "병원 앱인데 차갑지 않게", stage: 1, route: "palette", confident: true,
          topKind: "palette", topId: "pair-10", topLabel: "살구 × 파랑",
        })
      ).json();
      if (!first.conversationId) return "conversationId 를 돌려주지 않았다";

      await post(base, "/api/conversations/turn", {
        conversationId: first.conversationId,
        query: "대시보드가 탁해 보여요", stage: 1, route: "diagnosis", confident: true,
        topKind: "diagnosis", topId: "dx-muddy", topLabel: "탁하다 / 칙칙하다",
      });

      server.kill();
      await new Promise((r) => setTimeout(r, 600));
      server = await startServer(4411, { TONEFIRST_DATA_DIR: dir });
      try {
        const { conversations } = await getJson(base, "/api/conversations");
        if (conversations.length !== 1) return `재시작 후 대화가 ${conversations.length}개`;
        const turns = conversations[0].turns;
        if (turns.length !== 2) return `턴이 ${turns.length}개`;
        if (turns[1].topId !== "dx-muddy") return "두 번째 턴 내용이 다르다";
        if (turns[0].route !== "palette" || turns[1].route !== "diagnosis") return "route 가 보존되지 않았다";
        return null;
      } finally {
        server.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 저장한 조합이 면적 비율까지 그대로 복원된다.
  async "S4-G3"() {
    const dir = freshDataDir();
    const port = 4412;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const { ratioFor } = await import("../public/ratio.js");
      const { loadPalettes } = await import("../src/palettes.js");
      const source = loadPalettes().find((p) => p.id === "pair-15"); // 빨강 × 흑록, D형
      const expected = ratioFor(source);

      await post(base, "/api/saved", { paletteId: "pair-15", note: "타이틀에만", fromQuery: "느와르 포스터" });
      const { saved } = await getJson(base, "/api/saved");
      if (saved.length !== 1) return `저장이 ${saved.length}건`;

      const entry = saved[0];
      const ratio = entry.colors.map((c) => c.ratio);
      if (JSON.stringify(ratio) !== JSON.stringify(expected)) {
        return `비율이 복원되지 않았다: ${JSON.stringify(ratio)} (기대 ${JSON.stringify(expected)})`;
      }
      if (entry.colors.map((c) => c.hex).join() !== source.colors.map((c) => c.hex).join()) return "헥스가 다르다";
      if (entry.note !== "타이틀에만") return "메모가 저장되지 않았다";

      // 같은 조합을 다시 저장해도 중복이 쌓이지 않는다.
      await post(base, "/api/saved", { paletteId: "pair-15" });
      if ((await getJson(base, "/api/saved")).saved.length !== 1) return "같은 조합이 중복 저장됐다";

      const latest = (await getJson(base, "/api/saved")).saved[0];
      const del = await post(base, "/api/saved/delete", { id: latest.id });
      if (del.status !== 200) return `삭제가 ${del.status}`;
      if ((await getJson(base, "/api/saved")).saved.length !== 0) return "삭제 후에도 남아 있다";
      return null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 서버가 클라이언트의 색을 믿지 않는다. store.js 규칙 4의 유일한 증거다.
  async "S4-G4"() {
    const dir = freshDataDir();
    const port = 4413;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      await post(base, "/api/saved", {
        paletteId: "pair-10",
        // 아래는 전부 무시돼야 한다.
        name: "조작된 이름",
        type: "Z",
        colors: [{ name: "가짜", hex: "#000000", ratio: 99 }],
        summary: "조작",
        savedAt: "1999-01-01T00:00:00.000Z",
        id: "save-forged-forged",
      });
      const { saved } = await getJson(base, "/api/saved");
      const entry = saved[0];
      if (!entry) return "저장이 되지 않았다";

      const bad = [];
      if (entry.name === "조작된 이름") bad.push("이름이 클라이언트 값으로 저장됐다");
      if (entry.type === "Z") bad.push("유형이 클라이언트 값으로 저장됐다");
      if (entry.colors.some((c) => c.hex === "#000000")) bad.push("헥스가 클라이언트 값으로 저장됐다");
      if (entry.colors.some((c) => c.ratio === 99)) bad.push("비율이 클라이언트 값으로 저장됐다");
      if (entry.id === "save-forged-forged") bad.push("id 가 클라이언트 값으로 저장됐다");
      if (String(entry.savedAt).startsWith("1999")) bad.push("저장 시각이 클라이언트 값으로 저장됐다");
      // 양성 대조 — 코퍼스 값이 실제로 들어갔는지. 없으면 "전부 버림" 으로도 통과한다.
      if (entry.name !== "살구 × 파랑") bad.push(`코퍼스 값이 안 들어갔다: ${entry.name}`);
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 쓰기 입력 검증.
  async "S4-G5"() {
    const dir = freshDataDir();
    const port = 4414;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      const expect = async (path, body, status, label) => {
        const res = await post(base, path, body);
        if (res.status !== status) bad.push(`${label}: ${res.status} (기대 ${status})`);
        const text = await res.text();
        if (/[A-Za-z]:\\|\/Users\/|node:internal/.test(text)) bad.push(`${label}: 내부 경로가 샜다`);
      };

      await expect("/api/saved", { paletteId: "pair-없음" }, 400, "모르는 조합");
      await expect("/api/saved", {}, 400, "paletteId 없음");
      await expect("/api/conversations/turn", { query: "   " }, 400, "빈 질의");
      await expect("/api/saved/delete", { id: "아무거나" }, 400, "잘못된 삭제 id");
      await expect("/api/saved/delete", { id: "save-aaaa-bbbb" }, 400, "없는 항목 삭제");

      // 8KB 넘는 본문은 거절한다(연결이 끊겨 fetch 가 실패해도 통과로 친다).
      let huge = null;
      try {
        huge = await post(base, "/api/conversations/turn", { query: "가".repeat(20000) });
      } catch {
        huge = null;
      }
      if (huge && huge.status === 200) bad.push("8KB 넘는 본문이 통과했다");

      // 질의는 상한까지만 저장된다.
      await post(base, "/api/conversations/turn", { query: "나".repeat(900), stage: 1, route: "palette" });
      const { conversations, limits } = await getJson(base, "/api/conversations");
      const stored = conversations[0]?.turns.at(-1)?.query ?? "";
      if ([...stored].length > limits.queryChars) bad.push(`질의가 ${[...stored].length}자로 저장됐다`);

      // 열거값이 강제된다.
      await post(base, "/api/conversations/turn", {
        conversationId: conversations[0].id, query: "확인", stage: 99, route: "해킹", confident: "yes",
      });
      const after = (await getJson(base, "/api/conversations")).conversations[0].turns.at(-1);
      if (after.stage !== 1) bad.push(`stage 가 ${after.stage} 로 저장됐다`);
      if (after.route !== "none") bad.push(`route 가 ${after.route} 로 저장됐다`);
      if (after.confident !== false) bad.push("confident 가 문자열로 저장됐다");

      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 상한·손상 복구·프로토타입 오염·별칭 유일성. S4-G5 가 안 덮던 자리들이다.
  async "S4-G6"() {
    const dir = freshDataDir();
    const port = 4415;
    const bad = [];
    let server = null;
    try {
      // (1) 저장 파일이 깨져 있어도 조용히 덮어쓰지 않는다.
      writeFileSync(join(dir, "conversations.json"), "{ 깨진 JSON", "utf8");
      server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
      const base = `http://127.0.0.1:${port}`;
      await post(base, "/api/conversations/turn", { query: "손상 후 첫 기록", stage: 1, route: "palette" });
      if (!readdirSync(dir).some((f) => f.includes(".corrupt-"))) {
        bad.push("깨진 파일을 옆으로 치우지 않았다 (조용히 덮어썼다)");
      }

      // (2) 턴 상한. 넘치면 오래된 것부터 잘린다.
      const { conversations: seed, limits } = await getJson(base, "/api/conversations");
      const convId = seed[0].id;
      for (let i = 0; i < limits.turnsPerConversation + 5; i++) {
        await post(base, "/api/conversations/turn", { conversationId: convId, query: `턴 ${i}`, stage: 1, route: "palette" });
      }
      const after = (await getJson(base, "/api/conversations")).conversations.find((c) => c.id === convId);
      if (after.turns.length !== limits.turnsPerConversation) {
        bad.push(`턴 상한이 안 지켜졌다: ${after.turns.length} (상한 ${limits.turnsPerConversation})`);
      }

      // (3) 메모 상한.
      await post(base, "/api/saved", { paletteId: "pair-10", note: "메".repeat(1000) });
      const noteEntry = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-10");
      if ([...noteEntry.note].length > limits.noteChars) {
        bad.push(`메모가 ${[...noteEntry.note].length}자로 저장됐다`);
      }

      // (4) 코드포인트 단위로 잘라서 이모지가 반으로 쪼개지지 않는다.
      const emojiNote = "가".repeat(limits.noteChars - 1) + "\u{1F3A8}";
      await post(base, "/api/saved", { paletteId: "pair-09", note: emojiNote });
      const emoji = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-09");
      const last = [...emoji.note].at(-1);
      if (last !== "\u{1F3A8}") bad.push(`이모지가 온전히 저장되지 않았다: ${JSON.stringify(last)}`);

      // (5) 프로토타입 오염이 통하지 않는다.
      await post(base, "/api/saved", JSON.parse('{"paletteId":"pair-15","__proto__":{"polluted":true}}'));
      const clean = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-15");
      if (clean?.polluted !== undefined) bad.push("저장 항목에 오염된 키가 붙었다");
      if ({}.polluted !== undefined) bad.push("검사 프로세스의 Object.prototype 이 오염됐다");

      // (6) 진단 별칭은 항목 사이에서 유일해야 한다. 겹치면 어느 쪽이 나올지 예측할 수 없다.
      const { loadDiagnostics } = await import("../src/diagnostics.js");
      const seen = new Map();
      for (const dx of loadDiagnostics()) {
        for (const alias of dx.aliases) {
          if (seen.has(alias)) bad.push(`별칭 중복 "${alias}": ${seen.get(alias)} 와 ${dx.id}`);
          seen.set(alias, dx.id);
        }
      }
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server?.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 쓰기 요청이 이 화면에서 온 것인지 본다. 사용자가 이 서버를 띄운 채 아무 웹페이지나 열면
  // 그 페이지가 simple request 로 POST 를 날릴 수 있으므로, 막히는지 실제로 확인한다.
  async "S4-G7"() {
    const dir = freshDataDir();
    const port = 4416;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      const raw = (headers, body) =>
        fetch(`${base}/api/conversations/turn`, { method: "POST", headers, body: JSON.stringify(body) });

      // text/plain 은 프리플라이트 없이 나가는 simple request 다. 막혀야 한다.
      const plain = await raw({ "content-type": "text/plain" }, { query: "교차 출처 시도", stage: 1, route: "palette" });
      if (plain.status !== 403) bad.push(`text/plain POST 가 ${plain.status}`);

      // 교차 출처임을 브라우저가 알려 주는 헤더도 막아야 한다.
      const cross = await raw(
        { "content-type": "application/json", "sec-fetch-site": "cross-site" },
        { query: "교차 출처 시도2", stage: 1, route: "palette" },
      );
      if (cross.status !== 403) bad.push(`sec-fetch-site: cross-site 가 ${cross.status}`);

      // 양성 대조 — 우리 화면과 같은 조합은 통과해야 한다. 아니면 "전부 차단" 으로도 통과한다.
      const ok = await raw(
        { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        { query: "정상 요청", stage: 1, route: "palette" },
      );
      if (ok.status !== 200) bad.push(`same-origin 요청이 ${ok.status}`);

      // 막힌 요청은 아무것도 남기지 않아야 한다.
      const { conversations } = await getJson(base, "/api/conversations");
      const queries = conversations.flatMap((c) => c.turns.map((t) => t.query));
      if (queries.some((q) => q.startsWith("교차 출처"))) bad.push("막힌 요청이 기록에 남았다");
      if (!queries.includes("정상 요청")) bad.push("정상 요청이 기록되지 않았다");

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
