/**
 * The reading layer, publishable on its own.
 *
 * It owns the pacing, the store and the error vocabulary, and it knows nothing
 * about the protocol above it. A program can import it as an ordinary library
 * and get the same care the tools get.
 */

import type { Config, Logger } from "../config.js";
import type { FilterReport, Read, SearchReport } from "../types.js";
import { Cache } from "./cache.js";
import { fetchJson } from "./http.js";
import { parseFilterReport, parseSearchReport } from "./parse.js";
import { RateLimiter } from "./rateLimiter.js";
import { searchUrl } from "./urls.js";

export interface SearchOptions {
  limit?: number;
  page?: number;
  sort?: "relevant" | "rating" | "published" | "quickest";
  /** Restrictions, keyed by the name a caller writes. */
  facets?: Readonly<Record<string, string>>;
}

export interface ClientOptions {
  config: Config;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

export class GoodFoodClient {
  private readonly config: Config;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly limiter: RateLimiter;
  private readonly store: Cache<FilterReport>;
  private readonly searches: Cache<SearchReport>;

  constructor(options: ClientOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl;
    this.limiter = new RateLimiter({ intervalMs: options.config.minIntervalMs });
    this.store = new Cache<FilterReport>(options.config.cacheTtlMs, options.config.cacheMaxEntries);
    this.searches = new Cache<SearchReport>(
      options.config.cacheTtlMs,
      options.config.cacheMaxEntries,
    );
  }

  /**
   * Read the axes a search can be narrowed along.
   *
   * A query scopes the counts to what that search returns, since the site
   * measures its facets over the result set rather than over the catalogue.
   * Without one the counts describe the site's unfiltered listing.
   */
  async listFilters(query?: string | null): Promise<Read<FilterReport>> {
    const scope = typeof query === "string" && query.trim() !== "" ? query.trim() : null;
    const url = searchUrl({ search: scope ?? "" });

    const stored = this.store.get(url);
    if (stored) {
      this.logger.debug(`served from the store: ${url}`);
      return { data: stored, cached: true };
    }

    const payload = await this.limiter.schedule(() =>
      fetchJson({
        url,
        userAgent: this.config.userAgent,
        timeoutMs: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
        limiter: this.limiter,
        logger: this.logger,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      }),
    );

    // Parsed before it is stored, so an answer nobody could read is never served
    // back for the rest of the entry's lifetime.
    const report = parseFilterReport(payload, scope);
    this.store.set(url, report);
    return { data: report, cached: false };
  }

  /**
   * Search for recipes, and say when a restriction had to be let go.
   *
   * The site answers a restriction it cannot read with a count of zero and an
   * empty page, saying nothing about which one it failed to understand. A caller
   * reading that zero would conclude the site holds nothing, which was never
   * established. So a restricted search that comes back empty is run once more
   * without the restrictions, and what was let go is named.
   *
   * Once, and only when restrictions were set: a plain search that comes back
   * empty is a real absence, and asking the site the same question twice would
   * cost it a request to learn nothing.
   */
  async searchRecipes(query: string, options: SearchOptions = {}): Promise<Read<SearchReport>> {
    const facets = options.facets ?? {};
    const restricted = Object.keys(facets);

    const first = await this.readSearch(query, options, facets);
    if (restricted.length === 0 || first.data.total_available !== 0) {
      return first;
    }

    const again = await this.readSearch(query, options, {});
    return {
      data: { ...again.data, restrictions_dropped: restricted },
      cached: again.cached,
    };
  }

  private async readSearch(
    query: string,
    options: SearchOptions,
    facets: Readonly<Record<string, string>>,
  ): Promise<Read<SearchReport>> {
    const url = searchUrl({
      search: query,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.page === undefined ? {} : { page: options.page }),
      ...(options.sort === undefined ? {} : { sort: options.sort }),
      facets,
    });

    const stored = this.searches.get(url);
    if (stored) {
      this.logger.debug(`served from the store: ${url}`);
      return { data: stored, cached: true };
    }

    const payload = await this.limiter.schedule(() =>
      fetchJson({
        url,
        userAgent: this.config.userAgent,
        timeoutMs: this.config.timeoutMs,
        maxRetries: this.config.maxRetries,
        limiter: this.limiter,
        logger: this.logger,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      }),
    );

    const report = parseSearchReport(payload, query);
    this.searches.set(url, report);
    return { data: report, cached: false };
  }

  /** The spacing in force, reported rather than guessed. */
  get currentIntervalMs(): number {
    return this.limiter.currentIntervalMs;
  }
}
