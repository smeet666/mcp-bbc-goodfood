/**
 * Every address this server asks for, built in one place.
 *
 * The search term reaches the query string through URLSearchParams, so a term
 * carrying an accent, a slash or an ampersand is encoded rather than pasted: an
 * unencoded byte turns a search into a malformed request the site refuses.
 */

export const SITE_ORIGIN = "https://www.bbcgoodfood.com";

/** The route the site's own front end reads its search results from. */
const SEARCH_PATH = "/api/search-frontend/search";

/**
 * The search the facets are measured over.
 *
 * An empty term is a legitimate question rather than a missing one: it asks the
 * site for its unfiltered listing, which is the scope a caller gets by naming
 * no search at all.
 */
export function searchUrl(search: string): string {
  const url = new URL(SEARCH_PATH, SITE_ORIGIN);
  url.searchParams.set("search", search);
  return url.toString();
}
