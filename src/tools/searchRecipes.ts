/**
 * The tool that finds recipes.
 *
 * It reports two counts beside the site's own total, because the site answers a
 * term it holds nothing for with a count and a page of rows all the same, and
 * because a row it serves is sometimes missing what it takes to render.
 */

import { z } from "zod";
import type { GoodFoodClient, SearchOptions } from "../bbcgoodfood/client.js";
import { GoodFoodError } from "../errors.js";
import type { SearchReport, SearchRow } from "../types.js";
import { strictInput } from "./arguments.js";
import { ok, oneLine, SOURCE_NAME, type ToolResult } from "./shared.js";

export const searchRecipesDescription =
  "Search recipes on BBC Good Food and return a listing. Narrow it with 'diet', 'cuisine', " +
  "'meal_type', 'difficulty' or a bound such as 'max_total_minutes'; call list_filters first for the " +
  "values each one takes, since the site answers a value it does not know with a count of zero. " +
  "The site ranks rather than filters: it answers a term it holds nothing for with rows all the " +
  "same, so read the titles rather than trusting the count. Each row carries the page to read the " +
  "recipe on.";

/** The largest page the site serves, and the last one its ceiling allows. */
const MAX_LIMIT = 30;
const MAX_PAGE = 334;

export const searchRecipesInput = {
  query: z.string().trim().min(1).max(80).describe("A dish, an ingredient, a technique."),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe("Rows to return. Default 30."),
  page: z.number().int().min(1).max(MAX_PAGE).optional().describe("Which page of rows. Default 1."),
  sort: z
    .enum(["relevant", "rating", "published", "quickest"])
    .optional()
    .describe("How the site orders the rows. Default 'relevant'."),
  diet: z.string().trim().min(1).max(60).optional().describe("A value list_filters publishes."),
  cuisine: z.string().trim().min(1).max(60).optional().describe("A value list_filters publishes."),
  meal_type: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .optional()
    .describe("A value list_filters publishes."),
  difficulty: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .optional()
    .describe("A value list_filters publishes."),
  max_total_minutes: z
    .number()
    .int()
    .min(1)
    .max(1440)
    .optional()
    .describe("Whole recipe, minutes."),
  max_calories: z.number().int().min(1).max(10_000).optional().describe("Per serving."),
  min_servings: z.number().int().min(1).max(50).optional().describe("At least this many servings."),
  min_rating: z.number().min(1).max(5).optional().describe("At least this many stars, 1 to 5."),
  exclude_premium: z
    .boolean()
    .optional()
    .describe(
      "Drop the rows that sit behind the site's subscription. The site offers no such restriction, " +
        "so the rows are removed from the page after it arrives: a page comes back shorter than the " +
        "limit asked for, and a short page is not the end of the results.",
    ),
} as const;

export const searchRecipesArgs = strictInput(searchRecipesInput);
export type SearchRecipesArgs = z.infer<typeof searchRecipesArgs>;

const searchRowSchema = z.object({
  id: z.string().describe("The page's own path. Pass it to get_recipe to read the recipe."),
  title: z.string(),
  url: z.string().describe("The public page. Show this when citing the recipe."),
  image_url: z.string().nullable(),
  rating: z.number().nullable().describe("1 to 5. Null when the site published none."),
  rating_count: z.number().int().nullable(),
  premium: z.boolean().describe("True when the recipe sits behind the site's subscription."),
  total_minutes: z.number().int().nullable().describe("Null when the site states no time."),
  difficulty: z.string().nullable().describe("The site's own wording, such as 'Easy'."),
  author: z.string().nullable(),
});

export const searchRecipesOutputShape = {
  query: z.string(),
  results: z.array(searchRowSchema),
  result_count: z
    .number()
    .int()
    .describe("Rows rendered, after anything unreadable was set aside."),
  total_available: z.number().int().nullable().describe("Recipes the site says the search holds."),
  total_is_ceiling: z
    .boolean()
    .describe(
      "True when the total sits on the most rows one search will serve, so it states a floor.",
    ),
  rows_seen: z.number().int().describe("Rows the site served, before anything was set aside."),
  restrictions_dropped: z
    .array(z.string())
    .describe("Restrictions the site could not answer, dropped so the search could run."),
  premium_dropped: z
    .number()
    .int()
    .describe("Rows removed from this page for sitting behind the site's subscription."),
  source: z.string(),
  notes: z.array(z.string()),
} as const;

const PREMIUM_NOTE =
  "Recipes marked premium sit behind the site's subscription. This listing names them, and their page is where a subscriber reads them.";

const CEILING_NOTE =
  "The total sits on the 10000 rows one search will serve at most, so it states a floor: the real figure is that number or more.";

const SHORT_PAGE_NOTE =
  "A page shortened by that removal is not the end of the results: ask for the next page to see more rows.";

/** What the tool renders, once its own removals are made. */
interface Rendered {
  rows: SearchRow[];
  premiumDropped: number;
  setAside: number;
  limitAsked: number;
}

/** The verb that agrees with a count, since every note here states one. */
function agreeing(count: number): string {
  return count === 1 ? "was" : "were";
}

function notesFor(report: SearchReport, shown: Rendered): string[] {
  const notes: string[] = [];
  if (shown.rows.some((row) => row.premium)) {
    notes.push(PREMIUM_NOTE);
  }
  if (shown.premiumDropped > 0) {
    notes.push(
      `${shown.premiumDropped} of the rows the site served ${agreeing(shown.premiumDropped)} removed from this page for sitting behind the site's subscription.`,
    );
    if (shown.rows.length < shown.limitAsked) {
      // The site cannot narrow on this, so the removal happens after the page
      // arrives and leaves it short. A short page reads as the end of the
      // results, and here it never is.
      notes.push(SHORT_PAGE_NOTE);
    }
  }
  if (report.total_is_ceiling) {
    notes.push(CEILING_NOTE);
  }
  if (report.restrictions_dropped.length > 0) {
    notes.push(
      `The site could not answer these restrictions, so the search ran without them: ${report.restrictions_dropped.join(", ")}.`,
    );
  }
  if (shown.setAside > 0) {
    notes.push(
      `${shown.setAside} of the rows the site served carried no identifier, title or address, and ${agreeing(shown.setAside)} set aside.`,
    );
  }
  return notes;
}

/**
 * One block per row. The title never opens a line, so a recipe named after one
 * of this server's own trailer words cannot be read as one of its lines.
 */
function renderRow(row: SearchReport["results"][number], index: number): string {
  const marks = [
    row.total_minutes === null ? "" : `${row.total_minutes} min`,
    row.difficulty ?? "",
    row.rating === null ? "" : `${row.rating}/5`,
    row.premium ? "premium" : "",
  ].filter((mark) => mark !== "");

  // The separator only earns its place between two things. A row the site
  // states no time, difficulty or rating for would otherwise end on one.
  const detail = marks.length > 0 ? `   id: ${row.id} · ${marks.join(" · ")}` : `   id: ${row.id}`;

  return [`${index + 1}. ${oneLine(row.title)}`, detail, `   ${row.url}`].join("\n");
}

function renderReport(report: SearchReport, shown: Rendered): string {
  const held =
    report.total_available === null
      ? ""
      : ` The site says the search holds ${report.total_available}.`;
  if (shown.rows.length === 0) {
    return `No recipe to show for "${report.query}".${held}`;
  }
  return [
    `${shown.rows.length} recipes for "${report.query}".${held}`,
    ...shown.rows.map(renderRow),
  ].join("\n");
}

/**
 * What is left once this tool has made its own removals.
 *
 * The site offers no way to narrow on the subscription, so the rows are dropped
 * from the page after it arrives, and the page comes back shorter than the limit
 * asked for.
 */
function render(report: SearchReport, excludePremium: boolean, limitAsked: number): Rendered {
  const rows = excludePremium ? report.results.filter((row) => !row.premium) : report.results;
  return {
    rows,
    premiumDropped: report.results.length - rows.length,
    setAside: report.rows_seen - report.results.length,
    limitAsked,
  };
}

export async function runSearchRecipes(
  client: GoodFoodClient,
  args: SearchRecipesArgs,
): Promise<ToolResult> {
  const parsed = searchRecipesArgs.safeParse(args);
  if (!parsed.success) {
    throw new GoodFoodError(
      "invalid_input",
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  const {
    query,
    limit,
    page,
    sort,
    exclude_premium: excludePremium,
    ...restrictions
  } = parsed.data;
  const facets: Record<string, string> = {};
  for (const [name, value] of Object.entries(restrictions)) {
    if (value !== undefined) {
      facets[name] = String(value);
    }
  }

  const options: SearchOptions = {
    ...(limit === undefined ? {} : { limit }),
    ...(page === undefined ? {} : { page }),
    ...(sort === undefined ? {} : { sort }),
    facets,
  };

  const read = await client.searchRecipes(query, options);
  const report = read.data;
  const shown = render(report, excludePremium === true, limit ?? MAX_LIMIT);
  const notes = notesFor(report, shown);

  return ok(
    {
      query,
      results: shown.rows,
      result_count: shown.rows.length,
      total_available: report.total_available,
      total_is_ceiling: report.total_is_ceiling,
      rows_seen: report.rows_seen,
      restrictions_dropped: report.restrictions_dropped,
      premium_dropped: shown.premiumDropped,
      source: SOURCE_NAME,
      notes,
    },
    renderReport(report, shown),
    { notes },
  );
}
