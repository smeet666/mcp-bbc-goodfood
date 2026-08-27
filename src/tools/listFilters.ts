/**
 * The tool that publishes what a search can be narrowed by.
 *
 * It exists because the site accepts any value on a facet and answers one it
 * does not know with a total of zero. A caller who guesses a spelling is told
 * that nothing matches, which is a confident answer to a question the site
 * never understood. Publishing the vocabulary is what makes the question
 * askable.
 */

import { z } from "zod";
import type { GoodFoodClient } from "../bbcgoodfood/client.js";
import { GoodFoodError } from "../errors.js";
import type { FilterGroup, FilterReport } from "../types.js";
import { strictInput } from "./arguments.js";
import { ok, oneLine, SOURCE_NAME, type ToolResult } from "./shared.js";

export const listFiltersDescription =
  "List the axes a recipe search can be narrowed along on BBC Good Food, with the values each one " +
  "takes and how many recipes carry them. Pass 'query' to measure the counts inside one search, or " +
  "leave it out for the site's whole listing. Read this before narrowing a search: the site accepts " +
  "any value on a facet and answers one it does not know with a total of zero, so a guessed spelling " +
  "comes back as a confident absence. The values listed are an excerpt of the most frequent ones, and " +
  "the site accepts others that are not shown.";

export const listFiltersInput = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe(
      "A search to measure the counts inside. The site counts its facets over the rows a search " +
        "returns, so a count without a query describes the whole listing instead.",
    ),
} as const;

/** The declaration the SDK publishes, so an undeclared argument is refused there too. */
export const listFiltersArgs = strictInput(listFiltersInput);

const filterOptionSchema = z.object({
  value: z.string().describe("Pass this back to narrow a search along this axis."),
  label: z.string().describe("The site's own wording for the value."),
  count: z
    .number()
    .int()
    .nullable()
    .describe("Recipes carrying the value within this scope. Null when the site published none."),
});

const filterGroupSchema = z.object({
  name: z.string().describe("The argument name a search takes for this axis."),
  label: z.string().describe("The site's own wording for the axis."),
  options: z.array(filterOptionSchema),
  option_count: z
    .number()
    .int()
    .describe("How many options are listed here, which is not how many the site accepts."),
});

export const listFiltersOutputShape = {
  query: z.string().nullable().describe("The search the counts were measured in, trimmed."),
  filters: z.array(filterGroupSchema),
  filter_count: z.number().int(),
  total_available: z
    .number()
    .int()
    .nullable()
    .describe("Recipes the site says this scope holds. Null when it published no figure."),
  total_is_ceiling: z
    .boolean()
    .describe(
      "True when the total sits on the largest number of rows one search will serve, so it states " +
        "a floor rather than a count.",
    ),
  source: z.string(),
  notes: z.array(z.string()),
} as const;

export type ListFiltersArgs = z.infer<typeof listFiltersArgs>;

/** Every answer carries these, because they qualify every listing. */
const STANDING_NOTES = [
  "The options listed are an excerpt of what the site publishes, being the most frequent values in this scope.",
  "Values that are unlisted here are still accepted by a search, so an absent option does not mean an unusable one.",
];

const CEILING_NOTE =
  "The total sits on the largest number of rows one search will serve, so it states a floor: the real figure is that number or more.";

const NO_FACET_NOTE =
  "The site published no way to narrow this scope, which is what it answered rather than a failure to read it.";

function notesFor(report: FilterReport): string[] {
  const notes = [...STANDING_NOTES];
  if (report.total_is_ceiling) {
    notes.push(CEILING_NOTE);
  }
  // Only when rows were actually served: nothing to weigh is a different
  // statement from nothing weighing up, and only the second is worth a note.
  if (report.filters.length === 0) {
    notes.push(NO_FACET_NOTE);
  }
  return notes;
}

/**
 * One line per axis. Every word of it comes from the report, so a reader of the
 * text block learns nothing the structured payload does not also carry.
 */
function renderGroup(group: FilterGroup): string {
  const head =
    group.label === group.name
      ? oneLine(group.name)
      : `${oneLine(group.name)} (${oneLine(group.label)})`;
  if (group.options.length === 0) {
    return `${head}: no value listed`;
  }
  const values = group.options
    .map((option) =>
      option.count === null ? oneLine(option.value) : `${oneLine(option.value)} ${option.count}`,
    )
    .join(", ");
  return `${head}: ${values}`;
}

function renderReport(report: FilterReport, query: string | null): string {
  const scope = query === null ? "across the site" : `within "${query}"`;
  const held =
    report.total_available === null
      ? ""
      : ` The site says this scope holds ${report.total_available}.`;

  if (report.filters.length === 0) {
    return `No axis is published ${scope}.${held}`;
  }
  return [`Axes ${scope}.${held}`, ...report.filters.map(renderGroup)].join("\n");
}

export async function runListFilters(
  client: GoodFoodClient,
  args: ListFiltersArgs,
): Promise<ToolResult> {
  const parsed = listFiltersArgs.safeParse(args);
  if (!parsed.success) {
    // Raised rather than rendered: the wiring above turns any failure into the
    // one error shape, so a refusal reads the same whichever layer produced it.
    // The message already opens with the code, whichever bound raised it.
    // Every grievance, rather than the first: a call refused on two arguments
    // that names one sends a caller back for a second refusal.
    throw new GoodFoodError(
      "invalid_input",
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }

  // The scope is what this call asked for, trimmed here. Reading it back off
  // the report would repeat whatever the layer below chose to echo.
  const query = parsed.data.query ?? null;
  const read = await client.listFilters(query);
  const report = read.data;
  const notes = notesFor(report);

  return ok(
    {
      query,
      filters: report.filters,
      // Counted here rather than repeated, so the field always states the length
      // of the list it sits beside.
      filter_count: report.filters.length,
      total_available: report.total_available,
      total_is_ceiling: report.total_is_ceiling,
      source: SOURCE_NAME,
      notes,
    },
    renderReport(report, query),
    { notes },
  );
}
