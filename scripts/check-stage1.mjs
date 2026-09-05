#!/usr/bin/env node
// 1단계 완료 조건 검사기. GATES.md 의 CHECK 가 이 스크립트를 게이트 id 로 부른다.
//   node scripts/check-stage1.mjs S1-G2

import { existsSync } from "node:fs";
import { createSearcher, loadPalettes } from "../src/palettes.js";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));

// 대표 질의 → 1위로 나와야 하는 조합. 코퍼스에 표면형이 그대로 없는 표현을 섞었다.
const EXPECTED_TOP = [
  ["따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색", "pair-09"],
  ["병원 앱인데 차갑지 않게", "pair-10"],
  ["느와르 포스터 만들건데 고급스러운 빨강", "pair-15"],
  ["청량한 여름 화장품 브랜드", "pair-02"],
  ["신뢰감 주는 금융 앱 색", "pair-10"],
];

// 어미·조사 조각만 겹치는 질의. 저신뢰로 판정돼야 한다(양성 대조가 아니라 음성 대조).
const EXPECTED_LOW_CONFIDENCE = ["대시보드가 탁해 보여요", "zzz", "그래서 어떻게 되나요"];

const gates = {
  "S1-G1"() {
    const palettes = loadPalettes();
    if (palettes.length !== 16) return `조합이 16개가 아니라 ${palettes.length}개`;
    const ids = new Set();
    for (const p of palettes) {
      for (const field of ["id", "name", "type", "summary", "impression"]) {
        if (!p[field]) return `${p.id ?? "?"} 에 ${field} 없음`;
      }
      if (ids.has(p.id)) return `id 중복: ${p.id}`;
      ids.add(p.id);
      if (!"ABCD".includes(p.type)) return `${p.id} 유형이 A~D 가 아님: ${p.type}`;
      if (p.colors?.length !== 2) return `${p.id} 색이 2개가 아님`;
      for (const c of p.colors) {
        if (!/^#[0-9A-F]{6}$/.test(c.hex)) return `${p.id} 헥스 형식 오류: ${c.hex}`;
      }
      // 면적 비율은 코퍼스에 없다. 원전이 말하지 않는 값이기 때문이다 —
      // 규칙은 public/ratio.js 에 있고 S2-G7 이 검사한다.
      if (p.defaultRatio !== undefined) {
        return `${p.id} 에 defaultRatio 가 남아 있다. 면적 규칙은 public/ratio.js 로 옮겼다`;
      }
    }
    return null;
  },

  "S1-G2"() {
    const { search } = createSearcher();
    const failed = [];
    for (const [query, expectedId] of EXPECTED_TOP) {
      const top = search(query, 1)[0];
      if (top?.doc.id !== expectedId) {
        failed.push(`"${query}" → ${top?.doc.id ?? "없음"} (기대 ${expectedId})`);
      }
    }
    return failed.length ? failed.join(" / ") : null;
  },

  "S1-G3"() {
    const { search } = createSearcher();
    const leaked = [];
    for (const query of EXPECTED_LOW_CONFIDENCE) {
      const top = search(query, 1)[0];
      if (top && top.wholeMatches > 0) {
        leaked.push(`"${query}" 가 고신뢰로 판정됨 → ${top.doc.id}`);
      }
    }
    // 양성 대조: 정상 질의는 반드시 고신뢰여야 한다. 이게 없으면 G3 는 항상 통과하는 가짜 게이트다.
    const control = search(EXPECTED_TOP[0][0], 1)[0];
    if (!control || control.wholeMatches === 0) {
      leaked.push("양성 대조 실패 — 정상 질의까지 저신뢰로 판정됨");
    }
    return leaked.length ? leaked.join(" / ") : null;
  },

  "S1-G4"() {
    return existsSync(new URL("../node_modules", import.meta.url)) ? "node_modules 가 생겼다" : null;
  },
};

const id = process.argv[2];
if (!gates[id]) {
  out(`알 수 없는 게이트: ${id}. 가능한 값 — ${Object.keys(gates).join(", ")}`);
  process.exit(2);
}

const failure = gates[id]();
if (failure) {
  out(`${id}_FAIL ${failure}`);
  process.exit(1);
}
out(`${id.replace(/-/g, "_")}_OK`);
