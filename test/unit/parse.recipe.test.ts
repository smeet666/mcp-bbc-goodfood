/**
 * Reading a recipe page.
 *
 * A recipe page carries everything the server renders inside a single
 * `__NEXT_DATA__` block, so every payload here is written as the document the
 * site serves rather than as the object it holds. What the site leaves out, the
 * site is entitled to leave out: each field states its own absence rather than
 * borrowing a zero or an empty string to stand for one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecipe } from "../../src/bbcgoodfood/parse.js";
import { GoodFoodError } from "../../src/errors.js";
import type { IngredientGroup, NutritionFact, Recipe, RecipeIngredient } from "../../src/types.js";

const ID = "recipes/chicken-chorizo-jambalaya";

/** The document the site serves, with its data block carrying `script`. */
const documentCarrying = (script: string): string =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head><title>Chicken &amp; chorizo jambalaya</title></head>",
    '<body><div id="__next"></div>',
    `<script id="__NEXT_DATA__" type="application/json">${script}</script>`,
    "</body></html>",
  ].join("");

const pageOf = (pageProps: Record<string, unknown>): string =>
  documentCarrying(JSON.stringify({ props: { pageProps } }));

const oliveOil: Record<string, unknown> = {
  metricQuantity: 1,
  metricUnit: "tbsp",
  ingredientText: "olive oil",
  quantityText: "1 tbsp",
  term: { slug: "olive-oil", display: "olive oil" },
};

const htmlStep = (value: string, name?: string): Record<string, unknown> => ({
  type: "step",
  ...(name === undefined ? {} : { name }),
  content: [{ type: "html", data: { value } }],
});

/** A page carrying every field the site publishes, before a case changes one. */
const wholePage = (): Record<string, unknown> => ({
  title: "Chicken & chorizo jambalaya",
  description: "<p>A one-pan rice dish with smoked paprika.</p>",
  servings: "Serves 4",
  cookAndPrepTime: {
    preparationMin: 0,
    preparationMax: 600,
    cookingMin: 0,
    cookingMax: 2700,
    total: 3300,
    note: "",
  },
  skillLevel: "Easy",
  isPremium: false,
  diet: [
    { slug: "gluten-free", display: "Gluten-free" },
    { slug: "dairy-free", display: "Dairy-free" },
  ],
  authors: [{ name: "Wren Holloway", bio: "Cook and writer" }],
  userRatings: { avg: 4.75, total: 3073 },
  ingredients: [{ heading: "For the rice", ingredients: [oliveOil] }],
  methodSteps: [htmlStep("<p>Heat the oil in a large pan.</p>")],
  nutritions: [{ label: "kcal", value: 494, unit: "" }],
  nutritionalInfoCaption: "Nutrition: per serving",
});

/** The recipe a page renders, and the lines the parser set aside, named. */
const parseFrom = (overrides: Record<string, unknown>): { recipe: Recipe; skipped: string[] } =>
  parseRecipe(pageOf({ ...wholePage(), ...overrides }), ID);

const recipeFrom = (overrides: Record<string, unknown>): Recipe => parseFrom(overrides).recipe;

/** The groups a page of ingredient groups renders. */
const groupsFrom = (groups: unknown[]): IngredientGroup[] =>
  recipeFrom({ ingredients: groups }).ingredients;

/** The lines of a single unnamed group. */
const linesFrom = (lines: unknown[]): RecipeIngredient[] => {
  const groups = groupsFrom([{ ingredients: lines }]);
  expect(groups).toHaveLength(1);
  return groups[0]?.ingredients ?? [];
};

const onlyLine = (line: Record<string, unknown>): RecipeIngredient => {
  const lines = linesFrom([line]);
  expect(lines).toHaveLength(1);
  const first = lines[0];
  if (first === undefined) {
    throw new Error("the page carries one readable ingredient");
  }
  return first;
};

const stepsFrom = (steps: unknown[]): string[] => recipeFrom({ methodSteps: steps }).steps;

const codeThrownBy = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GoodFoodError);
    return (error as GoodFoodError).code;
  }
  throw new Error("the page was expected to be refused");
};

/**
 * A composed line carries no punctuation the site did not write: nothing
 * dangles at either end, no separator stands next to another, and no run of
 * spaces marks where an absent field used to sit.
 */
const expectNoOrphanPunctuation = (text: string): void => {
  expect(text, "a composed line does not open on punctuation").not.toMatch(/^[\s,;:.]/);
  expect(text, "a composed line does not close on a separator").not.toMatch(/[\s,;:]$/);
  expect(text, "a composed line holds no doubled separator").not.toMatch(/[,;:]\s*[,;:]/);
  expect(text, "a composed line holds no run of spaces").not.toMatch(/\s\s/);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a recipe page read whole", () => {
  it("renders the fields the site publishes", () => {
    const recipe = recipeFrom({});

    expect(recipe.id).toBe(ID);
    expect(recipe.title).toBe("Chicken & chorizo jambalaya");
    expect(recipe.url).toBe(`https://www.bbcgoodfood.com/${ID}`);
    expect(recipe.premium).toBe(false);
    expect(recipe.difficulty).toBe("Easy");
    expect(recipe.diets).toEqual(["Gluten-free", "Dairy-free"]);
    expect(recipe.author).toBe("Wren Holloway");
    expect(recipe.description).toBe("A one-pan rice dish with smoked paprika.");
  });

  it("sets nothing aside on a page whose every line reads", () => {
    expect(parseFrom({}).skipped).toEqual([]);
  });

  it("renders an ingredient whole, in the shape the type declares", () => {
    const expected: RecipeIngredient = {
      text: "1 tbsp olive oil",
      amount: 1,
      unit: "tbsp",
      item: "olive oil",
      note: null,
      term: "olive oil",
    };

    expect(onlyLine(oliveOil)).toEqual(expected);
  });
});

describe("the quantity of an ingredient", () => {
  it("renders a metric quantity that is a finite number", () => {
    expect(onlyLine({ ...oliveOil, metricQuantity: 2.5 }).amount).toBe(2.5);
  });

  const unusable: { name: string; quantity: unknown }[] = [
    { name: "zero", quantity: 0 },
    { name: "absent", quantity: undefined },
    { name: "null", quantity: null },
    { name: "a string", quantity: "2" },
    { name: "not a number", quantity: Number.NaN },
    { name: "infinite", quantity: Number.POSITIVE_INFINITY },
  ];

  for (const { name, quantity } of unusable) {
    it(`renders no quantity when the site publishes ${name}`, () => {
      expect(onlyLine({ ...oliveOil, metricQuantity: quantity }).amount).toBeNull();
    });
  }

  it("keeps the written quantity in the line even with no number to render", () => {
    const line = onlyLine({ ...oliveOil, metricQuantity: 0, quantityText: "1 tbsp" });

    expect(line.amount).toBeNull();
    expect(line.text).toBe("1 tbsp olive oil");
  });
});

describe("the unit of an ingredient", () => {
  it("renders the unit as the site writes it", () => {
    expect(onlyLine({ ...oliveOil, metricUnit: "tbsp" }).unit).toBe("tbsp");
  });

  const unusable: { name: string; unit: unknown }[] = [
    { name: "absent", unit: undefined },
    { name: "empty", unit: "" },
    { name: "null", unit: null },
  ];

  for (const { name, unit } of unusable) {
    it(`renders no unit when the site publishes ${name}`, () => {
      expect(onlyLine({ ...oliveOil, metricUnit: unit }).unit).toBeNull();
    });
  }

  it("renders a count with no unit, which is what the site publishes", () => {
    const line = onlyLine({
      metricQuantity: 1,
      ingredientText: "red pepper",
      quantityText: "1",
      term: { slug: "red-pepper", display: "red pepper" },
    });

    expect(line.amount).toBe(1);
    expect(line.unit).toBeNull();
    expect(line.item).toBe("red pepper");
    expect(line.text).toBe("1 red pepper");
  });
});

describe("a line the parser cannot name", () => {
  const unusable: { name: string; text: unknown }[] = [
    { name: "absent", text: undefined },
    { name: "empty", text: "" },
    { name: "only spaces", text: "   " },
    { name: "null", text: null },
    { name: "a number", text: 3 },
  ];

  for (const { name, text } of unusable) {
    it(`sets aside a line whose ingredient text is ${name}`, () => {
      const lines = linesFrom([{ ...oliveOil, ingredientText: text }, oliveOil]);

      expect(lines).toHaveLength(1);
      expect(lines[0]?.item).toBe("olive oil");
    });
  }

  it("sets aside an entry that is not an object", () => {
    expect(linesFrom(["1 tbsp olive oil", null, 4, oliveOil])).toHaveLength(1);
  });

  it("names every line it set aside", () => {
    const { recipe, skipped } = parseFrom({
      ingredients: [{ ingredients: [{ ...oliveOil, ingredientText: "" }, oliveOil] }],
    });

    expect(recipe.ingredients[0]?.ingredients).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped.join(" ")).toMatch(/ingredient/i);
  });
});

describe("the line as the site composes it", () => {
  it("carries the quantity, the ingredient and the remark, in that order", () => {
    const line = onlyLine({
      metricQuantity: 1,
      ingredientText: "red pepper",
      note: "thinly sliced",
      quantityText: "1",
      term: { slug: "red-pepper", display: "red pepper" },
    });

    expect(line.note).toBe("thinly sliced");
    expect(line.text.indexOf("1")).toBeLessThan(line.text.indexOf("red pepper"));
    expect(line.text.indexOf("red pepper")).toBeLessThan(line.text.indexOf("thinly sliced"));
    expect(line.text.startsWith("1 red pepper")).toBe(true);
    expect(line.text.endsWith("thinly sliced")).toBe(true);
    expectNoOrphanPunctuation(line.text);
  });

  it("carries the quantity and the ingredient when there is no remark", () => {
    const line = onlyLine({ ...oliveOil, note: undefined });

    expect(line.note).toBeNull();
    expect(line.text).toBe("1 tbsp olive oil");
    expectNoOrphanPunctuation(line.text);
  });

  it("opens on the ingredient when the site writes no quantity", () => {
    const line = onlyLine({
      ingredientText: "sea salt",
      note: "to taste",
      term: { slug: "sea-salt", display: "sea salt" },
    });

    expect(line.amount).toBeNull();
    expect(line.text.startsWith("sea salt")).toBe(true);
    expect(line.text.endsWith("to taste")).toBe(true);
    expectNoOrphanPunctuation(line.text);
  });

  it("carries the ingredient alone when the site writes neither", () => {
    const line = onlyLine({ ingredientText: "sea salt" });

    expect(line.text).toBe("sea salt");
    expect(line.note).toBeNull();
    expectNoOrphanPunctuation(line.text);
  });

  const blankRemarks: { name: string; note: unknown }[] = [
    { name: "empty", note: "" },
    { name: "only spaces", note: "  " },
    { name: "null", note: null },
    { name: "not a string", note: 7 },
  ];

  for (const { name, note } of blankRemarks) {
    it(`leaves no separator dangling when the remark is ${name}`, () => {
      const line = onlyLine({ ...oliveOil, note });

      expect(line.note).toBeNull();
      expect(line.text).toBe("1 tbsp olive oil");
      expectNoOrphanPunctuation(line.text);
    });
  }

  it("leaves no gap where an absent written quantity would sit", () => {
    const line = onlyLine({ ...oliveOil, quantityText: "" });

    expect(line.text).toBe("olive oil");
    expectNoOrphanPunctuation(line.text);
  });
});

describe("the site's own name for an ingredient", () => {
  it("renders the display of the term", () => {
    expect(onlyLine(oliveOil).term).toBe("olive oil");
  });

  const unusable: { name: string; term: unknown }[] = [
    { name: "absent", term: undefined },
    { name: "null", term: null },
    { name: "a term with no display", term: { slug: "olive-oil" } },
    { name: "a term whose display is empty", term: { slug: "olive-oil", display: "" } },
    { name: "a string", term: "olive-oil" },
  ];

  for (const { name, term } of unusable) {
    it(`renders no term when the site publishes ${name}`, () => {
      expect(onlyLine({ ...oliveOil, term }).term).toBeNull();
    });
  }
});

describe("a group of ingredients", () => {
  it("keeps the heading the site publishes", () => {
    const groups = groupsFrom([
      { heading: "For the rice", ingredients: [oliveOil] },
      { heading: "To serve", ingredients: [{ ingredientText: "sea salt" }] },
    ]);

    expect(groups.map((group: IngredientGroup) => group.heading)).toEqual([
      "For the rice",
      "To serve",
    ]);
  });

  const headless: { name: string; heading: unknown }[] = [
    { name: "absent", heading: undefined },
    { name: "empty", heading: "" },
    { name: "null", heading: null },
  ];

  for (const { name, heading } of headless) {
    it(`stays a group when the heading is ${name}`, () => {
      const groups = groupsFrom([{ heading, ingredients: [oliveOil] }]);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.heading).toBeNull();
      expect(groups[0]?.ingredients).toHaveLength(1);
    });
  }
});

describe("the three times", () => {
  it("renders each upper bound in minutes", () => {
    const recipe = recipeFrom({});

    expect(recipe.prep_minutes).toBe(10);
    expect(recipe.cook_minutes).toBe(45);
    expect(recipe.total_minutes).toBe(55);
  });

  it("reads the upper bound rather than the lower one", () => {
    const recipe = recipeFrom({
      cookAndPrepTime: {
        preparationMin: 300,
        preparationMax: 900,
        cookingMin: 600,
        cookingMax: 1200,
        total: 2100,
      },
    });

    expect(recipe.prep_minutes).toBe(15);
    expect(recipe.cook_minutes).toBe(20);
    expect(recipe.total_minutes).toBe(35);
  });

  it("renders no cooking time where the site publishes a bound of zero", () => {
    const recipe = recipeFrom({
      cookAndPrepTime: { preparationMax: 600, cookingMax: 0, total: 600 },
    });

    expect(recipe.cook_minutes).toBeNull();
    expect(recipe.cook_minutes).not.toBe(0);
    expect(recipe.prep_minutes).toBe(10);
    expect(recipe.total_minutes).toBe(10);
  });

  const unusableBounds: { name: string; bound: unknown }[] = [
    { name: "absent", bound: undefined },
    { name: "null", bound: null },
    { name: "a string", bound: "600" },
    { name: "not a number", bound: Number.NaN },
    { name: "negative", bound: -600 },
  ];

  for (const { name, bound } of unusableBounds) {
    it(`renders no preparation time when the bound is ${name}`, () => {
      const recipe = recipeFrom({
        cookAndPrepTime: { preparationMax: bound, cookingMax: 2700, total: 3300 },
      });

      expect(recipe.prep_minutes).toBeNull();
      expect(recipe.cook_minutes).toBe(45);
    });
  }

  const unreadableBlocks: { name: string; block: unknown }[] = [
    { name: "absent", block: undefined },
    { name: "null", block: null },
    { name: "a string", block: "10 mins" },
    { name: "a number", block: 3300 },
    { name: "an array", block: [600, 2700, 3300] },
    { name: "an object holding no bound", block: { note: "overnight" } },
    { name: "an object whose bounds are strings", block: { preparationMax: "10", total: "55" } },
  ];

  for (const { name, block } of unreadableBlocks) {
    it(`renders all three times empty when the time block is ${name}`, () => {
      const recipe = recipeFrom({ cookAndPrepTime: block });

      expect(recipe.prep_minutes).toBeNull();
      expect(recipe.cook_minutes).toBeNull();
      expect(recipe.total_minutes).toBeNull();
    });
  }
});

describe("what the recipe yields", () => {
  const wordings: { servings: string; count: number | null }[] = [
    { servings: "Serves 4", count: 4 },
    { servings: "Serves 4 - 6", count: 4 },
    { servings: "Makes 12 biscuits", count: 12 },
    { servings: "Serves a crowd", count: null },
  ];

  for (const { servings, count } of wordings) {
    it(`keeps "${servings}" as written and reads ${String(count)} out of it`, () => {
      const recipe = recipeFrom({ servings });

      expect(recipe.yield_text).toBe(servings);
      expect(recipe.yield_count).toBe(count);
    });
  }

  const absent: { name: string; servings: unknown }[] = [
    { name: "absent", servings: undefined },
    { name: "null", servings: null },
    { name: "empty", servings: "" },
    { name: "not a string", servings: 4 },
  ];

  for (const { name, servings } of absent) {
    it(`states no yield when the site publishes ${name}`, () => {
      const recipe = recipeFrom({ servings });

      expect(recipe.yield_text).toBeNull();
      expect(recipe.yield_count).toBeNull();
    });
  }
});

describe("the steps of the method", () => {
  it("renders the text of a step with its tags removed", () => {
    expect(stepsFrom([htmlStep("<p>Heat the <b>oil</b> in a large pan.</p>")])).toEqual([
      "Heat the oil in a large pan.",
    ]);
  });

  it("resolves the entities the site writes and reduces the spaces", () => {
    expect(
      stepsFrom([htmlStep("<p>Stir\n  the   rice &amp; the&nbsp;beans &lt;gently&gt;.</p>")]),
    ).toEqual(["Stir the rice & the beans <gently>."]);
  });

  it("renders a link as its text and never as its address", () => {
    const steps = stepsFrom([
      htmlStep(
        '<p>Add the <a href="https://www.bbcgoodfood.com/recipes/paella">paella rice</a> now.</p>',
      ),
    ]);

    expect(steps).toEqual(["Add the paella rice now."]);
    expect(steps.join(" ")).not.toMatch(/http|href/);
  });

  it("renders the steps in the order the site publishes them", () => {
    expect(stepsFrom([htmlStep("<p>Heat the oil.</p>"), htmlStep("<p>Add the rice.</p>")])).toEqual(
      ["Heat the oil.", "Add the rice."],
    );
  });

  const textless: { name: string; step: unknown }[] = [
    { name: "empty markup", step: htmlStep("") },
    { name: "markup holding no text", step: htmlStep("<p></p><br/>") },
    { name: "only spaces", step: htmlStep("<p>  &nbsp; </p>") },
    { name: "no content at all", step: { type: "step" } },
    { name: "content that is not a list", step: { type: "step", content: "Heat the oil." } },
    { name: "not an object", step: "Heat the oil." },
  ];

  for (const { name, step } of textless) {
    it(`sets aside a step that is ${name}`, () => {
      expect(stepsFrom([step, htmlStep("<p>Add the rice.</p>")])).toEqual(["Add the rice."]);
    });
  }

  it("names every step it set aside", () => {
    const { recipe, skipped } = parseFrom({
      methodSteps: [htmlStep("<p></p>"), htmlStep("<p>Serve.</p>")],
    });

    expect(recipe.steps).toEqual(["Serve."]);
    expect(skipped).toHaveLength(1);
    expect(skipped.join(" ")).toMatch(/step/i);
  });

  it("opens a step with the heading the site gives it, followed by a colon", () => {
    expect(stepsFrom([htmlStep("<p>Heat the oil.</p>", "STEP 1")])).toEqual([
      "STEP 1: Heat the oil.",
    ]);
  });

  const blankNames: { name: string; heading: unknown }[] = [
    { name: "absent", heading: undefined },
    { name: "empty", heading: "" },
    { name: "only spaces", heading: "  " },
    { name: "null", heading: null },
  ];

  for (const { name, heading } of blankNames) {
    it(`opens on the text itself when the heading is ${name}`, () => {
      const steps = stepsFrom([{ ...htmlStep("<p>Heat the oil.</p>"), name: heading }]);

      expect(steps).toEqual(["Heat the oil."]);
      expect(steps[0]).not.toMatch(/^:|^\s/);
    });
  }
});

describe("the rating of a recipe", () => {
  it("renders the rating and the count the site publishes", () => {
    const recipe = recipeFrom({});

    expect(recipe.rating).toBe(4.75);
    expect(recipe.rating_count).toBe(3073);
  });

  it("renders no rating when nobody has voted, and keeps the zero count", () => {
    const recipe = recipeFrom({ userRatings: { avg: 0, total: 0 } });

    expect(recipe.rating).toBeNull();
    expect(recipe.rating_count).toBe(0);
  });

  it("renders no rating when the value is zero, whatever the count", () => {
    const recipe = recipeFrom({ userRatings: { avg: 0, total: 12 } });

    expect(recipe.rating).toBeNull();
    expect(recipe.rating_count).toBe(12);
  });

  it("renders no rating when no voter is counted, whatever the value", () => {
    const recipe = recipeFrom({ userRatings: { avg: 4.5, total: 0 } });

    expect(recipe.rating).toBeNull();
    expect(recipe.rating_count).toBe(0);
  });

  const unusable: { name: string; ratings: unknown }[] = [
    { name: "absent", ratings: undefined },
    { name: "null", ratings: null },
    { name: "a number", ratings: 4.5 },
    { name: "a block with no count", ratings: { avg: 4.5 } },
    { name: "a block whose count is a string", ratings: { avg: 4.5, total: "many" } },
  ];

  for (const { name, ratings } of unusable) {
    it(`renders both fields empty when the ratings block is ${name}`, () => {
      const recipe = recipeFrom({ userRatings: ratings });

      expect(recipe.rating).toBeNull();
      expect(recipe.rating_count).toBeNull();
    });
  }
});

describe("the nutrition the site publishes", () => {
  it("repeats each fact with the site's own wording", () => {
    const expected: NutritionFact[] = [
      { label: "kcal", value: 494, unit: "" },
      { label: "fat", value: 21, unit: "g" },
      { label: "saturates", value: 6, unit: "g" },
    ];

    expect(
      recipeFrom({
        nutritions: [
          { label: "kcal", value: 494, unit: "", additionalText: "", low: false, high: false },
          { label: "fat", value: 21, unit: "g" },
          { label: "saturates", value: 6, unit: "g" },
        ],
      }).nutrition,
    ).toEqual(expected);
  });

  const unusableValues: { name: string; value: unknown }[] = [
    { name: "a word", value: "trace" },
    { name: "absent", value: undefined },
    { name: "null", value: null },
    { name: "not a number", value: Number.NaN },
  ];

  for (const { name, value } of unusableValues) {
    it(`renders no figure when the value is ${name}`, () => {
      const facts = recipeFrom({ nutritions: [{ label: "salt", value, unit: "g" }] }).nutrition;

      expect(facts).toEqual([{ label: "salt", value: null, unit: "g" }]);
    });
  }

  it("renders the empty string where the site writes no unit", () => {
    const facts = recipeFrom({ nutritions: [{ label: "kcal", value: 494 }] }).nutrition;

    expect(facts[0]?.unit).toBe("");
  });

  it("keeps a value of zero, which is a figure the site published", () => {
    const facts = recipeFrom({ nutritions: [{ label: "sugars", value: 0, unit: "g" }] }).nutrition;

    expect(facts[0]?.value).toBe(0);
  });

  const unusableBlocks: { name: string; nutritions: unknown }[] = [
    { name: "absent", nutritions: undefined },
    { name: "null", nutritions: null },
    { name: "not a list", nutritions: { kcal: 494 } },
    { name: "empty", nutritions: [] },
  ];

  for (const { name, nutritions } of unusableBlocks) {
    it(`renders no facts when the nutrition block is ${name}`, () => {
      expect(recipeFrom({ nutritions }).nutrition).toEqual([]);
    });
  }

  it("states the serving the figures are given per, in the site's own wording", () => {
    const caption = "Nutrition: per serving";

    expect(recipeFrom({ nutritionalInfoCaption: caption }).nutrition_per).toBe(caption);
  });

  it("keeps the whole caption rather than the words after the prefix", () => {
    const recipe = recipeFrom({ nutritionalInfoCaption: "Nutrition: per biscuit" });

    expect(recipe.nutrition_per).toBe("Nutrition: per biscuit");
  });

  const silent: { name: string; caption: unknown }[] = [
    { name: "absent", caption: undefined },
    { name: "null", caption: null },
    { name: "empty", caption: "" },
    { name: "only spaces", caption: "   " },
    { name: "not a string", caption: 4 },
  ];

  for (const { name, caption } of silent) {
    it(`states no serving when the caption is ${name}`, () => {
      expect(recipeFrom({ nutritionalInfoCaption: caption }).nutrition_per).toBeNull();
    });
  }
});

describe("the description of a recipe", () => {
  it("renders the text of the markup the site publishes", () => {
    const recipe = recipeFrom({
      description: "<p>A healthy Cajun-inspired rice pot bursting with spicy sausage.</p>",
    });

    expect(recipe.description).toBe(
      "A healthy Cajun-inspired rice pot bursting with spicy sausage.",
    );
  });

  it("resolves the entities the site writes and reduces the spaces", () => {
    const recipe = recipeFrom({
      description: "<p>Chicken &amp; chorizo,\n  cooked   in&nbsp;one pan.</p>",
    });

    expect(recipe.description).toBe("Chicken & chorizo, cooked in one pan.");
  });

  it("renders a link as its text and never as its address", () => {
    const recipe = recipeFrom({
      description:
        '<p>Serve with our <a href="https://www.bbcgoodfood.com/recipes/slaw">crunchy slaw</a>.</p>',
    });

    expect(recipe.description).toBe("Serve with our crunchy slaw.");
    expect(recipe.description ?? "").not.toMatch(/http|href|<|>/);
  });

  const textless: { name: string; description: unknown }[] = [
    { name: "empty", description: "" },
    { name: "markup holding no text", description: "<p></p><br/>" },
    { name: "only spaces", description: "<p>  &nbsp; </p>" },
    { name: "absent", description: undefined },
    { name: "null", description: null },
    { name: "not a string", description: 12 },
  ];

  for (const { name, description } of textless) {
    it(`states no description when the site publishes ${name}`, () => {
      const recipe = recipeFrom({ description });

      expect(recipe.description).toBeNull();
      expect(recipe.description).not.toBe("");
    });
  }
});

describe("a page that carries no readable data block", () => {
  it("refuses a page with no data block at all", () => {
    const html = "<!doctype html><html><body><p>Recipe unavailable.</p></body></html>";

    expect(codeThrownBy(() => parseRecipe(html, ID))).toBe("parse_failure");
  });

  it("refuses an empty document", () => {
    expect(codeThrownBy(() => parseRecipe("", ID))).toBe("parse_failure");
  });

  const unreadable: { name: string; script: string }[] = [
    { name: "is not JSON", script: "not json {" },
    { name: "is empty", script: "" },
    { name: "is a bare word", script: "null" },
    { name: "carries no props", script: '{"query":{"slug":"jambalaya"}}' },
    { name: "carries props with no page props", script: '{"props":{}}' },
    { name: "carries page props that are null", script: '{"props":{"pageProps":null}}' },
    { name: "carries page props that are a string", script: '{"props":{"pageProps":"gone"}}' },
  ];

  for (const { name, script } of unreadable) {
    it(`refuses a data block that ${name}`, () => {
      expect(codeThrownBy(() => parseRecipe(documentCarrying(script), ID))).toBe("parse_failure");
    });
  }

  it("refuses with a GoodFoodError rather than with a bare failure", () => {
    let thrown: unknown;
    try {
      parseRecipe(documentCarrying("not json {"), ID);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(GoodFoodError);
    expect((thrown as GoodFoodError).code).toBe("parse_failure");
  });
});
