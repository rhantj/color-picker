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
//      면적 비율만 예외인 이유: 색은 코퍼스가 아는 사실이지만 **비율은 사용자의 판단**이다.
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

    // 비율을 안 보냈는데 그때 맞춰 둔 조정이 있으면 이어받는다.
    // 규칙의 기본값으로 되돌리면 저장 화면에서 명시적으로 한 조정이 사라진다.
    const inherited = !adjusted && previous?.ratioAdjusted ? previous.colors.map((c) => c.ratio) : null;

    const ratio = adjusted ?? inherited ?? defaults;
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
      // 기본값 그대로인지 사용자가 손댄 것인지 구분해 둔다. 화면이 "기본값으로" 를 제안할 수 있다.
      ratioAdjusted: JSON.stringify(ratio) !== JSON.stringify(defaults),
      defaultRatio: defaults,
      // 안 보냈으면 앞의 메모를 잇고, 보냈으면 그것을 쓴다. **빈 문자열은 "지우기" 라서 잇지 않는다** —
      // 이어받기가 무조건이면 사용자가 메모를 지울 방법이 없어진다.
      note: input.note === undefined ? (previous?.note ?? "") : clip(input.note, LIMITS.noteChars),
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
 * 저장된 조합의 면적 비율만 바꾼다. 색은 건드리지 않는다.
 * @param defaultsFor (entry) => [a, b] — 옛 항목에 defaultRatio 가 없을 때 코퍼스에서 채우기 위한 것.
 */
export function updateSavedRatio(id, value, defaultsFor = null) {
  const wanted = clip(id, 60);
  if (!ID_SHAPE.test(wanted)) return Promise.reject(new Error("잘못된 id"));
  const ratio = normalizeRatio(value);
  if (!ratio) return Promise.reject(new Error(`면적 비율은 ${RATIO_MIN}~${RATIO_MAX} 의 정수여야 한다`));

  return serialize(() => {
    const all = listSaved();
    const entry = all.find((s) => s.id === wanted);
    if (!entry) throw new Error("없는 항목이다");
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
