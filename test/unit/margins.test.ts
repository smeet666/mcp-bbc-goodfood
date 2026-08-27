import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodFoodClient, SearchOptions } from "../../src/bbcgoodfood/client.js";
import { GoodFoodClient as RealClient } from "../../src/bbcgoodfood/client.js";
import { parseSearchReport, parseSearchRows } from "../../src/bbcgoodfood/parse.js";
import { parseFailure } from "../../src/errors.js";
import { FACET_NAMES, searchUrl } from "../../src/bbcgoodfood/urls.js";
import { createLogger, loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import type { SearchRecipesArgs } from "../../src/tools/searchRecipes.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import type { ToolResult } from "../../src/tools/shared.js";
import type { Read, SearchReport, SearchRow } from "../../src/types.js";

const SEARCH_PAGE = readFileSync(new URL("../fixtures/search-page.json", import.meta.url), "utf8");

/**
 * The near-spelling note has to name a spelling and the single slip that
 * separates it from the search. Matching on the idea rather than on the exact
 * sentence leaves the wording free while keeping the claim it must carry.
 */
function textOf(result: ToolResult): string {
  return result.content.map((block) => block.text).join("\n");
}

function rowLiteral(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: "cake-one",
    title: "Cake",
    url: "https://www.bbcgoodfood.com/recipes/cake",
    image_url: null,
    rating: null,
    rating_count: null,
    premium: false,
    total_minutes: null,
    difficulty: null,
    author: null,
    ...overrides,
  };
}

function reportLiteral(overrides: Partial<SearchReport> = {}): SearchReport {
  return {
    query: "cake",
    results: [rowLiteral()],
    result_count: 1,
    total_available: 1,
    total_is_ceiling: false,
    rows_seen: 1,
    restrictions_dropped: [],
    ...overrides,
  };
}

function clientServing(report: SearchReport): GoodFoodClient {
  const read: Read<SearchReport> = { data: report, cached: false };
  return { searchRecipes: async () => read } as unknown as GoodFoodClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseSearchRows on a payload it cannot use", () => {
  const unusable: { label: string; payload: unknown }[] = [
    { label: "a string", payload: "searchResults" },
    { label: "a number", payload: 42 },
    { label: "null", payload: null },
    { label: "undefined", payload: undefined },
    { label: "an array", payload: [{ id: "1", title: "Cake", url: "https://example.invalid" }] },
    { label: "an object with no searchResults", payload: { filters: [] } },
  ];

  for (const { label, payload } of unusable) {
    it(`renders no rows and does not throw on ${label}`, () => {
      expect(() => parseSearchRows(payload)).not.toThrow();
      const parsed = parseSearchRows(payload);
      expect(parsed.rows).toEqual([]);
      expect(Array.isArray(parsed.skipped)).toBe(true);
    });
  }

  it("leaves the refusal to parseSearchReport, which throws on a payload with no searchResults", () => {
    expect(() => parseSearchReport({ filters: [] }, "cake")).toThrow();
  });

  it("sets aside a row carrying nothing at all, and names it without saying undefined or null", () => {
    const parsed = parseSearchRows({ searchResults: { totalItems: 1, items: [{}] } });
    expect(parsed.rows).toEqual([]);
    expect(parsed.skipped.length).toBe(1);
    const message = parsed.skipped[0] as string;
    expect(message.trim().length).toBeGreaterThan(0);
    expect(message).not.toMatch(/undefined/i);
    expect(message).not.toMatch(/null/i);
  });
});

describe("searchUrl and the facets it knows", () => {
  it("ignores a facet whose name is not one it knows, without throwing", () => {
    const plain = new URL(searchUrl({ search: "cake" }));
    const withUnknown = new URL(searchUrl({ search: "cake", facets: { not_a_facet: "x" } }));
    expect([...withUnknown.searchParams.keys()].sort()).toEqual(
      [...plain.searchParams.keys()].sort(),
    );
    expect([...withUnknown.searchParams.values()]).not.toContain("x");
  });

  it("carries a parameter for every name it publishes", () => {
    const plain = [...new URL(searchUrl({ search: "cake" })).searchParams.keys()];
    for (const name of FACET_NAMES) {
      const carried = [
        ...new URL(searchUrl({ search: "cake", facets: { [name]: "4" } })).searchParams.keys(),
      ];
      expect(carried.length).toBeGreaterThan(plain.length);
    }
  });

  it("writes the four numeric bounds the way the site does, minutes turned into seconds", () => {
    expect(FACET_NAMES).toContain("max_total_minutes");
    expect(FACET_NAMES).toContain("max_calories");
    expect(FACET_NAMES).toContain("min_servings");
    expect(FACET_NAMES).toContain("min_rating");

    const minutes = new URL(searchUrl({ search: "cake", facets: { max_total_minutes: "30" } }));
    expect(minutes.searchParams.get("totalTime")).toBe("lt-1800");

    const calories = new URL(searchUrl({ search: "cake", facets: { max_calories: "500" } }));
    expect(calories.searchParams.get("calories")).toBe("lt-500");

    const servings = new URL(searchUrl({ search: "cake", facets: { min_servings: "4" } }));
    expect(servings.searchParams.get("servings")).toBe("gte-4");

    const rating = new URL(searchUrl({ search: "cake", facets: { min_rating: "4.5" } }));
    expect(rating.searchParams.get("ratings")).toBe("gte-4.5");
  });
});

describe("a client built with no transport of its own", () => {
  it("reads the site through the runtime fetch", async () => {
    const stub = vi.fn(
      async () =>
        new Response(SEARCH_PAGE, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", stub);

    const client = new RealClient({ config: loadConfig({}), logger: createLogger("silent") });
    const pending = client.searchRecipes("keldish");
    await vi.advanceTimersByTimeAsync(10_000);
    const read = await pending;

    expect(stub).toHaveBeenCalled();
    expect(read.data.query).toBe("keldish");
  });
});

describe("what search_recipes renders", () => {
  it("states no time and no difficulty rather than making one up", async () => {
    const report = reportLiteral({
      results: [rowLiteral({ total_minutes: null, difficulty: null })],
    });
    const result = await runSearchRecipes(clientServing(report), { query: "cake" });
    const rendered = textOf(result);

    const structured = result.structuredContent as { results: SearchRow[] };
    expect(structured.results[0]?.total_minutes).toBeNull();
    expect(structured.results[0]?.difficulty).toBeNull();
    expect(rendered).not.toMatch(/undefined/i);
    expect(rendered).not.toMatch(/\bnull\b/i);
    expect(rendered).not.toMatch(/\b0\s*min/i);
  });

  it("invents no figure in the text when the site published no total", async () => {
    const report = reportLiteral({
      total_available: null,
      result_count: 1,
    });
    const result = await runSearchRecipes(clientServing(report), { query: "cake" });
    const rendered = textOf(result);

    expect((result.structuredContent as { total_available: unknown }).total_available).toBeNull();
    // Every count this report carries is one, so any other figure in the text
    // would be a number the report does not hold.
    for (const figure of rendered.match(/\d+/g) ?? []) {
      expect(figure).toBe("1");
    }
  });

  it("passes limit, page and sort down when they are given", async () => {
    const calls: { query: string; options: SearchOptions | undefined }[] = [];
    const read: Read<SearchReport> = { data: reportLiteral(), cached: false };
    const fake = {
      searchRecipes: async (query: string, options?: SearchOptions) => {
        calls.push({ query, options });
        return read;
      },
    } as unknown as GoodFoodClient;

    await runSearchRecipes(fake, { query: "cake", limit: 5, page: 3, sort: "rating" });

    expect(calls.length).toBe(1);
    expect(calls[0]?.query).toBe("cake");
    expect(calls[0]?.options?.limit).toBe(5);
    expect(calls[0]?.options?.page).toBe(3);
    expect(calls[0]?.options?.sort).toBe("rating");
  });

  it("leaves the site's own defaults in place when none of the three is given", async () => {
    const calls: { query: string; options: SearchOptions | undefined }[] = [];
    const read: Read<SearchReport> = { data: reportLiteral(), cached: false };
    const fake = {
      searchRecipes: async (query: string, options?: SearchOptions) => {
        calls.push({ query, options });
        return read;
      },
    } as unknown as GoodFoodClient;

    const result = await runSearchRecipes(fake, { query: "cake" });

    expect(calls.length).toBe(1);
    expect(calls[0]?.query).toBe("cake");
    // The contract states one default per argument, so the only faithful
    // behaviours are passing that default or leaving the argument out.
    const passed = calls[0]?.options;
    expect(passed?.limit ?? 30).toBe(30);
    expect(passed?.page ?? 1).toBe(1);
    expect(passed?.sort ?? "relevant").toBe("relevant");
    expect(result.isError).toBeUndefined();
  });
});

describe("search_recipes over a live server", () => {
  async function connected(): Promise<{ client: Client; close: () => Promise<void> }> {
    const fetchImpl = (async () =>
      new Response(SEARCH_PAGE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const server = createServer({ fetchImpl, logger: createLogger("silent") });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "margins", version: "1.0.0" });
    const opened = Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await vi.advanceTimersByTimeAsync(1000);
    await opened;
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("answers a call that succeeds with structured content", async () => {
    const { client, close } = await connected();
    const call = client.callTool({ name: "search_recipes", arguments: { query: "keldish" } });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = (await call) as { structuredContent?: Record<string, unknown> };

    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent?.["query"]).toBe("keldish");
    expect(result.structuredContent?.["source"]).toBe("BBC Good Food");
    await close();
  });

  it("answers a call whose arguments are refused with [invalid_input]", async () => {
    const { client, close } = await connected();
    const call = client.callTool({ name: "search_recipes", arguments: { query: "   " } });
    await vi.advanceTimersByTimeAsync(10_000);

    let refusal = "";
    try {
      const result = (await call) as { isError?: boolean; content: { text: string }[] };
      expect(result.isError).toBe(true);
      refusal = result.content.map((block) => block.text).join("\n");
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error);
    }

    expect(refusal).toContain("[invalid_input]");
    await close();
  });
});

describe("the separator of a detail line", () => {
  it("leaves none dangling when the site published no time, no difficulty and no rating", async () => {
    const report = reportLiteral({
      results: [rowLiteral({ total_minutes: null, difficulty: null, rating: null })],
    });
    const result = await runSearchRecipes(clientServing(report), { query: "cake" });

    for (const line of textOf(result).split("\n")) {
      expect(line.trimEnd().endsWith("·")).toBe(false);
    }
  });

  it("keeps one when the row carries at least one of the three", async () => {
    const report = reportLiteral({
      results: [rowLiteral({ total_minutes: 50, difficulty: "Easy", rating: null })],
    });
    const rendered = textOf(await runSearchRecipes(clientServing(report), { query: "cake" }));

    expect(rendered).toContain("·");
    for (const line of rendered.split("\n")) {
      expect(line.trimEnd().endsWith("·")).toBe(false);
    }
  });
});

describe("a restriction handed over as undefined", () => {
  it("sends no facet to the client and drops nothing", async () => {
    const calls: { query: string; options: SearchOptions | undefined }[] = [];
    const read: Read<SearchReport> = { data: reportLiteral(), cached: false };
    const fake = {
      searchRecipes: async (query: string, options?: SearchOptions) => {
        calls.push({ query, options });
        return read;
      },
    } as unknown as GoodFoodClient;

    // The protocol cannot carry undefined, so this reaches the tool only from a
    // TypeScript caller. Without a guard the site would be sent "undefined".
    const args = { query: "cake", diet: undefined } as SearchRecipesArgs;
    const result = await runSearchRecipes(fake, args);

    const facets = calls[0]?.options?.facets ?? {};
    expect(Object.keys(facets)).not.toContain("diet");
    expect(Object.values(facets)).not.toContain("undefined");
    expect(result.structuredContent?.["restrictions_dropped"]).toEqual([]);
  });
});

describe("a failure rendered in the one shape", () => {
  const ANY_OF_THE_SIX =
    /\[(not_found|invalid_input|rate_limited|parse_failure|network_error|timeout)\]/;

  it("renders what the tool threw in the one shape, on valid arguments", async () => {
    const fetchImpl = (async () =>
      new Response("<html>not the json the route serves</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const server = createServer({ fetchImpl, logger: createLogger("silent") });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "margins-envelope", version: "1.0.0" });
    const opened = Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await vi.advanceTimersByTimeAsync(1000);
    await opened;

    const call = client.callTool({ name: "search_recipes", arguments: { query: "keldish" } });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = (await call) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content.map((block) => block.text).join("\n")).toMatch(ANY_OF_THE_SIX);
    await client.close();
    await server.close();
  });

  it("lets a failure raised by the client travel out to that envelope", async () => {
    const fake = {
      searchRecipes: async () => {
        throw parseFailure("the route served something other than JSON");
      },
    } as unknown as GoodFoodClient;

    // The single shape is written once, by the envelope. A tool that caught
    // this itself would render the failure a second way.
    await expect(runSearchRecipes(fake, { query: "cake" })).rejects.toMatchObject({
      name: "GoodFoodError",
      code: "parse_failure",
    });
  });
});

describe("every sort the enumeration names", () => {
  const SORTS = ["relevant", "rating", "published", "quickest"] as const;

  for (const sort of SORTS) {
    it(`carries ${sort} down to the client`, async () => {
      const seen: (SearchOptions | undefined)[] = [];
      const read: Read<SearchReport> = { data: reportLiteral(), cached: false };
      const fake = {
        searchRecipes: async (_query: string, options?: SearchOptions) => {
          seen.push(options);
          return read;
        },
      } as unknown as GoodFoodClient;

      const result = await runSearchRecipes(fake, { query: "cake", sort });

      expect(seen[0]?.sort).toBe(sort);
      expect(result.isError).toBeUndefined();
    });
  }
});
