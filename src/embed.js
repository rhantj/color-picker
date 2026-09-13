// 임베딩 — Ollama `/api/embed` 로 코퍼스와 질의를 벡터로 만들고 코사인으로 비교한다.
//
// 규칙 셋 — ollama.js 와 같은 정신이다.
//   1. 던지지 않는다. 실패는 상태와 사유로 남는다. 임베딩이 없어도 1·2단계는 그대로 돈다(S26-G3).
//   2. 프로세스를 띄우지 않는다. 기동은 ollama.js 의 몫이고 여기는 HTTP 뿐이다.
//   3. 사용자 입력은 요청 본문으로만 간다. spawn 에 닿는 경로가 없다(S3-G5).
//
// 코퍼스 벡터는 캐시하지 않는다 — 34건이 따뜻할 때 0.5초다 [실측]. 필요가 생기면 그때(스펙 "버린 대안").

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

/** @type {{state:"unknown"|"ready"|"unavailable", detail:string, model:string, count:number}} */
let current = { state: "unknown", detail: "아직 확인하지 않았다", model: EMBED_MODEL, count: 0 };
/** @type {{id:string, kind:"palette"|"diagnosis", vector:number[]}[]} */
let corpus = [];
/** 마지막으로 prepare 에 넘어온 문서. refresh 가 다시 시도할 때 쓴다. */
let lastDocs = null;
let lastTriedAt = 0;
let preparing = null;

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
  if (preparing) return preparing; // 단일 비행 — /api/status 가 연달아 와도 벡터화는 한 번만
  preparing = (async () => {
    try {
      const vectors = await callEmbed(docs.map((d) => d.text), PREPARE_TIMEOUT_MS);
      if (vectors.length !== docs.length) throw new Error(`벡터 ${vectors.length}개, 문서 ${docs.length}개`);
      corpus = docs.map((d, i) => ({ id: d.id, kind: d.kind, vector: vectors[i] }));
      current = { ...current, state: "ready", detail: `${HOST} 응답 · ${EMBED_MODEL}`, count: corpus.length };
    } catch (err) {
      corpus = [];
      current = { ...current, state: "unavailable", detail: reason(err), count: 0 };
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
