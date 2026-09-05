// 코퍼스 적재 + 색인 대상 텍스트 정의.
// "무엇을 색인하는가" 는 검색 품질을 좌우하므로 검색 로직(bm25.js)과 분리해 여기 한 곳에만 둔다.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildIndex, search } from "./bm25.js";

const CORPUS_PATH = fileURLToPath(new URL("../data/palettes.json", import.meta.url));

export class CorpusError extends Error {}

export function loadPalettes() {
  // 2단계에서 서버가 이 함수를 그대로 재사용한다. 날것의 ENOENT·SyntaxError 가 응답으로 새면
  // 내부 파일 경로까지 함께 나가므로, 여기서 잘라 CorpusError 로 바꾼다.
  let raw;
  try {
    raw = readFileSync(CORPUS_PATH, "utf8");
  } catch (cause) {
    throw new CorpusError("팔레트 코퍼스를 읽지 못했다 (data/palettes.json)", { cause });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CorpusError("팔레트 코퍼스가 올바른 JSON 이 아니다 (data/palettes.json)", { cause });
  }

  if (!Array.isArray(parsed.palettes) || parsed.palettes.length === 0) {
    throw new CorpusError("팔레트 코퍼스에 palettes 배열이 없다 (data/palettes.json)");
  }
  return parsed.palettes;
}

const TYPE_LABEL = {
  A: "A형 대등 보색 톤통일 속삭임",
  B: "B형 대등 보색 강렬 절제안함",
  C: "C형 대등 유사색 톤통일 연결",
  D: "D형 서열 위계 비대칭 명쾌함",
};

// 색인 텍스트. 이름·원명·헥스까지 넣는 이유는 사용자가 "#F3A257 비슷한 거" 나
// "Golden Yellow" 로도 물어볼 수 있기 때문이다 — 전문 검색이 도메인 용어에 강한 지점이다.
export function indexText(p) {
  return [
    p.name,
    ...p.colors.map((c) => `${c.name} ${c.origName} ${c.hex}`),
    TYPE_LABEL[p.type] ?? p.type,
    p.hueRelation,
    p.toneRelation,
    p.summary,
    p.impression,
    p.tags.join(" "),
  ].join(" ");
}

export function createSearcher() {
  const palettes = loadPalettes();
  const index = buildIndex(palettes, indexText);
  return {
    palettes,
    search: (query, limit) => search(index, query, limit),
  };
}
