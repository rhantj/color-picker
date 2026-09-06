// 진단과 팔레트를 잇는다.
//
// **연결을 지어내지 않는다.** 두 코퍼스는 어휘를 부분적으로만 공유한다 — 진단 18개 중 축이
// 팔레트 관계어(`유사색` `보색` `톤 통일` `절제 안 함` …)를 그대로 쓰는 것은 둘뿐이고
// (`dx-want-calm` `dx-want-punch`), 나머지 16개의 축은 `톤축 (명도)` `면적·순서` `색의 개수`
// 처럼 **진단의 축이지 팔레트의 관계가 아니다.**
//
// 그래서 손으로 쓴 대응표를 만들지 않는다. 어휘를 팔레트 코퍼스에서 읽어 축 문자열과 대조하고,
// 걸리는 것만 잇는다. 코퍼스에 새 관계가 생기면 어휘가 저절로 늘고, 진단의 축 표기가 바뀌면
// 연결이 저절로 끊긴다 — 둘 다 옳은 방향이다.
//
// 버린 대안 둘:
//   - **처방 텍스트로 팔레트를 BM25 검색.** 18개 중 17개가 "확신" 으로 나오지만 믿을 수 없다.
//     `면적·순서` 가 `테라코타 × 회분홍` 을 무는 식으로, 색채 관계가 아니라 흔한 한국어 낱말
//     겹침이 점수를 만든다. 낮은 확신 기준(`wholeMatches > 0`)이 그것을 통과시킨다.
//   - **팔레트 `tags` 와 진단 본문 대조.** 한 글자 태그(`독` `숲`)가 다른 낱말 안에서 걸려
//     18개 중 8개가 잡히는데 대부분 우연이다. 부분 문자열 대조가 원리적으로 깨진다.

/** 긴 것부터 본다 — `보색에 가까움` 이 `보색` 에 먹히면 안 된다. */
const byLengthDesc = (a, b) => b.length - a.length;

/**
 * **비어 있거나 문자열이 아닌 관계값을 어휘에서 걷어낸다.** 코퍼스가 이 필드를 보장하지 않는다 —
 * `loadPalettes` 는 배열의 존재만 보고, S1-G1 도 관계 필드를 안 본다. 걷어내지 않으면 둘이 깨진다.
 *
 *   - 빈 문자열: `"".includes("")` 가 참이라 **모든 축**에 걸린다. 그런데 `!hue` 도 참이라
 *     아래 조기 반환을 지나가면서 색상각 필터만 조용히 무시돼, 관계를 말하지 않는 축에
 *     조합이 붙는다 — 이 모듈이 막으려는 바로 그것이다.
 *   - `null`·누락: 길이 비교에서 던진다. `server.js` 가 최상단에서 부르므로 부팅이 죽는다.
 *
 * 걷어내는 쪽을 골랐다. 던지면 팔레트 하나의 오타가 사이트 전체를 내리고, 그 팔레트는
 * 관계를 말하지 않는 것뿐이라 연결에서 빠지는 것으로 충분하다.
 */
const usableRelation = (v) => typeof v === "string" && v.trim() !== "";

// **다듬은 값을 넣는다.** 다듬은 것으로 검사하고 원본을 넣으면 둘이 갈린다 — `" 유사색"` 은
// 필터를 통과하지만 축 문자열에는 공백 없는 형태만 있어 매치가 조용히 실패한다. 에러도 경고도
// 없이 연결이 하나 사라지고, 원인을 찾기가 매우 어렵다.
const uniqueSorted = (values) =>
  [...new Set(values.filter(usableRelation).map((v) => v.trim()))].sort(byLengthDesc);

/**
 * 팔레트 코퍼스에서 관계 어휘를 읽는다. 상수로 박지 않는 이유는 위 주석에 있다.
 * @returns {{ hues: string[], tones: string[] }} 둘 다 긴 것부터
 */
export function relationVocabulary(palettes) {
  return {
    hues: uniqueSorted(palettes.map((p) => p.hueRelation)),
    tones: uniqueSorted(palettes.map((p) => p.toneRelation)),
  };
}

/**
 * 축 문자열에서 팔레트 관계를 뽑는다. 없으면 null 이다 — **없는 것이 정상이고 흔하다.**
 * @returns {{ hue: string|null, tone: string|null }}
 */
export function relationsInAxis(axis, vocabulary) {
  const text = String(axis ?? "");
  return {
    hue: vocabulary.hues.find((v) => text.includes(v)) ?? null,
    tone: vocabulary.tones.find((v) => text.includes(v)) ?? null,
  };
}

/**
 * 진단 하나에 이어 붙일 팔레트를 고른다.
 *
 * 한쪽 관계만 걸리면 그 한쪽으로만 거른다 — 색상각만 말하는 축이 있을 수 있고, 그때
 * 톤까지 요구하면 아무것도 안 나온다. 둘 다 없으면 **빈 배열이다. 검색으로 때우지 않는다.**
 */
export function palettesForAxis(axis, palettes, vocabulary = relationVocabulary(palettes)) {
  const { hue, tone } = relationsInAxis(axis, vocabulary);
  if (!hue && !tone) return { hue: null, tone: null, matches: [] };

  const matches = palettes.filter(
    (p) => (!hue || p.hueRelation === hue) && (!tone || p.toneRelation === tone),
  );
  return { hue, tone, matches };
}
