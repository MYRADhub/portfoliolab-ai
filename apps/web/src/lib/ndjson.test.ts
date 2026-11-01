import { describe, expect, it } from "vitest";
import { linkCitations, ndjsonSplitter, readNdjson } from "./ndjson";

describe("ndjsonSplitter", () => {
  it("joins lines split across chunks and skips blanks and bad lines", () => {
    const got: unknown[] = [];
    const bad: string[] = [];
    const s = ndjsonSplitter(
      (v) => got.push(v),
      (l) => bad.push(l),
    );
    s.push('{"a":1}\n{"b"');
    s.push(':2}\n\nnot json\n{"c":');
    s.push("3}");
    s.end();
    expect(got).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(bad).toEqual(["not json"]);
  });
});

describe("readNdjson", () => {
  it("reads a streamed response body, including multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"t":"café"}\n{"t":"x"}\n');
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 11));
        c.enqueue(bytes.slice(11));
        c.close();
      },
    });
    const got: unknown[] = [];
    await readNdjson(new Response(body), (v) => got.push(v));
    expect(got).toEqual([{ t: "café" }, { t: "x" }]);
  });
});

describe("linkCitations", () => {
  it("links each id in a citation group and leaves other brackets alone", () => {
    expect(linkCitations("Up 4% [F1, F12]. See [note] and [Fx].")).toBe(
      "Up 4% [F1](#cite-F1)[F12](#cite-F12). See [note] and [Fx].",
    );
  });
});
