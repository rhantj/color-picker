// 임베딩 — Ollama `/api/embed` 로 코퍼스와 질의를 벡터로 만들고 코사인으로 비교한다.
//
// 규칙 셋 — ollama.js 와 같은 정신이다.
//   1. 던지지 않는다. 실패는 상태와 사유로 남는다. 임베딩이 없어도 1·2단계는 그대로 돈다(S26-G3).
//   2. 프로세스를 띄우지 않는다. 기동은 ollama.js 의 몫이고 여기는 HTTP 뿐이다.
//   3. 사용자 입력은 요청 본문으로만 간다. spawn 에 닿는 경로가 없다(S3-G5).
//
// 코퍼스 벡터는 **내용 해시로 캐시**한다(27단계). sha1(모델 + 문장) 이 키라 문장이 한 글자라도 바뀌면 다시
// 만들고, 안 바뀌면 Ollama 를 안 부른다. 캐시는 var/embeddings.json 에 남겨 재시작을 넘긴다.
// 26단계는 캐시 없이 기동 때 전부 만들었다(0.5초) — 코퍼스가 바뀌면 바뀐 문서만 다시 만들려고 들였다.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { cosine } from "./hybrid.js";

const HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11434";
const BASE = `http://${HOST}`;
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "bge-m3";
/** 저신뢰 경로의 예산. 처음 적재 때 7초까지 봤다 [실측]. 확신 경로는 호출부가 더 짧게 준다. */
export const EMBED_TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 8000);
/** 코퍼스 34건을 한 번에 벡터화하는 예산. 질의 예산에 묶여 있다 — 질의 예산을 줄이면 이것도 줄어든다(리뷰 지적). 처음 적재 7초보다 넉넉해야 한다. */
const PREPARE_TIMEOUT_MS = EMBED_TIMEOUT_MS * 4;
/** unavailable 뒤 다시 확인해 보는 간격. ollama.js 의 STATUS_TTL_MS 와 같은 뜻이다. */
const RETRY_TTL_MS = 5000;

// 캐시 자리. store.js 와 같은 폴더·같은 규칙(임시 파일 → rename, 깨지면 옆으로).
const DATA_DIR = process.env.TONEFIRST_DATA_DIR || fileURLToPath(new URL("../var/", import.meta.url));
const CACHE_FILE = "embeddings.json";
const keyOf = (text) => createHash("sha1").update(`${EMBED_MODEL}\n${text}`).digest("hex");

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
/** 지금 벡터화 중인 문서 목록. 끝났을 때 lastDocs 와 다르면 한 번 더 돈다 — 진행 중에 코퍼스가 또 바뀐 경우다(리뷰 지적). */
let runningDocs = null;

export const status = () => ({ ...current });

/** 벡터 배열을 돌려주거나 던진다. 던지는 것은 이 파일 안에서만 잡는다. */
async function callEmbed(input, timeoutMs) {
  const res = await fetch(`${BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error ? `${EMBED_MODEL}: ${json.error}` : `Ollama 가 ${res.status}`);
  if (!Array.isArray(json?.embeddings)) throw new Error("임베딩 응답에 embeddings 배열이 없다");
  return json.embeddings;
}

// 연결 거부와 모델 없음을 가른다 — 사용자가 고칠 것이 다르다(Ollama 를 띄우기 vs ollama pull).
const reason = (err) => {
  if (err.name === "TimeoutError" || err.name === "AbortError") return `${HOST} 가 제때 답하지 않았다`;
  if (err.cause?.code === "ECONNREFUSED" || /fetch failed/.test(err.message)) return `${HOST} 가 응답하지 않는다`;
  return err.message;
};

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
      loadCache();
      const missing = docs.filter((d) => !cache.has(keyOf(d.text)));
      if (missing.length > 0) {
        const vectors = await callEmbed(missing.map((d) => d.text), PREPARE_TIMEOUT_MS);
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
      current = {
        ...current,
        state: "ready",
        detail: `${HOST} 응답 · ${EMBED_MODEL}`,
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
 * 지적) — ollama.js 의 refresh() 가 "죽으면 죽었다고" 를 맡듯, 여기는 "살아나면 살아났다고" 를 맡는다.
 * ready 면 아무것도 안 한다. 죽음 쪽은 embedQuery 가 연결 거부를 보고 내린다.
 */
export async function refresh() {
  if (current.state === "ready" || !lastDocs) return status();
  if (Date.now() - lastTriedAt < RETRY_TTL_MS) return status();
  return prepare(lastDocs);
}

/** 질의 하나를 벡터로. 실패해도 던지지 않는다 — { vector: null, error } 로 돌아온다. */
export async function embedQuery(text, { timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  const started = Date.now();
  if (current.state !== "ready") {
    return { vector: null, error: `임베딩을 쓸 수 없다 (${current.detail})`, elapsedMs: 0 };
  }
  try {
    const [vector] = await callEmbed([text], timeoutMs);
    return { vector, error: null, elapsedMs: Date.now() - started };
  } catch (err) {
    const error = reason(err);
    // 연결 거부는 "죽었다" 다. 타임아웃은 느린 것일 수 있어 상태를 안 내린다 — 확신 경로의 짧은 예산이 죽음으로 읽히면 안 된다.
    if (/응답하지 않는다$/.test(error)) {
      corpus = [];
      current = { ...current, state: "unavailable", detail: error, count: 0 };
      lastTriedAt = Date.now();
    }
    return { vector: null, error, elapsedMs: Date.now() - started };
  }
}

/** 코퍼스 전체와의 코사인. 내림차순. 준비 안 됐으면 빈 배열. */
export function similarities(vector) {
  if (!vector || corpus.length === 0) return [];
  return corpus
    .map((d) => ({ id: d.id, kind: d.kind, cosine: cosine(vector, d.vector) }))
    .sort((a, b) => b.cosine - a.cosine);
}
