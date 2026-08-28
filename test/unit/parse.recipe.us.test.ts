/**
 * Reading the edition the site writes for readers in the United States.
 *
 * The page carries a second rendition of the ingredients, the method and the
 * nutrition, written by the site itself. Its measures live in the line the site
 * composes; the structured quantity beside them stays metric in both editions,
 * which is the one thing a reader of this edition has to be told rather than
 * left to discover.
 */
import { describe, expect, it } from "vitest";
import { parseRecipe } from "../../src/bbcgoodfood/parse.js";
import type { Recipe } from "../../src/types.js";

const ID = "recipes/best-ever-chocolate-brownies-recipe";

const documentCarrying = (script: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head><title>Best ever chocolate brownies</title></head>",
    '<body><div id="__next"></div>',
    `<script id="__NEXT_DATA__" type="application/json">${script}</script>`,
    "</body></html>",
  ].join("");

const pageOf = (pageProps: Record<string, unknown>): string =>
  documentCarrying(JSON.stringify({ props: { pageProps } }));

const htmlStep = (value: string): Record<string, unknown> => ({
  type: "step",
  content: [{ type: "html", data: { value } }],
});

/** The same butter, as each edition writes it. */
const butter = (quantityText: string, ingredientText: string): Record<string, unknown> => ({
  metricQuantity: 185,
  metricUnit: "g",
  quantityText,
  ingredientText,
  term: { slug: "unsalted-butter", display: ingredientText },
});

/** A page carrying both editions, before a case changes one. */
const wholePage = (): Record<string, unknown> => ({
  title: "Best ever chocolate brownies",
  description: "<p>A tray of brownies with a crackled top.</p>",
  servings: "Serves 16",
  cookAndPrepTime: { preparationMax: 900, cookingMax: 1500, total: 2400 },
  skillLevel: "Easy",
  isPremium: false,
  diet: [],
  authors: [{ name: "Wren Holloway" }],
  userRatings: { avg: 4.8, total: 812 },
  hasUSLocalisation: true,
  ingredients: [{ heading: null, ingredients: [butter("185g", "unsalted butter")] }],
  ingredientsUS: [{ heading: null, ingredients: [butter("6 oz", "unsalted butter")] }],
  methodSteps: [htmlStep("<p>Melt the butter in a frying pan.</p>")],
  methodStepsUS: [htmlStep("<p>Melt the butter in a skillet.</p>")],
  nutritions: [{ label: "kcal", value: 494, unit: "" }],
  nutritionsUS: [{ label: "calories", value: 494, unit: "" }],
  nutritionalInfoCaption: "Nutrition: per serving",
});

const recipeFrom = (overrides: Record<string, unknown>): Recipe =>
  parseRecipe(pageOf({ ...wholePage(), ...overrides }), ID).recipe;

const onlyUsLine = (recipe: Recipe) => {
  const line = recipe.us_edition?.ingredients[0]?.ingredients[0];
  if (line === undefined) {
    throw new Error("the page carries one readable line in its US edition");
  }
  return line;
};

describe("the edition written for readers in the United States", () => {
  it("is read from the page alongside the one it restates", () => {
    const recipe = recipeFrom({});

    expect(recipe.ingredients[0]?.ingredients[0]?.text).toBe("185g unsalted butter");
    expect(recipe.us_edition?.ingredients[0]?.ingredients[0]?.text).toBe("6 oz unsalted butter");
  });

  it("carries the method the site rewrote, word for word", () => {
    expect(recipeFrom({}).us_edition?.steps).toEqual(["Melt the butter in a skillet."]);
  });

  it("carries the nutrition under the labels that edition uses", () => {
    expect(recipeFrom({}).us_edition?.nutrition).toEqual([
      { label: "calories", value: 494, unit: "" },
    ]);
  });

  it("keeps the structured quantity metric, because that is what the site publishes", () => {
    // The US list restates the measure in the line and leaves `metricQuantity`
    // alone. Reading 6 into `amount` would put a figure on the page that the
    // page never published, and "6 oz" is the site's own rounding of 185 g
    // rather than the same quantity said differently.
    const line = onlyUsLine(recipeFrom({}));

    expect(line.text).toBe("6 oz unsalted butter");
    expect(line.amount).toBe(185);
    expect(line.unit).toBe("g");
  });

  it("is absent where the site states it publishes none", () => {
    expect(recipeFrom({ hasUSLocalisation: false }).us_edition).toBeNull();
    expect(recipeFrom({ hasUSLocalisation: undefined }).us_edition).toBeNull();
  });

  it("is absent where the site claims it and carries no lines to read", () => {
    // The flag alone is not the edition. Rendering an empty one would answer a
    // request for it with an absence this server made up.
    expect(recipeFrom({ ingredientsUS: undefined }).us_edition).toBeNull();
    expect(recipeFrom({ ingredientsUS: "gone" }).us_edition).toBeNull();
  });

  it("is left empty behind the subscription, exactly as the edition it restates", () => {
    const recipe = recipeFrom({ isPremium: true });

    expect(recipe.ingredients).toEqual([]);
    expect(recipe.steps).toEqual([]);
    expect(recipe.us_edition?.ingredients).toEqual([]);
    expect(recipe.us_edition?.steps).toEqual([]);
    // The nutrition sits in front of the wall on both sides.
    expect(recipe.us_edition?.nutrition).toEqual([{ label: "calories", value: 494, unit: "" }]);
  });

  it("states no nutrition of its own where the page carries none for it", () => {
    expect(recipeFrom({ nutritionsUS: undefined }).us_edition?.nutrition).toEqual([]);
  });

  it("keeps a line it could not read out of the edition, and names it once", () => {
    const { recipe, skipped } = parseRecipe(
      pageOf({
        ...wholePage(),
        ingredientsUS: [{ heading: null, ingredients: [butter("6 oz", "unsalted butter"), 7] }],
      }),
      ID,
    );

    expect(recipe.us_edition?.ingredients[0]?.ingredients).toHaveLength(1);
    expect(skipped).toHaveLength(1);
  });
});
