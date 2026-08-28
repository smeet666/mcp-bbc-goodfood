/**
 * Choosing between the two editions the site writes.
 *
 * The site publishes its recipes twice: once for its own readers, and once
 * restated for readers in the United States. Both are its own words, so the
 * tool hands over the one it was asked for and never converts between them.
 * A recipe the site restated nowhere is served as it published it, said out
 * loud rather than passed off as the edition that was asked for.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import {
  type GetRecipeArgs,
  getRecipeArgs,
  getRecipeInput,
  getRecipeOutputShape,
  runGetRecipe,
} from "../../src/tools/getRecipe.js";
import type { IngredientGroup, Read, Recipe, UsEdition } from "../../src/types.js";

interface Line {
  text: string;
  amount: number | null;
  unit: string | null;
  scaling?: string;
}

type RecipeOutput = Omit<Recipe, "ingredients"> & {
  source: string;
  notes: string[];
  unit_system: "metric" | "us";
  ingredients: { heading: string | null; ingredients: Line[] }[];
};

const METRIC: IngredientGroup = {
  heading: null,
  ingredients: [
    {
      text: "185g unsalted butter",
      amount: 185,
      unit: "g",
      item: "unsalted butter",
      note: null,
      term: "unsalted butter",
    },
    {
      text: "85g plain flour",
      amount: 85,
      unit: "g",
      item: "plain flour",
      note: null,
      term: "plain flour",
    },
  ],
};

const US_EDITION: UsEdition = {
  ingredients: [
    {
      heading: null,
      ingredients: [
        {
          text: "6 oz unsalted butter",
          amount: 185,
          unit: "g",
          item: "unsalted butter",
          note: null,
          term: "unsalted butter",
        },
        {
          text: "3 oz all-purpose flour",
          amount: 85,
          unit: "g",
          item: "all-purpose flour",
          note: null,
          term: "all-purpose flour",
        },
      ],
    },
  ],
  steps: ["Melt the butter in a skillet."],
  nutrition: [{ label: "calories", value: 494, unit: "" }],
};

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipes/best-ever-chocolate-brownies-recipe",
    title: "Best ever chocolate brownies",
    url: "https://www.bbcgoodfood.com/recipes/best-ever-chocolate-brownies-recipe",
    premium: false,
    yield_text: "Serves 16",
    yield_count: 16,
    prep_minutes: 15,
    cook_minutes: 25,
    total_minutes: 40,
    difficulty: "Easy",
    diets: [],
    author: "Wren Holloway",
    rating: 4.8,
    rating_count: 812,
    description: "A tray of brownies with a crackled top.",
    ingredients: [METRIC],
    steps: ["Melt the butter in a frying pan."],
    nutrition: [{ label: "kcal", value: 494, unit: "" }],
    nutrition_per: "serving",
    us_edition: US_EDITION,
    ...overrides,
  };
}

function readerOf(served: Recipe): GoodFoodClient {
  return {
    getRecipe: (): Promise<Read<Recipe>> =>
      Promise.resolve({ data: served, cached: false, skipped: [] }),
  } as unknown as GoodFoodClient;
}

const args = (value: Record<string, unknown>): GetRecipeArgs => value as unknown as GetRecipeArgs;

async function outputOf(
  served: Recipe,
  given: Record<string, unknown> = {},
): Promise<RecipeOutput> {
  const result = await runGetRecipe(readerOf(served), args({ id: served.id, ...given }));
  return result.structuredContent as unknown as RecipeOutput;
}

async function textOf(served: Recipe, given: Record<string, unknown> = {}): Promise<string> {
  const result = await runGetRecipe(readerOf(served), args({ id: served.id, ...given }));
  const blocks = result.content as { type?: string; text?: string }[];
  return blocks.map((block) => block.text ?? "").join("\n");
}

const linesOf = (output: RecipeOutput): Line[] =>
  output.ingredients.flatMap((group) => group.ingredients);

describe("the unit_system argument get_recipe declares", () => {
  it("is among the arguments the tool publishes", () => {
    expect(Object.keys(getRecipeInput)).toContain("unit_system");
  });

  it("takes the two editions the site writes, and nothing else", () => {
    expect(getRecipeArgs.safeParse({ id: "recipes/a", unit_system: "metric" }).success).toBe(true);
    expect(getRecipeArgs.safeParse({ id: "recipes/a", unit_system: "us" }).success).toBe(true);
    expect(getRecipeArgs.safeParse({ id: "recipes/a", unit_system: "imperial" }).success).toBe(
      false,
    );
  });

  it("opens its refusal with the code a caller branches on", () => {
    const refusal = getRecipeArgs.safeParse({ id: "recipes/a", unit_system: "cups" });

    expect(refusal.success).toBe(false);
    expect(refusal.error?.issues[0]?.message.startsWith("[invalid_input]")).toBe(true);
  });

  it("is named in the output, so an answer says which edition it is", () => {
    expect(Object.keys(getRecipeOutputShape)).toContain("unit_system");
    const shape = z.object(getRecipeOutputShape);

    expect(shape.shape.unit_system.safeParse("us").success).toBe(true);
    expect(shape.shape.unit_system.safeParse("british").success).toBe(false);
  });
});

describe("what each edition answers with", () => {
  it("serves the site's own edition when nothing is asked for", async () => {
    const output = await outputOf(recipe());

    expect(output.unit_system).toBe("metric");
    expect(linesOf(output).map((line) => line.text)).toEqual([
      "185g unsalted butter",
      "85g plain flour",
    ]);
    expect(output.steps).toEqual(["Melt the butter in a frying pan."]);
    expect(output.nutrition).toEqual([{ label: "kcal", value: 494, unit: "" }]);
  });

  it("serves the restated one when it is", async () => {
    const output = await outputOf(recipe(), { unit_system: "us" });

    expect(output.unit_system).toBe("us");
    expect(linesOf(output).map((line) => line.text)).toEqual([
      "6 oz unsalted butter",
      "3 oz all-purpose flour",
    ]);
    expect(output.steps).toEqual(["Melt the butter in a skillet."]);
    expect(output.nutrition).toEqual([{ label: "calories", value: 494, unit: "" }]);
  });

  it("says that the figures beside the lines stayed metric", async () => {
    const output = await outputOf(recipe(), { unit_system: "us" });

    expect(linesOf(output).map((line) => [line.amount, line.unit])).toEqual([
      [185, "g"],
      [85, "g"],
    ]);
    expect(output.notes.join(" ")).toContain("metric");
  });

  it("renders the edition it served, not the one beside it", async () => {
    const said = await textOf(recipe(), { unit_system: "us" });

    expect(said).toContain("6 oz unsalted butter");
    expect(said).not.toContain("185g");
    expect(said).toContain("skillet");
  });
});

describe("a recipe the site restated nowhere", () => {
  it("comes back as the site publishes it, rather than as an absence", async () => {
    const output = await outputOf(recipe({ us_edition: null }), { unit_system: "us" });

    expect(output.unit_system).toBe("metric");
    expect(linesOf(output).map((line) => line.text)).toEqual([
      "185g unsalted butter",
      "85g plain flour",
    ]);
  });

  it("says which edition it fell back to, and why", async () => {
    const output = await outputOf(recipe({ us_edition: null }), { unit_system: "us" });

    expect(output.notes.some((note) => note.includes("does not publish"))).toBe(true);
  });

  it("stays silent about the rendition nobody asked for", async () => {
    // The note answers a request. Printed on every ordinary read it would be a
    // line about something the caller never brought up.
    const output = await outputOf(recipe({ us_edition: null }));

    expect(output.notes.some((note) => note.includes("does not publish"))).toBe(false);
    expect(output.unit_system).toBe("metric");
  });
});

describe("putting the restated edition to a number of people", () => {
  it("recomputes from the line that edition writes, in the measure it writes it in", async () => {
    const output = await outputOf(recipe(), { unit_system: "us", servings: 32 });

    expect(output.unit_system).toBe("us");
    expect(linesOf(output).map((line) => line.text)).toEqual([
      "12 oz unsalted butter",
      "6 oz all-purpose flour",
    ]);
  });

  it("marks every recomputed line, exactly as the other edition does", async () => {
    const output = await outputOf(recipe(), { unit_system: "us", servings: 32 });

    expect(linesOf(output).every((line) => line.scaling !== undefined)).toBe(true);
  });

  it("leaves the subscription's recipe without ingredients in either edition", async () => {
    const walled = recipe({
      premium: true,
      ingredients: [],
      steps: [],
      us_edition: { ingredients: [], steps: [], nutrition: US_EDITION.nutrition },
    });
    const output = await outputOf(walled, { unit_system: "us" });

    expect(output.ingredients).toEqual([]);
    expect(output.steps).toEqual([]);
    expect(output.unit_system).toBe("us");
  });
});
