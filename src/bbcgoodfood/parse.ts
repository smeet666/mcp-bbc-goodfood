/**
 * Reading the search payload, and refusing to read more into it than it says.
 *
 * The site answers a search with the rows, the facets it offers over them, and a
 * total. Each of the three carries a way of misleading a reader, and this module
 * is where those are settled rather than in the tool above it.
 */

import { parseFailure } from "../errors.js";
import type { FilterGroup, FilterOption, FilterReport, SearchReport, SearchRow } from "../types.js";
import { SERVED_ROW_CEILING } from "../types.js";

const HOURS = /(\d+)\s*(?:hrs?|hours?)\b/i;
const MINUTES = /(\d+)\s*(?:mins?|minutes?)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string worth keeping, trimmed. Blank and absent are the same thing here. */
function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A count the site stated, or null.
 *
 * Zero is a count the site can genuinely state, so it survives. Anything that is
 * not a whole number of recipes says nothing, and saying nothing is null: on a
 * scale that starts at zero, a missing figure rendered as `0` would be
 * indistinguishable from a facet that matches nothing.
 */
function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/** Whatever wording identifies a discarded entry to someone reading the report. */
function wordingFor(entry: Record<string, unknown>, fallback: string): string {
  return readText(entry.label) ?? readText(entry.name) ?? readText(entry.value) ?? fallback;
}

function readOptions(
  entry: Record<string, unknown>,
  groupName: string,
  skipped: string[],
): FilterOption[] {
  const published: unknown = entry.options;
  if (!Array.isArray(published)) {
    return [];
  }

  const options: FilterOption[] = [];
  for (const candidate of published) {
    if (!isRecord(candidate)) {
      skipped.push(`${groupName}: an option arrived in a shape with no fields to read`);
      continue;
    }
    const value = readText(candidate.value);
    if (value === null) {
      // The value is what a caller passes back to narrow a search. An option
      // without one names something no question can be asked about.
      skipped.push(
        `${groupName}: the option published as "${wordingFor(candidate, "unnamed")}" carries no value to pass back`,
      );
      continue;
    }
    options.push({
      value,
      label: readText(candidate.label) ?? value,
      count: readCount(candidate.count),
    });
  }
  return options;
}

/**
 * Read the facet groups the payload publishes, naming whatever was discarded.
 *
 * A group whose options were all discarded is kept, empty. Its name is what a
 * caller passes back to a search, and the site accepts values the published list
 * never carried, so an empty group still names an axis that answers. Dropping it
 * would hide that axis.
 */
export function parseFilterGroups(payload: unknown): { groups: FilterGroup[]; skipped: string[] } {
  const groups: FilterGroup[] = [];
  const skipped: string[] = [];

  const published: unknown = isRecord(payload) ? payload.filters : undefined;
  if (!Array.isArray(published)) {
    return { groups, skipped };
  }

  for (const entry of published) {
    if (!isRecord(entry)) {
      skipped.push("a filter arrived in a shape with no fields to read");
      continue;
    }
    const name = readText(entry.name);
    if (name === null) {
      skipped.push(
        `the filter published as "${wordingFor(entry, "unnamed")}" carries no name to pass back`,
      );
      continue;
    }
    const options = readOptions(entry, name, skipped);
    groups.push({
      name,
      label: readText(entry.label) ?? name,
      options,
      option_count: options.length,
    });
  }

  return { groups, skipped };
}

/**
 * Read everything a filter listing establishes from one payload.
 *
 * A missing search block is a breakdown rather than an absence of facets, so it
 * is raised: rendering an empty listing would let a caller report that the site
 * offers no way to narrow, which was never established.
 */
export function parseFilterReport(payload: unknown, query: string | null): FilterReport {
  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  if (!isRecord(results)) {
    throw parseFailure("BBC Good Food answered without the block that carries its search results.");
  }

  const { groups } = parseFilterGroups(payload);
  const total = readCount(results.totalItems);

  return {
    query,
    filters: groups,
    filter_count: groups.length,
    total_available: total,
    // A total that lands exactly on the ceiling was cut there, so it states a
    // floor. Reporting it as a catalogue would invent what the site withheld.
    total_is_ceiling: total === SERVED_ROW_CEILING,
  };
}

/**
 * The minutes a row states for the whole recipe.
 *
 * The site writes them as "50 mins", "1 hr" or "1 hr 20 mins", and the two parts
 * add up. A wording carrying neither is unreadable rather than instantaneous, so
 * it yields null: a zero here would say the recipe takes no time at all.
 */
function readMinutes(display: unknown): number | null {
  if (typeof display !== "string") {
    return null;
  }
  const hours = HOURS.exec(display);
  const minutes = MINUTES.exec(display);
  if (!(hours || minutes)) {
    return null;
  }
  return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

/** The wording a row publishes under one of its own term slugs. */
function readTerm(row: Record<string, unknown>, slug: string): string | null {
  const terms: unknown = row.terms;
  if (!Array.isArray(terms)) {
    return null;
  }
  for (const term of terms) {
    if (isRecord(term) && term.slug === slug) {
      return readText(term.display);
    }
  }
  return null;
}

function readRating(row: Record<string, unknown>): { value: number | null; count: number | null } {
  const rating: unknown = row.rating;
  if (!isRecord(rating)) {
    return { value: null, count: null };
  }

  const count = readCount(rating.ratingCount);
  const stated = typeof rating.ratingValue === "number" ? rating.ratingValue : null;

  /*
   * A rating runs from one to five and needs someone to have given it. Zero on
   * either side says nobody judged the recipe, which is a different statement
   * from a poor score, and rendering it as a score puts an unjudged recipe at
   * the bottom of a ranking it never entered.
   *
   * The two fields part company here on purpose: the rating goes, and the
   * number of people who gave one stays at zero. Nobody voting is a figure the
   * site established; what they would have said is not.
   */
  const value = stated === null || stated === 0 || count === null || count === 0 ? null : stated;
  return { value, count };
}

/**
 * One row, or the wording that says why it could not be rendered.
 *
 * Three fields make a row usable and each answers a different need: the
 * identifier is what a later read asks for, the title is what tells one row from
 * another, and the address is what a reader cites. A row missing any of them is
 * set aside rather than rendered half-empty.
 */
function readRow(entry: unknown): SearchRow | string {
  if (!isRecord(entry)) {
    return "a row arrived in a shape with no fields to read";
  }

  const id = readText(entry.id);
  const title = readText(entry.title);
  const url = readText(entry.url);
  if (id === null || title === null || url === null) {
    return sayWhyDropped({ id, title, url });
  }

  const image: unknown = entry.image;
  const rating = readRating(entry);
  return {
    id,
    title,
    url,
    image_url: isRecord(image) ? readText(image.url) : null,
    rating: rating.value,
    rating_count: rating.count,
    premium: entry.isPremium === true,
    total_minutes: readMinutes(readTerm(entry, "time")),
    difficulty: readTerm(entry, "skillLevel"),
    author: readText(entry.authorName),
  };
}

/**
 * Named by everything the row still carries rather than by one of them: which
 * field survives differs from row to row, and the identifier is the one a reader
 * chases the row by.
 */
function sayWhyDropped(read: {
  id: string | null;
  title: string | null;
  url: string | null;
}): string {
  const missing = [
    read.id === null ? "no identifier" : "",
    read.title === null ? "no title" : "",
    read.url === null ? "no address" : "",
  ].filter((part) => part !== "");

  const marks = [
    read.title === null ? "" : `titled "${read.title}"`,
    read.id === null ? "" : `carrying id ${read.id}`,
    read.url ?? "",
  ].filter((part) => part !== "");

  const named = marks.length > 0 ? marks.join(", ") : "with nothing to name it";
  return `a row ${named} was set aside: ${missing.join(", ")}`;
}

/** Read the rows of a listing, naming whatever could not be rendered. */
export function parseSearchRows(payload: unknown): { rows: SearchRow[]; skipped: string[] } {
  const rows: SearchRow[] = [];
  const skipped: string[] = [];

  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  const served: unknown = isRecord(results) ? results.items : undefined;
  if (!Array.isArray(served)) {
    return { rows, skipped };
  }

  for (const entry of served) {
    const read = readRow(entry);
    if (typeof read === "string") {
      skipped.push(read);
      continue;
    }
    rows.push(read);
  }

  return { rows, skipped };
}

/**
 * Read everything a search establishes from one payload.
 *
 * `rows_seen` counts what the site served and `result_count` counts what could
 * be rendered. They differ only when a row was set aside, and holding both is
 * the only thing that says so: reporting the second alone would make a lost row
 * look like a row that was never there.
 */
export function parseSearchReport(payload: unknown, query: string): SearchReport {
  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  if (!isRecord(results)) {
    throw parseFailure("BBC Good Food answered without the block that carries its search results.");
  }

  const { rows } = parseSearchRows(payload);
  const served: unknown = results.items;
  const total = readCount(results.totalItems);

  return {
    query,
    results: rows,
    result_count: rows.length,
    total_available: total,
    total_is_ceiling: total === SERVED_ROW_CEILING,
    rows_seen: Array.isArray(served) ? served.length : 0,
    restrictions_dropped: [],
  };
}
