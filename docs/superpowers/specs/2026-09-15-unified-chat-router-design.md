# 탭 통합 — 한 채팅창 · 결정적 라우터 · 되묻기 설계 (39단계)

- 날짜: 2026-09-15
- 상태: 합의됨, 구현 전. 구현 중 실측으로 바뀌는 값은 본문에 `[실측]` 으로 표시한다
- 대표 결정: 탭을 전부 지운다 · 4안(결정적 라우터 + 겹칠 때만 되묻기, 손으로 쓴 상태 기계) ·
  대화형 화면(사용자 턴 10개) · 되묻기는 같은 입력에 1회 · LangSmith 로 입출력을 본다
- 뒤에 이어지는 작업: B1 OKLCH 좌표계 → B2 PCCS 톤 격자 → B3 구조 확장·씨앗 열기. **각각 따로 스펙을 쓴다.**
  이 문서는 A 만 다룬다.

## 무엇이 안 되나

홈에 탭이 셋이다 — 색감 추천 · 캐릭터 색감 · 코드 및 색상. 사용자가 **무엇을 물을지 먼저 고르고**
그다음 문장을 쓴다. 입구도 셋이다: `/api/search` · `/api/character` · `/api/color`.

- "빨간 머리 도적" 을 색감 추천 탭에서 치면 팔레트 검색으로 가서 엉뚱한 답을 낸다. 탭을 잘못 고른 것이
  틀린 답이 된다.
- 문장 하나에 두 뜻이 있을 때("도적 상의가 탁해" — 캐릭터 + 증상) 어느 탭도 정답이 아니다.
- 검색이 끝까지 저신뢰이고 LLM 도 `other` 로 가르면 "못 잡음" 으로 끝난다. 사용자는 무엇을 더 말해야
  하는지 모른다.

## 무엇으로 바꾸나 — 쉽게 말하면

입력창은 하나. 서버가 문장을 읽어 **네 경로 중 하나**로 보낸다. 둘로 읽히거나 정보가 모자라면
**한 번만 되묻고**, 답을 받으면 그 경로로 푼다. 화면은 말풍선이 아래로 쌓이는 대화 기록이다.
무엇이 어떻게 판정됐는지는 LangSmith 에서 본다.

## 버린 대안

| 대안 | 왜 버렸나 |
|---|---|
| 1안 우선순위 고정(겹치면 규칙표로 하나 고름) | 경계 사례를 규칙표에 계속 더해야 한다. 되묻기가 그 자리를 대신한다 |
| 2안 판별을 LLM 에 맡김 | 헥스 하나 넣어도 모델을 부르고, 답이 매번 달라 결정적 게이트를 못 만든다 |
| 3안 애매하면 둘 다 보여줌 | 화면이 길어지고 "어느 것이 답인가" 를 사용자가 고른다 |
| LangGraph 로 상태 기계 | 의존성 0개 전제와 충돌(`@langchain/langgraph` + `core`). 노드 6개짜리 그래프에 체크포인터를 들이는데, 대화 저장소가 이미 있다. 밖에서 상태표를 검사하기 어렵다. 손으로 쓴 것 위에 나중에 얹는 것은 쉽고 반대는 어렵다 |
| 탭을 접힌 필터로 남김 / 입력 접두어(`/캐릭터`) | "자동" 이 있으면 안 건드리고 UI 유지 비용만 든다 / 사용자가 외워야 한다 |
| 결과 패널 교체형 유지 | 확인 질문에 답한 뒤 앞 맥락이 사라져 무엇을 확인했는지 안 남는다 |
| 되묻기 상한 30회 | 대화가 10턴이라 한 번도 안 걸린다. 같은 입력에 두 번 되묻는 것은 "못 알아듣는다" 로 읽힌다 |
| 로컬 트레이스 화면 | 보는 곳은 LangSmith 로 정했다. 로컬 파일은 게이트가 대조할 기록으로만 남긴다 |
| FastAPI | Python 런타임이 하나 더 생기고 검사기 248개가 Node 다. 라우터는 어휘표 대조 100줄이라 프로세스 경계를 넘길 크기가 아니다. Python 에서만 되는 것이 필요해지면 그때 사이드카로 |

## 1. 라우터 — `src/route.js`

**LLM 없이** 먼저 판정한다. 근거는 전부 이미 있는 어휘표다. 새 데이터 파일은 없다.

| 신호 | 어디서 오나 | 경로 | 쉽게 말하면 |
|---|---|---|---|
| 입력 전체가 색 하나(헥스 · 코퍼스 이름 · 색 낱말) | `from-color.js` `parseColor` | `color` | "#E07A5F", "테라코타" |
| 부위 낱말(피부·머리·눈·상의·하의·강조)이 있음 | `data/character-words.json` `parts` · `compounds` | `character` | "빨간 머리 도적" |
| 증상 별칭이 어절로 걸림 | `data/diagnostics.json` `aliases` | `diagnosis` | "탁해 보여요" |
| 위 셋 다 아님 | — | `palette` | "여름 화장품 브랜드" → 기존 검색 파이프라인 |

판정 결과는 `{ routes: string[], signals: {...} }` 다. `routes` 가 하나면 그 경로, 둘 이상이면 **겹침**.

- `color` 는 **입력 전체가 색일 때만** 걸린다. 그래서 다른 신호와 겹칠 수 없다. "빨강 어울리는 색" 은
  `palette` 로 간다(지금과 같다 — 검색 코퍼스에 색 이름이 색인돼 있다).
- 실제로 겹치는 조합은 **`character × diagnosis`** 뿐이다. `palette` 는 나머지라 겹침에 안 들어간다.
- 짧은 부위 낱말("눈"·"옷")은 오탐 위험이 있다 — "눈에 띄는 색" 은 캐릭터가 아니다. 규칙: **부위 낱말
  하나만으로는 `character` 가 아니고, 색 낱말·합성어(금발)·다른 부위 낱말 중 하나가 함께 있어야 한다.**
  부위 낱말만 있으면 `unclear` 후보다(아래 정보 부족). 이 규칙의 값은 게이트 G1 의 음성 사례로 고정한다.

**정보 부족(`unclear`)** 은 두 곳에서 난다.

| 어디서 | 조건 | 되묻는 말 |
|---|---|---|
| `palette` 경로 | 검색 파이프라인이 끝까지 저신뢰이고 LLM 의도가 `other`(또는 LLM 없음) | "어떤 색을 찾으시나요 — 분위기 / 고칠 것 / 캐릭터 / 색 코드" 칩 4개 |
| `character` 경로 | 부위 낱말만 있고 색 낱말·합성어·인상어가 없음("머리") | "머리색이나 옷 색 하나만 더 주시면 캐릭터 색을 짤 수 있어요" 자유 입력 |

**바로잡기 낱말**도 라우터 표에 한 줄로 둔다: "색으로"·"캐릭터로"·"진단으로"·"추천으로" 가 문장의 앞이나
끝에 오면 `{ redirect: route }` 를 돌려준다. 직전 턴의 원문을 그 경로로 다시 푸는 신호다.

## 2. 대화 상태 기계 — `src/chat.js`

대화 하나는 `{ id, startedAt, updatedAt, turns[], pending }` 다. `pending` 이 되묻기 상태이고, 없으면 `null`.

| 지금 상태 | 사용자 입력 | 다음 |
|---|---|---|
| `pending` 없음 | 문장 | 라우터. 경로 하나 → **답한다**. 겹침·불명 → **되묻고** `pending = { original, choices, askedAt }` |
| `pending` 없음 | 바로잡기 문장 | 직전 턴의 `original` 을 지정 경로로 **다시 답한다**. 직전 턴이 없으면 그 문장을 보통 문장으로 |
| `pending` 있음 | 칩 선택(`choice`) | `original` 을 그 경로로 **답한다**. `pending = null` |
| `pending` 있음 | 문장 | 문장을 `original` 에 이어 붙여 라우터. 하나면 답한다. **또 겹치거나 불명이면 다시 안 묻고** 후보 첫 번째(겹침) 또는 `palette`(불명)로 답한다. `pending = null` |
| 사용자 턴 10개 도달 | 무엇이든 | **새 대화를 열어** 거기서 처리한다. 응답의 `conversationId` 가 바뀐다. 옛 대화는 내역에 남는다 |

- 되묻기는 **같은 `original` 에 1회**. 상한은 상태 기계 표 자체가 보장한다(`pending` 있을 때는 다시 묻는 전이가 없다).
- "사용자 턴 10개" 는 **되묻기에 답한 턴도 센다.** 상한은 `LIMITS.turnsPerConversation` 을 100 → 10 으로 바꾼다.
  옛 대화에 10개 넘게 든 것은 그대로 둔다(읽기만).
- 겹침 후보 순서는 라우터 표의 행 순서(`character` → `diagnosis`)다. 첫 번째로 답하는 규칙이 결정적이려면 순서가 고정돼야 한다.
- 상태는 기존 `store.js` 의 `conversations.json` 에 그대로 얹는다. 새 저장 계층 없음. `pending` 은 대화 객체의
  필드 하나다.

## 3. 서버 — `POST /api/chat`

요청 `{ conversationId?: string, text?: string, choice?: string }`. `text` 와 `choice` 중 하나는 있어야 한다.

응답 `{ conversationId, turn }`. `turn` 은 둘 중 하나다.

```
{ kind: "answer", route: "palette"|"diagnosis"|"character"|"color", original, payload, trace }
{ kind: "ask",    reason: "ambiguous"|"unclear", question, choices: [{ id, label }], allowFreeText: true }
```

- `answer.payload` 는 기존 `/api/search` · `/api/character` · `/api/color` 가 내던 것과 **같은 모양**이다.
  카드 렌더러(`paletteCard` · `diagnosisCard` · `characterStructure` · `swatchView`)를 그대로 쓴다.
- `/api/chat` 은 세 처리기 **함수**를 안에서 부른다(HTTP 재호출 아님). 세 GET 엔드포인트는 **남긴다** —
  검사기 1~38단계가 부르고 내보내기·저장 흐름이 붙어 있다.
- `/api/conversations/turn` 은 `/api/chat` 이 흡수한다. 화면이 직접 기록하던 것을 서버가 안에서 한다.
  엔드포인트 자체는 내역 게이트(S4 계열)가 부르므로 남긴다.
- 실패(코퍼스 오류 · 저장 실패)는 지금 경계 그대로 400/500. Ollama 사유 문구의 노출 규칙(`OLLAMA_HOST` 를 원문으로
  안 내보냄)도 그대로.

## 4. 관측 — LangSmith + 로컬 기록

**트레이스 단위는 턴 하나.** 부모 런 = 사용자 입력 → 최종 `turn`. 자식 런은 순서대로:

| 자식 런 | inputs | outputs |
|---|---|---|
| `route` | `{ text, pending }` | `{ routes, signals, redirect }` |
| `search` (palette·diagnosis 일 때) | `{ query }` | `{ stage, route, confident, topId }` |
| `llm.rewrite` / `llm.structure` / `llm.finish` / `llm.character` (부른 것만) | 프롬프트 | 응답 원문 |
| `ask` (되물었을 때) | `{ reason }` | `{ choices }` |

- 전송은 `src/trace.js` 가 `fetch` 로 REST(`POST {LANGSMITH_ENDPOINT}/runs`, `PATCH /runs/{id}`)에 직접 보낸다.
  SDK 없음. `LANGSMITH_API_KEY` 가 없으면 **아무 데도 안 보내고** 아무것도 안 깨진다.
- 프로젝트 이름은 `LANGSMITH_PROJECT`, 기본 `color-picker`. 엔드포인트는 `LANGSMITH_ENDPOINT`, 기본
  `https://api.smith.langchain.com`.
- 전송은 응답을 **기다리지 않는다**(fire-and-forget). 실패는 서버 로그 한 줄이고 사용자 응답과 무관하다.
- **같은 기록을 `var/traces.jsonl` 에 한 줄씩 쓴다.** 검사기가 "이 입력은 이 경로로 갔는가" 를 이 파일로 대조한다.
  LangSmith 가 꺼져 있어도 게이트는 돈다. 이 파일은 `var/` 라 커밋되지 않는다.
- 루프백 밖에 바인딩했을 때 원문을 안 내보내는 기존 경계는 트레이스에도 적용한다 — 트레이스는 **서버 안에서만**
  만들어지고 `/api/chat` 응답의 `trace` 는 `{ routes, signals }` 요약뿐이다.

**`.env`**

- `.env` 를 `.gitignore` 에 더한다. 저장소에는 `.env.example` 만 두고 키 자리는 빈 값이다.
- 기동은 `node --env-file=.env server.js`(Node 24 내장, 의존성 없음). 파일이 없어도 뜨게 `--env-file-if-exists` 를 쓴다.
  README 와 `.claude/launch.json` 의 기동 명령을 함께 고친다.
- 키 값은 **대표가 직접 넣는다.** 구현 중 키가 필요한 시점이 오면 `.env` 를 열어 보이고 멈춘다.

## 5. 화면 — `public/index.html` · `public/app.js`

- `role="tablist"` 와 패널 셋을 지우고 `<ol class="chat">` 하나. 입력창은 하단 고정.
- 항목 셋: 사용자 말풍선 · 에이전트 답(기존 카드 그대로) · 확인 질문(칩 2~4개 + 자유 입력 허용).
  칩을 누르면 `choice` 로, 문장을 치면 `text` 로 `/api/chat` 에 보낸다.
- 카드의 저장 · 배색 구조 펼치기 · 비율 슬라이더 · 재질 고르개는 그대로 동작한다. 카드가 대화 항목 안에
  들어가는 것만 다르다.
- `app.js` 의 `RUN_BY_TAB` · `tabStore` · `applyTab` · `asTab` 을 지우고 `send(text | choice)` 하나로.
- `?tab=` 파라미터는 사라진다. 내역의 "다시 묻기" · "이어서" 는 `?conv=<id>` 로 그 대화를 이 화면에 연다.
  대화가 10턴이면 그 대화는 읽기만 되고 입력은 새 대화로 간다(3절 상태 기계 그대로).
- 첫 화면(빈 대화)에는 에이전트 인사 한 줄만 둔다. 예시 칩은 38단계에서 지웠으므로 되살리지 않는다.

## 6. 저장 · 내역

- 저장(`/api/saved*`)은 변경 없음. 카드가 같으니 버튼도 같다.
- 내역 페이지는 턴마다 **경로 배지**(추천 / 진단 / 캐릭터 / 색 / 되물음)를 보인다. 지금의 "몇 단계에서 끝났나"
  옆 한 칸. `turn.kind === "ask"` 인 턴은 "되물음" 이다.
- `recordTurn` 이 받는 `route` 열거값에 `ask` 를 더한다. 위조는 지금처럼 `none` 으로 떨어진다.

## 7. 게이트 — 39단계 (`scripts/check-stage39.mjs`, 구현보다 먼저 쓴다)

| 게이트 | 무엇을 확인하나 | 쉽게 말하면 |
|---|---|---|
| S39-G1 | 라우터 고정 입력표가 기대 경로와 같다. 양성 · 음성 · 겹침 · 불명을 모두 담는다 (아래 표) | 규칙이 말한 대로 가른다 |
| S39-G2 | 같은 입력을 두 번 넣으면 같은 판정 | 결정적이다 |
| S39-G3 | 되묻기는 한 대화에서 같은 `original` 에 1회. 두 번째 애매한 답은 후보 첫 번째로 답한다 | 두 번 안 묻는다 |
| S39-G4 | 사용자 턴 11번째에 새 `conversationId` 가 온다. 옛 대화는 10턴 그대로 남는다 | 대화 상한 |
| S39-G5 | `LANGSMITH_API_KEY` 없이 `/api/chat` 이 정상이고 `fetch` 를 가로채면 외부 호출 0건 | 키 없으면 아무것도 안 나간다 |
| S39-G6 | 키가 있을 때 가짜 엔드포인트로 부모·자식 런이 나가고, 엔드포인트가 죽어 있어도 응답이 1초 안에 온다 | 전송이 응답을 안 막는다 |
| S39-G7 | `var/traces.jsonl` 의 판정이 G1 표와 같다 | 기록이 판정과 같다 |
| S39-G8 | `index.html` 에 `tablist` 없음. `app.js` 에 `RUN_BY_TAB` · `tabStore` · `?tab=` 없음 | 탭이 진짜 사라졌다 |
| S39-G9 | 바로잡기 문장("색으로 봐줘")이 직전 원문을 그 경로로 다시 푼다 | 오판을 되돌린다 |
| S39-G10 | 1~38단계 검사기 전부 통과 | 회귀 없음 |

**G1 입력표 (초안 — 구현 중 늘린다. 음성 사례가 절반 이상이어야 한다)**

| 입력 | 기대 |
|---|---|
| `#E07A5F` | color |
| `테라코타` | color |
| `빨강` | color |
| `빨강 어울리는 색` | palette |
| `여름 화장품 브랜드` | palette |
| `눈에 띄는 색` | palette (부위 낱말 "눈" 단독은 캐릭터가 아니다) |
| `탁해 보여요` | diagnosis |
| `대시보드가 너무 요란해` | diagnosis |
| `빨간 머리 도적` | character |
| `금발 마법사` | character (합성어) |
| `상의는 갈색 하의는 검정` | character (부위 둘) |
| `도적 상의가 탁해` | ambiguous [character, diagnosis] |
| `머리` | unclear (부위만) |
| `색으로 봐줘` | redirect color |
| `캐릭터로` | redirect character |
| `` (빈 문자열 · 서식 문자만) | 거부 (38단계 규칙 그대로) |

## 8. 건드리는 파일

| 파일 | 무엇 |
|---|---|
| `src/route.js` (신규) | 라우터. 순수 함수. 어휘표는 기존 로더에서 받는다 |
| `src/chat.js` (신규) | 상태 기계. `store.js` 의 대화 기록을 읽고 쓴다 |
| `src/trace.js` (신규) | LangSmith REST 전송 + `var/traces.jsonl` |
| `src/store.js` | `turnsPerConversation` 10 · `pending` 필드 · `route` 열거값 `ask` |
| `server.js` | `POST /api/chat`. 세 처리기를 함수로 노출 |
| `public/index.html` · `app.js` · `app.css` · `ui.js` | 탭 제거, 대화 기록, 확인 질문 칩 |
| `public/history.html` · `history.js` | 경로 배지, `?conv=` |
| `.gitignore` · `.env.example` · `README.md` · `.claude/launch.json` | `.env` · 기동 명령 · 화면 표 갱신 |
| `GATES.md` · `scripts/check-stage39.mjs` | 39단계 |

## 9. 되돌리는 법

- 탭 UI 는 `git revert` 로 돌아온다. 서버의 세 GET 엔드포인트가 남아 있어 옛 화면이 그대로 동작한다.
- LangSmith 는 `.env` 에서 키를 빼면 꺼진다. 코드 제거는 `src/trace.js` 와 그 호출 4곳.
- 대화 상한 10 은 `LIMITS.turnsPerConversation` 한 값이다.
