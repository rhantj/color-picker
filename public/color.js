// 색 계산. DOM 을 건드리지 않는 순수 함수만 둔다 — 그래야 브라우저 없이 Node 에서 검사할 수 있다.

const channel = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 배경색에 그 색 자체를 태운 어두운 잉크. 검정에 색을 섞으면 바탕색이 더 선명해진다. */
export const burn = (hex, factor) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/* 스와치 위 글자색.
   헥스를 어느 배경에 얹느냐에 따라 읽히기도 하고 안 읽히기도 한다. 고정 색을 쓰면 반드시
   어딘가에서 대비가 무너지므로(1단계 디자인 리뷰에서 실제로 4쌍이 걸렸다) 매번 계산한다.
   1순위는 태운 잉크, 안 되면 흰색, 그것도 안 되면 순검정 — 흰색과 순검정의 조합은
   어떤 배경에서도 최소 4.58 을 보장한다. */
export function labelColor(bg) {
  const candidates = [burn(bg, 0.15), "#ffffff", "#000000"];
  return (
    candidates.find((c) => contrast(c, bg) >= 4.5) ??
    candidates.reduce((best, c) => (contrast(c, bg) > contrast(best, bg) ? c : best))
  );
}

/** 채도 근사값(RGB 최대-최소). 어느 색이 바탕이고 어느 색이 강조인지 가르는 데 쓴다. */
export const chroma = (hex) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(...v) - Math.min(...v);
};
