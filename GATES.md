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

### 알려진 한계
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

- **`.trim()` 은 U+200B(zero-width space)를 공백으로 안 본다.** 그런 질의가 오면 "빈 질의" 로
  안 걸러 모델을 한 번 더 부른다. `structure.js`·S14-G3 도 같은 갭을 갖고 있어 이번 단계에서
  새로 생긴 것이 아니고, 보안 문제도 아니다(비용이 조금 든다). 고치려면 두 곳을 함께 고친다.

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
