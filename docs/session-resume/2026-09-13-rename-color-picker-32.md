# 2026-09-13 — 사이트 이름을 "Color Picker" 로 (32단계 · 대표 지시)

## 무엇을 했나

| 자리 | 전 | 후 |
|---|---|---|
| 워드마크 (세 화면 상단) | 톤먼저 · TONEFIRST (두 칸) | Color Picker (한 칸 — 새 이름이 라틴이라 라틴 칸을 뺐다) |
| `<title>` | 톤먼저 — 색 조합 추천 · 대화 내역 — 톤먼저 · 추천 받은 조합 — 톤먼저 | Color Picker — 색 조합 추천 · 대화 내역 — Color Picker · 추천 받은 조합 — Color Picker |
| 서버 기동 문구 | 톤먼저 · http://… | Color Picker · http://… |
| 내보내기 머리말 · `generatedBy` | "톤먼저 — 저장한 색 조합" · "톤먼저 (colorpicker)" | "Color Picker — 저장한 색 조합" · "Color Picker" |
| 내려받는 파일 이름 | tonefirst-palettes.css/json · tonefirst-unreal/unity.json | color-picker-palettes.css/json · color-picker-unreal/unity.json (서버 `FORMATS` 와 화면 `FILENAME` 둘 다) |
| README 제목 | color-picker (톤먼저) | Color Picker |

**안 바꾼 것(의도)**: 환경변수 `TONEFIRST_DATA_DIR`·`TONEFIRST_CORPUS_DIR`, 실행 설정 이름 `tonefirst`, 게이트 임시 폴더 접두
`tonefirst-gate-`. 사용자에게 보이는 이름이 아니라 내부 식별자이고, 바꾸면 게이트 수십 개와 실행 환경이 함께 흔들린다.
옛 세션 문서와 `GATES.md` 옛 절의 "톤먼저" 는 역사 기록이라 그대로 둔다.

## 게이트

3개 신설(221 → 224). 구현 전 G1·G2 실패 → 구현 후 통과. G3 는 화면·내보내기 회귀 23개(S2·S6·S20).

| 게이트 | 무엇 |
|---|---|
| S32-G1 | 정적 — 옛 이름 0 **그리고** 세 화면 제목·워드마크가 "Color Picker" · 파일 이름 사본 4개가 서버·화면 둘 다에 |
| S32-G2 | 서버 응답 — 기동 문구 · 세 화면 · 내보내기 4형식 본문에 새 이름, 옛 이름 없음 · 서버 파일 이름이 사본과 같음 |
| S32-G3 | S2 8 · S6 8 · S20 7 그대로 |

G2 는 처음에 `content-disposition` 헤더에서 파일 이름을 읽으려 했는데 서버는 그 헤더를 안 보낸다 — 파일 이름은 화면의
`download` 속성이 정한다. 서버 쪽 사양(`FORMATS`)과 화면 사본을 대조하는 것으로 바꿨다.

## 브라우저 실측 (localhost:4173)

| 폭 | 워드마크 | 상단바 | 가로 넘침 |
|---|---|---|---|
| 1280 | Color Picker, 한 줄 | 64px | 없음 |
| 700 | 한 줄(24px) | 113px (메뉴가 아랫줄 — 2026-09-06 실측과 같은 구간) | 없음 |
| 375 | 한 줄(24px, 125px 폭) | 149px | 없음 |

이름이 3글자에서 12글자로 길어졌지만 라틴 칸을 뺀 만큼 상쇄돼 상단바 줄바꿈 구간은 안 바뀌었다.

## 격리 리뷰 두 건

라운드 50, `typescript-reviewer` · `code-reviewer`. Critical 0. 둘 다 같은 P1 을 냈다.

| 지적 | 처리 |
|---|---|
| **P1 (2인) — 워드마크 구조가 바뀌었는데 상단바 줄바꿈 수치(136·572·636·700)를 재실측하지 않았다** | **맞다. 쟀다.** 워드마크 125px(옛 136), 636·700px 두 줄 · 701·768px 한 줄 · 375px 넘침 없음. 700 경계 유지. `app.css` 주석에 새 수치, `GATES.md` 알려진 한계에 "레이아웃은 게이트가 안 본다" |
| P2 — `.wordmark__ko` 에 영문이 들어간다 | **고쳤다.** `wordmark__name` |
| P2 — `design/` 목업과 `localStorage` 키 `tonefirst:mode` 에 옛 이름 | 의도적 제외. `design/` 은 서버가 안 내주는 초안, 키를 바꾸면 저장된 모드가 초기화된다. `GATES.md` 에 제외 목록으로 적었다 |

확인해 준 것: `generatedBy` 를 파싱하는 소비 코드 없음(옛 저장 호환 문제 없음) · `.wordmark__en` 잔여 규칙 없음 · G1 이 "옛 이름 없음 + 새 이름 있음" 양쪽을 잼 · 게이트 224 네 곳 일치.

## 지금 상태

- **커밋 `23a0cb2` 로 `main` 에 올라갔다** (`stage-32-rename-color-picker` 브랜치, 33단계 `baddc7c` 와 함께 `--ff-only` 머지, 원격 `rhantj/color-picker`).

## 확인 질문

1. 환경변수 이름은 왜 안 바꿨나요?
2. 내려받는 파일 이름이 두 곳(서버 · 화면)에 있는 이유와, 게이트가 둘을 어떻게 맞추나요?
