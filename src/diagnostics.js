// 진단 코퍼스(18건) 적재. 44단계에서 BM25 색인을 뺐다 — 진단은 라우터의 별칭 대조와 Claude 의 목록 고르기로 찾는다.

import { readFileSync } from "node:fs";

import { CorpusError } from "./palettes.js";
import { corpusPath } from "./corpus-paths.js";

const CORPUS_PATH = corpusPath("diagnostics.json");

export function loadDiagnostics() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
  } catch (cause) {
    throw new CorpusError("진단 코퍼스를 읽지 못했다 (data/diagnostics.json)", { cause });
  }
  if (!Array.isArray(parsed.diagnostics) || parsed.diagnostics.length === 0) {
    throw new CorpusError("진단 코퍼스에 diagnostics 배열이 없다 (data/diagnostics.json)");
  }
  return parsed.diagnostics;
}
