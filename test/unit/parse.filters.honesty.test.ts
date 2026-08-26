import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFilterGroups, parseFilterReport } from "../../src/bbcgoodfood/parse.js";
import { GoodFoodError } from "../../src/errors.js";
import { SERVED_ROW_CEILING } from "../../src/types.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

/** The thrown value, so a test can question its class and its code. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("the call was expected to throw, and returned");
}

/** True when one of the discarded names carries the given wording. */
function mentions(skipped: readonly string[], wording: string): boolean {
  return skipped.some((entry) => entry.toLowerCase().includes(wording.toLowerCase()));
}

const partial = fixture("filters-partial.json");
const none = fixture("filters-none.json");
const absent = fixture("filters-absent.json");
const unreadable = fixture("filters-unreadable.json");

/** A payload shaped like the site's, carrying the given filters and total. */
function payload(filters: unknown, totalItems: unknown): unknown {
  return {
    tabs: [],
    filters,
    searchResults: { totalItems, limit: 30, items: [] },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rule 1: an absent count is null, never zero", () => {
  it("renders null for an option the site gives no count for", () => {
    const { groups } = parseFilterGroups(partial);
    const ratings = groups.find((group) => group.name === "ratings");

    expect(ratings?.options[0]?.value).toBe("gte-4");
    expect(ratings?.options[0]?.count).toBeNull();
  });

  // On a scale that starts at zero, a missing count and a count of zero would be
  // indistinguishable, so the two are read apart from the same group.
  it("keeps a real zero as zero and an absent count as null", () => {
    const { groups } = parseFilterGroups(
      payload(
        [
          {
            label: "Diets",
            name: "diet",
            options: [
              { value: "counted", label: "Counted", count: 0 },
              { value: "uncounted", label: "Uncounted" },
            ],
          },
        ],
        7,
      ),
    );

    const options = groups[0]?.options ?? [];
    expect(options[0]?.count).toBe(0);
    expect(options[1]?.count).toBeNull();
    expect(options[1]?.count).not.toBe(0);
    expect(options[0]?.count).not.toBeNull();
  });

  it("renders a count the site gives as the number it gives", () => {
    const { groups } = parseFilterGroups(partial);
    const diet = groups.find((group) => group.name === "diet");

    expect(diet?.options[0]).toEqual({ value: "nut-free", label: "Nut-free", count: 12 });
  });
});

describe("rule 2: a group without a usable name is discarded and named", () => {
  it("discards the group the site published without a name", () => {
    const { groups, skipped } = parseFilterGroups(partial);

    expect(groups.map((group) => group.name)).not.toContain("difficulty");
    expect(groups.every((group) => group.label !== "Difficulty")).toBe(true);
    expect(mentions(skipped, "Difficulty")).toBe(true);
  });

  it("discards a group whose name is empty or blank", () => {
    const { groups, skipped } = parseFilterGroups(
      payload(
        [
          { label: "Empty name", name: "", options: [{ value: "a", label: "A", count: 1 }] },
          { label: "Blank name", name: "   ", options: [{ value: "b", label: "B", count: 1 }] },
          { label: "Diets", name: "diet", options: [{ value: "c", label: "C", count: 1 }] },
        ],
        7,
      ),
    );

    expect(groups.map((group) => group.name)).toEqual(["diet"]);
    expect(mentions(skipped, "Empty name")).toBe(true);
    expect(mentions(skipped, "Blank name")).toBe(true);
  });
});

describe("rule 3: an option without a value is discarded and named", () => {
  it("discards the valueless option and keeps its neighbours", () => {
    const { groups, skipped } = parseFilterGroups(
      payload(
        [
          {
            label: "Diets",
            name: "diet",
            options: [
              { value: "nut-free", label: "Nut-free", count: 12 },
              { label: "Unnameable", count: 4 },
              { value: "root-free", label: "Root-free", count: 3 },
            ],
          },
        ],
        12,
      ),
    );

    expect(groups[0]?.options.map((option) => option.value)).toEqual(["nut-free", "root-free"]);
    expect(groups[0]?.option_count).toBe(2);
    expect(mentions(skipped, "Unnameable")).toBe(true);
    expect(mentions(skipped, "nut-free")).toBe(false);
  });

  it("names in skipped both what the partial payload discards", () => {
    const { skipped } = parseFilterGroups(partial);

    expect(skipped.length).toBeGreaterThanOrEqual(2);
    expect(mentions(skipped, "Difficulty")).toBe(true);
    expect(mentions(skipped, "Supper") || mentions(skipped, "mealType")).toBe(true);
  });
});

// A group whose options were all discarded is kept, with an empty list and a
// count of zero. The name is what a caller passes back to a search, and the site
// accepts values the published list never carried: keeping the group says the
// facet exists, where dropping it would hide an axis that still answers.
describe("a group left with no option is kept, empty", () => {
  it("keeps the group the site published with no option at all", () => {
    const { groups } = parseFilterGroups(partial);
    const cuisine = groups.find((group) => group.name === "cuisine");

    expect(cuisine).toBeDefined();
    expect(cuisine?.options).toEqual([]);
    expect(cuisine?.option_count).toBe(0);
  });

  it("keeps the group whose every option was discarded", () => {
    const { groups, skipped } = parseFilterGroups(partial);
    const mealType = groups.find((group) => group.name === "mealType");

    expect(mealType).toBeDefined();
    expect(mealType?.label).toBe("Meal type");
    expect(mealType?.options).toEqual([]);
    expect(mealType?.option_count).toBe(0);
    expect(mentions(skipped, "Supper") || mentions(skipped, "mealType")).toBe(true);
  });

  it("renders the four groups the partial payload leaves standing", () => {
    const report = parseFilterReport(partial, "supper");

    expect(report.filters.map((group) => group.name)).toEqual([
      "diet",
      "cuisine",
      "mealType",
      "ratings",
    ]);
    expect(report.filter_count).toBe(4);
  });
});

describe("rule 5: total_is_ceiling marks the served-row ceiling", () => {
  it("is true at the ceiling itself", () => {
    const report = parseFilterReport(payload([], SERVED_ROW_CEILING), null);

    expect(report.total_available).toBe(SERVED_ROW_CEILING);
    expect(report.total_is_ceiling).toBe(true);
  });

  it("is false one row below the ceiling", () => {
    const report = parseFilterReport(payload([], SERVED_ROW_CEILING - 1), null);

    expect(report.total_available).toBe(9999);
    expect(report.total_is_ceiling).toBe(false);
  });

  it("is false one row above the ceiling", () => {
    const report = parseFilterReport(payload([], SERVED_ROW_CEILING + 1), null);

    expect(report.total_available).toBe(10_001);
    expect(report.total_is_ceiling).toBe(false);
  });

  it("is false when no total was readable", () => {
    const report = parseFilterReport(payload([], undefined), null);

    expect(report.total_available).toBeNull();
    expect(report.total_is_ceiling).toBe(false);
  });
});

describe("rule 7: filters absent or not an array renders an empty list", () => {
  it("renders an empty list for the payload carrying no filters key", () => {
    const report = parseFilterReport(absent, "chicken");

    expect(report.filters).toEqual([]);
    expect(report.filter_count).toBe(0);
    expect(report.total_available).toBe(5);
  });

  it("renders an empty list for a payload whose filters is not an array", () => {
    for (const shape of ["nope", 42, {}, null, true]) {
      const report = parseFilterReport(payload(shape, 5), "chicken");

      expect(report.filters).toEqual([]);
      expect(report.filter_count).toBe(0);
    }
  });

  it("renders an empty list, without discarding anything, for a genuine absence of facets", () => {
    const { groups, skipped } = parseFilterGroups(none);
    const report = parseFilterReport(none, "zzzz");

    expect(groups).toEqual([]);
    expect(skipped).toHaveLength(0);
    expect(report.filters).toEqual([]);
    expect(report.filter_count).toBe(0);
    expect(report.total_available).toBe(0);
    expect(report.total_is_ceiling).toBe(false);
  });

  it("discards a filters entry that is not an object, without failing", () => {
    const { groups } = parseFilterGroups(
      payload(["nope", null, { label: "Diets", name: "diet", options: [] }], 5),
    );

    expect(groups.map((group) => group.name)).toEqual(["diet"]);
  });
});

describe("rule 8: a payload without searchResults is a parse failure", () => {
  it("throws GoodFoodError with code parse_failure on the unreadable payload", () => {
    const error = thrownBy(() => parseFilterReport(unreadable, "chicken"));

    expect(error).toBeInstanceOf(GoodFoodError);
    expect((error as GoodFoodError).name).toBe("GoodFoodError");
    expect((error as GoodFoodError).code).toBe("parse_failure");
  });

  it("throws rather than disguising a breakdown as an empty answer", () => {
    for (const shape of [{}, { filters: [] }, { searchResults: null }, { searchResults: "nope" }]) {
      const error = thrownBy(() => parseFilterReport(shape, null));

      expect(error).toBeInstanceOf(GoodFoodError);
      expect((error as GoodFoodError).code).toBe("parse_failure");
    }
  });
});

describe("rule 9: total_available is null unless the total is a whole count", () => {
  it("is null when totalItems is absent", () => {
    expect(
      parseFilterReport({ searchResults: { limit: 30, items: [] } }, null).total_available,
    ).toBeNull();
  });

  it("is null when totalItems is negative, fractional, a string or NaN", () => {
    for (const totalItems of [-1, -10_000, 12.5, "151", "", Number.NaN, true, null, {}]) {
      const report = parseFilterReport(payload([], totalItems), null);

      expect(report.total_available).toBeNull();
      expect(report.total_is_ceiling).toBe(false);
    }
  });

  it("reads zero as zero, since no recipe matched is a real answer", () => {
    const report = parseFilterReport(payload([], 0), "zzzz");

    expect(report.total_available).toBe(0);
  });
});

describe("skipped is absent when nothing was discarded", () => {
  it("carries no discarded name for a whole payload", () => {
    const { skipped } = parseFilterGroups(fixture("filters-scoped.json"));

    expect(skipped).toHaveLength(0);
  });

  // The report never carries an empty list of discards: a caller reads the
  // absence of the field, rather than an empty array that looks like a finding.
  it("leaves no skipped field on the report of a whole payload", () => {
    const report = parseFilterReport(fixture("filters-scoped.json"), "chicken");

    expect(Object.hasOwn(report, "skipped")).toBe(false);
  });
});
