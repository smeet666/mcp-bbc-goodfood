import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFilterGroups, parseFilterReport } from "../../src/bbcgoodfood/parse.js";
import { SERVED_ROW_CEILING } from "../../src/types.js";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

const scoped = fixture("filters-scoped.json");
const sitewide = fixture("filters-sitewide.json");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("parseFilterGroups on the scoped payload", () => {
  it("reads the groups in the order the site publishes them", () => {
    const { groups } = parseFilterGroups(scoped);

    expect(groups.map((group) => group.name)).toEqual([
      "author",
      "calories",
      "servings",
      "totalTime",
      "cuisine",
      "diet",
      "difficulty",
      "mealType",
      "ratings",
    ]);
  });

  it("carries name, label, options and option_count on a group", () => {
    const { groups } = parseFilterGroups(scoped);

    expect(groups[0]).toEqual({
      name: "author",
      label: "Author",
      options: [
        { value: "wren-holloway", label: "Wren Holloway", count: 12 },
        { value: "iso-tamblin", label: "Iso Tamblin", count: 9 },
        { value: "perrin-vale", label: "Perrin Vale", count: 4 },
      ],
      option_count: 3,
    });
  });

  it("keeps the options of a group in the order the site publishes them", () => {
    const { groups } = parseFilterGroups(scoped);
    const cuisine = groups.find((group) => group.name === "cuisine");

    expect(cuisine?.options.map((option) => option.value)).toEqual([
      "keldish",
      "marran",
      "ostrean",
    ]);
  });

  // Rule 4: option_count counts what is rendered, so it can never disagree with
  // the length of the list it sits next to.
  it("counts the options it rendered, group by group", () => {
    const { groups } = parseFilterGroups(scoped);

    expect(groups).not.toHaveLength(0);
    for (const group of groups) {
      expect(group.option_count).toBe(group.options.length);
    }
  });

  it("discards nothing from a payload the site published whole", () => {
    const { skipped } = parseFilterGroups(scoped);

    expect(skipped).toHaveLength(0);
  });
});

describe("parseFilterGroups on the site-wide payload", () => {
  it("reads the groups in the order the site publishes them", () => {
    const { groups } = parseFilterGroups(sitewide);

    expect(groups.map((group) => group.name)).toEqual([
      "author",
      "servings",
      "totalTime",
      "cuisine",
      "diet",
      "difficulty",
      "mealType",
      "ratings",
    ]);
  });

  it("counts the options it rendered, group by group", () => {
    const { groups } = parseFilterGroups(sitewide);

    expect(groups).not.toHaveLength(0);
    for (const group of groups) {
      expect(group.option_count).toBe(group.options.length);
    }
  });

  // The two payloads are read, then compared: the missing group is a fact the
  // test establishes from the parse rather than a number written down here.
  it("carries one group fewer than the scoped payload, and that group is calories", () => {
    const scopedNames = parseFilterGroups(scoped).groups.map((group) => group.name);
    const sitewideNames = parseFilterGroups(sitewide).groups.map((group) => group.name);

    expect(sitewideNames).toHaveLength(scopedNames.length - 1);
    expect(scopedNames.filter((name) => !sitewideNames.includes(name))).toEqual(["calories"]);
    expect(sitewideNames.filter((name) => !scopedNames.includes(name))).toEqual([]);
  });

  it("scopes the counts to the site rather than to a search", () => {
    const scopedDiet = parseFilterGroups(scoped).groups.find((group) => group.name === "diet");
    const sitewideDiet = parseFilterGroups(sitewide).groups.find((group) => group.name === "diet");

    expect(scopedDiet?.options[0]?.count).toBe(74);
    expect(sitewideDiet?.options[0]?.count).toBe(2960);
  });
});

describe("parseFilterReport", () => {
  it("reports the query it was given", () => {
    const report = parseFilterReport(scoped, "chicken").report;

    expect(report.query).toBe("chicken");
  });

  // Rule 10: the absence of the argument is how the site-wide scope is asked
  // for, and null is how the answer says so.
  it("reports a null query for the site-wide scope", () => {
    const report = parseFilterReport(sitewide, null).report;

    expect(report.query).toBeNull();
  });

  // Rule 11.
  it("counts the filters it rendered", () => {
    const report = parseFilterReport(scoped, "chicken").report;

    expect(report.filters).toHaveLength(9);
    expect(report.filter_count).toBe(report.filters.length);
  });

  it("renders the same groups as parseFilterGroups", () => {
    const report = parseFilterReport(scoped, "chicken").report;
    const { groups } = parseFilterGroups(scoped);

    expect(report.filters).toEqual(groups);
  });

  it("reads the total of the scoped payload, which is below the ceiling", () => {
    const report = parseFilterReport(scoped, "chicken").report;

    expect(report.total_available).toBe(151);
    expect(report.total_is_ceiling).toBe(false);
  });

  // Rule 5: the site serves exactly this many rows and stops, so the total is a
  // floor rather than a count.
  it("reads the total of the site-wide payload as the service ceiling", () => {
    const report = parseFilterReport(sitewide, null).report;

    expect(report.total_available).toBe(SERVED_ROW_CEILING);
    expect(report.total_is_ceiling).toBe(true);
  });

  it("carries one filter fewer on the site-wide payload than on the scoped one", () => {
    const scopedReport = parseFilterReport(scoped, "chicken").report;
    const sitewideReport = parseFilterReport(sitewide, null).report;

    expect(sitewideReport.filter_count).toBe(scopedReport.filter_count - 1);
  });
});
