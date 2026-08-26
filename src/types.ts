/**
 * The shapes every layer agrees on.
 *
 * A read carries whether it came from the store, so a caller can tell a fresh
 * answer from a repeated one without asking the site again.
 */

/** The envelope every read returns. */
export interface Read<T> {
  data: T;
  cached: boolean;
  /** Rows the server declined to render, and why, when any were dropped. */
  skipped?: string[];
}

/** One value a filter accepts, as the site publishes it. */
export interface FilterOption {
  /** What to pass back when narrowing a search. */
  value: string;
  /** The site's own wording for that value. */
  label: string;
  /** Recipes carrying that value within the scope the counts were measured in. */
  count: number | null;
}

/**
 * One axis a search can be narrowed along.
 *
 * The options published here are the ones the site chose to show, which is a
 * shortlist rather than the set it accepts: values absent from this list still
 * narrow a search.
 */
export interface FilterGroup {
  /** The argument name a search takes for this axis. */
  name: string;
  /** The site's own wording for the axis. */
  label: string;
  options: FilterOption[];
  /** How many options the site published here. */
  option_count: number;
}

/** What `list_filters` establishes about one scope. */
export interface FilterReport {
  /** The search the counts were measured in, or null for the whole site. */
  query: string | null;
  filters: FilterGroup[];
  filter_count: number;
  /** Recipes the site says the scope holds. */
  total_available: number | null;
  /**
   * True when the total equals the largest number of rows the site will serve
   * for one search, so the real figure is that number or more.
   */
  total_is_ceiling: boolean;
  /** Rows the site served on the first page of this search. */
  rows_seen: number;
  /**
   * How many of those rows carry a word of the search.
   *
   * The site matches fragments and answers a term it holds nothing for with a
   * count and a page of rows all the same, marking nothing as a miss. Counting
   * what the rows actually carry is the only thing that tells the two apart,
   * and it is rendered as a count rather than as a verdict: a reader seeing
   * two rows out of thirty judges better than a flag that judges for them.
   *
   * Null when there is nothing to measure, which is a search with no query and
   * a query holding no word long enough to look for.
   */
  matched_rows: number | null;
}

/**
 * The largest number of rows the site serves for a single search. A total that
 * lands exactly here was cut, so it states a floor rather than a count.
 */
export const SERVED_ROW_CEILING = 10_000;
