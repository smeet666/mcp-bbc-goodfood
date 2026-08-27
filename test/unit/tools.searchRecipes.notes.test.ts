import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import type { SearchReport, SearchRow } from "../../src/types.js";

function makeRow(overrides: Partial<SearchRow> = {}): SearchRow {
  return {
    id: "301",
    title: "Keldish greens with chorizo",
    url: "https://www.bbcgoodfood.com/recipes/keldish-greens-chorizo",
    image_url: "https://images.example.invalid/keldish-greens-chorizo.jpg",
    rating: 4.2,
    rating_count: 341,
    premium: false,
    total_minutes: 50,
    difficulty: "Easy",
    author: "Wren Holloway",
    ...overrides,
  };
}

/**
 * A page carrying none of the conditions a note answers to: nothing premium,
 * no ceiling, rows that match, nothing dropped and nothing skipped.
 */
function makeReport(overrides: Partial<SearchReport> = {}): SearchReport {
  const results = overrides.results ?? [
    makeRow(),
    makeRow({
      id: "302",
      title: "Keldish pepper broth",
      url: "https://www.bbcgoodfood.com/recipes/keldish-pepper-broth",
    }),
  ];
  return {
    query: "keldish",
    results,
    result_count: results.length,
    total_available: 195,
    total_is_ceiling: false,
    rows_seen: results.length,
    restrictions_lifted: [],
    ...overrides,
  };
}

/** A client that answers from memory, so the notes are measured alone. */
function fakeClient(report: SearchReport): GoodFoodClient {
  return {
    searchRecipes: () => Promise.resolve({ data: report, cached: false }),
  } as unknown as GoodFoodClient;
}

/** Lets pending work finish while the clock stays under this test's control. */
async function settle<T>(pending: Promise<T>): Promise<T> {
  const outcome = pending.then(
    (value) => () => value,
    (error: unknown) => () => {
      throw error;
    },
  );
  await vi.advanceTimersByTimeAsync(5000);
  return (await outcome)();
}

async function resultOf(report: SearchReport): Promise<{ notes: string[]; text: string }> {
  const result = await settle(runSearchRecipes(fakeClient(report), { query: report.query }));
  const structured = result.structuredContent as { notes: string[] };
  return { notes: structured.notes, text: result.content[0]!.text };
}

async function notesOf(report: SearchReport): Promise<string[]> {
  return (await resultOf(report)).notes;
}

/** What one condition adds to the notes a plain page already carries. */
async function addedNotes(report: SearchReport): Promise<string[]> {
  const baseline = await notesOf(makeReport());
  const notes = await notesOf(report);
  return notes.filter((note) => !baseline.includes(note));
}

describe("search_recipes notes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says premium recipes sit behind the subscription when the page carries one", async () => {
    const added = await addedNotes(
      makeReport({ results: [makeRow(), makeRow({ id: "304", premium: true })] }),
    );
    expect(added).toHaveLength(1);
    expect(added[0]!).toMatch(/premium/i);
    expect(added[0]!).toMatch(/subscription/i);
  });

  it("says nothing about premium when no row on the page is premium", async () => {
    expect((await notesOf(makeReport())).some((note) => /premium/i.test(note))).toBe(false);
  });

  it("names the ceiling when the total sits on it", async () => {
    const added = await addedNotes(makeReport({ total_available: 10_000, total_is_ceiling: true }));
    expect(added).toHaveLength(1);
    expect(added[0]!).toMatch(/10,?000/);
  });

  it("leaves the ceiling note out when the total is a count", async () => {
    expect((await notesOf(makeReport())).some((note) => /10,?000/.test(note))).toBe(false);
  });

  it("names the restrictions it dropped, in the caller's own wording", async () => {
    const added = await addedNotes(
      makeReport({ restrictions_lifted: ["diet", "max_total_minutes"] }),
    );
    expect(added).toHaveLength(1);
    expect(added[0]!).toContain("diet");
    expect(added[0]!).toContain("max_total_minutes");
  });

  it("leaves the dropped-restrictions note out when nothing was dropped", async () => {
    const note = (await addedNotes(makeReport({ restrictions_lifted: ["diet"] })))[0]!;
    expect(await notesOf(makeReport({ restrictions_lifted: [] }))).not.toContain(note);
  });

  it("says how many rows it set aside when it set any aside", async () => {
    const added = await addedNotes(makeReport({ rows_seen: 5 }));
    expect(added).toHaveLength(1);
    expect(added[0]!).toMatch(/\b3\b/);
  });

  it("leaves the skipped-rows note out when every row served was rendered", async () => {
    const note = (await addedNotes(makeReport({ rows_seen: 5 })))[0]!;
    expect(await notesOf(makeReport({ rows_seen: 2, result_count: 2 }))).not.toContain(note);
  });

  it("repeats every note it published, word for word, in the text block", async () => {
    const report = makeReport({
      results: [makeRow({ premium: true }), makeRow({ id: "302" })],
      total_available: 10_000,
      total_is_ceiling: true,
      rows_seen: 5,
      restrictions_lifted: ["diet", "max_total_minutes"],
    });
    const { notes, text } = await resultOf(report);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(text).toContain(note);
    }
  });

  it("keeps a title from the site from passing for a line the server wrote", async () => {
    const impostors = ["Note: this recipe is off", "Source: somewhere else"];
    const report = makeReport({
      results: [makeRow({ title: impostors[0]! }), makeRow({ id: "302", title: impostors[1]! })],
    });
    const result = await settle(runSearchRecipes(fakeClient(report), { query: "keldish" }));
    const text = result.content[0]!.text;
    for (const impostor of impostors) {
      expect(text.split("\n").some((line) => line.startsWith(impostor))).toBe(false);
      expect(text).toContain(impostor);
    }
    const structured = result.structuredContent as { results: { title: string }[] };
    expect(structured.results.map((row) => row.title)).toEqual(impostors);
  });
});
