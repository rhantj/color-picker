# 접어 둔 카드가 접힌 채로도 다 보인다 ("나머지 N가지 보기" · "다른 결 보기")

43단계 브라우저 실측에서 발견. 원인은 14단계 코드부터 있었다.

## 증상

다듬은 답의 "다른 결 2가지 보기" 버튼이 접힘 상태(`aria-expanded="false"`)인데 나머지 두 카드가 그대로 보였다. 실측:

```
restHidden: true · restDisplay: "grid"
```

## 원인

`public/app.css` 의 `.expand__grid { display: grid; }` 가 HTML `hidden` 속성의 기본 스타일(`display: none`)을 덮는다 — 작성자 CSS 가
브라우저 기본보다 앞선다. 펼치기의 "나머지 N가지 보기"(14단계)도 같은 `expand__grid` + `hidden` 이라 **원래부터 안 접혔을 것이다**(추정 —
그 화면은 42단계부터 옛 검색으로 물러설 때만 나와 직접 확인하지는 않았다). `.status[hidden]` · `.thread[hidden]` 처럼 다른 자리는 규칙을
따로 두었는데 이 격자만 빠졌다.

## 해결

```css
.expand__grid[hidden] { display: none; }
```

## 재발 방지

`S43-G10` 이 이 규칙이 있는지 본다(지우면 실패 — 변형 검사로 확인). 더 넓은 방지책(모든 `hidden` 에 `!important`)은 다른 화면을 건드려 하지 않았다.
