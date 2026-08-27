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
}

/**
 * The largest number of rows the site serves for a single search. A total that
 * lands exactly here was cut, so it states a floor rather than a count.
 */
export const SERVED_ROW_CEILING = 10_000;

/** One row of a search listing, carrying what it takes to pick one out of many. */
export interface SearchRow {
  /** Pass this back to read the recipe. */
  id: string;
  title: string;
  /** The public page. Show this when citing the recipe. */
  url: string;
  image_url: string | null;
  /** 1 to 5, as the site publishes it. Null when it published none. */
  rating: number | null;
  /** How many readers rated it. Null when the site published no figure. */
  rating_count: number | null;
  /** True when the recipe sits behind the site's subscription. */
  premium: boolean;
  /** Minutes the site states for the whole recipe. Null when it states none. */
  total_minutes: number | null;
  /** The site's own wording, such as "Easy". Null when it states none. */
  difficulty: string | null;
  author: string | null;
}

/** What a search establishes, and what it refuses to overstate about it. */
export interface SearchReport {
  query: string;
  results: SearchRow[];
  /** Rows rendered, after whatever could not be read was set aside. */
  result_count: number;
  total_available: number | null;
  total_is_ceiling: boolean;
  /** Rows the site served, before anything was set aside. */
  rows_seen: number;
  /**
   * Restrictions the site could not answer, dropped so the search could run.
   *
   * Named with the argument a caller wrote rather than with the site's own
   * parameter, since the first is what they would have to change.
   */
  restrictions_dropped: string[];
}
