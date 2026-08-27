/**
 * The tool that puts a list of ingredients to a different number of people.
 *
 * It reads nothing on the site. Its arithmetic is this server's own, which is
 * the one thing every answer says out loud: a cook who is told 300 g deserves
 * to know whether the site wrote that figure or whether this server worked it
 * out from another one.
 */

import { z } from "zod";
import { GoodFoodError } from "../errors.js";
import type { ScaledIngredient } from "../recipe/scale.js";
import { scaleLine } from "../recipe/scale.js";
import { strictInput } from "./arguments.js";
import { ok, SOURCE_NAME, type ToolResult } from "./shared.js";

export const scaleIngredientsDescription =
  "Put a list of ingredient lines to a different number of people. Pass 'factor', or else the pair " +
  "'from_servings' and 'to_servings'. Quantities are recomputed by this server and not by the site, " +
  "and every line says under 'scaling' whether the arithmetic landed exactly, whether the figure was " +
  "moved to stay usable in a kitchen, or whether the line carried nothing to multiply.";

/**
 * What a kitchen can want. Beyond these the arithmetic stops being about food:
 * a factor of 1e308 overflows the multiplication, and the caller reads a
 * protocol error where a refusal was owed.
 */
const MIN_FACTOR = 0.001;
const MAX_FACTOR = 1000;

export const scaleIngredientsInput = {
  ingredients: z
    .array(z.string().trim().min(1).max(300))
    .min(1)
    .max(100)
    .describe("The lines to scale, as a recipe writes them, such as '200g plain flour'."),
  factor: z
    .number()
    .finite()
    .min(MIN_FACTOR)
    .max(MAX_FACTOR)
    .optional()
    .describe("What to multiply every quantity by. Pass this or the servings pair, never both."),
  from_servings: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How many people the list feeds as written."),
  to_servings: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("How many people it should feed."),
} as const;

export const scaleIngredientsArgs = strictInput(scaleIngredientsInput);
export type ScaleIngredientsArgs = z.infer<typeof scaleIngredientsArgs>;

const scaledSchema = z.object({
  text: z.string().describe("The line as it now reads."),
  original: z.string().describe("The line as it was given."),
  scaling: z
    .enum(["scaled", "rounded", "unscaled"])
    .describe(
      "'scaled': the arithmetic landed exactly. 'rounded': the figure moved to stay usable in a kitchen. 'unscaled': the line carried no quantity.",
    ),
  amount: z.number().nullable(),
  amount_max: z.number().nullable().describe("The upper bound when the line gives a range."),
  unit: z.string().nullable(),
});

export const scaleIngredientsOutputShape = {
  factor: z.number().describe("What every quantity was multiplied by."),
  ingredients: z.array(scaledSchema),
  scaled_count: z.number().int().describe("Lines whose arithmetic landed exactly."),
  rounded_count: z.number().int().describe("Lines whose figure was moved."),
  unscaled_count: z.number().int().describe("Lines that carried no quantity to multiply."),
  source: z.string(),
  notes: z.array(z.string()),
} as const;

export const RECOMPUTED_NOTE =
  "These quantities were recomputed by this server, not published by the site. Read 'scaling' on each line: a line marked 'rounded' states a figure a kitchen can work with rather than the exact arithmetic.";

/**
 * Read the factor from whichever pair of arguments states it.
 *
 * Half of the servings pair states nothing on its own, and giving both a factor
 * and a pair states two multiplications with no way to tell which was meant.
 */
function readFactor(args: ScaleIngredientsArgs): number {
  const paired = args.from_servings !== undefined && args.to_servings !== undefined;
  const partial = args.from_servings !== undefined || args.to_servings !== undefined;

  if (args.factor !== undefined) {
    if (partial) {
      throw new GoodFoodError(
        "invalid_input",
        "Pass either 'factor' or the pair 'from_servings' and 'to_servings', not both: together they state two different multiplications.",
      );
    }
    return args.factor;
  }
  if (paired && args.from_servings !== undefined && args.to_servings !== undefined) {
    return args.to_servings / args.from_servings;
  }
  if (partial) {
    throw new GoodFoodError(
      "invalid_input",
      "'from_servings' and 'to_servings' state a factor together and neither states one alone, so both are needed.",
    );
  }
  throw new GoodFoodError(
    "invalid_input",
    "Pass 'factor', or else the pair 'from_servings' and 'to_servings', to say what the list should be scaled by.",
  );
}

/**
 * A factor as the caller gave it.
 *
 * Rounding to two decimals wrote "Scaled by 0" for a factor of 0.004, which is a
 * multiplication nobody asked for and one the lines below it contradict.
 */
function written(factor: number): string {
  const rounded = Math.round(factor * 100) / 100;
  return String(rounded === 0 ? factor : rounded);
}

function render(factor: number, lines: readonly ScaledIngredient[]): string {
  const head = `Scaled by ${written(factor)}`;
  return [head, ...lines.map((line) => `- ${line.text}`)].join("\n");
}

export function runScaleIngredients(args: ScaleIngredientsArgs): ToolResult {
  const parsed = scaleIngredientsArgs.safeParse(args);
  if (!parsed.success) {
    throw new GoodFoodError(
      "invalid_input",
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  const factor = readFactor(parsed.data);
  const lines = parsed.data.ingredients.map((line) => scaleLine(line, factor));
  const notes = [RECOMPUTED_NOTE];

  return ok(
    {
      factor,
      ingredients: lines,
      scaled_count: lines.filter((line) => line.scaling === "scaled").length,
      rounded_count: lines.filter((line) => line.scaling === "rounded").length,
      unscaled_count: lines.filter((line) => line.scaling === "unscaled").length,
      source: SOURCE_NAME,
      notes,
    },
    render(factor, lines),
    { notes },
  );
}
