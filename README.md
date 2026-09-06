# color-picker (톤먼저)

로컬 LLM 과 전문 검색(BM25)으로 **색 조합을 추천하고 배색을 진단하는** 실험 사이트.

`docs/com/rag-is-simpler-than-you-think.md` 의 주장 — *BM25 + 질의 재작성이면 대부분 충분하고
벡터DB는 과잉이다* — 를 실제로 시험해 보려고 만들었다.

## 돌리기

```bash
node server.js
```

`http://127.0.0.1:4173`. **의존성 0개다** — `npm install` 이 필요 없다. Node 24, ESM.

Ollama 는 있으면 쓰고 없으면 안 쓴다. 죽어 있어도 검색은 그대로 동작한다.

## 화면

| 경로 | 무엇 |
|---|---|
| `/` | 자연어로 묻고 팔레트 또는 진단을 받는다. 면적 비율 슬라이더, 조합 저장 |
| `/history` | 질문과 각 질문이 몇 단계에서 끝났는지. 이어서·다시 묻기 |
| `/saved` | 저장한 조합. 비율 재조정, CSS 변수·JSON 내보내기 |

## 어떻게 도는가

```
질의 → 팔레트 BM25 → 걸리면 끝            (LLM 안 부름)
     → 진단   BM25 → 걸리면 끝            (LLM 안 부름)
     → LLM 한 번   → 의도 분기 ┬ 팔레트 → 재검색
                              ├ 진단   → 진단표
                              └ 기타   → 못 잡음
```

**대부분의 질의가 1단계에서 끝난다.** 문서가 말한 "60% 는 전문 검색 + 재작성에서 종료" 와 같은 방향.

## 코퍼스

| 파일 | 무엇 | 출처 |
|---|---|---|
| `data/palettes.json` | 배색 16쌍 | 와다 산조 『배색사전』 |
| `data/diagnostics.json` | 진단 18건 (증상 → 축 → 처방) | color-design 스킬 본문. 항목마다 `source` 표기 |

**원전에 없는 것은 코퍼스에 넣지 않는다.** 면적 비율이 그래서 `public/ratio.js` 의 규칙으로 빠져
있다 — 배색사전은 헥스와 인상만 적고 면적은 말하지 않는다.

## 파일 지도

| 자리 | 파일 |
|---|---|
| 검색 | `src/tokenize.js`(어절+2-gram) · `src/bm25.js` · `src/stopwords.js` · `src/vocabulary.js` |
| 코퍼스 | `src/palettes.js` · `src/diagnostics.js` · `data/*.json` |
| LLM | `src/ollama.js`(수명주기) · `src/rewrite.js`(의도+재작성) |
| 흐름 | `src/pipeline.js`(단계 승급) |
| 저장 | `src/store.js` → `var/*.json` |
| 내보내기 | `src/export.js` |
| 서버 | `server.js` |
| 화면 | `public/` |
| 게이트 | `GATES.md` + `scripts/check-stage{1..9}.mjs` |

## 게이트 60개

```bash
node scripts/check-stage1.mjs S1-G1
```

`GATES.md` 에 60개가 전부 있고 각 항목에 `CHECK:` / `EXPECT:` 가 붙어 있다.
**게이트는 만들 때마다 일부러 망가뜨려 확인했다** — 통과하는 게이트보다 고장을 잡는 게이트가 목적이다.

| 단계 | 수 | 무엇을 지키나 |
|---|---|---|
| S1 | 4 | 코퍼스 무결성 · 검색 정확도 · 저신뢰 판정 · 의존성 0 |
| S2 | 8 | 서버·화면·경로 이탈·대비·면적 규칙·외부 폰트 없음 |
| S3 | 10 | Ollama 수명주기 · 의도 분기 · LLM 미호출 · 붙여쓰기 복원 · 워밍업 |
| S4 | 7 | 상태 저장 · 클라이언트 색 불신 · 입력 검증 · CSRF |
| S5 | 6 | 면적 조정 · 범위 검증 · 재저장 시 조정 보존 |
| S6 | 8 | 내보내기 형식 · 주석 주입 방어 · 양방향 문자 제거 · 프로토타입 체인 크래시 방어 |
| S7 | 4 | 대화 이어하기 · 없는 대화 404 · 경합 방지 |
| S8 | 7 | 저장 메모 입력 · 재저장 시 메모 보존 · 겹친 저장 · 전송 중 재오픈 차단 |
| S9 | 6 | 저장 화면 메모 편집·삭제 · 다른 필드 불변 · 출처 검사 · id 가 조회 밖으로 안 샘 |

## 환경변수

`PORT` `HOST` `OLLAMA_HOST` `OLLAMA_BIN` `OLLAMA_AUTOSTART=0` `OLLAMA_WARMUP=0`
`OLLAMA_MODEL` `REWRITE_TIMEOUT_MS` `TONEFIRST_DATA_DIR`

## 알려진 한계 (의도적)

- **인증이 없다.** 대화·저장·내보내기가 무인증 GET 이고 루프백 바인딩이 유일한 방어다.
  **로컬 단일 사용자 전제이므로 공개된 곳에 올리지 않는다.**
- 저신뢰 질의가 동시에 오면 LLM 을 각각 부른다(단일 비행 없음).
- 대화 경계가 세션이라 같은 대화를 두 탭에서 열면 마지막 쓰기가 이긴다.

## 문서

- `docs/session-resume/2026-09-01-session-summary.md` — **여기서부터 읽는다.** 단계별 기록 12개의 요약
- `docs/troubleshootings/` — 막힌 문제 포함
- `docs/com/` — 설계·조사 문서
