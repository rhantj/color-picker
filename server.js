// 의존성 0 HTTP 서버. Node 내장 http 만 쓴다.
//
// 검색 색인은 기동 시 한 번만 만든다. 1단계 리뷰에서 "요청마다 createSearcher() 를 부르면
// 트래픽이 늘 때 병목"이라는 지적이 나왔고, 코퍼스가 정적이라 재색인할 이유가 없다.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { CorpusError } from "./src/palettes.js";
import { palettesForAxis, relationVocabulary } from "./src/bridge.js";
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
  saveDerived,
  updateSavedNote,
  updateSavedRatio,
} from "./src/store.js";
import { ratioFor } from "./public/ratio.js";
import { expandAll, expandSeed, loadStructures } from "./src/expand.js";
import { PICK_COUNT, selectStructures } from "./src/structure.js";
import { selectFinishes } from "./src/finish.js";
import { DEFAULT_FINISH_BY_ROLE, MATERIAL_FINISHES, loadFinishes } from "./src/material.js";
import { loadSeeds, seedLabel } from "./src/seeds.js";
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

// 관계 어휘는 팔레트 코퍼스에서 한 번만 읽는다. 코퍼스는 기동 때 고정된다.
const relationVocab = relationVocabulary(pipeline.palettes);

const shapeDiagnostic = ({ doc, score, matched, wholeMatches }) => {
  const { hue, tone, matches } = palettesForAxis(doc.axis, pipeline.palettes, relationVocab);
  return {
    id: doc.id,
    symptom: doc.symptom,
    axis: doc.axis,
    prescription: doc.prescription,
    detail: doc.detail,
    // **연결이 없어도 필드를 낸다.** 빼 버리면 화면이 "연결이 없다" 와 "서버가 아직 모른다" 를
    // 구분하지 못해, 없는 것을 로딩 중으로 그리거나 그 반대를 하게 된다.
    bridge: { hue, tone, palettes: matches.map(shapeBridgePalette) },
    score: Number(score.toFixed(3)),
    wholeMatches,
    matched: shapeMatched(matched),
  };
};

// 이어 붙인 조합은 목록에 얹는 것이라 검색 점수가 없다. 스와치를 그릴 만큼만 낸다.
const shapeBridgePalette = (p) => ({
  id: p.id,
  name: p.name,
  type: p.type,
  hueRelation: p.hueRelation,
  toneRelation: p.toneRelation,
  summary: p.summary,
  colors: p.colors,
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

// 씨앗 풀은 기동 시 한 번만 읽는다. 코퍼스와 같은 이유다 - 요청마다 디스크를 다시 읽을 게 없다.
// 없으면 빈 배열이고, 그래도 코퍼스 16쌍은 그대로 확장된다(S12-G4).
const seedPool = loadSeeds();

// 구조 카탈로그도 기동 시 한 번만 읽는다. LLM 프롬프트가 이 이름·원리를 그대로 쓰므로,
// 요청마다 다시 읽으면 같은 질의가 파일 수정 순간에 다른 프롬프트를 받는다.
// **detail 을 떨어뜨리지 않는다.** 프롬프트가 그것을 쓴다 — principle 은 기법만 말하고 증상 낱말이
// 없어서, 여기서 빼면 "평면적이고 깊이가 없어요" 가 공기원근에 못 닿는다. 실제로 한 번 빠뜨렸고,
// 프롬프트의 detail 자리가 늘 빈 문자열이라 개선이 통째로 무효였다. S14-G9 가 이제 그것을 검사한다.
// **전체 카탈로그도 기동 시 한 번만 읽는다.** `expandAll` 의 기본 인자가 `loadStructures()` 라,
// 인자를 생략하면 요청마다 readFileSync + JSON.parse 가 돈다 — 어두운 모드를 붙이며 호출이 둘이
// 되면서 그 동기 I/O 가 요청당 2회로 늘었다(리뷰 지적). 아래 structureCatalog 는 LLM 프롬프트용이라
// `source` 를 떨어뜨려서 확장에 그대로 못 쓴다. 그래서 원본을 따로 들고 있는다.
const fullCatalog = loadStructures();

const structureCatalog = fullCatalog.map((x) => ({
  id: x.id,
  name: x.name,
  principle: x.principle,
  detail: x.detail,
}));

/**
 * 확장할 씨앗을 찾는다. **코퍼스와 씨앗 풀 양쪽을 본다** - 씨앗 풀이 생기면서 조회 자리가 둘이 됐고,
 * 한쪽만 보면 24쌍이 화면에서 통째로 사라진다.
 */
const seedById = (id) => {
  const wanted = String(id ?? "");
  const corpus = pipeline.palettes.find((p) => p.id === wanted);
  if (corpus) return { seed: corpus, label: corpus.name, from: "corpus" };
  const pooled = seedPool.find((s) => s.id === wanted);
  return pooled ? { seed: pooled, label: seedLabel(pooled), from: "pool" } : null;
};

/**
 * 씨앗·구조·모드로 **색을 다시 계산한다.** 저장 경로가 화면이 보낸 색을 안 믿기 위한 자리다
 * (`src/store.js` 규칙 4). 파생은 결정적이라(S11-G3) 같은 셋이면 늘 같은 색이 나온다.
 *
 * `expandSeed` 는 없는 씨앗·없는 구조·프로토타입 이름에 **던지지 않고 null 을 준다**(실측).
 * 그래서 여기서 걸러 낼 것은 씨앗 조회뿐이다.
 */
const resolveDerived = (seedId, structureId, mode) => {
  const found = seedById(seedId);
  if (!found) return null;
  const st = expandSeed(found.seed, structureId, fullCatalog, { mode });
  if (!st) return null;
  return {
    colors: st.colors,
    name: st.name,
    principle: st.principle,
    source: st.source,
    seedLabel: found.label,
  };
};

/**
 * 저장소에 넘기는 재질 규칙. **`src/store.js` 가 `src/material.js` 를 직접 읽지 않게** 밖에서
 * 넣는다 — `ratioFor` 를 넣는 것과 같은 자리다. 저장소는 파일 두 개를 다루는 곳이지 색·재질
 * 규칙을 아는 곳이 아니다.
 *
 * **`defaultFor` 는 모르는 역할에 던지지 않고 물러선다.** 이 저장소는 "모르면 던진다" 를
 * 원칙으로 쓰지만(`applyFinish`·`evForRole`·`assertRoles`) 여기서는 안 던진다 — 저장은
 * 사용자의 동작이고, **역할 이름 하나가 새로 생겼다는 이유로 저장이 실패하면 안 된다.**
 *
 * 도달 가능성: `saveDerived` 가 넘기는 역할은 `expand.js` 의 구조 정의에서 오고,
 * 그것이 `DEFAULT_FINISH_BY_ROLE` 과 일치하는지는 `S16-G11` 이 검사한다. 그래서 지금
 * 이 폴백은 **이론상 도달하지 않는다.** 남겨 두는 것은 그 게이트를 안 돌리고 역할을 늘리는
 * 경우의 안전망이고, 그때 조용히 무광이 되는 것이 저장이 통째로 실패하는 것보다 낫다고 봤다.
 * (리뷰가 "감추는 것 아닌가" 를 물었고, 그 판단 근거를 여기 적는다.)
 */
const MATERIALS = {
  finishes: [...MATERIAL_FINISHES],
  defaultFor: (role) =>
    Object.hasOwn(DEFAULT_FINISH_BY_ROLE, role) ? DEFAULT_FINISH_BY_ROLE[role] : MATERIAL_FINISHES[0],
};

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
    if (pathname === "/api/saved/derived") {
      return sendJson(res, 200, await saveDerived(body, resolveDerived, ratioFor, MATERIALS));
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

/**
 * 씨앗 하나를 배색 구조 여덟으로 펼친다.
 *
 * **색은 요청에서 받지 않는다.** id 만 받아 서버가 코퍼스·씨앗 풀에서 찾아 계산한다 —
 * 클라이언트가 준 색을 믿지 않는 S4 규칙과 같은 자리다. 헥스를 받으면 이 화면이
 * "배색사전이 말하는 조합" 이라고 이름 붙인 자리에 아무 색이나 넣을 수 있게 된다.
 *
 * 면적 비율도 여기서 내려보내지 않는다. 화면이 public/ratio.js 로 계산한다 - 검색 응답과 같은 규칙이다.
 *
 * **여덟을 전부 내려보내고, 무엇을 먼저 보일지는 selection 으로 따로 말한다.** 다섯만 내려보내면
 * LLM 이 실패했을 때 화면이 그 사실을 모른 채 다섯만 그리게 되고, 나머지 셋은 서버가 이미 계산해
 * 둔 것을 버리는 셈이 된다. 파생은 결정적이므로(S11-G3) 여덟을 다 주는 비용이 사실상 없다.
 */
async function handleExpand(res, params) {
  const id = params.get("seed");
  if (id === null || id.trim() === "") return sendJson(res, 400, { error: "seed 가 비어 있다" });
  if (id.length > 60) return sendJson(res, 400, { error: "seed 가 너무 길다" });

  const found = seedById(id);
  // 없는 씨앗을 빈 결과로 돌려주면 화면이 "구조가 없는 조합" 으로 그린다. 없는 것과 다르다.
  if (!found) return sendJson(res, 404, { error: "없는 씨앗이다" });

  // **두 모드를 한 번에 내려보낸다. `mode` 를 쿼리 파라미터로 만들지 않는다.**
  // 만드는 순간 화면의 토글이 이 엔드포인트를 다시 부를 경로가 생기고, `q` 가 붙어 있으면
  // 그 요청이 selectStructures 를 다시 돌린다 — **같은 질의인데 토글 한 번에 보이는 다섯이 바뀐다.**
  // 게다가 LLM 왕복이 매번 ~500ms 다. S15-G11 이 파라미터의 부활을 막는다.
  const dark = expandAll(found.seed, fullCatalog, { mode: "dark" });
  const darkById = new Map(dark.map((st) => [st.id, st.colors]));
  const structures = expandAll(found.seed, fullCatalog).map((st) => ({
    id: st.id,
    name: st.name,
    principle: st.principle,
    source: st.source,
    colors: st.colors,
    // 기존 필드는 하나도 안 바꾼다 — S13-G4·S14-G4 가 응답 형태를 본다. 새 필드만 얹는다.
    colorsDark: darkById.get(st.id) ?? st.colors,
  }));

  // 질의가 있을 때만 LLM 이 고른다. 없으면 두 함수 모두 부르지 않고 기본값으로 돌려준다.
  const query = params.get("q") ?? "";

  // **역할 이름은 파생 결과에서 모은다.** 손으로 적으면 구조가 늘 때 조용히 빠진다.
  // 두 모드의 역할 이름이 같다는 것은 16단계에서 전수로 확인했다(드리프트 0건).
  const roles = [...new Set(structures.flatMap((st) => st.colors.map((c) => c.role)))];

  /*
   * **둘을 나란히 부른다.** 구조 선택과 재질 배정은 서로의 결과를 안 쓴다 — 순서대로 부르면
   * 지연이 **합**이 되어 펼치기가 두 배로 느려진다. S17-G10 이 직렬화를 막는다.
   *
   * 진짜 Ollama 는 모델 하나를 두 요청이 나눠 쓰므로 내부적으로 줄을 설 수 있다. 그러면 이
   * 병렬이 벽시계 이득을 못 낸다 — 우리가 통제하는 것은 **우리 코드가 불필요하게 기다리지
   * 않는다**는 것까지다.
   *
   * **한쪽 실패가 다른 쪽을 넘어뜨리지 않게 재질 쪽에 그물을 친다.**
   *
   * 처음엔 주석에 "둘 다 던지지 않으므로 안전하다" 고 적어 뒀는데 **거짓이었다**(리뷰 지적).
   * `selectFinishes` 는 모델·네트워크 실패로는 안 던지지만 `roles` 가 잘못되면 던진다 —
   * 그건 호출부 잘못이라 그렇게 설계했고, 여기가 그 호출부다. 그것이 `Promise.all` 안에서
   * 터지면 **구조·파생까지 함께 500** 이 된다. 재질 하나 때문에 펼치기 전체를 잃는 것은
   * 균형이 안 맞는다.
   *
   * 삼키지는 않는다 — 사유를 `finishes.error` 로 실어 화면에 보이게 한다. 조용한 성공보다
   * 시끄러운 폴백이 낫다.
   */
  const [picked, finishes] = await Promise.all([
    selectStructures(query, structureCatalog, PICK_COUNT),
    selectFinishes(query, roles).catch((err) => ({
      assignments: {},
      from: "fallback",
      matched: 0,
      error: `재질 배정을 준비하지 못했다 — ${err.message}`,
    })),
  ]);

  sendJson(res, 200, {
    seed: {
      id: found.seed.id,
      label: found.label,
      from: found.from,
      colors: found.seed.colors.map((c) => ({ hex: c.hex, name: c.name ?? c.origName })),
    },
    structures,
    selection: {
      ids: picked.ids,
      from: picked.from,
      count: PICK_COUNT,
      // 모델이 실제로 보탠 개수. 다섯 중 둘만 골랐는데 "다섯을 골랐다" 고 말하지 않기 위해서다.
      matched: picked.matched ?? 0,
      model: picked.model ?? null,
      elapsedMs: picked.elapsedMs ?? null,
      // /api/status·재작성과 같은 경계. 실패 사유에 OLLAMA_HOST 나 스폰 상세가 들어가므로
      // 루프백 밖에 바인딩했다면 원문을 내보내지 않는다.
      error: picked.error ? (LOOPBACK_ONLY ? picked.error : "구조 선택을 쓸 수 없습니다") : null,
    },
    /*
     * **재질 배정. 이름만 보낸다 — 수치는 안 보낸다.**
     *
     * base·metallic·roughness·emission 까지 실으면 두 모드 × 8구조 × 3~4색이라 응답이
     * 3.8KB → 12KB 가 되는데, 화면이 그리는 것은 재질 이름뿐이다. 안 쓰는 것을 보내지 않는다
     * (사용자 결정). 수치가 필요해지면 그때 별도로 붙인다. S17-G9 가 그 경계를 검사한다.
     */
    finishes: {
      assignments: finishes.assignments,
      // **id→이름 표를 함께 보낸다.** 화면이 한글 이름을 박으면 data/finishes.json 을 고쳐도
      // 안 따라오고, 그 어긋남은 아무도 안 알려 준다. 원리·detail 은 프롬프트용이라 안 보낸다.
      names: Object.fromEntries(loadFinishes().map((f) => [f.id, f.name])),
      from: finishes.from,
      matched: finishes.matched ?? 0,
      model: finishes.model ?? null,
      elapsedMs: finishes.elapsedMs ?? null,
      // /api/status·재작성·구조 선택과 같은 경계. 루프백 밖에 바인딩했다면 원문을 안 내보낸다.
      error: finishes.error ? (LOOPBACK_ONLY ? finishes.error : "재질 배정을 쓸 수 없습니다") : null,
    },
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
  if (url.pathname === "/api/expand") return handleExpand(res, url.searchParams);
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
