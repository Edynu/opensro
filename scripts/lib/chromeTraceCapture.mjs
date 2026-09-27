import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

export const DEFAULT_BROWSER_EVENT_LOOP_TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "toplevel",
  "v8.execute",
  "v8.gc",
  "cc",
  "gpu"
];

/**
 * Start one CDP stream trace. The returned controller owns its CDP session and
 * can persist the exact raw trace while returning parsed events to an analyzer.
 */
export async function startChromeTraceCapture(page, options = {}) {
  const session = await page.context().newCDPSession(page);
  const categories = options.categories ?? DEFAULT_BROWSER_EVENT_LOOP_TRACE_CATEGORIES;
  let stopped = false;

  await session.send("Tracing.start", {
    categories: categories.join(","),
    options: options.options ?? "record-as-much-as-possible",
    transferMode: "ReturnAsStream"
  });

  return {
    categories,
    async stop(stopOptions = {}) {
      if (stopped) throw new Error("Chrome trace capture was already stopped");
      stopped = true;
      const completed = new Promise((resolve) => {
        session.once("Tracing.tracingComplete", resolve);
      });

      await session.send("Tracing.end");
      const { stream } = await completed;
      if (!stream) throw new Error("Chrome trace completed without a stream handle");

      const chunks = [];
      for (;;) {
        const piece = await session.send("IO.read", {
          handle: stream,
          size: stopOptions.chunkBytes ?? 4 * 1024 * 1024
        });
        chunks.push(Buffer.from(piece.data, piece.base64Encoded ? "base64" : "utf8"));
        if (piece.eof) break;
      }
      await session.send("IO.close", { handle: stream }).catch(() => undefined);
      await session.detach().catch(() => undefined);

      const raw = Buffer.concat(chunks);
      const parsed = JSON.parse(raw.toString("utf8"));
      if (!Array.isArray(parsed.traceEvents)) {
        throw new Error("Chrome trace did not contain a traceEvents array");
      }

      if (stopOptions.outputPath) {
        await mkdir(dirname(stopOptions.outputPath), { recursive: true });
        await writeFile(stopOptions.outputPath, await gzipAsync(raw, { level: 6 }));
      }

      return {
        categories,
        rawBytes: raw.byteLength,
        eventCount: parsed.traceEvents.length,
        traceEvents: parsed.traceEvents,
        metadata: parsed.metadata ?? null,
        outputPath: stopOptions.outputPath ?? null
      };
    }
  };
}
