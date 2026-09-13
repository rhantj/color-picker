# 검색 4단계 온디맨드 구현 계획 (27단계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `data/palettes.json`·`data/diagnostics.json` 이 바뀌면 재시작 없이 검색(BM25 색인·어휘·임베딩)이 따라가고, 바뀐 문서만 다시 임베딩하며, 임베딩 캐시가 재시작을 넘어 남는다.

**Architecture:** 파이프라인이 코퍼스를 버전 있는 상태로 든다. 요청이 오면 2초 TTL 로 두 파일의 `mtimeMs`·`size` 를 보고, 바뀌었으면 그 자리에서 다시 읽어 색인·어휘·`byId`·`embedDocs`·관계 어휘를 새로 만들고 `embed.prepare()` 를 다시 부른다. `embed.js` 는 `sha1(model + text)` 키의 캐시를 메모리와 `var/embeddings.json` 에 두어 캐시에 없는 문서만 Ollama 에 보낸다.

**Tech Stack:** Node 24 ESM · 의존성 0 · `node:fs.statSync` · `node:crypto.createHash("sha1")` · 기존 `src/embed.js`·`src/pipeline.js` · 검사기 `scripts/check-stage27.mjs`

**Spec:** `docs/superpowers/specs/2026-09-13-on-demand-corpus-design.md`

## Global Constraints

- 의존성 0. 던지지 않는다 — 깨진 코퍼스 파일·깨진 캐시·쓰기 실패는 전부 사유로 남고 서비스는 계속된다.
- 확인 TTL `CORPUS_CHECK_TTL_MS = 2000`. TTL 안에서는 `statSync` 도 안 한다.
- 씨앗 풀·구조 카탈로그·재질은 **그대로 기동 때 고정**(기존 결정). 이 단계는 검색 코퍼스 둘만 건드린다.
- 게이트는 구현보다 먼저. 감시 값(TTL · 캐시 파일 이름 · 필드 이름)은 검사기에 사본으로 적는다.
- 루프백 밖에서 코퍼스 경로·사유 원문을 내보내지 않는다(`rewriteError` 와 같은 경계).
- 캐시 파일은 임시 파일 → `rename` 으로 쓴다(`store.js` 관행). 깨진 파일은 `.corrupt-<time>` 으로 옆에 둔다.
- 커밋은 대표 확인 뒤. 브랜치 `stage-27-on-demand-corpus`, `main` 에 `--ff-only`.
- 설명은 쉬운 말 먼저(프로젝트 `CLAUDE.md`).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/corpus-paths.js` (새) | `TONEFIRST_CORPUS_DIR` 오버라이드를 **한 곳**에서 푼다. `palettes.js`·`diagnostics.js` 가 쓴다 |
| `src/palettes.js` · `src/diagnostics.js` | `CORPUS_PATH` 를 `corpus-paths.js` 에서 받는다. 나머지 그대로 |
| `src/pipeline.js` | 코퍼스를 `state` 객체로 들고 `reloadIfChanged()`·`corpusStatus()`·`version`·`relationVocab` 을 낸다. `rerank` 가 모르는 id 를 버린다 |
| `src/embed.js` | 해시 캐시(메모리 + 디스크) · `prepare` 가 캐시에 없는 문서만 보낸다 · 상태에 `cached`·`embedded` |
| `server.js` | `relationVocab` 상수 제거 → `pipeline.relationVocab` · 세 핸들러가 `reloadIfChanged()` · `/api/status` 에 `corpus` · `maxStage` 4 |
| `public/app.js` | 사다리 4칸은 `maxStage` 로 이미 켜진다(`renderLadder` 그대로). 변경 없음 확인만 |
| `scripts/check-stage27.mjs` (새) | S27-G1~G7 |
| `GATES.md` · `README.md` · `docs/com/open-work.md` · `docs/session-resume/2026-09-13-on-demand-corpus-27.md` | 게이트 200 → 207 |

---

### Task 0: 게이트를 먼저 적는다 (GATES.md 27단계 절 + 검사기 전체)

**Files:**
- Modify: `GATES.md` (끝에 절 추가)
- Create: `scripts/check-stage27.mjs`

**Interfaces:**
- Produces: `node scripts/check-stage27.mjs S27-G<n>` → `S27_G<n>_OK` · exit 0. **일곱 게이트 본문을 이 태스크에서 전부 쓴다** — 구현 전에 일곱이 다 실패하는 것을 봐야 한다(26단계와 같은 방식).

- [ ] **Step 1: `GATES.md` 끝에 절을 붙인다**

```markdown

## 27단계 — 검색 4단계 온디맨드 · 코퍼스가 바뀌면 재시작 없이 따라간다

문서의 4단계는 "문서가 자주 바뀌는 곳에서 그때그때 임베딩" 이다. 이 저장소는 코퍼스 34건이 기동 때
고정돼 있어 **실측이 요구한 단계는 아니다**(마지막 변경 9월 1~5일). 대표가 미리 대응하기로 했고,
그래서 범위를 작게 잡았다 — 검색 코퍼스 둘(팔레트·진단)만, 요청 때 파일 시각을 보고 바뀌었으면
그 자리에서 다시 읽는다. 임베딩은 내용 해시 캐시로 **바뀐 문서만** 다시 만들고 `var/embeddings.json`
에 남겨 재시작을 넘긴다.

설계: `docs/superpowers/specs/2026-09-13-on-demand-corpus-design.md` · 계획: `docs/superpowers/plans/2026-09-13-on-demand-corpus.md`

S27-G1 팔레트 한 건의 요약을 고쳐 저장하면 다음 검색이 재시작 없이 새 내용으로 잡히고 `corpus.version` 이 1 오른다 (안 바꾸면 그대로 · 양성 대조)
    CHECK: node scripts/check-stage27.mjs S27-G1
    EXPECT: S27_G1_OK

S27-G2 바뀐 문서 하나만 다시 임베딩된다 — `/api/embed` 입력이 34건에서 1건으로
    CHECK: node scripts/check-stage27.mjs S27-G2
    EXPECT: S27_G2_OK

S27-G3 재시작해도 캐시가 살아 임베딩 입력이 0건이다 · 모델명이 바뀌면 34건 전부 다시 만든다
    CHECK: node scripts/check-stage27.mjs S27-G3
    EXPECT: S27_G3_OK

S27-G4 깨진 JSON 을 저장해도 옛 코퍼스로 계속 답하고 `corpus.error` 에 사유가 남는다 · 고치면 회복한다
    CHECK: node scripts/check-stage27.mjs S27-G4
    EXPECT: S27_G4_OK

S27-G5 문서를 지우면 재임베딩이 끝나기 전(옛 벡터 창)에도 그 id 가 결과에 안 나온다
    CHECK: node scripts/check-stage27.mjs S27-G5
    EXPECT: S27_G5_OK

S27-G6 캐시 파일이 깨져도 기동하고 옆으로 치운 뒤 새로 만든다 · 문서를 바꿔도 캐시 항목 수가 문서 수를 넘지 않는다
    CHECK: node scripts/check-stage27.mjs S27-G6
    EXPECT: S27_G6_OK

S27-G7 `/api/status` 에 `corpus` 가 있고 `stage` 가 4 다 · 루프백 밖에서 경로·사유 원문이 안 샌다 · `TONEFIRST_CORPUS_DIR` 이 실제로 쓰인다
    CHECK: node scripts/check-stage27.mjs S27-G7
    EXPECT: S27_G7_OK
```

- [ ] **Step 2: 검사기를 쓴다**

`scripts/check-stage27.mjs` — 하네스는 `check-stage26.mjs` 의 `stubOllama`·`startServer`·`withServer`·`waitEmbedReady` 를 **독립적으로 다시 적는다**(한쪽에서 읽어 오면 그쪽이 바뀔 때 조용히 다른 것을 검사한다). 스텁에 `/api/embed` **입력 건수 합계** `embedInputs()` 를 더한다. 아래는 이 단계 고유 부분이다.

```js
#!/usr/bin/env node
// 27단계(검색 4단계 온디맨드) 완료 조건 검사기.
//   node scripts/check-stage27.mjs S27-G1
//
// **이 파일은 구현보다 먼저 쓰였다.** 일곱 게이트가 실패하는 것을 확인한 뒤에 src 를 고쳤다.
//
// 코퍼스를 **임시 폴더에 복사해** 서버에 TONEFIRST_CORPUS_DIR 로 넘긴다. 저장소의 data/ 를 직접 바꾸면
// 다른 게이트가 그 사이 다른 코퍼스를 본다. 캐시도 TONEFIRST_DATA_DIR 로 임시 폴더에 둔다.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const out = (line = "") => process.stdout.write(Buffer.from(line + "\n", "utf8"));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** 감시할 값 사본. 대상에서 가져오지 않는다. */
const CHECK_TTL_MS = 2000;
const CACHE_FILE = "embeddings.json";
const CORPUS_DOCS = 34; // 팔레트 16 + 진단 18

/** 임시 코퍼스·데이터 폴더. 끝나면 지운다. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "tonefirst-27-"));
  const corpus = join(dir, "corpus");
  const data = join(dir, "var");
  cpSync(join(ROOT, "data"), corpus, { recursive: true });
  return {
    corpus,
    data,
    read: (name) => JSON.parse(readFileSync(join(corpus, name), "utf8")),
    write: (name, value) => writeFileSync(join(corpus, name), typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf8"),
    cache: () => (existsSync(join(data, CACHE_FILE)) ? JSON.parse(readFileSync(join(data, CACHE_FILE), "utf8")) : null),
    files: () => (existsSync(data) ? readdirSync(data) : []),
    rm: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** TTL 이 지나게 기다린 뒤 검색한다. mtime 해상도(Windows NTFS 100ns, 일부 FS 1초)를 넘기려고 여유를 둔다. */
const settle = () => new Promise((r) => setTimeout(r, CHECK_TTL_MS + 300));
const search = async (get, q) => (await get(`/api/search?q=${encodeURIComponent(q)}`)).json();
const status = async (get) => (await get("/api/status")).json();
const env = (s, extra = {}) => ({ TONEFIRST_CORPUS_DIR: s.corpus, TONEFIRST_DATA_DIR: s.data, ...extra });
```

게이트 본문:

```js
const GATES = {
  /* 바뀐 요약이 재시작 없이 검색에 잡힌다. 어절 전체 매치가 1단계를 만들도록 코퍼스에 없는 낱말을 넣는다. */
  "S27-G1": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4351, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        const before = await status(get);
        const miss = await search(get, "zzqq 별똥별 카페");
        if (miss.stage === 1 && miss.confident) bad.push("바꾸기 전에 이미 잡힌다 — 이 게이트가 헛돌고 있다");

        // 안 바꾸면 버전 그대로 (양성 대조의 반대편)
        await settle();
        const same = await status(get);
        if (same.corpus.version !== before.corpus.version) bad.push(`안 바꿨는데 version 이 ${before.corpus.version} → ${same.corpus.version}`);

        // pair-01 의 요약에 코퍼스에 없는 낱말을 넣는다
        const doc = s.read("palettes.json");
        doc.palettes[0].summary = `${doc.palettes[0].summary} 별똥별 카페`;
        s.write("palettes.json", doc);
        await settle();
        const hit = await search(get, "zzqq 별똥별 카페");
        const top = hit.route === "palette" ? hit.results[0]?.id : null;
        if (top !== "pair-01") bad.push(`바꾼 뒤에도 못 잡는다: stage ${hit.stage} route ${hit.route} top ${top}`);
        const after = await status(get);
        if (after.corpus.version !== before.corpus.version + 1) bad.push(`version 이 ${before.corpus.version} → ${after.corpus.version} (1 올라야)`);
        if (after.corpus.error !== null) bad.push(`정상 재적재인데 error 가 ${after.corpus.error}`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("요약을 고치자 재시작 없이 잡힌다 · version +1 · 안 바꾸면 그대로");
    out("S27_G1_OK");
  },

  /* 바뀐 문서 하나만 다시 임베딩. 스텁이 /api/embed 입력 건수를 합산한다. */
  "S27-G2": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4352, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        if (stub.embedInputs() !== CORPUS_DOCS) bad.push(`첫 준비의 입력이 ${stub.embedInputs()}건 (${CORPUS_DOCS}건이어야)`);
        stub.reset();
        const doc = s.read("diagnostics.json");
        doc.diagnostics[0].prescription = `${doc.diagnostics[0].prescription} (고침)`;
        s.write("diagnostics.json", doc);
        await settle();
        await search(get, "탁해 보여요");
        await waitEmbedReady(get);
        // 서버가 재임베딩을 기다리지 않으므로 잠깐 더 기다린다
        await new Promise((r) => setTimeout(r, 500));
        if (stub.embedInputs() !== 1) bad.push(`바뀐 문서 1건인데 임베딩 입력이 ${stub.embedInputs()}건`);
        const st = await status(get);
        if (st.embed.cached !== CORPUS_DOCS - 1 || st.embed.embedded !== 1) bad.push(`상태가 cached ${st.embed.cached} · embedded ${st.embed.embedded} (33 · 1 이어야)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("34 → 1건만 재임베딩");
    out("S27_G2_OK");
  },

  /* 캐시가 재시작을 넘긴다 · 모델이 바뀌면 전부 다시. */
  "S27-G3": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
      });
      if (!s.cache()) bad.push("첫 기동 뒤 캐시 파일이 없다");
      stub.reset();
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (stub.embedInputs() !== 0) bad.push(`재시작인데 임베딩 입력이 ${stub.embedInputs()}건 (0 이어야)`);
        if (st.embed.cached !== CORPUS_DOCS) bad.push(`cached 가 ${st.embed.cached}`);
      });
      stub.reset();
      await withServer(4353, { OLLAMA_HOST: stub.host, ...env(s, { OLLAMA_EMBED_MODEL: "other-model" }) }, async (get) => {
        await waitEmbedReady(get);
        if (stub.embedInputs() !== CORPUS_DOCS) bad.push(`모델이 바뀌었는데 입력이 ${stub.embedInputs()}건 (${CORPUS_DOCS} 이어야)`);
      });
      if (s.cache()?.model !== "other-model") bad.push("캐시의 model 이 새 모델로 안 바뀌었다");
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("재시작 시 임베딩 0건 · 모델 변경 시 전부");
    out("S27_G3_OK");
  },

  /* 깨진 JSON 은 옛 코퍼스로 버틴다. 고치면 회복. */
  "S27-G4": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4354, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        const v0 = (await status(get)).corpus.version;
        s.write("palettes.json", '{"palettes": [ {"id": "pair-01", "na');
        await settle();
        const r = await search(get, "병원 앱인데 차갑지 않게");
        if (r.stage !== 1 || r.results[0]?.id !== "pair-10") bad.push(`깨진 파일 뒤 검색이 깨졌다: ${r.stage} ${r.results[0]?.id}`);
        const st = await status(get);
        if (typeof st.corpus.error !== "string") bad.push("깨진 파일인데 error 가 없다");
        if (st.corpus.version !== v0) bad.push("깨진 파일로 version 이 올랐다");
        if (st.corpus.palettes !== 16) bad.push(`옛 코퍼스가 아니다: 팔레트 ${st.corpus.palettes}`);
        // 고치면 회복
        s.write("palettes.json", JSON.stringify(JSON.parse(readFileSync(join(ROOT, "data/palettes.json"), "utf8")), null, 2) + "\n");
        await settle();
        await search(get, "병원 앱인데 차갑지 않게");
        const ok = await status(get);
        if (ok.corpus.error !== null) bad.push(`고쳤는데 error 가 남았다: ${ok.corpus.error}`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("깨진 JSON 에서 옛 코퍼스로 답하고 사유를 남김 · 고치면 회복");
    out("S27_G4_OK");
  },

  /* 지운 문서가 옛 벡터 창에서 안 나온다. 스텁 임베딩을 3초 늦춰 창을 넓힌다. */
  "S27-G5": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      await withServer(4355, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        await waitEmbedReady(get);
        stub.set({ embedDelayMs: 3000 });
        const doc = s.read("palettes.json");
        const removed = doc.palettes.find((p) => p.id === "pair-10");
        doc.palettes = doc.palettes.filter((p) => p.id !== "pair-10");
        s.write("palettes.json", doc);
        await settle();
        // 재임베딩(3초)이 끝나기 전에 검색 — 저신뢰 질의라 결합 재순위가 돈다
        const r = await search(get, "신뢰감 주는 금융 앱 색 zzqq");
        const ids = [...r.results.map((x) => x.id), ...r.diagnostics.map((x) => x.id)];
        if (ids.includes("pair-10")) bad.push(`지운 pair-10 이 결과에 있다: ${ids.join(",")}`);
        if (!removed) bad.push("픽스처에 pair-10 이 없다 — 이 게이트가 헛돌고 있다");
        const st = await status(get);
        if (st.corpus.palettes !== 15) bad.push(`팔레트가 ${st.corpus.palettes} (15 여야)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("지운 문서가 옛 벡터 창에서도 안 나온다");
    out("S27_G5_OK");
  },

  /* 깨진 캐시는 옆으로 치우고 새로 만든다 · 캐시가 자라지 않는다. */
  "S27-G6": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      // 깨진 캐시를 미리 둔다
      const { mkdirSync } = await import("node:fs");
      mkdirSync(s.data, { recursive: true });
      writeFileSync(join(s.data, CACHE_FILE), "{ not json", "utf8");
      await withServer(4356, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (st.embed.state !== "ready") bad.push("깨진 캐시로 기동이 안 됐다");
        if (!s.files().some((f) => f.startsWith(`${CACHE_FILE}.corrupt-`))) bad.push("깨진 캐시를 옆으로 안 치웠다");
        if (!s.cache() || Object.keys(s.cache().entries).length !== CORPUS_DOCS) bad.push("새 캐시가 안 만들어졌다");
        // 문서를 두 번 바꿔도 항목 수는 문서 수
        for (const salt of ["a", "b"]) {
          const doc = s.read("palettes.json");
          doc.palettes[1].summary = `${doc.palettes[1].summary} ${salt}`;
          s.write("palettes.json", doc);
          await settle();
          await search(get, "청량한 여름 화장품 브랜드");
          await new Promise((r) => setTimeout(r, 500));
        }
        const n = Object.keys(s.cache().entries).length;
        if (n !== CORPUS_DOCS) bad.push(`캐시 항목이 ${n}개 (문서 수 ${CORPUS_DOCS} 여야 — 옛 해시가 남았다)`);
      });
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("깨진 캐시 → 옆으로 치우고 새로 · 항목 수 = 문서 수");
    out("S27_G6_OK");
  },

  /* 상태 필드 · 사다리 4 · 경계 · 경로 오버라이드가 실제로 쓰인다. */
  "S27-G7": async () => {
    const bad = [];
    const s = scratch();
    const stub = await stubOllama();
    try {
      // 오버라이드가 실제로 쓰이는가 — 임시 코퍼스의 팔레트를 15건으로 줄여 서버가 15 를 보고하는지
      const doc = s.read("palettes.json");
      doc.palettes = doc.palettes.slice(0, 15);
      s.write("palettes.json", doc);
      await withServer(4357, { OLLAMA_HOST: stub.host, ...env(s) }, async (get) => {
        const st = await waitEmbedReady(get);
        if (st.corpus?.palettes !== 15) bad.push(`TONEFIRST_CORPUS_DIR 이 안 쓰인다: 팔레트 ${st.corpus?.palettes}`);
        for (const k of ["version", "palettes", "diagnostics", "checkedAt", "reloadedAt", "error"]) if (!(k in (st.corpus ?? {}))) bad.push(`corpus.${k} 가 없다`);
        if (st.stage !== 4) bad.push(`stage 가 ${st.stage} (4 여야)`);
      });
      // 루프백 밖 — 깨진 파일의 사유 원문(경로 포함)이 안 샌다
      s.write("palettes.json", "{ broken");
      const server = await startServer(4358, { HOST: "0.0.0.0", OLLAMA_HOST: stub.host, ...env(s) });
      try {
        const get = (p) => fetch(`http://127.0.0.1:4358${p}`);
        await new Promise((r) => setTimeout(r, 500));
        const st = await (await get("/api/status")).json();
        if (typeof st.corpus?.error !== "string") bad.push("루프백 밖에서 error 가 문자열이 아니다");
        else if (st.corpus.error.includes(s.corpus) || /palettes\.json/.test(st.corpus.error)) bad.push(`루프백 밖인데 경로가 샌다: ${st.corpus.error}`);
      } finally {
        server.kill();
      }
    } finally {
      stub.close();
      s.rm();
    }
    if (bad.length) throw new Error(bad.join(" / "));
    out("corpus 필드 · stage 4 · 경계 · 오버라이드 실사용");
    out("S27_G7_OK");
  },
};
```

주의 — G7 의 두 번째 서버는 기동 시점에 이미 깨진 파일이다. 기동 때 코퍼스를 못 읽으면 지금 `server.js` 는 `process.exit(1)` 한다(줄 68~75). **기동 실패는 그대로 둔다**(그건 4단계가 아니라 1단계의 계약이다). 그래서 이 대조는 **정상 기동 뒤 깨뜨리는** 순서로 바꿔 적는다: 서버를 띄운 뒤 `s.write("palettes.json", "{ broken")` → `settle()` → `/api/status`. 구현 전에 이 순서로 고쳐 둔다.

- [ ] **Step 3: 일곱이 전부 실패하는지 본다**

Run: `for g in 1 2 3 4 5 6 7; do node scripts/check-stage27.mjs S27-G$g 2>&1 | tail -1; done`
Expected: 전부 실패. G1·G4·G5·G7 은 `corpus` 필드 없음/`version` undefined, G2·G3·G6 은 임베딩 입력 건수 불일치 또는 캐시 파일 없음.

- [ ] **Step 4: 커밋 (대표 확인 뒤)**

```bash
git checkout -b stage-27-on-demand-corpus
git add GATES.md scripts/check-stage27.mjs
git commit -m "test: 27단계 게이트를 구현보다 먼저 적는다 (온디맨드 코퍼스)"
```

---

### Task 1: 코퍼스 경로 오버라이드 (`src/corpus-paths.js`)

**Files:**
- Create: `src/corpus-paths.js`
- Modify: `src/palettes.js:8` · `src/diagnostics.js:10`

**Interfaces:**
- Produces: `corpusPath(name: "palettes.json"|"diagnostics.json"): string` — `TONEFIRST_CORPUS_DIR` 이 있으면 그 아래, 없으면 `data/`

- [ ] **Step 1: 파일을 쓴다**

```js
// 검색 코퍼스 파일의 자리. 게이트가 저장소의 data/ 를 직접 바꾸지 않고 임시 폴더를 넘길 수 있게
// 환경변수 하나로 연다. store.js 의 TONEFIRST_DATA_DIR 와 같은 모양이다.
//
// 씨앗·구조·재질은 여기 안 둔다 — 그것들은 기동 때 고정이고(기존 결정), 이 단계의 범위 밖이다.

import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = fileURLToPath(new URL("../data/", import.meta.url));

/** @param {"palettes.json"|"diagnostics.json"} name */
export const corpusPath = (name) => join(process.env.TONEFIRST_CORPUS_DIR || DEFAULT_DIR, name);
```

- [ ] **Step 2: 두 코퍼스가 그것을 쓴다**

`src/palettes.js` 줄 8:
```js
import { corpusPath } from "./corpus-paths.js";
const CORPUS_PATH = corpusPath("palettes.json");
```
`src/diagnostics.js` 줄 10 도 같은 모양으로 `corpusPath("diagnostics.json")`.

- [ ] **Step 3: 확인** — `TONEFIRST_CORPUS_DIR=/없는/경로 node -e 'import("./src/palettes.js").then(m=>m.loadPalettes())'` 가 `CorpusError` 를 던진다(경로가 실제로 바뀌었다). 오버라이드 없이 `S1-G1` 통과.

- [ ] **Step 4: 커밋** — `git add src/corpus-paths.js src/palettes.js src/diagnostics.js && git commit -m "feat: 코퍼스 경로를 환경변수로 연다 (27단계)"`

---

### Task 2: `src/embed.js` — 해시 캐시 (메모리 + 디스크)

**Files:**
- Modify: `src/embed.js` (`prepare` · 상태 · 새 함수 `loadCache`·`saveCache`)

**Interfaces:**
- Produces: `status()` 에 `cached: number` · `embedded: number` 추가. `prepare(docs)` 의 계약은 그대로(던지지 않음, 상태 반환).
- Consumes: `TONEFIRST_DATA_DIR`(store.js 와 같은 기본 `var/`), `OLLAMA_EMBED_MODEL`

- [ ] **Step 1: 캐시 계층을 더한다** — 파일 머리 import 와 상수 아래:

```js
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 캐시 자리. store.js 와 같은 폴더·같은 규칙(임시 파일 → rename, 깨지면 옆으로).
const DATA_DIR = process.env.TONEFIRST_DATA_DIR || fileURLToPath(new URL("../var/", import.meta.url));
const CACHE_FILE = "embeddings.json";
const keyOf = (text) => createHash("sha1").update(`${EMBED_MODEL}\n${text}`).digest("hex");

/** @type {Map<string, number[]>} 해시 → 벡터 */
let cache = new Map();
let cacheLoaded = false;

function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  const target = join(DATA_DIR, CACHE_FILE);
  if (!existsSync(target)) return;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    if (parsed.model !== EMBED_MODEL || typeof parsed.entries !== "object" || parsed.entries === null) return; // 다른 모델의 캐시는 버린다
    for (const [hash, vector] of Object.entries(parsed.entries)) {
      if (Array.isArray(vector) && vector.every((x) => typeof x === "number")) cache.set(hash, vector);
    }
  } catch (err) {
    // 깨진 캐시로 시작하면 다음 쓰기가 원본을 덮는다. 옆으로 치우고 이유를 남긴다(store.js 와 같은 처방).
    const aside = `${target}.corrupt-${Date.now()}`;
    try {
      renameSync(target, aside);
      process.stderr.write(Buffer.from(`임베딩 캐시가 깨져 있어 옆으로 옮겼다: ${aside} (${err.message})\n`, "utf8"));
    } catch {
      process.stderr.write(Buffer.from(`임베딩 캐시가 깨졌는데 옮기지도 못했다: ${target}\n`, "utf8"));
    }
  }
}

function saveCache() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const target = join(DATA_DIR, CACHE_FILE);
    const temp = `${target}.tmp`;
    const entries = Object.fromEntries(cache);
    const dims = cache.size ? cache.values().next().value.length : 0;
    writeFileSync(temp, JSON.stringify({ model: EMBED_MODEL, dims, entries }), "utf8");
    renameSync(temp, target);
  } catch (err) {
    // 쓰기 실패는 서비스와 무관하다 — 다음 기동에 다시 만들 뿐이다.
    process.stderr.write(Buffer.from(`임베딩 캐시를 쓰지 못했다: ${err.message}\n`, "utf8"));
  }
}
```

- [ ] **Step 2: `prepare` 가 캐시에 없는 것만 보낸다** — IIFE 안을 바꾼다:

```js
    try {
      loadCache();
      const missing = docs.filter((d) => !cache.has(keyOf(d.text)));
      if (missing.length > 0) {
        const vectors = await callEmbed(missing.map((d) => d.text), PREPARE_TIMEOUT_MS);
        if (vectors.length !== missing.length) throw new Error(`벡터 ${vectors.length}개, 문서 ${missing.length}개`);
        missing.forEach((d, i) => cache.set(keyOf(d.text), vectors[i]));
      }
      corpus = docs.map((d) => ({ id: d.id, kind: d.kind, vector: cache.get(keyOf(d.text)) }));
      // 가지치기 — 현재 문서의 해시만 남긴다. 안 하면 문서를 고칠 때마다 옛 벡터가 쌓인다.
      const keep = new Set(docs.map((d) => keyOf(d.text)));
      cache = new Map([...cache].filter(([hash]) => keep.has(hash)));
      if (missing.length > 0) saveCache();
      current = {
        ...current, state: "ready", detail: `${HOST} 응답 · ${EMBED_MODEL}`, count: corpus.length,
        cached: docs.length - missing.length, embedded: missing.length,
      };
    } catch (err) {
```

초기 `current` 에 `cached: 0, embedded: 0` 을 더한다. `catch` 에서도 두 값을 0 으로.

- [ ] **Step 3: 확인** — `S26-G3` 통과(계약 유지). `S27-G3`·`G6` 은 서버 쪽 `corpus` 상태가 아직 없어 일부 실패할 수 있다 — 실패 사유가 캐시가 아니라 `corpus` 필드인지 읽는다.

- [ ] **Step 4: 커밋** — `git add src/embed.js && git commit -m "feat: 임베딩을 내용 해시로 캐시하고 디스크에 남긴다 (27단계)"`

---

### Task 3: `src/pipeline.js` — 버전 있는 코퍼스 · `reloadIfChanged`

**Files:**
- Modify: `src/pipeline.js` (`createPipeline` 전체)

**Interfaces:**
- Produces: `pipeline.reloadIfChanged(): boolean`(재적재했으면 true) · `pipeline.corpusStatus(): {version, palettes, diagnostics, checkedAt, reloadedAt, error}` · `pipeline.relationVocab` · `pipeline.palettes`·`diagnostics`·`vocabulary`·`embedDocs` 는 **getter**
- Consumes: `relationVocabulary` from `./bridge.js`, `prepare` from `./embed.js`, `statSync`

- [ ] **Step 1: 코퍼스 적재를 함수로 뽑고 상태로 든다**

```js
import { statSync } from "node:fs";
import { relationVocabulary } from "./bridge.js";
import { prepare as prepareEmbeddings } from "./embed.js";
import { corpusPath } from "./corpus-paths.js";

/** 파일 시각 확인 간격. 안에서는 statSync 도 안 한다. */
const CORPUS_CHECK_TTL_MS = 2000;

/** 두 파일의 지문. mtime 만 보면 같은 초 안의 두 저장을 놓칠 수 있어 size 도 본다. */
function fingerprint() {
  return ["palettes.json", "diagnostics.json"]
    .map((n) => {
      const st = statSync(corpusPath(n));
      return `${n}:${st.mtimeMs}:${st.size}`;
    })
    .join("|");
}

/** 코퍼스를 읽어 검색에 필요한 것을 전부 만든다. 던진다 — 호출부가 옛 것을 지킬지 정한다. */
function build() {
  const palettes = createSearcher();
  const diagnostics = createDiagnosticSearcher();
  return {
    palettes,
    diagnostics,
    vocabulary: buildVocabulary([...palettes.palettes.map(paletteText), ...diagnostics.diagnostics.map(diagnosticText)]),
    byId: new Map([
      ...palettes.palettes.map((p) => [p.id, { doc: p, kind: "palette" }]),
      ...diagnostics.diagnostics.map((d) => [d.id, { doc: d, kind: "diagnosis" }]),
    ]),
    embedDocs: [
      ...palettes.palettes.map((p) => ({ id: p.id, kind: "palette", text: paletteEmbedText(p) })),
      ...diagnostics.diagnostics.map((d) => ({ id: d.id, kind: "diagnosis", text: diagnosticEmbedText(d) })),
    ],
    relationVocab: relationVocabulary(palettes.palettes),
  };
}
```

`createPipeline()` 안:

```js
  let state = build(); // 기동 때는 던진다 — 코퍼스 없이 뜨지 않는다(1단계 계약, server.js 가 잡아 exit 1)
  let seen = fingerprint();
  let version = 1;
  let checkedAt = Date.now();
  let reloadedAt = null;
  let corpusError = null;

  const pipeline = {
    get palettes() { return state.palettes.palettes; },
    get diagnostics() { return state.diagnostics.diagnostics; },
    get vocabulary() { return state.vocabulary; },
    get embedDocs() { return state.embedDocs; },
    get relationVocab() { return state.relationVocab; },

    corpusStatus: () => ({ version, palettes: state.palettes.palettes.length, diagnostics: state.diagnostics.diagnostics.length, checkedAt, reloadedAt, error: corpusError }),

    /**
     * 파일이 바뀌었으면 그 자리에서 다시 읽는다. 던지지 않는다 — 깨진 파일이면 옛 코퍼스를 지키고 사유만 남긴다.
     * @returns {boolean} 재적재했는가
     */
    reloadIfChanged() {
      if (Date.now() - checkedAt < CORPUS_CHECK_TTL_MS) return false;
      checkedAt = Date.now();
      let now;
      try {
        now = fingerprint();
      } catch (err) {
        corpusError = `코퍼스 파일을 볼 수 없다: ${err.message}`;
        return false;
      }
      if (now === seen && corpusError === null) return false;
      try {
        state = build();
        seen = now;
        version += 1;
        reloadedAt = Date.now();
        corpusError = null;
        prepareEmbeddings(state.embedDocs); // 기다리지 않는다. 끝날 때까지 similarities 는 옛 벡터를 낸다 — rerank 가 모르는 id 를 버린다
        return true;
      } catch (err) {
        corpusError = err instanceof CorpusError ? err.message : String(err.message ?? err);
        seen = now; // 같은 깨진 파일을 매번 다시 읽지 않는다. 고쳐지면 지문이 바뀐다
        return false;
      }
    },
```

`resolve` 안에서는 `state.palettes`·`state.diagnostics`·`state.vocabulary`·`state.byId` 를 쓴다(기존 지역 변수를 `state.` 로 바꾼다). `rerank` 의 `pick` 은:

```js
            .filter((f) => f.kind === kind && state.byId.has(f.id)) // 재적재 직후 옛 벡터가 낸 지워진 id 를 버린다
```

`decide(fused)` 앞에서도 `fused = fuse(bm25, sims).filter((f) => state.byId.has(f.id))` 로 걸러 지워진 문서가 1위·라우팅을 정하지 못하게 한다.

- [ ] **Step 2: `CorpusError` import** — `import { createSearcher, CorpusError } from "./palettes.js";`

- [ ] **Step 3: 확인** — `S26-G1~G7` 그대로 통과(파이프라인 계약 유지). `S27-G5` 통과.

- [ ] **Step 4: 커밋** — `git add src/pipeline.js && git commit -m "feat: 파이프라인이 코퍼스 변동을 요청 때 알아챈다 (27단계)"`

---

### Task 4: `server.js` 연결 + 나머지 게이트

**Files:**
- Modify: `server.js` — 줄 45 `maxStage` · 줄 152~156 `relationVocab` · `handleSearch`(줄 183) · `handleStatus`(줄 429) · `handleExpand`(줄 459)

- [ ] **Step 1: `relationVocab` 상수를 지우고 파이프라인 것을 쓴다**

```js
// 관계 어휘는 파이프라인이 코퍼스와 함께 다시 만든다(27단계). 여기서 상수로 들면 재적재 뒤 낡는다.
const shapeDiagnostic = ({ doc, score, matched, wholeMatches }) => {
  const { hue, tone, matches } = palettesForAxis(doc.axis, pipeline.palettes, pipeline.relationVocab);
```

- [ ] **Step 2: 세 핸들러 맨 앞에서 확인한다**

`handleSearch`·`handleExpand` 의 첫 줄, `handleStatus` 의 `refreshOllama()` 앞:
```js
  pipeline.reloadIfChanged(); // 2초 TTL. 바뀌었으면 이 요청부터 새 코퍼스다
```

- [ ] **Step 3: `/api/status` 와 `maxStage`**

```js
const maxStage = (ollamaState, embedState) => (embedState === "ready" ? 4 : ollamaState === "ready" ? 2 : 1);
```
(재적재는 항상 가능하므로 임베딩 준비 = 4. 3 은 이제 안 나온다 — `README` 사다리 설명에 적는다.)

`handleStatus` 응답에:
```js
    corpus: LOOPBACK_ONLY
      ? pipeline.corpusStatus()
      : { ...pipeline.corpusStatus(), error: pipeline.corpusStatus().error ? "코퍼스 파일을 읽을 수 없습니다" : null },
```
그리고 기존 `corpus: pipeline.palettes.length` · `diagnostics: ...` 두 줄은 **그대로 둔다**(옛 필드, 화면이 쓴다).

- [ ] **Step 4: G7 의 "깨뜨리는 순서" 를 Task 0 의 주의대로 고쳐 두었는지 확인하고, 일곱 게이트를 돌린다**

Run: `for g in 1 2 3 4 5 6 7; do node scripts/check-stage27.mjs S27-G$g | tail -1; done`
Expected: 전부 `S27_G<n>_OK`. G2 가 `cached 33 · embedded 1` 이 아니면 해시 키에 모델명이 빠졌거나 `embedText` 가 바뀐 것이다.

- [ ] **Step 5: 회귀** — S1 · S2 · S3 · S4 · S26 전체 + `S22-G6`(README 는 Task 5 뒤에 맞는다).

- [ ] **Step 6: 브라우저 실측** — `tonefirst` 로 띄워 사다리 4칸이 켜지는지, `data/palettes.json` 의 요약 한 줄을 고쳐 저장하고 3초 뒤 검색해 새 내용이 잡히는지 본다. **끝나면 파일을 되돌린다**(git diff 로 확인).

- [ ] **Step 7: 커밋** — `git add server.js scripts/check-stage27.mjs && git commit -m "feat: 요청 때 코퍼스를 다시 읽고 사다리가 4단계까지 켜진다 (27단계)"`

---

### Task 5: 문서 · 게이트 수 · 격리 리뷰

- [ ] **Step 1: README** — 게이트 200 → 207 · S27 행 · `check-stage{1..27}` · 파일 지도에 `src/corpus-paths.js` · 환경변수에 `TONEFIRST_CORPUS_DIR` · 사다리 설명에 "3단계 표시는 이제 안 나온다 — 임베딩이 준비되면 4" · `var/embeddings.json` 설명. `S22-G6` 통과 확인.

- [ ] **Step 2: GATES.md 알려진 한계 (27단계)** — 최소 넷:
  - 실측이 요구한 단계가 아니다(대표 결정) · 코퍼스가 바뀌는 날이 오면 TTL·지문 방식을 다시 본다.
  - mtime 해상도 — 같은 초 안의 두 저장은 `size` 가 같으면 놓친다. 편집기는 보통 크기가 바뀌므로 실용상 문제없다 `[판단]`.
  - 옛 벡터 창(수십 ms)에 새로 **추가된** 문서는 임베딩 결과에 없다 — BM25 로만 잡힌다. 지워진 문서는 걸러진다(G5).
  - 씨앗 풀·구조·재질은 여전히 기동 때 고정. `/api/expand` 가 코퍼스 씨앗을 새 코퍼스에서 찾지만 풀은 옛것이다.

- [ ] **Step 3: 격리 리뷰 2인** — `review-fanout.sh` 새 라운드(마지막 44). 완료 조건 S27-G1~G7 과 실측을 프롬프트에 직접. Critical·High 수정 후 게이트 재실행.

- [ ] **Step 4: 세션 재개 문서 + open-work** — `docs/session-resume/2026-09-13-on-demand-corpus-27.md`, `open-work.md` 의 "지금 하는 것" 갱신.

- [ ] **Step 5: 전체 게이트 · 커밋 · 머지 (대표 확인 뒤)**

---

## 자체 검토

- 스펙 대조: 감지(TTL·지문)→Task 3 · 재적재·깨진 파일→Task 3 · 살아 있는 참조→Task 4 · 경로 오버라이드→Task 1 · 상태·사다리→Task 4 · 캐시(키·메모리·디스크·가지치기·모델 변경·상태·저장 시점)→Task 2 · 옛 벡터 창→Task 3 · 게이트 G1~G7→Task 0 · 되돌리는 법→스펙.
- 빈칸 없음. G7 의 기동 시 깨진 파일 순서는 Task 0 주의에 적었다.
- 이름 일치: `reloadIfChanged`·`corpusStatus`·`relationVocab`·`corpusPath`·`cached`·`embedded`·`CACHE_FILE`·`TONEFIRST_CORPUS_DIR` 이 태스크와 검사기에서 같다.
