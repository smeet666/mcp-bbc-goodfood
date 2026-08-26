import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { MIN_ALLOWED_INTERVAL_MS, createLogger, loadConfig } from "../../src/config.js";
import { GoodFoodError } from "../../src/errors.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");
const TIMEOUT_MS = 2000;

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

interface Attempt {
  url: string;
  at: number;
}

interface Fake {
  fetchImpl: typeof fetch;
  attempts: Attempt[];
}

function urlOf(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A fake site. Each call is stamped with the fake clock so pacing is read from
 * the timeline the test itself drives, never from a real measurement.
 */
function fakeFetch(answer: (callIndex: number) => Response | Promise<Response>): Fake {
  const attempts: Attempt[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const index = attempts.length;
    attempts.push({ url: urlOf(input), at: Date.now() });
    return answer(index);
  };
  return { fetchImpl: impl as unknown as typeof fetch, attempts };
}

/**
 * Drives the fake clock forward until `promise` settles. `stepMs` sets the
 * resolution of the timeline: a test that reads `Date.now()` off an attempt
 * walks in 1ms steps, so every timer fires on the exact millisecond it was
 * scheduled for and the gap it measures is the gap the client asked for.
 */
async function runWithClock<T>(promise: Promise<T>, stepMs = 50, capMs = 600_000): Promise<T> {
  let settled = false;
  const tracked = promise.then(
    (value) => {
      settled = true;
      return { ok: true, value } as const;
    },
    (error: unknown) => {
      settled = true;
      return { ok: false, error } as const;
    },
  );
  let elapsed = 0;
  while (!settled && elapsed < capMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    elapsed += stepMs;
  }
  if (!settled) {
    throw new Error(`promise never settled within ${capMs}ms of fake time`);
  }
  const outcome = await tracked;
  if (outcome.ok) {
    return outcome.value;
  }
  throw outcome.error;
}

async function rejectionCode(promise: Promise<unknown>, stepMs = 50): Promise<string> {
  try {
    await runWithClock(promise, stepMs);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(GoodFoodError);
    const failure = error as GoodFoodError;
    expect(failure.name).toBe("GoodFoodError");
    return failure.code;
  }
  throw new Error("expected the read to be refused, but it resolved");
}

function clientFor(fetchImpl: typeof fetch, env: Record<string, string> = {}) {
  const config = loadConfig({
    BGF_TIMEOUT_MS: String(TIMEOUT_MS),
    BGF_MAX_RETRIES: "2",
    ...env,
  });
  const client = new GoodFoodClient({ config, logger: createLogger("error"), fetchImpl });
  return { client, config };
}

describe("GoodFoodClient pacing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    // The retry wait carries a random share. Pinning the draw keeps the number
    // of attempts and their order the only thing a retry test observes; the
    // clock is walked until the read settles, so the length of each wait never
    // enters an assertion.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("spaces two different reads by at least the configured interval", async () => {
    const scoped = fixture("filters-scoped");
    const sitewide = fixture("filters-sitewide");
    const fake = fakeFetch((index) => jsonResponse(index === 0 ? scoped : sitewide));
    const { client, config } = clientFor(fake.fetchImpl);

    await runWithClock(client.listFilters("chicken"), 1);

    const first = fake.attempts[0];
    if (first === undefined) {
      throw new Error("the first read never reached the site");
    }

    const second = client.listFilters("beef");

    // Walk to the last millisecond before the interval is due: the site must
    // still have been left alone.
    const dueAt = first.at + config.minIntervalMs;
    const untilJustBefore = dueAt - 1 - Date.now();
    expect(untilJustBefore).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(untilJustBefore);
    expect(fake.attempts).toHaveLength(1);

    await runWithClock(second, 1);

    const next = fake.attempts[1];
    if (next === undefined) {
      throw new Error("the second read never reached the site");
    }
    expect(next.at - first.at).toBeGreaterThanOrEqual(config.minIntervalMs);
  });

  it("refuses a rate-limited answer with rate_limited", async () => {
    const fake = fakeFetch(() => new Response("slow down", { status: 429 }));
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("rate_limited");
  });

  it("obeys the Retry-After a rate-limited answer states", async () => {
    const retryAfterSeconds = 5;
    const fake = fakeFetch(
      () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": String(retryAfterSeconds) },
        }),
    );
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("rate_limited");
    expect(client.currentIntervalMs).toBeGreaterThanOrEqual(retryAfterSeconds * 1000);
  });

  it("gives up on a server error with network_error once the retries are spent", async () => {
    const fake = fakeFetch(() => new Response("boom", { status: 500 }));
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("network_error");
    // A server error is worth another try, so the site was asked more than once
    // before the read was abandoned.
    expect(fake.attempts.length).toBeGreaterThan(1);
  });

  it("refuses an answer that never arrives with timeout", async () => {
    const fake = fakeFetch(() => new Promise<Response>(() => undefined));
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("timeout");
  });

  it("refuses a body that is not JSON with parse_failure", async () => {
    const fake = fakeFetch(
      () =>
        new Response("<!doctype html><html><body>maintenance</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("parse_failure");
  });

  it("refuses a missing endpoint with not_found", async () => {
    const fake = fakeFetch(() => new Response("nope", { status: 404 }));
    const { client } = clientFor(fake.fetchImpl);

    expect(await rejectionCode(client.listFilters("chicken"))).toBe("not_found");
  });

  it("holds the floor under BGF_MIN_INTERVAL_MS", () => {
    const fallback = loadConfig({}).minIntervalMs;
    expect(fallback).toBeGreaterThanOrEqual(MIN_ALLOWED_INTERVAL_MS);

    const tooEager = loadConfig({ BGF_MIN_INTERVAL_MS: "10" });
    expect(tooEager.minIntervalMs).toBe(fallback);

    const allowed = loadConfig({ BGF_MIN_INTERVAL_MS: String(MIN_ALLOWED_INTERVAL_MS * 3) });
    expect(allowed.minIntervalMs).toBe(MIN_ALLOWED_INTERVAL_MS * 3);
  });
});
