// 게이트 전용 — **가짜 Ollama 를 Claude API · Voyage API 로 보이게 하는 번역기**(41단계).
//
// 왜 있나: 41단계에서 서버가 Ollama(`/api/chat`·`/api/embed`)를 버리고 Claude API(`/v1/messages`)와
// Voyage API(`/v1/embeddings`)를 부르게 됐다. 그런데 14·17·26·27·28·30·34·40단계 게이트는 저마다 가짜 Ollama
// 서버를 띄워 "모델이 이런 답을 주면 서버가 어떻게 하나" 를 잰다. 그 가짜들을 전부 다시 짜는 대신, 서버와 가짜
// 사이에 이 번역기를 끼운다 — 게이트가 재던 **서버의 동작**(답을 어떻게 거르나, 실패하면 어떻게 물러서나)은 그대로 잰다.
//
// 어떻게 끼우나:
//   1. 게이트 파일 맨 위에서 `import "./lib/ollama-shim.mjs"` 한다 → NODE_OPTIONS 에 이 파일을 `--import` 로 더한다.
//      그 게이트가 띄우는 서버·자식 프로세스가 전부 이 파일을 먼저 읽는다.
//   2. 그 프로세스의 환경에 `OLLAMA_HOST` 가 있으면(게이트가 가짜의 주소를 거기 넣는다) 프로세스 안에 번역 서버를
//      띄우고 `ANTHROPIC_BASE_URL`·`VOYAGE_BASE_URL` 을 거기로 돌린다. 가짜 키도 넣는다.
//   3. `OLLAMA_HOST` 가 닿지 않는 주소면(게이트가 "죽은 Ollama" 로 쓰던 127.0.0.1:1 등) **키를 비운다** —
//      API 에서 "모델 없음" 에 해당하는 것은 키 없음이다. 그래야 옛 게이트의 "죽었을 때" 가 같은 뜻으로 남는다.
//
// 실제 서비스 코드(src/)는 이 파일을 모른다. 번역은 여기서만 한다.

import { createServer } from "node:http";
import { connect } from "node:net";

// 1. 자식에게 물려준다(중복 없이).
if (!(process.env.NODE_OPTIONS ?? "").includes("ollama-shim.mjs")) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${import.meta.url}`.trim();
}

/** host:port 가 연결을 받는가. */
function reachable(hostPort, timeoutMs = 400) {
  const [host, port] = hostPort.split(":");
  return new Promise((resolve) => {
    const socket = connect({ host, port: Number(port) });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
  });

/** 번역 서버. 요청마다 **지금의** process.env.OLLAMA_HOST 로 보낸다 — 게이트가 한 프로세스 안에서 가짜를 갈아 끼운다. */
function startShim() {
  const server = createServer(async (req, res) => {
    const upstream = `http://${process.env.OLLAMA_HOST}`;
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      body = {};
    }
    try {
      if (req.url.startsWith("/v1/messages")) {
        const ollamaBody = {
          model: body.model,
          stream: false,
          ...(body.output_config?.format ? { format: "json" } : {}),
          options: { temperature: body.temperature, num_predict: body.max_tokens },
          messages: [...(body.system ? [{ role: "system", content: body.system }] : []), ...(body.messages ?? [])],
        };
        const r = await fetch(`${upstream}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ollamaBody),
        });
        const text = await r.text();
        if (!r.ok) {
          res.writeHead(r.status, { "content-type": "application/json" });
          return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: text.slice(0, 200) } }));
        }
        let content = "";
        try {
          content = JSON.parse(text)?.message?.content ?? "";
        } catch {
          content = "";
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            id: "msg_gate_stub",
            type: "message",
            role: "assistant",
            model: body.model,
            content: [{ type: "text", text: content }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        );
      }
      if (req.url.startsWith("/v1/embeddings")) {
        const r = await fetch(`${upstream}/api/embed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: body.model, input: body.input, input_type: body.input_type }),
        });
        const text = await r.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        if (!r.ok) {
          res.writeHead(r.status, { "content-type": "application/json" });
          return res.end(JSON.stringify({ detail: json?.error ?? text.slice(0, 200) }));
        }
        const embeddings = Array.isArray(json?.embeddings) ? json.embeddings : null;
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify(
            embeddings
              ? { object: "list", data: embeddings.map((embedding, index) => ({ object: "embedding", embedding, index })), model: body.model }
              : { object: "list" },
          ),
        );
      }
      res.writeHead(404, { "content-type": "application/json" });
      return res.end("{}");
    } catch {
      // 가짜 Ollama 에 닿지 못했다 — 연결을 끊어 "API 에 닿지 못했다" 로 보이게 한다.
      return res.destroy();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      server.unref(); // 이 서버 때문에 자식 프로세스가 안 끝나면 안 된다
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

let shimUrl = null;

/**
 * 지금 프로세스를 가짜 Ollama(host)에 붙인다. 닿지 않는 주소면 키를 비운다.
 * 한 프로세스 안에서 가짜를 갈아 끼우는 게이트(17단계)가 직접 부른다.
 */
export async function attachOllamaStub(host) {
  process.env.OLLAMA_HOST = host;
  if (!(await reachable(host))) {
    process.env.ANTHROPIC_API_KEY = "";
    process.env.VOYAGE_API_KEY = "";
    return;
  }
  shimUrl ??= await startShim();
  process.env.ANTHROPIC_BASE_URL = shimUrl;
  process.env.VOYAGE_BASE_URL = shimUrl;
  process.env.ANTHROPIC_API_KEY = "gate-stub-key";
  process.env.VOYAGE_API_KEY = "gate-stub-key";
  // 번역기 너머는 가짜라 재시도하면 호출 수가 두 배로 센다.
  process.env.LLM_MAX_RETRIES = "0";
  // 게이트는 가짜 벡터로 결합 판정의 모양을 본다 — 기준값의 출처와 무관하다(pipeline.js embedTrusted).
  process.env.HYBRID_TRUST_UNMEASURED = "1";
  if (process.env.OLLAMA_EMBED_MODEL) process.env.VOYAGE_MODEL = process.env.OLLAMA_EMBED_MODEL;
}

// 2·3. 이 프로세스의 환경에 가짜 주소가 있으면 붙는다.
// 없으면 **키를 비운다** — 셸에 진짜 키가 export 돼 있어도 게이트가 유료 API 를 부르지 않게 한다.
// 예외: 41단계 게이트가 stub-apis.mjs 의 가짜 Claude·Voyage 를 직접 붙인 프로세스(GATE_STUB_APIS=1)는 그 키를 둔다 —
// 그 키는 가짜이고 주소도 가짜 서버다.
if (process.env.OLLAMA_HOST) {
  await attachOllamaStub(process.env.OLLAMA_HOST);
} else if (process.env.GATE_STUB_APIS !== "1") {
  process.env.ANTHROPIC_API_KEY = "";
  process.env.VOYAGE_API_KEY = "";
}
