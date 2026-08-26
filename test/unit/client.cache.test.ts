import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");
const CACHE_TTL_MS = 60_000;

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

interface Fake {
  fetchImpl: typeof fetch;
  urls: string[];
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

/** A fake whose answer is chosen per call, so a test can vary what the site returns. */
function fakeFetch(answer: (callIndex: number) => Response): Fake {
  const urls: string[] = [];
  const impl = async (input: string | URL | Request): Promise<Response> => {
    const index = urls.length;
    urls.push(urlOf(input));
    return answer(index);
  };
  return { fetchImpl: impl as unknown as typeof fetch, urls };
}

/**
 * Drives the fake clock forward until `promise` settles, so nothing in a test
 * waits on the real one. The cap turns an unfulfilled promise into a failure
 * rather than a hang.
 */
async function runWithClock<T>(promise: Promise<T>, stepMs = 50, capMs = 300_000): Promise<T> {
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

function clientFor(fetchImpl: typeof fetch, env: Record<string, string> = {}): GoodFoodClient {
  const config = loadConfig({ BGF_CACHE_TTL_MS: String(CACHE_TTL_MS), ...env });
  return new GoodFoodClient({ config, logger: createLogger("error"), fetchImpl });
}

describe("GoodFoodClient cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves an identical second read from the cache without asking the site again", async () => {
    const payload = fixture("filters-scoped");
    const fake = fakeFetch(() => jsonResponse(payload));
    const client = clientFor(fake.fetchImpl);

    const first = await runWithClock(client.listFilters("chicken"));
    const second = await runWithClock(client.listFilters("chicken"));

    expect(fake.urls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data).toEqual(first.data);
  });

  it("keeps a scoped read and a site-wide read as separate entries", async () => {
    const scoped = fixture("filters-scoped");
    const sitewide = fixture("filters-sitewide");
    const fake = fakeFetch((index) => jsonResponse(index === 0 ? scoped : sitewide));
    const client = clientFor(fake.fetchImpl);

    const scopedRead = await runWithClock(client.listFilters("chicken"));
    const sitewideRead = await runWithClock(client.listFilters());
    const scopedAgain = await runWithClock(client.listFilters("chicken"));
    const sitewideAgain = await runWithClock(client.listFilters());

    expect(fake.urls).toHaveLength(2);
    expect(scopedRead.cached).toBe(false);
    expect(sitewideRead.cached).toBe(false);
    expect(scopedAgain.cached).toBe(true);
    expect(sitewideAgain.cached).toBe(true);
    expect(scopedAgain.data.query).toBe("chicken");
    expect(sitewideAgain.data.query).toBeNull();
  });

  it("does not cache an unreadable answer, so the next read asks the site again", async () => {
    const unreadable = fixture("filters-unreadable");
    const scoped = fixture("filters-scoped");
    const fake = fakeFetch((index) => jsonResponse(index === 0 ? unreadable : scoped));
    const client = clientFor(fake.fetchImpl);

    await expect(runWithClock(client.listFilters("chicken"))).rejects.toThrow();

    const retried = await runWithClock(client.listFilters("chicken"));

    expect(fake.urls).toHaveLength(2);
    expect(retried.cached).toBe(false);
    expect(retried.data.query).toBe("chicken");
  });

  it("stores nothing when BGF_CACHE_TTL_MS is zero", async () => {
    const payload = fixture("filters-scoped");
    const fake = fakeFetch(() => jsonResponse(payload));
    const client = clientFor(fake.fetchImpl, { BGF_CACHE_TTL_MS: "0" });

    const first = await runWithClock(client.listFilters("chicken"));
    const second = await runWithClock(client.listFilters("chicken"));

    expect(fake.urls).toHaveLength(2);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
  });

  it("asks the site again once the entry has outlived its TTL", async () => {
    const payload = fixture("filters-scoped");
    const fake = fakeFetch(() => jsonResponse(payload));
    const client = clientFor(fake.fetchImpl);

    await runWithClock(client.listFilters("chicken"));

    const withinTtl = await runWithClock(client.listFilters("chicken"));
    expect(withinTtl.cached).toBe(true);
    expect(fake.urls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(CACHE_TTL_MS + 1);

    const afterTtl = await runWithClock(client.listFilters("chicken"));
    expect(fake.urls).toHaveLength(2);
    expect(afterTtl.cached).toBe(false);
  });
});
