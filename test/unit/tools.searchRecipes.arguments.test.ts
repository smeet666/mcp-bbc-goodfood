import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GoodFoodError } from "../../src/errors.js";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createServer } from "../../src/server.js";
import { listFiltersInput } from "../../src/tools/listFilters.js";
import {
  type SearchRecipesArgs,
  runSearchRecipes,
  searchRecipesArgs,
  searchRecipesInput,
  searchRecipesOutputShape,
} from "../../src/tools/searchRecipes.js";
import type { SearchReport, SearchRow } from "../../src/types.js";

/** Every argument the contract declares, so an unknown one is a real surprise. */
/**
 * The one place that writes the argument list out. Every other test states that
 * the schema and what the tool accepts agree, so an argument added on purpose is
 * recorded here and nowhere else.
 */
const DECLARED_ARGUMENTS: string[] = [
  "query",
  "limit",
  "page",
  "sort",
  "diet",
  "cuisine",
  "meal_type",
  "difficulty",
  "max_total_minutes",
  "max_calories",
  "min_servings",
  "min_rating",
  "exclude_premium",
];

function makeRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: "301",
    title: "Keldish greens with chorizo",
    url: "https://www.bbcgoodfood.com/recipes/keldish-greens-chorizo",
    image_url: "https://images.example.invalid/keldish-greens-chorizo.jpg",
    rating: 4.2,
    rating_count: 341,
    premium: false,
    total_minutes: 50,
    difficulty: "Easy",
    author: "Wren Holloway",
    ...overrides,
  };
}

function makeReport(overrides: Partial<SearchReport> = {}): SearchReport {
  const results = overrides.results ?? [
    makeRow(),
    makeRow({ id: "302", rating: null, rating_count: null }),
  ];
  return {
    query: "keldish",
    results,
    result_count: results.length,
    total_available: 195,
    total_is_ceiling: false,
    rows_seen: results.length,
    restrictions_lifted: [],
    ...overrides,
  };
}

/** A client that answers from memory, so argument checking is measured alone. */
function fakeClient(report: SearchReport = makeReport()): GoodFoodClient {
  return {
    searchRecipes: () => Promise.resolve({ data: report, cached: false }),
  } as unknown as GoodFoodClient;
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

function refusalOf(input: unknown): string[] {
  const parsed = searchRecipesArgs.safeParse(input);
  expect(parsed.success).toBe(false);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/**
 * The tool raises its refusals rather than rendering them, and the wiring above
 * turns any failure into the one error shape. Both tools of this server refuse
 * the same way, so a caller reads one vocabulary whichever one it called.
 */
async function toolRefusalOf(input: unknown): Promise<string> {
  try {
    await settle(runSearchRecipes(fakeClient(), input as SearchRecipesArgs));
  } catch (error) {
    expect(error).toBeInstanceOf(GoodFoodError);
    return (error as GoodFoodError).message;
  }
  throw new Error("expected the arguments to be refused, and they were accepted");
}

async function listedTools(): Promise<
  { name: string; inputSchema: unknown; outputSchema?: unknown }[]
> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "argument-test", version: "0.0.0" });
  await settle(Promise.all([client.connect(clientTransport), server.connect(serverTransport)]));
  const listed = await settle(client.listTools());
  await settle(client.close());
  return listed.tools;
}

describe("search_recipes arguments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares exactly the arguments the contract names", () => {
    expect(Object.keys(searchRecipesInput).sort()).toEqual([...DECLARED_ARGUMENTS].sort());
  });

  it("requires a query, where list_filters treats its own as optional", async () => {
    expect(searchRecipesArgs.safeParse({}).success).toBe(false);
    expect(z.object(listFiltersInput).safeParse({}).success).toBe(true);
    expect(await toolRefusalOf({})).toMatch(/^\[invalid_input\]/);
  });

  it("refuses a query of nothing but spaces", async () => {
    expect(refusalOf({ query: "   " })).not.toHaveLength(0);
    expect(await toolRefusalOf({ query: "   " })).toMatch(/^\[invalid_input\]/);
  });

  it("measures the query after trimming: 1 and 80 pass, 0 and 81 do not", () => {
    expect(searchRecipesArgs.safeParse({ query: "" }).success).toBe(false);
    expect(searchRecipesArgs.safeParse({ query: "a".repeat(81) }).success).toBe(false);
    expect(searchRecipesArgs.safeParse({ query: "a" }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: `  ${"a".repeat(80)}  ` }).success).toBe(true);
  });

  it("hands the trimmed query on, both from the schema and from the tool", async () => {
    expect(searchRecipesArgs.parse({ query: "  keldish greens  " }).query).toBe("keldish greens");
    const result = await settle(runSearchRecipes(fakeClient(), { query: "  keldish  " }));
    expect((result.structuredContent as { query: string }).query).toBe("keldish");
  });

  it("holds limit to 1 through 30", () => {
    expect(searchRecipesArgs.safeParse({ query: "keldish", limit: 1 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", limit: 30 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", limit: 0 }).success).toBe(false);
    expect(searchRecipesArgs.safeParse({ query: "keldish", limit: 31 }).success).toBe(false);
  });

  it("holds page to 1 through 334", () => {
    expect(searchRecipesArgs.safeParse({ query: "keldish", page: 1 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", page: 334 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", page: 0 }).success).toBe(false);
    expect(searchRecipesArgs.safeParse({ query: "keldish", page: 335 }).success).toBe(false);
  });

  it("holds min_rating to 1 through 5", () => {
    expect(searchRecipesArgs.safeParse({ query: "keldish", min_rating: 1 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", min_rating: 5 }).success).toBe(true);
    expect(searchRecipesArgs.safeParse({ query: "keldish", min_rating: 0 }).success).toBe(false);
    expect(searchRecipesArgs.safeParse({ query: "keldish", min_rating: 6 }).success).toBe(false);
  });

  it("takes the four sorts the site offers and no fifth", () => {
    for (const sort of ["relevant", "rating", "published", "quickest"]) {
      expect(searchRecipesArgs.safeParse({ query: "keldish", sort }).success).toBe(true);
    }
    expect(searchRecipesArgs.safeParse({ query: "keldish", sort: "newest" }).success).toBe(false);
  });

  it("refuses an argument it never declared, and names the closest one it did", async () => {
    expect(refusalOf({ query: "keldish", cusine: "keldish" })).not.toHaveLength(0);
    const refusal = await toolRefusalOf({ query: "keldish", cusine: "keldish" });
    expect(refusal).toMatch(/^\[invalid_input\]/);
    expect(refusal).toContain("cuisine");
  });

  it("opens every refusal with [invalid_input], from the schema as from the tool", async () => {
    const refused: unknown[] = [
      {},
      { query: "   " },
      { query: "a".repeat(81) },
      { query: "keldish", limit: 0 },
      { query: "keldish", page: 335 },
      { query: "keldish", min_rating: 6 },
      { query: "keldish", sort: "newest" },
      { query: "keldish", cusine: "keldish" },
    ];
    for (const input of refused) {
      for (const message of refusalOf(input)) {
        expect(message).toMatch(/^\[invalid_input\]/);
      }
      expect(await toolRefusalOf(input)).toMatch(/^\[invalid_input\]/);
    }
  });

  // States the agreement rather than the roll call: the order is fixed, every
  // tool declares an output schema, and search_recipes follows list_filters
  // because a caller learns the values a restriction takes before using one.
  // The roll call itself is written down once, elsewhere.
  it("lists its tools in a fixed order, each with an output schema", async () => {
    const first = await listedTools();
    const second = await listedTools();
    const names = first.map((tool) => tool.name);

    expect(second.map((tool) => tool.name)).toEqual(names);
    expect(names).toContain("list_filters");
    expect(names.indexOf("search_recipes")).toBeGreaterThan(names.indexOf("list_filters"));
    for (const tool of first) {
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("publishes additionalProperties: false on the search_recipes input schema", async () => {
    const tools = await listedTools();
    const search = tools.find((tool) => tool.name === "search_recipes");
    expect(search).toBeDefined();
    const published = search!.inputSchema as { additionalProperties?: unknown };
    expect(published.additionalProperties).toBe(false);
  });

  it("parses its own structured output through the shape it publishes", async () => {
    const result = await settle(runSearchRecipes(fakeClient(), { query: "keldish" }));
    const parsed = z.object(searchRecipesOutputShape).parse(result.structuredContent);
    expect(parsed).toEqual(result.structuredContent);
  });
});
