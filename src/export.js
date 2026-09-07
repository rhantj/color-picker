// 저장된 조합을 밖으로 가져갈 형식.
//
// **형식이 다루는 대상이 갈린다.** 코퍼스 조합과 파생 팔레트는 형태가 달라서 한 형식이
// 둘 다 담으려 하면 조용히 망가진다(18-B 에서 실측했다).
//
//   css · json      — 코퍼스 조합만. 파생은 빼고 **뺐다고 말한다**
//   unreal · unity  — 파생 팔레트만. 코퍼스는 빼고 **뺐다고 말한다**
//
// 코퍼스를 엔진 형식에서 빼는 이유는 데이터가 없어서다. 코퍼스 항목에는 재질 배정이 없고
// (LLM 이 배정한 적이 없다), 역할 이름도 `바탕`/`강조`/`대등` 인데 `대등` 은 재질 엔진의
// 역할 표에 없다. 기본 재질을 붙여 내보내면 **배색사전이 한 적 없는 주장을 지어내는 것**이다 —
// 와다 산조의 색 쌍이 빛을 내게 된다.
//
// 헥스 두 개만 내보내면 이 사이트가 계속 말해온 것을 잃는다 — **면적과 서열**이다.
// "같은 두 헥스도 비율이 바뀌면 다른 색" 이라고 해 놓고 비율 없이 내보내면 앞뒤가 안 맞는다.
// 그래서 색마다 역할(바탕/강조)과 면적을 함께 낸다.
//
// 역할은 저장된 비율에서 계산한다. 코퍼스의 유형(D형 등)이 아니라 **지금 이 항목의 비율**을 본다 —
// 사용자가 대등 조합을 60:40 으로 조정했다면 그때부터 서열이 있는 것이다.

import { applyFinish, toUnity, toUnreal } from "./material.js";

const ROLE = { ground: "ground", accent: "accent", equal: "tone" };

/**
 * **내보내기는 코퍼스 조합만 다룬다.** 파생 팔레트(18단계)는 형태가 다르다 —
 * `paletteId` 도 `type`·`색상각` 도 없고 색이 3~4개다.
 *
 * 그대로 내보내면 **조용히 망가진다**(실측):
 *   - `--undefined-ground` — `paletteId` 가 없어 변수 이름이 전부 같아지고 서로 덮어쓴다
 *   - `--undefined-undefined` — `rolesOf` 가 앞 두 색만 보므로 3·4번째 역할이 없다
 *   - `보색대비 · undefined형` — 코퍼스 전용 필드가 주석에 그대로 찍힌다
 *   - 출처를 『배색사전』이라고 적는다 — 파생은 거기서 온 것이 아니다
 *
 * **빼고, 뺐다고 말한다.** 조용히 빼면 사용자는 저장한 것이 다 나왔다고 믿는다.
 * 파생을 제대로 내보내는 것은 별도 작업이다(`docs/com/open-work.md` 의 A2) —
 * 엔진 수치를 어떤 형식으로 줄지가 함께 정해져야 한다.
 */
export const isExportable = (entry) => entry?.kind !== "derived";

const split = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  return { kept: list.filter(isExportable), skipped: list.length - list.filter(isExportable).length };
};

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
export const safeComment = (text) => {
  const cleaned = String(text ?? "")
    // **지우는 단계가 먼저다.** 문자를 지우면 떨어져 있던 별표와 빗금이 새로 붙는다.
    // 이 순서가 뒤집혀 있었고 `별표 + 제어문자 + 빗금` 이 아래 방어를 통과한 뒤, 여기서
    // 제어문자가 지워지며 주석 닫기가 재조립됐다 - 방어가 끝난 자리에서 방어 대상이 다시
    // 만들어졌다. 지우는 것을 먼저 하면 그 뒤로 새로 붙을 것이 없다.
    .replace(/[\u0000-\u001F\u007F]/g, "")
    // 양방향 텍스트 제어문자도 같은 자리에서 지운다. **여기 두는 것이 중요하다** - 이것도
    // 지우는 연산이라 아래로 내리면 `별표 + U+202E + 빗금` 이 방어를 통과한 뒤 주석 닫기가
    // 재조립된다. 위 결함과 같은 형태가 그대로 재발한다.
    //
    // 이 문자들은 CSS 파싱을 깨지 않는다. 대신 **에디터가 보여주는 순서**를 뒤집어, 주석처럼
    // 보이는 자리에 살아 있는 선언을 숨길 수 있다. 이 출력의 용도가 다른 프로젝트에 붙여넣는
    // 것이라 사람이 눈으로 읽고 판단하는 것이 곧 신뢰 근거다.
    .replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g, "")
    // 줄바꿈은 지우지 않고 공백으로 바꾼다. 치환은 인접을 만들지 않아 순서와 무관하다.
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    // 보이지 않는 문자를 끼워 넣지 않는다. 눈에 보이게 바꿔야 사용자가 손질됐다는 것을 안다.
    .replace(/\*\//g, "* /")
    .trim();

  // 순서가 지켜졌는지 코드가 스스로 확인한다. 위 규칙은 "지우는 것을 먼저" 라는 암묵적
  // 불변식에 기대는데, 그것을 지키는 장치가 없으면 다음 사람이 지우는 단계를 하나 끼워
  // 넣는 것만으로 조용히 재발한다. 걸리면 손질이 실패한 것이므로 깨진 CSS 를 안 내보낸다.
  if (cleaned.includes("*" + "/")) {
    throw new Error("safeComment: 손질 뒤에도 주석 닫기가 남았다 - 처리 순서를 확인하라");
  }
  return cleaned;
};

/* ── CSS 변수 ─────────────────────────────────────────────
   변수 이름은 조합 id 로 짓는다. 한글 이름은 CSS 식별자로 쓸 수는 있지만 도구 체인마다
   처리가 달라 안전하지 않다 — 이름은 주석에 남긴다.
   면적도 변수로 낸다. 그래야 폭·크기에 그대로 꽂아 쓸 수 있다. */

export function toCss(entries) {
  const { kept, skipped } = split(entries);
  // 뺐다는 사실을 맨 위에 적는다. 파일을 받은 사람이 "왜 이것만 있지" 를 묻지 않게.
  const skippedNote = skipped
    ? `/* 파생 팔레트 ${skipped}개는 이 형식에 없습니다 — '엔진 수치로 내보내기' 로 받으세요. */\n\n`
    : "";

  if (kept.length === 0) {
    return skipped
      ? `${skippedNote}/* 내보낼 코퍼스 조합이 없습니다. */\n`
      : "/* 저장한 조합이 없습니다. 홈에서 추천을 받고 '조합 저장' 을 누르세요. */\n";
  }

  const blocks = kept.map((entry) => {
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

  return skippedNote + [
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
  const { kept, skipped } = split(entries);
  return JSON.stringify(
    {
      generatedBy: "톤먼저 (colorpicker)",
      source: "와다 산조 『배색사전』",
      note: "ratio 는 면적 비율입니다. 같은 두 헥스도 비율이 바뀌면 다른 색이 되므로 함께 씁니다.",
      count: kept.length,
      // 뺀 것이 있으면 숫자로 말한다. 0 일 때도 필드를 둬서 "이 형식은 파생을 다룬다" 로
      // 오해할 자리를 없앤다. 파생은 엔진 형식(unreal·unity)으로 나간다.
      skippedDerived: skipped,
      skippedDerivedHint: "파생 팔레트는 unreal · unity 형식으로 내보내세요.",
      palettes: kept.map((entry) => {
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

/* ── 엔진 수치 ───────────────────────────────────────────────

   **엔진마다 파일을 나눈다. 한 파일에 둘을 같이 넣지 않는다.**

   막으려는 것은 하나다 — 언리얼 `Roughness` 는 **0이 거울**이고 유니티 `Smoothness` 는
   **1이 거울**로 정확히 반대다. 한 파일에 둘 다 있으면 잘못된 쪽을 복사하기 쉽고,
   그러면 거울로 만들려던 면이 무광이 된다. 눈에 띄는 에러 없이 장면만 달라진다.

   나눠도 파일을 열었을 때 어느 쪽인지 몰라야 소용없으므로 **파일이 자기 엔진을 밝힌다**
   (`engine` 필드 + `note` 한 줄). 그리고 필드 이름이 겹치지 않는다 — 유니티 프로젝트에
   `roughness` 를 넣으면 그 칸이 비어 **사람이 알아챈다.** 조용히 반대가 되는 것보다 낫다.
   (`docs/com/open-work.md` 의 C4 가 이것으로 닫힌다.) */

const ENGINE_SPEC = {
  unreal: {
    id: "unreal",
    label: "언리얼 엔진",
    convert: toUnreal,
    filename: "tonefirst-unreal.json",
    note:
      "언리얼 표기입니다. roughness 는 0이 거울, 1이 완전 무광입니다. " +
      "유니티의 Smoothness 는 방향이 반대(1이 거울)이므로 이 값을 그대로 넣으면 안 됩니다 — " +
      "유니티용은 따로 내보내세요.",
  },
  unity: {
    id: "unity",
    label: "유니티",
    convert: toUnity,
    filename: "tonefirst-unity.json",
    note:
      "유니티 표기입니다. smoothness 는 1이 거울, 0이 완전 무광입니다. " +
      "언리얼의 Roughness 는 방향이 반대(0이 거울)이므로 이 값을 그대로 넣으면 안 됩니다 — " +
      "언리얼용은 따로 내보내세요.",
  },
};

export const ENGINE_IDS = Object.freeze(Object.keys(ENGINE_SPEC));
export const isEngineFormat = (format) => typeof format === "string" && Object.hasOwn(ENGINE_SPEC, format);

/**
 * 파생 팔레트 하나를 엔진 수치로 바꾼다. **못 바꾸면 `null` 을 돌려준다.**
 *
 * `applyFinish` 는 모르는 재질·역할에 던진다(16단계 계약). 그 계약은 옳지만, 여기서 그대로
 * 위로 올리면 **손상된 항목 하나가 내보내기 전체를 500 으로 만든다** — 사용자는 멀쩡한
 * 저장까지 못 가져간다. 18-B 에서 `/saved` 화면이 정확히 그 이유로 목록을 통째로 비웠고
 * 리뷰가 High 로 잡았다. 같은 부류를 여기서 되풀이하지 않는다.
 *
 * **던지지 않는 것과 조용히 넘어가는 것은 다르다.** 못 낸 수는 `skippedBroken` 으로 말한다.
 */
function enginePalette(entry, spec) {
  const finishes = entry.finishes ?? {};
  const colors = [];
  for (const color of entry.colors ?? []) {
    let material;
    try {
      material = applyFinish(color.hex, finishes[color.role], color.role);
    } catch {
      return null; // 색 하나라도 못 만들면 팔레트가 반쪽이 된다 — 반쪽을 내보내지 않는다
    }
    const { baseColor, ...rest } = spec.convert(material);
    colors.push({ role: color.role, ratio: color.ratio, finish: material.finish, baseColor, ...rest });
  }
  if (colors.length === 0) return null;

  return {
    id: `${entry.seedId}-${entry.structureId}-${entry.mode}`,
    name: entry.name,
    seed: entry.seedLabel,
    structure: entry.structureId,
    mode: entry.mode,
    principle: entry.principle,
    note: entry.note || null,
    ratioAdjusted: Boolean(entry.ratioAdjusted),
    finishesAdjusted: Boolean(entry.finishesAdjusted),
    colors,
  };
}

/**
 * 엔진 형식 하나를 만든다.
 *
 * 코퍼스는 세어서 `skippedCorpus` 로, 못 바꾼 파생은 `skippedBroken` 으로 말한다.
 * **둘 다 0 일 때도 필드를 둔다** — 없으면 "이 형식은 코퍼스도 담는다" 로 오해할 자리가 생긴다.
 */
export function toEngine(entries, engineId) {
  const spec = ENGINE_SPEC[engineId];
  if (!spec) throw new Error(`모르는 엔진이다: ${engineId}`);

  const list = Array.isArray(entries) ? entries : [];
  const derived = list.filter((e) => !isExportable(e));
  const built = derived.map((e) => enginePalette(e, spec));
  const palettes = built.filter(Boolean);

  return JSON.stringify(
    {
      generatedBy: "톤먼저 (colorpicker)",
      engine: spec.id,
      engineLabel: spec.label,
      note: spec.note,
      areaNote:
        "ratio 는 면적 비율입니다. 같은 색도 면적이 바뀌면 다른 배색이 되므로 함께 씁니다.",
      count: palettes.length,
      // 코퍼스 조합은 재질 배정이 없어 엔진 수치를 만들 수 없습니다.
      skippedCorpus: list.length - derived.length,
      // 재질이나 역할이 이 엔진이 모르는 값이라 못 만든 항목.
      skippedBroken: built.length - palettes.length,
      palettes,
    },
    null,
    2,
  ) + "\n";
}

/** CSS 변수 이름에 쓸 수 있게 id 를 다듬는다. 저장 id 는 이미 안전한 문자만 쓰지만 방어적으로 둔다. */
export const cssName = (entry) => ({ ...entry, id_: String(entry.paletteId).replace(/[^a-zA-Z0-9-]/g, "-") });

const JSON_TYPE = "application/json; charset=utf-8";

export const FORMATS = {
  css: { build: (entries) => toCss(entries.map(cssName)), type: "text/css; charset=utf-8", filename: "tonefirst-palettes.css" },
  json: { build: toJson, type: JSON_TYPE, filename: "tonefirst-palettes.json" },
  // 엔진 형식은 표를 그대로 편다 — 엔진을 더할 때 여기와 ENGINE_SPEC 을 따로 고치지 않게.
  ...Object.fromEntries(
    ENGINE_IDS.map((id) => [
      id,
      { build: (entries) => toEngine(entries, id), type: JSON_TYPE, filename: ENGINE_SPEC[id].filename },
    ]),
  ),
};
