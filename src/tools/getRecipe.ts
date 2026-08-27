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
import type { IngredientGroup, Recipe } from "../types.js";
import { strictInput } from "./arguments.js";
import { ok, oneLine, SOURCE_NAME, type ToolResult } from "./shared.js";

export const getRecipeDescription =
  "Read one recipe on BBC Good Food: its ingredients, its steps, its times, its rating and its " +
  "nutrition. Pass the 'id' a search_recipes row carries, which is the page's own path. A recipe " +
  "behind the site's subscription comes back with everything except its ingredients and steps, and " +
  "says so: its page on the site is where a subscriber reads it.";

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
  source: z.string(),
  notes: z.array(z.string()),
} as const;

const SUBSCRIPTION_NOTE =
  "This recipe sits behind the site's subscription, so its ingredients and steps are left to the site: its page is where a subscriber reads them.";

const NO_YIELD_NOTE =
  "This page states no number of servings, so the ingredients are left exactly as the site publishes them: scaling them would mean inventing the figure they were scaled from.";

const RECOMPUTED_NOTE =
  "These quantities were recomputed by this server, not published by the site. Read 'scaling' on each line: a line marked 'rounded' states a figure a kitchen can work with rather than the exact arithmetic.";

/** What the ingredients were put to, and what they were put from. */
interface Yield {
  original_count: number | null;
  original_text: string | null;
  requested: number | null;
  unit: string | null;
  factor: number | null;
}

/**
 * The multiplication a request for a number of servings asks for.
 *
 * A recipe whose page states no servings has nothing to multiply from, and a
 * recipe behind the subscription has no ingredients to multiply.
 */
function yieldOf(recipe: Recipe, requested: number | undefined): Yield {
  const asked = requested ?? null;
  const scalable =
    asked !== null && recipe.yield_count !== null && recipe.yield_count > 0 && !recipe.premium;
  return {
    original_count: recipe.yield_count,
    original_text: recipe.yield_text,
    requested: asked,
    unit: recipe.yield_count === null ? null : "servings",
    factor: scalable && recipe.yield_count !== null ? asked / recipe.yield_count : null,
  };
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

function renderRecipe(recipe: Recipe, groups: readonly WrittenGroup[]): string {
  const marks = [
    recipe.yield_text ?? "",
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
  const recipe = read.data;
  const notes = notesFor(recipe, read.skipped ?? []);

  const asked = parsed.data.servings;
  const measure = yieldOf(recipe, asked);
  if (asked !== undefined && !recipe.premium) {
    notes.push(measure.factor === null ? NO_YIELD_NOTE : RECOMPUTED_NOTE);
  }

  const ingredients =
    measure.factor === null ? recipe.ingredients : scaleGroups(recipe.ingredients, measure.factor);

  return ok(
    { ...recipe, yield: measure, ingredients, source: SOURCE_NAME, notes },
    renderRecipe(recipe, ingredients),
    { notes },
  );
}
