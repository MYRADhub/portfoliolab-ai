// Minimal stand-in for the OpenAI Responses API so explanation tests are deterministic and never reach the
// real service. Behavior is switched per test through POST /__mode.
import { createServer, type IncomingMessage } from "node:http";
import { MOCK_PORT } from "./env";

type Mode = "grounded" | "ungrounded" | "retry" | "error" | "refusal" | "incomplete";

let mode: Mode = "grounded";
let retryCounter = 0;
const requests: {
  path: string;
  auth: string | undefined;
  model: string;
  instructions: string;
  input: string;
  mode: Mode;
}[] = [];

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

function parseFacts(input: string): { id: string; label: string; text: string }[] {
  const block = /<facts>\n([\s\S]*?)\n<\/facts>/.exec(input)?.[1] ?? "";
  return block.split("\n").flatMap((line) => {
    const m = /^(F\d+) \| ([^:]+): (.*)$/.exec(line);
    return m ? [{ id: m[1]!, label: m[2]!, text: m[3]! }] : [];
  });
}

function groundedPayload(input: string) {
  const facts = parseFacts(input);
  const line = (f: { id: string; label: string; text: string }) =>
    `${f.label}: ${f.text} [${f.id}].`;
  return {
    summary: facts.slice(0, 3).map(line).join(" "),
    highlights: facts.slice(3, 5).map(line),
  };
}

const ungroundedPayload = {
  summary: "The portfolio returned 99.99% over the period [F1].",
  highlights: [] as string[],
};

function responseBody(model: string, payload: object | null, extra: object = {}) {
  return {
    id: "resp_mock",
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    parallel_tool_calls: false,
    temperature: 1,
    tool_choice: "auto",
    tools: [],
    top_p: 1,
    output: payload
      ? [
          {
            type: "message",
            id: "msg_mock",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: JSON.stringify(payload), annotations: [] }],
          },
        ]
      : [],
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      total_tokens: 20,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    ...extra,
  };
}

// Tool-calling flow for the research assistant: first turn asks for the portfolio summary, then answers from the
// tool output (grounded), or with an invented number (ungrounded), or fails, depending on the mode.
type Item = { role?: string; content?: string; type?: string; output?: string };
function assistantTurn(
  body: { model: string; instructions: string; input: string | Item[] },
  send: (status: number, body: unknown) => void,
) {
  const items = body.input as Item[];
  requests.push({
    path: "/v1/responses",
    auth: undefined,
    model: body.model,
    instructions: body.instructions,
    input: JSON.stringify(items),
    mode,
  });
  if (mode === "error")
    return send(400, {
      error: {
        message: "mock upstream failure",
        type: "invalid_request_error",
        param: null,
        code: null,
      },
    });
  const outputs = items.filter((i) => i.type === "function_call_output").map((i) => i.output ?? "");
  const question = items.find((i) => i.role === "user")?.content ?? "";
  if (outputs.length === 0) {
    const wantsCompany = /\bNVDA\b/.test(question);
    return send(
      200,
      responseBody(body.model, null, {
        output: [
          {
            type: "function_call",
            id: "fc_mock",
            call_id: "call_mock",
            name: wantsCompany ? "get_company" : "get_portfolio_summary",
            arguments: wantsCompany ? JSON.stringify({ ticker: "NVDA" }) : "{}",
            status: "completed",
          },
        ],
      }),
    );
  }
  const retried = question.includes("rejected for");
  if (mode === "ungrounded" || (mode === "retry" && !retried))
    return send(200, responseBody(body.model, { answer: "The portfolio returned 99.99% [F1]." }));
  const facts = outputs
    .join("\n")
    .split("\n")
    .flatMap((line) => {
      const m = /^(F\d+) \| ([^:]+): (.*)$/.exec(line);
      return m ? [{ id: m[1]!, label: m[2]!, text: m[3]! }] : [];
    });
  return send(
    200,
    responseBody(body.model, {
      answer: facts
        .slice(0, 2)
        .map((f) => `${f.label}: ${f.text} [${f.id}].`)
        .join(" "),
    }),
  );
}

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", "http://x");

  if (req.method === "POST" && url.pathname === "/__mode") {
    mode = (JSON.parse(await readBody(req)) as { mode: Mode }).mode;
    retryCounter = 0;
    return send(200, { mode });
  }
  if (req.method === "POST" && url.pathname === "/__reset") {
    requests.length = 0;
    mode = "grounded";
    retryCounter = 0;
    return send(200, {});
  }
  if (req.method === "GET" && url.pathname === "/__requests") return send(200, requests);
  if (req.method === "GET" && url.pathname === "/__health") return send(200, { ok: true });

  if (req.method === "POST" && url.pathname === "/v1/responses") {
    const body = JSON.parse(await readBody(req)) as {
      model: string;
      instructions: string;
      input: string | { role?: string; content?: string; type?: string; output?: string }[];
    };
    if (Array.isArray(body.input)) return assistantTurn(body, send);
    requests.push({
      path: url.pathname,
      auth: req.headers.authorization,
      model: body.model,
      instructions: body.instructions,
      input: body.input,
      mode,
    });
    const m = mode === "retry" ? (retryCounter++ % 2 === 0 ? "ungrounded" : "grounded") : mode;
    switch (m) {
      case "grounded":
        return send(200, responseBody(body.model, groundedPayload(body.input)));
      case "ungrounded":
        return send(200, responseBody(body.model, ungroundedPayload));
      case "refusal":
        return send(200, {
          ...responseBody(body.model, null),
          output: [
            {
              type: "message",
              id: "msg_mock",
              status: "completed",
              role: "assistant",
              content: [{ type: "refusal", refusal: "I cannot help with that." }],
            },
          ],
        });
      case "incomplete":
        return send(200, {
          ...responseBody(body.model, { summary: "{", highlights: [] }),
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        });
      case "error":
        return send(400, {
          error: {
            message: "mock upstream failure",
            type: "invalid_request_error",
            param: null,
            code: null,
          },
        });
    }
  }
  send(404, { error: { message: `no mock for ${req.method} ${url.pathname}` } });
}).listen(MOCK_PORT, "127.0.0.1", () => console.log(`mock openai on ${MOCK_PORT}`));
