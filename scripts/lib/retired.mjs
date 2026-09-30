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

const script = basename(process.argv[1] ?? "");
const id = process.argv[2];
const reason = RETIRED[script]?.[id];
if (reason) {
  process.stdout.write(Buffer.from(`${id.replace(/-/g, "_")}_RETIRED — ${reason}\n`, "utf8"));
  process.exit(0);
}
