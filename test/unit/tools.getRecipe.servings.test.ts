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
import type { IngredientGroup, Read, Recipe } from "../../src/types.js";

/** What the site published about the yield, and what was asked of it. */
interface YieldReport {
  original_count: number | null;
  original_text: string | null;
  requested: number | null;
  unit: string | null;
  factor: number | null;
}

/** One ingredient line once the server has recomputed its quantity. */
interface ScaledLine {
  text: string;
  original: string;
  scaling: "scaled" | "rounded" | "unscaled";
  amount: number | null;
  amount_max: number | null;
  unit: string | null;
}

interface ScaledGroup {
  heading: string | null;
  ingredients: ScaledLine[];
}

/** The output the tool publishes, whichever shape its ingredients take. */
type RecipeOutput = Omit<Recipe, "ingredients"> & {
  source: string;
  notes: string[];
  yield: YieldReport;
  ingredients: (IngredientGroup | ScaledGroup)[];
};

const GROUP: IngredientGroup = {
  heading: "For the pan",
  ingredients: [
    { text: "200 g flour", amount: 200, unit: "g", item: "flour", note: null, term: "flour" },
    { text: "3 eggs", amount: 3, unit: null, item: "eggs", note: null, term: "egg" },
    {
      text: "salt, to taste",
      amount: null,
      unit: null,
      item: "salt",
      note: "to taste",
      term: "salt",
    },
  ],
};

function plainRecipe(overrides: Partial<Recipe> = {}): Recipe {
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
    ingredients: [GROUP],
    steps: ["Heat the oil in a large frying pan.", "Stir in the rice and simmer."],
    nutrition: [{ label: "kcal", value: 621, unit: "" }],
    nutrition_per: "serving",
    us_edition: null,
    ...overrides,
  };
}

function premiumRecipe(): Recipe {
  return plainRecipe({
    id: "premium/brown-sugar-pavlova",
    title: "Brown sugar pavlova",
    url: "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
    premium: true,
    ingredients: [],
    steps: [],
  });
}

/** A reader that answers with the recipe a test states, and reaches nowhere. */
function readerOf(recipe: Recipe): GoodFoodClient {
  const stand = {
    getRecipe(_id: string): Promise<Read<Recipe>> {
      return Promise.resolve({ data: recipe, cached: false, skipped: [] });
    },
  };
  return stand as unknown as GoodFoodClient;
}

function args(value: Record<string, unknown>): GetRecipeArgs {
  return value as unknown as GetRecipeArgs;
}

async function outputOf(recipe: Recipe, given: Record<string, unknown>): Promise<RecipeOutput> {
  const result = await runGetRecipe(readerOf(recipe), args({ id: recipe.id, ...given }));
  return result.structuredContent as unknown as RecipeOutput;
}

async function textOf(recipe: Recipe, given: Record<string, unknown>): Promise<string> {
  const result = await runGetRecipe(readerOf(recipe), args({ id: recipe.id, ...given }));
  const blocks = result.content as { type?: string; text?: string }[];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function linesOf(output: RecipeOutput): ScaledLine[] {
  return output.ingredients.flatMap((group) => group.ingredients as ScaledLine[]);
}

describe("the servings argument get_recipe declares", () => {
  it("is among the arguments the tool publishes", () => {
    expect(Object.keys(getRecipeInput)).toContain("servings");
  });

  it("stays optional, so an identifier alone is accepted", () => {
    expect(getRecipeArgs.safeParse({ id: "recipes/chicken-chorizo-jambalaya" }).success).toBe(true);
  });

  const refused: { label: string; value: number }[] = [
    { label: "no serving at all", value: 0 },
    { label: "one past the hundred it stops at", value: 101 },
    { label: "half a serving", value: 2.5 },
  ];

  for (const { label, value } of refused) {
    it(`refuses ${label}`, () => {
      const parsed = getRecipeArgs.safeParse({
        id: "recipes/chicken-chorizo-jambalaya",
        servings: value,
      });

      expect(parsed.success).toBe(false);
      if (parsed.success) {
        return;
      }
      for (const issue of parsed.error.issues) {
        expect(issue.message.startsWith("[invalid_input]")).toBe(true);
      }
    });
  }

  const accepted: number[] = [1, 100];

  for (const value of accepted) {
    it(`accepts ${value}`, () => {
      const parsed = getRecipeArgs.safeParse({
        id: "recipes/chicken-chorizo-jambalaya",
        servings: value,
      });

      expect(parsed.success).toBe(true);
    });
  }

  it("is declared in the shape the tool publishes for its answer", () => {
    expect(Object.keys(getRecipeOutputShape)).toContain("yield");
  });
});

describe("the factor a request establishes", () => {
  const cases: { servings: number; factor: number }[] = [
    { servings: 8, factor: 2 },
    { servings: 2, factor: 0.5 },
    { servings: 4, factor: 1 },
  ];

  for (const { servings, factor } of cases) {
    it(`turns four servings asked as ${servings} into ${factor}`, async () => {
      const output = await outputOf(plainRecipe(), { servings });

      expect(output.yield.factor).toBe(factor);
      expect(output.yield.requested).toBe(servings);
      expect(output.yield.original_count).toBe(4);
    });
  }

  it("carries every field the yield report declares", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });

    expect(Object.keys(output.yield).sort()).toStrictEqual([
      "factor",
      "original_count",
      "original_text",
      "requested",
      "unit",
    ]);
  });

  it("repeats the wording the site wrote", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });

    expect(output.yield.original_text).toBe("Serves 4");
  });

  it("repeats a wording that states a range, without flattening it", async () => {
    const output = await outputOf(plainRecipe({ yield_text: "Serves 4 - 6" }), { servings: 8 });

    expect(output.yield.original_text).toBe("Serves 4 - 6");
    expect(output.yield.original_count).toBe(4);
  });

  it("asks for nothing where the caller asked for nothing", async () => {
    const output = await outputOf(plainRecipe(), {});

    expect(output.yield.requested).toBeNull();
    expect(output.yield.factor).toBeNull();
    expect(output.yield.original_count).toBe(4);
    expect(output.yield.original_text).toBe("Serves 4");
  });
});

describe("the ingredients a request rescales", () => {
  it("keeps the shape the site published where nothing was asked", async () => {
    const recipe = plainRecipe();

    const output = await outputOf(recipe, {});

    expect(output.ingredients).toStrictEqual(recipe.ingredients);
  });

  it("hands back rescaled lines, each carrying the line the site composed", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });

    expect(output.ingredients).toHaveLength(1);
    expect(output.ingredients[0]?.heading).toBe("For the pan");
    for (const line of linesOf(output)) {
      expect(Object.keys(line).sort()).toStrictEqual([
        "amount",
        "amount_max",
        "original",
        "scaling",
        "text",
        "unit",
      ]);
    }
    expect(linesOf(output).map((line) => line.original)).toStrictEqual([
      "200 g flour",
      "3 eggs",
      "salt, to taste",
    ]);
  });

  it("doubles what doubles, and says so", async () => {
    const lines = linesOf(await outputOf(plainRecipe(), { servings: 8 }));

    expect(lines[0]?.amount).toBe(400);
    expect(lines[0]?.scaling).toBe("scaled");
    expect(lines[0]?.text).toMatch(/\b400\b/);
  });

  it("rounds what a kitchen cannot halve, and says so", async () => {
    const lines = linesOf(await outputOf(plainRecipe(), { servings: 2 }));

    expect(lines[1]?.amount).toBe(2);
    expect(lines[1]?.scaling).toBe("rounded");
  });

  it("leaves a line stating no quantity alone", async () => {
    const lines = linesOf(await outputOf(plainRecipe(), { servings: 8 }));

    expect(lines[2]?.scaling).toBe("unscaled");
    expect(lines[2]?.amount).toBeNull();
    expect(lines[2]?.text).toBe("salt, to taste");
  });

  it("survives the shape the tool declares for its answer", async () => {
    const result = await runGetRecipe(
      readerOf(plainRecipe()),
      args({ id: "recipes/chicken-chorizo-jambalaya", servings: 8 }),
    );

    const parsed = z.object(getRecipeOutputShape).parse(result.structuredContent);

    expect(parsed).toStrictEqual(result.structuredContent);
  });
});

describe("a recipe whose yield the site never stated", () => {
  const unstated = (): Recipe => plainRecipe({ yield_text: "Serves a crowd", yield_count: null });

  it("states no factor, since guessing one would invent a figure", async () => {
    const output = await outputOf(unstated(), { servings: 8 });

    expect(output.yield.factor).toBeNull();
    expect(output.yield.original_count).toBeNull();
    expect(output.yield.original_text).toBe("Serves a crowd");
  });

  it("hands the quantities back exactly as the site wrote them", async () => {
    const recipe = unstated();

    const output = await outputOf(recipe, { servings: 8 });

    expect(output.ingredients).toStrictEqual(recipe.ingredients);
  });

  it("says why the request went unanswered", async () => {
    const output = await outputOf(unstated(), { servings: 8 });

    const spoken = output.notes.filter((note) => /yield|serv|portion/i.test(note));
    expect(spoken.length > 0).toBe(true);
    expect(spoken.some((note) => /\bnot\b|\bno\b|could not|cannot|without/i.test(note))).toBe(true);
  });
});

describe("a recipe the subscription holds back", () => {
  it("keeps its ingredients empty and states no factor", async () => {
    const output = await outputOf(premiumRecipe(), { servings: 8 });

    expect(output.ingredients).toStrictEqual([]);
    expect(output.yield.factor).toBeNull();
  });

  it("says the subscription is what stands in the way", async () => {
    const output = await outputOf(premiumRecipe(), { servings: 8 });

    expect(output.notes.some((note) => /subscri/i.test(note))).toBe(true);
  });

  it("survives the shape the tool declares for its answer", async () => {
    const result = await runGetRecipe(
      readerOf(premiumRecipe()),
      args({ id: "premium/brown-sugar-pavlova", servings: 8 }),
    );

    const parsed = z.object(getRecipeOutputShape).parse(result.structuredContent);

    expect(parsed).toStrictEqual(result.structuredContent);
  });
});

describe("the note a rescaled answer carries", () => {
  it("says the figures were worked out here rather than published by the site", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });

    const spoken = output.notes.filter((note) => /scaling/.test(note));
    expect(spoken.length > 0).toBe(true);
    expect(
      spoken.some((note) =>
        /this server|worked out here|calculated here|not (?:the site|published|from the site)|rather than the site/i.test(
          note,
        ),
      ),
    ).toBe(true);
  });

  it("stays away from an answer nobody asked to rescale", async () => {
    const output = await outputOf(plainRecipe(), {});

    expect(output.notes.some((note) => /scaling/.test(note))).toBe(false);
  });
});

describe("what the text beside the structured answer shows", () => {
  it("shows the rescaled quantities rather than the published ones", async () => {
    const text = await textOf(plainRecipe(), { servings: 8 });

    expect(text).toContain("400");
    expect(text).toMatch(/\b6\b/);
    expect(text).toContain("salt, to taste");
  });

  it("shows the published quantities where nothing was asked", async () => {
    const text = await textOf(plainRecipe(), {});

    expect(text).toContain("200 g flour");
    expect(text).not.toContain("400");
  });

  it("renders one line per ingredient the structured answer carries", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });
    const text = await textOf(plainRecipe(), { servings: 8 });

    const rendered = text.split("\n").filter((line) => line.trim().startsWith("- "));
    expect(rendered).toHaveLength(linesOf(output).length);
  });

  it("repeats every published note word for word", async () => {
    const output = await outputOf(plainRecipe(), { servings: 8 });
    const text = await textOf(plainRecipe(), { servings: 8 });

    for (const note of output.notes) {
      expect(text.includes(note)).toBe(true);
    }
  });
});
