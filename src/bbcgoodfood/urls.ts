/**
 * Every address this server asks for, built in one place.
 *
 * Values reach the query string through URLSearchParams, so a term carrying an
 * accent, a slash or an ampersand is encoded rather than pasted: an unencoded
 * byte turns a search into a malformed request the site refuses.
 */

export const SITE_ORIGIN = "https://www.bbcgoodfood.com";

/** The route the site's own front end reads its search results from. */
const SEARCH_PATH = "/api/search-frontend/search";

/**
 * How a restriction a caller writes becomes one the site reads.
 *
 * The two vocabularies differ, and the caller's is the one that travels: a
 * restriction the site could not answer is reported back under the name the
 * caller used, since that is the name they would have to change.
 *
 * `text` passes the value through. `lt` and `gte` are the site's own way of
 * writing a bound, and the scale turns the caller's unit into the site's.
 */
interface FacetShape {
  param: string;
  form: "text" | "lt" | "gte";
  scale: number;
}

const FACETS: Readonly<Record<string, FacetShape>> = {
  diet: { param: "diet", form: "text", scale: 1 },
  cuisine: { param: "cuisine", form: "text", scale: 1 },
  meal_type: { param: "mealType", form: "text", scale: 1 },
  difficulty: { param: "difficulty", form: "text", scale: 1 },
  // The site counts a total time in seconds; a caller states it in minutes.
  max_total_minutes: { param: "totalTime", form: "lt", scale: 60 },
  max_calories: { param: "calories", form: "lt", scale: 1 },
  min_servings: { param: "servings", form: "gte", scale: 1 },
  min_rating: { param: "ratings", form: "gte", scale: 1 },
};

/** The restriction names a search accepts, which is what a refusal names back. */
export const FACET_NAMES: readonly string[] = Object.keys(FACETS);

export interface SearchQuery {
  /** Free text. An empty string asks the site for its unfiltered listing. */
  search: string;
  page?: number;
  limit?: number;
  sort?: string;
  /** Restrictions, keyed by the name a caller writes. */
  facets?: Readonly<Record<string, string>>;
}

export function searchUrl(query: SearchQuery): string {
  const url = new URL(SEARCH_PATH, SITE_ORIGIN);
  url.searchParams.set("search", query.search);
  if (query.page !== undefined) {
    url.searchParams.set("page", String(query.page));
  }
  if (query.limit !== undefined) {
    url.searchParams.set("limit", String(query.limit));
  }
  if (query.sort !== undefined) {
    url.searchParams.set("sort", query.sort);
  }

  for (const [name, value] of Object.entries(query.facets ?? {})) {
    const shape = FACETS[name];
    if (!shape) {
      continue;
    }
    url.searchParams.set(
      shape.param,
      shape.form === "text" ? value : `${shape.form}-${Number(value) * shape.scale}`,
    );
  }
  return url.toString();
}
