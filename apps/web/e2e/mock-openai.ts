// Minimal stand-in for the OpenAI Responses API so explanation tests are deterministic and never reach the
// real service. Behavior is switched per test through POST /__mode.
import { createServer, type IncomingMessage } from "node:http";
import { MOCK_PORT } from "./env";

type Mode = "grounded" | "ungrounded" | "retry" | "error" | "refusal" | "incomplete" | "slow";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The page text a nested web search "finds". Its numbers are what a grounded web answer may use. */
export const WEB_RESULT = {
  title: "E2E Web Result",
  url: "https://example.com/e2e-web-result",
  snippet:
    "citeturn1search0 [wordlim: 200] Published: 2 days ago; Crawled: today; Mock Corp reported quarterly revenue of $12.3 billion, up 45% from a year ago.",
};

// Nested web search: the app asks a separate request to run the hosted web_search tool and keeps only its results.
function webSearchTurn(
  body: { model: string; input: unknown },
  send: (s: number, b: unknown) => void,
) {
  requests.push({
    path: "/v1/responses#web_search",
    auth: undefined,
    model: body.model,
    instructions: "",
    input: typeof body.input === "string" ? body.input : JSON.stringify(body.input),
    mode,
  });
  return send(
    200,
    responseBody(body.model, null, {
      output: [
        {
          type: "web_search_call",
          id: "ws_mock",
          status: "completed",
          action: { type: "search", queries: ["mock"] },
          results: [{ type: "text_result", ...WEB_RESULT }],
        },
        {
          type: "message",
          id: "msg_ws",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: "done", annotations: [] }],
        },
      ],
    }),
  );
}

/** A deck built from the facts and displays in the prompt; invented numbers in "ungrounded" mode. */
function deckTurn(
  body: { model: string; instructions: string; input: string },
  send: (s: number, b: unknown) => void,
) {
  requests.push({
    path: "/v1/responses#deck",
    auth: undefined,
    model: body.model,
    instructions: body.instructions,
    input: body.input,
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
  const facts = parseFacts(body.input);
  const displays = [...body.input.matchAll(/^(D\d+) \| /gm)].map((m) => m[1]!);
  const bullet = (i: number) => {
    const f = facts[i % Math.max(1, facts.length)];
    return f ? `${f.label}: ${f.text} [${f.id}]` : "No figures";
  };
  const bad = mode === "ungrounded";
  const deck = {
    title: "Mock Deck",
    subtitle: "What the research found",
    slides: [
      {
        title: "Summary",
        bullets: [bad ? "Returned 99.99% [F1]" : bullet(0), bullet(1)],
        display: null,
        notes: `Open with ${bullet(0)}.`,
      },
      {
        title: "The chart",
        bullets: [bullet(2)],
        display: displays[0] ?? null,
        notes: "Walk through the chart.",
      },
      {
        title: "What is uncertain",
        bullets: [bullet(3)],
        display: null,
        notes: "Close with the limits.",
      },
    ],
  };
  return send(200, responseBody(body.model, deck));
}

/** First tool for a research-chat question, chosen from words in it, among the tools the app offered. */
function researchTool(question: string, offered: Set<string>): { name: string; args: object } {
  if (/\bweb\b/i.test(question) && offered.has("web_search"))
    return { name: "web_search", args: { query: "Mock Corp results" } };
  if (/\bfit\b/i.test(question) && offered.has("portfolio_fit"))
    return { name: "portfolio_fit", args: { ticker: "MSFT", weight_pct: 10 } };
  if (/\bcompare\b/i.test(question))
    return { name: "compare_companies", args: { tickers: ["NVDA", "AAPL"] } };
  if (/\bNVDA\b/.test(question)) return { name: "get_company", args: { ticker: "NVDA" } };
  if (offered.has("get_portfolio_summary")) return { name: "get_portfolio_summary", args: {} };
  return { name: "list_factors", args: {} };
}

// Tool-calling flow for the research assistant: first turn asks for the portfolio summary, then answers from the
// tool output (grounded), or with an invented number (ungrounded), or fails, depending on the mode.
type Item = { role?: string; content?: string; type?: string; output?: string };
async function assistantTurn(
  body: {
    model: string;
    instructions: string;
    input: string | Item[];
    tools?: { name?: string }[];
  },
  send: (status: number, body: unknown) => void,
) {
  const items = body.input as Item[];
  const research = body.instructions.includes("research analyst");
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
  if (mode === "slow") await sleep(4000);
  if (research && outputs.length === 0) {
    const pick = researchTool(question, new Set((body.tools ?? []).map((t) => t.name ?? "")));
    return send(
      200,
      responseBody(body.model, null, {
        output: [
          {
            type: "function_call",
            id: "fc_mock",
            call_id: "call_mock",
            name: pick.name,
            arguments: JSON.stringify(pick.args),
            status: "completed",
          },
        ],
      }),
    );
  }
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
    return send(
      200,
      responseBody(body.model, {
        answer: "The portfolio returned 99.99% [F1].",
        ...(research ? { displays: [] } : {}),
      }),
    );
  const facts = outputs
    .join("\n")
    .split("\n")
    .flatMap((line) => {
      const m = /^(F\d+) \| ([^:]+): (.*)$/.exec(line);
      return m ? [{ id: m[1]!, label: m[2]!, text: m[3]! }] : [];
    });
  if (research) {
    const displays = [...outputs.join("\n").matchAll(/^(D\d+) \| /gm)].map((m) => m[1]!);
    return send(
      200,
      responseBody(body.model, {
        answer: `## Findings\n\n${facts
          .slice(0, 3)
          .map((f) => `- ${f.label}: ${f.text} [${f.id}]`)
          .join("\n")}`,
        displays,
      }),
    );
  }
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
      tools?: { type: string; name?: string }[];
    };
    if (body.tools?.some((t) => t.type === "web_search")) return webSearchTurn(body, send);
    if (typeof body.input === "string" && body.instructions?.includes("slide presentation"))
      return deckTurn(body as { model: string; instructions: string; input: string }, send);
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
      case "slow":
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
