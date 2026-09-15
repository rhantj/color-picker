# Task 3 보고 — 라우터 `src/route.js` (39단계)

## 요약

- 상태: 완료. `S39-G1`·`S39-G2` 모두 `_OK`.
- 브리프의 코드를 그대로 옮겼고, 규칙 변경은 없었다(둘 다 첫 시도에 통과).
- 변경 파일: `src/route.js` (신규, 89줄) 하나뿐.

## 사전 조치 — 브랜치 불일치

작업 지시는 "worktree HEAD 41a30f3, 브랜치 stage-39-unified-chat" 이었는데, 실제로 이 worktree
는 `worktree-agent-a33e05d45385b13fb` 브랜치이고 HEAD 가 `499da2c`(38단계 세션 기록)였다 —
`scripts/check-stage39.mjs` 자체가 없는 상태. `stage-39-unified-chat` 브랜치는 동일 이력의
조상 관계였으므로 (git worktree 는 같은 브랜치를 두 곳에서 체크아웃할 수 없어 이름은 다르지만)
`git merge --ff-only 41a30f3` 로 빨리 감기 병합해 정확한 커밋으로 맞췄다. 새 커밋은 만들지
않았다 — 순수 fast-forward.

이후 모든 작업은 `41a30f3` 위에서 진행했다.

## Step 1: RED 확인

```
$ node scripts/check-stage39.mjs S39-G1 | tail -1
  - 검사 자체가 실패: Cannot find module 'D:\colorpicker\.claude\worktrees\agent-a33e05d45385b13fb\src\route.js' imported from ...\scripts\check-stage39.mjs
S39-G1 실패 (1)
```

브리프가 기대한 대로 모듈 없음 에러로 실패했다.

## Step 2: 구현

`src/route.js` 를 브리프 30~113번째 줄 코드 그대로 작성했다. 바꾼 것 없음 — 브리프 자체가
"완료 조건을 만족하는 정답 코드"였고, 검사기의 `loadRouter()` 가 부르는 시그니처
(`createRouter({ words, diagnostics, corpus })`, `creatures` 는 전달 안 함 → 기본값 `[]` 로
처리)와도 그대로 맞았다.

## Step 3: GREEN 확인

```
$ node scripts/check-stage39.mjs S39-G1 | tail -1
S39_G1_OK

$ node scripts/check-stage39.mjs S39-G2 | tail -1
S39_G2_OK
```

둘 다 한 번에 통과했다. **표(`ROUTE_TABLE`)를 고칠 필요도, 규칙(`route.js`)을 고칠 필요도
없었다** — 브리프 119번째 줄이 예고한 "빨간 머리 도적"(부위+색 → strong → character)과
"눈에 띄는 색"(weak → palette) 두 경계 사례 모두 브리프의 코드가 그대로 처리했다.

### 참고 — 다른 게이트(G3~G10)

같은 검사기 파일 안의 다른 게이트를 훑어봤더니 실패한다:

```
S39-G3 실패 (9)  — 캐릭터 이어쓰기·payload.colors 관련, server.js/store.js 영역
S39-G4 실패 (13) — 대화 이어감/새 대화 판단, store.js 영역
S39-G5 실패 (4)  — /api/chat 라우팅 404, server.js 배선 영역
```

이건 이 작업(Task 3, `route.js` 단독)의 책임 범위 밖이다 — 브리프도 "Files: Create: src/route.js"
뿐이고, 서버 배선·저장소는 병렬 작업(Task 1/2/4 등, store.js·trace.js·server.js)의 몫이다.
지시대로 `src/route.js` 외 어떤 파일도 건드리지 않았으니 그대로 두었다.

## 파일 변경

- 신규: `D:\colorpicker\.claude\worktrees\agent-a33e05d45385b13fb\src\route.js` (89줄)
- 그 외 변경 없음 (`git status --porcelain` 결과 `src/route.js` 한 줄뿐이었다).

## 자체 리뷰

- **순수성**: `fetch(`·`readFileSync`·`process.env`·`Math.random`·`Date.now` 어느 것도 본문에
  없다 (S39-G2 가 이걸 기계적으로 검사하며 통과했다).
- **의존성**: `./from-color.js` 하나만 import. 외부 패키지 없음(요구사항: zero dependencies).
- **결정성**: 같은 입력에 두 번 호출해 문자열 비교하는 S39-G2 내부 검사도 통과 — 순수 함수라
  당연하지만 실측으로 확인됐다.
- **되묻기 처리**: "머리" 처럼 부위 낱말만 있고 그걸 걷어내면 빈 문자열이 되는 경우
  `unclear: "character"` 로 표시해 규칙이 판정을, 사용자가 해소를 맡는 설계를 그대로 구현했다.
- **바로잡기 우선순위**: 바로잡기 검사(1단계)가 색 판정(2단계)보다 먼저라 "색으로 봐줘" 같은
  3어절 이하 입력이 색 파싱을 거치지 않고 즉시 redirect 로 빠진다 — 브리프 의도와 일치.
- **한글 주석**: 파일 전체가 한국어 주석/설명으로 되어 있어 프로젝트 컨벤션에 맞는다.
- 코드 스타일·구조는 브리프 원문을 그대로 채택했으므로 별도의 리팩터링·추상화를 더하지
  않았다(요청 범위 밖 확장 금지 원칙 준수).

## 우려 사항

- `creatures` 기본값 `[]` 는 브리프 시그니처(`createRouter({ words, diagnostics, corpus, creatures = [] })`)
  그대로이나, 검사기의 `loadRouter()` 는 `creatures` 를 아예 넘기지 않는다. 즉 `data/creatures.json`
  기반 생물 신호(`creatureHits`)는 현재 게이트로는 전혀 검증되지 않는다 — 다른 태스크(서버 배선)가
  실제로 `creatures` 를 채워 넘길 때 별도 확인이 필요할 수 있다.
- Task 3 범위 밖이라 손대지 않았지만, G3~G5 실패는 병렬 작업이 아직 안 끝났다는 신호이지
  `route.js` 결함은 아니라는 점을 위에 근거와 함께 남겨둔다.

## 커밋

```
6c714e2 feat: 결정적 라우터 — 어휘표만으로 네 경로·겹침·불명·바로잡기 (39단계)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
```

브랜치: `worktree-agent-a33e05d45385b13fb` (이력상 `stage-39-unified-chat` 의 41a30f3 위에
fast-forward 된 동일 이력). 머지·푸시는 하지 않았다.

## Fix round 1 — 리뷰 지적 2건 반영

리뷰에서 지적한 두 문제, 둘 다 브리프 코드 자체의 규칙에 있던 것. 대표(컨트롤러) 판정대로
`data/` 는 손대지 않고 `route.js` 규칙만 고쳤다.

### 지적 1 — "검정 안경" 이 캐릭터로 잘못 감

**무엇이 안 되나**: `surfaceHits` 가 `text.includes(form)` 로 문장에 그 글자가 있는지만 본다.
`data/character-words.json` 의 `parts.강조` 안에 1글자 표면형 `"검"` 이 있어서, "검정 안경"
("black glasses") 이라는 문장 안에 "검정" 이라는 색 낱말이 들어 있으면 그 안에 우연히 "검"
이라는 부분 문자열이 걸려 부위(강조) 신호로 오인된다. 부위 신호 + 색 낱말이 같이 있으면
`strong` 조건이라 캐릭터로 갔다.

**왜 문제인가**: "검정 안경" 은 캐릭터 설명이 아니라 그냥 색 추천 요청이어야 한다(팀 판단으로
`palette`).

**고친 것**: `route.js` 에서 부위 표면형을 모을 때 1글자짜리는 제외한다.

```js
const partForms = Object.values(partsTable).flat().filter((f) => f.length >= 2);
```

주석: "부위 표면형 중 1글자짜리는 뺀다 — data/character-words.json 자체가 '검'(강조) 같은
1글자 형태가 '검정'('black') 안에서 오탐을 낸다고 적어뒀다."

`data/character-words.json` 파일은 전혀 건드리지 않았다 — 39단계는 이 단계에서 `data/` 를
바꾸지 않는다는 방침을 그대로 지켰다.

### 지적 2 — 같은 부위 역할의 동의어 두 개가 "역할 두 개"로 잘못 셈

**무엇이 안 되나**: `strong` 판정의 "부위가 둘 이상" 조건이 `new Set(parts).size >= 2` 로
**표면형(단어 그 자체)** 개수를 셌다. "포인트 강조 화려하게 해줘" 에는 "포인트" 와 "강조" 라는
서로 다른 낱말이 둘 있지만 둘 다 `parts.강조` 라는 **같은 역할**의 동의어다. 그런데 표면형
기준으로 세면 "부위 둘" 로 오인해 캐릭터로 갔다.

**왜 문제인가**: 실제로 부위가 둘(예: 상의·하의)일 때만 "부위 여러 개를 지정했다" 는 강한
캐릭터 신호이지, 같은 부위를 다른 말로 두 번 말한 건 그런 신호가 아니다. "포인트 강조 화려하게
해줘" 는 캐릭터가 아니라 추천(`palette`)이어야 한다.

**고친 것**: 표면형 → 역할 매핑(`formToRole`)을 만들어 실제 **역할** 종류 수를 센다.

```js
const formToRole = new Map(Object.entries(partsTable).flatMap(([role, forms]) => forms.filter((f) => f.length >= 2).map((f) => [f, role])));
...
const partRoles = [...new Set(parts.map((f) => formToRole.get(f)))];
const strong = compounds.length > 0 || (parts.length > 0 && (colorWords.length > 0 || creatureHits.length > 0)) || partRoles.length >= 2;
```

`signals.parts` 는 표면형 그대로 유지(형태 안 바꿈), `signals.partRoles` 를 새로 추가해 역할
배열을 노출했다. 색 판정 분기의 `signals` 에도 `partRoles: []` 를 맞춰 넣어 두 분기의 신호
객체 모양을 일치시켰다.

### 검사기 표에 음성 행 2개 추가

`scripts/check-stage39.mjs` 의 `ROUTE_TABLE` 에 아래 두 행을 추가했다(기존 행은 그대로):

```js
{ text: "검정 안경", routes: ["palette"] },
{ text: "포인트 강조 화려하게 해줘", routes: ["palette"] },
```

### 재검증

```
$ node scripts/check-stage39.mjs S39-G1 | tail -1
S39_G1_OK

$ node scripts/check-stage39.mjs S39-G2 | tail -1
S39_G2_OK
```

네 입력을 직접 호출로 확인(`node -e` 한 줄 스크립트):

```
검정 안경 => routes:["palette"]  (parts:[], colorWords:["검정"], partRoles:[])
포인트 강조 화려하게 해줘 => routes:["palette"]  (parts:["포인트","강조"], partRoles:["강조"])
상의는 갈색 하의는 검정 => routes:["character"]  (parts:["상의","하의"], partRoles:["상의","하의"])
빨간 머리 도적 => routes:["character"]  (parts:["머리"], colorWords:["빨간"], partRoles:["머리"])
```

지적 1·2가 고쳐졌고, 기존에 통과하던 "상의는 갈색 하의는 검정"(역할 둘: 상의·하의)과
"빨간 머리 도적"(부위+색)은 여전히 `character` 로 간다 — 회귀 없음.

### 변경 파일 (Fix round 1)

- `src/route.js` — 1글자 부위 표면형 제외, 역할 기반 `partRoles` 도입, `signals` 확장
- `scripts/check-stage39.mjs` — `ROUTE_TABLE` 에 음성 행 2개 추가 (대표 판정에 따라 검사기도
  함께 수정 — Task 3 원 범위는 `route.js` 단독이었으나 이번 라운드는 컨트롤러가 명시적으로
  지시했다)

### 커밋 (Fix round 1)

6c714e2 위에 새 커밋 1개.
