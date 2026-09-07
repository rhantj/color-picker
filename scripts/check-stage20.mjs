#!/usr/bin/env node
// 20단계(엔진 수치를 엔진별로 나눠 내보낸다) · A2-b 완료 조건 검사기.
//   node scripts/check-stage20.mjs S20-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 전부 실패하는 것을 확인한 뒤에
// src/export.js · server.js · public 을 고쳤다.
//
// **이 단계가 막으려는 것은 하나다 — 엔진을 헷갈리는 것.**
//   언리얼 Roughness  0 = 거울
//   유니티  Smoothness 1 = 거울
// 정반대다. 한 파일에 둘을 같이 넣거나 이름을 안 밝히면, 거울로 만들려던 것이 무광이 된다.
// 그래서 **엔진마다 파일을 나누고 · 파일이 자기 엔진을 밝히고 · 필드 이름이 안 겹치게** 한다.
// (`docs/com/open-work.md` 의 C4 가 이 게이트로 닫힌다.)

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/**
 * **material.js 의 값을 여기 다시 적는다.** 감시할 대상에서 가져오면 그것을 바꾸는 순간
 * 게이트가 함께 느슨해진다. 이 저장소가 같은 부류로 다섯 번 뚫렸다
 * (`fallbackSelection()` · `METAL_MIN` · `EV_MAX` · `MIN_SHARE` · `DEFAULT_FINISH_BY_ROLE`).
 */
const EV_MAX_COPY = 4;
const FINISH_IDS = Object.freeze(["matte", "gloss", "metal", "emissive"]);
const ROUGHNESS_COPY = Object.freeze({ matte: 0.85, gloss: 0.2, metal: 0.25, emissive: 0.4 });
const ENGINES = Object.freeze(["unreal", "unity"]);

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

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

async function withServer(port, fn) {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-engine-"));
  const child = await startServer(port, { TONEFIRST_DATA_DIR: dir });
  const base = `http://127.0.0.1:${port}`;
  const api = {
    get: (path) => fetch(base + path),
    post: (path, body) =>
      fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    exportAs: async (format) => {
      const res = await fetch(`${base}/api/export?format=${encodeURIComponent(format)}`);
      return { status: res.status, text: await res.text() };
    },
    dir,
  };
  try {
    return await fn(api);
  } finally {
    /*
     * **자식이 실제로 끝날 때까지 기다린다.** `kill()` 만 하고 곧바로 `process.exit()` 로
     * 가면 윈도우에서 libuv 가 어서션으로 죽는다(실측: `UV_HANDLE_CLOSING`, async.c:94).
     * 게이트가 통과 문구를 찍은 **뒤에** 죽으므로, 안 기다리면 통과한 검사가 실패로 보인다.
     * "지적 없음" 과 "검사가 깨져 사라짐" 은 다른 것이다.
     */
    const ended = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await ended;
    rmSync(dir, { recursive: true, force: true });
  }
}

const SEED = "pair-06";
const STRUCT = "complementary"; // 바탕 · 본문 · 강조 (강조가 발광이라 emission 검사가 산다)
const WIDE = "value-scale"; //     바탕 · 면 · 본문 · 강조 (4색)
const firstPaletteId = () => JSON.parse(read("data/palettes.json")).palettes[0].id;

/** 파생 둘과 코퍼스 하나를 저장해 둔다. 코퍼스는 "빠졌다고 말하는가" 를 재기 위한 대조군이다. */
async function seedSaves(api, { corpus = true } = {}) {
  const d1 = await api.post("/api/saved/derived", { seedId: SEED, structureId: STRUCT, mode: "light" });
  const d2 = await api.post("/api/saved/derived", { seedId: SEED, structureId: WIDE, mode: "dark" });
  if (!d1.ok || !d2.ok) throw new Error(`파생 저장이 실패했다 (${d1.status}/${d2.status})`);
  if (corpus) {
    const c = await api.post("/api/saved", { paletteId: firstPaletteId() });
    if (!c.ok) throw new Error(`코퍼스 저장이 실패했다 (${c.status})`);
  }
}

const parseOr = (text, what) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} 가 JSON 이 아니다: ${text.slice(0, 160)}`);
  }
};

const allColors = (doc) => (doc.palettes ?? []).flatMap((p) => p.colors ?? []);

const GATES = {
  /*
   * **엔진 형식이 파생을 실제로 내보낸다.**
   *
   * 18단계까지 내보내기는 파생을 통째로 뺐다 — 형태가 달라 그대로 내면 조용히 망가졌다.
   * 이제 재질이 저장되므로(19단계) `applyFinish` 로 엔진 수치를 만들 수 있다.
   *
   * 색마다 역할·재질·baseColor·metallic·면적이 있어야 한다. 하나라도 빠지면 엔진에 붙였을 때
   * 그 자리가 기본값(보통 흰색 · 비금속)으로 조용히 대체된다.
   */
  "S20-G1": async () => {
    const bad = [];
    await withServer(4981, async (api) => {
      await seedSaves(api);
      for (const engine of ENGINES) {
        const r = await api.exportAs(engine);
        if (r.status !== 200) {
          bad.push(`${engine}: 상태 ${r.status}`);
          continue;
        }
        const doc = parseOr(r.text, engine);
        if ((doc.palettes ?? []).length !== 2) bad.push(`${engine}: 파생이 2개여야 하는데 ${doc.palettes?.length}`);
        const counts = (doc.palettes ?? []).map((p) => (p.colors ?? []).length).sort();
        if (String(counts) !== "3,4") bad.push(`${engine}: 색 수가 3·4 여야 하는데 ${counts}`);
        for (const c of allColors(doc)) {
          for (const field of ["role", "finish", "baseColor", "metallic"]) {
            if (c[field] === undefined || c[field] === null) bad.push(`${engine}: ${c.role} 에 ${field} 가 없다`);
          }
          if (!FINISH_IDS.includes(c.finish)) bad.push(`${engine}: 모르는 재질 ${c.finish}`);
          if (!/^#[0-9a-f]{6}$/.test(String(c.baseColor))) bad.push(`${engine}: baseColor 가 헥스가 아니다 (${c.baseColor})`);
          if (c.metallic !== 0 && c.metallic !== 1) bad.push(`${engine}: metallic 이 0 도 1 도 아니다 (${c.metallic})`);
          if (typeof c.ratio !== "number") bad.push(`${engine}: 면적이 안 실렸다 — 이 사이트의 핵심이 빠진다`);
        }
      }
    });
    out(bad.length ? bad.slice(0, 10).join("\n") : "파생이 엔진 수치와 함께 나온다 (역할·재질·baseColor·metallic·면적)");
    return bad.length === 0;
  },

  /*
   * **두 엔진이 실제로 다른 수치를 낸다. 이 단계의 핵심이다.**
   *
   * 언리얼 `Roughness` 는 0이 거울, 유니티 `Smoothness` 는 1이 거울로 정반대다. 한쪽 값을
   * 다른 엔진에 그대로 넣으면 **거울로 만들려던 것이 무광이 된다.**
   *
   * 네 가지를 문다:
   *   1. 반전이 실제로 일어난다 — roughness + smoothness = 1 (여기서 독립으로 계산한다)
   *   2. 재질별 러프니스가 정해진 값이다 — 독립 사본과 대조
   *   3. 필드 이름이 안 겹친다 — 잘못 붙이면 엔진이 조용히 삼키지 않고 그 칸이 비어야 한다
   *   4. 0.5 아닌 값이 최소 하나 — 0.5 는 반전해도 같아서 1·3 을 공허하게 만든다
   */
  "S20-G2": async () => {
    const bad = [];
    await withServer(4982, async (api) => {
      await seedSaves(api, { corpus: false });
      const ur = parseOr((await api.exportAs("unreal")).text, "unreal");
      const un = parseOr((await api.exportAs("unity")).text, "unity");

      const a = allColors(ur);
      const b = allColors(un);
      if (a.length === 0 || a.length !== b.length) {
        bad.push(`색 수가 안 맞는다 — 언리얼 ${a.length} · 유니티 ${b.length}`);
      }

      let asymmetric = 0;
      for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
        if (typeof a[i].roughness !== "number") bad.push(`언리얼에 roughness 가 없다 (${a[i].role})`);
        if (typeof b[i].smoothness !== "number") bad.push(`유니티에 smoothness 가 없다 (${b[i].role})`);
        if (a[i].smoothness !== undefined) bad.push("언리얼 파일에 smoothness 가 섞였다 — 헷갈릴 자리다");
        if (b[i].roughness !== undefined) bad.push("유니티 파일에 roughness 가 섞였다 — 헷갈릴 자리다");

        const sum = Number(a[i].roughness) + Number(b[i].smoothness);
        if (Math.abs(sum - 1) > 1e-9) {
          bad.push(`반전이 안 됐다 — ${a[i].role}: ${a[i].roughness} + ${b[i].smoothness} = ${sum}`);
        }
        // 게이트 대상에서 값을 안 가져온다. 재질별 러프니스를 위에 다시 적어 두고 대조한다.
        const expected = ROUGHNESS_COPY[a[i].finish];
        if (expected !== undefined && Math.abs(Number(a[i].roughness) - expected) > 1e-9) {
          bad.push(`${a[i].finish} 의 러프니스가 ${expected} 가 아니라 ${a[i].roughness}`);
        }
        if (Math.abs(Number(a[i].roughness) - 0.5) > 1e-9) asymmetric += 1;
      }
      if (asymmetric === 0) bad.push("전부 0.5 다 — 반전 검사가 공허하다");
    });
    out(bad.length ? bad.slice(0, 10).join("\n") : "두 엔진이 반전된 수치를 내고 필드 이름이 안 겹친다 (0.5 아닌 값 포함)");
    return bad.length === 0;
  },

  /*
   * **파일이 자기 엔진을 밝히고, 뺀 것을 말한다.**
   *
   * 수치만 든 파일은 나중에 열었을 때 어느 엔진 것인지 알 수 없다. 이름을 안 밝히면
   * 파일을 나눈 의미가 절반 사라진다 — 나눠 놨어도 어느 쪽인지 모르면 똑같이 헷갈린다.
   *
   * 코퍼스는 이 형식에서 빠진다(재질 배정이 없고, 역할 `대등` 은 `EV_BY_ROLE` 에 없다).
   * **조용히 빼지 않는다** — css/json 이 파생을 뺄 때 세운 규칙과 같다(S18-G13).
   */
  "S20-G3": async () => {
    const bad = [];
    await withServer(4983, async (api) => {
      await seedSaves(api); // 코퍼스 1 + 파생 2
      for (const engine of ENGINES) {
        const doc = parseOr((await api.exportAs(engine)).text, engine);
        if (doc.engine !== engine) bad.push(`${engine}: engine 필드가 "${doc.engine}"`);
        if (doc.skippedCorpus !== 1) bad.push(`${engine}: 뺀 코퍼스가 1이어야 하는데 ${doc.skippedCorpus}`);
        const blob = JSON.stringify(doc);
        const other = engine === "unreal" ? "smoothness" : "roughness";
        if (blob.includes(`"${other}"`)) bad.push(`${engine}: 반대 엔진 필드 ${other} 가 파일에 있다`);
        if (!String(doc.note ?? "").length) bad.push(`${engine}: note 가 비었다 — 반전 함정을 안 알린다`);
      }
    });
    // 파생이 하나도 없을 때도 뺐다는 사실이 남아야 한다.
    const empty = await withServer(4984, async (b) => {
      const c = await b.post("/api/saved", { paletteId: firstPaletteId() });
      if (!c.ok) throw new Error(`코퍼스 저장이 실패했다 (${c.status})`);
      return parseOr((await b.exportAs("unreal")).text, "빈 파생");
    });
    if (empty.skippedCorpus !== 1) bad.push(`파생이 없을 때도 뺀 수를 말해야 한다 (${empty.skippedCorpus})`);
    if ((empty.palettes ?? []).length !== 0) bad.push("파생이 없는데 palettes 가 비지 않았다");
    out(bad.length ? bad.slice(0, 8).join("\n") : "파일이 자기 엔진을 밝히고 뺀 코퍼스 수를 말한다 (반대 엔진 필드 0건)");
    return bad.length === 0;
  },

  /*
   * **발광은 발광 자리에만 있고, 세기가 상한 안이다.**
   *
   * 발광이 아닌 자리에 emission 이 새면 엔진에서 그 면이 빛난다 — 화면에서 본 것과 다른
   * 장면이 된다. 반대로 발광 자리에 없으면 강조가 그냥 어두운 색이 된다. 발광체의 몸체는
   * 일부러 어둡게 만들기 때문에(`EMISSIVE_BASE_MAX`) **빛이 빠지면 화면보다 어두워진다.**
   *
   * EV 상한은 위에 다시 적어 뒀다 — `EV_MAX` 를 가져오면 그것을 올리는 순간 검사도 같이 오른다.
   */
  "S20-G4": async () => {
    const bad = [];
    let emissiveSeen = 0;
    await withServer(4985, async (api) => {
      await seedSaves(api, { corpus: false });
      const specs = {
        unreal: { color: "emissiveColor", ev: "emissiveIntensity" },
        unity: { color: "emissionColor", ev: "emissionIntensity" },
      };
      for (const engine of ENGINES) {
        const { color, ev } = specs[engine];
        for (const c of allColors(parseOr((await api.exportAs(engine)).text, engine))) {
          const lit = c.finish === "emissive";
          if (lit) {
            emissiveSeen += 1;
            if (!/^#[0-9a-f]{6}$/.test(String(c[color]))) bad.push(`${engine}: 발광인데 ${color} 가 ${c[color]}`);
            if (typeof c[ev] !== "number" || c[ev] < 0 || c[ev] > EV_MAX_COPY) {
              bad.push(`${engine}: ${ev} 가 0~${EV_MAX_COPY} 밖이다 (${c[ev]})`);
            }
          } else if (c[color] !== null || c[ev] !== null) {
            bad.push(`${engine}: ${c.finish} 인데 빛이 샜다 (${color}=${c[color]}, ${ev}=${c[ev]})`);
          }
        }
      }
    });
    if (emissiveSeen === 0) bad.push("발광 자리가 하나도 없다 — 이 검사가 공허하다");
    out(bad.length ? bad.slice(0, 8).join("\n") : `발광 자리에만 빛이 있고 세기가 0~${EV_MAX_COPY} 안이다 (발광 ${emissiveSeen}자리)`);
    return bad.length === 0;
  },

  /*
   * **항목 하나가 내보내기 전체를 못 죽인다.**
   *
   * 엔진 수치는 `applyFinish` 가 만드는데 그 함수는 **모르는 재질·역할에 던진다**(16단계 계약).
   * 손상된 저장 파일이나 옛 형식 항목이 하나 있으면 내보내기가 통째로 500 이 되고 사용자는
   * 멀쩡한 것까지 못 가져간다. 18-B 에서 `/saved` 화면이 똑같은 이유로 목록 전체를 비웠다 —
   * 리뷰가 High 로 잡았고, 같은 부류가 여기서 되풀이될 자리다.
   */
  "S20-G5": async () => {
    const bad = [];
    await withServer(4986, async (api) => {
      await seedSaves(api, { corpus: false });
      const file = join(api.dir, "saved.json");
      const doc = JSON.parse(readFileSync(file, "utf8"));
      const list = Array.isArray(doc) ? doc : doc.saved;
      if (!Array.isArray(list)) throw new Error("저장 파일 형태가 바뀌었다 — 이 게이트를 고쳐야 한다");
      const donor = list.find((e) => e.kind === "derived");
      if (!donor) throw new Error("파생 항목을 못 찾았다 — 저장 파일 형태가 바뀌었나");

      list.push({ ...donor, id: "save-broken-1", finishes: { ...donor.finishes, [donor.colors[0].role]: "velvet" } });
      list.push({ ...donor, id: "save-broken-2", finishes: {} });
      list.push({ ...donor, id: "save-broken-3", colors: [{ role: "없는역할", hex: "#123456", ratio: 100 }] });
      writeFileSync(file, JSON.stringify(Array.isArray(doc) ? list : { ...doc, saved: list }, null, 2), "utf8");

      for (const engine of ENGINES) {
        const r = await api.exportAs(engine);
        if (r.status !== 200) {
          bad.push(`${engine}: 손상 항목 3개에 상태 ${r.status} — 멀쩡한 것까지 못 가져간다`);
          continue;
        }
        const parsed = parseOr(r.text, engine);
        const good = (parsed.palettes ?? []).filter((p) => (p.colors ?? []).every((c) => FINISH_IDS.includes(c.finish)));
        if (good.length < 2) bad.push(`${engine}: 멀쩡한 파생 2개가 남아야 하는데 ${good.length}`);
        if (!Number.isInteger(parsed.skippedBroken) || parsed.skippedBroken < 1) {
          bad.push(`${engine}: 못 낸 항목 수를 안 말한다 (skippedBroken=${parsed.skippedBroken})`);
        }
      }
    });
    out(bad.length ? bad.slice(0, 8).join("\n") : "손상 항목 3개가 있어도 멀쩡한 것이 나오고, 못 낸 수를 말한다");
    return bad.length === 0;
  },

  /*
   * **화면 토글.** 어느 엔진을 보여줄지 정하는 부분을 순수 함수로 빼고 여기서 직접 부른다 —
   * 정적 검사는 "무엇이 화면에 나가는가" 를 못 본다. 17단계 `structureColors` ·
   * 18단계 `savedFields` 와 같은 이유다.
   *
   * 정적 부분은 두 가지만 본다 — 화면이 그 함수를 쓰는가, 토글이 실제로 다시 부르는가.
   * 만들어 놓고 안 쓰는 변형을 19단계에서 겪었다(S19-G5).
   */
  "S20-G6": async () => {
    const bad = [];
    const { engineToggle } = await import("../public/ui.js");
    if (typeof engineToggle !== "function") {
      out("public/ui.js 가 engineToggle 을 안 내보낸다");
      return false;
    }

    const u = engineToggle("unreal");
    const y = engineToggle("unity");
    if (!u.visible || !y.visible) bad.push("엔진 형식인데 토글이 안 보인다");
    if (u.next !== "unity") bad.push(`언리얼의 다음이 유니티가 아니다 (${u.next})`);
    if (y.next !== "unreal") bad.push(`유니티의 다음이 언리얼이 아니다 (${y.next})`);
    if (!String(u.label).includes("유니티")) bad.push(`언리얼일 때 라벨이 갈 곳을 안 말한다 (${u.label})`);
    if (!String(y.label).includes("언리얼")) bad.push(`유니티일 때 라벨이 갈 곳을 안 말한다 (${y.label})`);
    for (const f of ["css", "json", "__proto__", "constructor", "", null, undefined, 7, ["unreal"]]) {
      if (engineToggle(f).visible) bad.push(`${String(f)} 인데 토글이 보인다`);
    }

    const js = stripComments(read("public/saved.js"));
    if (!js.includes("engineToggle")) bad.push("saved.js 가 engineToggle 을 안 쓴다");
    /*
     * **표기가 아니라 불변식을 문다.** "saved.js 안에 유니티라는 문자열이 있는가" 를 세면
     * 화면이 엔진 id 를 손으로 적도록 강요하게 된다 — 토글이 `engineToggle().next` 를 따르는
     * 지금 설계에서는 그 문자열이 없는 것이 맞다. S15-G13 에서 같은 실수를 했다.
     *
     * 대신 두 가지를 본다. **엔진 형식으로 열리는가**, 그리고 **토글이 next 를 따라가는가.**
     * 두 번째가 "눌러도 안 바뀐다"(토글이 늘 같은 엔진을 다시 여는 변형)를 잡는다.
     */
    const at = js.indexOf("export-engine");
    if (at < 0) bad.push("saved.js 에 토글 버튼 처리가 없다");
    const opens = [...js.matchAll(/showExport\(([^)]*)\)/g)].map((m) => m[1].trim());
    if (!opens.some((arg) => ENGINES.some((e) => arg.includes(e)))) {
      bad.push(`화면이 엔진 형식을 아예 안 연다 (showExport 인자: ${opens.join(" · ")})`);
    }
    if (!opens.some((arg) => arg.includes("next"))) {
      bad.push("토글이 engineToggle 의 next 를 안 따라간다 — 눌러도 늘 같은 엔진이 열린다");
    }
    const html = read("public/saved.html");
    if (!html.includes('id="export-engine"')) bad.push("saved.html 에 토글 버튼이 없다");
    if (!html.includes('id="export-engine-open"')) bad.push("saved.html 에 엔진 내보내기 버튼이 없다 — 열 길이 없다");
    out(bad.length ? bad.slice(0, 8).join("\n") : "토글이 두 엔진을 오가고 css·json·이상한 값에서는 숨는다 (화면이 실제로 쓴다)");
    return bad.length === 0;
  },

  /*
   * **형식이 늘어도 프로토타입 조회로 안 샌다.**
   *
   * `/api/export?format=__proto__` 한 번으로 서버가 죽은 적이 있다(실측). 그때 `Object.hasOwn`
   * 방어를 넣었는데, **형식 목록이 늘어난 지금 그 방어가 그대로인지**를 다시 잰다.
   * 회귀 게이트다 — 새 기능이 옛 방어를 밟고 지나가지 않았는지 본다.
   */
  "S20-G7": async () => {
    const bad = [];
    await withServer(4987, async (api) => {
      await seedSaves(api, { corpus: false });
      for (const evil of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "unreal2", "UNREAL"]) {
        const r = await api.exportAs(evil);
        if (r.status !== 400) bad.push(`format=${evil} 이 400 이 아니라 ${r.status}`);
      }
      for (const ok of ["css", "json", "unreal", "unity"]) {
        if ((await api.exportAs(ok)).status !== 200) bad.push(`${ok} 이 200 이 아니다 — 멀쩡한 형식이 막혔다`);
      }
    });
    out(bad.length ? bad.slice(0, 8).join("\n") : "이상한 형식 7가지가 400, 정상 형식 4가지가 200, 서버는 살아 있다");
    return bad.length === 0;
  },
};

const id = process.argv[2];
if (!id || !Object.hasOwn(GATES, id)) {
  out(`쓰는 법: node scripts/check-stage20.mjs <${Object.keys(GATES).join("|")}>`);
  process.exit(1);
}
const ok = await GATES[id]();
if (ok) out(id.replace(/-/g, "_") + "_OK");
/*
 * **`process.exit()` 를 안 쓴다.** 이 게이트는 요청을 여러 번 보내는데, 그 연결이 아직
 * 정리되는 중에 강제 종료하면 윈도우에서 libuv 가 어서션으로 죽는다
 * (`UV_HANDLE_CLOSING`, async.c:94 — 실측, 세 번 중 두 번). 통과 문구를 찍은 **뒤에**
 * 죽으므로 통과한 검사가 종료 코드 127 로 실패해 보인다.
 * 종료 코드만 정해 두고 노드가 스스로 끝나게 둔다.
 */
process.exitCode = ok ? 0 : 1;
