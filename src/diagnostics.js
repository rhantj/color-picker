// 진단 코퍼스. 팔레트와 같은 BM25 를 쓰지만 색인은 따로 만든다 —
// 섞으면 "탁해 보여요" 가 팔레트 설명문의 조각과 경쟁하게 되고, 둘 다 흐려진다.

import { readFileSync } from "node:fs";

import { buildIndex, search } from "./bm25.js";
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

// aliases 를 색인에 넣는 것이 이 코퍼스의 핵심이다. 한국어 활용형이 제각각이라
// 표제어("탁하다")만 넣으면 "탁해요" 가 어절 전체로 겹치지 않고, 그러면 저신뢰로 떨어져
// LLM 을 부르게 된다. 실제로 쓰는 말투를 넣어 두면 1단계에서 끝난다.
export const indexText = (d) =>
  [d.symptom, d.aliases.join(" "), d.axis, d.prescription, d.detail].join(" ");

// 임베딩용 문장. 네 변형(증상+별칭 · +상세 · +처방 · 전체)이 10건에서 전부 7/10 로 같았다 [실측].
// 가장 짧고 사용자 말투(별칭)와 처방을 함께 담는 것을 고른다.
export const embedText = (d) => `${d.symptom}. ${d.aliases.join(", ")}. ${d.prescription}`;

export function createDiagnosticSearcher() {
  const diagnostics = loadDiagnostics();
  const index = buildIndex(diagnostics, indexText);
  return {
    diagnostics,
    search: (query, limit = 2) => search(index, query, limit),
  };
}
