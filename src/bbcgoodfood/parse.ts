/**
 * Reading the search payload, and refusing to read more into it than it says.
 *
 * The site answers a search with the rows, the facets it offers over them, and a
 * total. Each of the three carries a way of misleading a reader, and this module
 * is where those are settled rather than in the tool above it.
 */

import { parseFailure } from "../errors.js";
import type { FilterGroup, FilterOption, FilterReport } from "../types.js";
import { SERVED_ROW_CEILING } from "../types.js";

/**
 * The shortest word worth looking for inside a row.
 *
 * The site matches on fragments, which is how a term it holds nothing for still
 * comes back with a page of rows. Looking for a fragment of two characters here
 * would repeat that mistake: it turns up inside unrelated words and would make
 * everything look like a match.
 */
const SHORTEST_WORD = 3;

const DIACRITICS = /[\u0300-\u036f]/g;
const BETWEEN_WORDS = /[^a-z0-9]+/;

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

/** The words of a text, lowercased and stripped of accents. */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .split(BETWEEN_WORDS)
    .filter((word) => word !== "");
}

/**
 * Whether a row carries a word of the search.
 *
 * Either word may be the longer one, so a search for a singular still finds the
 * plural the title uses. Both sides have to reach the floor, which is what keeps
 * a three-letter opening from matching every word that happens to start the same
 * way. Title and address are read together, since a slug often spells out what a
 * title writes another way.
 */
function rowCarries(row: unknown, wanted: readonly string[]): boolean {
  if (!isRecord(row)) {
    return false;
  }
  const title = typeof row.title === "string" ? row.title : "";
  const url = typeof row.url === "string" ? row.url : "";
  return wordsOf(`${title} ${url}`).some(
    (word) =>
      word.length >= SHORTEST_WORD &&
      wanted.some((sought) => word.startsWith(sought) || sought.startsWith(word)),
  );
}

/**
 * How many of the rows the site served carry a word of the search.
 *
 * Null says there was nothing to measure, which is a different statement from
 * zero: a search with no query, or one whose every word is too short to look
 * for, was never weighed against anything.
 */
function countCarryingRows(rows: readonly unknown[], query: string | null): number | null {
  if (query === null) {
    return null;
  }
  const wanted = wordsOf(query).filter((word) => word.length >= SHORTEST_WORD);
  if (wanted.length === 0) {
    return null;
  }
  // A row counts once, however many words of the search it carries.
  return rows.filter((row) => rowCarries(row, wanted)).length;
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
  const rows: unknown[] = Array.isArray(results.items) ? results.items : [];

  return {
    query,
    filters: groups,
    filter_count: groups.length,
    total_available: total,
    // A total that lands exactly on the ceiling was cut there, so it states a
    // floor. Reporting it as a catalogue would invent what the site withheld.
    total_is_ceiling: total === SERVED_ROW_CEILING,
    rows_seen: rows.length,
    matched_rows: countCarryingRows(rows, query),
  };
}
