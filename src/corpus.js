// 코퍼스(배색 16쌍 · 진단 18건)를 들고, 파일이 바뀌면 요청 때 다시 읽는다(27단계 동작 · 44단계에서 검색 파이프라인 밖으로 옮김).
//
// 44단계에서 검색 장치(BM25 · 임베딩 · 재작성)를 걷어냈다. 남은 일은 셋이다 — 코퍼스를 들고 있기, 바뀌면 다시 읽기, 깨진 파일이면
// 옛 것을 지키고 사유만 남기기. 검색 색인도 벡터도 없다.

import { statSync } from "node:fs";

import { CorpusError, loadPalettes } from "./palettes.js";
import { loadDiagnostics } from "./diagnostics.js";
import { relationVocabulary } from "./bridge.js";
import { corpusPath } from "./corpus-paths.js";

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

/** 던진다 — 호출부가 옛 것을 지킬지 정한다. */
function build() {
  const palettes = loadPalettes();
  const diagnostics = loadDiagnostics();
  return { palettes, diagnostics, relationVocab: relationVocabulary(palettes) };
}

export function createCorpus() {
  let state = build(); // 기동 때는 던진다 — 코퍼스 없이 뜨지 않는다(server.js 가 잡아 exit 1)
  let seen = fingerprint();
  let version = 1;
  let checkedAt = Date.now();
  let reloadedAt = null;
  let corpusError = null;

  return {
    // **살아 있는 참조.** 재적재 뒤에도 호출부가 새 코퍼스를 보게 getter 로 둔다.
    get palettes() {
      return state.palettes;
    },
    get diagnostics() {
      return state.diagnostics;
    },
    get relationVocab() {
      return state.relationVocab;
    },

    corpusStatus: () => ({
      version,
      palettes: state.palettes.length,
      diagnostics: state.diagnostics.length,
      checkedAt,
      reloadedAt,
      error: corpusError,
    }),

    /**
     * 파일이 바뀌었으면 그 자리에서 다시 읽는다. 던지지 않는다 — 깨진 파일이면 옛 코퍼스를 지키고 사유만 남긴다.
     * 편집 도중 저장된 반쪽 파일로 서비스가 죽으면 안 된다.
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
        return true;
      } catch (err) {
        corpusError = err instanceof CorpusError ? err.message : String(err.message ?? err);
        seen = now; // 같은 깨진 파일을 매번 다시 읽지 않는다. 고쳐지면 지문이 바뀐다
        return false;
      }
    },
  };
}
