import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${FIXTURES}${name}`, "utf8");
}

const PAGE = fixture("search-page.json");
const RESTRICTED_NONE = fixture("search-restricted-none.json");
const RESTRICTION_DROPPED = fixture("search-restriction-dropped.json");

interface FakeFetch {
  impl: typeof fetch;
  urls: string[];
}

/**
 * Answers each call with the next body, and repeats the last one, so a call
 * nobody expected still lands somewhere the count can show it.
 */
function fakeFetch(bodies: string[], status = 200): FakeFetch {
  const urls: string[] = [];
  const impl = (input: unknown): Promise<Response> => {
    urls.push(input instanceof Request ? input.url : String(input));
    const body = bodies[Math.min(urls.length - 1, bodies.length - 1)] ?? "{}";
    return Promise.resolve(
      new Response(body, { status, headers: { "content-type": "application/json" } }),
    );
  };
  return { impl: impl as unknown as typeof fetch, urls };
}

function makeClient(fetchImpl: typeof fetch, env: NodeJS.ProcessEnv = {}): GoodFoodClient {
  return new GoodFoodClient({
    config: loadConfig(env),
    logger: createLogger("silent"),
    fetchImpl,
  });
}

/** Lets pending work finish while the clock stays under this test's control. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  const outcome = pending.then(
    (value) => () => value,
    (error: unknown) => () => {
      throw error;
    },
  );
  await vi.advanceTimersByTimeAsync(5000);
  return (await outcome)();
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

describe("GoodFoodClient.searchRecipes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries the search, the page, the limit, the sort and the facets", async () => {
    const fake = fakeFetch([PAGE]);
    const client = makeClient(fake.impl);
    await settle(
      client.searchRecipes("keldish", {
        limit: 5,
        page: 2,
        sort: "rating",
        facets: { diet: "nut-free", cuisine: "keldish", difficulty: "easy" },
      }),
    );
    expect(fake.urls).toHaveLength(1);
    const asked = new URL(fake.urls[0]!).searchParams;
    expect(asked.get("search")).toBe("keldish");
    expect(asked.get("limit")).toBe("5");
    expect(asked.get("page")).toBe("2");
    expect(asked.get("sort")).toBe("rating");
    expect(asked.get("diet")).toBe("nut-free");
    expect(asked.get("cuisine")).toBe("keldish");
    expect(asked.get("difficulty")).toBe("easy");
  });

  it("encodes an ampersand and an accent rather than sending them raw", async () => {
    const fake = fakeFetch([PAGE]);
    await settle(makeClient(fake.impl).searchRecipes("crème & pain"));
    const url = fake.urls[0]!;
    expect(new URL(url).searchParams.get("search")).toBe("crème & pain");
    expect(url).not.toContain("crème");
    expect(url).not.toContain("& pain");
  });

  it("runs the search once more without the restrictions when they returned nothing", async () => {
    const fake = fakeFetch([RESTRICTED_NONE, RESTRICTION_DROPPED]);
    const read = await settle(
      makeClient(fake.impl).searchRecipes("keldish", {
        facets: { diet: "glutenfree", max_total_minutes: "lt-1800" },
      }),
    );
    expect(fake.urls).toHaveLength(2);
    expect(read.data.results).toHaveLength(2);
    expect(read.data.result_count).toBe(2);
    expect(read.data.total_available).toBe(12);
    expect(sorted(read.data.restrictions_dropped)).toEqual(["diet", "max_total_minutes"]);
    const secondAsk = new URL(fake.urls[1]!).searchParams;
    expect(secondAsk.get("search")).toBe("keldish");
    expect(secondAsk.has("diet")).toBe(false);
  });

  it("names the dropped restrictions by the tool's argument names", async () => {
    const fake = fakeFetch([RESTRICTED_NONE, RESTRICTION_DROPPED]);
    const read = await settle(
      makeClient(fake.impl).searchRecipes("keldish", {
        facets: { max_total_minutes: "lt-1800" },
      }),
    );
    expect(read.data.restrictions_dropped).toEqual(["max_total_minutes"]);
    expect(read.data.restrictions_dropped).not.toContain("totalTime");
  });

  it("takes a search without restrictions that returned nothing as a real absence", async () => {
    const fake = fakeFetch([RESTRICTED_NONE]);
    const read = await settle(makeClient(fake.impl).searchRecipes("keldish"));
    expect(fake.urls).toHaveLength(1);
    expect(read.data.results).toEqual([]);
    expect(read.data.result_count).toBe(0);
    expect(read.data.total_available).toBe(0);
    expect(read.data.restrictions_dropped).toEqual([]);
  });

  it("still names what it dropped when the second search returned nothing either", async () => {
    const fake = fakeFetch([RESTRICTED_NONE, RESTRICTED_NONE]);
    const read = await settle(
      makeClient(fake.impl).searchRecipes("keldish", { facets: { diet: "glutenfree" } }),
    );
    expect(fake.urls).toHaveLength(2);
    expect(read.data.results).toEqual([]);
    expect(read.data.restrictions_dropped).toEqual(["diet"]);
  });

  it("leaves a search that returned rows alone", async () => {
    const fake = fakeFetch([PAGE]);
    const read = await settle(
      makeClient(fake.impl).searchRecipes("keldish", { facets: { diet: "nut-free" } }),
    );
    expect(fake.urls).toHaveLength(1);
    expect(read.data.result_count).toBe(5);
    expect(read.data.restrictions_dropped).toEqual([]);
  });

  it("asks the site once for two identical searches", async () => {
    const fake = fakeFetch([PAGE]);
    const client = makeClient(fake.impl);
    const first = await settle(client.searchRecipes("keldish", { limit: 5 }));
    const second = await settle(client.searchRecipes("keldish", { limit: 5 }));
    expect(fake.urls).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data).toEqual(first.data);
  });

  it("keeps two different searches apart", async () => {
    const fake = fakeFetch([PAGE]);
    const client = makeClient(fake.impl);
    const first = await settle(client.searchRecipes("keldish"));
    const second = await settle(client.searchRecipes("marran"));
    expect(fake.urls).toHaveLength(2);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(second.data.query).toBe("marran");
  });

  it("reports a 429 as rate_limited", async () => {
    // No retries left, so the refusal is the answer and no backoff wait runs.
    const fake = fakeFetch(["{}"], 429);
    const client = makeClient(fake.impl, { BGF_MAX_RETRIES: "0" });
    await expect(settle(client.searchRecipes("keldish"))).rejects.toMatchObject({
      name: "GoodFoodError",
      code: "rate_limited",
    });
  });

  it("reports a body that is not JSON as parse_failure", async () => {
    const fake = fakeFetch(["<html>not json at all</html>"]);
    await expect(settle(makeClient(fake.impl).searchRecipes("keldish"))).rejects.toMatchObject({
      name: "GoodFoodError",
      code: "parse_failure",
    });
  });
});
