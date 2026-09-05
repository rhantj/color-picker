// 두 색의 면적 비율. 코퍼스에는 없는 값이다 — 배색사전은 헥스와 인상만 적고 면적은 말하지 않는다.
// 그래서 규칙을 데이터에 흩뿌리지 않고 이 파일 하나에 둔다. 바꾸려면 여기만 고치면 된다.
//
// 왜 면적이 데이터의 일부여야 하는가:
//   같은 두 헥스도 비율이 바뀌면 다른 색이 된다. #CC1236 + #0F1A14 는 22:78 이면 느와르고,
//   78:22 면 경고판이다. 비율 없는 5:5 칩은 색 도구에서 거짓말이 된다.
//
// 규칙 두 줄:
//   1. 대등 조합(A·B·C형)은 50:50. 서열을 만들지 않는 것이 그 조합들의 의도다.
//   2. 서열 조합(D형)은 70:30. 바탕은 채도가 낮은 쪽이 맡는다 —
//      "강조색은 채도 대비로 만든다. 나머지를 탁하게 눌러야 하나가 산다"(color-design).
//
// 채도 규칙을 고른 근거는 실측이다. D형 9쌍에 대해 디자인 초안이 손으로 정한 바탕과 비교했을 때
//   저채도가 바탕 → 8/9,  고명도가 바탕 → 5/9.
// 유일한 반례는 앰버 × 커피브라운으로, 초안은 앰버(고채도)를 바탕으로 뒀다. 어느 쪽도
// 읽어낼 수 있는 조합이라 규칙을 예외로 더럽히지 않고 규칙 쪽을 따른다.

import { chroma } from "./color.js";

const HIERARCHY = 70; // 서열 조합에서 바탕이 차지하는 비율
const EQUAL = 50;

/** @returns {[number, number]} palette.colors 와 같은 순서의 면적 비율 */
export function ratioFor(palette) {
  // 2색이 아닌 조합은 위계를 판정할 근거가 없다. 던지면 화면 전체가 죽으므로 균등 분할로 물러선다.
  // (원전이 3색 이상을 "완전히 다른 게임"이라며 다루지 않아 지금 코퍼스에는 없다. S1-G1 이 강제한다.)
  const colors = palette.colors ?? [];
  if (colors.length !== 2) {
    const share = Math.floor(100 / (colors.length || 1));
    return colors.map((_, i) => (i === 0 ? 100 - share * (colors.length - 1) : share));
  }
  if (palette.type !== "D") return [EQUAL, EQUAL];
  const [a, b] = colors;
  const groundIsFirst = chroma(a.hex) <= chroma(b.hex);
  return groundIsFirst ? [HIERARCHY, 100 - HIERARCHY] : [100 - HIERARCHY, HIERARCHY];
}
