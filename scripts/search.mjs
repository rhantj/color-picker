#!/usr/bin/env node
// 전문 검색만으로 어디까지 되는지 눈으로 보는 CLI. LLM 을 붙이기 전의 기준선이다.
//
//   node scripts/search.mjs "따뜻한데 촌스럽지 않은 오래된 목조 부엌 같은 색"
//   node scripts/search.mjs --limit 3 "느와르 포스터"

import { CorpusError, createSearcher } from "../src/palettes.js";
import { ratioFor } from "../public/ratio.js";

// 한글 출력이 콘솔 코드페이지에 따라 깨지지 않도록 UTF-8 바이트로 직접 쓴다.
const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));

const argv = process.argv.slice(2);
let limit = 5;
const limitAt = argv.indexOf("--limit");
if (limitAt !== -1) {
  const parsed = Number(argv[limitAt + 1]);
  if (!Number.isInteger(parsed) || parsed < 1) {
    out("--limit 에는 1 이상의 정수를 준다");
    process.exit(1);
  }
  limit = parsed;
  argv.splice(limitAt, 2);
}

const query = argv.join(" ").trim();
if (!query) {
  out('사용법: node scripts/search.mjs [--limit N] "찾는 색을 문장으로"');
  process.exit(1);
}

const started = process.hrtime.bigint();
let results;
try {
  results = createSearcher().search(query, limit);
} catch (err) {
  if (err instanceof CorpusError) {
    out(err.message);
    process.exit(1);
  }
  throw err;
}
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

out(`질의: ${query}`);
out(`${results.length}건 · ${elapsedMs.toFixed(1)}ms`);
out();

const confident = results.length > 0 && results[0].wholeMatches > 0;
if (!confident) {
  out("전문 검색이 못 잡았다 — 어절 전체로 겹친 항이 없다. 질의 재작성(2단계)이 필요한 사례.");
  if (results.length === 0) process.exit(0);
  out();
}

for (const [i, r] of results.entries()) {
  const p = r.doc;
  const ratio = ratioFor(p);
  const swatch = p.colors.map((c, idx) => `${c.hex} ${ratio[idx]}%`).join("  ");
  const terms = r.matched
    .slice(0, 5)
    .map((m) => `${m.term}(${m.contribution.toFixed(2)})`)
    .join(" ");

  out(`${String(i + 1).padStart(2, "0")}. ${p.name}  [${p.type}형]  ${r.score.toFixed(3)}`);
  out(`    ${swatch}`);
  out(`    ${p.hueRelation} / ${p.toneRelation}`);
  out(`    ${p.summary}`);
  out(`    매칭: ${terms}`);
  out();
}
