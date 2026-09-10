/**
 * The size of a page this reader will hold.
 *
 * A deadline abandons a body that arrives slowly. One that arrives quickly and
 * large is never abandoned by it, and it lands in memory in one piece before
 * anything looks at it: a page of two hundred megabytes fits inside twenty
 * seconds, and what it costs is the whole session rather than the one call.
 */

import { describe, expect, it, vi } from "vitest";
import { createLogger, loadConfig } from "../../src/config.js";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";

/** A body streamed in pieces, the way a large page arrives. */
function streamed(bytes: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      sent += 10_000;
      controller.enqueue(new Uint8Array(10_000).fill(120));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** What the read said, whether it answered or refused. */
async function said(answer: Promise<unknown>): Promise<string> {
  try {
    await answer;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const CAP = 100_000;

function client(fetchImpl: typeof fetch): GoodFoodClient {
  return new GoodFoodClient({
    config: loadConfig({ BGF_MAX_BODY_BYTES: String(CAP), BGF_MIN_INTERVAL_MS: "0" }),
    logger: createLogger("silent"),
    fetchImpl,
  });
}

describe("a page larger than this reader holds", () => {
  it("is refused for its size", async () => {
    const reading = client(vi.fn(async () => streamed(CAP * 4)) as unknown as typeof fetch);

    expect(await said(reading.searchRecipes("crepes"))).toContain(String(CAP));
  });

  it("is read when it fits, whatever the page then turns out to hold", async () => {
    const page = `<!doctype html><html><body>${"x".repeat(3000)}</body></html>`;
    const reading = client(
      vi.fn(
        async () => new Response(page, { status: 200, headers: { "content-type": "text/html" } }),
      ) as unknown as typeof fetch,
    );

    expect(await said(reading.searchRecipes("crepes"))).not.toContain(String(CAP));
  });
});

describe("the size a caller can set", () => {
  it("is eight megabytes unless the caller says otherwise", () => {
    expect(loadConfig({}).maxBodyBytes).toBe(8_000_000);
  });
});
