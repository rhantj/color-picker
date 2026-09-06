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

## 11단계 — 씨앗 조합을 배색 구조로 불리기 (A: 색 파생 엔진)

배색사전 16쌍은 **전부 2색**이다. 두 색만으로는 바탕·본문·강조가 있는 화면을 못 짠다.
그래서 씨앗 한 쌍을 배색 구조로 불린다.

**구조를 지어내지 않는다.** 8개 카탈로그는 전부 `color-design` 스킬 본문에서 왔고 항목마다
`source` 를 단다 — 기법표 4개(톤온톤·톤인톤·보색대비·유사색대비), 웹UI 매핑 2개(명도 스케일·
강조색), 진단표 2개(따뜻한 뉴트럴·공기원근). **파생 규칙(몇 도, 몇 %)은 원전에 없으므로
데이터가 아니라 `src/expand.js` 한 곳에 둔다** — `public/ratio.js` 가 면적을 다루는 것과 같은 자리다.

**형광선을 두 겹으로 지킨다.** S11-G9 는 원전 전체에서 읽은 상한 하나로 보고, S11-G10 은 톤을
씨앗에서 그대로 가져오는 세 구조를 **씨앗별로** 본다. G9 만 두면 씨앗이 늘 때 상한이 올라가
예전에 잡던 회귀를 놓친다 — 실제로 씨앗 풀이 들어오며 0.729 에서 0.871 로 올라갔고, G9 가
잡았던 톤인톤 회귀(0.776)가 그 아래로 들어갔다(리뷰 지적, 재현 확인).

**헥스는 LLM 이 만들지 않는다.** 씨앗 색의 HSL 연산으로만 나온다. 그래야 같은 질의가 같은 색을
내고, 명도 대비를 게이트로 검사할 수 있다. LLM 이 하는 일(8개 중 5개 선택·순서)은 11-B 다.

S11-G1 구조 카탈로그 8개가 필수 필드와 출처 표기를 갖추고, 원전에 없는 파생 규칙이 데이터에 섞이지 않았다
    CHECK: node scripts/check-stage11.mjs S11-G1
    EXPECT: S11_G1_OK

S11-G2 헥스 ↔ HSL 왕복이 원전 80색(코퍼스 32 + 씨앗 풀 48) 전부에서 원래 헥스를 되돌린다
    CHECK: node scripts/check-stage11.mjs S11-G2
    EXPECT: S11_G2_OK

S11-G3 같은 씨앗·같은 구조는 언제나 같은 헥스를 낸다 (무작위·시간 의존 없음)
    CHECK: node scripts/check-stage11.mjs S11-G3
    EXPECT: S11_G3_OK

S11-G4 파생색이 씨앗에서 계산된 값이다 — 상수 헥스를 데이터·코드에 심지 않았다
    CHECK: node scripts/check-stage11.mjs S11-G4
    EXPECT: S11_G4_OK

S11-G5 구조마다 색이 2~4개다 ("색은 두세 가지로 끝낸다" — color-design 규칙 1)
    CHECK: node scripts/check-stage11.mjs S11-G5
    EXPECT: S11_G5_OK

S11-G6 구조가 이름값을 한다 — 톤온톤은 색상각을 안 움직이고, 보색은 180±20°, 유사색은 60° 안이다
    CHECK: node scripts/check-stage11.mjs S11-G6
    EXPECT: S11_G6_OK

S11-G7 명도 위계를 말하는 구조는 명도가 뭉치지 않는다 (명·중·암이 실제로 벌어져 있다)
    CHECK: node scripts/check-stage11.mjs S11-G7
    EXPECT: S11_G7_OK

S11-G8 씨앗이 2색이 아니거나 헥스가 깨졌거나 구조 id 가 없으면 던지지 않고 빈 결과를 준다
    CHECK: node scripts/check-stage11.mjs S11-G8
    EXPECT: S11_G8_OK

S11-G9 파생색의 지각 채도가 원전 80색의 최대치를 넘지 않는다 (형광을 만들지 않는다)
    CHECK: node scripts/check-stage11.mjs S11-G9
    EXPECT: S11_G9_OK

S11-G10 톤을 씨앗에서 가져오는 구조(톤인톤·강조색·따뜻한 뉴트럴)는 자기 씨앗보다 쨍해지지 않는다
    CHECK: node scripts/check-stage11.mjs S11-G10
    EXPECT: S11_G10_OK

## 12단계 — 씨앗 전용 풀 (완료)

배색사전에서 큐레이션된 16쌍이 코퍼스의 전부였고, **원전 파일에 17번째가 없다**(실측: 헥스·쌍
단위로 대조해 빠진 것 0). 씨앗을 늘리려면 새 출처가 필요했다.

원서의 공개 전사본(348조합)에서 2색 조합 120개를 받아 24쌍을 골라 `data/seeds.json` 에 뒀다.
**전사본이 주는 것은 헥스와 원명뿐이다.** 유형(A~D)·색상각/톤 관계·인상 설명은 큐레이터의
판단이고 계산으로 재현되지 않는다 — 원전이 `보색` 이라 적은 7쌍의 색상각(113.8~177.4)과
`유사색` 6쌍(31.8~132.2)이 **겹치고 뒤집힌다.** 그래서 해설을 지어내지 않고, 대신
**검색 색인에 넣지 않는다.** 쓰임은 하나다 — 배색 구조로 불릴 씨앗.

그래서 이 단계의 게이트는 "씨앗이 늘었는가" 보다 **없는 해설이 슬며시 생기지 않는가**와
**검색 색인으로 새지 않는가**를 더 무겁게 본다.

S12-G1 씨앗 풀 24쌍이 헥스·원명·조합번호를 갖추고, 전사본에 없는 해설 필드가 하나도 없다
    CHECK: node scripts/check-stage12.mjs S12-G1
    EXPECT: S12_G1_OK

S12-G2 씨앗 풀이 검색 색인에 들어가지 않는다 — 실제 검색기를 보고, 헥스로 검색해도 안 나온다 (양성 대조 둘)
    CHECK: node scripts/check-stage12.mjs S12-G2
    EXPECT: S12_G2_OK

S12-G3 씨앗 풀이 코퍼스와 쌍도 색도 겹치지 않고, 강조 채도가 코퍼스 하한 위다 (무채색 씨앗 배제)
    CHECK: node scripts/check-stage12.mjs S12-G3
    EXPECT: S12_G3_OK

S12-G4 씨앗 풀이 없거나 깨져도 던지지 않고, 검색 경로가 이 파일에 묶이지 않는다
    CHECK: node scripts/check-stage12.mjs S12-G4
    EXPECT: S12_G4_OK

S12-G5 해설이 섞인 항목만 걸러내고 멀쩡한 항목은 남긴다 (파일 하나가 전부를 지우지 않는다, 양성 대조 포함)
    CHECK: node scripts/check-stage12.mjs S12-G5
    EXPECT: S12_G5_OK

S12-G6 씨앗 풀 24쌍이 8구조 전부로 확장되고, 화면 이름이 두 원명에서 조립된다
    CHECK: node scripts/check-stage12.mjs S12-G6
    EXPECT: S12_G6_OK

## 13단계 — 파생 팔레트를 화면에서 만지기 (11-B-1)

파생 팔레트는 3~4색인데 `public/ratio.js` 는 2색만 알았다. 코퍼스 2색에는 실측으로 정한 규칙이
있지만(D형 70:30, 바탕은 저채도 쪽) **3색 이상에는 원전도 실측도 없다.**

그래서 규칙을 지어내지 않는다. **기본은 균등 분할이고, 사용자가 슬라이더로 옮겨 확인한다.**
이 사이트가 "같은 헥스도 비율이 바뀌면 다른 색" 이라고 주장하므로, 규칙을 만드는 대신
그 주장을 만질 수 있게 하는 쪽을 골랐다.

**저장은 이 단계에 없다.** `normalizeRatio` 가 `[v, 100-v]` 로 2색에 못 박혀 있어 저장 경로
전체가 2색 전제다. 다색 저장은 별도 단계로 민다 — 여기서는 보고 만지는 것까지다.

S13-G1 3색 이상의 기본 비율이 균등 분할이고 합이 정확히 100 이다 (나머지 배분 포함)
    CHECK: node scripts/check-stage13.mjs S13-G1
    EXPECT: S13_G1_OK

S13-G2 2색 조합의 기존 면적 규칙이 그대로다 — D형 70:30 · 대등 50:50 (회귀)
    CHECK: node scripts/check-stage13.mjs S13-G2
    EXPECT: S13_G2_OK

S13-G3 슬라이더 재배분이 합 100 을 지키고 최소 지분 아래로 내려가지 않는다 (무작위 대입 포함)
    CHECK: node scripts/check-stage13.mjs S13-G3
    EXPECT: S13_G3_OK

S13-G4 `/api/expand` 가 씨앗 id 로 8구조를 주고, 코퍼스와 씨앗 풀 양쪽에서 찾는다
    CHECK: node scripts/check-stage13.mjs S13-G4
    EXPECT: S13_G4_OK

S13-G5 없는 씨앗·잘못된 입력·프로토타입 체인 이름에 4xx 로 답하고 서버가 죽지 않는다
    CHECK: node scripts/check-stage13.mjs S13-G5
    EXPECT: S13_G5_OK

S13-G6 파생 스와치의 글자색이 파생색 1000개 전부에서 대비 4.5:1 을 넘는다
    CHECK: node scripts/check-stage13.mjs S13-G6
    EXPECT: S13_G6_OK

S13-G7 화면이 파생 팔레트를 그리고 색마다 슬라이더를 붙인다 (정적 회귀 스모크)
    CHECK: node scripts/check-stage13.mjs S13-G7
    EXPECT: S13_G7_OK

## 14단계 — LLM 이 배색 구조 다섯을 고른다 (11-B-2)

13단계는 여덟 장을 전부 보여줬다. 원래 요청은 **"가장 많이 쓰는 5개를 뽑아서"** 였고, 그 판단이
이 단계다. 8개 중 어느 다섯이 이 질의에 맞는지는 계산으로 안 나오므로 **LLM 이 하는 유일한 일**이다.

**LLM 은 색에 닿지 않는다.** 고르는 것은 구조 id 뿐이고 헥스는 여전히 `src/expand.js` 가
씨앗의 HSL 로만 만든다(S11). 그래서 모델이 무엇을 뱉든 화면에 없는 색이 생기지 않는다.

**LLM 이 없어도 돈다.** Ollama 가 죽어 있거나 응답을 못 알아들으면 카탈로그 앞 다섯으로 물러선다 —
그 다섯은 원전 1절 기법표 넷과 4절 첫 항목이라 임의로 고른 것이 아니다. 이 사이트의 전제가
"LLM 은 있으면 쓰고 없으면 안 쓴다" 이므로 물러서는 길이 반드시 있어야 한다.

**질의가 없으면 LLM 을 아예 부르지 않는다.** `/saved` 처럼 질의가 없는 자리에서 펼치면
고를 근거가 없다. 근거 없이 부르는 호출은 비용만 쓰고 답을 지어낸다.

S14-G1 모델 응답에서 카탈로그에 없는 id·중복·개수 이상을 걸러낸다 (순수 함수, 음성 대조 포함)
    CHECK: node scripts/check-stage14.mjs S14-G1
    EXPECT: S14_G1_OK

S14-G2 Ollama 를 못 쓰면 카탈로그 앞 다섯으로 물러서고 펼치기가 그대로 동작한다
    CHECK: node scripts/check-stage14.mjs S14-G2
    EXPECT: S14_G2_OK

S14-G3 질의가 없으면 LLM 을 호출하지 않는다 (요청을 퍼부어도 모델이 안 불린다)
    CHECK: node scripts/check-stage14.mjs S14-G3
    EXPECT: S14_G3_OK

S14-G4 응답이 8구조를 그대로 담고 선택은 별도 필드다 — 선택이 구조를 지우거나 지어내지 않는다
    CHECK: node scripts/check-stage14.mjs S14-G4
    EXPECT: S14_G4_OK

S14-G5 선택된 id 가 전부 실재하고 다섯 개이며 순서가 응답에 그대로 실린다
    CHECK: node scripts/check-stage14.mjs S14-G5
    EXPECT: S14_G5_OK

S14-G6 LLM 실패·시간 초과가 펼치기를 막지 않는다 (느린 모델을 세워 두고 확인)
    CHECK: node scripts/check-stage14.mjs S14-G6
    EXPECT: S14_G6_OK

S14-G7 화면이 고른 다섯을 먼저 그리고 나머지 셋은 접어 둔다 (정적 회귀 스모크)
    CHECK: node scripts/check-stage14.mjs S14-G7
    EXPECT: S14_G7_OK

S14-G8 모델이 응답해도 쓸 수 있는 구조를 못 주면 "LLM 이 골랐다" 고 말하지 않는다 (양성 대조 둘)
    CHECK: node scripts/check-stage14.mjs S14-G8
    EXPECT: S14_G8_OK

S14-G9 서버가 넘기는 카탈로그로 만든 프롬프트에 각 구조의 principle·detail 이 실제로 들어 있다
    CHECK: node scripts/check-stage14.mjs S14-G9
    EXPECT: S14_G9_OK

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

- **게이트 99개 중 동시성을 보는 것은 S8-G6 하나뿐이다.** 나머지는 전부 순차 호출이라, 겹친 요청에서
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
