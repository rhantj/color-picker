# GATES — colorpicker 구현

단계마다 완료 조건을 먼저 쓰고, 그 단계가 끝나면 검사를 다시 돌려 증거로 보고한다.
검사 없이 "완료" 로 적지 않는다.

## 1단계 — 코퍼스 + BM25 전문 검색 (완료)

S1-G1 코퍼스 16쌍이 필수 필드·헥스 형식을 만족하고, 면적 비율 같은 원전에 없는 값이 섞이지 않았다
    CHECK: node scripts/check-stage1.mjs S1-G1
    EXPECT: S1_G1_OK

S1-G2 대표 질의 5건의 1위가 기대 조합과 일치한다
    CHECK: node scripts/check-stage1.mjs S1-G2
    EXPECT: S1_G2_OK

S1-G3 어미·조사 조각만 겹치는 질의는 저신뢰로 판정된다 (양성 대조 포함)
    CHECK: node scripts/check-stage1.mjs S1-G3
    EXPECT: S1_G3_OK

S1-G4 의존성 0 — node_modules 없이 node 만으로 돌아간다
    CHECK: node scripts/check-stage1.mjs S1-G4
    EXPECT: S1_G4_OK

## 2단계 — HTTP 서버 + 홈 화면 (완료)

S2-G1 서버가 뜨고 `/` 가 홈 화면 HTML 을, `/app.css`·`/app.js` 를 200 으로 준다
    CHECK: node scripts/check-stage2.mjs S2-G1
    EXPECT: S2_G1_OK

S2-G2 `/api/search` 가 1위·confident·stage·매칭 항을 담은 JSON 을 주고, 저신뢰 질의는 confident=false
    CHECK: node scripts/check-stage2.mjs S2-G2
    EXPECT: S2_G2_OK

S2-G3 API 가 면적 비율을 들고 나오지 않고(화면이 계산), 초안의 색 토큰이 스타일시트에 있다
    CHECK: node scripts/check-stage2.mjs S2-G3
    EXPECT: S2_G3_OK

S2-G4 잘못된 입력과 경로 이탈이 막히고, 응답에 내부 경로가 새지 않는다 (정상 요청 양성 대조 포함)
    CHECK: node scripts/check-stage2.mjs S2-G4
    EXPECT: S2_G4_OK

S2-G5 스와치 위 헥스 라벨이 코퍼스 32색 전부에서 대비 4.5:1 을 넘는다 (중간 회색 포함)
    CHECK: node scripts/check-stage2.mjs S2-G5
    EXPECT: S2_G5_OK

S2-G6 UI 토큰 조합 대비가 4.5:1 을 넘고, 제출 버튼 disabled 규칙이 글자색을 지정한다
    CHECK: node scripts/check-stage2.mjs S2-G6
    EXPECT: S2_G6_OK

S2-G7 면적 규칙(D형 70:30·바탕은 저채도 쪽 / 대등형 50:50)이 코퍼스 16쌍 전부에서 지켜진다
    CHECK: node scripts/check-stage2.mjs S2-G7
    EXPECT: S2_G7_OK

S2-G8 폰트가 외부에 의존하지 않는다 — 세 화면에 외부 링크가 없고, 토큰이 이 기계에 실제로 있는 이름을 쓴다
    CHECK: node scripts/check-stage2.mjs S2-G8
    EXPECT: S2_G8_OK

## 3단계 — Ollama 수명주기 + 의도 분기·질의 재작성 (완료)

S3-G1 Ollama 가 없어도 서버가 뜨고 홈 화면·검색이 그대로 동작한다
    CHECK: node scripts/check-stage3.mjs S3-G1
    EXPECT: S3_G1_OK

S3-G2 Ollama 가 죽어 있으면 자동으로 띄우고 준비될 때까지 기다린다
    CHECK: node scripts/check-stage3.mjs S3-G2
    EXPECT: S3_G2_OK

S3-G3 이미 떠 있으면 새로 띄우지 않는다 (사용자가 띄운 인스턴스를 건드리지 않는다)
    CHECK: node scripts/check-stage3.mjs S3-G3
    EXPECT: S3_G3_OK

S3-G4 동시 호출이 기동 시도를 공유한다 (프로세스가 여러 개 뜨지 않는다)
    CHECK: node scripts/check-stage3.mjs S3-G4
    EXPECT: S3_G4_OK

S3-G5 사용자 입력이 프로세스 실행에 닿지 않는다 — 정적 스모크 + 요청을 퍼부어도 기동되지 않는 행위 검사
    CHECK: node scripts/check-stage3.mjs S3-G5
    EXPECT: S3_G5_OK

S3-G6 ready 로 확정된 뒤 Ollama 가 죽으면 상태가 따라간다 (죽은 인스턴스를 준비됨으로 보고하지 않는다)
    CHECK: node scripts/check-stage3.mjs S3-G6
    EXPECT: S3_G6_OK

S3-G7 진단 질의가 팔레트로 라우팅되지 않는다 — 1단계 경로와 LLM 경로 양쪽 + 팔레트 양성 대조
    CHECK: node scripts/check-stage3.mjs S3-G7
    EXPECT: S3_G7_OK

S3-G8 전문 검색이 잡으면 LLM 을 아예 호출하지 않는다 (rewrite=null, 1단계, 왕복 1초 미만)
    CHECK: node scripts/check-stage3.mjs S3-G8
    EXPECT: S3_G8_OK

S3-G9 붙여 쓴 재작성어를 코퍼스 어휘로 되돌린다 — 모델에 의존하지 않는 결정적 검사
    CHECK: node scripts/check-stage3.mjs S3-G9
    EXPECT: S3_G9_OK

S3-G10 서버 기동 후 모델 워밍업이 실제로 실행된다 (정의·import 만 있고 호출부가 없던 결함의 재발 방지)
    CHECK: node scripts/check-stage3.mjs S3-G10
    EXPECT: S3_G10_OK

## 4단계 — 대화 내역 · 추천 받은 조합 (완료)

S4-G1 `/history`·`/saved` 화면이 뜨고 공용 스크립트가 200 으로 실린다
    CHECK: node scripts/check-stage4.mjs S4-G1
    EXPECT: S4_G1_OK

S4-G2 대화가 서버 재시작을 넘어 남고 route·topId 가 보존된다
    CHECK: node scripts/check-stage4.mjs S4-G2
    EXPECT: S4_G2_OK

S4-G3 저장한 조합이 면적 비율까지 복원되고, 중복 저장·삭제가 동작한다
    CHECK: node scripts/check-stage4.mjs S4-G3
    EXPECT: S4_G3_OK

S4-G4 서버가 클라이언트가 보낸 색·이름·id·시각을 믿지 않는다 (코퍼스 값 양성 대조 포함)
    CHECK: node scripts/check-stage4.mjs S4-G4
    EXPECT: S4_G4_OK

S4-G5 쓰기 입력 검증 — 모르는 id·빈 질의·과대 본문·열거값 위조가 막히고 내부 경로가 안 샌다
    CHECK: node scripts/check-stage4.mjs S4-G5
    EXPECT: S4_G5_OK

S4-G6 상한(턴·메모)·손상 파일 보존·코드포인트 단위 절단·프로토타입 오염·진단 별칭 유일성
    CHECK: node scripts/check-stage4.mjs S4-G6
    EXPECT: S4_G6_OK

S4-G7 쓰기 요청이 이 화면에서 온 것인지 검사한다 (text/plain·cross-site 차단, same-origin 양성 대조)
    CHECK: node scripts/check-stage4.mjs S4-G7
    EXPECT: S4_G7_OK

## 5단계 — 면적 비율 조정 (완료)

S5-G1 조정한 비율로 저장되고, 기본값도 함께 남아 되돌릴 수 있다 (비율 미전송 시 기본값 양성 대조)
    CHECK: node scripts/check-stage5.mjs S5-G1
    EXPECT: S5_G1_OK

S5-G2 저장된 조합의 비율을 나중에 바꿀 수 있고 재시작을 넘어 남으며, 색은 안 바뀐다
    CHECK: node scripts/check-stage5.mjs S5-G2
    EXPECT: S5_G2_OK

S5-G3 범위 밖·소수·문자열·0·100 비율이 거부되고, 거부된 요청이 아무것도 바꾸지 않는다 (경계값 양성 대조)
    CHECK: node scripts/check-stage5.mjs S5-G3
    EXPECT: S5_G3_OK

S5-G4 화면 슬라이더 범위와 서버 허용 범위가 같은 상수에서 온다 (어긋나면 사용자가 움직인 값이 거부된다)
    CHECK: node scripts/check-stage5.mjs S5-G4
    EXPECT: S5_G4_OK

S5-G5 조정해 둔 비율이 재저장으로 사라지지 않는다 (명시한 비율이 이기고, 기본값 복귀 후에는 이어받지 않는다)
    CHECK: node scripts/check-stage5.mjs S5-G5
    EXPECT: S5_G5_OK

S5-G6 defaultRatio 가 없던 옛 저장 항목도 기본값으로 되돌릴 수 있다 (코퍼스에서 채워 넣는다)
    CHECK: node scripts/check-stage5.mjs S5-G6
    EXPECT: S5_G6_OK

## 6단계 — 내보내기 (완료)

S6-G1 내보낸 CSS 가 색뿐 아니라 면적(-area)과 역할(ground/accent)을 담는다. 대등 조합에는 서열 이름을 안 붙인다
    CHECK: node scripts/check-stage6.mjs S6-G1
    EXPECT: S6_G1_OK

S6-G2 내보낸 JSON 이 파싱되고 색마다 ratio·role 을 담는다
    CHECK: node scripts/check-stage6.mjs S6-G2
    EXPECT: S6_G2_OK

S6-G3 내보낸 CSS 의 구조가 유효하다 — 중괄호·주석 균형, 선언마다 세미콜론, 식별자에 한글 없음
    CHECK: node scripts/check-stage6.mjs S6-G3
    EXPECT: S6_G3_OK

S6-G4 알 수 없는 형식은 거부되고, 저장이 없어도 빈 결과를 알린다 (기본 형식 양성 대조)
    CHECK: node scripts/check-stage6.mjs S6-G4
    EXPECT: S6_G4_OK

S6-G5 화면이 서버 형식을 그대로 쓰고, 복사 실패를 사용자에게 알린다
    CHECK: node scripts/check-stage6.mjs S6-G5
    EXPECT: S6_G5_OK

S6-G6 프로토타입 체인 이름(`__proto__` 등)으로 요청해도 거부되고, 무엇보다 서버가 죽지 않는다
    CHECK: node scripts/check-stage6.mjs S6-G6
    EXPECT: S6_G6_OK

S6-G7 메모가 CSS 주석을 조기에 닫지 못한다 (주석 밖으로 아무것도 새지 않고, 메모는 손질된 채 남는다)
    CHECK: node scripts/check-stage6.mjs S6-G7
    EXPECT: S6_G7_OK

S6-G8 내보낸 CSS 에 양방향 텍스트 제어문자가 남지 않는다 (에디터 표시 순서 스푸핑 방어)
    CHECK: node scripts/check-stage6.mjs S6-G8
    EXPECT: S6_G8_OK

## 7단계 — 대화 이어하기 (완료)

S7-G1 `/api/conversations?id=` 가 그 대화 하나만 주고, 없는 id 는 404 로 분명히 알린다 (전체 목록 양성 대조)
    CHECK: node scripts/check-stage7.mjs S7-G1
    EXPECT: S7_G1_OK

S7-G2 이어 쓴 턴이 같은 대화에 순서대로 붙고 새 대화를 만들지 않는다
    CHECK: node scripts/check-stage7.mjs S7-G2
    EXPECT: S7_G2_OK

S7-G3 내역 화면이 이어서·다시 묻기 링크와 앵커를 만든다 (id·질의를 인코딩해서)
    CHECK: node scripts/check-stage7.mjs S7-G3
    EXPECT: S7_G3_OK

S7-G4 홈 화면이 대화의 실재를 확인하고, 못 이어 쓰면 그렇다고 말한다. 기록 실패도 삼키지 않는다
    CHECK: node scripts/check-stage7.mjs S7-G4
    EXPECT: S7_G4_OK

## 8단계 — 저장 메모 (완료)

메모는 스키마·저장·표시·내보내기가 이미 다 돼 있었고 **입력만 없었다.** 그래서 이 단계의
게이트는 "메모가 저장되는가" 가 아니라 **끊긴 곳이 이어졌는가**와 **이어붙이면서 생기는
데이터 유실**을 본다.

S8-G1 저장 요청에 실린 메모가 저장되고 목록에 실린다. 길이 상한을 넘으면 잘린다
    CHECK: node scripts/check-stage8.mjs S8-G1
    EXPECT: S8_G1_OK

S8-G2 메모 없이 같은 조합을 재저장해도 이전 메모가 남는다 (비율 이어받기와 같은 규칙)
    CHECK: node scripts/check-stage8.mjs S8-G2
    EXPECT: S8_G2_OK

S8-G3 빈 메모나 공백만 있는 메모를 보내면 지운다 — 보존과 삭제를 구분한다 (S8-G2 의 음성 대조)
    CHECK: node scripts/check-stage8.mjs S8-G3
    EXPECT: S8_G3_OK

S8-G4 홈 화면이 메모 입력을 만들고 저장 요청에 실어 보낸다 (정적 검사)
    CHECK: node scripts/check-stage8.mjs S8-G4
    EXPECT: S8_G4_OK

S8-G5 실제 저장 경로로 넣은 메모가 CSS 주석과 JSON 양쪽 내보내기에 실린다
    CHECK: node scripts/check-stage8.mjs S8-G5
    EXPECT: S8_G5_OK

S8-G6 같은 조합에 저장이 겹쳐도 메모가 소실되지 않는다 (병합 기준을 직렬화 안에서 읽는다)
    CHECK: node scripts/check-stage8.mjs S8-G6
    EXPECT: S8_G6_OK

S8-G7 저장 요청이 떠 있는 동안에는 어떤 경로로도 저장 버튼이 다시 열리지 않는다 (정적 검사)
    CHECK: node scripts/check-stage8.mjs S8-G7
    EXPECT: S8_G7_OK

## 9단계 — 저장 화면 메모 편집 (완료)

8단계는 메모를 **적는** 길만 열었다. 고치는 길도 지우는 길도 없었다. 이 단계의 게이트는
"편집이 되는가" 만이 아니라 **편집이 다른 것을 건드리지 않는가**와 **새 경로가 기존 방어를
그대로 물려받는가**를 본다 — 쓰기 경로를 늘릴 때 조용히 빠지는 것이 그 둘이다.

S9-G1 저장된 메모를 바꿀 수 있고, 빈 값이나 공백만 보내면 지운다
    CHECK: node scripts/check-stage9.mjs S9-G1
    EXPECT: S9_G1_OK

S9-G2 잘못된 id 와 없는 항목은 거부하고, 상한을 넘는 메모는 잘라 낸다
    CHECK: node scripts/check-stage9.mjs S9-G2
    EXPECT: S9_G2_OK

S9-G3 메모를 바꿔도 비율·색·저장 시각·나머지 항목이 그대로다
    CHECK: node scripts/check-stage9.mjs S9-G3
    EXPECT: S9_G3_OK

S9-G4 저장 화면이 메모 입력과 저장 경로를 만든다 (정적 검사)
    CHECK: node scripts/check-stage9.mjs S9-G4
    EXPECT: S9_G4_OK

S9-G5 새 쓰기 경로에도 출처 검사가 걸린다 (기존 경로 양성 대조)
    CHECK: node scripts/check-stage9.mjs S9-G5
    EXPECT: S9_G5_OK

S9-G6 요청이 준 id 가 조회 비교 밖으로 새지 않는다 (경로 조립·동적 접근·값 혼입 금지)
    CHECK: node scripts/check-stage9.mjs S9-G6
    EXPECT: S9_G6_OK

## 10단계 — 진단에서 팔레트로 (완료)

진단은 "무엇이 문제인가" 까지만 답하고 "그럼 어떤 조합인가" 로 넘어갈 길이 없었다.
**연결을 지어내지 않는 것이 이 단계의 핵심이다** — 두 코퍼스가 공유하는 어휘는 실측으로
18개 중 2개뿐이고, 나머지는 축 자체가 팔레트 관계를 말하지 않는다. 그래서 게이트는
"연결이 되는가" 보다 **연결되지 않아야 할 것이 연결되지 않는가**를 더 무겁게 본다.

S10-G1 축이 팔레트 관계 어휘를 그대로 쓰는 진단은 그 관계의 조합을 전부 그리고 그것만 가리킨다
    CHECK: node scripts/check-stage10.mjs S10-G1
    EXPECT: S10_G1_OK

S10-G2 관계를 말하지 않는 축에는 조합을 붙이지 않는다 (16개 음성 대조)
    CHECK: node scripts/check-stage10.mjs S10-G2
    EXPECT: S10_G2_OK

S10-G3 어휘는 팔레트 코퍼스에서 읽는다 — 손으로 쓴 대응표가 없다
    CHECK: node scripts/check-stage10.mjs S10-G3
    EXPECT: S10_G3_OK

S10-G4 긴 어휘가 짧은 어휘보다 먼저 잡힌다 (`보색에 가까움` 이 `보색` 에 먹히지 않는다)
    CHECK: node scripts/check-stage10.mjs S10-G4
    EXPECT: S10_G4_OK

S10-G5 API 응답이 연결을 담고, 연결이 없으면 그 사실을 담는다
    CHECK: node scripts/check-stage10.mjs S10-G5
    EXPECT: S10_G5_OK

S10-G6 화면이 연결된 조합을 그리고, 연결이 없으면 없다고 말한다. 검색 폴백을 되살리지 않는다 (정적 검사)
    CHECK: node scripts/check-stage10.mjs S10-G6
    EXPECT: S10_G6_OK

S10-G7 관계값이 비었거나 없는 코퍼스에서도 연결을 지어내지 않고 죽지도 않는다
    CHECK: node scripts/check-stage10.mjs S10-G7
    EXPECT: S10_G7_OK

### 알려진 한계

- **내보낸 CSS 가 브라우저에서 실제로 파싱되는지는 게이트가 못 본다.** S6-G3 은 구조만 센다.
  실제 CSSOM 파싱은 브라우저에서 확인했다 — `new CSSStyleSheet().replaceSync()` 로 오류 없이 파싱되고,
  `--pair-10-ground` 가 `rgb(253,212,189)`, `--pair-10-ground-area`(75%)가 폭 1080px 로 적용됐다.

- **S8-G4 · S8-G7 은 `public/app.js` 를 정규식으로 보는 정적 검사다.** 회귀 스모크지 동작 증명이
  아니다. 실제 동작은 브라우저에서 따로 확인했다. S8-G4 는 주석을 먼저 걷어내고 `note` 가 객체에
  실리는 형태인지까지 보므로, 전송 코드를 지우고 주석만 남기는 회귀는 잡는다. 그래도 정적 검사의
  한계는 남는다 - 표기가 다른 동등 구현(`setAttribute`)에는 실패로 반응한다.

- **길이 상한은 그래핌 클러스터 단위로 자른다**(`Intl.Segmenter`). 코드포인트로 자르면 결합
  문자와 ZWJ 이모지가 상한 근처에서 깨진다. 의존성은 늘지 않는다 - Node 와 브라우저에 기본이다.

- **메모는 두 곳에서 쓴다** - 홈에서 저장할 때(8단계)와 `/saved` 에서 편집할 때(9단계).
  **지우는 것은 `/saved` 에서만 된다.** 홈은 빈 값을 아예 안 보내기 때문이다(안 보낸 것은
  이어받기로 읽힌다). 저장 시점도 다르다 - 홈은 버튼, `/saved` 는 포커스를 뗄 때다.

- **진단에서 조합으로 가는 연결은 18개 중 2개뿐이다.** 축이 팔레트 관계어(`유사색` `보색`
  `톤 통일` `절제 안 함`)를 그대로 쓰는 진단만 이을 수 있다. 나머지 16개는 축이 `톤축 (명도)`
  `면적·순서` 처럼 **진단의 축이지 팔레트의 관계가 아니라서** 이을 근거가 없다.
  대안 둘을 실측으로 버렸다 — 처방 BM25 검색은 18개 중 17개가 "확신" 이지만 `면적·순서` 가
  `테라코타 × 회분홍` 을 무는 낱말 겹침이고, 팔레트 `tags` 대조는 한 글자 태그(`독` `숲`)가
  다른 낱말 안에서 걸려 8개가 우연히 잡힌다. 코퍼스에 축→관계 대응을 손으로 넣으면 100% 가
  되지만 "원전에 없는 것은 코퍼스에 넣지 않는다" 를 깬다.

- **처방을 검색어로 넣는 폴백을 만들었다가 뺐다.** 18개 처방을 전부 검색한 결과 팔레트 0건 ·
  진단 18건이었고, 모두 **출발한 그 진단이 1위**였다. 처방 문장이 진단 코퍼스에서 온 텍스트라
  진단 색인에 가장 잘 맞기 때문이다. 제자리로 돌아오는 고리라 없앴다. S10-G6 이 부활을 막는다.

- **관계어를 부분 문자열로 찾는다. `무관` 이 실제 색상각 값이라 충돌 여지가 있다.**
  지금 18개 축 중 그 낱말을 쓰는 것은 없지만, 미래에 "명도와는 무관하게" 같은 축이 생기면
  오탐이 난다. 낱말 단위 정확 대조로 바꾸면 이 위험은 사라지지만 `보색 + 톤 절제 안 함` 의
  톤 값이 `절제 안 함` 이라 **지금 있는 연결 하나가 끊긴다.** 부분 문자열을 유지하고 S10-G2 가
  오탐을 감시하는 쪽을 골랐다.

- **S10-G6 은 정적 검사다.** 폴백 부활을 정규식으로 보므로 템플릿 리터럴이나 변수 한 단계로
  우회된다. 동작은 브라우저에서 따로 확인했다.

- **정적 검사가 주석을 걷어낼 때 문자열 안의 `//` 도 지운다.** `http://` 같은 URL 스킴은
  제외하도록 고쳤지만 `"a//b"` 형태는 여전히 먹힌다. 그 줄에 관계어나 검사 대상 낱말이 있으면
  게이트가 **거짓 통과**한다. 정규식으로 코드와 문자열을 가르는 것은 원리적으로 불가능하므로
  더 넓히지 않았다 — 넓히면 오탐과 미탐이 함께 는다. S8-G4 · S9-G4 · S10-G3 · S10-G6 이 해당한다.

- **게이트 67개 중 동시성을 보는 것은 S8-G6 하나뿐이다.** 나머지는 전부 순차 호출이라, 겹친 요청에서
  생기는 결함에 대해 "전부 통과" 는 아무 증거가 아니다. 실제로 저장 경합이 그렇게 통과했다.

- **양방향 텍스트 제어문자는 CSS 내보내기에서 지운다**(S6-G8). 재정렬 · 격리 · 표식 세 부류
  12자를 `safeComment` 의 지우는 단계에서 없앤다. CSS 파싱을 깨지는 않지만 에디터 표시 순서를
  뒤집을 수 있고(Trojan Source 계열), 이 출력의 용도가 다른 프로젝트에 붙여넣는 것이라 사람이
  눈으로 읽는 것이 곧 신뢰 근거이기 때문이다.
  **JSON 내보내기는 아직 지우지 않는다** - `note` 가 원문 그대로 나간다.

- `LIMITS.saved`(200)는 **도달할 수 없다.** 같은 조합을 중복 저장하지 않으므로 저장 가능한 최대치가
  코퍼스 크기(16)다. 상한은 코퍼스가 커질 때를 위한 것이고, 지금은 검사할 수 없어 게이트가 없다.

- **레이아웃 넘침(가로 스크롤)을 보는 게이트가 없다.** 의존성 0 이라 헤드리스 브라우저가 없고,
  `getBoundingClientRect` 로만 판정되는 것은 검사기로 만들 수 없다. 2026-09-06 에 375px 상단바
  넘침(scrollWidth 379)을 고쳤을 때도 확인은 전부 브라우저에서 손으로 했다 —
  `docs/session-resume/2026-09-06-mobile-topbar-overflow.md` 에 폭별 실측이 있다.
