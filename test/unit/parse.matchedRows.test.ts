import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFilterReport } from "../../src/bbcgoodfood/parse.js";
import type { FilterReport } from "../../src/types.js";

const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

const scoped = fixture("filters-scoped.json");
const unmatched = fixture("filters-unmatched.json");
const sitewide = fixture("filters-sitewide.json");
const none = fixture("filters-none.json");
const partial = fixture("filters-partial.json");
const absent = fixture("filters-absent.json");

/** A row as the site serves it, reduced to the two fields the match reads. */
function row(title: string, url: string): unknown {
  return {
    id: "900",
    title,
    url,
    isPremium: false,
    rating: null,
    image: { alt: title, height: 400, width: 600 },
  };
}

/**
 * A payload the corpus does not carry, built around whatever `items` holds.
 * The facets are left empty on purpose: this file measures the rows.
 */
function payloadWith(items: unknown): unknown {
  return {
    filters: [],
    searchResults: { totalItems: 3, limit: 30, items },
  };
}

function reportOf(items: unknown, query: string | null): FilterReport {
  return parseFilterReport(payloadWith(items), query);
}

describe("parseFilterReport — the rows the corpus serves", () => {
  it("counts three rows and two matches on the scoped payload searched for keldish", () => {
    const report = parseFilterReport(scoped, "keldish");

    expect(report.rows_seen).toBe(3);
    expect(report.matched_rows).toBe(2);
  });

  it("counts three rows and no match on the unmatched payload searched for keldish", () => {
    const report = parseFilterReport(unmatched, "keldish");

    expect(report.rows_seen).toBe(3);
    expect(report.matched_rows).toBe(0);
  });

  it("measures nothing on a search with no query, and still counts the rows served", () => {
    const report = parseFilterReport(sitewide, null);

    expect(report.matched_rows).toBeNull();
    expect(report.rows_seen).toBe(2);
  });

  it("counts no row when the site served none", () => {
    const report = parseFilterReport(none, "keldish");

    expect(report.rows_seen).toBe(0);
  });

  it("counts no row on the partial payload, without throwing", () => {
    const report = parseFilterReport(partial, "keldish");

    expect(report.rows_seen).toBe(0);
  });

  it("counts no row on the payload with no filters key, without throwing", () => {
    const report = parseFilterReport(absent, "keldish");

    expect(report.rows_seen).toBe(0);
  });
});

describe("parseFilterReport — an items key that is not an array", () => {
  const cases: [string, unknown][] = [
    ["a string", "Braised keldish greens"],
    ["an object", { 0: row("Braised keldish greens", "/recipes/braised-keldish-greens") }],
    ["null", null],
    ["a number", 3],
  ];

  for (const [label, items] of cases) {
    it(`counts no row when items is ${label}`, () => {
      expect(reportOf(items, "keldish").rows_seen).toBe(0);
    });
  }
});

describe("parseFilterReport — how a row matches", () => {
  it("ignores case", () => {
    const report = reportOf([row("KELDISH GREENS", "https://example.test/a")], "keldish");

    expect(report.rows_seen).toBe(1);
    expect(report.matched_rows).toBe(1);
  });

  it("ignores diacritics on the row", () => {
    const report = reportOf([row("Crème brûlée", "https://example.test/a")], "creme brulee");

    expect(report.rows_seen).toBe(1);
    expect(report.matched_rows).toBe(1);
  });

  it("ignores diacritics on the query", () => {
    const report = reportOf([row("Creme brulee", "https://example.test/a")], "crème brûlée");

    expect(report.rows_seen).toBe(1);
    expect(report.matched_rows).toBe(1);
  });

  it("reads the address as well as the title", () => {
    const report = reportOf(
      [row("Braised greens", "https://www.bbcgoodfood.com/recipes/keldish-pepper-broth")],
      "keldish",
    );

    expect(report.rows_seen).toBe(1);
    expect(report.matched_rows).toBe(1);
  });

  it("leaves a row that carries the word nowhere out of the count", () => {
    const report = reportOf(
      [
        row("Braised keldish greens", "https://example.test/a"),
        row("Ginger cordial", "https://example.test/b"),
      ],
      "keldish",
    );

    expect(report.rows_seen).toBe(2);
    expect(report.matched_rows).toBe(1);
  });
});

describe("parseFilterReport — words too short to measure", () => {
  const shortQueries = ["a", "of"];

  for (const query of shortQueries) {
    it(`measures nothing on the query "${query}"`, () => {
      const report = reportOf(
        [row("A loaf of bread", "https://example.test/a-loaf-of-bread")],
        query,
      );

      expect(report.rows_seen).toBe(1);
      expect(report.matched_rows).toBeNull();
    });
  }

  it("measures on the long word alone when a short one sits beside it", () => {
    const report = reportOf(
      [
        row("Braised keldish greens", "https://example.test/braised-keldish-greens"),
        row("A loaf of bread", "https://example.test/a-loaf-of-bread"),
      ],
      "of keldish",
    );

    expect(report.rows_seen).toBe(2);
    expect(report.matched_rows).toBe(1);
  });
});

describe("parseFilterReport — a row counts once", () => {
  it("counts a row carrying two words of the query once", () => {
    const report = reportOf(
      [
        row("Braised keldish greens", "https://example.test/braised-keldish-greens"),
        row("Ginger cordial", "https://example.test/ginger-cordial"),
      ],
      "keldish greens",
    );

    expect(report.rows_seen).toBe(2);
    expect(report.matched_rows).toBe(1);
  });
});

describe("parseFilterReport — an unreadable row", () => {
  const unreadable: unknown[] = [null, "Braised keldish greens", { id: "904", rating: null }];

  it("counts an unreadable row as served and never as a match", () => {
    const report = reportOf(
      [...unreadable, row("Braised keldish greens", "https://example.test/a")],
      "keldish",
    );

    expect(report.rows_seen).toBe(4);
    expect(report.matched_rows).toBe(1);
  });

  it("matches nothing when every row is unreadable", () => {
    const report = reportOf(unreadable, "keldish");

    expect(report.rows_seen).toBe(3);
    expect(report.matched_rows).toBe(0);
  });
});

describe("parseFilterReport — matched_rows never exceeds rows_seen", () => {
  const cases: [string, unknown, string | null][] = [
    ["the scoped payload", scoped, "keldish"],
    ["the unmatched payload", unmatched, "keldish"],
    ["the sitewide payload with no query", sitewide, null],
    ["the sitewide payload with a query", sitewide, "keldish"],
    ["a payload with no row", none, "keldish"],
    ["the partial payload", partial, "keldish"],
    ["the payload with no filters key", absent, "keldish"],
    ["rows built here", payloadWith([row("Keldish broth", "https://example.test/a")]), "keldish"],
    [
      "rows built here, none of them carrying the word",
      payloadWith([row("Ginger cordial", "https://example.test/b")]),
      "keldish",
    ],
    ["unreadable rows built here", payloadWith([null, "text", {}]), "keldish"],
    ["items that are not an array", payloadWith("keldish"), "keldish"],
  ];

  for (const [label, payload, query] of cases) {
    it(`holds on ${label}`, () => {
      const report = parseFilterReport(payload, query);
      const matched = report.matched_rows;

      expect(report.rows_seen).toBeGreaterThanOrEqual(0);
      if (matched !== null) {
        expect(matched).toBeLessThanOrEqual(report.rows_seen);
      }
    });
  }
});
