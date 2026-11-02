/**
 * Splits a stream of newline-delimited JSON into values. Chunks can end mid-line, so the unfinished tail is kept for
 * the next chunk. Blank lines are skipped; a line that is not JSON is reported through `onBadLine` and skipped.
 */
export function ndjsonSplitter<T>(onValue: (v: T) => void, onBadLine?: (line: string) => void) {
  let buffer = "";
  const flushLine = (line: string) => {
    if (!line.trim()) return;
    try {
      onValue(JSON.parse(line) as T);
    } catch {
      onBadLine?.(line);
    }
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        flushLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
    },
    end() {
      flushLine(buffer);
      buffer = "";
    },
  };
}

/** Reads a fetch response body as NDJSON until it ends or the signal aborts. */
export async function readNdjson<T>(res: Response, onValue: (v: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const split = ndjsonSplitter(onValue);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    split.push(decoder.decode(value, { stream: true }));
  }
  split.push(decoder.decode());
  split.end();
}

/**
 * Turns "[F1, F3]" citation groups into one markdown link per id ("[F1](#cite-F1)"), so a markdown renderer can show
 * each as a clickable marker. Text that only looks similar, like "[Fx]", is left alone.
 */
export function linkCitations(text: string): string {
  return text.replace(/\[\s*(F\d+(?:\s*,\s*F\d+)*)\s*\]/g, (_, ids: string) =>
    ids
      .split(",")
      .map((id) => `[${id.trim()}](#cite-${id.trim()})`)
      .join(""),
  );
}
