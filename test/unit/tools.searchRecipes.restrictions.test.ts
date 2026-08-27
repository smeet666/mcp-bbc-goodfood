/**
 * What the tool hands the client when a caller restricts a search.
 *
 * A restriction is written by a caller under the tool's own argument name, and
 * it has to reach the client under that same name: that is what lets a dropped
 * restriction be reported back as something the caller could change.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { runSearchRecipes, searchRecipesInput } from "../../src/tools/searchRecipes.js";
import type { Read, SearchReport, SearchRow } from "../../src/types.js";

/** The options shape the client accepts, as the tool layer has to build it. */
interface SearchOptionsSeen {
  limit?: number;
  page?: number;
  sort?: string;
  facets?: Readonly<Record<string, string>>;
}

interface CallSeen {
  query: string;
  options: SearchOptionsSeen | undefined;
}

type ToolClient = Parameters<typeof runSearchRecipes>[0];
type ToolArgs = Parameters<typeof runSearchRecipes>[1];

/** Arguments that carry no restriction at all. */
const NON_RESTRICTIONS = ["query", "limit", "page", "sort", "exclude_premium"];

const row: SearchRow = {
  id: "1234",
  title: "Lemon pasta",
  url: "https://www.bbcgoodfood.com/recipes/lemon-pasta",
  image_url: null,
  rating: 4,
  rating_count: 12,
  premium: false,
  total_minutes: 25,
  difficulty: "Easy",
  author: null,
};

/**
 * A page that holds a result, so the search never looks like the empty answer
 * that would send the tool back for a second, unrestricted attempt.
 */
function report(): SearchReport {
  return {
    query: "pasta",
    results: [row],
    result_count: 1,
    total_available: 12,
    total_is_ceiling: false,
    rows_seen: 1,
    restrictions_dropped: [],
  };
}

/** A client that answers every search the same way and keeps what it was asked. */
function recordingClient(): { calls: CallSeen[]; client: ToolClient } {
  const calls: CallSeen[] = [];
  const client = {
    searchRecipes(query: string, options?: SearchOptionsSeen): Promise<Read<SearchReport>> {
      calls.push({ query, options });
      return Promise.resolve({ data: report(), cached: false });
    },
  };
  return { calls, client: client as unknown as ToolClient };
}

async function facetsFor(args: Record<string, unknown>): Promise<Readonly<Record<string, string>>> {
  const { calls, client } = recordingClient();
  await runSearchRecipes(client, args as ToolArgs);
  expect(calls).toHaveLength(1);
  const facets = calls[0]?.options?.facets;
  expect(facets).toBeDefined();
  return facets as Readonly<Record<string, string>>;
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("runSearchRecipes hands its restrictions to the client", () => {
  it("passes a lone textual restriction under the name the caller wrote", async () => {
    const facets = await facetsFor({ query: "pasta", diet: "vegan" });
    expect(facets).toEqual({ diet: "vegan" });
  });

  it("passes each textual restriction under its own name", async () => {
    const facets = await facetsFor({
      query: "pasta",
      diet: "vegan",
      cuisine: "italian",
      meal_type: "dinner",
      difficulty: "easy",
    });
    expect(facets).toEqual({
      diet: "vegan",
      cuisine: "italian",
      meal_type: "dinner",
      difficulty: "easy",
    });
  });

  it("passes each numeric restriction as the string of its own figure", async () => {
    const facets = await facetsFor({
      query: "pasta",
      max_total_minutes: 45,
      max_calories: 500,
      min_servings: 4,
      min_rating: 4.5,
    });
    expect(facets).toEqual({
      max_total_minutes: "45",
      max_calories: "500",
      min_servings: "4",
      min_rating: "4.5",
    });
  });

  it("passes all eight restrictions in the one call", async () => {
    const { calls, client } = recordingClient();
    await runSearchRecipes(client, {
      query: "pasta",
      diet: "vegan",
      cuisine: "italian",
      meal_type: "dinner",
      difficulty: "easy",
      max_total_minutes: 45,
      max_calories: 500,
      min_servings: 4,
      min_rating: 4.5,
    } as ToolArgs);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options?.facets).toEqual({
      diet: "vegan",
      cuisine: "italian",
      meal_type: "dinner",
      difficulty: "easy",
      max_total_minutes: "45",
      max_calories: "500",
      min_servings: "4",
      min_rating: "4.5",
    });
  });

  it("leaves out a restriction whose value was handed in as undefined", async () => {
    const facets = await facetsFor({
      query: "pasta",
      diet: undefined,
      cuisine: "italian",
      max_total_minutes: undefined,
    });
    expect(Object.keys(facets)).toEqual(["cuisine"]);
    expect(facets).not.toHaveProperty("diet");
    expect(facets).not.toHaveProperty("max_total_minutes");
    expect(Object.values(facets)).not.toContain("undefined");
  });

  it("sends an empty set of facets when nothing was restricted", async () => {
    const { calls, client } = recordingClient();
    await runSearchRecipes(client, { query: "pasta" } as ToolArgs);
    expect(calls).toHaveLength(1);
    const options = calls[0]?.options ?? {};
    expect(options.facets).toEqual({});
    expect(options).not.toHaveProperty("limit");
    expect(options).not.toHaveProperty("page");
    expect(options).not.toHaveProperty("sort");
  });

  it("names a restriction with the tool's argument rather than the site's parameter", async () => {
    const facets = await facetsFor({ query: "pasta", max_total_minutes: 30 });
    expect(Object.keys(facets)).toEqual(["max_total_minutes"]);
    expect(facets).not.toHaveProperty("totalTime");
    expect(facets).not.toHaveProperty("ratings");
    expect(facets).not.toHaveProperty("servings");
    expect(facets).not.toHaveProperty("calories");
  });

  it("can pass exactly the restrictions its input schema declares", async () => {
    const declared = Object.keys(searchRecipesInput).filter(
      (name) => !NON_RESTRICTIONS.includes(name),
    );
    expect(declared.length).toBeGreaterThan(0);

    const shapes = searchRecipesInput as Record<
      string,
      { safeParse: (value: unknown) => { success: boolean } } | undefined
    >;
    const args: Record<string, unknown> = { query: "pasta" };
    for (const name of declared) {
      // A figure stands in for a numeric restriction and a word for a textual
      // one, so the set of names holds even when a new restriction appears.
      args[name] = shapes[name]?.safeParse(3).success === true ? 3 : "value";
    }

    const facets = await facetsFor(args);
    expect(Object.keys(facets).sort()).toEqual([...declared].sort());
  });
});
