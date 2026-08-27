import process from "node:process";
import { describe, expect, it } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";
import { runListFilters } from "../../src/tools/listFilters.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import { SERVED_ROW_CEILING } from "../../src/types.js";

// This suite reads the real site, one request per route, to catch what the
// generated corpus cannot see: the day BBC Good Food changes its answers. No
// fake clock here, and no assertion on wall-clock duration.

// A canary has nobody waiting on it and the site is free to read, so it paces
// itself far slower than the server's default.
const config = loadConfig({ BGF_MIN_INTERVAL_MS: "4000" });
const client = new GoodFoodClient({ config, logger: createLogger("silent") });

interface FilterOptionShape {
  value: string;
  count: number | null;
}

interface FilterGroupShape {
  name: string;
  options: FilterOptionShape[];
}

interface FilterReportShape {
  filters: FilterGroupShape[];
  total_available: number | null;
  total_is_ceiling: boolean;
}

interface SearchRowShape {
  id: string;
  title: string;
  url: string;
}

interface SearchReportShape {
  results: SearchRowShape[];
  result_count: number;
  restrictions_dropped: string[];
}

const structuredOf = <T>(result: { structuredContent?: unknown }): T => {
  expect(result.structuredContent, "the tool answered without structuredContent").toBeDefined();
  return result.structuredContent as T;
};

const countsByOption = (report: FilterReportShape): Map<string, number | null> => {
  const counts = new Map<string, number | null>();
  for (const group of report.filters) {
    for (const option of group.options) {
      counts.set(`${group.name}:${option.value}`, option.count);
    }
  }
  return counts;
};

describe.skipIf(!process.env.BGF_LIVE)("BBC Good Food, live", () => {
  it("answers list_filters without a query with axes and the service ceiling", async () => {
    const report = structuredOf<FilterReportShape>(await runListFilters(client, {}));

    expect(report.filters.length, "the site-wide listing published no facet group").toBeGreaterThan(
      0,
    );
    expect(
      report.total_available,
      "the site-wide total left the served-row ceiling, so the ceiling moved",
    ).toBe(SERVED_ROW_CEILING);
    expect(report.total_is_ceiling, "total_is_ceiling no longer marks the site-wide total").toBe(
      true,
    );
  });

  it("answers list_filters with a query with counts tied to that scope", async () => {
    const sitewide = structuredOf<FilterReportShape>(await runListFilters(client, {}));
    const scoped = structuredOf<FilterReportShape>(
      await runListFilters(client, { query: "chicken" }),
    );

    expect(scoped.filters.length, "the scoped listing published no facet group").toBeGreaterThan(0);
    expect(
      scoped.total_available,
      "the scoped total matched the site-wide one, so the scope stopped applying",
    ).not.toBe(sitewide.total_available);

    const sitewideCounts = countsByOption(sitewide);
    const scopedCounts = countsByOption(scoped);
    const shared = [...scopedCounts.keys()].filter((key) => sitewideCounts.has(key));
    expect(
      shared.length,
      "no facet option appears in both scopes, so the vocabulary moved",
    ).toBeGreaterThan(0);
    expect(
      shared.some((key) => scopedCounts.get(key) !== sitewideCounts.get(key)),
      "every shared facet count matched the site-wide one, so counts stopped being scoped",
    ).toBe(true);
  });

  it("drops a facet value the site does not know rather than reporting an absence", async () => {
    // The whole server rests on this: the site answers a facet value it does
    // not know with HTTP 200 and a total of zero, never with a refusal. If it
    // ever started refusing, the retry-without-restrictions rule would turn a
    // legitimate search into an error instead of a result.
    const report = structuredOf<SearchReportShape>(
      await runSearchRecipes(client, { query: "chicken", diet: "keldish-free" }),
    );

    expect(
      report.restrictions_dropped,
      "an unknown diet value was not dropped, so the site stopped answering it with zero",
    ).toContain("diet");
    expect(
      report.result_count,
      "the retry without the unknown restriction returned nothing",
    ).toBeGreaterThan(0);
  });

  it("answers search_recipes on a common term with rows carrying id, title and address", async () => {
    const report = structuredOf<SearchReportShape>(
      await runSearchRecipes(client, { query: "chicken" }),
    );

    expect(report.result_count, "a search for chicken returned no row").toBeGreaterThan(0);
    for (const row of report.results) {
      expect(row.id, "a row came back without id").toBeTruthy();
      expect(row.title, "a row came back without title").toBeTruthy();
      expect(row.url, "a row came back without url").toBeTruthy();
    }
  });

  it("answers search_recipes on an invented term with rows all the same", async () => {
    const report = structuredOf<SearchReportShape>(
      await runSearchRecipes(client, { query: "keldish marran ostrean wafer" }),
    );

    expect(
      report.result_count,
      "an invented term returned nothing, so the site stopped answering on fragments",
    ).toBeGreaterThan(0);
  });
});
