import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchText, parseRetryAfter } from "../../src/bbcgoodfood/http.js";
import { RateLimiter } from "../../src/bbcgoodfood/rateLimiter.js";
import type { Logger } from "../../src/config.js";
import { GoodFoodError } from "../../src/errors.js";

const NOW = new Date("2026-01-01T00:00:00Z");

function silentLogger(): Logger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

interface Call {
  url: string;
  headers: Headers;
  redirect: RequestInit["redirect"];
  signal: AbortSignal | undefined;
}

interface Recorder {
  calls: Call[];
  impl: typeof fetch;
}

/** Records what each attempt was handed, and answers from a queue of responders. */
function recorder(responders: Array<(call: Call) => Promise<Response>>): Recorder {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const call: Call = {
      url: String(input),
      headers: new Headers(init?.headers),
      redirect: init?.redirect,
      signal: init?.signal ?? undefined,
    };
    calls.push(call);
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)];
    if (responder === undefined) {
      throw new Error("no responder configured");
    }
    return responder(call);
  };
  return { calls, impl };
}

function always(build: () => Response): Array<(call: Call) => Promise<Response>> {
  return [() => Promise.resolve(build())];
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Drives a pending promise to its end on the fake clock. The step is small
 * enough that no wait is skipped over, and the budget is far larger than any
 * wait the module can ask for, so no test needs to know a backoff duration.
 */
async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  let outcome: Settled<T> | undefined;
  promise.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  for (let step = 0; step < 2000 && outcome === undefined; step += 1) {
    await vi.advanceTimersByTimeAsync(500);
  }
  if (outcome === undefined) {
    throw new Error("promise never settled on the fake clock");
  }
  return outcome;
}

async function failure(promise: Promise<unknown>): Promise<GoodFoodError> {
  const result = await settle(promise);
  if (result.ok) {
    throw new Error(`expected a rejection, resolved with ${String(result.value)}`);
  }
  expect(result.error).toBeInstanceOf(GoodFoodError);
  return result.error as GoodFoodError;
}

async function success<T>(promise: Promise<T>): Promise<T> {
  const result = await settle(promise);
  if (!result.ok) {
    throw new Error(`expected a resolution, rejected with ${String(result.error)}`);
  }
  return result.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The wait between two attempts carries a random share. Pinning Math.random
  // to its lowest value makes every backoff a fixed number of milliseconds, so
  // the fake clock advances over a schedule that never varies between runs.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("parseRetryAfter", () => {
  it("reads a number of seconds as milliseconds", () => {
    expect(parseRetryAfter("5")).toBe(5000);
    expect(parseRetryAfter("120")).toBe(120_000);
  });

  it("reads zero seconds as no wait at all", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("reads an HTTP date as the delay until it", () => {
    const future = new Date(NOW.getTime() + 90_000).toUTCString();
    expect(parseRetryAfter(future)).toBe(90_000);
  });

  it("reads a date already gone as no wait at all", () => {
    const past = new Date(NOW.getTime() - 90_000).toUTCString();
    expect(parseRetryAfter(past)).toBe(0);
  });

  it("takes `now` as the present for the dated form", () => {
    const stamp = new Date(NOW.getTime() + 90_000).toUTCString();
    expect(parseRetryAfter(stamp, NOW.getTime() + 30_000)).toBe(60_000);
    expect(parseRetryAfter(stamp, NOW.getTime() + 200_000)).toBe(0);
  });

  it("rejects an absent header, an empty string and any word", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });

  it("rejects a negative number of seconds", () => {
    expect(parseRetryAfter("-5")).toBeNull();
  });

  it("rejects anything that is not a whole number of seconds nor a readable date", () => {
    expect(parseRetryAfter("   ")).toBeNull();
    expect(parseRetryAfter("12abc")).toBeNull();
    expect(parseRetryAfter("Mon, 99 Zzz 2026 00:00:00 GMT")).toBeNull();
  });

  it("tolerates surrounding spaces", () => {
    expect(parseRetryAfter("  7  ")).toBe(7000);
    const future = new Date(NOW.getTime() + 60_000).toUTCString();
    expect(parseRetryAfter(`  ${future}  `)).toBe(60_000);
  });
});

describe("fetchText", () => {
  function options(
    impl: typeof fetch,
    overrides: { maxRetries?: number; timeoutMs?: number } = {},
  ) {
    return {
      url: "https://www.bbcgoodfood.com/search",
      userAgent: "test-agent/1.0",
      timeoutMs: overrides.timeoutMs ?? 20_000,
      maxRetries: overrides.maxRetries ?? 3,
      limiter: new RateLimiter({ intervalMs: 1000 }),
      logger: silentLogger(),
      fetchImpl: impl,
    };
  }

  it("sends the user agent it was handed, asks for JSON and follows redirects", async () => {
    const rec = recorder(always(() => new Response("hello", { status: 200 })));
    await success(fetchText(options(rec.impl)));

    expect(rec.calls).toHaveLength(1);
    const call = rec.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    expect(call.url).toBe("https://www.bbcgoodfood.com/search");
    expect(call.headers.get("user-agent")).toBe("test-agent/1.0");
    expect(call.headers.get("accept")).toBe("application/json");
    // Undeclared means fetch's own default, which is to follow.
    expect(call.redirect === undefined || call.redirect === "follow").toBe(true);
  });

  it("returns the body of a 200 and tells the limiter it went through", async () => {
    const rec = recorder(always(() => new Response("the body", { status: 200 })));
    const opts = options(rec.impl);
    const succeeded = vi.spyOn(opts.limiter, "succeeded");

    expect(await success(fetchText(opts))).toBe("the body");
    expect(succeeded).toHaveBeenCalled();
  });

  it("pushes the limiter back on a 429 and retries after the delay asked for", async () => {
    const rec = recorder([
      () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
        ),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);
    const opts = options(rec.impl);
    const pushBack = vi.spyOn(opts.limiter, "pushBack");

    expect(await success(fetchText(opts))).toBe("at last");
    expect(rec.calls).toHaveLength(2);
    expect(pushBack).toHaveBeenCalled();
  });

  it("pushes the limiter back on a 503 and retries after a growing wait when none is given", async () => {
    const rec = recorder([
      () => Promise.resolve(new Response("busy", { status: 503 })),
      () => Promise.resolve(new Response("busy", { status: 503 })),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);
    const opts = options(rec.impl);
    const pushBack = vi.spyOn(opts.limiter, "pushBack");

    expect(await success(fetchText(opts))).toBe("at last");
    expect(rec.calls).toHaveLength(3);
    expect(pushBack).toHaveBeenCalledTimes(2);
  });

  it("refuses a Retry-After above 30 seconds at once, naming the seconds asked for", async () => {
    const rec = recorder(
      always(() => new Response("slow down", { status: 429, headers: { "retry-after": "60" } })),
    );
    const error = await failure(fetchText(options(rec.impl)));

    expect(error.code).toBe("rate_limited");
    expect(error.message).toContain("60");
    expect(rec.calls).toHaveLength(1);
  });

  it("gives up a 429 with rate_limited once the retries are spent", async () => {
    const rec = recorder(always(() => new Response("slow down", { status: 429 })));
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 1 })));

    expect(error.code).toBe("rate_limited");
    expect(rec.calls).toHaveLength(2);
  });

  it("gives up a 503 with rate_limited once the retries are spent", async () => {
    const rec = recorder(always(() => new Response("busy", { status: 503 })));
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 0 })));

    expect(error.code).toBe("rate_limited");
    expect(rec.calls).toHaveLength(1);
  });

  for (const status of [408, 425, 500, 502, 504]) {
    it(`retries a ${status} and then gives up with network_error`, async () => {
      const rec = recorder(always(() => new Response("nope", { status })));
      const error = await failure(fetchText(options(rec.impl, { maxRetries: 1 })));

      expect(error.code).toBe("network_error");
      expect(rec.calls).toHaveLength(2);
    });

    it(`stops retrying a ${status} as soon as one attempt goes through`, async () => {
      const rec = recorder([
        () => Promise.resolve(new Response("nope", { status })),
        () => Promise.resolve(new Response("recovered", { status: 200 })),
      ]);
      expect(await success(fetchText(options(rec.impl)))).toBe("recovered");
      expect(rec.calls).toHaveLength(2);
    });
  }

  for (const status of [400, 422]) {
    it(`turns a ${status} into invalid_input without retrying`, async () => {
      const rec = recorder(always(() => new Response("bad", { status })));
      const error = await failure(fetchText(options(rec.impl)));

      expect(error.code).toBe("invalid_input");
      expect(rec.calls).toHaveLength(1);
    });
  }

  for (const status of [404, 410]) {
    it(`turns a ${status} into not_found without retrying`, async () => {
      const rec = recorder(always(() => new Response("gone", { status })));
      const error = await failure(fetchText(options(rec.impl)));

      expect(error.code).toBe("not_found");
      expect(rec.calls).toHaveLength(1);
    });
  }

  it("turns any other status into network_error", async () => {
    const rec = recorder(always(() => new Response("teapot", { status: 418 })));
    const error = await failure(fetchText(options(rec.impl)));

    expect(error.code).toBe("network_error");
    expect(rec.calls).toHaveLength(1);
  });

  it("turns a thrown transport failure into a GoodFoodError", async () => {
    const rec = recorder([() => Promise.reject(new TypeError("socket closed"))]);
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 0 })));

    expect(error).toBeInstanceOf(GoodFoodError);
  });

  it("turns a transport rejection that is not an Error into a GoodFoodError", async () => {
    const rec = recorder([() => Promise.reject("the socket vanished")]);
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 0 })));

    expect(error).toBeInstanceOf(GoodFoodError);
  });

  it("gives silence one retry at most before answering timeout", async () => {
    const rec = recorder([
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    ]);
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 3, timeoutMs: 5000 })));

    expect(error.code).toBe("timeout");
    expect(rec.calls).toHaveLength(2);
  });

  it("answers timeout even when fetchImpl ignores the abort signal", async () => {
    // The deadline is the server's promise, not the transport's: a reader that
    // never lets go must not hold the queue.
    const rec = recorder([() => new Promise<Response>(() => undefined)]);
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 0, timeoutMs: 5000 })));

    expect(error.code).toBe("timeout");
  });

  it("retries a 429 whose Retry-After is an HTTP date", async () => {
    const stamp = new Date(NOW.getTime() + 2000).toUTCString();
    const rec = recorder([
      () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": stamp } }),
        ),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);

    expect(await success(fetchText(options(rec.impl)))).toBe("at last");
    expect(rec.calls).toHaveLength(2);
  });

  it("accepts a Retry-After of exactly 30 seconds and refuses one just above", async () => {
    const accepted = recorder([
      () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
        ),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);
    expect(await success(fetchText(options(accepted.impl)))).toBe("at last");
    expect(accepted.calls).toHaveLength(2);

    const refused = recorder(
      always(() => new Response("slow down", { status: 429, headers: { "retry-after": "31" } })),
    );
    const error = await failure(fetchText(options(refused.impl)));
    expect(error.code).toBe("rate_limited");
    expect(refused.calls).toHaveLength(1);
  });

  it("falls back to the growing wait when Retry-After cannot be read", async () => {
    const rec = recorder([
      () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "soon" } }),
        ),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);

    expect(await success(fetchText(options(rec.impl)))).toBe("at last");
    expect(rec.calls).toHaveLength(2);
  });

  it("reads through the runtime's own fetch when none is handed to it", async () => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("from the runtime", { status: 200 }));
    const withoutImpl = {
      url: "https://www.bbcgoodfood.com/search",
      userAgent: "test-agent/1.0",
      timeoutMs: 20_000,
      maxRetries: 0,
      limiter: new RateLimiter({ intervalMs: 1000 }),
      logger: silentLogger(),
    };

    expect(await success(fetchText(withoutImpl))).toBe("from the runtime");
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it("returns an empty body as an empty string", async () => {
    const rec = recorder(always(() => new Response("", { status: 200 })));
    expect(await success(fetchText(options(rec.impl)))).toBe("");
  });

  it("retries at once when Retry-After asks for no wait at all", async () => {
    const rec = recorder([
      () =>
        Promise.resolve(
          new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
        ),
      () => Promise.resolve(new Response("at last", { status: 200 })),
    ]);

    expect(await success(fetchText(options(rec.impl)))).toBe("at last");
    expect(rec.calls).toHaveLength(2);
  });

  it("turns a body that cannot be read into a GoodFoodError", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("the stream broke"));
      },
    });
    const rec = recorder([() => Promise.resolve(new Response(broken, { status: 200 }))]);
    const error = await failure(fetchText(options(rec.impl, { maxRetries: 0 })));

    expect(error).toBeInstanceOf(GoodFoodError);
  });
});

describe("fetchJson", () => {
  function options(impl: typeof fetch) {
    return {
      url: "https://www.bbcgoodfood.com/api",
      userAgent: "test-agent/1.0",
      timeoutMs: 20_000,
      maxRetries: 0,
      limiter: new RateLimiter({ intervalMs: 1000 }),
      logger: silentLogger(),
      fetchImpl: impl,
    };
  }

  it("parses the body it read", async () => {
    const rec = recorder(always(() => new Response(JSON.stringify({ total: 3 }), { status: 200 })));
    const parsed = await success(fetchJson<{ total: number }>(options(rec.impl)));

    expect(parsed).toEqual({ total: 3 });
  });

  it("reads through the runtime's own fetch when none is handed to it", async () => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ total: 1 }), { status: 200 }));
    const withoutImpl = {
      url: "https://www.bbcgoodfood.com/api",
      userAgent: "test-agent/1.0",
      timeoutMs: 20_000,
      maxRetries: 0,
      limiter: new RateLimiter({ intervalMs: 1000 }),
      logger: silentLogger(),
    };

    expect(await success(fetchJson<{ total: number }>(withoutImpl))).toEqual({ total: 1 });
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  it("hands on the error the status layer raised", async () => {
    const rec = recorder(always(() => new Response("gone", { status: 404 })));
    const error = await failure(fetchJson(options(rec.impl)));

    expect(error.code).toBe("not_found");
  });

  it("turns a body that is not JSON into parse_failure", async () => {
    const rec = recorder(always(() => new Response("<html>not json</html>", { status: 200 })));
    const error = await failure(fetchJson(options(rec.impl)));

    expect(error.code).toBe("parse_failure");
  });
});
