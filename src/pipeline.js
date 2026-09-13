// 질의 해소 파이프라인. 문서(docs/com/rag-is-simpler-than-you-think.md)의 단계 승급을 구현한다.
//
//   1단계: 전문 검색만. BM25 가 확신하고 **임베딩도 같은 답이면** 여기서 끝난다 — LLM 을 아예 부르지 않는다.
//   3단계: BM25 가 저신뢰이거나 임베딩과 어긋나면, BM25 순위와 코사인 순위를 결합(RRF)해 다시 고른다.
//          LLM 을 안 부르고 수십 ms 다. 그래서 2단계보다 **먼저** 돈다.
//   2단계: 3단계도 저신뢰일 때만 LLM 한 번. 의도를 가르고 검색어를 다시 쓴 뒤 다시 3단계로 고른다.
//   4단계: 코퍼스 파일이 바뀌면 요청 때 알아채고 그 자리에서 다시 읽는다(27단계). 임베딩은 바뀐 문서만.
//
// 실행 순서는 1→3→2 이고 번호는 문서의 비용 사다리를 따른다. 응답의 stage 는 **가장 높이 쓴 칸**이다.
// 26단계 실측: 코퍼스 어휘와 안 겹치는 질의 18건 중 9건을 1단계가 흔한 어절 하나로 확신해 틀렸다.
// 그래서 확신에 "임베딩이 동의하는가" 를 덧붙였다. 설계: docs/superpowers/specs/2026-09-13-hybrid-search-design.md
//
// 코퍼스가 둘이라 1단계에서 둘 다 찾는다. 팔레트가 걸리면 팔레트, 아니면 진단.
// 순서를 고정한 이유는 "탁하지 않은 따뜻한 색" 처럼 증상 어휘가 섞인 탐색 질의가 있기 때문이다 —
// 그런 질의는 팔레트를 찾는 것이므로 팔레트를 먼저 본다.

import { statSync } from "node:fs";

import { CorpusError, createSearcher } from "./palettes.js";
import { createDiagnosticSearcher } from "./diagnostics.js";
import { rewrite } from "./rewrite.js";
import { buildVocabulary, expandTerms } from "./vocabulary.js";
import { indexText as paletteText, embedText as paletteEmbedText } from "./palettes.js";
import { indexText as diagnosticText, embedText as diagnosticEmbedText } from "./diagnostics.js";
import { embedQuery, similarities, status as embedStatus, prepare as prepareEmbeddings, EMBED_MODEL } from "./embed.js";
import { agrees, decide, fuse } from "./hybrid.js";
import { relationVocabulary } from "./bridge.js";
import { corpusPath } from "./corpus-paths.js";

const isConfident = (hits) => hits.length > 0 && hits[0].wholeMatches > 0;
const ms = (start) => Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2));

/** 확신 경로의 임베딩 예산. 넘기면 BM25 답을 그대로 쓴다 — S3-G8 의 "1초 미만" 안에 들어야 하므로 1초보다 짧다. [실측] 따뜻할 때 45ms, 튐 2.2초 */
const FAST_BUDGET_MS = 700;

/** 코퍼스 파일 시각 확인 간격(27단계). 안에서는 statSync 도 안 한다. */
const CORPUS_CHECK_TTL_MS = 2000;

/** 두 파일의 지문. mtime 만 보면 같은 초 안의 두 저장을 놓칠 수 있어 size 도 본다. */
function fingerprint() {
  return ["palettes.json", "diagnostics.json"]
    .map((name) => {
      const st = statSync(corpusPath(name));
      return `${name}:${st.mtimeMs}:${st.size}`;
    })
    .join("|");
}

/** 코퍼스를 읽어 검색에 필요한 것을 전부 만든다. 던진다 — 호출부가 옛 것을 지킬지 정한다. */
function build() {
  const palettes = createSearcher();
  const diagnostics = createDiagnosticSearcher();
  return {
    palettes,
    diagnostics,
    // 재작성어의 붙여쓰기를 되돌리는 데 쓴다. 두 코퍼스의 어절을 모두 담는다.
    vocabulary: buildVocabulary([...palettes.palettes.map(paletteText), ...diagnostics.diagnostics.map(diagnosticText)]),
    byId: new Map([
      ...palettes.palettes.map((p) => [p.id, { doc: p, kind: "palette" }]),
      ...diagnostics.diagnostics.map((d) => [d.id, { doc: d, kind: "diagnosis" }]),
    ]),
    embedDocs: [
      ...palettes.palettes.map((p) => ({ id: p.id, kind: "palette", text: paletteEmbedText(p) })),
      ...diagnostics.diagnostics.map((d) => ({ id: d.id, kind: "diagnosis", text: diagnosticEmbedText(d) })),
    ],
    relationVocab: relationVocabulary(palettes.palettes),
  };
}

export function createPipeline() {
  let state = build(); // 기동 때는 던진다 — 코퍼스 없이 뜨지 않는다(1단계 계약, server.js 가 잡아 exit 1)
  let seen = fingerprint();
  let version = 1;
  let checkedAt = Date.now();
  let reloadedAt = null;
  let corpusError = null;

  return {
    // **살아 있는 참조.** 재적재 뒤에도 호출부가 새 코퍼스를 보게 getter 로 둔다.
    get palettes() {
      return state.palettes.palettes;
    },
    get diagnostics() {
      return state.diagnostics.diagnostics;
    },
    get vocabulary() {
      return state.vocabulary;
    },
    /** 서버가 기동 때 embed.prepare() 에 넘긴다. */
    get embedDocs() {
      return state.embedDocs;
    },
    get relationVocab() {
      return state.relationVocab;
    },

    corpusStatus: () => ({
      version,
      palettes: state.palettes.palettes.length,
      diagnostics: state.diagnostics.diagnostics.length,
      checkedAt,
      reloadedAt,
      error: corpusError,
    }),

    /**
     * 파일이 바뀌었으면 그 자리에서 다시 읽는다(27단계). 던지지 않는다 — 깨진 파일이면 옛 코퍼스를 지키고
     * 사유만 남긴다. 편집 도중 저장된 반쪽 파일로 서비스가 죽으면 안 된다.
     * @returns {boolean} 재적재했는가
     */
    reloadIfChanged() {
      if (Date.now() - checkedAt < CORPUS_CHECK_TTL_MS) return false;
      checkedAt = Date.now();
      let now;
      try {
        now = fingerprint();
      } catch (err) {
        corpusError = `코퍼스 파일을 볼 수 없다: ${err.message}`;
        return false;
      }
      if (now === seen) return false;
      try {
        state = build();
        seen = now;
        version += 1;
        reloadedAt = Date.now();
        corpusError = null;
        // 기다리지 않는다. 끝날 때까지 similarities 는 옛 벡터를 낸다 — resolve 가 모르는 id 를 버린다.
        prepareEmbeddings(state.embedDocs);
        return true;
      } catch (err) {
        corpusError = err instanceof CorpusError ? err.message : String(err.message ?? err);
        seen = now; // 같은 깨진 파일을 매번 다시 읽지 않는다. 고쳐지면 지문이 바뀐다
        return false;
      }
    },

    /**
     * @returns 항상 결과 객체. 던지지 않는다.
     *   route: "palette" | "diagnosis" | "none"
     *   stage: 1 (전문 검색만) | 3 (임베딩 결합까지) | 2 (LLM 재작성까지, 임베딩 없이) — 가장 높이 쓴 칸
     *   hybrid: {model, cosine, elapsedMs} | null — 3단계가 답을 정했을 때만
     *   hybridError: string | null — 임베딩을 못 썼을 때의 사유 (경계는 서버가 적용)
     *   usedLlm: boolean
     */
    async resolve(query, limit = 3, { allowRewrite = true } = {}) {
      const started = process.hrtime.bigint();
      const { palettes, diagnostics, vocabulary, byId } = state; // 이 요청 동안은 한 코퍼스만 본다

      const paletteHits = palettes.search(query, limit);
      const diagnosticHits = diagnostics.search(query, 2);
      const paletteOk = isConfident(paletteHits);
      const diagnosisOk = isConfident(diagnosticHits);

      // 1단계 후보 — 둘 다 걸리면 어절 전체로 겹친 항이 **더 많은** 쪽을 택한다.
      // 이게 없으면 팔레트가 "잘"·"안" 같은 일반어 하나로 이겨서, 근거가 5개인 진단을 밀어낸다(실측).
      // 동점이면 팔레트 — "탁하지 않은 따뜻한 색" 처럼 증상 어휘가 섞인 탐색 질의를 진단으로 보내지 않기 위해서다.
      let stage1 = null;
      if (paletteOk || diagnosisOk) {
        const paletteWhole = paletteHits[0]?.wholeMatches ?? 0;
        const diagnosisWhole = diagnosticHits[0]?.wholeMatches ?? 0;
        const takeDiagnosis = diagnosisOk && (!paletteOk || diagnosisWhole > paletteWhole);
        stage1 = takeDiagnosis
          ? { route: "diagnosis", top: diagnosticHits[0].doc.id, paletteHits: [], diagnosticHits }
          : { route: "palette", top: paletteHits[0].doc.id, paletteHits, diagnosticHits: [] };
      }

      // 임베딩 — 확신 후보가 있으면 짧은 예산, 없으면 긴 예산. 준비 안 됐으면 바로 사유만 남는다.
      const q =
        embedStatus().state === "ready"
          ? await embedQuery(query, stage1 ? { timeoutMs: FAST_BUDGET_MS } : {})
          : { vector: null, error: `임베딩을 쓸 수 없다 (${embedStatus().detail})`, elapsedMs: 0 };
      // 재적재 직후 재임베딩이 끝나기 전엔 옛 코퍼스의 벡터가 온다. 지금 코퍼스에 없는 id 는 버린다(S27-G5).
      const sims = similarities(q.vector).filter((s) => byId.has(s.id));
      const hybridError = q.error;

      // 1단계 — 확신 후보가 있고, 임베딩이 없거나(사유는 남긴다) 동의하면 지금까지와 같다.
      if (stage1 && (sims.length === 0 || agrees({ id: stage1.top }, sims))) {
        return {
          stage: 1,
          route: stage1.route,
          confident: true,
          paletteHits: stage1.paletteHits,
          diagnosticHits: stage1.diagnosticHits,
          searchMs: ms(started),
          hybrid: null,
          hybridError,
          usedLlm: false,
        };
      }

      const searchMs = ms(started);
      // 팔레트의 약한 증거는 응답에 담으면서 진단의 약한 증거만 버리면 비대칭이다.
      // 둘 다 담고, 무엇을 보여줄지는 route 로 화면이 판단한다.
      const base = { stage: 1, route: "none", confident: false, paletteHits, diagnosticHits, searchMs, hybrid: null, hybridError, usedLlm: false };

      // 3단계 — 결합 재순위. 임베딩이 없으면 여기를 못 하고 바로 2단계로 간다.
      const rerank = (pHits, dHits) => {
        const bm25 = [
          ...pHits.map((h) => ({ id: h.doc.id, kind: "palette" })),
          ...dHits.map((h) => ({ id: h.doc.id, kind: "diagnosis" })),
        ];
        const fused = fuse(bm25, sims).filter((f) => byId.has(f.id));
        const verdict = decide(fused);
        const pick = (kind, n) =>
          fused
            .filter((f) => f.kind === kind)
            .slice(0, n)
            .map((f) => ({ doc: byId.get(f.id).doc, score: f.rrf, matched: [], wholeMatches: 0, cosine: f.cosine }));
        return {
          route: verdict.route,
          confident: verdict.confident,
          paletteHits: verdict.route === "diagnosis" ? [] : pick("palette", limit),
          diagnosticHits: verdict.route === "diagnosis" ? pick("diagnosis", 2) : [],
          hybrid: verdict.top
            ? { model: EMBED_MODEL, cosine: Number(verdict.top.cosine.toFixed(3)), elapsedMs: q.elapsedMs }
            : null,
        };
      };

      let first = null; // 재작성 전 결합 결과. 재작성이 실패하면 이것을 그대로 돌려준다(두 번 계산하지 않는다)
      if (sims.length > 0) {
        first = rerank(paletteHits, diagnosticHits);
        if (first.confident || !allowRewrite) return { ...base, ...first, stage: 3, searchMs: ms(started) };
      } else if (!allowRewrite) {
        return base;
      }

      // 2단계 — 그래도 저신뢰일 때만 LLM 을 부른다. 재작성어로 BM25 를 다시 돌리고, 임베딩은 원 질의 벡터를 그대로 쓴다.
      const rw = await rewrite(query);
      if (rw.error) {
        if (!first) return { ...base, rewriteError: rw.error };
        return { ...base, ...first, confident: false, stage: 3, rewriteError: rw.error };
      }

      // 붙여 쓴 말을 코퍼스 어휘로 되돌린다(vocabulary.js). 검색어가 비면(의도만 건진 경우)
      // 원 질의로 검색한다 — 라우팅만이라도 살린다.
      const rewritten = expandTerms(rw.terms, vocabulary) || query;
      const after = process.hrtime.bigint();

      if (rw.intent === "other") {
        // 결합이 답을 정하지 않았으므로 3단계가 아니다 — 임베딩 벡터를 구했어도 결정에 안 썼다(리뷰 지적).
        return { ...base, stage: 2, route: "none", confident: false, paletteHits: [], diagnosticHits: [], rewrite: rw, usedLlm: true };
      }

      // 증상 표현은 원문에 있고 재작성어는 축·처방 쪽 어휘를 가져온다. 진단은 둘 다 넣는다.
      const pHits2 = rw.intent === "diagnosis" ? [] : palettes.search(rewritten, limit);
      const dHits2 = rw.intent === "diagnosis" ? diagnostics.search(`${query} ${rewritten}`, 2) : [];

      if (sims.length > 0) {
        const h = rerank(pHits2, dHits2);
        // 재작성이 의도를 갈랐으면 그 코퍼스만 본다 — 결합이 반대 코퍼스를 1위로 올려도 의도를 이기지 못한다.
        const wantKind = rw.intent === "diagnosis" ? "diagnosis" : "palette";
        const stuck = h.route !== "none" && h.route !== wantKind;
        return {
          ...base,
          ...h,
          stage: 3,
          rewrite: rw,
          usedLlm: true,
          route: stuck ? "none" : h.route,
          confident: stuck ? false : h.confident,
          searchMs: searchMs + ms(after),
        };
      }

      // 임베딩 없이 재작성만 — 지금까지의 2단계 그대로.
      if (rw.intent === "diagnosis") {
        return {
          ...base, stage: 2, route: dHits2.length ? "diagnosis" : "none", confident: isConfident(dHits2),
          paletteHits: [], diagnosticHits: dHits2, rewrite: rw, usedLlm: true, searchMs: searchMs + ms(after),
        };
      }
      return {
        ...base, stage: 2, route: pHits2.length ? "palette" : "none", confident: isConfident(pHits2),
        paletteHits: pHits2, diagnosticHits: [], rewrite: rw, usedLlm: true, searchMs: searchMs + ms(after),
      };
    },
  };
}
