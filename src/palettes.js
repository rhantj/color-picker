// 배색 코퍼스(16쌍) 적재. 44단계에서 검색(BM25 · 임베딩)을 걷어내며 색인 텍스트와 검색기를 뺐다 — 남은 쓰임은 색 경로의 짝 ·
// 캐릭터 배색 쌍 · 진단의 연결 조합 · 씨앗.

import { readFileSync } from "node:fs";
import { corpusPath } from "./corpus-paths.js";

const CORPUS_PATH = corpusPath("palettes.json");

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
