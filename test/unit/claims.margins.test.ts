import { describe, expect, it } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";
import type { Recipe } from "../../src/types.js";
import { runGetRecipe } from "../../src/tools/getRecipe.js";

/** A page whose wording states a number and names nothing it counts. */
const BARE_YIELD: Recipe = {
  id: "recipes/cake",
  title: "Cake",
  url: "https://www.bbcgoodfood.com/recipes/cake",
  premium: false,
  yield_text: "4",
  yield_count: 4,
  prep_minutes: null,
  cook_minutes: null,
  total_minutes: null,
  difficulty: null,
  diets: [],
  author: null,
  rating: null,
  rating_count: null,
  description: null,
  ingredients: [{ heading: null, ingredients: [] }],
  steps: [],
  nutrition: [],
  nutrition_per: null,
  us_edition: null,
};

function clientFor(recipe: Recipe): GoodFoodClient {
  const stand = {
    getRecipe: () => Promise.resolve({ data: recipe, cached: false, skipped: [] }),
  };
  return stand as unknown as GoodFoodClient;
}

describe("a page that states a yield without naming what it counts", () => {
  it("falls back to servings in the line it renders, having no word to use", async () => {
    const answer = await runGetRecipe(clientFor(BARE_YIELD), {
      id: "recipes/cake",
      servings: 8,
    });
    const text = answer.content[0]?.text ?? "";

    expect(text).toContain("Serves 8 servings");
    expect((answer.structuredContent as { yield: { unit: string | null } }).yield.unit).toBeNull();
  });
});

describe("a recipe counting servings without wording them", () => {
  it("states the yield asked for and names nothing it was recomputed from", async () => {
    // The type allows a count without the wording it was read out of, and a
    // line naming what it started from would then name nothing.
    const counted: Recipe = { ...BARE_YIELD, yield_text: null, yield_count: 4 };

    const answer = await runGetRecipe(clientFor(counted), { id: "recipes/cake", servings: 8 });
    const text = answer.content[0]?.text ?? "";

    expect(text).toContain("Serves 8 servings");
    expect(text).not.toContain("recomputed from");
  });
});

describe("a search run again after its restrictions were lifted", () => {
  it("carries the lines the second read set aside", async () => {
    const rows = [
      { id: 1, title: "Readable", url: "https://www.bbcgoodfood.com/recipes/readable" },
      { id: 2, title: null, url: "https://www.bbcgoodfood.com/recipes/nameless" },
    ];
    const answers = [
      { searchResults: { items: [], totalItems: 0 } },
      { searchResults: { items: rows, totalItems: 2 } },
    ];
    const client = new GoodFoodClient({
      config: loadConfig({ BGF_MIN_INTERVAL_MS: "0", BGF_LOG_LEVEL: "silent" }),
      logger: createLogger("silent"),
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify(answers.shift() ?? {}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });

    const read = await client.searchRecipes("cake", { facets: { diet: "vegan" } });

    expect(read.data.restrictions_lifted).toStrictEqual(["diet"]);
    expect(read.skipped).toHaveLength(1);
  });
});
