// 입력 한 줄을 네 경로로 가른다. **LLM 없이, 어휘표만으로.** 39단계.
//
// 왜 결정적인가: 같은 입력이 같은 경로로 가야 게이트가 표로 검사할 수 있다(S39-G1·G2). 판정에 모델을 쓰면
// 헥스 하나 넣어도 모델을 부르고 답이 매번 달라진다.
// 왜 되묻는가: 겹침(캐릭터×진단)을 규칙표로 하나 고르면 경계 사례를 계속 더해야 한다. 판정은 규칙이 하고
// 해소는 사용자가 한다(설계 문서 "버린 대안").
//
// **순수 함수다.** 파일·네트워크·시간·난수를 안 쓴다 — S39-G2 가 본문에서 그 낱말을 찾는다.

import { parseColorInput } from "./from-color.js";

export const ROUTES = Object.freeze(["palette", "diagnosis", "character", "color"]);
export const ROUTE_LABEL = Object.freeze({ palette: "추천", diagnosis: "진단", character: "캐릭터", color: "색" });

/** 바로잡기 낱말. 문장 앞이나 끝에 오고 어절이 셋 이하일 때만 바로잡기다 — "빨강 어울리는 색으로 가자" 는 아니다. */
const REDIRECT = Object.freeze({ 색으로: "color", 캐릭터로: "character", 진단으로: "diagnosis", 추천으로: "palette" });
const REDIRECT_MAX_WORDS = 3;

const words = (text) => text.split(/\s+/).filter(Boolean);

/** 어절 하나가 별칭에 걸리는가. 활용형("요란해")이 표제("요란")로 시작하면 걸린다. 띄어쓴 별칭("물 빠진")은 문장 포함으로 본다. */
function diagnosisHits(text, tokens, diagnostics) {
  const hits = [];
  for (const d of diagnostics) {
    for (const alias of d.aliases ?? []) {
      const hit = alias.includes(" ") ? text.includes(alias) : tokens.some((t) => t.startsWith(alias));
      if (hit) {
        hits.push(d.id);
        break;
      }
    }
  }
  return hits;
}

/** 표면형 목록 중 문장에 든 것. 긴 형태부터 본다 — "머리카락" 이 "머리" 에 먼저 먹히지 않게. */
function surfaceHits(text, forms) {
  return [...forms].sort((a, b) => b.length - a.length).filter((f) => text.includes(f));
}

export function createRouter({ words: table, diagnostics, corpus, creatures = [] }) {
  const partForms = Object.values(table.parts ?? {}).flat();
  const colorForms = Object.values(table.colorWords ?? {}).flat();
  const compoundForms = Object.keys(table.compounds ?? {});
  const creatureForms = creatures.flatMap((c) => c.words ?? []);

  function route(raw) {
    const text = String(raw ?? "").trim();
    const tokens = words(text);

    // 1. 바로잡기
    if (tokens.length > 0 && tokens.length <= REDIRECT_MAX_WORDS) {
      const first = REDIRECT[tokens[0]];
      const last = REDIRECT[tokens.at(-1)];
      if (first || last) return { kind: "redirect", route: first ?? last };
    }

    // 2. 입력 전체가 색 하나 — 다른 신호와 겹칠 수 없다
    const color = parseColorInput(text, corpus);
    if (color) return { kind: "route", routes: ["color"], unclear: false, signals: { color: color.hex, parts: [], colorWords: [], compounds: [], creatures: [], diagnosis: [], partsOnly: false } };

    // 3. 캐릭터 신호
    const parts = surfaceHits(text, partForms);
    const colorWords = surfaceHits(text, colorForms);
    const compounds = surfaceHits(text, compoundForms);
    const creatureHits = surfaceHits(text, creatureForms);
    // 부위 낱말을 걷어내면 아무것도 안 남는가 — "머리" 처럼 부위만 말한 것
    const stripped = parts.reduce((acc, f) => acc.replaceAll(f, ""), text).replace(/\s+/g, "");
    const partsOnly = parts.length > 0 && colorWords.length === 0 && compounds.length === 0 && stripped.length === 0;
    const strong = compounds.length > 0 || (parts.length > 0 && (colorWords.length > 0 || creatureHits.length > 0)) || new Set(parts).size >= 2;
    const weak = parts.length > 0 && !strong && !partsOnly;

    // 4. 진단 신호
    const diagnosis = diagnosisHits(text, tokens, diagnostics);

    const signals = { color: null, parts, colorWords, compounds, creatures: creatureHits, diagnosis, partsOnly };

    if (partsOnly) return { kind: "route", routes: ["character"], unclear: "character", signals };
    const routes = [];
    if (strong || weak) routes.push("character");
    if (diagnosis.length > 0) routes.push("diagnosis");
    // 약한 캐릭터 신호 하나만 있으면("눈에 띄는 색") 캐릭터가 아니라 추천이다
    if (routes.length === 1 && routes[0] === "character" && weak) return { kind: "route", routes: ["palette"], unclear: false, signals };
    if (routes.length === 0) routes.push("palette");
    return { kind: "route", routes, unclear: false, signals };
  }

  return { route };
}
