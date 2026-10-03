# 변형 검사 사본(.mut-bak)이 커밋됐다

2026-10-03, 47단계 작업 중 발견.

## 증상

`git status` 에 지운 적 없는 파일이 "삭제됨" 으로 떴다.

```
 D server.js.mut-bak
 D src/compose.js.mut-bak
```

46단계 커밋 `4eda6f4` 에 `server.js.mut-bak`(888줄) · `src/compose.js.mut-bak`(489줄)이 들어가 main 에 푸시돼 있었다.

## 원인

변형 검사 스크립트(스크래치패드의 `mutate46.mjs`)는 파일을 고치기 전에 `<파일>.mut-bak` 사본을 만들고, 게이트를 돌린 뒤 사본을 **덮어써 되돌리기만**
하고 사본은 지우지 않는다. 46단계에서 첫 실행 뒤에는 `find … -name "*.mut-bak" -delete` 로 지웠지만, 놓친 변형 셋만 다시 돌린 두 번째 실행
(`mutate46b.mjs`) 뒤에는 지우지 않은 채 `git add -A` 로 커밋했다.

## 해결

47단계 커밋에서 두 파일을 지웠다. 내용은 그때의 `server.js` · `src/compose.js` 사본이라 비밀이나 사용자 데이터는 없다.

## 재발 방지

- `.gitignore` 에 `*.mut-bak` — 사본이 남아도 `git add -A` 가 집지 않는다.
- 커밋 전 `git status --short` 에 `??` 로 낯선 파일이 있으면 본다(이번에는 그 줄이 `scripts/check-stage46.mjs` 와 섞여 지나갔다).
