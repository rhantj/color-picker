// 41단계로 은퇴한 게이트 — 실행하면 `S*_G*_RETIRED` 와 이유를 찍고 성공(0)으로 끝난다.
//
// 지우지 않고 은퇴시키는 이유: 회귀 게이트(S25-G4 · S40-G9 등)가 번호로 다른 게이트를 돌린다. 지우면 그 목록이
// 전부 깨지고, 무엇이 왜 빠졌는지도 사라진다. 여기 이유를 남기고 GATES.md 에도 같은 이유를 적는다.
// 회귀 게이트는 `_OK` 또는 `_RETIRED` 를 통과로 센다.
//
// 은퇴 사유는 둘뿐이다.
//   ① Ollama 자체의 동작 — 프로세스 띄우기 · 모델 GPU 적재 · keep_alive · 워밍업. Ollama 가 코드에서 빠졌다.
//   ② 진짜 bge-m3 로 잰 정답률 — 모델이 Voyage 로 바뀌었다. 기준값을 Voyage 로 다시 잴 때 새 측정 게이트로 대체한다
//      (docs/superpowers/specs/2026-09-29-claude-voyage-api-design.md §3). 게이트가 돌 때마다 유료 API 를 부르면 안 되므로
//      그 측정은 게이트가 아니라 측정 스크립트로 둔다.

import { basename } from "node:path";

const OLLAMA = "① Ollama 자체의 동작을 쟀다 — 41단계에서 Ollama 가 코드에서 빠졌다";
const LIVE = "② 진짜 bge-m3 로 쟀다 — 41단계에서 임베딩이 Voyage 로 바뀌었다. Voyage 기준값 측정이 대체한다";

export const RETIRED = Object.freeze({
  "check-stage3.mjs": {
    "S3-G2": `${OLLAMA} (죽어 있으면 띄운다)`,
    "S3-G3": `${OLLAMA} (떠 있으면 새로 안 띄운다)`,
    "S3-G4": `${OLLAMA} (동시 기동 공유)`,
    "S3-G5": `${OLLAMA} (입력이 spawn 에 안 닿는다 — src/ 에 spawn 자체가 없어졌다. S41-G1 이 그것을 잰다)`,
    "S3-G6": `${OLLAMA} (죽으면 상태가 따라간다)`,
    "S3-G7": "진짜 LLM 이 진단 질의를 진단으로 보내는지 쟀다 — 41단계부터 그건 유료 호출이다. 라우팅의 결정적 부분은 S3-G8·S39 가 본다",
    "S3-G10": `${OLLAMA} (기동 뒤 모델 워밍업)`,
  },
  "check-stage25.mjs": {
    "S25-G1": `${OLLAMA} (죽은 Ollama 의 사유 문구)`,
    "S25-G2": `${OLLAMA} (기동 실패 사유가 TTL 뒤에도 남는다)`,
    "S25-G5": `${OLLAMA} (자동 기동함 사유 보존)`,
  },
  "check-stage26.mjs": {
    "S26-G1": `${LIVE} (23건 정답률)`,
    "S26-G2": `${LIVE} (정확 매칭 5건 — 진짜 임베딩이 동의하는지)`,
  },
  "check-stage28.mjs": { "S28-G1": `${LIVE} (23건 정답 14 이상)` },
  "check-stage29.mjs": { "S29-G3": `${LIVE} (23건 정답 16 이상)` },
  "check-stage30.mjs": {
    "S30-G1": `${OLLAMA} (keep_alive)`,
    "S30-G2": `${OLLAMA} (모델 만료 시각)`,
    "S30-G3": `${OLLAMA} (콜드 재적재 지연)`,
  },
  "check-stage40.mjs": {
    "S40-G1": `${OLLAMA} (기동 임베딩 워밍업)`,
    "S40-G6": `${LIVE} (인사·잡담 튀어나옴 · 23건 정답 21)`,
  },
});

const script = basename(process.argv[1] ?? "");
const id = process.argv[2];
const reason = RETIRED[script]?.[id];
if (reason) {
  process.stdout.write(Buffer.from(`${id.replace(/-/g, "_")}_RETIRED — ${reason}\n`, "utf8"));
  process.exit(0);
}
