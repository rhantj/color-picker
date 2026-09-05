// 저장된 조합을 밖으로 가져갈 형식.
//
// 헥스 두 개만 내보내면 이 사이트가 계속 말해온 것을 잃는다 — **면적과 서열**이다.
// "같은 두 헥스도 비율이 바뀌면 다른 색" 이라고 해 놓고 비율 없이 내보내면 앞뒤가 안 맞는다.
// 그래서 색마다 역할(바탕/강조)과 면적을 함께 낸다.
//
// 역할은 저장된 비율에서 계산한다. 코퍼스의 유형(D형 등)이 아니라 **지금 이 항목의 비율**을 본다 —
// 사용자가 대등 조합을 60:40 으로 조정했다면 그때부터 서열이 있는 것이다.

const ROLE = { ground: "ground", accent: "accent", equal: "tone" };

export function rolesOf(colors) {
  const [a, b] = colors.map((c) => c.ratio);
  if (a === b) return [ROLE.equal + "-1", ROLE.equal + "-2"];
  return a > b ? [ROLE.ground, ROLE.accent] : [ROLE.accent, ROLE.ground];
}

const ROLE_KO = { ground: "바탕", accent: "강조", "tone-1": "대등", "tone-2": "대등" };

/**
 * 주석에 넣을 자유 텍스트를 안전하게 만든다.
 *
 * 메모에 주석 닫는 기호(별표+빗금)가 들어가면 주석이 거기서 닫히고 그 뒤가 CSS 선언으로 해석된다.
 * 악의가 없어도 "이 색은 살구 느낌" 을 주석 기호와 함께 적으면 내보낸 파일이 깨진다.
 * 게다가 이 출력의 용도가 **다른 프로젝트의 스타일시트에 붙여넣는 것**이라,
 * 깨진 CSS 가 다른 신뢰 경계로 그대로 옮겨 간다.
 * 줄바꿈과 제어문자도 없앤다 — 주석 블록의 모양이 무너지면 뒤 내용이 밖으로 새기 쉽다.
 */
export const safeComment = (text) =>
  String(text ?? "")
    // 보이지 않는 문자를 끼워 넣지 않는다. 눈에 보이게 바꿔야 사용자가 손질됐다는 것을 안다.
    .replace(/\*\//g, "* /")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

/* ── CSS 변수 ─────────────────────────────────────────────
   변수 이름은 조합 id 로 짓는다. 한글 이름은 CSS 식별자로 쓸 수는 있지만 도구 체인마다
   처리가 달라 안전하지 않다 — 이름은 주석에 남긴다.
   면적도 변수로 낸다. 그래야 폭·크기에 그대로 꽂아 쓸 수 있다. */

export function toCss(entries) {
  if (entries.length === 0) {
    return "/* 저장한 조합이 없습니다. 홈에서 추천을 받고 '조합 저장' 을 누르세요. */\n";
  }

  const blocks = entries.map((entry) => {
    const roles = rolesOf(entry.colors);
    const head = [
      `  /* ${safeComment(entry.name)} · ${entry.type}형 · ${safeComment(entry.hueRelation)} / ${safeComment(entry.toneRelation)}`,
      `     면적 ${entry.colors.map((c) => `${c.ratio}%`).join(" : ")}${entry.ratioAdjusted ? " (직접 조정함)" : ""}`,
      entry.note ? `     메모: ${safeComment(entry.note)}` : null,
      `  */`,
    ].filter(Boolean);

    const vars = entry.colors.flatMap((color, i) => [
      `  --${entry.id_}-${roles[i]}: ${color.hex}; /* ${safeComment(color.name)} · ${ROLE_KO[roles[i]] ?? ""} */`,
      `  --${entry.id_}-${roles[i]}-area: ${color.ratio}%;`,
    ]);

    return [...head, ...vars].join("\n");
  });

  return [
    "/* 톤먼저 — 저장한 색 조합",
    "   면적(-area)이 색의 일부입니다. 같은 두 헥스도 비율이 바뀌면 다른 색이 됩니다.",
    "   출처: 와다 산조 『배색사전』 */",
    "",
    ":root {",
    blocks.join("\n\n"),
    "}",
    "",
  ].join("\n");
}

/* ── JSON ───────────────────────────────────────────────── */

export function toJson(entries) {
  return JSON.stringify(
    {
      generatedBy: "톤먼저 (colorpicker)",
      source: "와다 산조 『배색사전』",
      note: "ratio 는 면적 비율입니다. 같은 두 헥스도 비율이 바뀌면 다른 색이 되므로 함께 씁니다.",
      count: entries.length,
      palettes: entries.map((entry) => {
        const roles = rolesOf(entry.colors);
        return {
          id: entry.paletteId,
          name: entry.name,
          type: entry.type,
          hueRelation: entry.hueRelation,
          toneRelation: entry.toneRelation,
          summary: entry.summary,
          note: entry.note || null,
          ratioAdjusted: Boolean(entry.ratioAdjusted),
          colors: entry.colors.map((c, i) => ({
            name: c.name,
            hex: c.hex,
            ratio: c.ratio,
            role: roles[i],
          })),
        };
      }),
    },
    null,
    2,
  ) + "\n";
}

/** CSS 변수 이름에 쓸 수 있게 id 를 다듬는다. 저장 id 는 이미 안전한 문자만 쓰지만 방어적으로 둔다. */
export const cssName = (entry) => ({ ...entry, id_: String(entry.paletteId).replace(/[^a-zA-Z0-9-]/g, "-") });

export const FORMATS = {
  css: { build: (entries) => toCss(entries.map(cssName)), type: "text/css; charset=utf-8", filename: "tonefirst-palettes.css" },
  json: { build: toJson, type: "application/json; charset=utf-8", filename: "tonefirst-palettes.json" },
};
