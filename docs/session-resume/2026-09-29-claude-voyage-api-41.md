# 41단계 — 모델을 Ollama 에서 Claude API · Voyage API 로 (2026-09-29)

> 브랜치 `stage-41-claude-voyage` 에 **커밋만** 했다. main 머지 · 푸시 · Vercel 재배포는 안 했다 —
> 대표님이 "끝나면 컴퓨터를 꺼 달라" 하고 자리를 비웠고, 아래 "다음에 할 일" 1·2 가 대표 확인을 기다린다.
> 설계: `docs/superpowers/specs/2026-09-29-claude-voyage-api-design.md`

## 무엇을 했나

**한 줄로:** 검색어 다듬기 · 캐릭터 설명 읽기 · 구조 고르기 · 재질 고르기 네 곳은 이제 Claude Haiku 4.5 가,
문장을 벡터로 바꾸는 일은 Voyage `voyage-4` 가 한다. 로컬도 Vercel 도 같다. Ollama 는 코드에서 빠졌다.

| 파일 | 무엇을 | 쉽게 말하면 |
|---|---|---|
| `src/llm.js` (새) | Claude 를 부르는 곳 한 군데. 공식 SDK · 구조화 출력(`output_config.format` JSON 스키마) · 재시도 1회 · 오류를 종류별로 | 네 호출부가 각자 Ollama 를 부르던 것을 한 곳으로 모았다 |
| `src/rewrite.js` · `describe.js` · `structure.js` · `finish.js` | `chatJson` 으로 부른다. 각자 스키마를 낸다. 기존 파서는 그대로 | 모델만 바뀌고 답을 거르는 규칙은 같다 |
| `src/embed.js` | Voyage `/v1/embeddings` · 코퍼스 `input_type: document`, 질의 `query` · 캐시 키에 종류 · 워밍업/keep_alive 삭제 · "죽었다" 판정을 문장 끝 글자에서 오류 종류로 | 벡터를 Voyage 가 만든다 |
| `src/hybrid.js` · `src/pipeline.js` | `THRESHOLDS_MEASURED_ON = "bge-m3"` · 지금 모델과 다르면 **임베딩으로는 확신하지 않는다** | 안 잰 숫자로 틀린 확신을 내지 않게 막았다 |
| `src/quota.js` (새) | IP 당 1분 30회(임베딩+LLM 같은 통) · 서버당 200회. 넘으면 모델 없이 물러선다 | 남이 대표님 API 비용을 태우는 것을 줄인다(보조 장치) |
| `src/store.js` | `VERCEL` 이면 저장 폴더 `/tmp/tonefirst` | Vercel 은 배포 폴더에 못 쓴다 |
| `server.js` | Ollama 기동·워밍업 삭제 · `/api/status` 의 `ollama` → `llm` · `VERCEL` 이면 루프백 아님 · 요청마다 IP 를 흘림 | 첫 배포에서 샌 내부 상세를 막았다 |
| `src/ollama.js` | **삭제** | |
| `public/ui.js` · HTML 3개 | "로컬 · Ollama 준비됨" → "Claude API 준비됨" · 기본 문구 "확인 중" | 거짓 "로컬" 문구 제거 |
| `package.json` · `package-lock.json` (새) | 의존성 `@anthropic-ai/sdk` 하나 · `"type": "module"` | 의존성 0개가 깨졌다(대표 결정 Q1) |
| `scripts/lib/ollama-shim.mjs` (새) | 옛 게이트의 가짜 Ollama 를 Claude·Voyage API 로 보이게 번역 · 게이트 프로세스에서 **키를 비움** | 옛 게이트를 다시 짜지 않고 살렸다 · 게이트가 유료 호출을 못 한다 |
| `scripts/lib/retired.mjs` (새) | 은퇴 게이트 19개와 이유 | 지우지 않고 이유를 남겼다 |
| `scripts/lib/stub-apis.mjs` (새) · `scripts/check-stage41.mjs` (새) | 가짜 Claude·Voyage(요청 본문 기록) · S41-G1~G9 | 서버가 실제로 무엇을 보내는지 본다 |
| 옛 게이트 | 전부 첫 줄에 번역기 import · S1-G4(의존성 SDK 하나) · S17(프로세스 안 가짜 교체) · S25 IMPORTS · S26-G3/G6 사유 문구 · 회귀 게이트가 `_RETIRED` 도 통과로 | |
| `GATES.md` · `README.md` · `.env.example` · `.gitignore` · `.claude/launch.json` | 41단계 절 · 은퇴 표시 · 환경변수 · 키 두 개 · `tonefirst-no-keys` | |

## 왜 그렇게 했나 (버린 대안 포함)

- **왜 API 인가.** Vercel 에는 GPU 가 없고 함수 크기 한도 때문에 모델 파일도 못 올린다. 대안은 셋이었다 —
  A. 집 PC Ollama 를 터널로(무료, PC 가 꺼지면 끝, 인증을 따로 붙여야) · B. GPU 클라우드(비싸고 콜드 스타트 수십 초) ·
  C. 외부 API. 대표님이 A 를 골랐다가 "다 문제가 있다" 며 **C 로 확정**했다. 대화 모델은 Haiku 4.5(짧은 JSON 이라 가장
  빠르고 싼 것으로 충분), 임베딩은 Voyage(Anthropic 에는 임베딩이 없다).
- **왜 SDK 인가(Q1).** 재시도·타임아웃·오류 종류를 SDK 가 해 준다. 대가로 "의존성 0개" 가 깨졌다. `fetch` 직접 호출은 버렸다.
- **왜 번역기인가.** 가짜 Ollama 를 쓰는 게이트가 9개였다. 각자 가짜 Claude 로 다시 짜면 하루 일이고, 그 과정에서
  게이트가 재던 뜻이 바뀔 위험이 크다. 번역기를 끼우면 게이트는 그대로 "모델이 이런 답을 주면 서버가 어떻게 하나" 를 잰다.
  대가: 옛 게이트 코드에 Ollama 낱말이 남는다(번역기 머리말에 이유를 적었다).
- **왜 확신을 막았나.** `COS_MIN` 0.44 등은 bge-m3 로 쟀다. Voyage 는 점수 분포가 다르고(게다가 문서/질의를 다르게 만든다)
  그대로 쓰면 40단계가 막은 "틀린 확신" 이 다시 날 수 있다. 재기 전까지는 임베딩이 **순서만** 돕는다. 모델 이름으로 묶어서
  모델을 또 바꾸면 자동으로 다시 막힌다.
- **타임아웃 70초 → 10초** `[판단]`. 70초는 로컬 모델을 GPU 에 처음 올리는 시간 때문이었다.
- **은퇴 19개.** Ollama 자체의 동작(띄우기 · GPU 적재 · keep_alive · 워밍업)과 진짜 bge-m3 정답률. 뒤의 것은 유료 API 로
  다시 재야 하는데, 게이트가 돌 때마다 돈이 나가면 안 되므로 **측정 스크립트**로 대체할 계획이다(open-work I1).

## 지금 상태

**동작하는 것**
- 키 없이: 서버가 뜨고 1단계(전문 검색)로 돈다. `/api/status` 가 `ANTHROPIC_API_KEY 가 없다`·`VOYAGE_API_KEY 가 없다` 를 말한다 `[실측]`.
- 가짜 Claude·Voyage 로: 네 호출부의 요청 모양(모델 · 스키마 · 키 헤더 · user 자리) · 코퍼스/질의 `input_type` · 캐시 · 한도 · Vercel 감지 — S41-G1~G9 전부 통과 `[실측]`.
- 게이트: 결과는 아래 "게이트 실행 결과" 절.

**안 되는 것 / 모르는 것**
- **실제 API 로는 한 번도 안 돌려 봤다** — 키가 없다. 특히 구조화 출력 스키마(한국어 속성 이름 · `anyOf` null · `enum`)를
  진짜 API 가 받는지 모른다 `[판단]`. 400 이면 그 기능만 폴백한다.
- 임베딩 확신은 막혀 있다(I1). 그래서 저신뢰가 늘고 LLM 호출도 는다.
- 배포판(main)은 아직 40단계 그대로다. 첫 배포에서 본 내부 상세 노출(`docs/troubleshootings/2026-09-29-vercel-status-leaks-internal-detail.md`)도 머지 전까지 남는다.
- `S7-G4` 는 main 에서도 실패한다 — 41단계와 무관(`docs/troubleshootings/2026-09-29-s7-g4-fails-on-main.md`).

## 게이트 실행 결과

(아래는 커밋 직전의 전체 실행이다. 러너는 저장소 밖 임시 스크립트 — 스크립트별로 순서대로, 스크립트끼리 5개씩 나란히.)

- 전체 276개 중 **272 통과**(은퇴 19개는 `_RETIRED` 로 통과에 셈) `[실측]`. 실패 4개의 처리:
  - `S22-G6` — README 를 고치기 전에 돈 것. 고친 뒤 따로 돌려 `S22_G6_OK`. 이것의 회귀인 `S35-G6` 도 따로 `S35_G6_OK`.
  - `S28-G3` — 그 안에서 부른 `S26-G4`("확신 질의 1초 안")가 나란히 돌던 다른 게이트의 부하로 흔들렸다. 따로 돌려 `S28_G3_OK`·`S26_G4_OK`.
  - `S7-G4` — **main 에서도 실패**(위 트러블슈팅). 41단계 전후 같다.
- 첫 실행(번역기 없이)은 204/267 이었다 — 그 실패가 전부 위 변경으로 설명된다(가짜 Ollama 연결 · Ollama 전용 게이트 · 문구).
- 음성 대조: S41-G2·G5·G8·G9 는 스스로 "이 게이트가 헛돌고 있다" 양성 대조를 품고 있다. 따로 일부러 깨뜨려 보는 절차는
  이번에 하지 않았다(CLAUDE.md 에서 그 절차가 빠졌고, 대표님이 자리를 비워 시간이 한정됐다).

## 다음에 할 일

1. **대표 결정 — 공개 배포 vs 무인증 전제(open-work I2).** 저장 목록 · 대화 기록이 방문자끼리 보이고 지워진다.
   배포판에서 저장을 끌지, 방문자별로 가를지, 외부 저장소를 붙일지.
2. **키 넣기(I4).** 로컬 `.env` 와 Vercel 에 `ANTHROPIC_API_KEY`·`VOYAGE_API_KEY`. 두 콘솔에 월 지출 상한.
3. **실제 API 스모크(I3).** 로컬에서 캐릭터 · 펼치기 · 저신뢰 검색을 한 번씩 → 스키마가 받아지는지.
4. **기준값 측정(I1).** 23건 + 잡담 표본으로 `voyage-4` / `-lite` 를 재고 `COS_MIN`·`PROMINENCE_MIN`·`AGREE_TOP`·`FAST_BUDGET_MS` 교체,
   `THRESHOLDS_MEASURED_ON` 을 그 모델로. 은퇴한 측정 게이트를 대체할 측정 스크립트도.
5. 머지(`git merge --ff-only stage-41-claude-voyage`) · 푸시 → Vercel 자동 재배포 → 배포판 `/api/status` 가 상세를 숨기는지 확인.
