// 게이트 전용 — 가짜 Claude API(`/v1/messages`)를 띄운다(41단계). `/v1/embeddings` 는 "외부 임베딩 API 를 부르지 않는다" 를
// 재려고 남겨 둔 덫이다(S41-G3) — 임베딩은 로컬 Ollama 다.
//
// ollama-shim.mjs 는 옛 게이트의 가짜 Ollama 를 번역할 뿐이다. 41단계 게이트는 **서버가 실제로 무엇을 보내는가**
// (모델 이름 · JSON 스키마 · input_type · 키 헤더)를 봐야 해서, 요청 본문을 그대로 기록하는 이쪽을 쓴다.

import { createServer } from "node:http";

const readBody = (req) =>
  new Promise((resolve) => {
    let buf = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
  });

/**
 * @param {{
 *   reply?: (body: object) => string,          // /v1/messages 의 답 텍스트(JSON 문자열)
 *   embed?: (text: string, inputType: string) => number[],
 * }} [options]
 */
export function startStubApis({ reply = () => "{}", embed = () => [1, 0, 0] } = {}) {
  const messages = [];
  const embeddings = [];
  const server = createServer(async (req, res) => {
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      body = {};
    }
    if (req.url.startsWith("/v1/messages")) {
      messages.push({ headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          id: "msg_stub",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: reply(body) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }
    if (req.url.startsWith("/v1/embeddings")) {
      embeddings.push({ headers: req.headers, body });
      const input = Array.isArray(body.input) ? body.input : [body.input];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          object: "list",
          data: input.map((text, index) => ({ object: "embedding", embedding: embed(text, body.input_type), index })),
          model: body.model,
          usage: { total_tokens: 1 },
        }),
      );
    }
    res.writeHead(404, { "content-type": "application/json" });
    return res.end("{}");
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({
        url,
        messages,
        embeddings,
        /** 서버에 넘길 환경. 키는 가짜다. */
        env: {
          ANTHROPIC_BASE_URL: url,
          ANTHROPIC_API_KEY: "stub-anthropic-key",
          LLM_MAX_RETRIES: "0",
          OLLAMA_HOST: "",
          GATE_STUB_APIS: "1", // ollama-shim.mjs 가 이 키를 비우지 않게
        },
        close: () => server.close(),
      });
    }),
  );
}
