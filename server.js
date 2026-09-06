// 의존성 0 HTTP 서버. Node 내장 http 만 쓴다.
//
// 검색 색인은 기동 시 한 번만 만든다. 1단계 리뷰에서 "요청마다 createSearcher() 를 부르면
// 트래픽이 늘 때 병목"이라는 지적이 나왔고, 코퍼스가 정적이라 재색인할 이유가 없다.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CorpusError } from "./src/palettes.js";
import { createPipeline } from "./src/pipeline.js";
import { ensureRunning, refresh as refreshOllama } from "./src/ollama.js";
import { warmUp } from "./src/rewrite.js";
import {
  LIMITS,
  deleteSaved,
  listConversations,
  listSaved,
  recordTurn,
  savePalette,
  updateSavedNote,
  updateSavedRatio,
} from "./src/store.js";
import { ratioFor } from "./public/ratio.js";
import { FORMATS } from "./src/export.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";

// 화면의 6단계 사다리는 "이 서버가 실제로 할 수 있는 단계"를 그린다.
// 재작성은 Ollama 가 준비돼 있을 때만 가능하므로 능력치는 고정값이 아니라 상태에서 계산한다 —
// 화면이 실제보다 앞서 보이지 않게 하려는 것이다. 개별 질의가 몇 단계에서 끝났는지는 따로 알린다.
const maxStage = (ollamaState) => (ollamaState === "ready" ? 2 : 1);

// 루프백 밖에 바인딩했다면 모델 목록·호스트·오류 원문을 내보내지 않는다.
// 로컬 도구를 네트워크에 열어 두면 이 응답이 "이 기계에 어떤 모델이 있는가" 를 알려주는 창구가 된다.
const LOOPBACK_ONLY = /^(127\.|::1$|localhost$)/.test(HOST);

// 확장자 없는 화면 경로. 목록에 없는 경로는 정적 파일로도 안 찾는다.
const PAGES = {
  "/": "index.html",
  "/history": "history.html",
  "/saved": "saved.html",
};

const MAX_BODY_BYTES = 8 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

let pipeline;
try {
  pipeline = createPipeline();
} catch (err) {
  const message = err instanceof CorpusError ? err.message : String(err);
  process.stderr.write(Buffer.from(`기동 실패: ${message}\n`, "utf8"));
  process.exit(1);
}

function send(res, status, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": buf.length,
    // 로컬 실험 도구지만 기본 방어는 켜 둔다.
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(buf);
}

const sendJson = (res, status, payload) =>
  send(res, status, JSON.stringify(payload), MIME[".json"]);

async function serveStatic(res, urlPath) {
  // 퍼센트 인코딩을 먼저 푼다. 안 풀면 한글·공백이 든 파일명을 못 찾는다.
  // 동시에 이 디코딩이 `%2e%2e%2f` 같은 이탈 시도를 되살리므로, 아래 가드가 실제로 일하는 지점이 된다.
  // (디코딩 전에는 WHATWG URL 이 `/../` 를 미리 정규화해 버려 가드가 죽은 코드였다.)
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return sendJson(res, 400, { error: "경로 인코딩이 잘못됐다" });
  }
  if (decoded.includes("\0")) return sendJson(res, 400, { error: "잘못된 경로" });

  const requested = PAGES[decoded] ? `/${PAGES[decoded]}` : decoded;
  // 경로 이탈 방어. resolve 후 public 디렉터리 아래인지 확인한다.
  const target = resolve(PUBLIC_DIR, "." + requested);
  if (!target.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: "허용되지 않은 경로" });
  }

  const type = MIME[extname(target).toLowerCase()];
  if (!type) return sendJson(res, 404, { error: "없는 리소스" });

  try {
    return send(res, 200, await readFile(target), type);
  } catch {
    return sendJson(res, 404, { error: "없는 리소스" });
  }
}

const shapeMatched = (matched) =>
  matched.slice(0, 6).map((m) => ({
    term: m.term,
    whole: m.whole,
    contribution: Number(m.contribution.toFixed(2)),
  }));

const shapePalette = ({ doc, score, matched, wholeMatches }) => ({
  id: doc.id,
  name: doc.name,
  type: doc.type,
  hueRelation: doc.hueRelation,
  toneRelation: doc.toneRelation,
  summary: doc.summary,
  impression: doc.impression,
  // 면적 비율은 코퍼스가 모르는 값이라 여기서 내려보내지 않는다. 화면이 public/ratio.js 로 계산한다.
  colors: doc.colors,
  score: Number(score.toFixed(3)),
  wholeMatches,
  matched: shapeMatched(matched),
});

const shapeDiagnostic = ({ doc, score, matched, wholeMatches }) => ({
  id: doc.id,
  symptom: doc.symptom,
  axis: doc.axis,
  prescription: doc.prescription,
  detail: doc.detail,
  score: Number(score.toFixed(3)),
  wholeMatches,
  matched: shapeMatched(matched),
});

async function handleSearch(res, params) {
  const query = (params.get("q") ?? "").trim();
  if (!query) return sendJson(res, 400, { error: "q 가 비어 있다" });

  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 5 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    return sendJson(res, 400, { error: "limit 는 1~10 의 정수" });
  }

  const allowRewrite = params.get("rewrite") !== "0";
  const r = await pipeline.resolve(query, limit, { allowRewrite });

  sendJson(res, 200, {
    query,
    // 이 질의가 실제로 몇 단계에서 끝났는지. 능력치가 아니라 결과다.
    stage: r.stage,
    route: r.route,
    // 어절 전체로 겹친 항이 없으면 어미 조각만 맞은 것이다. 화면이 이걸 숨기지 않고 그대로 알린다.
    confident: r.confident,
    elapsedMs: r.searchMs,
    rewrite: r.rewrite ? { intent: r.rewrite.intent, terms: r.rewrite.terms, model: r.rewrite.model, elapsedMs: r.rewrite.elapsedMs } : null,
    // /api/status 와 같은 경계를 적용한다. 재작성 실패 사유에는 OLLAMA_HOST 나 스폰 실패 상세가
    // 들어가므로, 루프백 밖에 바인딩했다면 원문을 내보내지 않는다.
    rewriteError: r.rewriteError ? (LOOPBACK_ONLY ? r.rewriteError : "질의 재작성을 쓸 수 없습니다") : null,
    results: r.paletteHits.map(shapePalette),
    diagnostics: r.diagnosticHits.map(shapeDiagnostic),
  });
}

/**
 * 쓰기 요청이 이 화면에서 온 것인지 본다.
 *
 * 이게 없으면, 사용자가 이 서버를 띄운 채 아무 웹페이지나 열었을 때 그 페이지가
 * `Content-Type: text/plain` 으로 POST 를 날려 대화 기록을 오염시키거나 저장 항목을 지울 수 있다.
 * text/plain 은 CORS 의 "simple request" 라 프리플라이트 없이 나가기 때문이다.
 *
 * 두 겹으로 막는다:
 *   1. application/json 을 요구한다 — 이건 simple request 가 아니라 프리플라이트를 유발하고,
 *      우리는 OPTIONS 에 허용을 주지 않으므로 교차 출처 요청이 여기 닿지 못한다.
 *   2. Sec-Fetch-Site 가 있으면 same-origin/none 만 받는다. 헤더가 없는 클라이언트(curl·검사 스크립트)는
 *      브라우저가 아니므로 CSRF 대상이 아니고, 그대로 통과시킨다.
 */
function isTrustedWrite(req) {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) return false;

  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

/** 요청 본문을 상한까지만 읽는다. 넘으면 연결을 끊는다 — 로컬 도구라도 무한히 받지 않는다. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("본문이 너무 크다"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
    // 본문을 끝내지 않고 연결만 조용히 끊는 경우 end 도 error 도 오지 않는다.
    // 그대로 두면 프로미스가 영원히 pending 으로 남아 요청 객체를 붙잡는다.
    req.on("close", () => reject(new Error("연결이 끊겼다")));
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("본문은 객체여야 한다");
  }
  return parsed;
}

const paletteById = (id) => pipeline.palettes.find((p) => p.id === id);

async function handleWrite(req, res, pathname) {
  if (!isTrustedWrite(req)) {
    return sendJson(res, 403, { error: "이 화면에서 보낸 요청이 아니다" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  try {
    if (pathname === "/api/conversations/turn") {
      return sendJson(res, 200, await recordTurn(body));
    }
    if (pathname === "/api/saved") {
      return sendJson(res, 200, await savePalette(body, paletteById, ratioFor));
    }
    if (pathname === "/api/saved/ratio") {
      // 옛 항목에 defaultRatio 가 없으면 코퍼스에서 채워 넣도록 조회 함수를 넘긴다.
      const defaultsFor = (entry) => {
        const palette = paletteById(entry.paletteId);
        return palette ? ratioFor(palette) : null;
      };
      return sendJson(res, 200, await updateSavedRatio(body.id, body.ratio, defaultsFor));
    }
    if (pathname === "/api/saved/note") {
      return sendJson(res, 200, await updateSavedNote(body.id, body.note));
    }
    if (pathname === "/api/saved/delete") {
      return sendJson(res, 200, await deleteSaved(body.id));
    }
  } catch (err) {
    // 저장 실패 사유는 사용자 입력에 대한 판정이라 그대로 알려도 내부 정보가 아니다.
    return sendJson(res, 400, { error: err.message });
  }
  return sendJson(res, 404, { error: "없는 리소스" });
}

// 내보내기는 읽기라 GET 이다. 형식 생성은 서버가 한다 — 형식이 한 곳에 있어야 게이트로 검사할 수 있고,
// 세 화면이 각자 문자열을 만들면 곧 서로 달라진다.
function handleExport(res, params) {
  const format = params.get("format") ?? "css";
  // 요청 문자열로 객체를 조회할 때는 **자기 속성인지** 먼저 본다.
  // FORMATS["__proto__"] 나 ["constructor"] 는 프로토타입 체인에서 값이 나와 `!spec` 검사를 통과한다.
  // 그러고는 spec.build 가 없어 던지고, 요청 하나로 서버가 죽었다(실측).
  if (!Object.hasOwn(FORMATS, format)) {
    return sendJson(res, 400, { error: `형식은 ${Object.keys(FORMATS).join(" 또는 ")} 이다` });
  }

  const spec = FORMATS[format];
  send(res, 200, spec.build(listSaved()), spec.type);
}

// id 를 주면 그 대화 하나만 준다. 홈 화면이 "이어서 묻기" 배너를 그리려고 부른다 —
// 전체 목록을 받아 클라이언트에서 찾게 하면, 이어 쓸 대화 하나를 위해 50개를 내려보내게 된다.
function handleConversations(res, params) {
  const conversations = listConversations();
  const wanted = params.get("id");
  if (wanted === null) return sendJson(res, 200, { conversations, limits: LIMITS });

  const found = conversations.find((c) => c.id === wanted);
  // 없는 대화를 조용히 빈 결과로 돌려주면, 화면이 "이어 쓰는 중" 이라고 표시한 채 새 대화를 연다.
  if (!found) return sendJson(res, 404, { error: "없는 대화다" });
  return sendJson(res, 200, { conversation: found, limits: LIMITS });
}

async function handleStatus(res) {
  // refresh 는 확인만 한다 — 요청이 프로세스 기동을 유발하지 않는다(S3-G5).
  const ollama = await refreshOllama();
  sendJson(res, 200, {
    stage: maxStage(ollama.state),
    corpus: pipeline.palettes.length,
    diagnostics: pipeline.diagnostics.length,
    ollama: LOOPBACK_ONLY
      ? ollama
      : { state: ollama.state, startedByUs: ollama.startedByUs },
  });
}

function dispatch(req, res, url) {
  if (req.method === "POST") return handleWrite(req, res, url.pathname);
  if (req.method !== "GET") return sendJson(res, 405, { error: "GET·POST 만 받는다" });

  if (url.pathname === "/api/search") return handleSearch(res, url.searchParams);
  if (url.pathname === "/api/status") return handleStatus(res);
  if (url.pathname === "/api/conversations") return handleConversations(res, url.searchParams);
  if (url.pathname === "/api/saved") return sendJson(res, 200, { saved: listSaved(), limits: LIMITS });
  if (url.pathname === "/api/export") return handleExport(res, url.searchParams);
  return serveStatic(res, url.pathname);
}

// 요청 처리 중 예외가 프로세스를 죽이지 않게 한다.
// Node 의 http 서버는 핸들러가 동기적으로 던지면 uncaughtException 으로 올려 보내고 프로세스가 끝난다.
// 실측: `/api/export?format=__proto__` 한 번으로 서버가 죽었다. 개별 결함은 따로 고쳤지만,
// 요청 하나가 서버 전체를 내리는 구조 자체를 남겨 두지 않는다.
function failSafely(res, err) {
  process.stderr.write(Buffer.from(`요청 처리 중 예외: ${err?.stack ?? err}\n`, "utf8"));
  if (res.headersSent) return res.destroy();
  // 사유는 로그에만 남긴다. 응답에 내부 정보를 싣지 않는다.
  sendJson(res, 500, { error: "요청을 처리하지 못했다" });
}

const server = createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
  } catch {
    return sendJson(res, 400, { error: "잘못된 요청 경로" });
  }

  try {
    const result = dispatch(req, res, url);
    // 비동기 핸들러의 거부도 같은 자리에서 받는다.
    if (result && typeof result.catch === "function") result.catch((err) => failSafely(res, err));
  } catch (err) {
    failSafely(res, err);
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    Buffer.from(
      `톤먼저 · http://${HOST}:${PORT} · 팔레트 ${pipeline.palettes.length}쌍 · 진단 ${pipeline.diagnostics.length}건\n`,
      "utf8",
    ),
  );

  // 기동을 기다리지 않는다. Ollama 가 없거나 느려도 전문 검색은 이미 서비스 가능한 상태다.
  if (process.env.OLLAMA_AUTOSTART !== "0") {
    ensureRunning().then((s) => {
      const mark = { ready: "준비됨", starting: "기동 중", unavailable: "쓸 수 없음" }[s.state] ?? s.state;
      process.stdout.write(
        Buffer.from(`Ollama ${mark} — ${s.detail}${s.startedByUs ? " (우리가 띄웠다)" : ""}\n`, "utf8"),
      );

      // 첫 재작성이 모델 적재를 기다리지 않게 미리 올려 둔다.
      // 실측: 워밍업 없으면 첫 저신뢰 질의 3944ms, 있으면 556ms.
      // 기다리지 않는다 — 워밍업이 끝나기 전에 들어온 질의는 그냥 조금 느릴 뿐이다.
      if (s.state === "ready" && process.env.OLLAMA_WARMUP !== "0") {
        warmUp().then((w) => {
          const line = w.skipped
            ? `모델 워밍업 건너뜀 — ${w.skipped}`
            : `모델 워밍업 완료 — ${w.model} ${w.elapsedMs}ms`;
          process.stdout.write(Buffer.from(line + "\n", "utf8"));
        });
      }
    });
  }
});
