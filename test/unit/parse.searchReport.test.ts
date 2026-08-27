import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSearchReport, parseSearchRows } from "../../src/bbcgoodfood/parse.js";
import { GoodFoodError } from "../../src/errors.js";
import type { SearchRow } from "../../src/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

/** A search payload carrying exactly the rows and the total a case is about. */
const payloadOf = (items: unknown, totalItems: unknown): unknown => ({
  searchResults: { totalItems, limit: 30, items },
});

/** The address carries the identifier, so two readable rows differ by it. */
const readable = (extra: Record<string, unknown> & { slug?: string }): unknown => ({
  id: "1",
  title: "Keldish greens",
  url: `https://www.bbcgoodfood.com/recipes/${extra.slug ?? "keldish-greens"}`,
  ...extra,
  slug: undefined,
});

const failureCode = (payload: unknown, query: string): string => {
  try {
    parseSearchReport(payload, query);
  } catch (error) {
    expect(error).toBeInstanceOf(GoodFoodError);
    return (error as GoodFoodError).code;
  }
  throw new Error("the payload was read instead of refused");
};

describe("parseSearchReport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the rows it drops", () => {
    // The identifier is the page's own path, so a row carrying a title and an
    // address is usable whether or not the site also numbered it. Only a row
    // missing one of those two is set aside.
    it("keeps the two readable rows of a degraded page and names the four it dropped", () => {
      const { rows, skipped } = parseSearchRows(fixture("search-degraded.json"));

      expect(rows.map((row: SearchRow) => row.id)).toEqual([
        "recipes/keldish-greens",
        "recipes/no-id",
      ]);
      expect(skipped).toHaveLength(4);
    });

    it("names the dropped row by what it still carries", () => {
      const { skipped } = parseSearchRows(fixture("search-degraded.json"));
      const named = skipped.join(" | ");

      // The site's own number names a row for a bug report even though it
      // cannot fetch it, which is why it is still read for the wording.
      expect(named).toContain("322");
      expect(named).toContain("323");
      expect(named).toContain("No address at all");
    });

    it("drops a row missing a title or an address, and keeps its neighbours", () => {
      const cases: Record<string, unknown> = {
        title: { id: "9", url: "https://www.bbcgoodfood.com/recipes/marran-wafers" },
        url: { id: "9", title: "Marran wafers" },
      };

      for (const broken of Object.values(cases)) {
        const { rows, skipped } = parseSearchRows(
          payloadOf([readable({ slug: "first" }), broken, readable({ slug: "second" })], 3),
        );

        expect(rows.map((row: SearchRow) => row.id)).toEqual(["recipes/first", "recipes/second"]);
        expect(skipped).toHaveLength(1);
      }
    });

    it("drops an entry that is not an object and names it", () => {
      const { rows, skipped } = parseSearchRows(
        payloadOf([readable({}), "not a row at all", null, 7, [readable({})]], 5),
      );

      expect(rows).toHaveLength(1);
      expect(skipped).toHaveLength(4);
      for (const name of skipped) {
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it("counts an empty field, or one made of spaces, as absent", () => {
      // A blank id is no longer a reason to drop a row: the address carries the
      // identifier. A blank title or address still is.
      const blanks: unknown[] = [
        { id: "9", title: "", url: "https://www.bbcgoodfood.com/recipes/wafers" },
        { id: "9", title: " \t ", url: "https://www.bbcgoodfood.com/recipes/wafers" },
        { id: "9", title: "Marran wafers", url: "" },
        { id: "9", title: "Marran wafers", url: "  " },
      ];

      for (const broken of blanks) {
        const { rows, skipped } = parseSearchRows(payloadOf([broken], 1));

        expect(rows).toEqual([]);
        expect(skipped).toHaveLength(1);
      }
    });
  });

  describe("the two counts", () => {
    it("says a row was lost by making the two counts differ", () => {
      const report = parseSearchReport(fixture("search-degraded.json"), "keldish");

      expect(report.rows_seen).toBe(6);
      expect(report.result_count).toBe(2);
      expect(report.results).toHaveLength(2);
      expect(report.rows_seen).not.toBe(report.result_count);
    });

    it("holds the two counts equal on a whole page", () => {
      const report = parseSearchReport(fixture("search-page.json"), "keldish");
      const { skipped } = parseSearchRows(fixture("search-page.json"));

      expect(report.rows_seen).toBe(5);
      expect(report.result_count).toBe(5);
      expect(report.results).toHaveLength(5);
      expect(skipped).toEqual([]);
    });

    it("counts no row at all when the page carries none", () => {
      const report = parseSearchReport(fixture("search-restricted-none.json"), "keldish");

      expect(report.rows_seen).toBe(0);
      expect(report.result_count).toBe(0);
      expect(report.results).toEqual([]);
    });

    it("carries the query it was measured under", () => {
      expect(parseSearchReport(fixture("search-page.json"), "keldish").query).toBe("keldish");
    });
  });

  describe("the total the site states", () => {
    it("carries the figure the page publishes", () => {
      expect(parseSearchReport(fixture("search-page.json"), "keldish").total_available).toBe(195);
      expect(parseSearchReport(fixture("search-page.json"), "keldish").total_is_ceiling).toBe(
        false,
      );
    });

    it("holds null on a total it cannot read", () => {
      const unreadable: unknown[] = ["lots", null, {}, Number.NaN];

      for (const total of unreadable) {
        const report = parseSearchReport(payloadOf([], total), "keldish");

        expect(report.total_available).toBeNull();
        expect(report.total_is_ceiling).toBe(false);
      }
    });

    it("marks a total of exactly ten thousand as a ceiling", () => {
      const report = parseSearchReport(payloadOf([], 10_000), "keldish");

      expect(report.total_available).toBe(10_000);
      expect(report.total_is_ceiling).toBe(true);
    });

    it("marks a total on either side of the ceiling as a count", () => {
      const under = parseSearchReport(payloadOf([], 9999), "keldish");
      const over = parseSearchReport(payloadOf([], 10_001), "keldish");

      expect(under.total_available).toBe(9999);
      expect(under.total_is_ceiling).toBe(false);
      expect(over.total_available).toBe(10_001);
      expect(over.total_is_ceiling).toBe(false);
    });
  });

  describe("what it refuses and what it accepts", () => {
    it("refuses a payload carrying no searchResults with parse_failure", () => {
      expect(failureCode({ filters: [] }, "keldish")).toBe("parse_failure");
      expect(failureCode({ searchResults: null }, "keldish")).toBe("parse_failure");
      expect(failureCode({ searchResults: "none" }, "keldish")).toBe("parse_failure");
    });

    it("refuses a payload that is not an object with parse_failure", () => {
      for (const payload of [null, "a page", 7, []]) {
        expect(failureCode(payload, "keldish")).toBe("parse_failure");
      }
    });

    it("reads an absent or unusable items key as a page holding no row", () => {
      for (const items of [undefined, null, "none", 7, {}]) {
        const report = parseSearchReport(payloadOf(items, 12), "keldish");

        expect(report.rows_seen).toBe(0);
        expect(report.result_count).toBe(0);
        expect(report.results).toEqual([]);
        expect(report.total_available).toBe(12);
      }
    });
  });
});
