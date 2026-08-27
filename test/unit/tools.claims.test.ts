/**
 * What the four tools are allowed to claim.
 *
 * Every assertion here comes from the contract on the tools' own wording: a
 * description or a note that promises what the data does not carry is a defect
 * of the server, not of its prose. Nothing in this suite reaches the site.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createServer } from "../../src/server.js";
import { runGetRecipe } from "../../src/tools/getRecipe.js";
import { listFiltersOutputShape, runListFilters } from "../../src/tools/listFilters.js";
import { runScaleIngredients, scaleIngredientsArgs } from "../../src/tools/scaleIngredients.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import type {
  FilterGroup,
  FilterOption,
  FilterReport,
  IngredientGroup,
  Read,
  Recipe,
  SearchReport,
  SearchRow,
} from "../../src/types.js";

const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The name this suite holds the server to for the list of restrictions the
 * search let go of before running again. It counts what was lifted, so that is
 * what it is called.
 */
const LIFTED = "restrictions_lifted";

/** Wordings that state the site was unable to answer, which no note may claim. */
const INCAPACITY = /could not|cannot|can't|failed to|did not understand|unable to/i;

interface ToolResultLike {
  content: { type?: string; text?: string }[];
  structuredContent?: unknown;
}

function textOf(result: ToolResultLike): string {
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function structuredOf(result: ToolResultLike): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

function notesOf(result: ToolResultLike): string[] {
  return structuredOf(result)["notes"] as string[];
}

// ---------------------------------------------------------------------------
// search_recipes
// ---------------------------------------------------------------------------

function searchRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: "recipes/lemon-pasta",
    title: "Lemon pasta",
    url: "https://www.bbcgoodfood.com/recipes/lemon-pasta",
    image_url: null,
    rating: 4.2,
    rating_count: 341,
    premium: false,
    total_minutes: 25,
    difficulty: "Easy",
    author: "Wren Holloway",
    ...overrides,
  };
}

/**
 * A page the search served, carrying the list of restrictions the run let go
 * of. Both spellings of that list are set: the tool is the subject here, and it
 * must publish the one the contract names whichever one it reads.
 */
function searchReport(lifted: string[], overrides: Partial<SearchReport> = {}): SearchReport {
  const results = overrides.results ?? [searchRow()];
  const report = {
    query: "pasta",
    results,
    result_count: results.length,
    total_available: 195,
    total_is_ceiling: false,
    rows_seen: results.length,
    [LIFTED]: lifted,
    ...overrides,
  };
  return report as unknown as SearchReport;
}

function searchClient(report: SearchReport): GoodFoodClient {
  return {
    searchRecipes: (): Promise<Read<SearchReport>> =>
      Promise.resolve({ data: report, cached: false }),
  } as unknown as GoodFoodClient;
}

async function searched(report: SearchReport): Promise<ToolResultLike> {
  const pending = runSearchRecipes(searchClient(report), {
    query: "pasta",
  } as unknown as Parameters<typeof runSearchRecipes>[1]);
  const settled = pending.then(
    (value) => () => value,
    (error: unknown) => () => {
      throw error;
    },
  );
  await vi.runAllTimersAsync();
  return (await settled)() as unknown as ToolResultLike;
}

/** The note that names the restrictions the run lifted, or the empty string. */
function liftedNote(notes: string[]): string {
  return notes.find((note) => note.includes("diet") && note.includes("max_total_minutes")) ?? "";
}

describe("a zero the site answered establishes no incapacity", () => {
  const lifted = ["diet", "max_total_minutes"];

  it("publishes the restrictions under the name of what it counts", async () => {
    const structured = structuredOf(await searched(searchReport(lifted)));

    expect(structured[LIFTED]).toStrictEqual(lifted);
  });

  it("no longer publishes them as restrictions the site refused", async () => {
    const structured = structuredOf(await searched(searchReport(lifted)));

    expect(Object.keys(structured)).not.toContain("restrictions_dropped");
  });

  it("names the restrictions it lifted", async () => {
    const note = liftedNote(notesOf(await searched(searchReport(lifted))));

    expect(note).not.toBe("");
  });

  it("claims no incapacity of the site in any note", async () => {
    const notes = notesOf(await searched(searchReport(lifted)));

    for (const note of notes) {
      expect(note).not.toMatch(INCAPACITY);
    }
  });

  it("says the restricted search returned nothing and was run again without them", async () => {
    const note = liftedNote(notesOf(await searched(searchReport(lifted))));

    expect(note).toMatch(/\b(again|second|retried|rerun|ran it again|without)\b/i);
    expect(note).toMatch(/\b(nothing|no result|no recipe|zero|empty)\b/i);
  });

  it("warns that an unknown value and a value holding nothing answer alike", async () => {
    const note = liftedNote(notesOf(await searched(searchReport(lifted))));

    expect(note).toMatch(/does not know|unknown|never heard|not published|unrecognis/i);
    expect(note).toMatch(/same|alike|indistinguishable|either|both/i);
  });

  it("says nothing about lifted restrictions when the run kept them all", async () => {
    const notes = notesOf(await searched(searchReport([])));

    expect(liftedNote(notes)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// list_filters
// ---------------------------------------------------------------------------

function option(value: string, label: string, count: number | null): FilterOption {
  return { value, label, count };
}

function group(name: string, options: FilterOption[]): FilterGroup {
  return { name, label: name, options, option_count: options.length };
}

/** The nine axes the site publishes, each carrying a value it would publish. */
function everyAxis(): FilterGroup[] {
  return [
    group("author", [option("wren-holloway", "Wren Holloway", 12)]),
    group("calories", [option("lt-500", "Under 500", 40)]),
    group("servings", [option("gt-4", "4 or more", 22)]),
    group("totalTime", [option("lt-900", "Under 15 mins", 31)]),
    group("cuisine", [option("british", "British", null)]),
    group("diet", [option("vegetarian", "Vegetarian", 507)]),
    group("difficulty", [option("easy", "Easy", 88)]),
    group("mealType", [option("dinner", "Dinner", 64)]),
    group("ratings", [option("gt-4", "4 stars and up", 71)]),
  ];
}

function filterReport(filters: FilterGroup[]): FilterReport {
  return {
    query: null,
    filters,
    filter_count: filters.length,
    total_available: 151,
    total_is_ceiling: false,
  };
}

function filtersClient(report: FilterReport): GoodFoodClient {
  return {
    listFilters: (): Promise<Read<FilterReport>> =>
      Promise.resolve({ data: report, cached: false }),
  } as unknown as GoodFoodClient;
}

function listed(filters: FilterGroup[]): Promise<ToolResultLike> {
  return runListFilters(
    filtersClient(filterReport(filters)),
    {} as unknown as Parameters<typeof runListFilters>[1],
  ) as unknown as Promise<ToolResultLike>;
}

interface RenderedGroup {
  name: string;
  argument: string | null;
}

async function renderedGroups(filters: FilterGroup[]): Promise<RenderedGroup[]> {
  const structured = structuredOf(await listed(filters));
  return structured["filters"] as RenderedGroup[];
}

/** Every description the output schema states for a property of a given name. */
function describedAs(property: string): string[] {
  const schema = z.toJSONSchema(z.object(listFiltersOutputShape)) as unknown;
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    const record = node as Record<string, unknown>;
    const properties = record["properties"];
    if (properties !== undefined && properties !== null && typeof properties === "object") {
      const target = (properties as Record<string, unknown>)[property];
      if (target !== undefined && target !== null && typeof target === "object") {
        const described = (target as { description?: unknown }).description;
        if (typeof described === "string") {
          found.push(described);
        }
      }
    }
    for (const value of Object.values(record)) {
      walk(value);
    }
  };
  walk(schema);
  return found;
}

describe("list_filters presents an axis as an axis", () => {
  const mapping: [string, string | null][] = [
    ["diet", "diet"],
    ["cuisine", "cuisine"],
    ["mealType", "meal_type"],
    ["difficulty", "difficulty"],
    ["totalTime", "max_total_minutes"],
    ["calories", "max_calories"],
    ["servings", "min_servings"],
    ["ratings", "min_rating"],
    ["author", null],
  ];

  for (const [axis, argument] of mapping) {
    it(`gives ${axis} the argument ${argument ?? "null"}`, async () => {
      const groups = await renderedGroups(everyAxis());
      const rendered = groups.find((candidate) => candidate.name === axis);

      expect(rendered).toBeDefined();
      expect(rendered?.argument).toStrictEqual(argument);
    });
  }

  it("describes name as the site's wording for the axis rather than an argument", () => {
    const descriptions = describedAs("name");

    expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      expect(description).not.toMatch(/\bargument\b/i);
    }
  });

  it("describes value as what the site publishes rather than what to pass back", () => {
    const descriptions = describedAs("value");

    expect(descriptions.length).toBeGreaterThan(0);
    for (const description of descriptions) {
      expect(description).not.toMatch(/\bargument\b/i);
      expect(description).not.toMatch(/pass (?:this |it )?back/i);
    }
  });

  it("warns that a value does not travel into the argument whose unit differs", async () => {
    const notes = notesOf(await listed(everyAxis()));
    const warning = notes.find((note) => /totalTime/.test(note));

    expect(warning).toBeDefined();
    expect(warning ?? "").toMatch(/second|minute/i);
  });

  it("leaves that warning out where no axis published carries one", async () => {
    const notes = notesOf(await listed([group("diet", [option("vegetarian", "Vegetarian", 507)])]));

    expect(notes.some((note) => /totalTime/.test(note))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// get_recipe
// ---------------------------------------------------------------------------

const INGREDIENTS: IngredientGroup[] = [
  {
    heading: null,
    ingredients: [
      { text: "200 g flour", amount: 200, unit: "g", item: "flour", note: null, term: "flour" },
      { text: "3 eggs", amount: 3, unit: null, item: "eggs", note: null, term: "egg" },
    ],
  },
];

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipes/chicken-chorizo-jambalaya",
    title: "Chicken & chorizo jambalaya",
    url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    premium: false,
    yield_text: "Serves 4",
    yield_count: 4,
    prep_minutes: 10,
    cook_minutes: 45,
    total_minutes: 55,
    difficulty: "Easy",
    diets: ["Gluten-free"],
    author: "Wren Holloway",
    rating: 4.75,
    rating_count: 3073,
    description: "A one-pan rice dish.",
    ingredients: INGREDIENTS,
    steps: ["Heat the oil.", "Stir in the rice."],
    nutrition: [{ label: "kcal", value: 621, unit: "" }],
    nutrition_per: "serving",
    ...overrides,
  };
}

function recipeClient(read: Recipe): GoodFoodClient {
  return {
    getRecipe: (): Promise<Read<Recipe>> =>
      Promise.resolve({ data: read, cached: false, skipped: [] }),
  } as unknown as GoodFoodClient;
}

async function readRecipe(read: Recipe, given: Record<string, unknown>): Promise<ToolResultLike> {
  const result = await runGetRecipe(recipeClient(read), {
    id: read.id,
    ...given,
  } as unknown as Parameters<typeof runGetRecipe>[1]);
  return result as unknown as ToolResultLike;
}

describe("the yield the text block writes above converted quantities", () => {
  it("states the yield asked for", async () => {
    const text = textOf(await readRecipe(recipe(), { servings: 10 }));

    expect(text).toMatch(/Serves 10\b/);
  });

  it("names the yield it started from, beside the one it computed", async () => {
    const text = textOf(await readRecipe(recipe(), { servings: 10 }));

    expect(text).toMatch(/Serves 10[^\n]*\bfrom\b[^\n]*Serves 4\b/);
  });

  it("states no yield the converted quantities do not answer to", async () => {
    const text = textOf(await readRecipe(recipe(), { servings: 10 }));
    const spoken = text.split("\n").filter((line) => line.includes("Serves"));

    expect(spoken.length).toBeGreaterThan(0);
    for (const line of spoken) {
      expect(line).toContain("Serves 10");
    }
  });

  it("keeps the site's own yield where nothing was asked", async () => {
    const text = textOf(await readRecipe(recipe(), {}));

    expect(text).toContain("Serves 4");
    expect(text).not.toMatch(/recomputed|recalculated|\bfrom Serves\b/i);
  });
});

describe("the word the yield carries", () => {
  const wordings: [string, number, string | null][] = [
    ["Serves 4", 4, "servings"],
    ["Makes 12 muffins", 12, "muffins"],
    ["Cuts into 16 squares", 16, "squares"],
    ["4", 4, null],
  ];

  for (const [written, count, unit] of wordings) {
    it(`reads ${JSON.stringify(written)} as ${unit ?? "no word"}`, async () => {
      const result = await readRecipe(recipe({ yield_text: written, yield_count: count }), {});
      const reported = structuredOf(result)["yield"] as { unit: string | null };

      expect(reported.unit).toStrictEqual(unit);
    });
  }
});

describe("a recipe the subscription holds back, asked for a different yield", () => {
  it("ties the argument left without effect to the ingredients it has none of", async () => {
    const held = recipe({
      id: "premium/brown-sugar-pavlova",
      url: "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
      premium: true,
      ingredients: [],
      steps: [],
    });

    const notes = notesOf(await readRecipe(held, { servings: 8 }));
    const tied = notes.find((note) => /servings/i.test(note));

    expect(tied).toBeDefined();
    expect(tied ?? "").toMatch(/no ingredient|nothing to (?:convert|scale|rescale)|no quantit/i);
    expect(tied ?? "").toMatch(/no effect|without effect|unused|left alone|nothing to apply/i);
  });
});

// ---------------------------------------------------------------------------
// scale_ingredients
// ---------------------------------------------------------------------------

function parseScale(value: Record<string, unknown>): z.ZodSafeParseResult<unknown> {
  return scaleIngredientsArgs.safeParse(value) as z.ZodSafeParseResult<unknown>;
}

function issueMessages(value: Record<string, unknown>): string[] {
  const parsed = parseScale(value);
  if (parsed.success) {
    throw new Error(`the schema accepted ${JSON.stringify(value)}, which it had to refuse`);
  }
  return parsed.error.issues.map((issue) => issue.message);
}

describe("the bounds a factor is held within", () => {
  const refused: [string, number, string][] = [
    ["a factor a thousandth of the lower bound", 0.0001, "0.001"],
    ["a factor ten times the upper bound", 10_000, "1000"],
  ];

  for (const [wording, factor, bound] of refused) {
    it(`refuses ${wording}`, () => {
      expect(parseScale({ ingredients: ["3 eggs"], factor }).success).toBe(false);
    });

    it(`names ${bound} when refusing ${wording}`, () => {
      const messages = issueMessages({ ingredients: ["3 eggs"], factor });

      expect(messages.some((message) => message.includes(bound))).toBe(true);
    });

    it(`refuses ${wording} as invalid input`, () => {
      const messages = issueMessages({ ingredients: ["3 eggs"], factor });

      for (const message of messages) {
        expect(message.startsWith("[invalid_input]")).toBe(true);
      }
    });
  }

  const accepted: number[] = [0.001, 1000];

  for (const factor of accepted) {
    it(`accepts the bound ${factor}`, () => {
      expect(parseScale({ ingredients: ["3 eggs"], factor }).success).toBe(true);
    });
  }
});

describe("the factor the text block writes back", () => {
  it("writes a factor below a hundredth with enough digits to stay true", () => {
    const result = runScaleIngredients({
      ingredients: ["2000g plain flour"],
      factor: 0.004,
    } as unknown as Parameters<typeof runScaleIngredients>[0]);

    expect(textOf(result as unknown as ToolResultLike)).toContain("0.004");
  });

  it("never writes a factor of zero for a factor nobody gave", () => {
    const result = runScaleIngredients({
      ingredients: ["2000g plain flour"],
      factor: 0.004,
    } as unknown as Parameters<typeof runScaleIngredients>[0]);

    expect(textOf(result as unknown as ToolResultLike)).not.toMatch(/\bby 0\b(?!\.)/);
  });
});

// ---------------------------------------------------------------------------
// Refusals, and what the server keeps
// ---------------------------------------------------------------------------

const forbiddenFetch: typeof fetch = () =>
  Promise.reject(new Error("this suite makes no network request"));

interface CallAnswer {
  isError?: boolean;
  content: { type?: string; text?: string }[];
}

async function withClient<T>(use: (client: Client) => Promise<T>): Promise<T> {
  const server = createServer({ fetchImpl: forbiddenFetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claims", version: "0.0.0" });
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  try {
    return await use(client);
  } finally {
    await client.close();
    await server.close();
  }
}

/** The whole text of whatever scale_ingredients answered, refusal or not. */
async function refusalText(args: Record<string, unknown>): Promise<string> {
  return await withClient(async (client) => {
    let answer: CallAnswer;
    try {
      answer = (await client.callTool({
        name: "scale_ingredients",
        arguments: args,
      })) as CallAnswer;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    expect(answer.isError).toBe(true);
    return answer.content.map((block) => block.text ?? "").join("\n");
  });
}

describe("a refusal names the argument it refused", () => {
  const numeric: [string, Record<string, unknown>][] = [
    ["factor", { ingredients: ["3 eggs"], factor: 0 }],
    ["from_servings", { ingredients: ["3 eggs"], from_servings: 0, to_servings: 4 }],
    ["to_servings", { ingredients: ["3 eggs"], from_servings: 4, to_servings: 0 }],
  ];

  for (const [argument, args] of numeric) {
    it(`writes ${argument} into the message the server composes`, () => {
      for (const message of issueMessages(args)) {
        expect(message).toContain(argument);
      }
    });

    it(`writes ${argument} into what the caller reads back`, async () => {
      expect(await refusalText(args)).toContain(argument);
    });

    it(`writes the code once when refusing ${argument}`, async () => {
      const text = await refusalText(args);

      expect(text.split("[invalid_input]")).toHaveLength(2);
      for (const message of issueMessages(args)) {
        expect(message.split("[invalid_input]")).toHaveLength(2);
      }
    });
  }

  const fromTheTool: [string, Record<string, unknown>][] = [
    ["neither the factor nor the pair", { ingredients: ["3 eggs"] }],
    [
      "both the factor and the pair",
      { ingredients: ["3 eggs"], factor: 2, from_servings: 4, to_servings: 6 },
    ],
  ];

  for (const [wording, args] of fromTheTool) {
    it(`writes the code once when refusing ${wording}`, async () => {
      expect((await refusalText(args)).split("[invalid_input]")).toHaveLength(2);
    });
  }
});

describe("what none of this changes", () => {
  it("keeps the four tools, in the order they are registered", async () => {
    const names = await withClient(async (client) => {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name);
    });

    expect(names).toStrictEqual([
      "list_filters",
      "search_recipes",
      "get_recipe",
      "scale_ingredients",
    ]);
  });

  const worlds: [string, boolean][] = [
    ["list_filters", true],
    ["search_recipes", true],
    ["get_recipe", true],
    ["scale_ingredients", false],
  ];

  for (const [name, open] of worlds) {
    it(`keeps ${name} declaring openWorldHint ${open}`, async () => {
      const hint = await withClient(async (client) => {
        const { tools } = await client.listTools();
        return tools.find((tool) => tool.name === name)?.annotations?.openWorldHint;
      });

      expect(hint).toBe(open);
    });
  }

  it("leaves a count the site published nothing for at null", async () => {
    const structured = structuredOf(
      await searched(searchReport([], { total_available: null, rows_seen: 1 })),
    );

    expect(structured["total_available"]).toBeNull();
  });

  it("closes the text block on the credit, one blank line after the notes", async () => {
    const result = await searched(searchReport(["diet", "max_total_minutes"]));
    const lines = textOf(result).split("\n");
    const last = lines.filter((line) => line.trim() !== "").at(-1) ?? "";

    expect(last).toContain("BBC Good Food");
    expect(lines).toContain("");
  });
});
