/**
 * The notes that keep a trimmed page honest.
 *
 * A page cut down by `exclude_premium` comes back shorter than the limit that
 * was asked for, which reads as an exhausted listing unless a note says
 * otherwise. The wording is left to the tool, so these tests match on what a
 * note has to carry rather than on a sentence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodFoodClient, SearchOptions } from "../../src/bbcgoodfood/client.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import type { Read, SearchReport, SearchRow } from "../../src/types.js";

interface FakeClient {
  searchRecipes: (query: string, options?: SearchOptions) => Promise<Read<SearchReport>>;
}

/** Rows behind the subscription, named as such. */
const SUBSCRIPTION = /premium|subscription|subscriber/i;
/** A note reporting that rows left the page. */
const REMOVAL = /remov|dropp|exclud|left out|filtered/i;
/** A note holding out the possibility of more. */
const MORE = /more|further|next|another page|remain/i;
/** A note speaking of the page or of what it holds. */
const PAGE = /page|rows|results|recipes/i;

const rowOf = (id: string, premium: boolean): SearchRow => ({
  id,
  title: `Vegan ${id} traybake`,
  url: `https://www.bbcgoodfood.com/recipes/${id}`,
  image_url: null,
  rating: 4,
  rating_count: 30,
  premium,
  total_minutes: 25,
  difficulty: "Easy",
  author: "BBC Good Food",
});

/** `count` rows, the first `premium` of them behind the subscription. */
const rowsOf = (count: number, premium: number): SearchRow[] =>
  Array.from({ length: count }, (_unused, index) => rowOf(`r${index + 1}`, index < premium));

const reportOf = (rows: SearchRow[]): SearchReport => ({
  query: "vegan",
  results: rows,
  result_count: rows.length,
  total_available: 195,
  total_is_ceiling: false,
  rows_seen: rows.length,
  restrictions_lifted: [],
});

/** Hands the page back untouched: the argument is the tool's business. */
const clientOf = (rows: SearchRow[]): GoodFoodClient => {
  const fake: FakeClient = {
    searchRecipes: (): Promise<Read<SearchReport>> =>
      Promise.resolve({ data: reportOf(rows), cached: false }),
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

const textOf = (result: unknown): string =>
  (result as { content: { type: string; text?: string }[] }).content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");

const shortPageNotes = (result: unknown): string[] =>
  notesOf(result).filter((note) => MORE.test(note) && PAGE.test(note));

describe("the notes of a page trimmed of its premium rows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the kept rows sit behind the subscription", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 2)), {
      query: "vegan",
      limit: 5,
      exclude_premium: false,
    });

    // The note about the rows themselves, told apart from the one reporting a
    // removal, which names the subscription too.
    const kept = notesOf(result).filter((note) => SUBSCRIPTION.test(note) && !REMOVAL.test(note));
    expect(kept.length).toBeGreaterThan(0);
  });

  it("drops the subscription note once no premium row is left", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 2)), {
      query: "vegan",
      limit: 5,
      exclude_premium: true,
    });

    const rendered = structuredOf(result)["results"] as SearchRow[];
    expect(rendered.every((row) => row.premium === false)).toBe(true);
    const kept = notesOf(result).filter((note) => SUBSCRIPTION.test(note) && !REMOVAL.test(note));
    expect(kept).toEqual([]);
  });

  it("says how many rows were removed", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 2)), {
      query: "vegan",
      limit: 5,
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(2);
    const removal = notesOf(result).filter((note) => REMOVAL.test(note) && /\b2\b/.test(note));
    expect(removal.length).toBeGreaterThan(0);
  });

  it("reports no removal when nothing was removed", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 2)), {
      query: "vegan",
      limit: 5,
      exclude_premium: false,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(0);
    const removal = notesOf(result).filter((note) => REMOVAL.test(note) && /\d/.test(note));
    expect(removal).toEqual([]);
  });

  it("stays quiet when nothing was removed and the page is full", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(4, 0)), {
      query: "vegan",
      limit: 4,
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(0);
    expect(structuredOf(result)["result_count"]).toBe(4);
    expect(shortPageNotes(result)).toEqual([]);
  });

  it("stays quiet when nothing was removed and the page is short", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(2, 0)), {
      query: "vegan",
      limit: 4,
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(0);
    expect(structuredOf(result)["result_count"]).toBe(2);
    // A short page the site itself served is a real end of listing.
    expect(shortPageNotes(result)).toEqual([]);
  });

  it("stays quiet when rows were removed and the page is still full", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(4, 2)), {
      query: "vegan",
      limit: 2,
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(2);
    expect(structuredOf(result)["result_count"]).toBe(2);
    expect(shortPageNotes(result)).toEqual([]);
  });

  it("warns that a page shortened by the removal is no end of listing", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 3)), {
      query: "vegan",
      limit: 4,
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(3);
    expect(structuredOf(result)["result_count"]).toBe(2);
    const warning = shortPageNotes(result);
    expect(warning.length).toBeGreaterThan(0);
  });

  it("measures a full page against thirty when no limit was asked for", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(32, 2)), {
      query: "vegan",
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(2);
    expect(structuredOf(result)["result_count"]).toBe(30);
    expect(shortPageNotes(result)).toEqual([]);
  });

  it("warns on a page shortened below thirty when no limit was asked for", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 2)), {
      query: "vegan",
      exclude_premium: true,
    });

    expect(structuredOf(result)["premium_dropped"]).toBe(2);
    expect(structuredOf(result)["result_count"]).toBe(3);
    expect(shortPageNotes(result).length).toBeGreaterThan(0);
  });

  it("prints every published note in the text block, word for word", async () => {
    const result = await runSearchRecipes(clientOf(rowsOf(5, 3)), {
      query: "vegan",
      limit: 4,
      exclude_premium: true,
    });

    const notes = notesOf(result);
    expect(notes.length).toBeGreaterThan(0);
    const text = textOf(result);
    for (const note of notes) {
      expect(text).toContain(note);
    }
  });
});
