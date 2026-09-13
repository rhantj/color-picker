#!/usr/bin/env node
// 2단계 완료 조건 검사기. 서버를 실제로 띄워 HTTP 로 두드린다.
//   node scripts/check-stage2.mjs S2-G2

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
const PORT = Number(process.env.CHECK_PORT ?? 4199);
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, TONEFIRST_DATA_DIR: gateDataDir(), PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`서버가 5초 안에 뜨지 않았다. stderr: ${stderr.trim() || "(없음)"}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes(String(PORT))) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`서버가 코드 ${code} 로 종료했다. stderr: ${stderr.trim() || "(없음)"}`));
    });
  });
}

const gates = {
  async "S2-G1"() {
    const res = await fetch(`${BASE}/`);
    if (res.status !== 200) return `/ 가 ${res.status}`;
    if (!res.headers.get("content-type")?.startsWith("text/html")) {
      return `/ 의 content-type 이 ${res.headers.get("content-type")}`;
    }
    const html = await res.text();
    for (const needle of ["search-form", "ladder", 'id="results-featured"', "/app.css", "/app.js"]) {
      if (!html.includes(needle)) return `홈 화면에 ${needle} 없음`;
    }
    for (const asset of ["/app.css", "/app.js"]) {
      const r = await fetch(BASE + asset);
      if (r.status !== 200) return `${asset} 가 ${r.status}`;
    }
    return null;
  },

  async "S2-G2"() {
    const hit = await (await fetch(`${BASE}/api/search?q=${encodeURIComponent("병원 앱인데 차갑지 않게")}`)).json();
    if (hit.results?.[0]?.id !== "pair-10") return `1위가 ${hit.results?.[0]?.id}`;
    if (hit.confident !== true) return "정상 질의인데 confident 가 true 가 아님";
    if (typeof hit.elapsedMs !== "number" || hit.stage !== 1) return "elapsedMs/stage 누락";
    const first = hit.results[0];
    for (const field of ["name", "type", "hueRelation", "toneRelation", "summary", "impression", "score"]) {
      if (first[field] === undefined) return `결과에 ${field} 없음`;
    }
    if (!first.matched?.some((m) => m.whole === true)) return "matched 에 whole 플래그가 없음";
    if (hit.route !== "palette") return `route 가 palette 가 아님: ${hit.route}`;

    // 음성 대조 — 어느 코퍼스에도 어절 전체로 걸리지 않는 질의는 confident 가 false 여야 한다.
    // rewrite=0 으로 LLM 을 빼고 전문 검색만 본다(이 게이트는 1단계 판정을 검사한다).
    for (const weakQuery of ["그래서 어떻게 되나요", "zzz qqq"]) {
      const weak = await (
        await fetch(`${BASE}/api/search?q=${encodeURIComponent(weakQuery)}&rewrite=0`)
      ).json();
      if (weak.confident !== false) return `"${weakQuery}" 가 confident=true 로 나옴`;
      if (weak.route !== "none") return `"${weakQuery}" 의 route 가 ${weak.route}`;
    }

    // 진단 질의는 팔레트가 아니라 진단으로 가야 한다 — 3단계의 핵심 분기를 여기서도 확인한다.
    const dx = await (
      await fetch(`${BASE}/api/search?q=${encodeURIComponent("대시보드가 탁해 보여요")}&rewrite=0`)
    ).json();
    if (dx.route !== "diagnosis") return `진단 질의의 route 가 ${dx.route}`;
    if (dx.results?.length) return "진단 질의인데 팔레트를 함께 내놨다";
    return null;
  },

  async "S2-G3"() {
    // API 는 코퍼스가 아는 것만 내려보낸다. 면적 비율은 화면이 계산한다.
    const hit = await (await fetch(`${BASE}/api/search?q=${encodeURIComponent("오래된 목조 부엌")}&limit=1`)).json();
    const colors = hit.results?.[0]?.colors ?? [];
    if (colors.length !== 2) return "결과에 색이 2개가 아님";
    // 색 객체 안뿐 아니라 결과 최상위로 되돌아오는 경우도 잡는다.
    const first = hit.results?.[0] ?? {};
    const leaked = [
      ...Object.keys(first).filter((k) => /ratio|area|비율/i.test(k)),
      ...colors.flatMap((c) => Object.keys(c).filter((k) => /ratio|area/i.test(k))),
    ];
    if (leaked.length) return `API 가 면적 비율을 들고 나온다 (화면이 계산해야 한다): ${leaked.join(", ")}`;
    if (!colors.every((c) => c.hex && c.name)) return "결과 색에 hex/name 이 없음";

    // 초안에서 확정한 색 토큰이 스타일시트에 그대로 있는가
    const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
    for (const token of ["--bg: #fbf7f2", "--ink: #241f1a", "--accent: #006eb8", "--ink-faint: #6e6459"]) {
      if (!css.includes(token)) return `색 토큰 누락: ${token}`;
    }
    return null;
  },

  // 스와치 위 헥스 라벨은 배경색마다 다르게 계산된다. 코퍼스의 모든 색에 대해
  // 4.5:1 을 실제로 넘기는지 확인한다 — 디자인 초안에서 고정 색을 썼다가 4쌍이 걸렸던 자리다.
  async "S2-G5"() {
    const { labelColor, contrast } = await import("../public/color.js");
    const { loadPalettes } = await import("../src/palettes.js");
    const bad = [];
    for (const p of loadPalettes()) {
      for (const c of p.colors) {
        const ratio = contrast(labelColor(c.hex), c.hex);
        if (ratio < 4.5) bad.push(`${p.id} ${c.hex} → ${ratio.toFixed(2)}:1`);
      }
    }
    // 양성 대조 — 계산이 통째로 죽어 있으면 위 루프가 아무것도 못 잡는다.
    if (contrast("#ffffff", "#ffffff") !== 1) bad.push("양성 대조 실패 — contrast 계산이 이상하다");
    // 가장 까다로운 중간 명도 회색까지 통과하는지 본다.
    for (const hard of ["#808080", "#777777", "#8a8a8a"]) {
      const ratio = contrast(labelColor(hard), hard);
      if (ratio < 4.5) bad.push(`중간 회색 ${hard} → ${ratio.toFixed(2)}:1`);
    }
    return bad.length ? bad.join(" / ") : null;
  },

  // 스와치(S2-G5)는 검사했는데 UI 크롬 자체의 텍스트 대비는 게이트가 없어서
  // 제출 버튼의 disabled 상태가 1.63:1 로 조용히 깨져 있었다. 토큰 조합을 직접 잰다.
  async "S2-G6"() {
    const { contrast } = await import("../public/color.js");
    const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
    const token = Object.fromEntries(
      [...css.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
    );

    const pairs = [
      ["ink", "bg"], ["ink-muted", "bg"], ["ink-faint", "bg"],
      ["ink-muted", "surface"], ["ink-faint", "surface"],
      ["ink-muted", "surface-sunken"], ["ink-faint", "surface-sunken"],
      ["accent-ink", "accent-soft"],
      ["ink-muted", "line-strong"], // 제출 버튼 disabled 상태
    ];

    const bad = [];
    for (const [fg, bg] of pairs) {
      if (!token[fg] || !token[bg]) return `토큰 누락: --${fg} 또는 --${bg}`;
      const ratio = contrast(token[fg], token[bg]);
      if (ratio < 4.5) bad.push(`--${fg} on --${bg} → ${ratio.toFixed(2)}:1`);
    }
    // 흰 글자를 얹는 두 자리
    for (const bg of ["accent", "ink"]) {
      const ratio = contrast("#ffffff", token[bg]);
      if (ratio < 4.5) bad.push(`#ffffff on --${bg} → ${ratio.toFixed(2)}:1`);
    }
    // disabled 규칙이 글자색을 실제로 지정하는지 — 안 하면 흰색이 상속돼 1.63:1 이 된다
    const disabledRule = css.match(/\.searchbar__submit\[disabled\]\s*\{[^}]*\}/)?.[0] ?? "";
    if (!/color:\s*var\(--ink-muted\)/.test(disabledRule)) {
      bad.push("disabled 규칙이 color 를 지정하지 않는다 (흰 글자가 상속된다)");
    }
    return bad.length ? bad.join(" / ") : null;
  },

  // 면적 규칙은 코퍼스가 아니라 public/ratio.js 한 곳에 있다. 그 규칙이 실제로 지켜지는지 잰다.
  async "S2-G7"() {
    const { ratioFor } = await import("../public/ratio.js");
    const { chroma } = await import("../public/color.js");
    const { loadPalettes } = await import("../src/palettes.js");
    const bad = [];
    for (const p of loadPalettes()) {
      const ratio = ratioFor(p);
      if (ratio[0] + ratio[1] !== 100) bad.push(`${p.id} 합이 100 이 아님: ${ratio}`);
      if (p.type === "D") {
        if (Math.max(...ratio) !== 70) bad.push(`${p.id} 서열 조합인데 70:30 이 아님: ${ratio}`);
        // 바탕(넓은 쪽)은 채도가 낮은 쪽이어야 한다
        const wide = ratio[0] > ratio[1] ? 0 : 1;
        if (chroma(p.colors[wide].hex) > chroma(p.colors[1 - wide].hex)) {
          bad.push(`${p.id} 바탕이 고채도 쪽에 갔다`);
        }
      } else if (ratio[0] !== 50) {
        bad.push(`${p.id} 대등 조합인데 50:50 이 아님: ${ratio}`);
      }
    }
    // 양성 대조 — 유형이 갈리지 않으면 위 루프는 아무것도 못 잡는다.
    const types = new Set(loadPalettes().map((p) => p.type));
    if (!types.has("D") || types.size < 2) bad.push("양성 대조 실패 — 코퍼스에 유형이 한 종류뿐");
    return bad.length ? bad.join(" / ") : null;
  },

  // 폰트가 외부에 의존하지 않는다. 로컬 우선 도구인데 폰트만 CDN 에 있으면
  // 오프라인에서 조용히 폴백으로 떨어진다 — 그 회귀를 막는다.
  async "S2-G8"() {
    const bad = [];
    for (const page of ["index.html", "history.html", "saved.html"]) {
      const html = readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
      if (/fonts\.(googleapis|gstatic)\.com/.test(html)) bad.push(`${page} 가 Google Fonts 를 부른다`);
      if (/<link[^>]+href="https?:\/\//.test(html)) bad.push(`${page} 에 외부 링크가 있다`);
    }

    const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
    if (/@import|url\(https?:/.test(css)) bad.push("app.css 가 외부 리소스를 가져온다");

    // 실제로 쓰는 이름이 이 기계에 있는 것인지. 이름 한 글자만 틀려도 조용히 폴백한다 —
    // 실측에서 "HYSinMyeongJo-Medium" 은 안 잡히고 "HYSinMyeongJo" 만 잡혔다.
    for (const expected of ['"HYSinMyeongJo"', '"Noto Sans KR"', '"Cascadia Mono"']) {
      if (!css.includes(expected)) bad.push(`폰트 토큰에 ${expected} 가 없다`);
    }
    if (/Gowun Batang|IBM Plex/.test(css)) bad.push("옛 웹폰트 이름이 남아 있다");
    return bad.length ? bad.join(" / ") : null;
  },

  async "S2-G4"() {
    const cases = [
      [`/api/search`, 400, "q 없음"],
      [`/api/search?q=%20`, 400, "공백 질의"],
      [`/api/search?q=%EC%83%89&limit=99`, 400, "limit 범위 초과"],
      [`/api/search?q=%EC%83%89&limit=abc`, 400, "limit 비정수"],
      // 인코딩된 이탈은 서버가 직접 막아야 한다(403). 인코딩 안 된 `/../` 는 WHATWG URL 이
      // 서버에 닿기 전에 정규화해 버리므로 가드를 검사하지 못한다 — 그래서 여기 넣지 않는다.
      [`/%2e%2e%2fserver.js`, 403, "인코딩된 경로 이탈"],
      [`/%2e%2e%2f%2e%2e%2fWindows%2fwin.ini`, 403, "상위 디렉터리 이탈"],
      [`/%2e%2e%2fdata%2fpalettes.json`, 403, "public 밖 파일"],
      [`/data/palettes.json`, 404, "public 밖 경로"],
      [`/없는페이지`, 404, "없는 경로"],
    ];
    const bad = [];
    for (const [path, expected, label] of cases) {
      const res = await fetch(BASE + path);
      if (res.status !== expected) bad.push(`${label}: ${res.status} (기대 ${expected})`);
      const body = await res.text();
      if (/[A-Za-z]:\\|\/Users\/|node:internal/.test(body)) bad.push(`${label}: 응답에 내부 경로가 새어나옴`);
    }
    // 양성 대조 — 정상 요청은 200 이어야 한다. 아니면 이 게이트는 "전부 막힘"으로도 통과한다.
    if ((await fetch(`${BASE}/app.css`)).status !== 200) bad.push("양성 대조 실패 — 정상 정적 파일도 막힘");
    return bad.length ? bad.join(" / ") : null;
  },
};

const id = process.argv[2];
if (!gates[id]) {
  out(`알 수 없는 게이트: ${id}. 가능한 값 — ${Object.keys(gates).join(", ")}`);
  process.exit(2);
}

let server;
try {
  server = await startServer();
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
} finally {
  server?.kill();
}
