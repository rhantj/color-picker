// 41단계로 은퇴한 게이트 — 실행하면 `S*_G*_RETIRED` 와 이유를 찍고 성공(0)으로 끝난다.
//
// 지우지 않고 은퇴시키는 이유: 회귀 게이트(S25-G4 · S40-G9 등)가 번호로 다른 게이트를 돌린다. 지우면 그 목록이
// 전부 깨지고, 무엇이 왜 빠졌는지도 사라진다. 여기 이유를 남기고 GATES.md 에도 같은 이유를 적는다.
// 회귀 게이트는 `_OK` 또는 `_RETIRED` 를 통과로 센다.
//
// 41단계는 처음에 임베딩까지 Voyage 로 옮겨 19개를 은퇴시켰다가, 대표 결정(2026-09-30)으로 임베딩을 로컬 Ollama(bge-m3)로
// 되돌리며 17개를 살렸다. 남은 둘은 **LLM 이 Claude API 로 바뀐** 탓이다 — 그 부분은 되돌리지 않았다.

import { basename } from "node:path";

export const RETIRED = Object.freeze({
  "check-stage3.mjs": {
    "S3-G7": "진짜 LLM 이 진단 질의를 진단으로 보내는지 쟀다 — 41단계부터 LLM 은 Claude API 라 게이트가 돌 때마다 돈이 든다. 라우팅의 결정적 부분은 S3-G8·S39 가 본다",
    "S3-G10": "LLM 워밍업을 쟀다 — 41단계부터 LLM 은 Claude API 라 GPU 에 올려 둘 모델이 없다(임베딩 워밍업은 S40-G1 이 본다)",
  },
});

/*
 * 44단계로 은퇴한 게이트 — BM25 검증 실험을 끝내고(대표 결정 2026-10-02) 검색 장치(BM25 · 로컬 Ollama 임베딩 · 질의 재작성 ·
 * `/api/search`)와 홈의 검색 결과 카드 · 펼치기를 걷어냈다. 지킬 대상이 없어진 게이트들이다. 남은 보장은 S44 게이트가 다시 쓴다.
 * S41-G9 는 위 `RETIRED`(41단계)만 보고, 이쪽은 S44-G10 이 본다.
 */
const SEARCH = "검색 장치(BM25 · 임베딩 · 재작성 · /api/search)를 걷어냈다";
const CARD = "홈의 검색 결과 카드 · '배색 구조로 펼치기' 를 걷어냈다(추천은 문장 팔레트 3안이다)";
export const RETIRED_44 = Object.freeze({
  "check-stage1.mjs": {
    "S1-G2": `${SEARCH} — 대표 질의 5건의 BM25 1위를 쟀다`,
    "S1-G3": `${SEARCH} — BM25 저신뢰 판정을 쟀다`,
  },
  "check-stage2.mjs": {
    "S2-G2": `${SEARCH} — /api/search 응답 모양을 쟀다`,
    "S2-G3": `${SEARCH} — /api/search 가 면적을 안 내는지 쟀다(면적 규칙은 S13 · S42-G4 가 본다)`,
    "S2-G4": `${SEARCH} — /api/search 입력 검증을 쟀다`,
  },
  "check-stage3.mjs": {
    "S3-G1": `${SEARCH} — Ollama 가 없을 때 검색이 도는지 쟀다`,
    "S3-G2": `${SEARCH} — Ollama 자동 기동을 쟀다(서버가 더는 Ollama 를 안 띄운다 — S44-G1)`,
    "S3-G3": `${SEARCH} — Ollama 기동 실패 처리를 쟀다`,
    "S3-G4": `${SEARCH} — 우리가 띄운 Ollama 정리를 쟀다`,
    "S3-G5": `${SEARCH} — 상태 확인이 Ollama 를 안 띄우는지 쟀다`,
    "S3-G6": `${SEARCH} — Ollama 수명주기를 쟀다`,
    "S3-G8": `${SEARCH} — 검색 단계(1·2단계) 라우팅을 쟀다(진단 · 팔레트 가르기는 S44-G3 · S42-G10 이 본다)`,
    "S3-G9": `${SEARCH} — 재작성어의 붙여쓰기 복원(vocabulary)을 쟀다`,
  },
  "check-stage5.mjs": { "S5-G4": `${CARD} — 홈 카드의 비율 조정을 쟀다(저장 목록의 비율은 S5 나머지 · S18 이 본다)` },
  "check-stage8.mjs": { "S8-G4": `${CARD} — 홈 카드의 저장 메모 입력을 쟀다(메모 편집은 S9 가 본다)` },
  "check-stage12.mjs": { "S12-G2": `${SEARCH} — 씨앗이 검색 색인에 안 들어가는지 쟀다(색인이 없다)` },
  "check-stage13.mjs": { "S13-G7": `${CARD} — 홈이 /api/expand 로 파생 팔레트를 그리는지 쟀다` },
  "check-stage14.mjs": { "S14-G7": `${CARD} — 펼치기가 고른 다섯을 먼저 그리는지 쟀다` },
  "check-stage15.mjs": {
    "S15-G13": `${CARD} — 펼치기의 모드 선택자를 쟀다`,
    "S15-G15": `${CARD} — 펼치기 모드 토글의 포커스를 쟀다`,
  },
  "check-stage17.mjs": { "S17-G12": `${CARD} — 펼치기 카드의 재질 표시를 쟀다` },
  "check-stage18.mjs": { "S18-G9": `${CARD} — 펼치기 카드의 저장 버튼을 쟀다(색 경로 · 문장 팔레트 저장은 S36 · S42-G11 이 본다)` },
  "check-stage19.mjs": { "S19-G5": `${CARD} — 펼치기 저장이 재질을 싣는지 쟀다` },
  "check-stage21.mjs": { "S21-G5": `${CARD} — 펼치기 저장이 고친 재질을 싣는지 쟀다` },
  "check-stage23.mjs": {
    "S23-G4": `${CARD} — 펼치기가 저장된 모드로 시작하는지 쟀다`,
    "S23-G5": `${CARD} — 펼치기 조회에 mode 가 안 붙는지 쟀다`,
  },
  "check-stage25.mjs": {
    "S25-G1": `${SEARCH} — Ollama 상태 사유를 쟀다`,
    "S25-G2": `${SEARCH} — Ollama 기동 실패 사유 보존을 쟀다`,
    "S25-G3": `${SEARCH} — /api/search 를 포함한 세 경로의 폭 0 문자 질의를 쟀다(채팅 · 구조 · 재질 경로는 S44-G8 이 본다)`,
    "S25-G4": `${SEARCH} — 3단계(Ollama) 게이트 회귀를 쟀다(그 게이트가 전부 은퇴했다)`,
    "S25-G5": `${SEARCH} — 우리가 띄운 Ollama 의 사유 보존을 쟀다`,
  },
  "check-stage26.mjs": {
    "S26-G1": `${SEARCH} — 결합 검색(BM25 + bge-m3) 정확도를 쟀다`,
    "S26-G2": `${SEARCH} — BM25 정확 매칭 회귀를 쟀다`,
    "S26-G3": `${SEARCH} — 임베딩이 없을 때 상태를 쟀다`,
    "S26-G4": `${SEARCH} — 확신 검색이 느린 임베딩에 안 끌리는지 쟀다`,
    "S26-G5": `${SEARCH} — hybrid.js 결합 판정을 쟀다`,
    "S26-G6": `${SEARCH} — hybridError 원문 경계를 쟀다`,
  },
  "check-stage27.mjs": {
    "S27-G1": `${SEARCH} — 코퍼스를 고치면 다음 검색이 새 내용을 잡는지 쟀다(재적재는 S44-G6 이 채팅 · 상태로 본다)`,
    "S27-G2": `${SEARCH} — 바뀐 문서만 다시 임베딩되는지 쟀다`,
    "S27-G3": `${SEARCH} — 임베딩 캐시를 쟀다`,
    "S27-G4": `${SEARCH} — 깨진 코퍼스에서 옛 것으로 검색하는지 쟀다(S44-G6 이 채팅 · 상태로 본다)`,
    "S27-G5": `${SEARCH} — 옛 벡터 창의 지운 문서를 쟀다`,
    "S27-G6": `${SEARCH} — 임베딩 캐시 파일 손상을 쟀다`,
    "S27-G7": `${SEARCH} — /api/status 의 stage 4 를 쟀다(상태 경계는 S44-G6 이 본다)`,
  },
  "check-stage28.mjs": {
    "S28-G1": `${SEARCH} — 실제 bge-m3 결합 정확도를 쟀다`,
    "S28-G2": `${SEARCH} — fuse 의 BM25 가중치를 쟀다`,
    "S28-G3": `${SEARCH} — 26단계 게이트 회귀를 쟀다(그 게이트가 은퇴했다)`,
    "S28-G4": `${SEARCH} — 옛 벡터 창의 BM25 답을 쟀다`,
  },
  "check-stage29.mjs": {
    "S29-G1": `${SEARCH} — 별칭이 BM25 1단계에서 확신되는지 쟀다(별칭 진단은 S44-G3 이 라우터로 본다)`,
    "S29-G3": `${SEARCH} — 실제 bge-m3 정답 수를 쟀다`,
  },
  "check-stage30.mjs": {
    "S30-G1": `${SEARCH} — 임베딩 요청의 keep_alive 를 쟀다`,
    "S30-G2": `${SEARCH} — 실제 Ollama 의 모델 만료 시각을 쟀다`,
    "S30-G3": `${SEARCH} — 콜드 재적재 지연을 쟀다`,
    "S30-G4": `${SEARCH} — 26단계 게이트 회귀를 쟀다(그 게이트가 은퇴했다)`,
  },
  "check-stage33.mjs": { "S33-G2": `${SEARCH} — /api/search 진단 결과의 "축" 낱말을 쟀다(채팅 진단 답은 S44-G3 이 본다)` },
  "check-stage34.mjs": { "S34-G7": `${SEARCH} — 캐릭터 배색 쌍이 검색 1위인지 쟀다(파서가 목록에서 고르는 것은 S44-G4 가 본다)` },
  "check-stage40.mjs": {
    "S40-G1": `${SEARCH} — 기동 때 임베딩 워밍업을 쟀다`,
    "S40-G2": `${SEARCH} — 짧은 임베딩 예산이 요청을 안 끊는지 쟀다`,
    "S40-G3": `${SEARCH} — 어절 하나 BM25 확신이 임베딩을 기다리는지 쟀다`,
    "S40-G4": `${SEARCH} — 임베딩 런 기록(embed)을 쟀다`,
    "S40-G5": `${SEARCH} — hybrid.js 의 튀어나옴 판정을 쟀다`,
    "S40-G6": `${SEARCH} — 실제 bge-m3 에서 잡담이 확신 안 되는지 쟀다`,
  },
  "check-stage41.mjs": {
    "S41-G1": `${SEARCH} — 네 호출부가 Ollama 를 안 부르고 임베딩만 /api/embed 로 가는지 쟀다(Ollama 가 어디에도 없는 것은 S44-G1 이 본다)`,
    "S41-G3": `${SEARCH} — 임베딩이 로컬 bge-m3 로 가는지 쟀다`,
    "S41-G4": `${SEARCH} — 키 없을 때 검색이 도는지 쟀다(키 없는 동작은 S44-G7 이 본다)`,
    "S41-G5": `${SEARCH} — 임베딩 기준값의 모델 일치를 쟀다`,
  },
});

const script = basename(process.argv[1] ?? "");
const id = process.argv[2];
const reason = RETIRED[script]?.[id] ?? RETIRED_44[script]?.[id];
if (reason) {
  process.stdout.write(Buffer.from(`${id.replace(/-/g, "_")}_RETIRED — ${reason}\n`, "utf8"));
  process.exit(0);
}
