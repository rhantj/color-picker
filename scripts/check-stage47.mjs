#!/usr/bin/env node
// 47단계(온도가 색 있는 칸에도 닿는다 — open-work J11) 완료 조건 검사기.
//   node scripts/check-stage47.mjs S47-G1
//
// 전에는 온도가 무채색의 기운에만 닿아, "좀 더 따뜻하게" 가 온도 칸만 바꾸면 칩은 뜨는데 색이 하나도 안 바뀌었다 `[실측 10-03]`.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const C = await import("../src/compose.js");
const { hexToOklch, hueDistance } = await import("../src/oklch.js");

/** 극과 폭을 **여기 다시 적는다** — 감시 대상에서 가져오면 그것을 바꾸는 순간 게이트가 함께 느슨해진다. */
const POLE = { warm: 45, cool: 225 };
const SHIFT = 12;
const CHROMATIC = Object.keys(C.HUES).filter((h) => C.HUES[h] !== null);
const hexes = (p) => p.colors.map((c) => c.hex).join();
/** a → b 로 가장 짧게 도는 부호 있는 각(−180~180). */
const signed = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;
const intentOf = (over) => C.parseIntent({ kind: "palette", usage: "general", count: 5, base: { hues: ["blue"], tone: "vivid" }, accent: null, temperature: "neutral", contrast: "medium", avoid: [], ...over });

const GATES = {
  /**
   * 돌리는 양 — `tempered` 는 극 쪽으로만, 최대 12°, 극을 넘지 않는다. 중립은 그대로. 색상 낱말 열둘 × 따뜻 · 차갑 전부와
   * 0~359° 전부를 독립 계산(가장 짧은 쪽으로 min(12, 거리))과 대조한다.
   */
  "S47-G1": async () => {
    const bad = [];
    if (C.TEMPERATURE_SHIFT !== SHIFT || C.TEMPERATURE_POLE.warm !== POLE.warm || C.TEMPERATURE_POLE.cool !== POLE.cool) bad.push(`극 · 폭이 문서와 다르다 (${JSON.stringify(C.TEMPERATURE_POLE)} · ${C.TEMPERATURE_SHIFT})`);
    for (let h = 0; h < 360; h++) {
      if (C.tempered(h, "neutral") !== h) bad.push(`중립인데 ${h} → ${C.tempered(h, "neutral")}`);
      for (const t of ["warm", "cool"]) {
        const got = (((C.tempered(h, t) % 360) + 360) % 360);
        const before = hueDistance(h, POLE[t]);
        const after = hueDistance(got, POLE[t]);
        const moved = hueDistance(h, got);
        const want = Math.min(SHIFT, before);
        if (Math.abs(moved - want) > 1e-9) bad.push(`${h} ${t}: ${moved.toFixed(2)}° 돌렸다 (기대 ${want})`);
        if (Math.abs(after - (before - want)) > 1e-9) bad.push(`${h} ${t}: 극에서 ${before} → ${after.toFixed(2)} — 극 쪽으로 간 게 아니거나 극을 넘었다`);
      }
    }
    return bad.slice(0, 20);
  },

  /**
   * "칩만 바뀌고 색은 그대로" 가 없다 — 온도만 다른 두 의도(따뜻 · 중립 · 차갑)는 색 있는 바탕이면 **늘** 다른 색을 낸다.
   * 색상 열둘 × 톤 열둘 × 쓰임새 넷 × 3안 전부. 그리고 실제로 극 쪽으로 갔는지 첫 칸의 나온 헥스 색상각으로 잰다.
   */
  "S47-G2": async () => {
    const bad = [];
    let checked = 0;
    let closer = 0;
    let measured = 0;
    for (const hue of CHROMATIC) {
      for (const tone of Object.keys(C.TONES)) {
        for (const usage of Object.keys(C.USAGES)) {
          for (let v = 0; v < C.VARIANTS.length; v++) {
            const at = (t) => C.compose(intentOf({ usage, base: { hues: [hue], tone }, temperature: t }), v);
            const [warm, neutral, cool] = ["warm", "neutral", "cool"].map(at);
            checked += 1;
            if (hexes(warm) === hexes(neutral) || hexes(cool) === hexes(neutral)) bad.push(`${hue}/${tone}/${usage}/${v}: 온도를 바꿔도 색이 그대로다`);
            // 방향 — 칸마다 따뜻하게 · 차갑게가 바탕 각이 돈 쪽으로 돈다(서로 반대). 칸 하나하나를 극과의 거리로 재지 않는다:
            // 대담안은 한 색상 안에서 칸을 양옆으로 벌려, 극 너머에 있는 칸은 극에서 멀어지는 게 맞다(바탕 각이 극으로 갔다).
            // 채도가 C 0.06 이상인 칸만 각을 믿고 3° 를 봐준다 — 어둡고 옅은 색은 8비트 반올림만으로 각이 몇 도씩 흔들린다
            // (어두운 남색 면 C 0.04 에서 14.7° 로 잰 적이 있다. 방향은 맞았다).
            const H = C.HUES[hue];
            const sign = (t) => Math.sign(signed(H, C.tempered(H, t)));
            neutral.colors.forEach((nc, i) => {
              const n = hexToOklch(nc.hex);
              if (n.c < 0.06) return;
              for (const [t, p] of [["warm", warm], ["cool", cool]]) {
                const x = hexToOklch(p.colors[i].hex);
                if (x.c < 0.06 || sign(t) === 0) continue;
                measured += 1;
                const d = signed(n.h, x.h);
                if (Math.sign(d) === sign(t) && Math.abs(d) <= SHIFT + 3) closer += 1;
                else bad.push(`${hue}/${tone}/${usage}/${v} ${nc.role} ${t}: ${d.toFixed(1)}° 돌았다 (기대 ${sign(t) > 0 ? "+" : "−"} 쪽 · ${SHIFT}° 안)`);
              }
            });
          }
        }
      }
    }
    if (checked !== CHROMATIC.length * 12 * 4 * 3) bad.push(`검사한 경우가 ${checked}개 — 헛돈다`);
    if (measured < 1000) bad.push(`각을 잰 칸이 ${measured}개뿐이다 — 양성 대조가 약하다`);
    if (bad.length === 0) out(`  ${checked}경우 전부 색이 바뀜 · 각을 잰 칸 ${measured}개 전부 제 쪽으로(${closer})`);
    return bad.slice(0, 20);
  },

  /**
   * 말한 포인트는 온도로 안 돌린다 — "청록 포인트" 는 따뜻하게 해도 같은 헥스(일반 · UI). 포인트가 없는 UI 의 강조는 바탕 색상에서 오므로
   * 함께 돈다(양성 대조). 무채색 바탕은 46단계 전처럼 기운(NEUTRAL_TINT)만 바뀐다.
   */
  "S47-G3": async () => {
    const bad = [];
    for (const usage of ["general", "ui", "illustration", "brand"]) {
      for (const accentHue of CHROMATIC) {
        const at = (t) => C.compose(intentOf({ usage, base: { hues: ["green"], tone: "soft" }, accent: { hue: accentHue, tone: "vivid" }, temperature: t }), 0);
        const pick = (p) => p.colors.find((c) => c.role === "강조색" || c.role === "강조")?.hex;
        const [w, n, c] = ["warm", "neutral", "cool"].map(at).map(pick);
        if (!n) bad.push(`${usage}/${accentHue}: 강조 칸이 없다`);
        else if (usage !== "ui" && (w !== n || c !== n)) bad.push(`${usage}/${accentHue}: 말한 포인트가 온도로 바뀌었다 (${c} · ${n} · ${w})`);
        // UI 강조는 바탕과의 대비를 맞추려고 밝기만 밀 수 있다 — 각(색상)이 그대로인지로 본다.
        else if (usage === "ui") {
          const hn = hexToOklch(n);
          for (const [label, hex] of [["따뜻", w], ["차갑", c]]) {
            const hx = hexToOklch(hex);
            if (hn.c > 0.04 && hx.c > 0.04 && hueDistance(hx.h, hn.h) > 3) bad.push(`ui/${accentHue}: 말한 포인트의 색상이 ${label}에서 ${hueDistance(hx.h, hn.h).toFixed(1)}° 돌았다`);
          }
        }
      }
    }
    // 양성 대조 — 포인트가 없는 UI 의 강조는 바탕 색상(돌린 각)을 따른다.
    const noAccent = (t) => C.compose(intentOf({ usage: "ui", base: { hues: ["green"], tone: "strong" }, temperature: t }), 0).colors.find((c) => c.role === "강조").hex;
    if (noAccent("warm") === noAccent("neutral")) bad.push("포인트가 없는 UI 의 강조가 온도로 안 돈다 — 바탕 색상에서 오는데");
    // 무채색 바탕은 기운만 — 따뜻 · 차갑이 서로 다르다(46단계 전과 같은 길).
    const gray = (t) => hexes(C.compose(intentOf({ base: { hues: ["neutral"], tone: "grayish" }, temperature: t }), 0));
    if (gray("warm") === gray("cool")) bad.push("무채색 바탕이 온도로 안 바뀐다");
    return bad.slice(0, 20);
  },

  /** 뺄 색이 온도보다 이긴다 — "주황 빼고 따뜻하게" 에서 온도가 주황 쪽으로 끌어도 결과 색은 주황 띠 밖(또는 채도가 띠 문턱 아래). */
  "S47-G4": async () => {
    const bad = [];
    let checked = 0;
    for (const avoid of ["orange", "red", "blue", "cyan"]) {
      for (const t of ["warm", "cool"]) {
        for (const hue of CHROMATIC.filter((h) => h !== avoid)) {
          for (let v = 0; v < C.VARIANTS.length; v++) {
            const p = C.compose(intentOf({ base: { hues: [hue], tone: "vivid" }, accent: { hue: "green", tone: "vivid" }, temperature: t, avoid: [avoid] }), v);
            for (const c of p.colors) {
              checked += 1;
              const o = hexToOklch(c.hex);
              if (o.c > C.AVOID_CHROMA && hueDistance(o.h, C.HUES[avoid]) < C.AVOID_BAND) bad.push(`${avoid} 빼고 ${t} · ${hue}/${v}: ${c.role} ${c.hex} 가 뺄 색 띠 안(h ${o.h.toFixed(0)} · C ${o.c.toFixed(3)})`);
            }
          }
        }
      }
    }
    if (checked < 500) bad.push(`검사한 색이 ${checked}개 — 헛돈다`);
    return bad.slice(0, 20);
  },

  /** 회귀 — 문장 팔레트(42) · 다듬기(43) · 팔레트 다듬기(46, 회귀 게이트 G8 제외) 게이트가 그대로 통과한다. */
  "S47-G5": async () => {
    const bad = [];
    const runs = [
      ["check-stage42.mjs", Array.from({ length: 12 }, (_, i) => i + 1)],
      ["check-stage43.mjs", Array.from({ length: 10 }, (_, i) => i + 1)],
      ["check-stage46.mjs", [1, 2, 3, 4, 5, 6, 7]],
    ];
    let passed = 0;
    for (const [script, nums] of runs) {
      for (const i of nums) {
        const id = `S${script.match(/\d+/)[0]}-G${i}`;
        const r = spawnSync(process.execPath, [join(ROOT, "scripts", script), id], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
        if (r.stdout.includes(`${id.replace(/-/g, "_")}_OK`) && r.status === 0) passed += 1;
        else bad.push(`${id} 실패: ${(r.stdout + r.stderr).trim().split("\n").slice(-2).join(" / ").slice(0, 160)}`);
      }
    }
    // 문서 — 극 · 폭이 [판단] 으로 적혀 있다.
    const src = read("src/compose.js");
    if (!/온도의 극 `\[판단\]`/.test(src) || !/온도로 색상각을 돌리는 최대 폭 `\[판단\]`/.test(src)) bad.push("compose.js 에 온도 극이 [판단] 으로 적혀 있지 않다");
    if (bad.length === 0) out(`  회귀 — 게이트 ${passed}개가 그대로 통과`);
    return bad;
  },
};

const id = process.argv[2];
if (!GATES[id]) {
  out(`모르는 게이트: ${id}. 아는 것: ${Object.keys(GATES).join(", ")}`);
  process.exitCode = 1;
} else {
  const bad = await GATES[id]().catch((err) => [`검사 자체가 실패: ${err.message}`]);
  if (bad.length === 0) {
    out(`${id.replace(/-/g, "_")}_OK`);
  } else {
    for (const b of bad) out(`- ${b}`);
    out(`${id} 실패 (${bad.length})`);
    process.exitCode = 1;
  }
}
