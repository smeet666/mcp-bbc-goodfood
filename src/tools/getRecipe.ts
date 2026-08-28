/**
 * The tool that reads one recipe.
 *
 * A recipe behind the site's subscription comes back with everything except its
 * ingredients and its steps. The page carries them, which is exactly why the
 * rule exists: the site put a wall in front of its readers, and reading past it
 * because the bytes happen to be there would make this server the way around it.
 */

import { z } from "zod";
import type { GoodFoodClient } from "../bbcgoodfood/client.js";
import { GoodFoodError } from "../errors.js";
import type { ScaledIngredient } from "../recipe/scale.js";
import { scaleParts } from "../recipe/scale.js";
import type { IngredientGroup, NutritionFact, Recipe } from "../types.js";
import { strictInput } from "./arguments.js";
import { ok, oneLine, SOURCE_NAME, type ToolResult } from "./shared.js";

export const getRecipeDescription =
  "Read one recipe on BBC Good Food: its ingredients, its steps, its times, its rating and its " +
  "nutrition. Pass the 'id' a search_recipes row carries, which is the page's own path. A recipe " +
  "behind the site's subscription comes back with everything except its ingredients and steps, and " +
  "says so: its page on the site is where a subscriber reads it. The site writes many of its recipes " +
  "twice, once for its own readers and once restated for readers in the United States, and " +
  "'unit_system' chooses which of the two to read.";

/** What a page path may not carry, since an id must name a page of this site. */
const ELSEWHERE = /^\/|:|\/\/|(^|\/)\.\.(\/|$)/;

export const getRecipeInput = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !ELSEWHERE.test(value), {
      message: "must be a recipe path on the site, such as recipes/chicken-chorizo-jambalaya",
    })
    .describe("The page's own path, as a search_recipes row carries it."),
  servings: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Put the ingredients to this many people. Quantities are then recomputed by this server, not published by the site, and each line says so under 'scaling'.",
    ),
  unit_system: z
    .enum(["metric", "us"])
    .optional()
    .describe(
      "Which of the site's own two renditions to read: 'metric' as it writes for its own readers, 'us' as it restates for readers in the United States. Both are the site's words. A recipe it restated nowhere comes back as it published it, said in 'unit_system' and in the notes.",
    ),
} as const;

export const getRecipeArgs = strictInput(getRecipeInput);
export type GetRecipeArgs = z.infer<typeof getRecipeArgs>;

const scaledSchema = z.object({
  text: z.string().describe("The line as it now reads."),
  original: z.string().describe("The line as the site composes it."),
  scaling: z
    .enum(["scaled", "rounded", "unscaled"])
    .describe(
      "'scaled': the arithmetic landed exactly. 'rounded': the figure moved to stay usable in a kitchen. 'unscaled': the line carried no quantity.",
    ),
  amount: z.number().nullable(),
  amount_max: z.number().nullable(),
  unit: z.string().nullable(),
});

const ingredientSchema = z.object({
  text: z.string().describe("The line as the site composes it."),
  amount: z.number().nullable().describe("Null when the site states no quantity."),
  unit: z.string().nullable(),
  item: z.string().describe("What goes in, without its quantity."),
  note: z.string().nullable().describe("What to do to it beforehand, such as 'thinly sliced'."),
  term: z.string().nullable().describe("The site's own normalised name for it."),
});

export const getRecipeOutputShape = {
  id: z.string(),
  title: z.string(),
  url: z.string().describe("The page. Show this when citing the recipe."),
  premium: z.boolean().describe("True when the recipe sits behind the site's subscription."),
  yield_text: z.string().nullable().describe("The site's own wording, such as 'Serves 4 - 6'."),
  yield_count: z.number().int().nullable().describe("The first whole number of that wording."),
  prep_minutes: z.number().int().nullable(),
  cook_minutes: z.number().int().nullable(),
  total_minutes: z.number().int().nullable(),
  difficulty: z.string().nullable(),
  diets: z.array(z.string()),
  author: z.string().nullable(),
  rating: z.number().nullable().describe("1 to 5. Null when nobody has rated it."),
  rating_count: z.number().int().nullable(),
  description: z.string().nullable(),
  yield: z
    .object({
      original_count: z.number().int().nullable().describe("The servings the site states."),
      original_text: z.string().nullable().describe("The site's own wording for them."),
      requested: z.number().int().nullable().describe("The servings asked for, if any."),
      unit: z.string().nullable(),
      factor: z
        .number()
        .nullable()
        .describe("Null when the site states no servings to scale from."),
    })
    .describe("What the ingredients were put to, and what they were put from."),
  ingredients: z
    .array(
      z.object({
        heading: z.string().nullable(),
        ingredients: z.array(z.union([ingredientSchema, scaledSchema])),
      }),
    )
    .describe("Empty when the recipe sits behind the site's subscription."),
  steps: z.array(z.string()).describe("Empty when the recipe sits behind the site's subscription."),
  nutrition: z.array(
    z.object({ label: z.string(), value: z.number().nullable(), unit: z.string() }),
  ),
  nutrition_per: z.string().nullable().describe("The site's own wording for the serving."),
  unit_system: z
    .enum(["metric", "us"])
    .describe("Which of the site's two renditions this answer carries."),
  source: z.string(),
  notes: z.array(z.string()),
} as const;

const US_FIGURES_NOTE =
  "This is the rendition BBC Good Food writes for readers in the United States: it restates the measure inside each line and renames what the two countries call differently. The figures beside each line under 'amount' and 'unit' stay metric, because that is what the site publishes for both renditions, so a line reading '6 oz' carries 185 g and the two are the site's own rounding of one another.";

const NO_US_EDITION_NOTE =
  "BBC Good Food does not publish a United States rendition of this recipe, so it comes back as the site writes it. Restating its measures here would put figures on the recipe that the site never wrote.";

const SUBSCRIPTION_NOTE =
  "This recipe sits behind the site's subscription, so its ingredients and steps are left to the site: its page is where a subscriber reads them.";

const PREMIUM_SERVINGS_NOTE =
  "The 'servings' argument is left without effect here: this recipe's ingredients sit behind the site's subscription, so there are no ingredients here to put to another number of people.";

/** Why a request for a number of servings did or did not take effect. */
function pickNote(recipe: Recipe, measure: Yield): string {
  if (recipe.premium) {
    return PREMIUM_SERVINGS_NOTE;
  }
  return measure.factor === null ? NO_YIELD_NOTE : RECOMPUTED_NOTE;
}

const NO_YIELD_NOTE =
  "This page states no number of servings, so the ingredients are left exactly as the site publishes them: scaling them would mean inventing the figure they were scaled from.";

const RECOMPUTED_NOTE =
  "These quantities were recomputed by this server, not published by the site. Read 'scaling' on each line: a line marked 'rounded' states a figure a kitchen can work with rather than the exact arithmetic.";

/** What the ingredients were put to, and what they were put from. */
interface Measured {
  original_count: number | null;
  original_text: string | null;
  unit: string | null;
}

/**
 * A factor exists only where a number of servings was asked for, so the two are
 * written as one choice rather than as two fields a reader has to check apart.
 */
type Yield = Measured &
  ({ requested: number | null; factor: null } | { requested: number; factor: number });

/**
 * The multiplication a request for a number of servings asks for.
 *
 * A recipe whose page states no servings has nothing to multiply from, and a
 * recipe behind the subscription has no ingredients to multiply.
 */
/** What a page counts its yield in, or null where its wording names nothing. */
const YIELD_WORD = /\d+\s*(?:-\s*\d+\s*)?([A-Za-z][A-Za-z-]*)/;

/**
 * The word the page counts its yield in.
 *
 * "Serves 4" counts servings, "Makes 12 muffins" counts muffins, and "Cuts into
 * 16 squares" counts squares. Writing "servings" over all three would put a word
 * on the page that the page never used.
 */
function yieldWord(wording: string | null): string | null {
  if (wording === null) {
    return null;
  }
  const found = YIELD_WORD.exec(wording)?.[1];
  if (found !== undefined) {
    return found.toLowerCase();
  }
  return SERVES.test(wording) ? "servings" : null;
}

/** A page that states a number of servings without naming what it counts. */
const SERVES = /\bserves\b/i;

function yieldOf(recipe: Recipe, requested: number | undefined): Yield {
  const asked = requested ?? null;
  const from = recipe.yield_count;
  const measured: Measured = {
    original_count: from,
    original_text: recipe.yield_text,
    unit: yieldWord(recipe.yield_text),
  };
  if (asked === null || from === null || from <= 0 || recipe.premium) {
    return { ...measured, requested: asked, factor: null };
  }
  return { ...measured, requested: asked, factor: asked / from };
}

function scaleGroups(
  groups: readonly IngredientGroup[],
  factor: number,
): { heading: string | null; ingredients: ScaledIngredient[] }[] {
  return groups.map((group) => ({
    heading: group.heading,
    ingredients: group.ingredients.map((line) => scaleParts(line, factor)),
  }));
}

function notesFor(recipe: Recipe, skipped: readonly string[]): string[] {
  const notes: string[] = [];
  if (recipe.premium) {
    notes.push(SUBSCRIPTION_NOTE);
  }
  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} line${skipped.length === 1 ? "" : "s"} of this page could not be read and ${skipped.length === 1 ? "was" : "were"} set aside.`,
    );
  }
  return notes;
}

/** Every ingredient line carries its own text, whatever else it carries. */
interface WrittenGroup {
  heading: string | null;
  ingredients: readonly { text: string }[];
}

/**
 * The yield the rendered quantities answer to.
 *
 * Printing the site's own wording above quantities put to another number of
 * people states a yield those quantities do not serve, and the block is what a
 * text-only client reads.
 */
function yieldLine(recipe: Recipe, measure: Yield): string {
  if (measure.factor === null) {
    return recipe.yield_text ?? "";
  }
  const word = measure.unit ?? "servings";
  const from = recipe.yield_text === null ? "" : `, recomputed from ${recipe.yield_text}`;
  return `Serves ${measure.requested} ${word}${from}`;
}

function renderRecipe(recipe: Recipe, groups: readonly WrittenGroup[], measure: Yield): string {
  const marks = [
    yieldLine(recipe, measure),
    recipe.total_minutes === null ? "" : `${recipe.total_minutes} min`,
    recipe.difficulty ?? "",
    recipe.rating === null ? "" : `${recipe.rating}/5`,
  ].filter((mark) => mark !== "");

  const lines = [oneLine(recipe.title), marks.join(" · "), recipe.url].filter(
    (line) => line !== "",
  );

  for (const group of groups) {
    lines.push("", group.heading === null ? "Ingredients" : oneLine(group.heading));
    lines.push(...group.ingredients.map((line) => `- ${oneLine(line.text)}`));
  }
  if (recipe.steps.length > 0) {
    lines.push("", "Method");
    lines.push(...recipe.steps.map((step, index) => `${index + 1}. ${oneLine(step)}`));
  }
  return lines.join("\n");
}

/** The rendition served, and whether the one asked for was the one available. */
interface Edition {
  system: "metric" | "us";
  ingredients: IngredientGroup[];
  steps: string[];
  nutrition: NutritionFact[];
  note: string | null;
}

/**
 * The rendition an answer carries.
 *
 * Asking for one the site never wrote is the optional filter that fabricates an
 * absence: the recipe exists, so it comes back as the site published it and the
 * answer says which rendition arrived.
 */
function editionOf(recipe: Recipe, asked: "metric" | "us" | undefined): Edition {
  const site = {
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    nutrition: recipe.nutrition,
  };
  if (asked !== "us") {
    return { system: "metric", ...site, note: null };
  }
  if (recipe.us_edition === null) {
    return { system: "metric", ...site, note: NO_US_EDITION_NOTE };
  }
  return { system: "us", ...recipe.us_edition, note: US_FIGURES_NOTE };
}

export async function runGetRecipe(
  client: GoodFoodClient,
  args: GetRecipeArgs,
): Promise<ToolResult> {
  const parsed = getRecipeArgs.safeParse(args);
  if (!parsed.success) {
    throw new GoodFoodError(
      "invalid_input",
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  const read = await client.getRecipe(parsed.data.id);
  const notes = notesFor(read.data, read.skipped ?? []);

  const edition = editionOf(read.data, parsed.data.unit_system);
  if (edition.note !== null) {
    notes.push(edition.note);
  }
  // Everything below reads the rendition that was served, so a yield line, a
  // rendered block and a rescaled quantity all answer to the same one.
  const served: Recipe = {
    ...read.data,
    ingredients: edition.ingredients,
    steps: edition.steps,
    nutrition: edition.nutrition,
  };

  const asked = parsed.data.servings;
  const measure = yieldOf(served, asked);
  if (asked !== undefined) {
    notes.push(pickNote(served, measure));
  }

  const ingredients =
    measure.factor === null ? served.ingredients : scaleGroups(served.ingredients, measure.factor);

  // The other rendition is what the choice was made between, not part of the
  // answer that choice produced.
  const { us_edition: _rendition, ...answer } = served;

  return ok(
    {
      ...answer,
      unit_system: edition.system,
      yield: measure,
      ingredients,
      source: SOURCE_NAME,
      notes,
    },
    renderRecipe(served, ingredients, measure),
    { notes },
  );
}
