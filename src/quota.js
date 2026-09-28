// 유료 API 호출 한도 — 방문자 IP 하나가 1분에 몇 번까지 모델을 부를 수 있나(41단계).
//
// 왜 필요한가: 모델이 Claude API · Voyage API 로 바뀌면서 호출마다 돈이 든다. 배포 사이트는 누구나 연다 —
// 스크립트 하나가 검색을 수천 번 돌리면 그 비용이 대표님 계정에 쌓인다.
//
// **이건 보조 장치다.** 진짜 상한은 Anthropic · Voyage 콘솔의 월 지출 한도다(대표님이 건다). 이 파일의 숫자는
// 프로세스 메모리에 있어서, Vercel 처럼 서버가 여러 대로 나뉘면 **서버마다 따로 센다** `[판단]`.
//
// 한도를 넘으면 던지지 않는다 — 호출부가 모델 없이 물러선다(검색은 1단계, 캐릭터는 정규식, 구조·재질은 기본값).
// 사이트가 멈추지 않고 덜 똑똑해질 뿐이다.
//
// IP 는 요청마다 AsyncLocalStorage 로 흘린다. 모델을 부르는 곳(llm.js · embed.js)이 요청 객체를 모르기 때문이다 —
// 인자로 넘기면 네 호출부와 파이프라인 전체의 서명이 바뀐다.

import { AsyncLocalStorage } from "node:async_hooks";

const WINDOW_MS = 60_000;
/**
 * IP 하나의 1분 한도. 임베딩과 LLM 을 같은 통에서 센다 — 검색 한 번이 최대 2번(임베딩 1 + 재작성 1),
 * 캐릭터·구조 펼치기가 2번이다. 사람이 쓰면 닿지 않는 값 `[판단]`.
 */
export const PER_CLIENT_PER_MIN = Number(process.env.LLM_RATE_PER_MIN ?? 30);
/** 서버 하나의 1분 한도. IP 를 바꿔 가며 부르는 경우의 천장 `[판단]`. */
export const GLOBAL_PER_MIN = Number(process.env.LLM_RATE_GLOBAL_PER_MIN ?? 200);
/** 기억하는 IP 수의 상한. 넘으면 가장 오래된 것부터 잊는다 — 메모리가 끝없이 늘지 않게. */
const MAX_CLIENTS = 5000;

const context = new AsyncLocalStorage();
/** @type {Map<string, number[]>} IP → 최근 1분의 호출 시각 */
const perClient = new Map();
/** @type {number[]} */
let global = [];

/** 요청 하나를 이 IP 로 감싼다. server.js 가 요청마다 부른다. */
export const runWithClient = (client, fn) => context.run({ client }, fn);

/**
 * 요청의 방문자 IP. Vercel 에서는 `x-forwarded-for` 첫 값이 방문자다(Vercel 이 넣는다).
 * 로컬에서는 이 헤더를 믿지 않는다 — 아무나 적어 보낼 수 있어서 한도를 우회하는 데 쓰인다.
 */
export function clientOf(req) {
  if (process.env.VERCEL) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? "unknown";
}

const recent = (times, now) => times.filter((t) => now - t < WINDOW_MS);

/**
 * 모델 호출 한 번을 쓴다. 쓸 수 있으면 true(그리고 센다), 한도면 false.
 * 요청 밖(기동 때 코퍼스 벡터화 등)에서는 IP 가 없다 — 그건 방문자가 부른 것이 아니라 세지 않는다.
 */
export function take() {
  const client = context.getStore()?.client;
  if (!client) return true;
  const now = Date.now();
  global = recent(global, now);
  const mine = recent(perClient.get(client) ?? [], now);
  if (mine.length >= PER_CLIENT_PER_MIN || global.length >= GLOBAL_PER_MIN) {
    perClient.set(client, mine);
    return false;
  }
  mine.push(now);
  global.push(now);
  perClient.delete(client); // 다시 넣어 "가장 최근" 으로 옮긴다 — Map 은 넣은 순서를 지킨다
  perClient.set(client, mine);
  if (perClient.size > MAX_CLIENTS) perClient.delete(perClient.keys().next().value);
  return true;
}

/** 게이트용 — 센 것을 비운다. */
export function resetQuota() {
  perClient.clear();
  global = [];
}
