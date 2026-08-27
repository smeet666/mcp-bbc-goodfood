/**
 * A recipe the site keeps behind its subscription.
 *
 * The page of such a recipe carries its ingredients and its steps in full, so
 * withholding them is a decision this server takes rather than an absence it
 * reports. Every payload here is built with real ingredients and real steps,
 * since a payload without them would prove nothing about the decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecipe } from "../../src/bbcgoodfood/parse.js";
import type { IngredientGroup, Recipe, RecipeIngredient } from "../../src/types.js";

const ID = "premium/brown-sugar-pavlova";

const pageOf = (pageProps: Record<string, unknown>): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head><title>Brown sugar pavlova</title></head>",
    '<body><div id="__next"></div>',
    '<script id="__NEXT_DATA__" type="application/json">',
    JSON.stringify({ props: { pageProps } }),
    "</script>",
    "</body></html>",
  ].join("");

const meringue: Record<string, unknown>[] = [
  {
    metricQuantity: 6,
    ingredientText: "egg whites",
    quantityText: "6",
    term: { slug: "egg-whites", display: "egg whites" },
  },
  {
    metricQuantity: 300,
    metricUnit: "g",
    ingredientText: "light brown soft sugar",
    quantityText: "300g",
    term: { slug: "light-brown-soft-sugar", display: "light brown soft sugar" },
  },
];

const topping: Record<string, unknown>[] = [
  {
    metricQuantity: 400,
    metricUnit: "ml",
    ingredientText: "double cream",
    quantityText: "400ml",
    note: "whipped to soft peaks",
    term: { slug: "double-cream", display: "double cream" },
  },
];

const htmlStep = (value: string): Record<string, unknown> => ({
  type: "step",
  content: [{ type: "html", data: { value } }],
});

/** The page as the site serves it, ingredients and steps included. */
const pavlovaPage = (isPremium: boolean): Record<string, unknown> => ({
  title: "Brown sugar pavlova",
  description: "<p>A pavlova with a <b>caramel</b> edge.</p>",
  servings: "Serves 8",
  cookAndPrepTime: {
    preparationMin: 0,
    preparationMax: 1200,
    cookingMin: 0,
    cookingMax: 5400,
    total: 6600,
    note: "",
  },
  skillLevel: "More effort",
  isPremium,
  diet: [{ slug: "vegetarian", display: "Vegetarian" }],
  authors: [{ name: "Wren Holloway", bio: "Cook and writer" }],
  userRatings: { avg: 4.5, total: 118 },
  ingredients: [
    { heading: "For the meringue", ingredients: meringue },
    { heading: "For the topping", ingredients: topping },
  ],
  methodSteps: [
    htmlStep("<p>Heat the oven to 120C/100C fan/gas 1.</p>"),
    htmlStep("<p>Whisk the egg whites to stiff peaks, then add the sugar.</p>"),
    htmlStep("<p>Bake for 1 hr 30 mins, then leave to cool in the oven.</p>"),
  ],
  nutritions: [
    { label: "kcal", value: 412, unit: "" },
    { label: "fat", value: 22, unit: "g" },
  ],
  nutritionalInfoCaption: "Nutrition: per serving",
});

const parseFrom = (isPremium: boolean): { recipe: Recipe; skipped: string[] } =>
  parseRecipe(pageOf(pavlovaPage(isPremium)), ID);

const parsed = (isPremium: boolean): Recipe => parseFrom(isPremium).recipe;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a page the site marks as premium", () => {
  it("serves none of the ingredients the page carries", () => {
    expect(parsed(true).ingredients).toEqual([]);
  });

  it("serves none of the steps the page carries", () => {
    expect(parsed(true).steps).toEqual([]);
  });

  it("says the recipe sits behind the subscription", () => {
    expect(parsed(true).premium).toBe(true);
  });

  it("names no line as set aside, since none was unreadable", () => {
    expect(parseFrom(true).skipped).toEqual([]);
  });

  it("renders the title and the address of the page", () => {
    const recipe = parsed(true);

    expect(recipe.id).toBe(ID);
    expect(recipe.title).toBe("Brown sugar pavlova");
    expect(recipe.url).toBe(`https://www.bbcgoodfood.com/${ID}`);
  });

  it("renders the three times", () => {
    const recipe = parsed(true);

    expect(recipe.prep_minutes).toBe(20);
    expect(recipe.cook_minutes).toBe(90);
    expect(recipe.total_minutes).toBe(110);
  });

  it("renders the difficulty and the diets", () => {
    const recipe = parsed(true);

    expect(recipe.difficulty).toBe("More effort");
    expect(recipe.diets).toEqual(["Vegetarian"]);
  });

  it("renders the rating, the author and the description", () => {
    const recipe = parsed(true);

    expect(recipe.rating).toBe(4.5);
    expect(recipe.rating_count).toBe(118);
    expect(recipe.author).toBe("Wren Holloway");
    expect(recipe.description).toBe("A pavlova with a caramel edge.");
  });

  it("renders the yield the site states", () => {
    const recipe = parsed(true);

    expect(recipe.yield_text).toBe("Serves 8");
    expect(recipe.yield_count).toBe(8);
  });

  it("renders the nutrition the site publishes", () => {
    const recipe = parsed(true);

    expect(recipe.nutrition).toEqual([
      { label: "kcal", value: 412, unit: "" },
      { label: "fat", value: 22, unit: "g" },
    ]);
    expect(recipe.nutrition_per).toBe("Nutrition: per serving");
  });
});

describe("the same page without the premium mark", () => {
  it("serves the ingredients of every group", () => {
    const groups: IngredientGroup[] = parsed(false).ingredients;

    expect(groups.map((group: IngredientGroup) => group.heading)).toEqual([
      "For the meringue",
      "For the topping",
    ]);
    expect(groups[0]?.ingredients.map((line: RecipeIngredient) => line.item)).toEqual([
      "egg whites",
      "light brown soft sugar",
    ]);
    expect(groups[1]?.ingredients.map((line: RecipeIngredient) => line.item)).toEqual([
      "double cream",
    ]);
  });

  it("serves the steps in the order the page carries them", () => {
    expect(parsed(false).steps).toEqual([
      "Heat the oven to 120C/100C fan/gas 1.",
      "Whisk the egg whites to stiff peaks, then add the sugar.",
      "Bake for 1 hr 30 mins, then leave to cool in the oven.",
    ]);
  });

  it("says the recipe sits in front of the subscription", () => {
    expect(parsed(false).premium).toBe(false);
  });

  it("renders everything else exactly as the premium page does", () => {
    const open = parsed(false);
    const behind = parsed(true);

    expect(open.title).toBe(behind.title);
    expect(open.url).toBe(behind.url);
    expect(open.prep_minutes).toBe(behind.prep_minutes);
    expect(open.cook_minutes).toBe(behind.cook_minutes);
    expect(open.total_minutes).toBe(behind.total_minutes);
    expect(open.difficulty).toBe(behind.difficulty);
    expect(open.diets).toEqual(behind.diets);
    expect(open.rating).toBe(behind.rating);
    expect(open.rating_count).toBe(behind.rating_count);
    expect(open.yield_text).toBe(behind.yield_text);
    expect(open.yield_count).toBe(behind.yield_count);
    expect(open.nutrition).toEqual(behind.nutrition);
    expect(open.nutrition_per).toBe(behind.nutrition_per);
  });
});

describe("a page whose premium mark is not a boolean", () => {
  const marks: { name: string; mark: unknown }[] = [
    { name: "absent", mark: undefined },
    { name: "null", mark: null },
  ];

  for (const { name, mark } of marks) {
    it(`treats a mark that is ${name} as an open recipe`, () => {
      const { recipe } = parseRecipe(pageOf({ ...pavlovaPage(false), isPremium: mark }), ID);

      expect(recipe.premium).toBe(false);
      expect(recipe.steps).toHaveLength(3);
    });
  }
});
