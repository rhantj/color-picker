# 캐릭터 외형 설명 → 부위별 색 추천 설계 (34단계)

- 날짜: 2026-09-13
- 상태: 합의됨(대표 승인, 브레인스토밍 스킬). 구현 계획은 `docs/superpowers/plans/2026-09-13-character-colors.md`
- 근거 등급 표기: `[실측]` 재 본 값 · `[문헌]` 원전·문서 · `[판단]` 내가 정한 것

## 무엇이 안 되나

지금 이 사이트는 **화면(배경·본문·강조)을 위한 색**만 준다. "붉은 머리에 검은 갑옷, 차가운 성격의 기사" 처럼
**캐릭터의 외형을 문장으로 쓰면** 피부·머리·눈·옷 같은 **부위마다 색을 골라 주는 자리가 없다.** 검색은 그 문장을
배색 쌍 하나로 답하고 끝난다 — 두 색으로는 캐릭터 한 명을 못 칠한다.

## 무엇을 만드나 (쉽게 말하면)

홈 검색창 위에 탭 둘을 둔다 — **색감 추천**(지금 그대로) · **캐릭터 색감**(새것). 캐릭터 탭에서 외형을 한 문장 쓰면
**부위 여섯**(피부 · 머리 · 눈 · 상의 · 하의 · 강조)의 색과 재질을 카드 한 장으로 준다. 말한 색("빨간 머리")은
그대로 고정하고, 나머지는 문장의 **인상**으로 고른 배색 쌍과 규칙으로 채운다. 저장하면 지금의 파생 저장과 같은
길로 `/saved` 에 남고 언리얼·유니티 수치로 내보내진다.

## 지키는 원칙 (기존 것 그대로)

- **LLM 은 색에 닿지 않는다.** LLM 이 하는 일은 문장을 읽어 *부위 → 색 낱말* 과 *인상 한 줄* 을 뽑는 것뿐이다.
  헥스는 전부 **코퍼스 80색**(배색사전 16쌍 32색 + 씨앗 풀 24쌍 48색)이거나 그 HSL 연산 결과다. **지어낸 색 0.**
- **없어도 돈다.** Ollama 가 없으면 정규식 폴백 파서로, 검색이 배색 쌍을 못 고르면 코퍼스 첫 쌍으로 물러선다.
  화면에는 LLM 언급이 없다(31단계 지시).
- **화면이 보낸 색을 안 믿는다.** 저장은 *부위 → 색 낱말 · 종족 · 배색 쌍 id* 만 받고 서버가 색을 다시 계산한다.
- **숫자는 `src/` 에, 낱말은 `data/` 에.** `data/structures.json` ↔ `src/expand.js` 와 같은 나눔.

## 색을 정하는 규칙

### 부위 여섯과 출처

| 부위 | 말했으면 | 안 말했으면 | 쉽게 말하면 |
|---|---|---|---|
| 상의 | 그 색 낱말 → 코퍼스 최근접 | 배색 쌍의 **바탕**(채도 낮은 쪽) | 인상을 대표하는 큰 면 |
| 강조 | 최근접 | 배색 쌍의 **강조**(채도 높은 쪽) | 장식·무기·포인트 |
| 하의 | 최근접 | 상의를 HSL 로 어둡게 (l −0.18 · s ×0.85) | 상의와 같은 계열, 한 단 어둡게 |
| 머리 | 최근접 | 상의 색상각 ±40° 안의 코퍼스 색 중 상의보다 어두운 것(명도차 ≥ 0.15) | 옷과 어울리는 어두운 머리 |
| 눈 | 최근접 | 강조 색상각 ±30° 안의 코퍼스 색 중 지각 채도가 가장 높은 것 | 강조와 호응하는 또렷한 눈 |
| 피부 | 최근접 | **종족표** → 그 낱말의 대표 색 · 없으면 따뜻한 뉴트럴 (h 15~45° · s ≤ 0.45 · l ≥ 0.6, 상의와 명도차 최대) | 아래 우선순위 |

- **피부 우선순위**: ① 직접 말한 색 > ② 종족 낱말(로봇·트롤 …) > ③ 따뜻한 뉴트럴.
- **이웃 명도차**: 안 말한 부위를 **규칙으로** 고를 때(머리 · 피부 뉴트럴) 이미 정해진 이웃(피부↔머리 · 피부↔상의)과
  명도차 **0.12 이상**인 후보만 받는다. 하의는 상의에서 −0.18 이라 늘 만족한다. 후보가 없으면 가장 가까운 것을 쓰고
  응답 `warnings` 에 남긴다. 상의↔강조는 배색 쌍의 판단이라 안 건드린다 — "톤 통일" 쌍은 일부러 명도가 같다.
- **피부 뉴트럴 조건**은 HSL 채도가 아니라 지각 채도(`perceivedChroma`)로 본다 — 밝은 살구색은 HSL s 가 0.9 를 넘어
  HSL 채도로는 걸러진다 `[실측]`. 조건: h 10~50° · 지각 채도 ≤ 0.35 · l ≥ 0.6.
- **같은 헥스를 두 부위에 안 쓴다**(말한 색은 예외 — 사용자가 같은 색을 두 번 말할 수 있다).
- 각 색은 `source` 를 든다 — `spoken`(말한 색) · `pair`(배색 쌍) · `creature`(종족표) · `rule`(규칙). `rule` 은
  `basis`(출발한 코퍼스 헥스)를 함께 든다. 게이트가 `basis` 에서 다시 계산해 대조한다.

수치(−0.18 · ×0.85 · ±40° · ±30° · 0.12 · 0.15 · 뉴트럴 범위)는 전부 `[판단]` 이고 `src/character.js` 한 곳에 둔다.

### 색 낱말 → 코퍼스 색

`data/character-words.json` 이 **낱말**을, `src/color-words.js` 가 **범위 숫자**를 든다. 낱말 id 마다 색상각 범위와
톤 조건이 있고, 코퍼스 80색 중 그 조건에 드는 것을 **HSL 거리**로 가장 가까운 순으로 낸다. 조건에 드는 색이 없으면
범위 중심(h · s · l)과의 거리로 전체에서 고른다. 코퍼스 실측 `[실측]`: 검정은 있다(씨앗 풀 Black #111314) · **흰색은 없다** —
"흰" 은 가장 밝고 채도 낮은 것(아이보리 #F5ECC2 부근)이 된다. 이것은 알려진 한계로 적는다. 80항목 중 유일 헥스는 70개(씨앗
풀이 색을 공유한다) — 규칙은 헥스로 중복을 거른다.

회색·흰색은 HSL 채도가 아니라 **지각 채도**(`c`)로 가른다 — HSL s ≤ 0.2 로 두면 세이지그린(#719470, s 0.14)이 회색에 든다 `[실측]`.

| 낱말 id | 표면형(예) | 범위 `[판단]` |
|---|---|---|
| red | 빨간·빨강·붉은·적 | h 345~15 |
| orange | 주황·오렌지·주홍 | h 15~45 · l ≥ 0.4 |
| yellow | 노란·노랑·황 | h 45~70 |
| gold | 금색·금빛·황금·(복합어 금발) | h 36~60 · l 0.4~0.8 |
| green | 초록·녹색·연두·풀색 | h 70~170 |
| teal | 청록·옥색·틸 | h 160~200 |
| blue | 파란·파랑·푸른·남색·하늘 | h 195~260 |
| purple | 보라·자주·라벤더·퍼플 | h 260~320 |
| pink | 분홍·핑크·장미 | h 320~350 · l ≥ 0.5 |
| brown | 갈색·밤색·브라운·구릿빛 | h 15~45 · l ≤ 0.45 |
| black | 검은·검정·까만·흑 | l ≤ 0.25 |
| white | 흰·하얀·백색·(복합어 은발·백발) | l ≥ 0.8 · 지각 채도 ≤ 0.3 |
| gray | 회색·잿빛·은색·은빛 | 지각 채도 ≤ 0.12 · l 0.3~0.85 |

유채색 낱말(hue 가 있는 것)은 HSL s ≥ 0.15 를 함께 건다 — 안 걸면 회색이 "빨강" 범위에 든다.

`src/color-words.js` 의 id 집합과 `data/character-words.json` 의 id 집합은 **같아야 한다**(게이트 S34-G2).

### 종족표 `data/creatures.json` `[판단]`

낱말이 문장에 **있으면**(LLM 안 거침 — 표를 직접 대조, Ollama 없어도 같게 돎) 피부 색 낱말과 재질을 준다.
피부 낱말은 위 색 낱말 id 여야 한다. `skin: null` 은 "사람 피부 → 뉴트럴" 이다.

| 낱말 | 피부 | 재질 |
|---|---|---|
| 로봇·기계·안드로이드·사이보그 | gray | metal |
| 트롤·오크·고블린·오우거 | green | — |
| 좀비·언데드·구울 | gray | matte |
| 악마·데몬·마족 | red | — |
| 유령·고스트·망령 | white | emissive |
| 슬라임 | green | gloss |
| 외계인·에일리언 | green | gloss |
| 천사 | white | gloss |
| 엘프·드워프·인간·사람·기사·마법사 | null(뉴트럴) | — |

문장에 종족 낱말이 둘 이상이면 **먼저 나온 것**을 쓴다.

## 파서 `src/describe.js`

- LLM(Ollama `/api/chat`, `format: "json"`, `structure.js` 와 같은 호출 모양·`STRUCTURE_TIMEOUT_MS` 와 같은 20초 예산)에
  **부위 여섯과 색 낱말 id 목록**을 프롬프트로 주고 `{"parts":{"머리":"red",...},"impression":"..."}` 을 받는다.
- `parseDescription(raw)` 가 거른다 — 표에 없는 부위·색 낱말 id·문자열 아닌 값·프로토타입 이름을 버린다.
  `impression` 은 120자로 자르고, 비면 **문장 전체**다. 헥스가 응답에 있어도 닿는 길이 없다(S17-G7 과 같은 경계).
- **폴백(정규식)**: 색 낱말 표면형 바로 뒤(공백 0~1)에 부위 표면형이 오면 잡는다 — "빨간 머리", "검은 갑옷"(갑옷 → 상의).
  부위 표면형도 `data/character-words.json` 의 `parts` 에 둔다(피부·살결 / 머리·머리카락·헤어 / 눈·눈동자 / 상의·옷·갑옷·
  셔츠·코트·망토·드레스·로브 / 하의·바지·치마 / 강조·포인트·장식·무기·검). 인상은 문장 전체.
- 반환: `{parts, creature, impression, from: "llm"|"fallback", model?, elapsedMs?, error?}`. 종족은 LLM 결과와 무관하게
  표 대조로 정한다. 모델·네트워크 실패로 던지지 않는다.

## 흐름과 API

`GET /api/character?q=<문장>` (빈 문장·서식 문자만 → 400, `cleanQuery`)

1. `describe(q)` 와 `selectFinishes(q, 부위 여섯, 캐릭터 기본 재질표)` 를 **나란히** 부른다(서로 안 쓴다).
2. `pipeline.resolve(impression, 3)` — `route === "palette"` 이고 결과가 있으면 1위가 배색 쌍. 아니면(진단·못 잡음)
   코퍼스 첫 쌍 `pair-01`, `palette.from: "fallback"`.
3. `composeCharacter({parts, creature, pair, corpus})` — 순수 함수, 위 규칙.
4. 종족표에 재질이 있으면 `finishes.assignments.피부` 를 그것으로 덮는다(결정적 규칙이 LLM 판단보다 앞선다).

응답:

```json
{
  "query": "...",
  "parse": { "parts": {"피부":null,"머리":"red","눈":null,"상의":"black","하의":null,"강조":null},
             "creature": null, "impression": "차가운 성격의 기사", "from": "llm", "model": "...", "elapsedMs": 0, "error": null },
  "palette": { "id": "pair-07", "name": "...", "from": "search", "route": "palette", "confident": true },
  "colors": [ { "role": "피부", "hex": "#F5ECC2", "name": "아이보리", "source": "rule", "basis": "#F5ECC2" }, "... 여섯, 순서 고정" ],
  "warnings": [],
  "finishes": { "assignments": {...}, "names": {...}, "ids": [...], "from": "llm|fallback", "model": null, "elapsedMs": null, "error": null },
  "elapsedMs": 0
}
```

오류 원문(`parse.error` · `finishes.error`)은 루프백 밖에서 숨긴다 — `/api/expand` 와 같은 경계.

## 재질

`src/material.js` 에 **캐릭터 기본 재질표 `CHARACTER_FINISH_BY_ROLE`** 을 따로 둔다 — 피부 무광 · 머리 광택 · 눈 광택 ·
상의 무광 · 하의 무광 · 강조 발광. 화면용 표 `DEFAULT_FINISH_BY_ROLE` 에 섞지 않는다: S16-G11 · S17-G8 이 그 표를
"파생 구조의 실제 역할과 정확히 같다" 로 잠가 두었고, 그 잠금은 옳다(죽은 항목을 잡는다). `EV_BY_ROLE` 에 다섯 역할을
더한다(피부 0.5 · 머리 1 · 눈 2 · 상의 1 · 하의 0.5 `[판단]`, 강조는 이미 4). `selectFinishes(query, roles, defaults)` 가
기본표를 인자로 받아 두 표를 다 쓴다(기본값은 지금 표라 기존 호출은 안 바뀐다).

## 저장 · `/saved` · 내보내기

- `POST /api/saved/character` — 받는 것: `query`(≤ 200자) · `parts`(부위 → 색 낱말 id | null) · `creature`(id | null) ·
  `paletteId` · `shares?` · `finishes?` · `note?`. **색은 안 받는다.** 서버가 `composeCharacter` 로 다시 계산한다
  (`store.js` 규칙 4). 모르는 낱말·부위·배색 쌍은 거른다(`pickFinishes` 와 같은 태도 — 거부가 아니라 걸러내기, 단
  `paletteId` 가 없으면 400).
- 항목은 **`kind: "derived"` · `structureId: "character"`** · `seedId: paletteId` · `mode: "light"` · `name: "캐릭터 — <문장 40자>"` ·
  `principle: <인상>` · `source: "캐릭터 규칙 [판단]"` · `seedLabel: <배색 쌍 이름>` · 색 여섯(`role·hex·ratio`) · `finishes` ·
  `character: {query, parts, creature}` · `characterKey`(parts+creature+paletteId 직렬화 — 같은 키면 덮어쓰며 비율·재질·메모 이어받기).
  나머지 필드는 `saveDerived` 와 같다.
- `/saved` 는 `savedFields` 가 `structureId === "character"` 를 알아 배지 "캐릭터", 좌표 [배색 쌍 · 설명(문장)] 을 낸다.
  스와치·6색 슬라이더·재질 줄·메모·삭제는 지금 파생 항목 그대로 돈다(`shareBounds(6)` 하한 10 — 6×10 ≤ 100 `[실측]`).
- 엔진 내보내기(`unreal`·`unity`)는 파생과 같은 길로 나간다. `enginePalette` 의 `id` 를 캐릭터는 저장 id 로 둔다 —
  같은 배색 쌍의 캐릭터 둘이 `pair-07-character-light` 로 겹치지 않게. CSS·JSON 은 지금처럼 파생을 세어서 뺀다.

## 화면

- `public/index.html`: 검색창 바로 위에 `role="tablist"` — **색감 추천** · **캐릭터 색감**(버튼, `aria-selected`, 방향키 이동).
  캐릭터 탭 예시 칩 3개(`data-tab="character"`). 결과 영역은 탭마다 따로(`#results` · `#character`), 안 보이는 쪽은 `hidden`.
- `public/app.js`: 제출 시 탭에 따라 `/api/search` 또는 `/api/character`. 탭을 바꾸면 입력은 그대로, 안내문·버튼
  글자("추천 받기" ↔ "색 맞추기")·보이는 결과 영역·예시 칩만 바뀐다. `?tab=character` 로 열면 그 탭. 선택한 탭은
  `localStorage`(`tonefirst:tab`)에 — 저장을 만지는 자리는 `ui.js` 의 `modeStore` 옆 **같은 한 곳**(S23-G6).
- 카드: `structureCard` 를 그대로 쓴다 — `{id:"character", name:"캐릭터 부위별 색", source:"배색 쌍 <이름>", principle:<인상>, colors}` 를
  구조처럼 넘기면 스와치·6색 슬라이더·재질 고르개·저장 버튼이 그대로 온다. 그 아래에 **출처 줄**(부위마다 말한 색 /
  배색 쌍에서 / 종족 / 규칙)을 붙인다. 배색 쌍이 폴백이면 "인상을 못 읽어 기본 배색을 썼습니다" 한 줄. 모드 토글 없음.
- 대화 내역: `recordTurn` 에 `route: "character"` 를 허용하고 `topKind: "character"` · `topLabel: <배색 쌍 이름>`.
  `history.js` 라벨 "캐릭터", "다시 묻기" 링크에 `&tab=character`.

## Ollama 없을 때 / 실패할 때

| 실패 | 결과 |
|---|---|
| Ollama 없음 · 시간 초과 · JSON 불량 | 정규식 폴백 파서, `parse.from: "fallback"`, 인상 = 문장 전체 |
| 검색이 진단으로 가거나 저신뢰 | `pair-01`, `palette.from: "fallback"`, 화면 한 줄 |
| 재질 배정 실패 | 캐릭터 기본표(지금 `selectFinishes` 폴백과 같은 길) |
| 저장 본문에 색·모르는 낱말 | 색은 무시하고 재계산, 모르는 낱말은 걸러 낸다 |

어느 경우도 500 이 아니고, 어느 경우도 화면에 "LLM" 이 안 뜬다.

## 파일

| 파일 | 무엇 |
|---|---|
| `data/character-words.json` (새) | 색 낱말 id → 표면형 · 부위 id → 표면형. `_grade: "[판단]"` |
| `data/creatures.json` (새) | 종족 낱말 → 피부 색 낱말 · 재질. `_grade: "[판단]"` |
| `src/color-words.js` (새) | 낱말 id → 범위 숫자 · `nearestCorpus(wordId, corpus, used)` · `findCreature(text)` · `loadCharacterWords()` |
| `src/describe.js` (새) | LLM 파서 · `parseDescription` · 정규식 폴백 · `describe(query)` |
| `src/character.js` (새) | `CHARACTER_ROLES` · `composeCharacter({parts, creature, pair, corpus})` 순수 함수 · 수치 전부 |
| `src/material.js` | `CHARACTER_FINISH_BY_ROLE` · `EV_BY_ROLE` 다섯 역할 |
| `src/finish.js` | `selectFinishes(query, roles, defaults = DEFAULT_FINISH_BY_ROLE)` |
| `src/store.js` | `saveCharacter` · `recordTurn` 이 `character` 경로 허용 |
| `src/export.js` | 캐릭터 항목의 엔진 id |
| `server.js` | `GET /api/character` · `POST /api/saved/character` · 코퍼스 80색 모음 |
| `public/index.html` · `app.js` · `ui.js` · `app.css` · `history.js` | 탭 · 캐릭터 카드 · `tabStore` · `savedFields` 캐릭터 분기 · 라벨 |
| `scripts/check-stage34.mjs` (새) · `GATES.md` · `README.md` | 게이트 10개(227 → 237) |

## 게이트 (34단계, 검사기가 구현보다 먼저)

| 게이트 | 쉽게 말하면 |
|---|---|
| S34-G1 | 파서가 쓰레기를 버린다 — 표 밖 부위·낱말·헥스·프로토타입 이름. 폴백이 "빨간 머리"·"검은 갑옷" 을 잡고 "머리 빨간" 은 안 잡는다. 인상은 비면 문장 전체 |
| S34-G2 | 낱말표와 범위표의 id 집합이 같다 · 종족표의 피부 낱말이 전부 낱말표에 있다 · 모든 낱말이 코퍼스 80색 중 하나로 간다(결정적) · 데이터 파일에 숫자·헥스 없음 |
| S34-G3 | **지어낸 색 0** — 픽스처 10건의 모든 헥스가 코퍼스 80색이거나 `basis`(코퍼스)에서 검사기 사본 규칙으로 다시 계산한 값과 같다 |
| S34-G4 | 말한 부위는 고정된다 · 종족이 피부를 정한다(로봇 → gray+metal · 트롤 → green) · 말한 피부가 종족을 이긴다 · 종족 없으면 뉴트럴(음성 대조) |
| S34-G5 | 픽스처 10건마다 색상각 30° 구획이 정한 하한 이상(유채색 픽스처는 3 — 검정·회색·뉴트럴 피부는 구획에 안 세거나 한 구획에 몰리므로 4 는 못 지킨다 `[판단]`; 회색 픽스처는 1~2) · 규칙으로 고른 이웃끼리 명도차 ≥ 0.12 · 여섯 부위 순서 고정 · 헥스 중복 없음 |
| S34-G6 | Ollama 없이 `/api/character` 가 돈다 — 폴백 파서 · 배색 쌍 · 6색 · 빈 q 400 · 홈 HTML 에 "LLM" 없음 |
| S34-G7 | 스텁 Ollama 가 헥스·엉뚱한 부위를 실어 보내도 응답에 안 닿는다 · 모델 인상이 검색에 쓰인다(`from: "llm"`) |
| S34-G8 | 저장 왕복 — 본문의 가짜 색을 무시하고 재계산 · `/api/saved` 에 6색 파생 항목 · unreal/unity 에 6역할(로봇이면 피부 metallic 1) · CSS/JSON 은 건너뜀 · `savedFields` 가 "캐릭터" |
| S34-G9 | 화면 정적 — 탭 둘(문구 고정) · 캐릭터 탭이 `/api/character` 로 감 · `localStorage` 는 여전히 `ui.js` 한 곳 · 내역 라벨 · `structureCard` 재사용 |
| S34-G10 | 회귀 — S4 7 · S16 11 · S17 12 · S18 13 · S20 7 · S22 6 · S23 6 · S31 3 = 65 |

## 버린 대안

| 대안 | 왜 버렸나 |
|---|---|
| 별도 `/character` 페이지 | 대표 지시 — 홈 검색창 위 탭 둘 |
| LLM 이 헥스를 직접 고름 | "LLM 은 색에 닿지 않는다" 를 깬다. 같은 문장에 매번 다른 색, 게이트 불가 |
| 배색 쌍 하나로 여섯 부위를 전부 파생(HSL 만) | 두 색상각 안에서만 돈다 — "a 로 진행하면 두 색만 추천되지 않나" (대표 지적). 코퍼스 풀 규칙을 더해 4~5 색상각 |
| 종족 판정을 LLM 에 맡김 | 결정적이지 않고 Ollama 없으면 결과가 달라진다. 낱말 대조가 더 정직하다 |
| 저장 본문에 색을 실음 | `store.js` 규칙 4 위반. 부위·종족·배색 쌍 id 만으로 재계산 가능 |
| `DEFAULT_FINISH_BY_ROLE` 에 여섯 역할을 더함 | S16-G11 · S17-G8 이 "죽은 항목" 으로 잡는다. 그 잠금은 옳다 |

## 되돌리는 법

`server.js` 에서 두 라우트를 빼고 `src/{character,describe,color-words}.js` · `data/{character-words,creatures}.json` 을
지우면 이전이다. `material.js` 의 캐릭터 표와 EV 다섯 줄, `finish.js` 의 세 번째 인자(기본값이라 호출부 무변경), `store.js`
의 `saveCharacter` 와 `character` 경로, 화면의 탭을 되돌린다. 이미 저장된 캐릭터 항목은 `structureId: "character"` 라
`/saved` 가 파생으로 그리고 내보내기는 `applyFinish` 가 역할을 몰라 `skippedBroken` 으로 세어 준다(조용히 깨지지 않는다).
