// 검색 코퍼스 파일의 자리. 게이트가 저장소의 data/ 를 직접 바꾸지 않고 임시 폴더를 넘길 수 있게
// 환경변수 하나로 연다. store.js 의 TONEFIRST_DATA_DIR 와 같은 모양이다.
//
// 씨앗·구조·재질은 여기 안 둔다 — 그것들은 기동 때 고정이고(기존 결정), 27단계의 범위 밖이다.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/** @param {"palettes.json"|"diagnostics.json"} name */
export const corpusPath = (name) => join(process.env.TONEFIRST_CORPUS_DIR || DEFAULT_DIR, name);
