import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";

const FIXED_NOW = new Date("2026-01-01T00:00:00Z");
const SEARCH_ENDPOINT = "https://www.bbcgoodfood.com/api/search-frontend/search";

// The address a site owner writes to when this client misbehaves. It is the
// project's own repository, published in package.json.
const CONTACT = "github.com/smeet666/mcp-bbc-goodfood";

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

interface Call {
  url: string;
  headers: Headers;
}

interface Fake {
  fetchImpl: typeof fetch;
  calls: Call[];
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

function headersOf(input: string | URL | Request, init: RequestInit | undefined): Headers {
  if (typeof input !== "string" && !(input instanceof URL)) {
    return input.headers;
  }
  return new Headers(init?.headers);
}

function fakeFetch(payload: unknown): Fake {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: urlOf(input), headers: headersOf(input, init) });
    return jsonResponse(payload);
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/**
 * Drives the fake clock forward until `promise` settles, so nothing in a test
 * waits on the real one. `stepMs` is the resolution the test needs from
 * `Date.now()`; `capMs` bounds the walk so an unfulfilled promise fails loudly
 * instead of hanging.
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
  const config = loadConfig(env);
  return new GoodFoodClient({ config, logger: createLogger("error"), fetchImpl });
}

describe("GoodFoodClient.listFilters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the search endpoint for the query and reports a fresh read", async () => {
    const fake = fakeFetch(fixture("filters-scoped"));
    const client = clientFor(fake.fetchImpl);

    const read = await runWithClock(client.listFilters("chicken"));

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    const url = new URL(call.url);
    expect(`${url.origin}${url.pathname}`).toBe(SEARCH_ENDPOINT);
    expect(url.searchParams.get("search")).toBe("chicken");

    expect(read.cached).toBe(false);
    expect(read.data.query).toBe("chicken");
    expect(read.data.filter_count).toBe(read.data.filters.length);
  });

  it("asks for the site-wide scope when no query is given", async () => {
    const fake = fakeFetch(fixture("filters-sitewide"));
    const client = clientFor(fake.fetchImpl);

    const read = await runWithClock(client.listFilters());

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    expect(new URL(call.url).searchParams.get("search")).toBe("");
    expect(read.data.query).toBeNull();
  });

  it("treats an explicit null query as the site-wide scope", async () => {
    const fake = fakeFetch(fixture("filters-sitewide"));
    const client = clientFor(fake.fetchImpl);

    const read = await runWithClock(client.listFilters(null));

    const call = fake.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    expect(new URL(call.url).searchParams.get("search")).toBe("");
    expect(read.data.query).toBeNull();
  });

  it("sends a User-Agent carrying the project's contact address", async () => {
    const fake = fakeFetch(fixture("filters-scoped"));
    const client = clientFor(fake.fetchImpl);

    await runWithClock(client.listFilters("chicken"));

    const call = fake.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    expect(call.headers.get("user-agent")).toContain(CONTACT);
  });

  it("keeps the contact address even when BGF_USER_AGENT supplies its own", async () => {
    const fake = fakeFetch(fixture("filters-scoped"));
    const client = clientFor(fake.fetchImpl, {
      BGF_USER_AGENT: "SomeoneElse/1.0 (+https://example.invalid/contact)",
    });

    await runWithClock(client.listFilters("chicken"));

    const call = fake.calls[0];
    if (call === undefined) {
      throw new Error("no call recorded");
    }
    const agent = call.headers.get("user-agent");
    expect(agent).toContain("SomeoneElse/1.0");
    expect(agent).toContain(CONTACT);
  });

  it("reports the spacing currently in force", async () => {
    const fake = fakeFetch(fixture("filters-scoped"));
    const config = loadConfig({});
    const client = new GoodFoodClient({
      config,
      logger: createLogger("error"),
      fetchImpl: fake.fetchImpl,
    });

    expect(client.currentIntervalMs).toBe(config.minIntervalMs);
  });
});
