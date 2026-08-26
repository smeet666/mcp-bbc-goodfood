/**
 * The reading layer, publishable on its own.
 *
 * It owns the pacing, the store and the error vocabulary, and it knows nothing
 * about the protocol above it. A program can import it as an ordinary library
 * and get the same care the tools get.
 */

import type { Config, Logger } from "../config.js";
import type { FilterReport, Read } from "../types.js";
import { Cache } from "./cache.js";
import { fetchJson } from "./http.js";
import { parseFilterReport } from "./parse.js";
import { RateLimiter } from "./rateLimiter.js";
import { searchUrl } from "./urls.js";

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

  constructor(options: ClientOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl;
    this.limiter = new RateLimiter({ intervalMs: options.config.minIntervalMs });
    this.store = new Cache<FilterReport>(options.config.cacheTtlMs, options.config.cacheMaxEntries);
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
    const url = searchUrl(scope ?? "");

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

  /** The spacing in force, reported rather than guessed. */
  get currentIntervalMs(): number {
    return this.limiter.currentIntervalMs;
  }
}
