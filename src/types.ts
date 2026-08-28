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
  /** The site's own name for the axis. */
  name: string;
  /** The site's own wording for the axis. */
  label: string;
  options: FilterOption[];
  /** How many options this answer rendered. */
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
  restrictions_lifted: string[];
}

/** One line of an ingredient list, as the site publishes it. */
export interface RecipeIngredient {
  /** The line as the site composes it. */
  text: string;
  /** The quantity, in `unit`. Null when the site states none. */
  amount: number | null;
  /** The unit `amount` is in, as the site writes it. Null when it states none. */
  unit: string | null;
  /** What the ingredient is, without its quantity. */
  item: string;
  /** What the site says to do to it beforehand, such as "thinly sliced". */
  note: string | null;
  /** The site's own normalised name for it. Null when it gives none. */
  term: string | null;
}

export interface IngredientGroup {
  /** The site's own heading, or null when the group carries none. */
  heading: string | null;
  ingredients: RecipeIngredient[];
}

export interface NutritionFact {
  /** The site's own wording, such as "kcal" or "saturates". */
  label: string;
  value: number | null;
  /** Such as "g". The empty string where the site writes none. */
  unit: string;
}

/** One recipe, read from its own page. */
export interface Recipe {
  id: string;
  title: string;
  url: string;
  /** True when the recipe sits behind the site's subscription. */
  premium: boolean;
  /** What the site states, such as "Serves 4". Null when it states none. */
  yield_text: string | null;
  /** The first whole number read out of that wording. Null when there is none. */
  yield_count: number | null;
  /** Minutes, from the upper bound the site publishes. Null when it publishes none. */
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
  /** The site's own wording, such as "Easy". */
  difficulty: string | null;
  /** The site's own wording for each diet it tags. */
  diets: string[];
  author: string | null;
  /** 1 to 5. Null when nobody has rated it. */
  rating: number | null;
  rating_count: number | null;
  description: string | null;
  /**
   * Empty when the recipe sits behind the subscription.
   *
   * The page carries them all the same, and that is exactly why this is a rule:
   * the site put a wall in front of its readers, and this server does not become
   * the way around it.
   */
  ingredients: IngredientGroup[];
  /** Empty when the recipe sits behind the subscription. */
  steps: string[];
  nutrition: NutritionFact[];
  /** The site's own wording for what the nutrition is stated per. */
  nutrition_per: string | null;
  /** The site's own rendition for readers in the United States, where it wrote one. */
  us_edition: UsEdition | null;
}

/**
 * The second rendition of a recipe, written by the site for readers in the
 * United States.
 *
 * It restates the measure inside each line and renames what the two countries
 * call differently, a frying pan against a skillet. The structured quantity
 * beside each line is the one the site publishes, which stays metric in both
 * renditions: a line reading "6 oz" carries 185 g, because that is the figure
 * the page states and "6 oz" is the site's own rounding of it.
 */
export interface UsEdition {
  /** Empty when the recipe sits behind the subscription. */
  ingredients: IngredientGroup[];
  /** Empty when the recipe sits behind the subscription. */
  steps: string[];
  nutrition: NutritionFact[];
}
