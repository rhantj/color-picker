// 씨앗 전용 풀. **검색되지 않는다.**
//
// 왜 별개 파일인가: `data/palettes.json` 16쌍은 유형(A~D)·색상각/톤 관계·인상 설명까지 달린
// 큐레이션이고, 이쪽 24쌍은 원서 전사본에서 온 **헥스와 원명뿐**이다. 해설이 없는 것을 있는 척
// 한 파일에 섞으면 검색과 진단 연결이 틀린 근거 위에서 돈다.
//
// 그래서 쓰임이 하나다 — `src/expand.js` 가 배색 구조로 불릴 출발점. 색인(`src/bm25.js`)에는
// 닿지 않는다. S12-G2 가 그 경계를 검사한다.
//
// **없어도 된다.** 파일이 없거나 깨져도 검색·서버는 그대로 돈다. 이건 코퍼스가 아니라 부가 자산이라
// 한 항목의 오타가 사이트를 내릴 이유가 없다(`src/bridge.js`·`src/expand.js` 와 같은 선택).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEEDS_PATH = fileURLToPath(new URL("../data/seeds.json", import.meta.url));

const HEX = /^#[0-9A-F]{6}$/;

// **허용 목록으로 본다. 금지 목록이 아니다.**
// 처음엔 코퍼스 쪽 필드 이름을 나열해 막았는데(summary·impression·type·…), 그 검사가 씨앗 객체
// 최상단만 보고 **색 안쪽은 보지 않았다.** 코퍼스는 색마다 한국어 `name` 을 드는 스키마라,
// `colors[0].name = "지어낸 이름"` 이 그대로 통과했다(리뷰 지적, 재현 확인).
//
// 금지 목록은 "앞으로 생길 필드" 를 못 막는다. 스키마가 닫혀 있고 작으므로 허용 목록이 맞다.
// 여기 필드를 늘리려면 이 줄을 고쳐야 하고, 그때 S12-G1·G5 도 함께 보게 된다.
const SEED_KEYS = new Set(["id", "no", "colors"]);
const COLOR_KEYS = new Set(["origName", "hex"]);

const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.has(k));

const usableColor = (c) =>
  c !== null &&
  typeof c === "object" &&
  typeof c.hex === "string" &&
  HEX.test(c.hex) &&
  typeof c.origName === "string" &&
  c.origName.trim() !== "" &&
  onlyKeys(c, COLOR_KEYS);

const usable = (s) => {
  if (!s || typeof s !== "object") return false;
  if (typeof s.id !== "string" || s.id.trim() === "") return false;
  if (!Array.isArray(s.colors) || s.colors.length !== 2) return false;
  if (!s.colors.every(usableColor)) return false;
  return onlyKeys(s, SEED_KEYS);
};

/**
 * 씨앗 풀을 읽는다. **던지지 않는다** — 읽지 못하면 빈 배열이다.
 *
 * `path` 를 받는 이유는 게이트 때문이다. "파일이 깨져도 도는가" 를 검사하려면 깨진 파일이
 * 필요한데, 경로가 고정이면 게이트가 저장소의 `data/seeds.json` 을 직접 망가뜨려야 한다.
 * 검사 중에 죽으면 저장소가 깨진 채 남는다. 임시 파일을 가리킬 수 있게 열어 둔다.
 *
 * @returns {{id:string, no:number, colors:{origName:string,hex:string}[]}[]}
 */
export function loadSeeds(path = SEEDS_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.seeds)) return [];

  const seen = new Set();
  return parsed.seeds.filter((s) => {
    if (!usable(s) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

/**
 * 화면에 쓸 이름. **데이터에 저장하지 않고 여기서 조립한다** — 두 원명을 기계적으로 잇는 것뿐이라
 * 저장하면 원전이 말한 이름처럼 보인다. `public/ratio.js` 가 면적을 데이터에 안 넣는 것과 같은 이유다.
 */
export const seedLabel = (seed) => seed.colors.map((c) => c.origName).join(" × ");
