# 41단계 — LLM 을 Claude API 로 · 임베딩은 로컬 bge-m3 그대로 (2026-09-29 ~ 30)

> **2026-10-01 main 에 ff 머지 · 푸시(`1dc4cac..6cf022d`) → Vercel 자동 배포**(대표 지시 "41단계 진행하고 푸시해서 배포").
> 09-30 에 잠시 멈췄던 배포를 다시 열었다.
> 설계: `docs/superpowers/specs/2026-09-29-claude-voyage-api-design.md` — **맨 아래 부록(09-30)이 지금 상태다.**

## 무엇을 했나

**한 줄로:** 검색어 다듬기 · 캐릭터 설명 읽기 · 구조 고르기 · 재질 고르기 네 곳은 이제 Claude Haiku 4.5 가 한다.
문장을 벡터로 바꾸는 임베딩은 **예전처럼 로컬 Ollama bge-m3** 다. Claude 는 크레딧을 다 쓸 때까지 쓴다.

흐름이 두 번 바뀌었다.
1. **09-29** Vercel 배포를 하려다 "Vercel 에는 GPU 가 없어 Ollama 를 못 올린다" → 대화는 Claude, 임베딩은 Voyage 로 둘 다 API 로 옮겼다.
2. **09-30** 실제 키로 확인하니 Claude 는 잘 돌았지만 Voyage 는 무료 한도가 분당 3회 안팎이라 429 가 났다 → 대표님이
   **임베딩은 로컬로 되돌리고 Vercel 은 잠시 멈추자** 고 정했다. 임베딩 코드(`embed.js`·`ollama.js`)는 main 의 것을 그대로 되살렸다.

| 파일 | 무엇을 | 쉽게 말하면 |
|---|---|---|
| `src/llm.js` (새) | Claude 를 부르는 곳 한 군데. 공식 SDK · 구조화 출력(JSON 스키마) · 재시도 1회 · 오류를 종류별로 | 네 호출부가 각자 Ollama 를 부르던 것을 한 곳으로 모았다 |
| `src/rewrite.js` · `describe.js` · `structure.js` · `finish.js` | `chatJson` 으로 부른다 · 각자 스키마 · 기존 파서 그대로 · 타임아웃 70/20초 → 10초 `[판단]` | 모델만 바뀌고 답을 거르는 규칙은 같다 |
| `src/embed.js` · `src/ollama.js` | **main 그대로**(한때 Voyage 로 바꿨다가 되돌림) | 임베딩은 이 PC 의 bge-m3 |
| `src/hybrid.js` · `src/pipeline.js` | `THRESHOLDS_MEASURED_ON = "bge-m3"` — 지금 임베딩 모델과 다르면 임베딩으로는 확신하지 않는다 | 지금은 같아서 원래대로 확신한다. 모델을 또 바꾸면 저절로 막힌다 |
| `src/quota.js` (새) | IP 당 1분 Claude 호출 30회 · 서버당 200회. 넘으면 LLM 없이 물러선다 | 남이 API 비용을 태우는 것을 줄인다(보조 장치) |
| `src/store.js` | `VERCEL` 이면 저장 폴더 `/tmp/tonefirst` | 배포를 다시 열 때 필요 |
| `server.js` | LLM 워밍업 삭제 · Ollama 기동·임베딩 워밍업은 그대로 · `/api/status` 에 `llm` 추가(`ollama`·`embed` 는 그대로) · `VERCEL` 이면 루프백 아님 · 요청마다 IP 를 흘림 | 첫 배포에서 샌 내부 상세를 막았다 |
| `public/ui.js` · HTML 3개 | 상단 필이 "Claude API 준비됨" · 기본 문구 "확인 중" · 제목에 임베딩 상태 | "로컬 · Ollama" 라는 거짓 문구 제거 |
| `package.json` · `package-lock.json` (새) | 의존성 `@anthropic-ai/sdk` 하나 · `"type": "module"` | 의존성 0개가 깨졌다(대표 결정) — `npm install` 필요 |
| `scripts/lib/ollama-shim.mjs` (새) | 옛 게이트의 가짜 Ollama `/api/chat` 을 Claude API 로 보이게 번역 · 게이트 프로세스에서 **Claude 키를 비움** | 옛 게이트를 다시 짜지 않고 살렸다 · 게이트가 유료 호출을 못 한다 |
| `scripts/lib/retired.mjs` (새) | 은퇴 게이트 2개(S3-G7 진짜 LLM 호출 · S3-G10 LLM 워밍업) | 지우지 않고 이유를 남겼다 |
| `scripts/lib/stub-apis.mjs` (새) · `scripts/check-stage41.mjs` (새) | 가짜 Claude(요청 본문 기록) · S41-G1~G9 | 서버가 실제로 무엇을 보내는지 본다 |
| 옛 게이트 | 전부 첫 줄에 번역기 import · S1-G4(의존성 SDK 하나) · S17(프로세스 안 가짜 교체 · 사유 문구) · S40-G1(LLM 워밍업 대신 "Ollama 에 LLM 요청 0") · 회귀 게이트가 `_RETIRED` 도 통과로 | |

## 왜 그렇게 했나 (버린 대안 포함)

- **LLM 을 왜 API 로.** Vercel 배포를 위해서였다(GPU 없음). 대안 — A. 집 PC Ollama 를 터널로 · B. GPU 클라우드 — 를 거쳐 대표님이
  API 로 정했다. Haiku 4.5 는 짧은 JSON 이라 가장 빠르고 싼 것으로 충분하다는 판단. SDK 는 재시도·오류 구분 때문(대가: 의존성 0 깨짐).
- **임베딩을 왜 되돌렸나.** Voyage 무료 한도(분당 3회 안팎, 429 `[실측]`)로는 검색마다 필요한 질의 임베딩을 못 댄다. 게다가
  Voyage 점수 분포가 달라(1위 코사인 0.293 vs bge-m3 문턱 0.44 `[실측]`) 기준값을 전부 다시 재야 했다. 로컬로 되돌리면 둘 다 사라진다.
  버린 대안: Voyage 결제 등록 + 재측정 / 임베딩 없이 Claude 만(3단계 결합과 23건 중 21 정확도를 잃는다).
- **왜 번역기인가.** 가짜 Ollama 를 쓰는 게이트가 여럿이다. 각자 가짜 Claude 로 다시 짜면 게이트가 재던 뜻이 바뀔 위험이 크다.
- **왜 안전장치(`THRESHOLDS_MEASURED_ON`)를 남겼나.** 임베딩을 되돌려 지금은 쓸모가 없어 보이지만, 모델을 또 바꾸는 순간 안 잰
  숫자로 틀린 확신을 내는 것을 저절로 막는다. S41-G5 가 본다.

## 지금 상태

**동작하는 것** `[실측 2026-09-30]`
- 로컬(`.env` 에 `ANTHROPIC_API_KEY`): `stage 4` · LLM `claude-haiku-4-5` ready · Ollama 자동 기동 · bge-m3 34건 · 임베딩 워밍업 42ms.
- 검색: "아침에 빵 굽는 냄새가 나는 카페" → 3단계 확신 pair-09(105ms) · "너무 병원 같아요" → dx-clinical(55ms) · "안녕" → 확신 안 함,
  Claude 재작성 후 2단계(1.8초) · "비 오는 날 오래된 서점 느낌" → Claude 재작성 + 결합 확신 pair-01(1.4초).
- 실제 Claude 로 네 호출부 전부 `from: llm`(09-30, 임베딩이 Voyage 이던 때 확인 — LLM 쪽은 그 뒤 안 바뀌었다).
- 게이트: 아래 "게이트 실행 결과".

**안 되는 것 / 모르는 것**
- **배포판(main · Vercel)은 아직 40단계 그대로다.** 첫 배포에서 본 내부 상세 노출(`docs/troubleshootings/2026-09-29-vercel-status-leaks-internal-detail.md`)도 머지 전까지 남는다.
- 재작성이 사용자가 안 쓴 색 이름("갈색"·"회색")을 섞는다(open-work I9).
- `S7-G4` 는 main 에서도 실패한다 — 41단계와 무관(`docs/troubleshootings/2026-09-29-s7-g4-fails-on-main.md`).
- `.env` 에 쓰지 않는 `VOYAGE_API_KEY` 줄이 남아 있다(대표님이 넣은 값 — 지워도 된다).

## 게이트 실행 결과

- 2026-09-30 전체 실행(임베딩을 되돌린 뒤): **276개 중 275 통과**(은퇴 2개는 `_RETIRED` 로 통과에 셈) `[실측]`.
  실패 1개는 `S7-G4` — main 에서도 실패(위).
- 진짜 bge-m3 가 있어야 도는 측정 게이트(S26-G1 · S26-G2 · S28-G1 · S29-G3 · S30-G2 · S30-G3 · S40-G6)도 로컬 Ollama 로 통과했다 —
  40단계의 23건 중 21 정확도가 그대로다.
- 러너는 저장소 밖 임시 스크립트다(스크립트별로 순서대로, 스크립트끼리 4개씩 나란히 · open-work I7).

## 머지 결과 (2026-10-01)

- `main` = `6cf022d`. 배포판 `color-picker-sable-alpha.vercel.app` 확인 `[실측]`:
  - `/api/status` → `{"stage":1, "llm":{"state":"unavailable"}, "ollama":{"state":"unavailable","startedByUs":false}, "embed":{"state":"unknown","count":0}}` —
    **내부 상세(호스트 · 모델 목록 · 사유 원문)가 더는 안 나간다**(`VERCEL` 감지). 첫 배포의 노출이 닫혔다.
  - `/` · `/history` 200 · `/server.js` · `/package.json` · `/.env` 404 · 검색 200(1단계, 사유는 "질의 재작성을 쓸 수 없습니다" 로 가려짐).
  - Vercel 에는 Claude 키도 Ollama 도 없어서 **배포판은 LLM · 임베딩 없이 1단계 전문 검색만** 돈다.
- 로컬 재기동: `stage 4` · LLM ready · bge-m3 ready.
- **같은 날 대표 지시로 배포판을 내렸다** — Vercel Settings → General → **Pause Project**(되돌릴 수 있다. 삭제는 안 했다).
  운영 주소 · `-git-main` 별칭 · 프로젝트 별칭 전부 503 `DEPLOYMENT_PAUSED` `[실측]`. 다시 켜려면 같은 자리의 **Resume Project**
  (재배포 없이 몇 분). main 에 푸시해도 Vercel 은 빌드하지만 일시 중지 중에는 서비스하지 않는다 `[판단]`.

## 다음에 할 일

1. 배포판은 일시 중지 상태다. 다시 켜기 전에 open-work I2(무인증 저장)를 정한다. 배포판에 LLM 을 붙이려면 Vercel 환경변수에 `ANTHROPIC_API_KEY`(대표님이 직접) · Anthropic 콘솔 월 지출 상한. 임베딩은 open-work I4.
2. Claude 크레딧을 다 쓰면: open-work I8.
