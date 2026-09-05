// 질의 해소 파이프라인. 문서(docs/com/rag-is-simpler-than-you-think.md)의 단계 승급을 그대로 구현한다.
//
//   1단계: 전문 검색만. 걸리면 여기서 끝난다 — LLM 을 아예 부르지 않는다.
//   2단계: 저신뢰일 때만 LLM 한 번. 의도를 가르고 검색어를 다시 쓴다.
//
// 코퍼스가 둘이라 1단계에서 둘 다 찾는다. 팔레트가 걸리면 팔레트, 아니면 진단.
// 순서를 고정한 이유는 "탁하지 않은 따뜻한 색" 처럼 증상 어휘가 섞인 탐색 질의가 있기 때문이다 —
// 그런 질의는 팔레트를 찾는 것이므로 팔레트를 먼저 본다.

import { createSearcher } from "./palettes.js";
import { createDiagnosticSearcher } from "./diagnostics.js";
import { rewrite } from "./rewrite.js";
import { buildVocabulary, expandTerms } from "./vocabulary.js";
import { indexText as paletteText } from "./palettes.js";
import { indexText as diagnosticText } from "./diagnostics.js";

const isConfident = (hits) => hits.length > 0 && hits[0].wholeMatches > 0;
const ms = (start) => Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2));

export function createPipeline() {
  const palettes = createSearcher();
  const diagnostics = createDiagnosticSearcher();

  // 재작성어의 붙여쓰기를 되돌리는 데 쓴다. 두 코퍼스의 어절을 모두 담는다.
  const vocabulary = buildVocabulary([
    ...palettes.palettes.map(paletteText),
    ...diagnostics.diagnostics.map(diagnosticText),
  ]);

  return {
    palettes: palettes.palettes,
    diagnostics: diagnostics.diagnostics,
    vocabulary,

    /**
     * @returns 항상 결과 객체. 던지지 않는다.
     *   route: "palette" | "diagnosis" | "none"
     *   stage: 1 (전문 검색만) | 2 (질의 재작성까지)
     */
    async resolve(query, limit = 3, { allowRewrite = true } = {}) {
      const started = process.hrtime.bigint();

      const paletteHits = palettes.search(query, limit);
      const diagnosticHits = diagnostics.search(query, 2);
      const paletteOk = isConfident(paletteHits);
      const diagnosisOk = isConfident(diagnosticHits);

      if (paletteOk || diagnosisOk) {
        // 둘 다 걸리면 어절 전체로 겹친 항이 **더 많은** 쪽을 택한다.
        // 이게 없으면 팔레트가 "잘"·"안" 같은 일반어 하나로 이겨서, 근거가 5개인 진단을 밀어낸다(실측).
        // 동점이면 팔레트 — "탁하지 않은 따뜻한 색" 처럼 증상 어휘가 섞인 탐색 질의를
        // 진단으로 보내지 않기 위해서다.
        const paletteWhole = paletteHits[0]?.wholeMatches ?? 0;
        const diagnosisWhole = diagnosticHits[0]?.wholeMatches ?? 0;
        const takeDiagnosis = diagnosisOk && (!paletteOk || diagnosisWhole > paletteWhole);

        return takeDiagnosis
          ? { stage: 1, route: "diagnosis", confident: true, paletteHits: [], diagnosticHits, searchMs: ms(started) }
          : { stage: 1, route: "palette", confident: true, paletteHits, diagnosticHits: [], searchMs: ms(started) };
      }

      const searchMs = ms(started);
      // 팔레트의 약한 증거는 응답에 담으면서 진단의 약한 증거만 버리면 비대칭이다.
      // 둘 다 담고, 무엇을 보여줄지는 route 로 화면이 판단한다.
      const base = { stage: 1, route: "none", confident: false, paletteHits, diagnosticHits, searchMs };
      if (!allowRewrite) return base;

      // 여기까지 왔다는 것은 전문 검색이 못 잡았다는 뜻이다. 이제서야 LLM 을 부른다.
      const rw = await rewrite(query);
      if (rw.error) return { ...base, rewriteError: rw.error };

      // 붙여 쓴 말을 코퍼스 어휘로 되돌린다(vocabulary.js). 검색어가 비면(의도만 건진 경우)
      // 원 질의로 검색한다 — 라우팅만이라도 살린다.
      const rewritten = expandTerms(rw.terms, vocabulary) || query;
      const after = process.hrtime.bigint();

      if (rw.intent === "diagnosis") {
        // 증상 표현은 원문에 있고 재작성어는 축·처방 쪽 어휘를 가져온다. 둘 다 넣는다.
        const hits = diagnostics.search(`${query} ${rewritten}`, 2);
        return {
          stage: 2, route: hits.length ? "diagnosis" : "none", confident: isConfident(hits),
          paletteHits: [], diagnosticHits: hits, rewrite: rw, searchMs: searchMs + ms(after),
        };
      }

      if (rw.intent === "other") {
        return { stage: 2, route: "none", confident: false, paletteHits: [], diagnosticHits: [], rewrite: rw, searchMs };
      }

      const hits = palettes.search(rewritten, limit);
      return {
        stage: 2, route: hits.length ? "palette" : "none", confident: isConfident(hits),
        paletteHits: hits, diagnosticHits: [], rewrite: rw, searchMs: searchMs + ms(after),
      };
    },
  };
}
