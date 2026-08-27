/**
 * What `exclude_premium` does to the rows and to the counters.
 *
 * The removal belongs to the tool, so the fake client hands back the page the
 * site served, premium rows included, whatever the argument says.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoodFoodClient, SearchOptions } from "../../src/bbcgoodfood/client.js";
import { runSearchRecipes, searchRecipesOutputShape } from "../../src/tools/searchRecipes.js";
import type { Read, SearchReport, SearchRow } from "../../src/types.js";

interface FakeClient {
  searchRecipes: (query: string, options?: SearchOptions) => Promise<Read<SearchReport>>;
}

interface ReportOptions {
  rows: SearchRow[];
  rowsSeen?: number;
  totalAvailable?: number;
  matchedRows?: number;
}

const rowOf = (id: string, premium: boolean): SearchRow => ({
  id,
  title: `Vegan ${id} traybake`,
  url: `https://www.bbcgoodfood.com/recipes/${id}`,
  image_url: null,
  rating: 4.5,
  rating_count: 12,
  premium,
  total_minutes: 30,
  difficulty: "Easy",
  author: null,
});

const reportOf = (options: ReportOptions): SearchReport => ({
  query: "vegan",
  results: options.rows,
  result_count: options.rows.length,
  total_available: options.totalAvailable ?? 195,
  total_is_ceiling: false,
  rows_seen: options.rowsSeen ?? options.rows.length,
  restrictions_lifted: [],
});

/** Hands the page back untouched: the argument is the tool's business. */
const clientOf = (report: SearchReport, skipped?: string[]): GoodFoodClient => {
  const fake: FakeClient = {
    searchRecipes: (): Promise<Read<SearchReport>> =>
      Promise.resolve(
        skipped === undefined
          ? { data: report, cached: false }
          : { data: report, cached: false, skipped },
      ),
  };
  // The tool reads a search off the client; the pacing and the store the real
  // one owns play no part here.
  return fake as unknown as GoodFoodClient;
};

const structuredOf = (result: unknown): Record<string, unknown> => {
  const held = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
  if (held === undefined) {
    throw new Error("the tool returned no structuredContent");
  }
  return held;
};

const notesOf = (result: unknown): string[] => {
  const notes = structuredOf(result)["notes"];
  return Array.isArray(notes) ? (notes as string[]) : [];
};

const idsOf = (result: unknown): string[] => {
  const rows = structuredOf(result)["results"] as SearchRow[];
  return rows.map((row) => row.id);
};

const mixedRows: SearchRow[] = [
  rowOf("r1", false),
  rowOf("r2", true),
  rowOf("r3", false),
  rowOf("r4", true),
  rowOf("r5", false),
];

describe("runSearchRecipes and exclude_premium", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the premium rows when the argument is left out", async () => {
    const client = clientOf(reportOf({ rows: mixedRows }));

    const result = await runSearchRecipes(client, { query: "vegan" });

    expect(idsOf(result)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(structuredOf(result)["premium_dropped"]).toBe(0);
    expect(structuredOf(result)["result_count"]).toBe(5);
  });

  it("keeps the premium rows when the argument is false", async () => {
    const client = clientOf(reportOf({ rows: mixedRows }));

    const result = await runSearchRecipes(client, { query: "vegan", exclude_premium: false });

    expect(idsOf(result)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(structuredOf(result)["premium_dropped"]).toBe(0);
    expect(structuredOf(result)["result_count"]).toBe(5);
  });

  it("removes the premium rows and counts them when the argument is true", async () => {
    const client = clientOf(reportOf({ rows: mixedRows }));

    const result = await runSearchRecipes(client, { query: "vegan", exclude_premium: true });

    expect(idsOf(result)).toEqual(["r1", "r3", "r5"]);
    const rendered = structuredOf(result)["results"] as SearchRow[];
    expect(rendered.every((row) => row.premium === false)).toBe(true);
    expect(structuredOf(result)["premium_dropped"]).toBe(2);
  });

  it("moves result_count with the removal while rows_seen and total_available stay put", async () => {
    const report = reportOf({ rows: mixedRows, totalAvailable: 195 });

    const kept = await runSearchRecipes(clientOf(report), {
      query: "vegan",
      exclude_premium: false,
    });
    const trimmed = await runSearchRecipes(clientOf(report), {
      query: "vegan",
      exclude_premium: true,
    });

    expect(structuredOf(kept)["result_count"]).toBe(5);
    expect(structuredOf(trimmed)["result_count"]).toBe(3);

    // What the site served, which the removal never touches.
    expect(structuredOf(kept)["rows_seen"]).toBe(5);
    expect(structuredOf(trimmed)["rows_seen"]).toBe(5);

    // The site's own total, premium included.
    expect(structuredOf(kept)["total_available"]).toBe(195);
    expect(structuredOf(trimmed)["total_available"]).toBe(195);
  });

  it("counts rows set aside and rows removed separately, and adds them nowhere", async () => {
    // Nine rows served, three of them unreadable, four of the six readable ones premium.
    const rows: SearchRow[] = [
      rowOf("k1", false),
      rowOf("k2", false),
      rowOf("p1", true),
      rowOf("p2", true),
      rowOf("p3", true),
      rowOf("p4", true),
    ];
    const client = clientOf(reportOf({ rows, rowsSeen: 9, matchedRows: 6 }), [
      "row 3: no id",
      "row 5: no title",
      "row 8: no url",
    ]);

    const result = await runSearchRecipes(client, { query: "vegan", exclude_premium: true });

    expect(structuredOf(result)["premium_dropped"]).toBe(4);
    expect(structuredOf(result)["result_count"]).toBe(2);
    expect(structuredOf(result)["rows_seen"]).toBe(9);

    const notes = notesOf(result);
    expect(notes.some((note) => /\b3\b/.test(note))).toBe(true);
    expect(notes.some((note) => /\b4\b/.test(note))).toBe(true);
    // Three set aside plus four removed is seven of nothing: the two causes are
    // different claims and no note may state their sum.
    expect(notes.some((note) => /\b7\b/.test(note))).toBe(false);
  });

  it("renders an empty page with the site's total when every row is premium", async () => {
    const rows: SearchRow[] = [
      rowOf("p1", true),
      rowOf("p2", true),
      rowOf("p3", true),
      rowOf("p4", true),
    ];
    const client = clientOf(reportOf({ rows, totalAvailable: 195 }));

    const result = await runSearchRecipes(client, { query: "vegan", exclude_premium: true });

    expect(structuredOf(result)["results"]).toEqual([]);
    expect(structuredOf(result)["result_count"]).toBe(0);
    expect(structuredOf(result)["premium_dropped"]).toBe(4);
    expect(structuredOf(result)["total_available"]).toBe(195);
  });

  it("returns output the published schema parses whole, with and without the removal", async () => {
    const schema = z.object(searchRecipesOutputShape);
    const report = reportOf({ rows: mixedRows });

    const kept = await runSearchRecipes(clientOf(report), {
      query: "vegan",
      exclude_premium: false,
    });
    const trimmed = await runSearchRecipes(clientOf(report), {
      query: "vegan",
      exclude_premium: true,
    });

    // Zod drops what the shape does not declare, so equality says the schema
    // publishes every field the tool renders.
    expect(schema.parse(structuredOf(kept))).toEqual(structuredOf(kept));
    expect(schema.parse(structuredOf(trimmed))).toEqual(structuredOf(trimmed));
  });
});
