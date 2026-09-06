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

/** 한 색이 가질 수 있는 최소 지분. `src/store.js` 의 RATIO_MIN 과 같은 값이어야 한다. */
export const MIN_SHARE = 10;

/**
 * 색이 n 개일 때 한 색이 가질 수 있는 지분의 범위.
 *
 * **하한이 색 개수와 동시에 성립하지 않는 구간이 있다.** MIN_SHARE × n 이 100 을 넘으면
 * "합 100" 과 "각자 10 이상" 을 동시에 만족할 수 없다 — n=11 에서 합이 110 이 나왔다(실측).
 * 지금 파생 구조는 3~4색뿐이라 닿지 않지만, 이건 화면과 서버가 함께 쓰는 계산이고
 * 다음 단계(다색 저장)에서 색이 늘면 조용히 깨진다. 그래서 **하한을 개수에 맞춰 낮춘다** —
 * 합이 100 이라는 계약이 먼저이고, 최소 지분은 그것을 해치지 않는 선에서만 지킨다.
 *
 * `shareControl` 의 슬라이더도 이 값을 쓴다. 두 곳이 각자 계산하면 사용자가 움직인 값을
 * 계산이 거부하는 일이 생긴다 — S5-G4 가 2색에서 같은 이유로 같은 규칙을 건다.
 *
 * @returns {{min: number, max: number}}
 */
export function shareBounds(n) {
  const count = Number.isInteger(n) && n > 0 ? n : 1;
  const min = Math.min(MIN_SHARE, Math.floor(100 / count));
  return { min, max: 100 - min * (count - 1) };
}

/**
 * 균등 분할. 정수만 쓰고 **합이 정확히 100** 이 되게 나머지를 앞에서부터 하나씩 나눠 준다.
 *
 * `Math.round(100/3)` 을 세 번 하면 99 나 102 가 된다. 합이 100 이 아니면 스와치 바에 틈이
 * 생기거나 마지막 색이 잘려, 화면이 말하는 비율과 보이는 비율이 달라진다.
 */
export function equalShares(n) {
  if (!Number.isInteger(n) || n < 1) return [];
  const base = Math.floor(100 / n);
  const rest = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * 슬라이더 하나를 옮겼을 때의 새 비율. **합은 언제나 100 이고 어느 색도 MIN_SHARE 아래로 안 간다.**
 *
 * 나머지 색들이 델타를 **현재 지분에 비례해서** 흡수한다. 균등하게 빼면 이미 좁은 색이 먼저
 * 바닥을 치고, 그때부터 넓은 색만 움직여 슬라이더가 제멋대로 굴게 된다.
 *
 * @param {number[]} shares 현재 비율 (합 100)
 * @param {number} index 움직인 색
 * @param {number} next 그 색의 새 지분
 * @returns {number[]} 같은 길이, 합 100
 */
export function redistribute(shares, index, next) {
  const n = Array.isArray(shares) ? shares.length : 0;
  if (n < 2 || !Number.isInteger(index) || index < 0 || index >= n) return Array.isArray(shares) ? shares.slice() : [];

  // 나머지가 각자 최소 지분을 지키려면 이 색이 가질 수 있는 몫에 천장이 있다.
  // n=2 면 10~90 으로 기존 2색 규칙과 같아진다. 색이 아주 많으면 하한이 함께 내려간다(shareBounds).
  const { min: floor, max: ceiling } = shareBounds(n);
  const target = Math.max(floor, Math.min(ceiling, Math.round(Number(next) || 0)));

  const others = shares.map((_, i) => i).filter((i) => i !== index);
  const pool = 100 - target;
  const currentSum = others.reduce((sum, i) => sum + (Number(shares[i]) || 0), 0);

  const out = shares.map((v) => Number(v) || 0);
  out[index] = target;

  // 현재 합이 0 이면 비례 배분이 성립하지 않는다(0으로 나눈다). 그때만 균등하게 나눈다.
  for (const i of others) {
    const share = currentSum > 0 ? ((Number(shares[i]) || 0) / currentSum) * pool : pool / others.length;
    out[i] = Math.max(floor, Math.floor(share));
  }

  // 내림과 최소 지분 때문에 생긴 차이를 **넓은 쪽부터 1씩** 맞춘다. 마지막 색에 몰아넣으면
  // 사용자가 건드리지도 않은 색 하나가 크게 튄다. 움직인 색(index)은 건드리지 않는다.
  let diff = 100 - out.reduce((a, b) => a + b, 0);
  const order = others.slice().sort((a, b) => out[b] - out[a]);
  let guard = order.length * 200; // 전부 바닥에 닿아 더 뺄 수 없으면 무한 루프가 된다
  while (diff !== 0 && guard > 0) {
    let moved = false;
    for (const i of order) {
      if (diff === 0) break;
      if (diff > 0) {
        out[i] += 1;
        diff -= 1;
        moved = true;
      } else if (out[i] > floor) {
        out[i] -= 1;
        diff += 1;
        moved = true;
      }
    }
    if (!moved) break;
    guard -= 1;
  }
  return out;
}

/** @returns {number[]} palette.colors 와 같은 순서의 면적 비율 */
export function ratioFor(palette) {
  // **3색 이상은 균등 분할이다.** 코퍼스 2색에는 실측으로 정한 규칙이 있지만(아래), 3색 이상에는
  // 원전도 실측도 없다. 규칙을 지어내는 대신 균등으로 두고 사용자가 슬라이더로 옮겨 확인한다.
  // 파생 팔레트(src/expand.js)가 3~4색이라 이 경로가 실제로 쓰인다 — 물러서는 자리가 아니다.
  const colors = palette.colors ?? [];
  if (colors.length !== 2) return equalShares(colors.length);
  if (palette.type !== "D") return [EQUAL, EQUAL];
  const [a, b] = colors;
  const groundIsFirst = chroma(a.hex) <= chroma(b.hex);
  return groundIsFirst ? [HIERARCHY, 100 - HIERARCHY] : [100 - HIERARCHY, HIERARCHY];
}
