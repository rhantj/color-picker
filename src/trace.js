// 턴 하나의 판정·입출력을 기록한다. 39단계.
//
// 두 겹이다. ① `var/traces.jsonl` — 늘 쓴다. 게이트가 "이 입력은 이 경로로 갔는가" 를 여기서 대조한다(S39-G7).
// ② LangSmith — `LANGSMITH_API_KEY` 가 있을 때만 REST 로 보낸다. SDK 없음(의존성 0). 응답을 기다리지 않고
// 실패는 로그 한 줄이다 — 관측이 사용자 응답을 막으면 안 된다(S39-G6).
//
// LangSmith 런 필드: id · trace_id(루트 id) · dotted_order(시각+id 를 "." 로 이은 것) · parent_run_id · session_name(프로젝트).
// 자식이 부모보다 먼저 닿아도 되게 부모를 먼저 보낸다.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const POST_TIMEOUT_MS = 3000;

/** dotted_order 의 시각 조각: 20260915T101530123000Z 꼴(ms 3자리 뒤에 "000" 을 붙여 6자리로 맞춘 것 — 실제 마이크로초가 아니다). */
function orderStamp(iso) {
  return iso.replace(/[-:]/g, "").replace(".", "").replace("Z", "000Z");
}

export function createTracer({ apiKey = "", project = "color-picker", endpoint = "https://api.smith.langchain.com", file, fetchImpl = fetch, log = (msg) => process.stderr.write(Buffer.from(msg + "\n", "utf8")) } = {}) {
  const enabled = typeof apiKey === "string" && apiKey.length > 0;
  const base = String(endpoint).replace(/\/+$/, "");

  function post(body) {
    if (!enabled) return;
    try {
      fetchImpl(`${base}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      })
        .then((res) => {
          if (!res.ok) log(`LangSmith 가 ${res.status} 를 돌려줬다 (${body.name})`);
        })
        .catch((err) => log(`LangSmith 전송 실패 (${body.name}): ${err.message}`));
    } catch (err) {
      // fetchImpl 이 프라미스를 돌려주기 전에 동기적으로 던지는 경우(예: 커스텀 fetchImpl 버그) —
      // 관측이 요청 경로를 막으면 안 되므로(S39-G6) 비동기 실패와 같은 모양으로 로그만 남긴다.
      log(`LangSmith 전송 실패 (${body.name}): ${err.message}`);
    }
  }

  function appendLine(record) {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
    } catch (err) {
      log(`트레이스 파일 쓰기 실패: ${err.message}`);
    }
  }

  function begin(name, inputs = {}) {
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const dotted = `${orderStamp(startedAt)}${id}`;
    const children = [];

    const child = (childName, childInputs = {}) => {
      const cid = randomUUID();
      const cStart = new Date().toISOString();
      const rec = { id: cid, name: childName, inputs: childInputs, outputs: null, startedAt: cStart, endedAt: null };
      children.push(rec);
      return {
        end(outputs = {}) {
          rec.outputs = outputs;
          rec.endedAt = new Date().toISOString();
          return rec;
        },
      };
    };

    const end = (outputs = {}) => {
      const endedAt = new Date().toISOString();
      appendLine({ id, name, inputs, outputs, startedAt, endedAt, children });
      post({ id, trace_id: id, dotted_order: dotted, name, run_type: "chain", inputs, outputs, start_time: startedAt, end_time: endedAt, session_name: project });
      for (const c of children) {
        post({
          id: c.id,
          trace_id: id,
          parent_run_id: id,
          dotted_order: `${dotted}.${orderStamp(c.startedAt)}${c.id}`,
          name: c.name,
          run_type: c.name.startsWith("llm") ? "llm" : "tool",
          inputs: c.inputs,
          outputs: c.outputs ?? {},
          start_time: c.startedAt,
          end_time: c.endedAt ?? endedAt,
          session_name: project,
        });
      }
    };

    return { id, child, end };
  }

  return { enabled, begin };
}
