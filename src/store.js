// 대화 내역과 저장된 조합. 의존성 0 이므로 JSON 파일 두 개로 둔다.
//
// 규칙 넷:
//   1. **원자적 쓰기.** 임시 파일에 쓰고 rename 한다. 중간에 죽어도 반쪽 파일이 남지 않는다.
//   2. **직렬화.** 쓰기를 프로미스 체인으로 이어 붙여 동시 쓰기가 서로를 덮지 않게 한다.
//   3. **상한.** 무한히 자라지 않는다. 오래된 것부터 버린다.
//   4. **클라이언트를 믿지 않는다.** 저장 요청에서 받는 것은 id·메모·면적 비율뿐이고,
//      색·헥스·유형은 서버가 코퍼스에서 찾아 채운다. 화면이 보낸 색을 그대로 저장하면
//      저장소가 코퍼스와 어긋나기 시작한다.
//
//      **파생 팔레트도 같다.** 코퍼스에 없지만 파생은 결정적이라(S11-G3) 씨앗 id·구조 id·모드
//      셋만 받으면 서버가 색을 다시 계산할 수 있다. 그래서 여기서도 화면이 색을 보내지 않는다.
//      S18-G1 이 색을 실어 보내는 요청으로 그것을 확인한다.
//
//      **재질 배정도 예외다.** 색과 달리 다시 계산할 수 없다 — 로컬 LLM 이 정하는 것이라
//      같은 질의라도 답이 달라질 수 있고, 재계산하면 저장할 때 본 것과 다른 재질이 나온다.
//      그래서 **받되 검증한다** — 값이 실재하는 재질인지, 역할이 그 구조에 실제로 있는지.
//      비율과 같은 부류다: 판단이라 받고, 형태는 강제한다.
//
//      **둘이 예외인 이유는 하나다.** 색은 코퍼스(또는 파생 규칙)가 아는 사실이지만
//      **비율과 재질은 판단**이다 — 코퍼스에 답이 없고 서버가 다시 만들어 낼 수도 없다.
//      같은 두 헥스도 비율이 바뀌면 다른 색이 되므로, 그 결정을 사용자에게서 받는 것이 이 도구의 요점이다.
//      대신 형태는 강제한다 — 정수, 10~90. 0 이나 100 은 한 색을 없애는 것이라 2색 조합이 아니게 된다.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// 저장 위치. 검사가 사용자 데이터를 오염시키지 않도록 환경변수로 갈아끼울 수 있게 둔다.
const DATA_DIR = process.env.TONEFIRST_DATA_DIR || fileURLToPath(new URL("../var/", import.meta.url));

// 한쪽이 가질 수 있는 최소·최대 지분. 이 밖으로 나가면 사실상 단색이 된다.
export const RATIO_MIN = 10;
export const RATIO_MAX = 90;

export function normalizeRatio(value) {
  if (!Number.isInteger(value)) return null;
  if (value < RATIO_MIN || value > RATIO_MAX) return null;
  return [value, 100 - value];
}

/**
 * 색이 n 개일 때 한 색이 가질 수 있는 지분의 하한.
 *
 * **`public/ratio.js` 의 `shareBounds` 와 같은 값을 독립적으로 적는다.** 화면과 서버가 각자
 * 계산하면 사용자가 슬라이더로 움직인 값을 서버가 거부하는 일이 생긴다 — `S5-G4` 가 2색에서
 * 같은 이유로 같은 규칙을 걸고, `S18-G2` 가 다색에서 그것을 본다. 읽어 오지 않는 이유는
 * 이 저장소가 "게이트·검증이 감시 대상에서 값을 가져오면 함께 느슨해진다" 로 세 번 뚫렸기 때문이다.
 *
 * 하한이 개수와 동시에 성립하지 않는 구간이 있다 — `MIN_SHARE × n > 100` 이면 "합 100" 과
 * "각자 10 이상" 을 같이 만족할 수 없다. 합이 먼저이므로 하한을 개수에 맞춰 낮춘다.
 */
const shareFloor = (count) => Math.min(RATIO_MIN, Math.floor(100 / count));

/**
 * 다색 지분을 검증한다. 색 개수를 알아야 하므로 개수를 함께 받는다.
 *
 * 무는 것 넷 — 길이가 색 개수와 같다 · 전부 정수다 · 각자 하한 이상이다 · **합이 정확히 100** 이다.
 * 합이 100 이 아니면 스와치 바에 틈이 생기거나 마지막 색이 잘려, 화면이 말하는 비율과 보이는
 * 비율이 달라진다(`S13-G1` 이 같은 이유로 같은 것을 본다).
 *
 * **2색이면 숫자 하나도 받는다.** 기존 경로(`ratio: 70`)가 그대로 살아야 하기 때문이다 —
 * `S18-G8` 이 그 회귀를 본다.
 */
export function normalizeShares(value, count) {
  if (!Number.isInteger(count) || count < 2) return null;
  if (count === 2 && Number.isInteger(value)) return normalizeRatio(value);

  if (!Array.isArray(value) || value.length !== count) return null;
  const floor = shareFloor(count);
  let sum = 0;
  for (const v of value) {
    if (!Number.isInteger(v) || v < floor) return null;
    sum += v;
  }
  return sum === 100 ? [...value] : null;
}

export const LIMITS = {
  ratioMin: RATIO_MIN,
  ratioMax: RATIO_MAX,
  conversations: 50,
  turnsPerConversation: 100,
  saved: 200,
  queryChars: 500,
  noteChars: 200,
};

let chain = Promise.resolve();

function readJson(file, fallback) {
  const target = join(DATA_DIR, file);
  if (!existsSync(target)) return fallback; // 아직 아무것도 저장하지 않은 상태. 정상이다.

  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    throw new Error("배열이 아니다");
  } catch (err) {
    // 파일이 깨졌는데 그대로 빈 배열로 시작하면, 다음 쓰기가 원본을 덮어써 기록이 통째로 사라진다.
    // 옆으로 치워 두고 이유를 남긴다 — 조용한 데이터 소실이 이 저장소에서 가장 나쁜 실패다.
    const aside = `${target}.corrupt-${Date.now()}`;
    try {
      renameSync(target, aside);
      process.stderr.write(Buffer.from(`저장 파일이 깨져 있어 옆으로 옮겼다: ${aside} (${err.message})
`, "utf8"));
    } catch {
      process.stderr.write(Buffer.from(`저장 파일이 깨졌는데 옮기지도 못했다: ${target}
`, "utf8"));
    }
    return fallback;
  }
}

function writeJson(file, value) {
  mkdirSync(DATA_DIR, { recursive: true });
  const target = join(DATA_DIR, file);
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  renameSync(temp, target);
}

/** 쓰기를 한 줄로 세운다. 동시 요청이 서로의 결과를 덮어쓰지 않게. */
function serialize(work) {
  const next = chain.then(work, work);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
// **사람이 한 글자로 보는 단위(그래핌 클러스터)로 자른다.**
// slice 는 UTF-16 단위라 이모지의 서로게이트 쌍을 반으로 쪼갠다. 스프레드는 코드포인트 단위라
// 거기까지는 막지만, 한글 자모 결합·악센트·ZWJ 로 이어 붙인 이모지는 여전히 중간에서 끊는다 —
// 상한 근처에서 악센트만 떨어지거나 가족 이모지가 낱개로 흩어진다.
// Intl.Segmenter 는 Node 와 최신 브라우저에 기본으로 있어 의존성이 늘지 않는다.
const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
const clip = (value, max) => {
  const text = String(value ?? "").trim();
  // 짧으면 자를 것이 없다. 세그먼트 순회 비용을 매 호출마다 치르지 않는다.
  if (text.length <= max) return text;
  let out = "";
  let n = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (++n > max) break;
    out += segment;
  }
  return out;
};

const ID_SHAPE = /^[a-z]+-[a-z0-9]+-[a-z0-9]+$/;
const VALID_ROUTES = new Set(["palette", "diagnosis", "none"]);

/* ── 대화 내역 ───────────────────────────────────────────── */

export function listConversations() {
  return readJson("conversations.json", []);
}

/**
 * 턴 하나를 기록한다. conversationId 가 없거나 모르는 값이면 새 대화를 연다.
 * 화면이 보낸 값은 전부 형태를 강제해서 넣는다 — 문자열 길이, 열거값, 숫자 범위.
 */
export function recordTurn(input) {
  const query = clip(input.query, LIMITS.queryChars);
  if (!query) return Promise.reject(new Error("query 가 비어 있다"));

  const turn = {
    at: now(),
    query,
    stage: input.stage === 2 ? 2 : 1,
    route: VALID_ROUTES.has(input.route) ? input.route : "none",
    confident: input.confident === true,
    topKind: input.topKind === "diagnosis" ? "diagnosis" : input.topKind === "palette" ? "palette" : null,
    topId: clip(input.topId, 40) || null,
    topLabel: clip(input.topLabel, 80) || null,
  };

  return serialize(() => {
    const all = listConversations();
    const wanted = typeof input.conversationId === "string" ? input.conversationId : null;
    let conversation = wanted ? all.find((c) => c.id === wanted) : null;

    if (!conversation) {
      conversation = { id: newId("conv"), startedAt: turn.at, updatedAt: turn.at, turns: [] };
      all.unshift(conversation);
    }

    conversation.turns.push(turn);
    if (conversation.turns.length > LIMITS.turnsPerConversation) {
      conversation.turns = conversation.turns.slice(-LIMITS.turnsPerConversation);
    }
    conversation.updatedAt = turn.at;

    // 최근 대화가 앞에 오게 정렬하고 상한을 넘으면 오래된 것부터 버린다.
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    writeJson("conversations.json", all.slice(0, LIMITS.conversations));
    return { conversationId: conversation.id, turn };
  });
}

/* ── 저장된 조합 ─────────────────────────────────────────── */

export function listSaved() {
  return readJson("saved.json", []);
}

/**
 * 화면이 보낸 재질 배정을 **걸러 낸다.**
 *
 * 무는 것 셋 — 역할이 그 구조에 실제로 있는가 · 값이 문자열인가 · 실재하는 재질인가.
 * `Object.hasOwn` 으로 먼저 거르는 이유는 `__proto__` 같은 이름이 프로토타입에서 값을 물고
 * 나오기 때문이다(17단계에서 같은 것을 겪었다).
 *
 * **거부가 아니라 걸러내기다.** 모르는 것만 버리고 나머지는 살린다 — 하나 틀렸다고 저장을
 * 통째로 막으면 사용자가 이유도 모른 채 저장을 못 한다. 버린 자리는 호출부가 기본 배정으로
 * 채운다(`parseAssignment` 가 LLM 응답에 하는 것과 같은 선택이다).
 *
 * 프로토타입 없는 객체로 모은다. `picked["__proto__"] = "matte"` 가 객체 리터럴에서는
 * **own 속성이 아니라 프로토타입 대입**이 되어 조용히 사라진다.
 *
 * **`wanted.has(role)` 을 지우는 변형은 게이트가 안 잡는다. 구멍이 아니라 이중 방어다** —
 * `saveDerived` 의 최종 조립 루프가 `roles` 만 순회하므로 여기 남은 여분 키가 저장에 닿지
 * 않는다(리뷰가 같은 판정을 냈다). 그래도 두는 것은 **이 함수가 무엇을 돌려주는지가 계약**이기
 * 때문이다 — 호출부가 하나뿐이라는 사실이 언제까지나 참이라는 보장은 없다.
 */
function pickFinishes(input, roles, valid) {
  const picked = Object.create(null);
  if (!input || typeof input !== "object" || Array.isArray(input)) return picked;

  const wanted = new Set(roles);
  for (const [role, id] of Object.entries(input)) {
    if (!wanted.has(role) || Object.hasOwn(picked, role)) continue;
    if (typeof id !== "string" || !valid.includes(id)) continue;
    picked[role] = id;
  }
  return picked;
}

/**
 * 앞의 항목에서 **무엇을 이어받을지** 정한다. 두 저장 경로(`savePalette`·`saveDerived`)가
 * 같은 규칙을 쓰게 하는 자리다.
 *
 * **이 중복이 이미 결함을 하나 만들었다.** 두 함수가 같은 40여 줄을 각자 적고 있었는데,
 * 메모 줄만 표기가 갈렸다 — 한쪽은 `clip(input.note, ...)`, 다른 쪽은
 * `clip(String(input.note).trim(), ...)`. `clip` 안에 이미 `?? ""` 가 있어서 앞쪽은 `null` 을
 * 빈 문자열로 바꾸지만 뒤쪽은 **문자열 "null" 로 저장했다**(리뷰 지적, 재현 확인).
 * 규칙이 하나면 갈릴 수 없다.
 *
 * **함수 자체는 안 합친다.** 조회 방식(코퍼스 id vs 씨앗·구조·모드)과 항목 스키마가 근본적으로
 * 다르다. 갈리면 안 되는 것은 **병합 규칙**뿐이고, 그것만 여기 둔다.
 *
 * 규칙 둘:
 *   - 비율을 안 보냈는데 앞에서 손대 둔 것이 있으면 이어받는다. 규칙의 기본값으로 되돌리면
 *     사용자가 명시적으로 한 조정이 사라진다(S5-G5).
 *   - 메모는 **안 보낸 것과 빈 값을 가른다.** 안 보냈으면 잇고, 빈 값은 지우기다(S8-G2·G3).
 *     이어받기가 무조건이면 사용자가 메모를 지울 방법이 없어진다.
 */
function mergeWithPrevious(previous, { adjusted, defaults, note }) {
  const inherited = !adjusted && previous?.ratioAdjusted ? previous.colors.map((c) => c.ratio) : null;
  const ratio = adjusted ?? inherited ?? defaults;
  return {
    ratio,
    // 기본값 그대로인지 사용자가 손댄 것인지 구분해 둔다. 화면이 "기본값으로" 를 제안할 수 있다.
    ratioAdjusted: JSON.stringify(ratio) !== JSON.stringify(defaults),
    note: note === undefined ? (previous?.note ?? "") : clip(note, LIMITS.noteChars),
  };
}

/**
 * @param lookup (paletteId) => 코퍼스의 팔레트 또는 undefined
 * 색과 비율은 lookup 이 준 것만 쓴다. 요청 본문의 색은 쳐다보지도 않는다.
 */
export function savePalette(input, lookup, ratioFor) {
  const palette = lookup(clip(input.paletteId, 40));
  if (!palette) return Promise.reject(new Error("모르는 조합이다"));

  // 비율만 사용자가 정할 수 있다.
  const adjusted = input.ratio === undefined ? null : normalizeRatio(input.ratio);
  if (input.ratio !== undefined && !adjusted) {
    return Promise.reject(new Error(`면적 비율은 ${RATIO_MIN}~${RATIO_MAX} 의 정수여야 한다`));
  }

  const defaults = ratioFor(palette);

  // **병합 기준을 직렬화 안에서 읽는다.** 앞의 값을 큐 밖에서 읽으면, 겹친 저장 둘이 모두 상대의
  // 쓰기 전 스냅샷을 보고 항목을 만들어 나중에 쓰는 쪽이 앞의 것을 덮는다. `serialize` 가 쓰기를
  // 순서화해도 소용없다 — 무엇을 이어받을지가 이미 낡은 값으로 정해져 있기 때문이다.
  // 실제로 메모가 조용히 사라졌다(S8-G6). 콜백 안은 동기라 읽기와 쓰기 사이에 아무도 못 낀다.
  //
  // 검증은 이 밖에 남긴다. 잘못된 요청이 쓰기 큐에서 자리를 차지해 정상 요청을 늦추지 않게 한다.
  return serialize(() => {
    const all = listSaved();

    // 같은 조합을 다시 저장하는 것은 **덮어쓰기**다. 안 보낸 항목은 앞의 것을 이어받아야
    // 사용자가 명시적으로 넣은 값이 경고 없이 사라지지 않는다. 비율과 메모가 둘 다 그렇다.
    const previous = all.find((s) => s.paletteId === palette.id);

    // 무엇을 이어받을지는 `mergeWithPrevious` 한 곳에 있다 — 두 저장 경로가 갈리지 않게.
    const merged = mergeWithPrevious(previous, { adjusted, defaults, note: input.note });
    const ratio = merged.ratio;
    const entry = {
      id: newId("save"),
      // 요청이 도착한 시각이 아니라 **쓰기가 일어난 시각**이다. 큐가 밀리면 둘이 벌어진다.
      savedAt: now(),
      paletteId: palette.id,
      name: palette.name,
      type: palette.type,
      hueRelation: palette.hueRelation,
      toneRelation: palette.toneRelation,
      summary: palette.summary,
      colors: palette.colors.map((c, i) => ({ name: c.name, hex: c.hex, ratio: ratio[i] })),
      ratioAdjusted: merged.ratioAdjusted,
      defaultRatio: defaults,
      note: merged.note,
      fromQuery: clip(input.fromQuery, LIMITS.queryChars) || null,
    };

    // 같은 조합을 두 번 저장하지 않는다. 다시 저장하면 최신 것으로 갱신한다.
    const rest = all.filter((s) => s.paletteId !== entry.paletteId);
    rest.unshift(entry);
    writeJson("saved.json", rest.slice(0, LIMITS.saved));
    return entry;
  });
}

/**
 * 파생 팔레트를 저장한다. `savePalette` 와 같은 모양이고, 다른 것은 **무엇으로 색을 찾는가**뿐이다.
 *
 * @param {{seedId:string, structureId:string, mode?:string, shares?:number[], note?:string}} input
 * @param {(seedId:string, structureId:string, mode:string) => null | {
 *   colors: {role:string, hex:string}[], name:string, principle:string, source:string, seedLabel:string
 * }} resolve 씨앗·구조·모드로 색을 다시 계산하는 함수. `savePalette` 의 `lookup` 과 같은 자리다 —
 *   저장소가 `src/expand.js` 를 직접 읽지 않게 밖에서 넣는다.
 * @param {(palette:{colors:unknown[]}) => number[]} ratioFor 기본 면적 규칙. `savePalette` 와
 *   같은 자리다 — 면적 규칙은 `public/ratio.js` 한 곳에 있고, 저장소가 그것을 다시 적지 않는다.
 * @param {{finishes: string[], defaultFor: (role:string) => string}} materials 재질 목록과
 *   역할별 기본값. 같은 이유로 밖에서 받는다 — 저장소가 `src/material.js` 를 직접 읽지 않는다.
 *
 * **같은 씨앗·구조·모드는 하나다.** 다시 저장하면 덮어쓰고, 안 보낸 비율·메모는 앞의 것을
 * 이어받는다(`S5-G5`·`S8-G2` 와 같은 규칙). **모드가 다르면 다른 항목**이다 — 색이 다르기 때문이다.
 */
export function saveDerived(input, resolve, ratioFor, materials) {
  /*
   * **문자열인지 먼저 본다.** `clip` 은 `String(value)` 로 강제 변환하므로 배열 하나짜리가
   * 그대로 통과한다 — `String(["complementary"]) === "complementary"` (실측). `S18-G3` 이
   * 그것으로 이 코드를 뚫었다.
   *
   * 17단계에서 리뷰가 `Object.hasOwn` 의 키 강제 변환으로 같은 부류를 찾았다.
   * **강제 변환하는 함수 앞에서는 타입을 먼저 본다** — 이 저장소에서 두 번째다.
   */
  if (typeof input.seedId !== "string" || typeof input.structureId !== "string") {
    return Promise.reject(new Error("씨앗과 구조는 문자열이어야 한다"));
  }
  const seedId = clip(input.seedId, 60);
  const structureId = clip(input.structureId, 60);
  // 모드는 둘뿐이다. 모르는 값을 밝은 모드로 삼키면 사용자가 고른 것과 다른 것이 저장된다.
  const mode = input.mode === undefined ? "light" : input.mode;
  if (mode !== "light" && mode !== "dark") {
    return Promise.reject(new Error("모드는 light 또는 dark 다"));
  }
  if (!seedId || !structureId) return Promise.reject(new Error("씨앗과 구조를 지정해야 한다"));

  const found = resolve(seedId, structureId, mode);
  if (!found) return Promise.reject(new Error("모르는 씨앗이거나 구조다"));

  const count = found.colors.length;
  // `savePalette` 와 같은 자리다 — 면적 규칙은 `public/ratio.js` 한 곳에 있고 밖에서 받는다.
  const defaults = ratioFor({ colors: found.colors });
  const adjusted = input.shares === undefined ? null : normalizeShares(input.shares, count);
  if (input.shares !== undefined && !adjusted) {
    return Promise.reject(new Error(`면적 비율은 ${count}칸 정수 배열이고 합이 100 이어야 한다`));
  }

  // 병합 기준을 직렬화 안에서 읽는다 — savePalette 와 같은 이유다(S8-G6).
  return serialize(() => {
    const all = listSaved();
    const previous = all.find(
      (e) => e.kind === "derived" && e.seedId === seedId && e.structureId === structureId && e.mode === mode,
    );

    // savePalette 와 **같은 규칙**을 쓴다. 규칙이 하나면 두 경로가 갈릴 수 없다.
    const merged = mergeWithPrevious(previous, { adjusted, defaults, note: input.note });
    const ratio = merged.ratio;

    /*
     * **재질 배정.** 화면이 보낸 것에서 쓸 수 있는 것만 남기고, 빈 자리는 앞의 항목 → 기본 배정
     * 순서로 채운다. 비율·메모와 같은 규칙이다(S5-G5·S8-G2·S18-G4).
     *
     * **이어받기 조건까지 비율과 같게 맞춘다.** 비율은 `previous.ratioAdjusted` 가 참일 때만
     * 이어받는다 — 앞의 값이 그때도 "기본값 그대로" 였다면 이어받지 않고 **지금의 기본값을
     * 다시 쓴다.** 그래야 규칙이 나중에 바뀌어도 사용자가 안 건드린 옛 저장이 새 규칙을 따라간다.
     *
     * 배정에는 그 구분이 없어서, 한 번 기본값으로 채워진 자리가 **영구히 굳었다**(리뷰 지적).
     * `DEFAULT_FINISH_BY_ROLE` 을 고쳐도 옛 저장은 새 기본을 못 받는다 — 같은 상황에서 비율은
     * 받는데 배정만 안 받는 비대칭이었다. `finishesAdjusted` 를 두어 규칙을 하나로 만든다.
     *
     * "손댔다" 의 정의는 **지금의 기본과 다른가**다. 화면이 LLM 배정을 보내든 사용자가 고르든
     * 결과가 기본과 같다면 그것은 판단이 아니라 우연히 같은 값이고, 굳혀 둘 이유가 없다.
     */
    const roles = found.colors.map((c) => c.role);
    const sent = pickFinishes(input.finishes, roles, materials.finishes);
    const inheritFinishes = previous?.finishesAdjusted ? previous.finishes : null;
    const finishes = {};
    for (const role of roles) {
      finishes[role] = sent[role] ?? inheritFinishes?.[role] ?? materials.defaultFor(role);
    }
    const finishesAdjusted = roles.some((role) => finishes[role] !== materials.defaultFor(role));

    const entry = {
      id: newId("save"),
      savedAt: now(),
      kind: "derived",
      // 이 셋이 있으면 색을 언제든 다시 계산할 수 있다. 없으면 저장된 헥스가 유일한 진실이 되고,
      // 그때부터 저장소가 엔진과 갈라진다.
      seedId,
      structureId,
      mode,
      seedLabel: found.seedLabel,
      // 코퍼스 항목의 type·hueRelation·summary 자리를 대신한다. 화면이 그릴 것이다.
      name: found.name,
      principle: found.principle,
      source: found.source,
      colors: found.colors.map((c, i) => ({ role: c.role, hex: c.hex, ratio: ratio[i] })),
      // 역할 → 재질 id. 엔진 수치는 여기서 안 만든다 — `applyFinish` 가 결정적이라 내보낼 때
      // 색과 재질로 다시 만들 수 있고, 그래야 엔진 규칙을 고쳤을 때 옛 저장에도 반영된다.
      finishes,
      // 기본 배정 그대로인지 손댄 것인지. `ratioAdjusted` 와 같은 자리·같은 뜻이다.
      finishesAdjusted,
      ratioAdjusted: merged.ratioAdjusted,
      defaultRatio: defaults,
      note: merged.note,
    };

    const rest = all.filter((e) => e !== previous);
    writeJson("saved.json", [entry, ...rest].slice(0, LIMITS.saved));
    return entry;
  });
}

/**
 * 저장된 조합의 면적 비율만 바꾼다. 색은 건드리지 않는다.
 * @param defaultsFor (entry) => [a, b] — 옛 항목에 defaultRatio 가 없을 때 코퍼스에서 채우기 위한 것.
 */
export function updateSavedRatio(id, value, defaultsFor = null) {
  const wanted = clip(id, 60);
  if (!ID_SHAPE.test(wanted)) return Promise.reject(new Error("잘못된 id"));

  /*
   * **개수 검증은 큐 안에서 한다.** 몇 색짜리 항목인지는 저장된 것을 봐야 알 수 있는데,
   * 그 읽기는 직렬화 안에 있어야 겹친 쓰기가 서로를 덮지 않는다(S8-G6 과 같은 이유).
   *
   * 모양 검증만 밖에 남긴다 — 숫자도 정수 배열도 아닌 것은 개수를 몰라도 거를 수 있고,
   * 그런 요청이 쓰기 큐에서 자리를 차지해 정상 요청을 늦추지 않게 한다.
   */
  const looksUsable = Number.isInteger(value) || (Array.isArray(value) && value.every(Number.isInteger));
  if (!looksUsable) return Promise.reject(new Error("면적 비율은 정수 또는 정수 배열이다"));

  return serialize(() => {
    const all = listSaved();
    const entry = all.find((s) => s.id === wanted);
    if (!entry) throw new Error("없는 항목이다");

    const ratio = normalizeShares(value, entry.colors.length);
    if (!ratio) {
      throw new Error(`면적 비율은 ${entry.colors.length}칸 정수 배열이고 합이 100 이어야 한다`);
    }
    // 스테이지5 이전에 저장된 항목에는 defaultRatio 가 없다. 없으면 코퍼스에서 채운다 —
    // 안 채우면 기본값으로 되돌려도 ratioAdjusted 가 영원히 true 로 남는다.
    if (!Array.isArray(entry.defaultRatio) && defaultsFor) {
      const filled = defaultsFor(entry);
      if (Array.isArray(filled)) entry.defaultRatio = filled;
    }
    entry.colors = entry.colors.map((c, i) => ({ ...c, ratio: ratio[i] }));
    entry.ratioAdjusted = Array.isArray(entry.defaultRatio)
      ? JSON.stringify(ratio) !== JSON.stringify(entry.defaultRatio)
      : true;
    writeJson("saved.json", all);
    return entry;
  });
}

/**
 * 저장된 조합의 메모만 바꾼다. 색도 비율도 건드리지 않는다.
 *
 * 빈 값과 공백만 있는 값은 **지우기**다. 저장 경로(`savePalette`)에서 안 보낸 것과 빈 값을
 * 가르는 것과 같은 규칙인데, 여기서는 "안 보냄" 이라는 상태가 없다 — 이 함수를 부르는 것
 * 자체가 메모를 정하겠다는 뜻이라 `undefined` 를 이어받기로 해석할 자리가 없다.
 */
export function updateSavedNote(id, note) {
  const wanted = clip(id, 60);
  if (!ID_SHAPE.test(wanted)) return Promise.reject(new Error("잘못된 id"));
  // 상한 초과는 거부가 아니라 절단이다. 저장 경로와 같은 규칙이어야 사용자가 어느 쪽에서
  // 적었는지에 따라 다르게 동작하지 않는다.
  const next = clip(note, LIMITS.noteChars);

  return serialize(() => {
    const all = listSaved();
    const entry = all.find((s) => s.id === wanted);
    if (!entry) throw new Error("없는 항목이다");
    entry.note = next;
    writeJson("saved.json", all);
    return entry;
  });
}

export function deleteSaved(id) {
  const wanted = clip(id, 60);
  if (!ID_SHAPE.test(wanted)) return Promise.reject(new Error("잘못된 id"));
  return serialize(() => {
    const all = listSaved();
    const rest = all.filter((s) => s.id !== wanted);
    if (rest.length === all.length) throw new Error("없는 항목이다");
    writeJson("saved.json", rest);
    return { deleted: wanted };
  });
}
