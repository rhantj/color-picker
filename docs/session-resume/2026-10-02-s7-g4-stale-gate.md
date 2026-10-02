# S7-G4 낡은 게이트 고침 (open-work I6)

2026-10-02, 42단계 머지 직후. 대표: "s7-g4 어떤건지 보여줘" → "고치고 43단계 브리핑해줘".

## 무엇을 했나

`scripts/check-stage7.mjs` 의 `S7-G4` 를 고쳤다. 코드(src · public)는 안 바꿨다.

| 옛 검사 | 왜 실패했나 | 새 검사 |
|---|---|---|
| `app.js` 에 `recordTurn(...).catch(... textContent ...)` 가 있는가 | 39단계에서 대화 기록을 **서버가** 한다(`src/chat.js`). 화면에 그 코드가 없다 | 저장 폴더에 `conversations.json` 이라는 **폴더**를 만들어 기록을 실제로 실패시킨다 → `/api/chat` 이 5xx · `error` 문장 · `turn` 없음. 화면 `send` 의 `catch` 가 `errorItem` 을 그린다 |
| `async function run(` 안에 `await ready;` | 보내는 함수 이름이 `send` 로 바뀌었다 | `async function send(body) {` 바로 다음이 `await ready;` |

나머지 다섯 항목(URL 파라미터 · 대화 확인 · 못 이어 쓸 때 알림 · 새 대화 버튼 · 화면 id)은 그대로다.

## 왜 그렇게 했나

- 글자 모양을 다시 맞추는 대신 **동작으로** 쟀다. 모양 검사는 코드가 옮겨 가면 또 낡는다 — 이번이 그 예다.
- 버린 대안: 게이트 은퇴. 지키는 것(기록 실패를 삼키지 않기 · 대화 확인 경합)은 지금도 유효하다.

## 지금 상태

- `S7-G4` 통과. 7단계 4개 전부 통과. 변형 3건(서버가 기록 실패를 삼킴 · `await ready` 제거 · 오류 말풍선 제거) 전부 잡힘.
- 이로써 전체 게이트 288개 중 알려진 실패가 없다(S40-G9 의 한 번 흔들림은 별건 — `docs/troubleshootings/2026-10-02-regression-gates-flaky-in-runner.md`).

## 다음에 할 일

43단계 — 대화로 다듬기 (브리핑 뒤 대표 승인).
