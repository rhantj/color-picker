# 2026-09-01 — 폰트 자립 (외부 의존 제거)

[5단계 문서](2026-09-01-stage5-ratio-control.md)에서 위생 항목으로 남겨 뒀던 것.

## 왜

로컬 LLM·로컬 검색으로 만든 도구인데 **폰트만 Google Fonts** 에 있었다. 오프라인이면 조용히
폴백으로 떨어지고, 그 사실을 화면이 알려주지도 않는다.

## 무엇을 골랐나

이 기계에 설치된 285개 패밀리를 조사해 한글 지원 폰트를 추린 뒤 사용자가 골랐다.

| 자리 | 전 (Google Fonts) | 후 (로컬) |
|---|---|---|
| 제목 | Gowun Batang | **HYSinMyeongJo** |
| 본문·UI | IBM Plex Sans KR | **Noto Sans KR** |
| 헥스·수치 | IBM Plex Mono | **Cascadia Mono** |

세 화면의 `<link>` 를 전부 제거했다. 외부 요청 **0건**(`performance.getEntriesByType('resource')` 로 확인).

## 함정 둘 — 실측이 두 번 나를 속였다

### ① "굵기가 안 갈린다" 는 측정 착시

`Noto Sans KR` 을 한글 텍스트로 재니 300~700 이 **전부 같은 폭(438.4px)** 이었다. 굵기가 적용되지
않는 줄 알았다.

**한글은 글자 폭이 고정(전각)이라 굵기가 달라져도 advance width 가 안 변한다.** 라틴 문자로 다시
재니 465.1 / 480.3 / 491.5 / 506.1 / 520.5 로 전부 갈렸다.

> 한글 폰트의 굵기·서체 해석 여부는 **한글 폭으로 판정하면 안 된다.** 라틴으로 재거나 픽셀을 비교한다.

### ② 폰트 이름이 목록과 CSS 에서 다르다

설치 목록에는 `HYSinMyeongJo-Medium` 으로 보인다(GDI 이름). CSS 에서 그 이름을 쓰면 **조용히
폴백한다** — 오류도 경고도 없다. `HY신명조` 도 안 잡힌다. 잡히는 이름은 **`HYSinMyeongJo`** 뿐이었다.

폭만으로는 확신할 수 없었다(명조 계열은 한글 폭이 720 으로 다 같다). 캔버스에 같은 글자를 그려
픽셀을 세어 확정했다:

| 비교 | 다른 픽셀 |
|---|---|
| HYSinMyeongJo vs Batang | 2,382 |
| HYSinMyeongJo vs 폴백 | 4,554 |
| Batang vs Batang (대조군) | 0 |

## 확인한 것

| 자리 | 실제 적용 |
|---|---|
| 제목 | `HYSinMyeongJo` 700 54px |
| 리드문 | `Noto Sans KR` 300 16px |
| 카드 제목 | `Noto Sans KR` 600 22px |
| 헥스 | `Cascadia Mono` 400 12px |
| 외부 폰트 요청 | 0건 |

제목의 700 굵기에서 한글 폭이 변하지 않는다(합성 볼드는 폭이 늘어난다 — Batang 은 520 → 529.3).
합성이 아니라 실제 굵기가 적용된다.

**S2-G8 신설** — 세 화면에 외부 링크가 없고, CSS 토큰이 이 기계에 실제로 있는 이름을 쓰는지 검사한다.
이름이 한 글자만 틀려도 조용히 폴백하므로 문자열까지 확인한다. Google Fonts 링크를 되돌리면
`index.html 가 Google Fonts 를 부른다` 로 FAIL.

게이트 **35개 전부 통과**.

## 남은 폰트 후보 (다른 인상이 필요할 때)

조사 결과를 남긴다. **CSS 에서 잡히는 이름 기준**이다.

| 종류 | 잡히는 이름 |
|---|---|
| 명조·세리프 | `HYSinMyeongJo` · `Batang` · `Gungsuh` · `HYMyeongJo-Extra`(= `HY견명조`) |
| 고딕·산세리프 | `Noto Sans KR`(Light/Medium/Black 별도 패밀리) · `Malgun Gothic` · `NanumGothic` · `Dotum` · `Gulim` · `New Gulim` |
| 손글씨 | `Nanum Pen Script` |
| 고정폭 | `Cascadia Mono` · `Consolas` |

**안 잡히는 이름:** `HYSinMyeongJo-Medium` · `HY신명조` · `HY중고딕` · `HYHeadLine-Medium` ·
`HYGothic-Medium` · `BatangChe` · `Malgun Gothic Semilight` · `Noto Sans KR DemiLight` · `Nanum Myeongjo`.
사용자 설치 폰트 디렉터리는 비어 있다.

## 다음에 할 일

[5단계 문서](2026-09-01-stage5-ratio-control.md)의 목록 그대로다.

1. **B — 내보내기(CSS 변수 / JSON).** 색을 찾아도 가져갈 방법이 없다.
2. **C — 대화 이어하기.**
3. 저장 메모 입력 칸.
4. 알려진 한계: 저신뢰 질의 동시 요청 시 LLM 중복 호출, 대화·저장 목록이 무인증 GET.
