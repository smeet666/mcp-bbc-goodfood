import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { listFiltersOutputShape, runListFilters } from "../../src/tools/listFilters.js";
import type { FilterGroup, FilterReport, Read } from "../../src/types.js";

const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

const outputSchema = (): z.ZodObject => z.object(listFiltersOutputShape);

function scopedGroups(): FilterGroup[] {
  return [
    {
      name: "diet",
      label: "Diets",
      options: [
        { value: "egg-free", label: "Egg-free", count: 101 },
        { value: "vegetarian", label: "Vegetarian", count: 507 },
      ],
      option_count: 2,
    },
  ];
}

/** A report as the parser hands it over, with the two measured fields stated. */
function madeReport(over: Partial<FilterReport> = {}): FilterReport {
  const filters = over.filters ?? scopedGroups();
  return {
    query: over.query ?? "keldish",
    filters,
    filter_count: filters.length,
    // biome-ignore lint/nursery/useNullishCoalescing: `??` would swallow an explicit null, which this field carries on purpose.
    total_available: over.total_available === undefined ? 151 : over.total_available,
    total_is_ceiling: over.total_is_ceiling ?? false,
    rows_seen: over.rows_seen ?? 3,
    // biome-ignore lint/nursery/useNullishCoalescing: same reason: null is a value the contract distinguishes from a missing one.
    matched_rows: over.matched_rows === undefined ? 2 : over.matched_rows,
  };
}

/** A stand-in for the client: the tool is the subject, the site stays away. */
function fakeClient(given: FilterReport): GoodFoodClient {
  return {
    listFilters: async (): Promise<Read<FilterReport>> => ({ data: given, cached: false }),
  } as unknown as GoodFoodClient;
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(typeof value).toBe("object");
  expect(value).not.toBeNull();
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  return value as unknown[];
}

function notesOf(structuredContent: unknown): string[] {
  const notes = asArray(asRecord(structuredContent).notes);
  for (const note of notes) {
    expect(typeof note).toBe("string");
  }
  return notes as string[];
}

/** The concatenated text of every `content` part, each of which must be text. */
function textOf(content: unknown[]): string {
  expect(content.length).toBeGreaterThan(0);
  return content
    .map((part) => {
      const rec = asRecord(part);
      expect(rec["type"]).toBe("text");
      expect(typeof rec["text"]).toBe("string");
      return rec["text"] as string;
    })
    .join("\n");
}

// The wording of the note is the server's own. What it has to carry is stated
// here as three things at once: that nothing matched, what nothing matched
// among, and what it was matched against.
const SAYS_NONE = /\b(none|no|not one|not a single|nothing|neither)\b/i;
const SAYS_ROWS = /\b(rows?|results?|recipes?|items?|lines?|listings?)\b/i;
const SAYS_SEARCH = /\b(search(ed|es)?|quer(y|ies|ied)|terms?|words?|keywords?)\b/i;
const SAYS_EXCERPT =
  /\b(top\s*\d+|excerpt|extract|sample|subset|selection|partial|not exhaustive)\b/i;
const SAYS_ACCEPTS = /\baccept/i;
const SAYS_UNLISTED =
  /\b(unlisted|not listed|not shown|absent|outside|beyond|other values?|any value)\b/i;
const SAYS_FLOOR = /\b(at least|minimum|floor|lower bound)\b/i;

function saysNothingMatched(note: string): boolean {
  return SAYS_NONE.test(note) && SAYS_ROWS.test(note) && SAYS_SEARCH.test(note);
}

function matchNoteOf(structuredContent: unknown): string | undefined {
  return notesOf(structuredContent).find(saysNothingMatched);
}

describe("runListFilters — the measured rows in structuredContent", () => {
  it("carries rows_seen and matched_rows as the report states them", async () => {
    const out = await runListFilters(fakeClient(madeReport({ rows_seen: 3, matched_rows: 2 })), {
      query: "keldish",
    });
    const sc = asRecord(out.structuredContent);

    expect(sc["rows_seen"]).toBe(3);
    expect(sc["matched_rows"]).toBe(2);
  });

  it("renders nine keys, the seven contracted ones and the two measured ones", async () => {
    const out = await runListFilters(fakeClient(madeReport()), { query: "keldish" });
    const sc = asRecord(out.structuredContent);
    const keys = Object.keys(sc);

    expect(keys).toHaveLength(9);
    expect(keys.sort()).toEqual(
      [
        "filter_count",
        "filters",
        "matched_rows",
        "notes",
        "query",
        "rows_seen",
        "source",
        "total_available",
        "total_is_ceiling",
      ].sort(),
    );
  });

  it("hands back a null matched_rows as it stands, never as zero", async () => {
    const out = await runListFilters(
      fakeClient(madeReport({ query: null, rows_seen: 2, matched_rows: null })),
      {},
    );
    const sc = asRecord(out.structuredContent);

    expect(sc["matched_rows"]).toBeNull();
    expect(sc["matched_rows"]).not.toBe(0);
    expect(sc["rows_seen"]).toBe(2);
  });

  it("hands back a zero rows_seen as it stands", async () => {
    const out = await runListFilters(fakeClient(madeReport({ rows_seen: 0, matched_rows: 0 })), {
      query: "keldish",
    });

    expect(asRecord(out.structuredContent)["rows_seen"]).toBe(0);
  });
});

describe("runListFilters — the note on rows that carry nothing of the search", () => {
  it("says nothing among the rows served carries a word of the search", async () => {
    const out = await runListFilters(fakeClient(madeReport({ rows_seen: 3, matched_rows: 0 })), {
      query: "keldish",
    });
    const note = matchNoteOf(out.structuredContent);

    expect(note, "no note says the served rows carry nothing of the search").toBeDefined();
    expect(textOf(out.content)).toContain(note ?? "");
  });

  it("stays silent when a row carries a word of the search", async () => {
    const out = await runListFilters(fakeClient(madeReport({ rows_seen: 3, matched_rows: 2 })), {
      query: "keldish",
    });

    expect(matchNoteOf(out.structuredContent)).toBeUndefined();
  });

  it("stays silent when nothing was measured", async () => {
    const out = await runListFilters(
      fakeClient(madeReport({ query: null, rows_seen: 2, matched_rows: null })),
      {},
    );

    expect(matchNoteOf(out.structuredContent)).toBeUndefined();
  });

  it("stays silent when the site served no row at all", async () => {
    const out = await runListFilters(
      fakeClient(madeReport({ rows_seen: 0, matched_rows: 0, total_available: 0, filters: [] })),
      { query: "keldish" },
    );

    expect(matchNoteOf(out.structuredContent)).toBeUndefined();
  });
});

describe("runListFilters — the notes that do not move", () => {
  const cases: [string, FilterReport][] = [
    ["rows that carry nothing of the search", madeReport({ rows_seen: 3, matched_rows: 0 })],
    ["rows that carry a word of the search", madeReport({ rows_seen: 3, matched_rows: 2 })],
    ["a search with nothing to measure", madeReport({ query: null, matched_rows: null })],
    ["a search that served no row", madeReport({ rows_seen: 0, matched_rows: 0 })],
  ];

  for (const [label, given] of cases) {
    it(`says the options are an excerpt and that unlisted values are accepted — ${label}`, async () => {
      const out = await runListFilters(fakeClient(given), { query: "keldish" });
      const notes = notesOf(out.structuredContent);

      expect(notes.some((note) => SAYS_EXCERPT.test(note))).toBe(true);
      expect(notes.some((note) => SAYS_ACCEPTS.test(note) && SAYS_UNLISTED.test(note))).toBe(true);
    });
  }

  it("still says the total states a floor at the ceiling, beside the match note", async () => {
    const out = await runListFilters(
      fakeClient(
        madeReport({
          rows_seen: 3,
          matched_rows: 0,
          total_available: 10_000,
          total_is_ceiling: true,
        }),
      ),
      { query: "keldish" },
    );
    const notes = notesOf(out.structuredContent);

    expect(notes.some((note) => SAYS_FLOOR.test(note))).toBe(true);
    expect(matchNoteOf(out.structuredContent)).toBeDefined();
  });

  it("claims no floor when the total is an exact count", async () => {
    const out = await runListFilters(
      fakeClient(madeReport({ rows_seen: 3, matched_rows: 0, total_available: 151 })),
      { query: "keldish" },
    );

    expect(notesOf(out.structuredContent).some((note) => SAYS_FLOOR.test(note))).toBe(false);
  });
});

describe("listFiltersOutputShape — with the measured rows", () => {
  it("describes the output produced when the rows were measured", async () => {
    const out = await runListFilters(fakeClient(madeReport({ rows_seen: 3, matched_rows: 2 })), {
      query: "keldish",
    });
    const parsed = outputSchema().safeParse(out.structuredContent);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(out.structuredContent);
  });

  it("describes the output produced when nothing was measured", async () => {
    const out = await runListFilters(
      fakeClient(madeReport({ query: null, rows_seen: 2, matched_rows: null })),
      {},
    );
    const parsed = outputSchema().safeParse(out.structuredContent);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(out.structuredContent);
    expect(asRecord(parsed.data)["matched_rows"]).toBeNull();
  });
});
