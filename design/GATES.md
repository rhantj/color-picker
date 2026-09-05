# GATES — colorpicker 사이트 초안 디자인 캔버스

`$DESIGN_SKILL` 은 `/design` 스킬 번들의 `design/` 디렉터리다. 버전이 올라가면 경로가 바뀌므로
고정해 적지 않는다. G3 을 돌리기 전에 셸에서 잡는다:

```bash
base=$(cygpath -u "${TMPDIR:-$TEMP}" 2>/dev/null || echo "${TMPDIR:-/tmp}")
hit=$(find "$base/claude/bundled-skills" -name seed-canvas.mjs 2>/dev/null | sort | tail -1)
[ -n "$hit" ] && export DESIGN_SKILL=$(dirname "$hit") || echo "번들 못 찾음 — /design 을 다시 호출한다"
```

없으면 `/design` 을 다시 호출해 번들을 재추출한다.

G1 아트보드 3종(홈/대화내역/추천조합)과 canvas.json이 작업 트리에 존재한다
    CHECK: node -e "const fs=require('fs');const need=['Main.dc.html','History.dc.html','Saved.dc.html','canvas.json'];const miss=need.filter(f=>!fs.existsSync(f));console.log(miss.length?'MISSING '+miss.join(','):'GATE_G1_OK')"
    EXPECT: GATE_G1_OK

G2 모든 .dc.html이 support.js 헤드 라인을 원형 그대로 유지한다
    CHECK: node -e "const fs=require('fs');const bad=fs.readdirSync('.').filter(f=>f.endsWith('.dc.html')).filter(f=>!fs.readFileSync(f,'utf8').includes('<script src=\"./support.js\"></script>'));console.log(bad.length?'MISSING_SUPPORT '+bad.join(','):'GATE_G2_OK')"
    EXPECT: GATE_G2_OK

G3 시드된 캔버스 파일이 헬퍼 --check 를 통과한다
    CHECK: node "$DESIGN_SKILL/seed-canvas.mjs" --check tonefirst-color-canvas.html
    EXPECT: ok:

G4 색 결정이 color-design 원칙과 어긋나지 않는다 (UI 고채도 강조는 파랑 1색, 나머지는 저채도 뉴트럴)
    MANUAL: 3개 아트보드 소스에서 배경·텍스트·보더 색이 저채도 뉴트럴이고, 고채도 색은 추천 스와치와 accent(#006EB8)에만 쓰였는지 사람이 확인
