// 임베딩 — Voyage AI `/v1/embeddings` 로 코퍼스와 질의를 벡터로 만들고 코사인으로 비교한다(41단계).
// 40단계까지는 로컬 Ollama(bge-m3)였다.
//
// 규칙 셋.
//   1. 던지지 않는다. 실패는 상태와 사유로 남는다. 임베딩이 없어도 1·2단계는 그대로 돈다(S26-G3).
//   2. 키가 없으면 부르지 않는다. 상태가 unavailable 이고 사유가 "VOYAGE_API_KEY 가 없다" 다.
//   3. 사용자 입력은 요청 본문으로만 간다.
//
// **문서와 질의를 다르게 만든다(`input_type`).** 코퍼스는 "document", 질의는 "query". bge-m3 는 둘을 같게 만들었고,
// Voyage 는 둘을 나눠야 검색이 잘 된다고 안내한다 [문헌: docs.voyageai.com/docs/embeddings]. 그래서 코사인 점수의
// 분포가 bge-m3 때와 다르다 — hybrid.js 의 기준값을 다시 재야 하는 이유다(HYBRID_MEASURED).
//
// 코퍼스 벡터는 **내용 해시로 캐시**한다(27단계). sha1(모델 + 종류 + 문장) 이 키라 문장이 한 글자라도 바뀌면 다시
// 만들고, 안 바뀌면 API 를 안 부른다 — 돈도 안 든다. 캐시는 데이터 폴더의 embeddings.json 에 남겨 재시작을 넘긴다.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cosine } from "./hybrid.js";
import { take } from "./quota.js";
import { DATA_DIR } from "./store.js";

const BASE = (process.env.VOYAGE_BASE_URL || "https://api.voyageai.com").replace(/\/+$/, "");
/** voyage-4 와 voyage-4-lite 중 23건 측정으로 고른다(스펙 Q2). 1024차원 — bge-m3 와 같다. */
export const EMBED_MODEL = process.env.VOYAGE_MODEL || "voyage-4";
/** 요청 하나의 수명. 확신 경로는 호출부(pipeline.js)가 더 짧게 기다린다. */
export const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 8000);
/** 코퍼스 34건을 한 번에 벡터화하는 예산. */
const PREPARE_TIMEOUT_MS = EMBED_TIMEOUT_MS * 4;
/** unavailable 뒤 다시 확인해 보는 간격. */
const RETRY_TTL_MS = 5000;

const apiKey = () => process.env.VOYAGE_API_KEY ?? "";

// 캐시 자리. store.js 와 같은 폴더·같은 규칙(임시 파일 → rename, 깨지면 옆으로).
const CACHE_FILE = "embeddings.json";
// 캐시하는 것은 문서 벡터뿐이지만 종류를 키에 넣는다 — 같은 문장이라도 질의용과 문서용 벡터가 다르다.
const keyOf = (text) => createHash("sha1").update(`${EMBED_MODEL}\ndocument\n${text}`).digest("hex");

/** @type {Map<string, number[]>} 해시 → 벡터 */
let cache = new Map();
let cacheLoaded = false;

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const target = join(DATA_DIR, CACHE_FILE);
  if (!existsSync(target)) return;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    // 다른 모델의 캐시는 버린다 — 벡터 공간이 다르다.
    if (parsed?.model !== EMBED_MODEL || typeof parsed.entries !== "object" || parsed.entries === null) return;
    for (const [hash, vector] of Object.entries(parsed.entries)) {
      if (Array.isArray(vector) && vector.every((x) => typeof x === "number")) cache.set(hash, vector);
    }
  } catch (err) {
    // 깨진 캐시로 시작하면 다음 쓰기가 원본을 덮는다. 옆으로 치우고 이유를 남긴다(store.js 와 같은 처방).
    const aside = `${target}.corrupt-${Date.now()}`;
    try {
      renameSync(target, aside);
      process.stderr.write(Buffer.from(`임베딩 캐시가 깨져 있어 옆으로 옮겼다: ${aside} (${err.message})\n`, "utf8"));
    } catch {
      process.stderr.write(Buffer.from(`임베딩 캐시가 깨졌는데 옮기지도 못했다: ${target}\n`, "utf8"));
    }
  }
}

function saveCache() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const target = join(DATA_DIR, CACHE_FILE);
    const temp = `${target}.tmp`;
    const dims = cache.size ? cache.values().next().value.length : 0;
    writeFileSync(temp, JSON.stringify({ model: EMBED_MODEL, dims, entries: Object.fromEntries(cache) }), "utf8");
    renameSync(temp, target);
  } catch (err) {
    // 쓰기 실패는 서비스와 무관하다 — 다음 기동에 다시 만들 뿐이다.
    process.stderr.write(Buffer.from(`임베딩 캐시를 쓰지 못했다: ${err.message}\n`, "utf8"));
  }
}

/** @type {{state:"unknown"|"ready"|"unavailable", detail:string, model:string, count:number}} */
let current = { state: "unknown", detail: "아직 확인하지 않았다", model: EMBED_MODEL, count: 0, cached: 0, embedded: 0 };
/** @type {{id:string, kind:"palette"|"diagnosis", vector:number[]}[]} */
let corpus = [];
/** 마지막으로 prepare 에 넘어온 문서. refresh 가 다시 시도할 때 쓴다. */
let lastDocs = null;
let lastTriedAt = 0;
let preparing = null;
/**
 * 준비가 성공할 때마다 하나 는다. 질의 요청은 이제 예산을 넘겨도 8초까지 살아 있어서, 그사이 상태가 회복된 뒤에
 * 늦게 온 연결 실패가 ready 를 unavailable 로 되돌릴 수 있었다(40단계 리뷰 P3). 요청을 시작한 세대가 지금 세대와
 * 같을 때만 상태를 내린다.
 */
let generation = 0;
/** 지금 벡터화 중인 문서 목록. 끝났을 때 lastDocs 와 다르면 한 번 더 돈다 — 진행 중에 코퍼스가 또 바뀐 경우다(리뷰 지적). */
let runningDocs = null;

export const status = () => ({ ...current });

class EmbedError extends Error {
  /** @param {string} message @param {"timeout"|"connection"|"auth"|"status"|"shape"|"nokey"} kind */
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

/**
 * 벡터 배열을 돌려주거나 던진다. 던지는 것은 이 파일 안에서만 잡는다.
 * @param {string[]} input @param {"document"|"query"} inputType @param {number} timeoutMs
 */
async function callEmbed(input, inputType, timeoutMs) {
  const key = apiKey();
  if (!key) throw new EmbedError("VOYAGE_API_KEY 가 없다", "nokey");
  let res;
  try {
    res = await fetch(`${BASE}/v1/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ input, model: EMBED_MODEL, input_type: inputType }),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new EmbedError("Voyage API 가 제때 답하지 않았다", "timeout");
    throw new EmbedError("Voyage API 에 닿지 못했다", "connection");
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) throw new EmbedError(`Voyage API 키가 거절됐다 (${res.status})`, "auth");
  if (!res.ok) throw new EmbedError(`Voyage API 가 ${res.status}${json?.detail ? ` — ${String(json.detail).slice(0, 120)}` : ""}`, "status");
  if (!Array.isArray(json?.data)) throw new EmbedError("임베딩 응답에 data 배열이 없다", "shape");
  // 순서는 index 로 맞춘다 — 응답 배열 순서를 믿지 않는다.
  const vectors = new Array(input.length).fill(null);
  for (const item of json.data) {
    if (Number.isInteger(item?.index) && item.index >= 0 && item.index < input.length) vectors[item.index] = item.embedding;
  }
  // 빈 배열을 받고 성공으로 치면 벡터 없이 1단계로 나가면서 기록엔 성공이 남는다(40단계 리뷰 P3).
  if (vectors.some((v) => !Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === "number"))) {
    throw new EmbedError(`임베딩 응답의 벡터가 ${json.data.length}개 — 입력 ${input.length}개`, "shape");
  }
  return vectors;
}

/** 이 실패가 "지금은 못 쓴다" 인가 — 키가 없거나 거절됐거나 닿지 못했다. 느린 것(timeout)·한 번 튄 5xx 는 아니다. */
const isDown = (err) => err instanceof EmbedError && (err.kind === "nokey" || err.kind === "auth" || err.kind === "connection");
const reason = (err) => err?.message ?? String(err);

/**
 * 코퍼스를 벡터화한다. 기동 때 한 번 부르고 기다리지 않는다 — 준비 전 질의는 3단계를 건너뛴다.
 * @param {{id:string, kind:"palette"|"diagnosis", text:string}[]} docs
 */
export async function prepare(docs) {
  lastDocs = docs;
  lastTriedAt = Date.now();
  // 단일 비행 — /api/status 가 연달아 와도 벡터화는 한 번만. 다만 진행 중에 **다른** 문서 목록이 오면
  // 끝난 뒤 그 목록으로 한 번 더 돈다. 안 그러면 두 번째 편집이 조용히 유실되고, 첫 번이 성공으로 끝나
  // refresh 의 재시도 조건에도 안 걸려 다음 편집 때까지 3단계가 옛 코퍼스 벡터 없이 비활성이다(리뷰 재현).
  if (preparing) return preparing.then(() => (lastDocs !== runningDocs ? prepare(lastDocs) : status()));
  runningDocs = docs;
  preparing = (async () => {
    try {
      if (!apiKey()) throw new EmbedError("VOYAGE_API_KEY 가 없다", "nokey");
      loadCache();
      const missing = docs.filter((d) => !cache.has(keyOf(d.text)));
      if (missing.length > 0) {
        const vectors = await callEmbed(missing.map((d) => d.text), "document", PREPARE_TIMEOUT_MS);
        if (vectors.length !== missing.length) throw new Error(`벡터 ${vectors.length}개, 문서 ${missing.length}개`);
        missing.forEach((d, i) => cache.set(keyOf(d.text), vectors[i]));
      }
      corpus = docs.map((d) => ({ id: d.id, kind: d.kind, vector: cache.get(keyOf(d.text)) }));
      // 가지치기 — 현재 문서의 해시만 남긴다. 안 하면 문서를 고칠 때마다 옛 벡터가 쌓인다.
      const keep = new Set(docs.map((d) => keyOf(d.text)));
      const before = cache.size;
      cache = new Map([...cache].filter(([hash]) => keep.has(hash)));
      // 새로 만든 것이 있거나 가지치기로 줄었을 때 쓴다. 삭제만 하면 missing 이 0 이라 안 쓰던 결함이 있었다(리뷰 지적).
      if (missing.length > 0 || cache.size !== before) saveCache();
      generation += 1;
      current = {
        ...current,
        state: "ready",
        detail: `Voyage API · ${EMBED_MODEL}`,
        count: corpus.length,
        cached: docs.length - missing.length,
        embedded: missing.length,
      };
    } catch (err) {
      corpus = [];
      current = { ...current, state: "unavailable", detail: reason(err), count: 0, cached: 0, embedded: 0 };
    }
    return status();
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

/**
 * 쓸 수 없는 상태면 TTL 마다 다시 시도한다. **한 번 실패했다고 재시작 전까지 3단계를 못 쓰면 안 된다**(리뷰
 * 지적) — 여기는 "살아나면 살아났다고" 를 맡는다. 키를 새로 넣은 뒤나 네트워크가 돌아온 뒤다.
 * ready 면 아무것도 안 한다. 죽음 쪽은 embedQuery 가 isDown 실패를 보고 내린다.
 */
export async function refresh() {
  if (current.state === "ready" || !lastDocs) return status();
  if (Date.now() - lastTriedAt < RETRY_TTL_MS) return status();
  return prepare(lastDocs);
}

/**
 * 질의 하나를 벡터로. 실패해도 던지지 않는다 — { vector: null, error } 로 돌아온다.
 *
 * `timeoutMs` 는 **기다리는 시간**이다. 요청 자체는 늘 `EMBED_TIMEOUT_MS` 까지 산다. 40단계에서 Ollama 의 모델
 * 적재를 끊지 않으려고 들인 모양인데, API 로 바뀐 뒤에도 해가 없어 그대로 둔다 — 예산을 넘기면 답은 기다리지 않고
 * 돌려주고, 요청은 뒤에서 끝난다.
 */
export async function embedQuery(text, { timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  const started = Date.now();
  if (current.state !== "ready") {
    return { vector: null, error: `임베딩을 쓸 수 없다 (${current.detail})`, elapsedMs: 0 };
  }
  // 방문자 한 명이 비용을 태우지 못하게(quota.js). 한도는 "못 쓴다" 가 아니다 — 상태를 안 내린다.
  if (!take()) return { vector: null, error: "요청이 너무 많다 — 잠시 뒤에 다시", elapsedMs: 0 };
  const startedIn = generation;
  const request = callEmbed([text], "query", EMBED_TIMEOUT_MS).then(
    ([vector]) => ({ vector, error: null }),
    (err) => {
      const error = reason(err);
      // 키 없음·키 거절·닿지 못함은 "지금은 못 쓴다" 다. 타임아웃은 느린 것일 수 있어 상태를 안 내린다 — 확신 경로의
      // 짧은 예산이 죽음으로 읽히면 안 된다. 40단계까지는 사유 문장 끝("응답하지 않는다")으로 이걸 갈랐다 — 문구를
      // 고치는 순간 조용히 깨지는 결합이라 오류 종류(kind)로 바꿨다.
      // 요청이 시작된 뒤 준비가 다시 성공했으면(세대가 바뀜) 옛 요청의 실패로 새 상태를 덮지 않는다.
      if (isDown(err) && startedIn === generation) {
        corpus = [];
        current = { ...current, state: "unavailable", detail: error, count: 0 };
        lastTriedAt = Date.now();
      }
      return { vector: null, error };
    },
  );
  let timer;
  const gaveUp = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ vector: null, error: "Voyage API 가 제때 답하지 않았다" }), timeoutMs);
  });
  const result = await Promise.race([request, gaveUp]);
  clearTimeout(timer);
  return { ...result, elapsedMs: Date.now() - started };
}

/** 코퍼스 전체와의 코사인. 내림차순. 준비 안 됐으면 빈 배열. */
export function similarities(vector) {
  if (!vector || corpus.length === 0) return [];
  return corpus
    .map((d) => ({ id: d.id, kind: d.kind, cosine: cosine(vector, d.vector) }))
    .sort((a, b) => b.cosine - a.cosine);
}
