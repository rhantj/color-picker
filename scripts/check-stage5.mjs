#!/usr/bin/env node
// 5단계(면적 비율 조정) 완료 조건 검사기.
//   node scripts/check-stage5.mjs S5-G1

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const getJson = async (base, path) => (await fetch(base + path)).json();

const gates = {
  // 조정한 비율이 저장된다. 기본값과 다른 값이어야 검사가 성립한다.
  async "S5-G1"() {
    const dir = freshDataDir();
    const port = 4510;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const { ratioFor } = await import("../public/ratio.js");
      const { loadPalettes } = await import("../src/palettes.js");
      const source = loadPalettes().find((p) => p.id === "pair-15");
      const def = ratioFor(source)[0]; // 30
      const chosen = def === 60 ? 40 : 60; // 기본값과 반드시 다른 값

      await post(base, "/api/saved", { paletteId: "pair-15", ratio: chosen });
      const entry = (await getJson(base, "/api/saved")).saved[0];
      if (!entry) return "저장되지 않았다";
      if (entry.colors[0].ratio !== chosen) return `조정한 비율이 안 들어갔다: ${entry.colors[0].ratio}`;
      if (entry.colors[1].ratio !== 100 - chosen) return "반대쪽 비율이 안 맞는다";
      if (entry.ratioAdjusted !== true) return "ratioAdjusted 가 true 가 아니다";
      if (JSON.stringify(entry.defaultRatio) !== JSON.stringify(ratioFor(source))) {
        return "기본값이 함께 저장되지 않았다 (되돌릴 수 없다)";
      }
      // 색은 여전히 코퍼스 값이어야 한다 — 비율만 사용자 것이다.
      if (entry.colors.map((c) => c.hex).join() !== source.colors.map((c) => c.hex).join()) {
        return "비율을 받으면서 색까지 클라이언트 값이 됐다";
      }

      // 양성 대조 — 비율을 안 보내면 규칙의 기본값이 들어간다.
      await post(base, "/api/saved", { paletteId: "pair-09" });
      const plain = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-09");
      const expected = ratioFor(loadPalettes().find((p) => p.id === "pair-09"));
      if (plain.colors[0].ratio !== expected[0]) return "기본값 경로가 깨졌다";
      if (plain.ratioAdjusted !== false) return "손대지 않았는데 ratioAdjusted 가 true 다";
      return null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 저장된 조합의 비율을 나중에 바꿀 수 있고, 재시작을 넘어 남는다.
  async "S5-G2"() {
    const dir = freshDataDir();
    const base = "http://127.0.0.1:4511";
    try {
      let server = await startServer(4511, { TONEFIRST_DATA_DIR: dir });
      await post(base, "/api/saved", { paletteId: "pair-10" });
      const before = (await getJson(base, "/api/saved")).saved[0];

      const res = await post(base, "/api/saved/ratio", { id: before.id, ratio: 45 });
      if (res.status !== 200) return `비율 변경이 ${res.status}`;

      server.kill();
      await new Promise((r) => setTimeout(r, 600));
      server = await startServer(4511, { TONEFIRST_DATA_DIR: dir });
      try {
        const after = (await getJson(base, "/api/saved")).saved[0];
        if (after.colors[0].ratio !== 45 || after.colors[1].ratio !== 55) {
          return `재시작 후 비율이 ${after.colors.map((c) => c.ratio).join(":")}`;
        }
        if (after.id !== before.id) return "다른 항목이 됐다";
        if (after.colors.map((c) => c.hex).join() !== before.colors.map((c) => c.hex).join()) {
          return "비율만 바꿔야 하는데 색이 바뀌었다";
        }
        if (after.ratioAdjusted !== true) return "조정 표시가 안 붙었다";

        // 기본값으로 되돌릴 수 있다.
        await post(base, "/api/saved/ratio", { id: before.id, ratio: after.defaultRatio[0] });
        const reset = (await getJson(base, "/api/saved")).saved[0];
        if (reset.ratioAdjusted !== false) return "기본값으로 되돌렸는데 조정 표시가 남았다";
        return null;
      } finally {
        server.kill();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 잘못된 비율은 거부된다. 0·100 은 한 색을 없애는 것이라 2색 조합이 아니게 된다.
  async "S5-G3"() {
    const dir = freshDataDir();
    const port = 4512;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const bad = [];
      await post(base, "/api/saved", { paletteId: "pair-10" });
      const id = (await getJson(base, "/api/saved")).saved[0].id;

      for (const value of [0, 100, 5, 95, -10, 200, 33.5, "50", null, [50], { v: 50 }, NaN]) {
        const save = await post(base, "/api/saved", { paletteId: "pair-15", ratio: value });
        if (save.status !== 400) bad.push(`저장 ratio=${JSON.stringify(value)} 가 ${save.status}`);
        const patch = await post(base, "/api/saved/ratio", { id, ratio: value });
        if (patch.status !== 400) bad.push(`변경 ratio=${JSON.stringify(value)} 가 ${patch.status}`);
      }

      // 양성 대조 — 경계값은 통과해야 한다. 아니면 "전부 거부" 로도 통과한다.
      for (const good of [10, 50, 90]) {
        const res = await post(base, "/api/saved/ratio", { id, ratio: good });
        if (res.status !== 200) bad.push(`정상 ratio=${good} 이 ${res.status}`);
      }

      // 거부된 요청은 아무것도 바꾸지 않았어야 한다.
      const final = (await getJson(base, "/api/saved")).saved.find((x) => x.id === id);
      if (final.colors[0].ratio !== 90) bad.push(`마지막 정상 값이 반영되지 않았다: ${final.colors[0].ratio}`);
      if ((await getJson(base, "/api/saved")).saved.some((x) => x.paletteId === "pair-15")) {
        bad.push("거부돼야 할 저장이 실제로 저장됐다");
      }
      return bad.length ? bad.join(" / ") : null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 화면의 슬라이더 범위와 서버의 허용 범위가 어긋나면, 사용자가 움직일 수 있는 값이 거부된다.
  async "S5-G4"() {
    const { RATIO_MIN, RATIO_MAX } = await import("../src/store.js");
    const ui = readFileSync(new URL("../public/ui.js", import.meta.url), "utf8");
    const bad = [];

    const uiMin = Number(ui.match(/export const RATIO_MIN = (\d+)/)?.[1]);
    const uiMax = Number(ui.match(/export const RATIO_MAX = (\d+)/)?.[1]);
    if (uiMin !== RATIO_MIN) bad.push(`화면 최소 ${uiMin} vs 서버 ${RATIO_MIN}`);
    if (uiMax !== RATIO_MAX) bad.push(`화면 최대 ${uiMax} vs 서버 ${RATIO_MAX}`);

    // 슬라이더가 그 상수를 실제로 쓰는지. 숫자를 따로 박아 두면 위 검사가 무의미해진다.
    if (!/slider\.min = String\(RATIO_MIN\)/.test(ui)) bad.push("슬라이더 min 이 RATIO_MIN 을 안 쓴다");
    if (!/slider\.max = String\(RATIO_MAX\)/.test(ui)) bad.push("슬라이더 max 가 RATIO_MAX 를 안 쓴다");

    // 두 화면이 실제로 컨트롤을 붙이는지.
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
    const saved = readFileSync(new URL("../public/saved.js", import.meta.url), "utf8");
    if (!/onRatio:/.test(app)) bad.push("홈 화면이 비율 조정을 붙이지 않는다");
    if (!/ratioControl\(/.test(saved)) bad.push("저장 화면이 비율 조정을 붙이지 않는다");
    if (!/api\("\/api\/saved\/ratio"/.test(saved)) bad.push("저장 화면이 변경을 서버에 보내지 않는다");
    return bad.length ? bad.join(" / ") : null;
  },
  // 조정해 둔 비율이 재저장으로 사라지지 않는다.
  // 리뷰에서 HIGH 로 나온 자리다 — 저장 화면에서 맞춰 둔 값을, 홈에서 같은 조합을 다시 저장하면
  // 기본값으로 덮어써서 아무 경고 없이 잃었다.
  async "S5-G5"() {
    const dir = freshDataDir();
    const port = 4513;
    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const { ratioFor } = await import("../public/ratio.js");
      const { loadPalettes } = await import("../src/palettes.js");
      const palette = loadPalettes().find((p) => p.id === "pair-15");
      const def = ratioFor(palette)[0];
      const custom = def === 60 ? 40 : 60;

      // 저장 → 저장 화면에서 조정
      await post(base, "/api/saved", { paletteId: "pair-15" });
      const id = (await getJson(base, "/api/saved")).saved[0].id;
      await post(base, "/api/saved/ratio", { id, ratio: custom });

      // 홈에서 같은 조합을 비율 없이 다시 저장
      await post(base, "/api/saved", { paletteId: "pair-15", fromQuery: "다시 저장" });
      const again = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-15");
      if (again.colors[0].ratio !== custom) {
        return `재저장이 조정한 비율을 버렸다: ${again.colors[0].ratio} (기대 ${custom})`;
      }
      if (again.ratioAdjusted !== true) return "재저장 후 조정 표시가 사라졌다";
      if (again.fromQuery !== "다시 저장") return "재저장의 다른 필드는 갱신돼야 한다";

      // 명시적으로 다른 비율을 보내면 그 값이 이긴다.
      await post(base, "/api/saved", { paletteId: "pair-15", ratio: 25 });
      const explicit = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-15");
      if (explicit.colors[0].ratio !== 25) return `명시한 비율이 안 먹었다: ${explicit.colors[0].ratio}`;

      // 기본값으로 되돌린 뒤 재저장하면 기본값이 유지된다(조정 상태가 아니므로 이어받을 것이 없다).
      await post(base, "/api/saved/ratio", { id: explicit.id, ratio: def });
      await post(base, "/api/saved", { paletteId: "pair-15" });
      const back = (await getJson(base, "/api/saved")).saved.find((x) => x.paletteId === "pair-15");
      if (back.colors[0].ratio !== def) return `기본값으로 되돌린 뒤가 ${back.colors[0].ratio}`;
      if (back.ratioAdjusted !== false) return "기본값인데 조정 표시가 붙었다";
      return null;
    } finally {
      server.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  },

  // 스테이지5 이전에 저장된 항목(defaultRatio 없음)도 기본값으로 되돌릴 수 있다.
  async "S5-G6"() {
    const dir = freshDataDir();
    const port = 4514;
    const { ratioFor } = await import("../public/ratio.js");
    const { loadPalettes } = await import("../src/palettes.js");
    const palette = loadPalettes().find((p) => p.id === "pair-10");
    const def = ratioFor(palette)[0];

    // defaultRatio·ratioAdjusted 가 없던 옛 스키마를 손으로 심는다.
    const legacy = [{
      id: "save-legacy-abc123",
      savedAt: new Date().toISOString(),
      paletteId: "pair-10",
      name: palette.name,
      type: palette.type,
      hueRelation: palette.hueRelation,
      toneRelation: palette.toneRelation,
      summary: palette.summary,
      colors: palette.colors.map((c) => ({ name: c.name, hex: c.hex, ratio: 50 })),
      note: "",
      fromQuery: null,
    }];
    writeFileSync(join(dir, "saved.json"), JSON.stringify(legacy, null, 2), "utf8");

    const server = await startServer(port, { TONEFIRST_DATA_DIR: dir });
    const base = `http://127.0.0.1:${port}`;
    try {
      const res = await post(base, "/api/saved/ratio", { id: "save-legacy-abc123", ratio: def });
      if (res.status !== 200) return `옛 항목 변경이 ${res.status}`;
      const entry = (await getJson(base, "/api/saved")).saved[0];
      if (!Array.isArray(entry.defaultRatio)) return "defaultRatio 를 채워 넣지 않았다";
      if (entry.ratioAdjusted !== false) return "기본값으로 되돌렸는데 조정 표시가 남았다";
      return null;
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
