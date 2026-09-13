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


## 15단계 — 파생 팔레트의 명도 방향 (12-A0)

여덟 구조는 `color-design` 의 **웹·앱 UI 색 결정** 절에서 왔고, 거기서 바탕이 밝은 것은
기본값이다. 그래서 파생 결과의 바탕이 거의 전부 흰색에 가깝다 — 16쌍 × 8구조 128장 중
**112장(87.5%)의 바탕 명도가 l ≥ 0.90** 이다(실측). `네온 사인 빛의 어두운 사이버펑크` 가
정확히 pair-06 을 물어도(1단계 confident) 나오는 것은 흰 바탕이다.

게임 씬은 전제가 다르다. **명도 앵커에 거울 매핑을 두어 방향을 뒤집는다.** 근거는
`light.md` 의 명도 그루핑 — "명부·중간톤·암부 중 어느 덩어리가 가장 넓은 면적을 차지하는지".

**기본값은 바뀌지 않는다.** 어두운 바탕은 인자로만 나오고, 기존 출력은 한 글자도 달라지지
않는다(S15-G1). `expand.js` 에는 이미 S11 게이트 10개가 걸려 있어, 기본 출력이 그대로라면
그 열이 회귀할 경로가 없다.

**같은 단계에서 화면 결함 하나를 함께 고쳤다.** `.card--featured .swatch` 와
`.card:not(.card--featured) .swatch` 가 자손 선택자라, 13단계에서 파생 팔레트가 카드 **안**으로
들어오면서 그 안의 스와치까지 함께 잡았다 — featured 카드 안 8장이 폭 460px 로 고정되어 카드
(298px) 밖으로 **176px 넘쳤고**, normal 카드 안 8장은 높이가 42px → **128px** 로 부풀었다(실측).
직속 자식 선택자로 좁혔다. S15-G9 는 **정적 검사다** — 실행 시점 넘침은 여전히 못 본다
(아래 '알려진 한계' 참조). 브라우저 실측: 375·753·1425px 에서 넘침 0, 가로 스크롤 0.

**앵커를 안 쓰는 구조 둘은 거울이 아니다.** `톤인톤` 은 톤을 씨앗 명도의 평균에서 가져오므로
앵커가 없고, 그대로 뒤집으면 **어두운 씨앗이 오히려 밝아진다** — pair-06 의 톤인톤은
l=0.38 이라 반사하면 0.62 다. 그래서 톤인톤만 반사가 아니라 **어두운 쪽으로 접는다**
(`min(l, 1-l)`). `따뜻한 뉴트럴` 은 앵커를 직접 부르므로 거울이 그대로 적용된다.
이 차이 때문에 S15-G5 는 톤인톤을 뺀다 — 접기는 대합이 아니다.

S15-G1 기본 모드 출력이 변경 전 기준선과 한 글자도 다르지 않다 (씨앗 40 × 구조 8 = 320장)
    CHECK: node scripts/check-stage15.mjs S15-G1
    EXPECT: S15_G1_OK

S15-G2 어두운 모드 바탕이 실제로 어둡다 — 앵커 기반은 l <= 0.2, 톤인톤은 접기 정의와 정확히 일치
    CHECK: node scripts/check-stage15.mjs S15-G2
    EXPECT: S15_G2_OK

S15-G3 어두운 모드에서도 명도 단계 간격이 S11-G7 과 같은 기준(0.15)을 지킨다
    CHECK: node scripts/check-stage15.mjs S15-G3
    EXPECT: S15_G3_OK

S15-G4 어두운 모드 파생색이 안료 채도 상한을 넘지 않는다 (S11-G9·G10 과 같은 기준)
    CHECK: node scripts/check-stage15.mjs S15-G4
    EXPECT: S15_G4_OK

S15-G5 앵커 자리가 전부 거울 그대로다 — 여덟 구조 전부, 매핑은 대합이고 앵커 밖 명도를 지어내지 않는다
    CHECK: node scripts/check-stage15.mjs S15-G5
    EXPECT: S15_G5_OK

S15-G6 옵션 인자가 무엇이든 던지지 않고 기본 모드로 읽히며, expandAll 이 옵션을 그대로 넘긴다
    CHECK: node scripts/check-stage15.mjs S15-G6
    EXPECT: S15_G6_OK

S15-G7 채도 상한은 거울을 타지 않는다 — 어두운 모드 바탕도 바탕 역할의 상한(0.3)을 지킨다
    CHECK: node scripts/check-stage15.mjs S15-G7
    EXPECT: S15_G7_OK

S15-G8 거울이 닿으면 안 되는 자리에 닿지 않는다 — 씨앗 원본·앵커 밖·거울 고정점 (양성 대조 포함)
    CHECK: node scripts/check-stage15.mjs S15-G8
    EXPECT: S15_G8_OK

S15-G9 카드 스와치 규칙이 카드 안의 파생 스와치까지 잡지 않는다 — 직속 자식 선택자 (정적 검사)
    CHECK: node scripts/check-stage15.mjs S15-G9
    EXPECT: S15_G9_OK

S15-G10 응답이 구조마다 `colors`·`colorsDark` 를 둘 다 주고 둘이 실제로 다르다 — `colors` 는 엔진 기본 모드와 동일(회귀)
    CHECK: node scripts/check-stage15.mjs S15-G10
    EXPECT: S15_G10_OK

S15-G11 `mode` 는 서버 파라미터가 아니다 — 쿼리에 붙여도 응답이 완전히 같다 (양성 대조 포함)
    CHECK: node scripts/check-stage15.mjs S15-G11
    EXPECT: S15_G11_OK

S15-G12 어두운 모드 파생색에서도 스와치 글자색 대비가 4.5:1 을 넘는다 (S13-G6 과 같은 기준·음성 대조)
    CHECK: node scripts/check-stage15.mjs S15-G12
    EXPECT: S15_G12_OK

S15-G13 토글이 이미 받아 둔 데이터로만 다시 그린다 — 네트워크·LLM 재호출 없음 (정적 검사)
    CHECK: node scripts/check-stage15.mjs S15-G13
    EXPECT: S15_G13_OK

S15-G14 요청 핸들러가 구조 카탈로그를 다시 읽지 않는다 — expandAll 이 캐시를 넘겨받는다 (정적 검사)
    CHECK: node scripts/check-stage15.mjs S15-G14
    EXPECT: S15_G14_OK

S15-G15 모드 토글이 다시 그리기 **전에** 포커스를 자기에게 확정한다 (정적 검사)
    CHECK: node scripts/check-stage15.mjs S15-G15
    EXPECT: S15_G15_OK

**어두운 모드를 화면에 내보내는 방식(G10~G13).** 엔진에만 있던 어두운 모드를 사용자 토글로
꺼냈다. **모드를 서버에 보내지 않는다** — `/api/expand` 는 `q` 로 LLM 을 불러 여덟 중 다섯을
고르므로, 토글마다 재요청하면 **같은 질의인데 보이는 다섯이 바뀐다**(그리고 매번 ~500ms 다).
대신 서버가 `colors`·`colorsDark` 를 한 응답에 함께 실어 보내고, 토글은 이미 받아 둔 것으로
다시 그리기만 한다. **실측: 토글 시 `/api/` 요청 증가 0건.** 두 게이트가 그 결정의 양쪽을
막는다 — G11 이 서버에 파라미터가 생기는 것을, G13 이 화면이 다시 부르는 것을 막는다.

**토글 범위는 펼침 영역마다 하나다.** 상태가 그 영역 클로저 안에만 있어 공유 상태가 안 생기고,
카드마다 다른 모드로 나란히 비교할 수 있다(실측: 1번 카드 밝은 바탕 `rgb(234,238,241)` ·
2번 카드 어두운 바탕 `rgb(42,43,34)` 동시). `localStorage` 는 쓰지 않는다 — 이 저장소에 전례가
0건이고, 상태는 전부 서버 `var/` 에 있다. 저장에도 넣지 않는다(13단계가 이미 미룬 자리다).

**G13 이 색 고르기를 `structureColors` 로 빼게 했다.** 처음엔 전부 정적 검사였고, `dark` 와
`light` 를 뒤바꾼 뮤테이션(토글이 정반대로 도는 결함)이 **게이트 아홉을 전부 통과했다.**
카드 조립은 DOM 이 필요해 정적으로 남지만, 어느 색을 고르는지는 순수 함수라 게이트가 직접
불러 대조한다. 뮤테이션 13종이 전부 잡히는 것을 확인했다.

## 16단계 — 재질(PBR 머티리얼) 엔진 (완료)

배색사전(코퍼스 16쌍 · 씨앗 풀)은 1930년대 안료 견본이라 **발광도 금속도 말하지 않는다.**
같은 헥스라도 무광 콘크리트인지 젖은 금속인지에 따라 화면에서 전혀 다르게 읽히는데, 그 축을
배색사전이 말해 주지 않는다. 11단계가 배색 구조를 `color-design` 스킬 본문에서 가져온 것과 같은
방식으로, 재질은 같은 스킬의 `references/light.md` 에서 가져온다.

**이 단계는 순수 엔진이다.** 화면·API·LLM 이 없다. 11단계가 정확히 이 모양으로 성공했고,
그때 측정이 설계를 세 번 바꿨다 — 화면을 먼저 붙였으면 그 세 번을 화면 뒤에서 찾았어야 한다.

**두 번에 나눠 넣었다.** 16-A 가 비발광 셋(무광·광택·메탈릭, G1~G6·G10), 16-B 가 발광과
그에 딸린 것(G7~G9·G11)이다. 자른 자리가 **채도 면제**인 이유는 스펙이 "면제(G7)와 EV
상한(G8)은 짝이라 하나만 있으면 면제가 구멍" 이라고 못 박았기 때문이다 — **둘을 함께 들일 수
있을 때 들였다.** G11(기본 배정)은 스펙 4.5 가 요구하지만 번호를 안 준 것이라 뒤에 붙였다.

**금속은 색을 끌어올리는 파생 없이 성립하지 않는다** `[실측]`. 금속의 base color 는 안료색이
아니라 반사율(F0)이라 밝은 구간에만 존재한다. 코퍼스 32색 중 금속 범위(min 채널 >= 180)에
드는 것은 **2개뿐**이고(아이보리 #F5ECC2 · 살구 #FDD4BD), 실제 입력인 파생 역할색으로 넓혀도
밝은 모드 28.4% · 어두운 모드 13.4% 다. 자홍 #B73F74 를 그대로 Metallic=1 로 주면
"어두운 자주색 금속" 이라는, 현실에 없는 물질이 된다.

**클램프는 채널별이 아니라 아핀 사상이다.** `clamp(c, 50, 243)` 을 채널마다 걸면 색상각이
무너진다 — 흑록 #0F1A14 은 세 채널이 전부 50 으로 눌려 **회색**이 된다. 아핀 사상
(`c' = k·c + b`, k > 0)은 채널 차의 비를 보존하므로 색상각이 정확히 남는다(실측 최대 이동
0.400도, 8비트 반올림 몫). 대신 채도가 k 배로 줄고 명도가 옮겨간다 — 그것이 "물질의 범위
안으로 들어온다" 의 실제 내용이다.

**base color 범위(50~243 / 180~255)의 출처는 원전이 아니다** `[문헌]`. 언리얼 Physically
Based Materials 지침이고, 이 저장소에서 인게임으로 확인하지 않았다. 유니티에도 같은 값이
맞는지 검증되지 않았다.

S16-G1 재질 카탈로그에 숫자·헥스가 없다 — 파생 규칙은 코드에만 (source 의 절 번호만 예외)
    CHECK: node scripts/check-stage16.mjs S16-G1
    EXPECT: S16_G1_OK

S16-G2 파생이 결정론적 — 호출 순서를 뒤집어도 같은 출력, 난수·시각 의존 없음
    CHECK: node scripts/check-stage16.mjs S16-G2
    EXPECT: S16_G2_OK

S16-G3 코드에 상수 헥스가 없다 — 모든 색이 씨앗에서 계산된다 (정적 + 행위 양쪽)
    CHECK: node scripts/check-stage16.mjs S16-G3
    EXPECT: S16_G3_OK

S16-G4 비금속 base 가 PBR 범위 안 — 밖이던 것은 전부 들어오고, 안이던 것은 안 움직인다
    CHECK: node scripts/check-stage16.mjs S16-G4
    EXPECT: S16_G4_OK

S16-G5 금속 base 가 min >= 180 이고 **색상각이 씨앗에서 벗어나지 않는다**
    CHECK: node scripts/check-stage16.mjs S16-G5
    EXPECT: S16_G5_OK

S16-G6 metallic 이 0 또는 1 뿐이고, 금속과 비금속이 실제로 갈린다
    CHECK: node scripts/check-stage16.mjs S16-G6
    EXPECT: S16_G6_OK

S16-G10 불량 입력에서 조용히 망가지지 않는다 — 전부 MaterialError (양성 대조 포함)
    CHECK: node scripts/check-stage16.mjs S16-G10
    EXPECT: S16_G10_OK

**채도 상한을 면제하는 자리는 `emission` 하나뿐이다.** 11단계는 파생색의 지각 채도가 안료
상한(씨앗 실측 **0.8706**)을 못 넘게 막는 게이트 둘을 갖고 있는데 **네온은 정의상 그 위다.**
임의 예외가 아니라 원전이 이미 나눠 놓은 구분이다 — 하이라이트와 발광에 실리는 것은 물체
색이 아니라 광원 색이고, **광원은 안료가 아니다.** `baseColor` 는 어떤 재질에서도 면제되지
않는다(실측: 전 재질 base 최대 지각채도 **0.7569**, 상한까지 여유 0.1137).

**면제한 자리에 EV 상한을 새로 문다.** 채도를 풀어 준 대신 에너지를 묶는다. 안 물면 상한이
그냥 사라진 것이고, 11단계에서 `#00ffee`(지각 채도 1.000) 사고를 만든 것이 정확히 그런
빈자리였다. `EV_MAX = 4` 이고 **가장 밝은 역할(강조)이 거기 딱 붙어 있다** — 여유를 두면
상한이 아무것도 안 묶는다. 값 자체에는 근거가 없다 `[판단]`.

**EV 표는 상한을 참조하지 않고 같은 값을 독립적으로 적는다.** 처음엔 `강조: EV_MAX` 로 썼고
뮤테이션이 뚫었다 — 상한을 99 로 올리면 강조도 함께 99 가 되어 "상한에 닿는다" 가 그대로
성립했다. **둘이 함께 움직이면 상한이 아무것도 안 묶는다.** `check-stage15` 가
`check-stage11` 의 `MIN_TIER_GAP` 을 다시 적는 것과 같은 이유이고, `S16-G8` 도 자기 몫의
사본을 들고 있다.

**엔진 변환에는 반올림이 필수다** `[실측]`. 언리얼 `Roughness`(0 = 거울)와 유니티
`Smoothness`(1 = 거울)는 같은 값을 **반대로** 쓰는데, `1 - (1 - x)` 가 x 로 안 돌아온다 —
0~1 을 0.001 간격으로 재면 **1001개 중 335개**가 어긋나고 이 저장소의 `gloss` 값 0.2 가
그중 하나다(0.19999999999999996). 오차는 5.6e-17 로 무시할 크기지만 **사람이 엔진 칸에
붙여넣을 값**이라 그런 꼬리가 보이면 안 된다. 소수 셋째 자리로 맞춘다.

**왕복은 `finish` 를 포함하지 않는다.** 재질 이름은 우리 개념이지 엔진 표기에 있는 것이
아니다. 처음엔 `fromUnity` 가 그 자리를 채우게 했고 왕복 게이트가 8000건 전부 실패했다 —
**되돌릴 수 없는 것을 되돌릴 수 있는 척한 것**이고, 게이트가 그것을 정확히 잡았다.

S16-G7 면제가 새지 않는다 — emission 만 안료 채도 상한 밖, baseColor 는 어떤 재질에서도 안쪽
    CHECK: node scripts/check-stage16.mjs S16-G7
    EXPECT: S16_G7_OK

S16-G8 면제한 자리에 EV 상한이 실제로 걸린다 — 검증기 양성·음성 대조, 역할 전수, 상한이 헐겁지 않음
    CHECK: node scripts/check-stage16.mjs S16-G8
    EXPECT: S16_G8_OK

S16-G9 엔진 변환이 왕복한다 — Smoothness = 1 − Roughness (반올림 없는 변환은 실패한다는 음성 대조 포함)
    CHECK: node scripts/check-stage16.mjs S16-G9
    EXPECT: S16_G9_OK

S16-G11 기본 배정이 역할 전부를 덮고 재질 전부를 쓰며, 발광이 소수 역할에만 붙는다
    CHECK: node scripts/check-stage16.mjs S16-G11
    EXPECT: S16_G11_OK

## 17단계 — LLM 이 역할별 재질을 배정한다 (완료)

16단계가 재질 엔진을 만들었지만 **어느 역할에 어떤 재질인지**는 손으로 적은 표
(`DEFAULT_FINISH_BY_ROLE`)뿐이었다. 그 표는 "네온 사인" 과 "가을 카페 브랜딩" 에 같은 재질을
준다 — 질의가 재질에 닿지 못한다. 이 단계가 그 사이를 잇는다.

**`src/structure.js` 와 같은 자리·같은 모양이다.** 한 번 호출, `format: "json"`, 로컬 모델만,
질의가 없으면 안 부르고, 실패하면 던지지 않고 물러선다. 이 사이트에서 LLM 이 하는 일은 이제
셋이고(질의 재작성 · 구조 선택 · 재질 배정) 셋 다 같은 성격이다.

**LLM 은 색에 닿지 않는다.** 고르는 것은 재질 id 뿐이고 헥스는 전부 `material.js` 가 씨앗 색을
받아 계산한다. 모델이 응답에 헥스를 실어 보내도 화면에 닿는 경로가 없다 — `S17-G7` 이 실제로
주입을 시도해 확인한다. `structure.js` 가 지고 있는 것과 같은 경계이고, 사용자가 골랐다.

**폴백은 16단계의 기본 배정 그대로다.** 스펙 4.5 가 "이 표가 곧 LLM 배정의 폴백" 이라고 정했고,
두 벌을 두면 둘이 갈라진다. `S17-G8` 이 세 곳(엔진 폴백 · `material.js` · 게이트의 독립 사본)이
같은 표인지 대조한다.

**두 번에 나눠 넣었다.** 17-A 가 배정 엔진(G1~G8), 17-B 가 `/api/expand` 연결과 화면
표시(G9~G12)다. 11단계가 같은 모양으로 성공했고, 그때 측정이 설계를 세 번 바꿨다 —
화면을 먼저 붙였으면 그 세 번을 화면 뒤에서 찾았어야 한다.

**응답에는 재질 이름만 싣는다. 수치는 안 보낸다** (사용자 결정). base·metallic·roughness·
emission 까지 실으면 두 모드 × 8구조 × 3~4색이라 응답이 3.8KB → 12KB 가 되는데, 이 단계가
화면에 그리는 것은 이름뿐이다. **안 쓰는 것을 보내지 않는다.** `S17-G9` 가 그 경계를 검사한다.

**재질 이름은 서버가 `id→이름` 표로 보낸다.** 화면이 한글 이름을 박으면 `data/finishes.json` 을
고쳐도 안 따라오고, 그 어긋남을 아무도 안 알려 준다. `S17-G12` 가 코드에 이름이 박히는 것을 막는다.

**구조 선택과 재질 배정을 나란히 부른다.** 서로의 결과를 안 쓰므로 기다릴 이유가 없다.
`S17-G10` 이 직렬화를 막는다 — 다만 진짜 Ollama 는 모델 하나를 두 요청이 나눠 쓰므로 내부적으로
줄을 설 수 있다. 이 게이트가 무는 것은 **우리 코드가 불필요하게 기다리지 않는다**는 것까지다.

S17-G1 모델 응답에서 없는 역할·없는 재질·타입 이상·프로토타입 이름을 걸러내고 빠진 자리를 채운다 (음성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G1
    EXPECT: S17_G1_OK

S17-G2 Ollama 를 못 쓰면 기본 배정으로 물러서고 배정이 완전하다 — 사유가 Ollama 를 가리킨다
    CHECK: node scripts/check-stage17.mjs S17-G2
    EXPECT: S17_G2_OK

S17-G3 질의가 없으면 LLM 을 호출하지 않는다 (빈 질의 8가지 · 양성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G3
    EXPECT: S17_G3_OK

S17-G4 느린 모델·HTTP 오류가 배정을 막지 않고 타임아웃을 실제로 지킨다 (양성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G4
    EXPECT: S17_G4_OK

S17-G5 모델이 응답해도 쓸 수 있는 배정을 못 주면 "LLM 이 배정했다" 고 말하지 않는다 (양성 대조 둘)
    CHECK: node scripts/check-stage17.mjs S17-G5
    EXPECT: S17_G5_OK

S17-G6 프롬프트에 재질 넷의 id·이름·원리·detail 과 역할 이름이 전부 실린다 (음성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G6
    EXPECT: S17_G6_OK

S17-G7 **LLM 은 색에 닿지 않는다** — 색 주입을 시도해도 결과가 씨앗 HSL 연산 그대로다
    CHECK: node scripts/check-stage17.mjs S17-G7
    EXPECT: S17_G7_OK

S17-G8 폴백이 16단계 기본 배정과 같은 표이고 실제 역할 전부를 덮는다 (독립 사본으로 대조)
    CHECK: node scripts/check-stage17.mjs S17-G8
    EXPECT: S17_G8_OK

S17-G9 `/api/expand` 가 배정과 이름표를 함께 주고 기존 필드는 그대로다 — 수치는 안 보낸다
    CHECK: node scripts/check-stage17.mjs S17-G9
    EXPECT: S17_G9_OK

S17-G10 구조 선택과 재질 배정이 서로를 안 기다린다 — 지연이 합이 아니라 최대다 (양성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G10
    EXPECT: S17_G10_OK

S17-G11 재질 배정을 조작하는 쿼리 파라미터가 없다 (mode 와 같은 규율 · 양성 대조 포함)
    CHECK: node scripts/check-stage17.mjs S17-G11
    EXPECT: S17_G11_OK

S17-G12 화면이 재질 이름을 카탈로그에서 받아 그린다 — 코드에 이름을 안 박는다 (정적 검사)
    CHECK: node scripts/check-stage17.mjs S17-G12
    EXPECT: S17_G12_OK

## 18단계 — 파생 팔레트 저장 (완료)

13단계가 파생 팔레트를 화면에 그렸지만 **저장은 미뤘다** — `normalizeRatio` 가 2색 전제였기
때문이다. 그래서 펼쳐서 나온 여덟 장 중 마음에 드는 것을 **남길 방법이 없었다.** 이 단계가 그것을 연다.

**화면이 색을 보내지 않는다.** `씨앗 id + 구조 id + 모드` 셋만 보내고 **서버가 다시 계산한다.**
파생은 결정적이라(S11-G3) 같은 셋이면 늘 같은 색이 나오고, `src/store.js` 규칙 4
("화면이 보낸 색을 그대로 저장하면 저장소가 코퍼스와 어긋나기 시작한다")가 그대로 지켜진다.
`S18-G1` 이 색을 실어 보내는 요청으로 그것을 확인한다.

**비율이 배열이 된다.** `public/ratio.js` 의 `shareBounds` 주석이 이 단계를 미리 적어 뒀다 —
"다음 단계(다색 저장)에서 색이 늘면 조용히 깨진다". `normalizeShares(value, count)` 가 길이·정수·
하한·합 100 넷을 함께 무는데, **2색이면 숫자 하나도 받는다** — 기존 경로가 그대로 살아야 한다
(`S18-G8` 이 그 회귀를 본다).

**모드가 다르면 다른 항목이다.** 같은 구조라도 밝은 모드와 어두운 모드는 색이 다르기 때문이다.

**하한은 `public/ratio.js` 와 같은 값을 독립적으로 적는다.** 읽어 오면 그쪽을 낮췄을 때 서버
검증도 함께 느슨해진다. 이 저장소가 같은 부류로 세 번 뚫렸다.

**두 번에 나눠 넣었다.** 18-A 가 서버·저장소(G1~G8), 18-B 가 홈의 저장 버튼과 `/saved`
화면 표시(G9~G12)다.

**`/saved` 는 코퍼스 항목만 있다고 가정하고 있었다.** `entry.type`·`hueRelation`·`summary` 를
그냥 읽어서, 파생 항목이 섞이면 화면에 **"undefined형"** 이 떴다. 무엇을 보여줄지를
`savedFields` 라는 **순수 함수**로 빼고 `S18-G10` 이 필드가 빠진 항목까지 넣어 검사한다 —
정적 검사로는 "무엇이 화면에 나가는가" 를 못 보기 때문이다. 17단계에서 `structureColors` 를
뺀 것과 같은 이유다.

**비율은 언제나 배열로 보낸다.** 예전 `/saved` 는 `ratio: next[0]` 로 숫자 하나를 보냈는데
3~4색에서는 첫 색의 지분일 뿐이라 나머지를 잃는다. 그리고 3색 이상은 색마다 슬라이더가 있는
`shareControl` 로 그린다 — 거기에 저장 시점(`onCommit`)을 새로 붙였다.

S18-G1 화면이 준 색을 서버가 안 믿는다 — 색을 실어 보내도 무시되고 서버 계산과 일치한다
    CHECK: node scripts/check-stage18.mjs S18-G1
    EXPECT: S18_G1_OK

S18-G2 다색 비율이 길이·정수·하한·합 100 을 지킨다 — 거부된 요청은 저장소를 안 바꾼다 (양성 대조 포함)
    CHECK: node scripts/check-stage18.mjs S18-G2
    EXPECT: S18_G2_OK

S18-G3 없는 씨앗·구조·모드와 프로토타입 이름·타입 위장을 거부하고 서버가 안 죽는다 (양성 대조 포함)
    CHECK: node scripts/check-stage18.mjs S18-G3
    EXPECT: S18_G3_OK

S18-G4 같은 씨앗·구조·모드는 덮어쓰기이고 안 보낸 비율·메모를 이어받는다 (빈 메모는 지우기)
    CHECK: node scripts/check-stage18.mjs S18-G4
    EXPECT: S18_G4_OK

S18-G5 저장한 파생의 비율을 배열로 바꿀 수 있고 색은 안 바뀐다 (기본값 복귀 포함)
    CHECK: node scripts/check-stage18.mjs S18-G5
    EXPECT: S18_G5_OK

S18-G6 코퍼스·파생이 섞여도 목록이 kind 로 갈리고 메모 편집·삭제가 양쪽에서 동작한다
    CHECK: node scripts/check-stage18.mjs S18-G6
    EXPECT: S18_G6_OK

S18-G7 파생 항목이 씨앗·구조·모드·이름·원리·출처를 남기고, 저장된 색이 재계산과 일치한다
    CHECK: node scripts/check-stage18.mjs S18-G7
    EXPECT: S18_G7_OK

S18-G8 2색 저장 경로가 하나도 안 바뀐다 — 숫자 하나를 받던 계약이 살아 있다 (회귀)
    CHECK: node scripts/check-stage18.mjs S18-G8
    EXPECT: S18_G8_OK

S18-G9 홈이 저장 버튼을 만들고 씨앗·구조·모드·비율만 보낸다 — 색을 안 보낸다 (정적 검사)
    CHECK: node scripts/check-stage18.mjs S18-G9
    EXPECT: S18_G9_OK

S18-G10 저장 화면이 두 종류를 다르게 그리고, 필드가 빠져도 undefined 가 안 샌다 (순수 함수)
    CHECK: node scripts/check-stage18.mjs S18-G10
    EXPECT: S18_G10_OK

S18-G11 `/saved` 가 그 함수를 실제로 쓰고 다색을 다색 슬라이더로 그린다 — 비율을 배열로 보낸다 (정적 검사)
    CHECK: node scripts/check-stage18.mjs S18-G11
    EXPECT: S18_G11_OK

S18-G12 목록 API 가 두 종류에 필요한 필드를 전부 주고, 실제 항목으로 그려도 undefined 가 없다
    CHECK: node scripts/check-stage18.mjs S18-G12
    EXPECT: S18_G12_OK

S18-G13 내보내기가 파생을 조용히 망가뜨리지 않는다 — 빼고, 뺐다고 말한다 (양성 대조 포함)
    CHECK: node scripts/check-stage18.mjs S18-G13
    EXPECT: S18_G13_OK

## 19단계 — 저장에 재질 배정을 남긴다 · A2-a (완료)

내보내려는 것은 **엔진 수치**(base·metallic·roughness·emission)인데, 그것을 만들려면
`applyFinish(색, 재질, 역할)` 이 필요하고 **재질이 저장에 안 남았다.** 이 단계가 그것을 남긴다.

**색과 재질을 다르게 다룬다.**

| | 어떻게 | 왜 |
|---|---|---|
| 색 | 서버가 **다시 계산**한다. 화면이 보낸 것을 안 믿는다(S18-G1) | 파생이 결정적이라(S11-G3) 같은 씨앗·구조·모드면 늘 같은 답이다 |
| 재질 | 화면이 **보내고 서버가 검증**한다 | LLM 이 정하는 것이라 다시 계산하면 저장할 때 본 것과 다른 재질이 나온다 |

`src/store.js` 규칙 4 가 이 경계를 이미 그어 뒀다 — "색은 코퍼스가 아는 사실이지만 **비율은
사용자의 판단**이다". 재질 배정도 판단 쪽이라 같은 대우를 한다.

**거부가 아니라 걸러내기다.** 모르는 재질·역할만 버리고 나머지는 살린다 — 하나 틀렸다고 저장을
통째로 막으면 사용자가 이유도 모른 채 저장을 못 한다. 버린 자리는 앞의 항목 → 기본 배정
순서로 채운다. 비율·메모와 같은 규칙이다(S5-G5·S8-G2·S18-G4).

**엔진 수치는 저장 안 한다.** 재질 id 만 남긴다 — `applyFinish` 가 결정적이라 내보낼 때 색과
재질로 다시 만들 수 있고, 그래야 엔진 규칙을 고쳤을 때 옛 저장에도 반영된다.

S19-G1 모르는 재질·역할·타입 위장을 걸러내고 기본 배정으로 채운다 — 저장은 안 막는다 (양성 대조 포함)
    CHECK: node scripts/check-stage19.mjs S19-G1
    EXPECT: S19_G1_OK

S19-G2 배정을 안 보내면 기본 배정으로 채워지고, 그것이 material.js 의 표와 같다 (독립 사본 대조)
    CHECK: node scripts/check-stage19.mjs S19-G2
    EXPECT: S19_G2_OK

S19-G3 배정이 그 구조의 실제 역할을 전부 덮고 색과 짝이 맞는다 (구조 3 × 모드 2)
    CHECK: node scripts/check-stage19.mjs S19-G3
    EXPECT: S19_G3_OK

S19-G4 재저장이 배정을 이어받고 명시한 것이 이긴다 — 모드가 다르면 배정도 따로다
    CHECK: node scripts/check-stage19.mjs S19-G4
    EXPECT: S19_G4_OK

S19-G5 화면이 배정을 만들고 **실제로 요청에 싣는다** — 색은 여전히 안 보낸다 (정적 검사)
    CHECK: node scripts/check-stage19.mjs S19-G5
    EXPECT: S19_G5_OK

S19-G6 배정이 색을 오염시키지 않는다 — 색 주입 3가지에서 저장된 색이 재계산 그대로 (18단계 경계 회귀)
    CHECK: node scripts/check-stage19.mjs S19-G6
    EXPECT: S19_G6_OK

### 알려진 한계

- **`S19-G5` 는 조립부와 호출부를 따로 본다.** 넓게 자르면 "만들어 놓고 안 보내는" 변형을
  못 잡고, 좁게 자르면 조립부가 밖이라 거짓 실패를 낸다 — 둘 다 실제로 겪었다.
  17단계에서 리뷰가 같은 부류를 찾았다(`structureColors` 를 부르고 반환을 버리는 변형).

- **파일에 escape 를 안 쓴다. 문자를 직접 넣는다.** 이 저장소의 편집 경로에서 escape 가
  **진짜 제어문자로** 들어간 적이 두 번 있다(둘 다 실측).
  - 19단계 — 게이트 정규식의 `\b` 가 0x08 로 들어가 정규식이 아무것도 못 잡았다.
    좁게 자른 뒤 포함 검사를 쓰는 편이 안전하다.
  - 20단계 — CSS `content: "\21C4"` 가 **0x11 + `C4`** 로 들어가 버튼에 `◀C4` 가 찍혔다.
    실제 문자(`⇄`)를 그대로 넣어 고쳤다.

  두 번 다 **눈으로는 안 보였고** 원시 바이트 검사로만 드러났다. 텍스트 검색 도구는
  제어문자를 인코딩 메타데이터로 보고 걷어낸다.

- ~~**내보내기(`/api/export`)는 코퍼스 조합만 다룬다.**~~ **20단계에서 닫혔다.** 형식이
  다루는 대상이 둘로 갈렸다 — `css`·`json` 은 코퍼스만, `unreal`·`unity` 는 파생만.
  양쪽 다 뺀 것을 말한다. 아래 20단계 절을 본다.

  남겨 두는 이유는 그때 실측한 고장 목록이 **왜 형식을 갈랐는지의 근거**여서다:
  `--undefined-ground`(파생마다 변수 이름이 같아져 서로 덮어씀) · `--undefined-undefined`
  (`rolesOf` 가 앞 두 색만 봐서 3·4번째 역할이 없음) · `보색대비 · undefined형`(코퍼스 전용
  필드가 주석에 그대로). 한 형식이 둘 다 담으려 하면 이런 것이 조용히 난다.

- **`S18-G9`·`S18-G11` 의 정적 부분은 표기만 본다.** 저장 요청 본문을 별도 변수로 조립해
  호출부 밖에서 `colors` 를 주입하면 `S18-G9` 를 우회한다. 같은 게이트의 다른 검사와
  `S18-G1`(서버가 색을 무시한다)이 실질 방어이고, 정적 부분은 의도를 코드에 남기는 쪽이다.

- **`savedFields` 는 문자열 길이를 안 자른다.** 저장 시점에 `store.js` 가 자르므로 정상 경로로는
  긴 값이 안 들어오지만, 손상된 파일에는 있을 수 있다. 그때 레이아웃이 깨진다(XSS 는 아니다 —
  전부 `textContent` 로 들어간다).
- **`clip` 은 값을 문자열로 강제 변환한다.** `String(["complementary"]) === "complementary"` 라
  배열 하나짜리가 그대로 통과했다 — `S18-G3` 이 그것으로 이 코드를 뚫었다. 이제 `saveDerived` 가
  `typeof` 를 먼저 본다. **17단계에서 리뷰가 `Object.hasOwn` 의 키 강제 변환으로 같은 부류를
  찾았다 — 이 저장소에서 두 번째다.** 강제 변환하는 함수 앞에서는 타입을 먼저 본다.

- **`updateSavedRatio` 의 개수 검증은 쓰기 큐 안에서 한다.** 몇 색짜리 항목인지는 저장된 것을
  봐야 알 수 있고, 그 읽기는 직렬화 안에 있어야 겹친 쓰기가 서로를 덮지 않는다(S8-G6 과 같은
  이유). 모양 검증(정수 또는 정수 배열인가)만 큐 밖에 남겨, 잘못된 요청이 큐에서 자리를
  차지하지 않게 한다.

- **파생 저장은 색을 저장하되 그것을 진실로 삼지 않는다.** 씨앗·구조·모드를 함께 남기므로
  언제든 다시 계산할 수 있다. `S18-G7` 이 저장된 색과 재계산이 같은지 본다 — 갈라지면 거기서 운다.
- **`S17-G10` 의 주 신호는 시간이 아니라 겹침 수다.** 스텁이 **같은 순간에 떠 있던 요청 수**를
  직접 센다(최대 2개). 처음엔 시간만 봤고 리뷰가 흔들릴 수 있다고 지적했다 — 바쁜 기계에서는
  진짜 병렬도 문턱을 넘을 수 있다. 시간은 보조로 남겼다: 겹쳤는데 시간이 합에 가까우면 다른
  곳에 직렬화가 있다는 뜻이다.

- **`S17-G9` 의 "재질 호출이 그물에 싸여 있다" 는 정적 검사다.** `selectFinishes` 는 `roles` 가
  잘못되면 던지는데(호출부 잘못이라 그렇게 설계했다) 그것이 `Promise.all` 안에서 터지면
  **구조·파생까지 함께 500** 이 된다. 현재 데이터로는 던지는 경로를 만들 수 없어(역할이
  `expand.js` 의 RULES 로 고정, `S16-G11` 이 표와의 일치를 검사) HTTP 로 재현할 수 없다.
  그래서 `.catch` 가 있는지만 본다 — **다음 사람이 그물을 걷어내는 것을 막는 것**이 그 검사의 일이다.

- **`S17-G11` 의 정적 부분은 `params.get(...)` 표기만 본다.** `url.searchParams.get(...)` 으로
  직접 읽거나 변수명을 바꾸면 그 검사를 우회한다. **같은 게이트의 동적 검사**(파라미터를 실제로
  붙여 응답이 안 바뀌는지)가 실질 방어이고, 정적 부분은 의도를 코드에 남기는 쪽이다.

- **`/api/expand` 의 응답 시간은 두 LLM 타임아웃 중 **느린 쪽**에 묶인다.** 구조 선택과 재질
  배정을 나란히 부르기 때문이다 — 합이 아니라 최대다(직렬보다 낫다). 다만 **한쪽만 낮추면
  다른 쪽 기본값이 남는다.** `STRUCTURE_TIMEOUT_MS` 만 700 으로 낮추고 재질 쪽을 그대로 두면
  응답이 8초까지 간다(실측). `S14-G6` 이 그것으로 실패했고, 둘을 함께 낮추도록 고쳤다.
  기본값(둘 다 20초)에서는 전과 같다.

- **동시 `refresh()` 가 낡은 상태를 받던 결함을 17단계가 드러냈다** `[실측]`. `lastProbeAt` 을
  `await probe()` 앞에서 세워서, 동시 호출한 두 번째가 TTL 검사에 걸려 **아직 끝나지 않은
  탐지의 `"unknown"`** 을 받았다. 순차 호출만 있던 시절에는 드러날 수 없었고, `/api/expand` 가
  둘을 나란히 부르자 **재질 배정이 첫 요청마다 조용히 폴백했다.** `S17-G10` 이 "모델 호출 1회"
  로 잡았다. `src/ollama.js` 에 진행 중 탐지에 합류하는 빗장을 넣었다 — 3단계 게이트 10개 회귀 0.

- **`check-stage17.mjs` 는 한 게이트 안에서 가짜 Ollama 를 두 번 세우지 않는다.** `finish.js` 와
  `ollama.js` 가 둘 다 `OLLAMA_HOST` 를 모듈 적재 시점에 읽고 ESM 이 모듈을 캐시하므로, 두 번째
  스텁은 새 포트를 받지만 모듈은 **첫 포트를 계속 문다.** 처음에 그렇게 썼고 **`S17-G4` 가
  우연히 통과했다** — HTTP 500 을 검사한다고 적어 놓고 실제로는 연결 거부를 재고 있었다.
  폴백이라는 결과가 같아 눈으로는 안 보였다. 지금은 스텁 하나를 세우고 행동만 바꾼다.

- **`S17-G7` 은 `assignments` 만이 아니라 `selectFinishes` 의 반환 객체 전체를 본다.**
  처음엔 `assignments` 만 봤고 리뷰가 그것으로 뚫었다 — 반환에 `debugHex` 같은 필드를 더해
  모델 응답의 헥스를 실어도 **게이트 여덟이 전부 통과했다.** `assignments` 는 깨끗한데
  반환 객체 전체가 깨끗하다는 보장이 없었다. **17-B 가 이 객체를 응답에 얹으므로**, 그 자리에서
  "LLM 은 색에 닿지 않는다" 가 조용히 깨질 뻔했다. 지금은 키 화이트리스트와 반환물 전수 헥스
  검사를 함께 하고, 판정기 자체 대조 4건을 게이트 안에 둔다.

  **`finish.js` 의 `result()` 화이트리스트를 무력화하는 변형은 안 잡힌다 — 등가라서다.**
  지금 호출부가 목록 밖 필드를 넘기지 않으므로 걸러낼 것이 없다. 그 함수는 **다음 사람이
  필드를 늘릴 때** 마찰을 만드는 자리이고, 실제 누수는 위 게이트가 잡는다.

- ~~**`.trim()` 은 U+200B(zero-width space)를 공백으로 안 본다.** 그런 질의가 오면 "빈 질의" 로
  안 걸러 모델을 한 번 더 부른다. `structure.js`·S14-G3 도 같은 갭을 갖고 있어 이번 단계에서
  새로 생긴 것이 아니고, 보안 문제도 아니다(비용이 조금 든다). 고치려면 두 곳을 함께 고친다.~~
  **25단계에서 닫혔다.** `cleanQuery` 한 함수로 세 곳(`/api/search` 도 같았다)을 함께 고쳤고 `S25-G3` 이 지킨다.

- **`S17-G7` 은 "색이 안 바뀐다" 를 항등식으로 쓰지 않는다.** 처음엔 같은 식 둘을 비교해
  늘 참인 검사를 만들었다. 지금은 게이트가 응답에서 **직접** 재질 id 를 꺼내 적용한 결과와
  대조한다 — 그 사이에 응답의 다른 필드가 끼어들 자리가 없다는 뜻이다.

- **`parseAssignment` 의 방어 셋은 게이트가 안 잡는다 — 등가이거나 이중 방어라서다** `[실측]`.
  배열 배제와 `typeof id` 검사는 등가이고(숫자 인덱스는 역할 목록에 없고, 비문자열은 Set 에
  들어갈 수 없다), `Object.create(null)` 은 `wanted` 필터에 가린다. 셋 다 의도를 코드에 남기려
  둔 것이고, 근거는 그 자리 주석에 있다. **게이트를 늘리지 않는다** — 등가 변형을 잡는 게이트는
  동작이 아니라 표기를 지킨다.

- **Ollama 가 안 떠 있을 때의 사유 문구가 어색하다.** `"Ollama 를 쓸 수 없다 (아직 확인하지
  않았다)"` 로 나오는데, 확인은 했고 실패한 것이다. `src/ollama.js` 의 `refresh()` 가 탐지에
  실패해도 `detail` 을 안 고치기 때문이고 **3단계부터 있던 것이다** — `selectStructures` 도 같은
  문구를 낸다. 이 단계에서 고치지 않았다. 공유 코드라 S3 게이트 회귀가 함께 가야 한다.
- **`src/material.js` 의 러프니스 수치에 근거가 없다 `[판단]`.** 원전(light.md)은 방향만 말한다 —
  "매끈 → 날카롭게 맺힘 / 거칠고 무광 → 넓고 흐릿하게 번짐". 셋의 **간격**만 근거가 있고
  (무광과 광택이 갈리는 것이 원전의 요지) 절대값은 내가 정했다. 인게임 실측으로 대체할 자리다.

- **base color 범위를 인게임에서 확인하지 않았다 `[문헌]`.** 언리얼 문서 지침이고 유니티에도
  같은 값이 맞는지 검증되지 않았다. S16-G4·G5 는 "이 범위를 지키는가" 를 검사할 뿐,
  **범위 자체가 옳은지는 검사하지 않는다.**

- **내부 표현은 언리얼 기준이다(Roughness, 0 = 거울).** 유니티로 보낼 때는 반드시
  `toUnity()` 를 거친다 — `applyFinish` 의 출력을 유니티 Smoothness 칸에 그대로 붙여넣으면
  **정반대 재질**이 되고 조용히 틀린다. S16-G9 가 변환의 왕복을 검사하지만, **변환을 거치지
  않고 쓰는 것은 게이트가 막을 수 없다.**

- **EV 값·러프니스·기본 배정에 근거가 없다 `[판단]`.** 인게임 블룸·하이라이트 실측으로 대체할
  자리다. 특히 `EV_MAX = 4` 는 상한이 헐겁지 않게 하려고 표의 최댓값에 붙여 둔 값이라,
  실측으로 다른 값이 나오면 **표와 상한 두 곳을 함께** 고쳐야 한다(그 마찰이 의도된 것이다).

- **`S16-G4`·`S16-G5`·`S16-G7`·`S16-G8` 은 `material.js` 의 상수 사본을 따로 들고 있다.**
  읽어 오기만 하면 상수를 바꾸는 순간 **게이트의 문턱이 함께 움직여** 아무것도 검사하지 않는다 —
  리뷰가 실측으로 보였다. `METAL_MIN` 을 180 → 1 로 바꾸자 `S16-G5` 가
  `금속 base 2000건이 전부 min >= 1` 이라고 찍으며 **통과했다.** 그래서 상수를 바꾸는 것은
  **두 곳을 함께 고치는 의식적인 일**이다. 그 마찰이 목적이고, 불편하다고 사본을 지우면
  게이트가 통째로 무의미해진다.

- **`fitRange` 의 조기 반환은 등가 변형에 반응하지 않는다** (아래 별도 항목).

- **`S16-G7` 의 발광 채도 이득(1.6)은 게이트가 안 묶는다.** 이득을 1.0 으로 낮춰도 게이트가
  통과한다 — 명도를 0.5 로 옮기는 것만으로 이미 108/2000 이 상한을 넘기 때문이다(실측).
  이득은 `[판단]` 상수이고, 게이트가 무는 것은 **면제가 실제로 일하는가**(초과가 0이 아닌가)
  이지 그 값이 얼마인가가 아니다. 상수를 게이트로 못 박으면 동작이 아니라 표기를 지키게 된다.

- **`S16-G5` 의 무채색 컷오프(채도 0.02)가 얇은 경계다.** 색상각이 정의되지 않는 색을 빼려고
  둔 선인데, 채도가 그 바로 위인 **거의-무채색**이 씨앗에 새로 들어오면 8비트 반올림에서 오는
  색상각 흔들림이 지금보다 커진다. 현재는 여유가 충분하다 — 실측 최대 이동 0.400도 / 허용 1.5도,
  제외된 장 10개. **씨앗을 늘릴 때 이 지점을 먼저 본다.** `S15-G12` 의 "여유가 얇다" 메모와 같은
  부류이고, 조치는 없다 — 게이트가 넘으면 스스로 운다.

- **엔진 변환의 왕복은 입력이 이미 소수 셋째 자리 안일 때만 정확하다.** `roughness: 0.1234` 를
  손으로 만들어 넣으면 0.123 으로 돌아온다(리뷰 실측). 지금 `ROUGHNESS` 의 네 값이 전부 셋째
  자리 안이라 닿지 않지만, 값을 늘릴 때는 이 정밀도가 계약이라는 것을 알고 늘린다.
  게이트는 `applyFinish` 가 만든 재질만 돌리므로 이 경로를 안 본다.

- **`fitRange` 의 조기 반환은 등가 변형에 반응하지 않는다.** 지워도 결과가 같기 때문이다 —
  채널 조합 138만 건에서 출력 차이 0건으로 확인했다. 게이트 구멍이 아니라 그 줄이 지름길일 뿐이고,
  불변식을 실제로 지키는 것은 아핀 사상 자체다. 이 자리에 게이트를 늘리지 않는다.

- **S15-G13 은 절반만 동작 검사다.** 모드에 따라 어느 색을 고르는지는 `structureColors` 를 실제로
  불러 대조하지만(다섯 경우), 카드 조립·토글 배선은 DOM 이 필요해 **정적 검사로 남는다.**
  그래서 표기가 다른 동등 구현에는 반응하지 않는다 — `api()` 대신 `XMLHttpRequest` 로 다시
  부르거나, `expand__mode` 가 아닌 이름으로 같은 버튼을 만들면 못 잡는다. 실제 동작은
  브라우저에서 따로 쟀다(토글 시 `/api/` 요청 증가 0 · 375px 가로 스크롤 0 · 콘솔 오류 0).

  **정적 절반이 한 번 뚫렸고, 뚫린 방식이 "표기 차이" 가 아니었다.** 리뷰어가
  `structureColors(structure, mode);` 로 **부르기만 하고 반환을 버린 뒤** `structure.colors` 를
  쓰는 변형을 냈다 — 토글을 눌러도 화면이 전혀 안 바뀌는 완전한 기능 회귀인데 게이트 넷이
  전부 조용했다. 호출의 존재만 봤기 때문이다. 지금은 **반환을 받는지**와 **카드 본문이
  `structure.colors` 에 직접 닿지 않는지**를 함께 본다. 뒤엣것이 우회로 자체를 막는 쪽이다 —
  앞엣것만 조이면 표기를 바꿔 또 빠져나간다.

- **S15-G12 의 여유가 0.01 이다.** 어두운 모드 파생색 1000개의 라벨 대비 최솟값이 4.51 이고
  기준이 4.5 다(최악: `pair-16/aerial/중간 #c2553d`). 결함은 아니지만, `src/expand.js` 의
  앵커나 `S_CAP` 을 건드리면 **여기가 가장 먼저 깨진다.** 게이트가 자동으로 잡으므로 조치는
  없고, 값을 조정할 때 이 지점을 먼저 보라는 표시로 남긴다.

- **S15-G11 은 `q` 없이만 비교한다.** `q` 를 붙이면 LLM 이 끼어 응답이 요청마다 달라져 동일성
  비교 자체가 성립하지 않는다. 그 자리는 정적 대조(`handleExpand` 가 `mode` 파라미터를 읽지
  않는다)가 대신 막는다.

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

- **`S15-G9` 는 CSS 선택자만 보는 정적 검사다.** 실행 시점 넘침은 여전히 못 본다(바로 아래 항목).
  두 번 뚫렸고 두 번 다 고쳤으므로, 어디까지 막는지를 실측으로 적어 둔다.
  - **잡는 것:** 세 규칙 중 무엇이든 자손 선택자로 되돌아가는 것 · 중간에 다른 클래스를 끼우는 것 ·
    `@media` 블록의 **첫 규칙** 자리에 자손 선택자를 놓는 것(초기 정규식 파서가 이걸 통째로
    놓쳤다 — 선택자 앞에 `}`·`;`·문자열 시작을 요구해서, `{` 뒤의 첫 규칙이 목록에서 사라졌다) ·
    세 규칙 중 **하나만** 지우는 것(개수만 세던 초기 양성 대조가 이걸 놓쳤다 — 나머지 둘이
    문턱을 만족했다) · 표에 없는 새 형태로 바꿔치기하는 것.
  - **못 잡는 것:** 선택자를 다르게 써서 만드는 같은 부류의 누수. 정규식이든 스캐너든 CSS 문자열만
    보고 "실제로 무엇이 어디에 적용되는가" 를 판정하는 것은 원리적으로 불가능하다.
    실제 넘침 확인은 브라우저에서 손으로 한다 — 2026-09-07 에 375·753·1425px 에서 확인했다.
  - **`EXPECTED` 표는 손으로 적는다.** 규칙을 정당하게 늘리거나 줄이면 표를 함께 고쳐야 하고,
    안 고치면 게이트가 운다. 그게 의도다.

- **레이아웃 넘침(가로 스크롤)을 보는 게이트가 없다.** 의존성 0 이라 헤드리스 브라우저가 없고,
  `getBoundingClientRect` 로만 판정되는 것은 검사기로 만들 수 없다. 2026-09-06 에 375px 상단바
  넘침(scrollWidth 379)을 고쳤을 때도 확인은 전부 브라우저에서 손으로 했다 —
  `docs/session-resume/2026-09-06-mobile-topbar-overflow.md` 에 폭별 실측이 있다.

## 20단계 — 엔진 수치를 엔진별로 나눠 내보낸다 · A2-b (완료)

화면에 "강조 = 발광" 이라 떠도 **엔진에 붙여넣을 숫자를 못 얻었다.** 19단계가 재질을 저장에
남겼으니 이제 `applyFinish` 로 base·metallic·roughness·emission 을 만들 수 있다.

**막으려는 것은 하나다 — 엔진을 헷갈리는 것.**

| | 거울 | 완전 무광 |
|---|---|---|
| 언리얼 `Roughness` | **0** | 1 |
| 유니티 `Smoothness` | **1** | 0 |

정반대다. 한쪽 값을 다른 엔진에 그대로 넣으면 **거울로 만들려던 면이 무광이 된다.**
에러가 안 나고 장면만 달라져서, 사람이 알아채기 전까지 계속 틀린다.

**방어 셋을 겹친다.**

| 방어 | 쉽게 말하면 |
|---|---|
| 엔진마다 파일을 나눈다 | 한 파일에 둘이 있으면 잘못된 쪽을 복사하기 쉽다 |
| 파일이 자기 엔진을 밝힌다 (`engine` + `note`) | 나눠 놨어도 어느 쪽인지 모르면 똑같이 헷갈린다 |
| 필드 이름이 안 겹친다 | 유니티에 `roughness` 를 넣으면 그 칸이 비어 **사람이 알아챈다.** 조용히 반대가 되는 것보다 낫다 |

**형식마다 다루는 대상이 갈린다.**

| 형식 | 담는 것 | 왜 |
|---|---|---|
| `css` · `json` | 코퍼스 조합만 | 파생은 `paletteId` 도 `type` 도 없고 색이 3~4개다 — 그대로 내면 조용히 망가진다(18-B 실측) |
| `unreal` · `unity` | 파생 팔레트만 | 코퍼스에는 재질 배정이 없고 역할 `대등` 이 `EV_BY_ROLE` 에 없다. 기본값을 붙이면 **배색사전이 한 적 없는 주장을 지어낸다** |

양쪽 다 **뺐다고 말한다.** 조용히 빼면 사용자는 저장한 것이 다 나왔다고 믿는다.

S20-G1 엔진 형식이 파생을 실제로 낸다 — 색마다 역할·재질·baseColor·metallic·면적
    CHECK: node scripts/check-stage20.mjs S20-G1
    EXPECT: S20_G1_OK

S20-G2 두 엔진이 반전된 수치를 낸다 — roughness + smoothness = 1 (독립 계산) · 필드 이름 안 겹침 · 0.5 아닌 값 포함
    CHECK: node scripts/check-stage20.mjs S20-G2
    EXPECT: S20_G2_OK

S20-G3 파일이 자기 엔진을 밝히고 뺀 코퍼스 수를 말한다 — 반대 엔진 필드 0건 (파생이 없을 때도)
    CHECK: node scripts/check-stage20.mjs S20-G3
    EXPECT: S20_G3_OK

S20-G4 발광 자리에만 빛이 있고 세기가 0~4 안이다 (EV 상한 독립 사본)
    CHECK: node scripts/check-stage20.mjs S20-G4
    EXPECT: S20_G4_OK

S20-G5 손상 항목 3개가 있어도 멀쩡한 것이 나오고 못 낸 수를 말한다 (18-B 의 High 재발 방지)
    CHECK: node scripts/check-stage20.mjs S20-G5
    EXPECT: S20_G5_OK

S20-G6 토글이 두 엔진을 오가고 css·json·이상한 값에서는 숨는다 — 화면이 실제로 그 함수를 쓴다
    CHECK: node scripts/check-stage20.mjs S20-G6
    EXPECT: S20_G6_OK

S20-G7 이상한 형식 7가지가 400, 정상 형식 4가지가 200 (프로토타입 방어 회귀)
    CHECK: node scripts/check-stage20.mjs S20-G7
    EXPECT: S20_G7_OK

### 알려진 한계 (20단계)

- **참·거짓을 재는 게이트는 시험 데이터가 한쪽에 쏠리면 절반만 산다.** `S20-G1` 이
  `finishesAdjusted` 를 타입만 보고 있었는데, 저장한 두 팔레트가 마침 둘 다 `false` 라
  **`false` 로 굳히는 변형이 살아남았다.** 값을 대조하게 고쳤더니 이번엔 두 팔레트에서
  두 깃발이 늘 같아서 **뒤바꾸는 변형**이 살아남았다. 지금은 재질만 손댄 것과 비율만 손댄 것을
  하나씩 두어 **엇갈리게** 만든다.

- **`aria-label` 이 있는지만 세면 안 된다.** `public/saved.js` 는 메모 입력칸에도 그 속성을
  쓰므로 토글이 안 붙여도 통과했다(실측). 속성과 값이 **같은 구문**에 있는지를 본다.

- **`S20-G6` 의 정적 부분은 호출 인자만 본다.** `showExport(...)` 의 인자에 엔진 이름과
  `next` 가 있는지를 보므로, 요청을 다른 변수로 조립하면 우회한다. 실질 방어는 순수 함수
  `engineToggle` 쪽이고 그것은 게이트가 직접 부른다.

- **`S18-G13` 이 형식 목록을 손으로 적는다.** 형식이 늘거나 줄면 그 게이트가 **일부러 운다** —
  새 형식이 코퍼스용인지 엔진용인지는 사람이 정해야 하고, 안 정하면 검사에서 조용히 빠진다.

- **엔진 JSON 은 `safeComment` 를 안 거친다.** CSS 와 달리 `JSON.stringify` 가 이스케이프하므로
  메모가 파일 구조를 깨지 못한다. 다만 **양방향 텍스트 제어문자는 그대로 나간다** — JSON
  내보내기가 이미 가진 한계와 같은 자리다.

- **게이트에서 `process.exit()` 를 안 쓴다.** 요청이 여러 번인 게이트에서 연결이 정리되는
  중에 강제 종료하면 윈도우 libuv 가 어서션으로 죽는다(`UV_HANDLE_CLOSING`, async.c:94 —
  3회 중 2회 실측). 통과 문구를 찍은 **뒤에** 죽어서 통과한 검사가 종료 코드 127 로 실패해
  보였다. **"지적 없음" 과 "검사가 깨져 사라짐" 은 다른 것이다.**

## 21단계 — 재질을 손으로 바꾼다 · A3 (완료)

LLM 이 "본문은 광택" 이라 정하면 사용자는 **그대로 봐야 했다.** 바꿔 볼 수가 없었다.

**막으려는 것 셋.**

| 함정 | 무슨 일이 나나 | 게이트 |
|---|---|---|
| 고친 재질이 **모드 토글에 날아간다** | 모드 토글이 격자를 통째로 다시 그린다. 배정을 카드 안에 두면 어두운 모드로 바꾸는 순간 전부 사라진다 (15단계와 같은 부류) | `S21-G4` |
| 한 카드를 고쳤는데 **일곱이 같이 바뀐다** | 배정 표는 역할별로 하나다(`본문 → 광택`). 카드 여덟이 그것을 함께 본다 | `S21-G2` |
| 바꾸려고 **서버를 다시 부른다** | `/api/expand` 를 다시 부르면 `selectStructures` 가 다시 돌아 **보이는 다섯이 바뀐다** (S15-G11 과 같은 함정) | `S21-G4` |
| 바꿀 때 **카드를 다시 그린다** | 서버를 안 불러도 망가진다 — 사용자가 맞춘 면적 비율이 55:25:20 → 34:33:33 으로 초기화되고, 방금 조작한 고르개가 사라져 포커스가 `body` 로 떨어진다 (실측) | `S21-G4` |

**바꾼 배정은 구조마다 따로 담는다.** 사용자는 하나의 배색을 다듬는 중이고 저장도 구조
단위다. 역할별로 담으면 안 건드린 카드가 조용히 달라진다.

**되돌릴 길은 상태를 안 늘리고 만든다.** LLM 이 고른 항목에 `(LLM 배정)` 을 붙이면,
되돌리기 버튼과 그 상태를 따로 두지 않고도 원래로 돌아갈 수 있다.

S21-G1 고르개가 재질 넷을 한글 이름으로 준다 · LLM 배정에만 표시 · 화면과 엔진의 재질 목록이 일치
    CHECK: node scripts/check-stage21.mjs S21-G1
    EXPECT: S21_G1_OK

S21-G2 바꾼 배정이 구조마다 따로 살고, 모르는 재질·역할이 안 들어간다 (원래 배정 쪽도 검증)
    CHECK: node scripts/check-stage21.mjs S21-G2
    EXPECT: S21_G2_OK

S21-G3 카드가 역할마다 고르개를 그리고 **손으로 바꾼 값으로** 열리고, 고치면 알린다 (읽기 전용 회귀 포함)
    CHECK: node scripts/check-stage21.mjs S21-G3
    EXPECT: S21_G3_OK

S21-G4 배정 상태가 redraw 밖에 있다 · 고칠 때 **실제로** 서버 0번 · 화면 안 건드림 · 고른 것이 담기고 구조별로 갈린다
    CHECK: node scripts/check-stage21.mjs S21-G4
    EXPECT: S21_G4_OK

S21-G5 저장 요청이 바꾼 배정을 싣고, 색은 여전히 안 보낸다 (S18-G1 경계 회귀)
    CHECK: node scripts/check-stage21.mjs S21-G5
    EXPECT: S21_G5_OK

S21-G6 손으로 바꾼 재질이 저장에 그대로 남는다 — 저장소를 직접 불러 끝에서 끝까지 (양성 대조 포함)
    CHECK: node scripts/check-stage21.mjs S21-G6
    EXPECT: S21_G6_OK

S21-G7 ui.js 에 HTML 문자열 조립이 없고, 재질 이름이 글자로만 들어간다
    CHECK: node scripts/check-stage21.mjs S21-G7
    EXPECT: S21_G7_OK

### 알려진 한계 (21단계)

- **카탈로그가 어긋나면 재질 줄 하나가 조용히 사라진다.** 서버가 화면이 모르는 재질을
  보내면 `forStructure` 가 그 역할을 버리고, 카드가 그 줄을 안 그리고, 저장소는 그 자리를
  **기본값으로 채운다.** 사용자는 줄도 못 보고 저장된 값도 못 본다 — 이 저장소가 막겠다고
  한 "화면과 저장이 어긋난다" 그 자체다.

  **고치지 않고 둔다. 전제조건을 `S21-G1` 이 막기 때문이다** — 화면의 `FINISH_IDS` 와
  엔진의 `MATERIAL_FINISHES` 가 어긋나면 그 게이트가 운다. 어긋남 없이 이 상태에 닿는 길은
  손상된 응답뿐이고, 거기에 화면을 더 만드는 것은 안 일어날 일에 대한 설계다.
  **다시 볼 조건: 재질 목록이 실제로 늘어날 때.** 그때 이 항목을 먼저 읽는다.

- **DOM 을 흉내 낸다.** 의존성 0 저장소라 jsdom 을 안 들이고, `structureCard` 가 실제로 쓰는
  것만 만든다(`append` · `textContent` · `setAttribute` · `addEventListener` · `style`).
  **흉내가 브라우저와 어긋나는 자리는 게이트가 못 본다** — 그래서 더 만들지 않는다.
  더 만들수록 어긋날 자리가 늘고, 그 어긋남을 아무도 안 본다.
  실제 동작 확인은 브라우저에서 손으로 한다.

- **`S21-G5` 는 정적 검사라 표기만 본다.** 저장 요청을 다른 변수로 조립하면 우회한다.
  실질 방어는 서버 쪽(`pickFinishes`, S19-G1)과 `S21-G6`(저장소를 직접 부른다)이다.

- **`S21-G4` 는 더 이상 정적 검사가 아니다 — 한 번 뚫린 뒤에 바꿨다.** 전에는 `app.js` 소스에서
  `api(` 라는 글자를 찾아 "고칠 때 서버를 다시 안 부른다" 를 확인했는데, 리뷰가 **한 줄로
  우회**했다: 호출을 이름 붙인 헬퍼로 빼서 검사 창 밖에 두면 그만이었다.
  **그것은 난독화가 아니라 평범한 리팩터링이다** — 다음 사람이 악의 없이 할 법한 일이고,
  그런 것에 뚫리는 검사는 검사가 아니다.

  판정 로직을 `finishEditing` 이라는 순수 함수로 빼고, 게이트가 **직접 불러서** 잰다 —
  `fetch` 를 감시하고, DOM 을 아예 안 깔고 부른다(건드리면 던진다). 정규식으로는 원리적으로
  못 하던 것이 함수를 부르면 그냥 된다. 17·18·20단계가 같은 이유로 같은 것을 했다.

- **슬라이스 검사의 창을 한 번 잘못 잡았다.** `onFinish` 부터 300자를 봤더니 바로 뒤의
  `redraw = ` 선언까지 삼켜, 처리기가 깨끗해도 검사가 울었다. 다음 문장이 시작하는 자리에서
  자른다. 슬라이스 검사는 **넓으면 거짓 실패, 좁으면 미탐**이라 양쪽을 다 확인해야 한다 —
  19단계 `S19-G5` 에서 같은 것을 두 번 겪었다.

- **`S21-G4` 가 한 번 뚫렸다.** 처음엔 `redraw` 본문에 `overrides` 라는 글자가 있는지만 봤는데,
  **카드에 넘길 것을 만드는 자리가 `redraw` 밖에 있었다.** 거기서 `assignments` 를 원래
  배정으로 바꿔치기해도 `overrides.set` 이 남아 검사가 통과했다. 지금은 `assignments:` 에
  실리는 값이 `forStructure` 를 거치는지를 본다. 19단계 `S19-G5` 와 같은 부류다.

## 22단계 — `/saved` 가 저장된 재질을 보여준다 (완료)

파생 팔레트를 저장하면 재질이 남고(19단계) 엔진 수치로도 나가는데(20단계), 정작 **목록에서는
안 보였다.** 사용자는 자기가 무엇을 저장했는지 **내보내기를 눌러 JSON 을 읽어야만** 알 수 있었다.

```
전:  보색대비  [어두운 배경]                 ← 재질이 어디에도 없다
     ▬▬▬▬ 40%  ▬▬ 30%  ▬▬ 30%

후:  보색대비  [어두운 배경]
     ▬▬▬▬ 40%  ▬▬ 30%  ▬▬ 30%
     바탕 무광 · 본문 메탈릭 · 강조 발광   [직접 고름]
```

**정한 것 셋.**

| 무엇 | 어떻게 | 왜 |
|---|---|---|
| 한글 이름을 어디서 | `/api/saved` 응답에 `finishNames` 를 함께 싣는다 | 저장에는 id 만 남는다(`matte`). 화면이 이름을 박으면 `data/finishes.json` 을 고쳐도 안 따라온다. `limits` 를 싣는 것과 같은 자리라 요청을 더 만들지 않는다 |
| 누가 골랐는지 보이나 | `finishesAdjusted` 면 `[직접 고름]` | 비율은 **그 화면에서 바로 고칠 수 있어** 출처가 덜 중요하지만, 재질은 못 고치니 "왜 이게 메탈릭이지" 를 답해 줘야 한다 |
| 손상된 값 | 색과 같은 규율 — 모르는 재질·구조에 없는 역할은 버린다 | 항목 하나가 목록 전체를 죽이지 않게 (18-B 의 High) |

S22-G1 목록 API 가 재질 id→한글 이름 표를 함께 준다 (저장이 없어도 · limits 회귀)
    CHECK: node scripts/check-stage22.mjs S22-G1
    EXPECT: S22_G1_OK

S22-G2 savedFields 가 재질을 색 순서로 주고, 손상된 것 5가지를 거르고, 손댄 표시를 낸다
    CHECK: node scripts/check-stage22.mjs S22-G2
    EXPECT: S22_G2_OK

S22-G3 재질 줄이 역할·한글 이름을 그린다 — 손댄 표시가 양쪽으로 갈리고 이름표가 없어도 안 사라진다
    CHECK: node scripts/check-stage22.mjs S22-G3
    EXPECT: S22_G3_OK

S22-G4 저장한 재질이 목록에 그대로 보인다 — 이름·순서·손댄 표시 (양성 대조 포함)
    CHECK: node scripts/check-stage22.mjs S22-G4
    EXPECT: S22_G4_OK

S22-G5 손상 항목 4가지에서도 안 던지고 undefined 도 안 샌다 (18-B 의 High 재발 방지)
    CHECK: node scripts/check-stage22.mjs S22-G5
    EXPECT: S22_G5_OK

S22-G6 게이트 수가 네 곳에서 같다 — 실제로 도는 것 · GATES.md · README 선언 · README 표(단계별)
    CHECK: node scripts/check-stage22.mjs S22-G6
    EXPECT: S22_G6_OK

**`S22-G6` 가 작업 목록의 C3 를 닫는다.** 그 항목은 *"게이트 수 3곳 일치를 사람이 센다 —
매번 손으로 확인한다. 한 번 어긋난 적 있다"* 였다. 손으로 세는 동안 **또 어긋났다** —
20·21·22단계에서 연속 세 번 README 표에 행이 안 들어가 합계 156 과 선언 175 가 벌어졌고,
세 번째를 리뷰가 잡았다.

**기준을 문서에서 안 읽는다.** 검사기를 하나씩 실제로 실행해 얻은 수가 기준이고, 문서 셋을
거기 맞춘다 — 문서끼리만 대조하면 넷이 사이좋게 틀릴 수 있다. 합계만이 아니라 **단계별로도**
본다: 합계만 보면 한 단계가 넘치고 다른 단계가 모자라도 통과한다.

**만들자마자 자기 자신을 잡았다.** 게이트가 176개가 됐는데 문서 셋이 175 였다.

### 알려진 한계 (22단계)

- **`saved.js` 의 배선은 정적 검사로만 본다.** 그 파일은 최상단에서 `getElementById` 를 부르고
  마지막에 `load()` 를 부르므로 **게이트가 불러올 수 없다** — 불러오는 순간 요청이 나간다.
  그래서 "함수를 부르고 결과를 붙인다" 는 마지막 한 겹은 글자로만 잰다.

  **21단계처럼 추출까지 가지 않은 이유:** 거기서는 우회가 **조용히** 결과를 바꿨다
  (서버를 다시 불러 보이는 다섯이 달라지는데 화면은 멀쩡해 보였다). 여기서 이 배선이
  깨지면 **화면을 열자마자 보인다** — 재질 줄이 없거나 `matte` 라고 뜬다.
  **판단이 바뀔 조건: 이 배선이 눈에 안 보이는 것을 바꾸게 될 때.**

- **결정 로직은 전부 밖으로 뺐다.** `savedFields`(무엇을 보여줄지) · `finishLine`(어떻게 그릴지)
  둘 다 순수 함수라 게이트가 직접 부른다. 처음에는 `saved.js` 소스에서 `fields.finishes` 라는
  **글자를 찾는** 방식이었는데, `if (false)` 로 감싸거나 `void` 로 버려도 통과했다
  (뮤테이션으로 확인). 21단계 `S21-G4` 와 같은 부류이고 처방도 같다.

- **모듈 전역 가변 상태를 인자로 바꿨다.** 이름표를 `let finishNames` 에 두었더니
  "목록을 받을 때 채운다" 는 **순서에 기대게** 됐고, 채우는 줄을 뒤로 옮기면 첫 그리기가
  id 를 그대로 보였다. 게이트가 그 순서를 볼 방법이 없었다.
  **인자로 받으면 틀릴 순서 자체가 없어진다** — 게이트를 더 만드는 것보다 낫다.

- **`Object.hasOwn` 과 `Array.isArray` 검사를 지우는 변형은 안 잡힌다. 등가라서다** —
  프로토타입에서 나오는 것은 함수·객체라 뒤의 `typeof id !== "string"` 에 걸리고, 배열 표에는
  한글 역할 키가 없어 조회가 늘 `undefined` 다(실측). 그래도 두는 것은 **그 함수가 무엇을
  읽는지가 계약**이기 때문이다. 19단계 `pickFinishes` 와 같은 판정이다.

- **DOM 흉내를 21·22단계가 함께 쓴다**(`scripts/lib/dom-stub.mjs`). 한 벌만 둬서 두 곳이
  갈라지지 않게 한다. 최소로 두되 **브라우저보다 너그럽게는 안 만든다** — 너그러우면
  게이트가 통과하는데 화면이 깨진다.

## 23단계 — 새로고침해도 어두운 모드가 남는다 · A4 (완료)

어두운 모드로 보다가 새로고침하면 **매번 다시 눌러야 했다.**

**이 단계는 명시적 결정을 뒤집는다.** `public/app.js` 가 이렇게 적어 뒀다:

> 모드 상태는 이 영역 클로저 안에만 있다. 전역이나 `localStorage` 에 두지 않는다 —
> 카드마다 다른 모드로 나란히 비교할 수 있고, 이 저장소에 없던 저장 계층을 들이지도 않는다.

**뒤집는 것은 뒤쪽 절반뿐이다.**

| 원래 결정 | 어떻게 됐나 |
|---|---|
| 카드마다 다른 모드로 나란히 비교 | **그대로 산다.** `mode` 는 여전히 펼침 영역 클로저 안에 있다 |
| 저장 계층을 안 들인다 | **뒤집었다.** 기본 모드 **하나**만 기억한다 |

새로 펼치는 카드가 저장된 모드로 시작하고, 그 뒤로는 카드마다 따로 토글할 수 있다.
마지막으로 고른 것이 다음번 기본이 된다 — 별도 버튼을 만들면 두 번 눌러야 한다.

**이 저장소의 첫 `localStorage` 다.** 그래서 문을 좁게 연다.

| 무엇 | 왜 |
|---|---|
| 저장을 만지는 자리가 **한 곳뿐** (`modeStore`) | 흩어지면 어느 값이 어디 저장됐는지 아무도 모르게 되고, 그때는 되돌릴 수도 없다 |
| **접근 자체를 감싼다** | 시크릿 창·사이트 데이터 차단에서 `localStorage` 는 **읽기만 해도 던진다.** 안 감싸면 홈 화면이 통째로 안 뜬다 |
| **쓰기가 막혀도 토글은 된다** | 저장은 편의이고 토글은 기능이다 |
| **저장값을 안 믿는다** | 개발자 도구로 아무 값이나 넣을 수 있다. 그대로 믿으면 `mode` 가 `"purple"` 이 되어 파생 계산이 어디서 터질지 모른다 |
| **`mode` 는 여전히 서버에 안 간다** | 보내면 `selectStructures` 가 다시 돌아 보이는 다섯이 바뀐다(`S15-G11`) |

S23-G1 저장소가 없거나 던져도 안 던지고 밝은 모드로 물러선다 (인자 9가지 + 기본 경로)
    CHECK: node scripts/check-stage23.mjs S23-G1
    EXPECT: S23_G1_OK

S23-G2 왕복이 맞고, 이상한 저장값 8가지·이상한 쓰기 7가지를 안 믿는다
    CHECK: node scripts/check-stage23.mjs S23-G2
    EXPECT: S23_G2_OK

S23-G3 토글이 갈 곳을 보이고 읽어 주는 말이 지금까지 담는다 · 버튼에 칠해진다 · `aria-pressed` 는 안 붙는다
    CHECK: node scripts/check-stage23.mjs S23-G3
    EXPECT: S23_G3_OK

S23-G4 화면이 저장된 모드로 시작하고 토글이 갱신한다 · mode 는 여전히 카드마다 따로다
    CHECK: node scripts/check-stage23.mjs S23-G4
    EXPECT: S23_G4_OK

S23-G5 조회 요청에 mode 가 안 붙는다 · 저장 요청에는 붙는다 (S15-G11 회귀 · 양성 대조)
    CHECK: node scripts/check-stage23.mjs S23-G5
    EXPECT: S23_G5_OK

S23-G6 저장소를 만지는 자리가 ui.js 한 곳뿐이고 감싸여 있다 (화면 5개 확인)
    CHECK: node scripts/check-stage23.mjs S23-G6
    EXPECT: S23_G6_OK

**두 토글이 서로 같은 방식을 쓴다 — 리뷰가 어긋남을 잡았다.**

`aria-pressed` 는 **버튼 이름이 가리키는 것이 켜져 있다**는 뜻인데, 이 버튼의 이름
(=보이는 글자)은 **갈 곳**을 말한다. 둘을 합치면 어두운 모드에서
`"밝은 배경으로 보기, 눌림"` 으로 읽혀 **거꾸로**가 된다. 이름을 고정하면 이번에는
보이는 글자와 달라져 음성 조작이 막힌다(WCAG 2.5.3).

그래서 20단계 엔진 토글과 같이 **`aria-label` 이 지금과 갈 곳을 함께 말하고**, 그 안에
보이는 글자가 그대로 들어 있다. 눈으로 보는 상태 표시는 `data-mode` 로 옮겼다.

**20단계 주석에 적어 둔 근거가 틀렸었다** — *"15단계는 이진 상태라 `aria-pressed` 가 맞다"*.
이진 상태냐가 아니라 **이름이 무엇을 가리키느냐**가 갈림길이다.

### 알려진 한계 (23단계)

- **`S23-G4`·`S23-G5` 는 정적 검사다.** `app.js` 는 최상단에서 `getElementById` 를 부르고
  마지막에 요청을 보내므로 게이트가 불러올 수 없다. 판정 로직은 순수 함수 셋
  (`modeStore` · `modeToggle` · `applyModeButton`)이 갖고 있고 `S23-G1`~`G3` 이 직접 부른다.

- **뮤테이션 둘이 처음에 살아남았고 둘 다 게이트를 고쳤다.**
  - **기본 저장소 접근의 감싸기를 빼도 안 잡혔다.** 게이트가 늘 가짜 저장소를 넘겨 줘서
    기본 경로를 한 번도 안 밟았기 때문이다. `globalThis.localStorage` 를 던지는 getter 로
    바꿔 놓고 인자 없이 부르는 검사를 더했다.
  - **버튼에 처음 칠하는 호출을 지워도 안 잡혔다.** 정적 검사는 "처음에 칠했는가" 를 못 본다.
    칠하는 일을 `applyModeButton` 으로 빼고 게이트가 **가짜 버튼에 직접 칠해 본다.**

- **뒤집기와 저장을 한 동작으로 묶었다 — 정적 검사로 순서를 재지 않는다.** 두 줄로 나누면
  맞바꿀 수 있고, 그 고장은 **그 자리에서 안 보인다**(버튼도 색도 제대로 바뀐다).
  새로고침해야 드러나고 그때는 이 단계가 통째로 무효다. 리뷰가 변형으로 재현했을 때
  여섯 게이트가 전부 통과했다. `nextMode` 가 둘을 묶고 `S23-G2` 가 직접 부른다.
  **게이트를 하나 더 만드는 것보다 틀릴 수 없게 만드는 것이 낫다** — 22단계에서 이름표를
  인자로 바꾼 것과 같은 처방이고 두 번째 사례다.

- **`S23-G6` 은 화면 파일 목록을 손으로 적는다.** 새 화면이 생기면 그 파일이 검사에서
  빠진다. 목록을 자동으로 만들면 없는 파일에서 조용히 건너뛰게 되어 더 나쁘다 —
  **손으로 적고, 새 화면을 더할 때 여기도 더한다.**

## 24단계 — 명도로 가른다고 한 배색은 본문이 읽혀야 한다 · C1 (완료)

작업 목록의 C1 은 이렇게 적혀 있었다 — *"밝은 243건 · 어두운 169건이 3:1 미만.
잘 안 보이는 배색이 나가고 있다"*. **재보니 그 수는 맞고 그 처방은 틀렸다.**

**대비를 일괄로 요구하면 기법 하나가 사라진다.** `tone-in-tone` 의 정의가
*"명도·채도를 고정하고 색상만 가로로 움직인다"* 이므로, 그 구조의 1:1 근처 대비는
고장이 아니라 **기법이 작동하는 모습**이다. 8구조에 같은 문턱을 걸면 그것을 지운다.

**실제 결함은 좁다.** 카탈로그에서 스스로 *명도로 가른다*고 말한 구조만 추리면 둘이다.

| 구조 | 카탈로그가 한 말 | 본문이 읽히나 (씨앗 40 × 모드 2 = 80건 중) |
|---|---|---|
| `tone-on-tone` | *"바탕부터 본문까지 한 색으로 덮을 때 쓴다"* | **62건 실패** |
| `value-scale` | *"명·중·암을 확보하면 가독성 문제가 대부분 여기서 끝난다"* | 0건 실패 |

**씨앗은 코퍼스 16쌍과 씨앗 풀 24쌍을 합친 40쌍이다.** 처음엔 코퍼스만 쟀고(32건) 리뷰가
잡았다 — 씨앗 풀은 `/api/expand` 로 **이미 나가고 있는데**(`S12-G6`) 게이트 밖에 있었다.

**같은 것을 약속한 두 구조가 갈렸다 — 그러니 "이 기법이 원래 그렇다" 가 아니다.**

원인은 앵커였다. `tone-on-tone` 의 본문이 `mid`(0.5) 에 앉아 있었고, 바탕 `light`(0.93)
과의 대비는 **순수 회색으로 계산해도 최대 3.37:1** 이다 — **어떤 색으로도 4.5 에 못 닿는
자리**였다. `value-scale` 의 본문은 `lower`(0.32) 에 있다(회색 기준 6.67:1).

고친 것은 둘이다.

| 무엇 | 왜 |
|---|---|
| 본문을 `mid` → `lower` 로 | 구조적 필연. `mid` 는 닿을 수 없는 자리다 |
| 닿지 않으면 **채도만** 뺀다 (`readable`) | **HSL 명도는 지각 휘도가 아니다** — l=0.5 에서 노랑 휘도 0.510, 파랑 0.081 `[실측]`. 앵커만으로는 색상에 따라 못 닿는다. 80건 중 **9건만** 손댄다 |

**매직 넘버가 없다.** 4.5:1 은 WCAG 2.2 일반 크기 글자 기준이고 `[문헌]`, 이 저장소가
스와치 글자색에 이미 쓰던 값이다(`S2-G5`·`S13-G6`).

**바뀐 범위** — 기준선 320장(씨앗 40 × 구조 8) 중 **40장**, 전부 `tone-on-tone`, 그중에도
**본문 색 하나만**. 바탕·강조는 한 바이트도 안 바뀌고 `value-scale` 은 0장, 씨앗과 코퍼스는
그대로다 `[실측]`. `S24-G6` 이 이 문장을 **git 이력과 대조해** 확인한다.

S24-G1 명도로 가른다고 한 구조는 본문↔바탕이 4.5:1 이상이다 (씨앗 40 × 모드 2 전수)
    CHECK: node scripts/check-stage24.mjs S24-G1
    EXPECT: S24_G1_OK

S24-G2 같은 구조에서 강조↔바탕이 3:1 이상이다 (본문을 고치며 강조를 흔들지 않았는가)
    CHECK: node scripts/check-stage24.mjs S24-G2
    EXPECT: S24_G2_OK

S24-G3 명도를 고정한다고 한 구조는 대비가 낮은 채로 남는다 · 음성 대조 + 양성 대조
    CHECK: node scripts/check-stage24.mjs S24-G3
    EXPECT: S24_G3_OK

S24-G4 여덟 구조가 전부 분류돼 있고 `S11-G7` 의 목록과 어긋나지 않는다
    CHECK: node scripts/check-stage24.mjs S24-G4
    EXPECT: S24_G4_OK

S24-G5 대비 계산이 문헌 값 6개와 맞다 · 화면 구현과 게이트 구현이 파생색 1360개에서 일치
    CHECK: node scripts/check-stage24.mjs S24-G5
    EXPECT: S24_G5_OK

S24-G6 기준선 개정 기록이 정직하다 — git 의 옛 기준선과 대조해 **적은 칸만** 바뀌었다
    CHECK: node scripts/check-stage24.mjs S24-G6
    EXPECT: S24_G6_OK

### 알려진 한계 (24단계)

- **`aerial` 을 처음에 잘못 분류했고 `S24-G3` 이 잡았다.** 원리가 *"먼 쪽은 대비·채도를
  낮추고"* 라 "평평한 구조" 로 넣었는데 중앙값이 4.75 로 나왔다. 다시 읽으면 그것은
  **층끼리의 상대 순서**를 말하는 것이지 절대적으로 평평하다는 말이 아니다. 그 순서는
  32/32 로 지켜지지만 **게이트가 없다** — 이 단계의 범위가 아니라 남겨 둔다.

- **분류표를 손으로 적는다.** 새 구조가 생기면 `PROMISES` 에 더해야 하고, 안 더하면
  `S24-G4` 가 운다. 자동으로 만들면 새 구조가 조용히 아무 검사도 안 받게 되어 더 나쁘다 —
  `S18-G13` 의 형식 목록과 같은 처방이다.

- **`value-scale` 에 건 보장은 오늘 무동작이다.** 40씨앗 × 2모드 80건 전부에서 이미
  4.71:1 이상이라 채도를 한 번도 안 뺀다 `[실측]`. 그래도 거는 것은 **약속이 구조에 붙어
  있지 씨앗 목록에 붙어 있지 않기 때문**이다 — 씨앗이 더 늘거나 앵커를 조정하면 여기도
  못 닿는 색이 온다.

- **가장 아슬아슬한 칸의 여유가 `0.0017` 이다** (`tone-on-tone`/`pair-07`/밝은 모드,
  실측 4.5017). `readable` 의 이분 탐색이 문턱 바로 위에서 멈추기 때문이라 **의도된 값**이고,
  게이트 구현과 화면 구현의 차이는 파생색 1360건에서 **정확히 0** 이다 `[실측]` — 반올림으로
  뒤집힐 자리가 아니다. 다만 여유를 두는 상수를 따로 만들지 않았으므로, 앵커나 색공간 변환을
  건드리면 이 칸이 먼저 운다.

- **기준선을 통째로 다시 만들지 않았다.** 그 파일이 스스로 *"다시 만들면 게이트가
  아무것도 검사하지 않게 된다"* 고 경고한다. 바뀐 줄만 갈고 옛 값 40개를 `_revisions` 에
  이유·범위와 함께 남겼으며, `S24-G6` 이 그 기록이 정직한지 본다.

- **`S24-G6` 의 "적은 것만 바뀌었다" 검사는 처음에 죽은 코드였다.** 검사할 집합을
  `_revisions` 에서 만들고 같은 `_revisions` 를 훑었으니 조건이 언제나 참이었다.
  리뷰어 둘이 **각자 다른 구조의 앵커를 바꿔 기준선을 다시 만들고도** 이 게이트가 통과하는
  것을 재현했다. **자기 파일만 보고는 원리적으로 못 잡는다** — 그 안에 '안 바꾼 구조의 옛
  값' 이 없고, 통째로 다시 만들면 기록도 함께 다시 쓸 수 있다. 그래서 게이트가 **git 에서 이 파일이 태어난
  커밋을 스스로 구해** 그때의 기준선을 꺼내고, 지금 파일과 320칸을 대조한다. 기록에도
  `baseSha`(그 수정이 고친 대상 커밋)를 적어 두는데, 그것은 **적힌 옛 값이 진짜인지 보는
  용도**이지 고정점이 아니다.

  **고정점을 감시 대상이 고르게 두면 안 된다 — 2차 리뷰가 그것으로 뚫었다.** 처음엔
  `_revisions[0].baseSha` 를 고정점으로 썼는데, 몰래 재생성한 커밋을 먼저 만들고 그 위에
  정당한 수정을 올린 뒤 `baseSha` 로 **자기가 만든 그 커밋**을 가리키면 둘 사이 차이가 0 이라
  조용히 통과했다 `[실측`, 같은 저장소 상태에서 고정점만 바꿔 A/B 확인`]`. 이 저장소가
  게이트마다 지키는 규칙 — **감시 대상에서 값을 가져오지 않는다** — 을 거기서 어긴 것이었다. 변형 7개(비기록 구조 변경 후 전체 재생성 · 기록 위조 2종 ·
  `baseSha` 삭제 · 없는 커밋 지목 · 기록에서 씨앗 빼기 · **재생성을 먼저 커밋하고 고정점을
  그리로 옮기기**)가 전부 잡히는 것을 확인했다 `[실측]`. 마지막 것은 리뷰어 둘과 제가
  각각 다른 구조로 재현했다.

  **남는 구멍**: git 이력을 못 읽는 곳에서는 게이트가 **실패**한다(조용히 넘어가지 않는다).
  이력 자체를 다시 쓰면(force push) 고정점이 바뀌지만, 그것은 기준선 파일을 조용히 갈아
  끼우는 것과 다른 종류의 일이고 흔적이 남는다.

- **CI 를 붙일 때 얕은 클론을 쓰면 이 게이트가 늘 실패한다.** `git clone --depth 1` 로
  실제로 만들어 확인했다 — 고정점(파일이 태어난 커밋)이 이력에 없어서 `S24-G6` 이
  exit 1 로 끝난다 `[실측]`. **결함이 없어도 실패한다.** 지금 이 저장소에 CI 설정이 없어
  드러나지 않을 뿐이고, 붙이는 날 `fetch-depth: 0`(전체 이력)이 필요하다. 조용히 통과하는
  것보다 낫다고 보고 이 성질을 그대로 둔다 — 검사할 근거가 없으면 통과가 아니라 실패다.

- **`_revisions` 가 둘 이상으로 늘면 순서가 뜻을 갖는다.** 가장 오래된 기록의 `baseSha` 를
  고정점으로 삼으므로 `stage` 오름차순을 요구한다. `stage` 는 사람이 적는 숫자라 위조할
  수 있지만, 위조해도 **그 `baseSha` 시점의 실제 값과 대조하는 검사가 따로 돌아서** 걸린다.
  다만 지금은 기록이 하나뿐이라 **두 건 이상의 경로는 실제로 안 돌려 봤다** — 다음에 기준선을
  또 고칠 때 이 부분을 다시 검증한다.

- **`S15-G8` 이 이 변경을 잡았고 게이트 쪽을 고쳤다.** `mid` 는 밝음↔어두움 거울의
  **고정점**이라 그 자리 색은 두 모드에서 같았고, `MID_FIXED` 가 그것을 지키고 있었다.
  본문이 `lower` 로 가면서 두 모드가 갈리는데 **그게 맞다** — 어두운 바탕에는 밝은 본문이
  놓여야 한다. 전에는 두 모드가 같아서 어두운 모드 대비가 3.02 까지 내려갔다.
  `MID_FIXED` 를 `aerial`/중간 하나로 줄였다.

## 25단계 — 오류 문구가 거짓말하지 않고, 보이지 않는 질의가 모델을 안 부른다 · D1·D2

작업 목록의 작은 것 둘이다. 둘 다 **말과 실제가 어긋나는** 종류다.

**D1 — "아직 확인하지 않았다" 는 확인한 뒤에도 남았다.** `ollama.js` 의 `refresh()` 는
탐지가 실패해도 상태가 `ready` 였을 때만 `unavailable` 로 바꾼다. 서버가 뜬 직후처럼 상태가
`unknown` 이면 **탐지를 했는데도** `unknown` 과 처음 문구가 그대로 남아, 호출부 셋
(`selectStructures` · `selectFinishes` · `rewrite`)이 `"Ollama 를 쓸 수 없다 (아직 확인하지
않았다)"` 라고 말한다. 반대로 탐지가 **성공**해도 `detail` 을 안 바꿔 `ready` 인데 사유가
"아직 확인하지 않았다" 인 채로 `/api/status` 에 나간다. 둘 다 같은 자리에서 고친다 — 탐지
결과를 **상태와 사유 양쪽에** 적는다. 이미 더 구체적인 사유(`ollama 을 찾을 수 없다` 같은
기동 실패)가 있으면 덮어쓰지 않는다.

**D2 — `.trim()` 은 폭 0 문자를 공백으로 안 본다.** U+200B(zero-width space) 같은 서식 문자만
있는 질의가 "빈 질의" 검사를 지나 모델을 한 번 부른다. 17-A 가 `structure.js`·`finish.js`
두 곳이라고 적었는데, **`/api/search` 도 같다** — 서버가 `q` 를 `.trim()` 으로만 거르고,
그 질의는 전문 검색에서 아무것도 못 잡아 저신뢰로 떨어지며, 그 자리에서 `rewrite()` 가 모델을
부른다. 세 곳이 같은 판단을 하므로 **한 함수**(`cleanQuery`)로 모은다. 지우는 것은 유니코드
서식 문자(`\p{Cf}`)이지 질의를 거부하는 것이 아니다 — 폭 0 문자가 섞인 진짜 질의는 그것만
빠진 채 그대로 간다.

S25-G1 Ollama 가 죽어 있으면 확인한 뒤 "없다" 고 말한다 — 호출부 셋의 사유에 "아직 확인하지 않았다" 가 없고, 떠 있으면 ready 의 사유도 그 문구가 아니다 (양성 대조)
    CHECK: node scripts/check-stage25.mjs S25-G1
    EXPECT: S25_G1_OK

S25-G2 더 구체적인 사유를 덮어쓰지 않는다 — 기동 실패 사유가 TTL 이 지난 뒤의 재탐지에도 남는다
    CHECK: node scripts/check-stage25.mjs S25-G2
    EXPECT: S25_G2_OK

S25-G3 폭 0 문자만 있는 질의는 세 경로(구조 선택 · 재질 배정 · `/api/search`) 어디서도 모델을 안 부른다 · 진짜 질의는 부른다 (양성 대조)
    CHECK: node scripts/check-stage25.mjs S25-G3
    EXPECT: S25_G3_OK

S25-G4 3단계 게이트 10개가 그대로 통과한다 — `refresh()` 를 건드렸으므로 수명주기 회귀를 함께 본다
    CHECK: node scripts/check-stage25.mjs S25-G4
    EXPECT: S25_G4_OK

S25-G5 ready 의 사유도 안 덮어쓴다 — 우리가 띄운 Ollama 의 "자동 기동함" 이 TTL 이 지난 뒤의 재확인에도 남는다 (실제 기동 · S3-G2 와 같은 전제)
    CHECK: node scripts/check-stage25.mjs S25-G5
    EXPECT: S25_G5_OK

### 알려진 한계 (25단계)

- **처음 구현은 `ready` 사유를 매번 덮어썼고 리뷰가 잡았다.** "탐지 성공도 사유에 적는다" 를
  조건 없이 적었더니, `ensureRunning()` 이 남긴 `"자동 기동함 (host)"` 이 TTL(5초) 뒤 첫
  재확인에서 `"host 응답"` 으로 바뀌었다. 상태값은 안 바뀌어 게이트 넷이 전부 조용했다 —
  툴팁 문구만 달라지는 변화라서다. 지금은 `ready` 로 **바뀔 때만** 사유를 적고, `S25-G5` 가
  실제 Ollama 를 띄워 그것을 본다. `S3-G2` 처럼 이 기계에 `ollama` 가 있어야 성립한다.

- **`rewrite()` 안쪽은 `cleanQuery` 를 안 부른다.** 호출자(`server.js`)가 정리해서 넘긴다는
  전제에 선다. 안쪽에서 한 번 더 지우는 것은 이중 방어라 게이트로 못 잡는다(17단계가
  `parseAssignment` 에 같은 선을 그었다). `rewrite()` 를 직접 부르는 경로가 새로 생기면 그때
  안쪽으로 옮긴다.

- **화면 쪽 `.trim()` 은 그대로다.** `public/app.js` 가 제출 전에 `input.value.trim()` 으로
  거르는데 그것도 서식 문자를 못 본다. 그래서 폭 0 문자만 넣고 제출하면 서버까지 갔다가 400
  "q 가 비어 있다" 를 받는다. 입력창도 비어 보이므로 문구가 오도하지는 않고, 모델은 안 부른다.
  화면에서 한 번 더 거르는 것은 이 단계의 범위 밖이다.

## 26단계 — 검색 3단계 하이브리드 · BM25 와 임베딩이 어긋나면 확신을 거둔다

코퍼스 어휘와 겹치지 않는 질의 18건을 1·2단계에 넣었더니 **7건만 맞았다** `[실측]`. 틀린 11건 중
9건은 3단계가 없어서가 아니라 **1단계가 "색"·"브랜드"·"같아요" 같은 흔한 어절 하나로 확신해**
LLM 까지 안 내려간 것이다. 그래서 3단계를 붙이면서 그 거짓 확신도 함께 거둔다(대표 결정).

임베딩(`bge-m3`)만으로 같은 질의 23건(실측 18 + `S1-G2` 5)에서 top1 17 · 라우팅 22 `[실측]`.
지연은 따뜻할 때 45ms, 간헐적 2.2초. 그래서 확신 검색 경로의 임베딩은 0.7초 예산으로 부르고
넘기면 BM25 답을 그대로 쓴다 — `S3-G8` 의 "1초 미만" 안에 들어야 하므로 1초보다 짧다.

설계: `docs/superpowers/specs/2026-09-13-hybrid-search-design.md` · 계획: `docs/superpowers/plans/2026-09-13-hybrid-search.md`

S26-G1 실측 질의 23건에서 정답이 7 보다 늘고, 거짓 확신 9건이 1단계에 안 남는다 · 두 방법이 같은 답이면 1단계 그대로 (양성 대조) · 실제 bge-m3 필요
    CHECK: node scripts/check-stage26.mjs S26-G1
    EXPECT: S26_G1_OK

S26-G2 정확 매칭 회귀 — `S1-G2` 다섯 건이 여전히 1단계·같은 답이고 LLM 을 안 부른다
    CHECK: node scripts/check-stage26.mjs S26-G2
    EXPECT: S26_G2_OK

S26-G3 임베딩이 없으면(모델 없음 · 죽은 호스트) 1·2단계가 그대로 돌고 상태가 `unavailable` 로 정직하다 (양성 대조: 있으면 `ready`)
    CHECK: node scripts/check-stage26.mjs S26-G3
    EXPECT: S26_G3_OK

S26-G4 확신 검색이 느린 임베딩(3초)에 안 끌린다 — 1초 안에 1단계로 답한다 (양성 대조: 저신뢰 질의는 기다린다)
    CHECK: node scripts/check-stage26.mjs S26-G4
    EXPECT: S26_G4_OK

S26-G5 `hybrid.js` 가 스텁 벡터로 결정적이다 — 동의 판정 · RRF 결합 · 문턱 · 라우팅 (감시 값 사본)
    CHECK: node scripts/check-stage26.mjs S26-G5
    EXPECT: S26_G5_OK

S26-G6 루프백 밖에 바인딩하면 `hybridError` 원문이 안 샌다 (루프백 양성 대조)
    CHECK: node scripts/check-stage26.mjs S26-G6
    EXPECT: S26_G6_OK

S26-G7 화면 — 3단계 배지·문구 · 사다리 3칸 · LLM 횟수가 `usedLlm` 기준 · 턴 기록이 stage 3 을 받는다
    CHECK: node scripts/check-stage26.mjs S26-G7
    EXPECT: S26_G7_OK

### 알려진 한계 (26단계)

- **결과 — 실측 18건 정답 7 → 12** `[실측]`. 거짓 확신 9건은 1단계에 하나도 안 남았다. 남은 오답 4건 중
  2건("너무 병원 같아요" → `pair-10` · "CTA 가 안 눌리게" → `dx-too-many`)은 **결합(RRF)이 BM25 오답에도
  순위 점수를 주어** 임베딩 1위(`dx-clinical`·`dx-weak-accent`)를 밀어낸 것이다. BM25 가 "확신했다가
  임베딩과 어긋난" 경우 그 순위를 덜 믿는 처방이 있지만 이 단계에서는 문서대로 RRF 를 그대로 두었다.
  다음에 손댈 때 이 두 건이 기준이다.
- **`AGREE_TOP` 은 3 으로 시작했다가 1 이 됐다** `[실측]`. 3 이면 거짓 확신 3건이 남는다 — BM25 오답이
  임베딩 상위 3 안에 끼어 "동의" 로 통과했다. 1 로 좁혀도 정답 1단계 8건은 전부 임베딩 1위이기도 해서
  안 흔들린다. `COS_MIN`(0.44)·`AGREE_TOP`·`RRF_K` 를 바꾸면 `hybrid.js` 와 `check-stage26.mjs` 사본을
  함께 고친다 — 한쪽만 고치면 `S26-G5` 가 운다.
- **확신 경로 예산은 1.5초로 적었다가 0.7초가 됐다** `[실측]`. G4 가 잡았다 — 1.5초 예산은 `S3-G8` 의
  "1초 미만" 과 모순이라 확신 질의 왕복이 1516ms 로 나왔다. 따뜻할 때 45ms 라 0.7초면 넉넉하다.
- **G2 는 스텁으로 못 잰다.** 스텁의 무의미한 벡터는 절대 동의하지 않아 다섯 건 전부 3단계로 갔다.
  실제 `bge-m3` 로 잰다(`S3-G3` 와 같은 전제). 회귀는 실제 동작으로 재는 것이 맞다.
- **어휘 부재 3건은 임베딩도 못 잡는 것이 맞다.** "죽어 보여요" 는 `dx-flat-value` 별칭에 없고,
  "숨이 막혀요" 도 `dx-stifling` 별칭에 안 닿으며, "색이 서로 싸워요" 는 `dx-mismatch` 도 맞는 답이다.
  "명절 저녁 식탁의 온기" 는 임베딩도 `dx-warm-up` 을 1위로 본다 — 한쪽 해석이 아니라 `alsoOk` 로 뒀다.
  별칭 보강은 코퍼스 작업이라 이 단계 밖이다.
- **간헐적 2.2초 튐의 원인을 못 잡았다.** GPU 8GB 에 두 모델이 같이 올라간 상태에서 관측됐고, 확신 경로는
  예산으로 피하지만 저신뢰 경로는 그대로 기다린다. 화면이 시간을 그대로 보여 준다.
- **코퍼스 벡터를 캐시하지 않는다.** 서버가 뜰 때마다 34건을 다시 만든다(따뜻할 때 0.5초, 처음 7초).
  게이트가 서버를 여러 번 띄우므로 게이트 시간이 그만큼 는다.
- **처음 구현은 보통 기동 경로에서 임베딩 상태가 `unknown` 에 갇혔고 리뷰가 잡았다.** Ollama 기동에
  성공했을 때만 `prepare` 를 불렀다. 게이트 하네스가 늘 `OLLAMA_AUTOSTART=0` 을 강제해 그 경로를 한 번도
  안 돌렸다 — **하네스의 기본값이 곧 사각지대다.** 지금은 기동 결과와 무관하게 부르고, `S26-G3` 이
  자동 기동을 켠 채 없는 실행 파일로 확인한다.
- **처음 구현은 한 번 `unavailable` 이면 재시작 전까지 3단계를 못 썼고 리뷰가 잡았다.** 25단계가
  `refresh()` 로 "죽으면 죽었다고" 를 만들어 놓고, 임베딩 쪽엔 "살아나면 살아났다고" 가 없었다. 지금은
  `embed.refresh()` 가 5초 TTL 로 다시 `prepare` 를 시도하고 `/api/status` 가 부른다. 반대로 질의 중
  연결 거부가 나면 `unavailable` 로 내린다(타임아웃은 느린 것일 수 있어 안 내린다). `S26-G3` 이 404→200 회복을 본다.
- **재작성 의도가 `other` 면 `stage` 는 2 다.** 임베딩 벡터를 구했어도 결합이 답을 안 정했으면 3단계가
  아니다 — 처음 구현은 `stage: 3` 에 `hybrid: null` 을 냈고 리뷰가 실제 모델로 재현했다. `S26-G3` 이 본다.
- **26단계 전의 대화 기록에는 `usedLlm` 이 없다.** 화면이 그 턴에 한해 `stage === 2` 를 LLM 사용으로
  되돌려 센다. 저장소 파일은 손대지 않는다(마이그레이션 없음).
