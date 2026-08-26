import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";
import { GoodFoodError } from "../../src/errors.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // The wait between two attempts carries a random share: it is pinned so the
  // clock this suite drives is the only thing that moves.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function client(fetchImpl?: typeof fetch): GoodFoodClient {
  const config = loadConfig({});
  const logger = createLogger("silent");
  return fetchImpl === undefined
    ? new GoodFoodClient({ config, logger })
    : new GoodFoodClient({ config, logger, fetchImpl });
}

/** A payload the parser can read whole. */
function payload(): unknown {
  return {
    filters: [
      {
        name: "diet",
        label: "Diets",
        options: [{ value: "vegetarian", label: "Vegetarian", count: 12 }],
      },
    ],
    searchResults: { totalItems: 151, limit: 24, items: [] },
  };
}

function jsonResponse(): Response {
  return new Response(JSON.stringify(payload()), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Drives the fake clock until the read settles, and hands back what it settled on. */
async function settle<T>(read: Promise<T>): Promise<T | unknown> {
  const settled = read.then(
    (value) => value,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(120_000);
  return settled;
}

describe("GoodFoodClient built without a fetchImpl", () => {
  it("reads the site through the fetch of the runtime", async () => {
    const stub = vi.fn(() => Promise.resolve(jsonResponse()));
    vi.stubGlobal("fetch", stub);

    const read = await settle(client().listFilters("chicken"));

    expect(stub).toHaveBeenCalledTimes(1);
    expect(read).not.toBeInstanceOf(Error);
    vi.unstubAllGlobals();
  });
});

describe("a refusal the site answers with no body at all", () => {
  it("is reported with its code", async () => {
    const stub = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));

    const read = await settle(client(stub as unknown as typeof fetch).listFilters("chicken"));

    expect(read).toBeInstanceOf(GoodFoodError);
    expect((read as GoodFoodError).code).toBe("not_found");
  });
});

describe("a refusal whose body refuses to be dropped", () => {
  it("is still reported as the refusal it is", async () => {
    const stub = vi.fn(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("refused"));
        },
        cancel() {
          return Promise.reject(new Error("this body will not be dropped"));
        },
      });
      return Promise.resolve(new Response(body, { status: 404 }));
    });

    const read = await settle(client(stub as unknown as typeof fetch).listFilters("chicken"));

    expect(read).toBeInstanceOf(GoodFoodError);
    // Housekeeping that fails says nothing about what the site answered: the
    // status the site sent is the answer the caller gets.
    expect((read as GoodFoodError).code).toBe("not_found");
  });
});
