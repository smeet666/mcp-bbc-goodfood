/**
 * A rating nobody gave, and the notes that count rows.
 *
 * The site publishes ratings on a scale of 1 to 5 and answers a recipe nobody
 * rated with a zero, so rendering that zero would rank an unjudged recipe at
 * the bottom of the scale. The count of voters answers a different question and
 * keeps its zero.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseSearchRows } from "../../src/bbcgoodfood/parse.js";
import { runSearchRecipes } from "../../src/tools/searchRecipes.js";
import type { Read, SearchReport, SearchRow } from "../../src/types.js";

type Client = Parameters<typeof runSearchRecipes>[0];
type Args = Parameters<typeof runSearchRecipes>[1];

/**
 * The first number a note states, and the first verb after it that carries
 * number. Matching stops at the end of the sentence, so a later clause cannot
 * lend its verb to the count.
 */
const COUNT_AND_VERB = /\b(\d+)\b[^.!?]*?\b(was|were|is|are|has|have)\b/i;
const SINGULAR_VERBS = ["was", "is", "has"];

/** The note about rows held back by the site's subscription. */
const SUBSCRIPTION_NOTE = /subscription|premium/i;
/** The note about rows set aside for want of an identifier, a title or an address. */
const UNREADABLE_NOTE = /identifier|title|address|set aside|skipped|dropped/i;

const searchPayload = (rating: unknown): unknown => ({
  searchResults: {
    totalItems: 1,
    limit: 30,
    items: [
      {
        id: "301",
        title: "Rhubarb & ginger no-gin fizz",
        url: "https://www.bbcgoodfood.com/recipes/rhubarb-ginger-no-gin-fizz",
        isPremium: false,
        rating,
        image: { url: "https://images.example.invalid/rhubarb.jpg" },
        authorName: "Wren Holloway",
        terms: [
          { slug: "time", display: "10 mins" },
          { slug: "skillLevel", display: "Easy" },
        ],
      },
    ],
  },
});

const onlyRow = (rating: unknown): SearchRow => {
  const parsed = parseSearchRows(searchPayload(rating));
  expect(parsed.skipped).toStrictEqual([]);
  expect(parsed.rows).toHaveLength(1);
  const row = parsed.rows[0];
  if (row === undefined) {
    throw new Error("the payload carries one readable row");
  }
  return row;
};

const searchRow = (index: number, premium: boolean): SearchRow => ({
  id: `30${index}`,
  title: `Lemon tart number ${index}`,
  url: `https://www.bbcgoodfood.com/recipes/lemon-tart-${index}`,
  image_url: null,
  rating: 4,
  rating_count: 12,
  premium,
  total_minutes: 30,
  difficulty: "Easy",
  author: "Wren Holloway",
});

const clientServing = (rows: SearchRow[], skipped: string[]): Client => {
  const read: Read<SearchReport> = {
    data: {
      query: "lemon",
      results: rows,
      result_count: rows.length,
      total_available: 12,
      total_is_ceiling: false,
      rows_seen: rows.length + skipped.length,
      restrictions_dropped: [],
    },
    cached: false,
    skipped,
  };
  return { searchRecipes: () => Promise.resolve(read) } as unknown as Client;
};

const notesOf = (structured: Record<string, unknown> | undefined): string[] => {
  const notes = structured?.["notes"];
  expect(Array.isArray(notes)).toBe(true);
  return (notes as string[] | undefined) ?? [];
};

const noteMatching = (notes: string[], topic: RegExp): string => {
  const note = notes.find((candidate) => topic.test(candidate) && /\d/.test(candidate));
  if (note === undefined) {
    throw new Error(`no note counting rows about ${topic.source} among: ${notes.join(" | ")}`);
  }
  return note;
};

/**
 * The count is stated in figures and is exact, and the verb that follows it
 * agrees with it. Any wording is accepted as long as those two hold.
 */
const expectAgreement = (note: string, count: number): void => {
  const match = COUNT_AND_VERB.exec(note);
  expect(match, `no counted verb in: ${note}`).not.toBeNull();
  const digits = match?.[1];
  const verb = (match?.[2] ?? "").toLowerCase();
  expect(digits, `the count is stated in figures in: ${note}`).toBe(String(count));
  if (count === 1) {
    expect(SINGULAR_VERBS, `a count of one takes a singular verb in: ${note}`).toContain(verb);
  } else {
    expect(SINGULAR_VERBS, `a count above one takes a plural verb in: ${note}`).not.toContain(verb);
  }
};

const runWith = (client: Client, args: Args) => runSearchRecipes(client, args);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a rating nobody gave", () => {
  test("a zero rating with no voter renders no rating and keeps the zero count", () => {
    const row = onlyRow({ ratingValue: 0, ratingCount: 0, hasRatingCount: true });
    expect(row.rating).toBeNull();
    expect(row.rating_count).toBe(0);
  });

  test("a rating with no voter renders no rating whatever the value", () => {
    const row = onlyRow({ ratingValue: 4, ratingCount: 0 });
    expect(row.rating).toBeNull();
    expect(row.rating_count).toBe(0);
  });

  test("a zero rating renders no rating even when the site counts voters", () => {
    const row = onlyRow({ ratingValue: 0, ratingCount: 12 });
    expect(row.rating).toBeNull();
    expect(row.rating_count).toBe(12);
  });
});

describe("a count of voters the site did not establish", () => {
  const unreadable: { name: string; rating: Record<string, unknown> }[] = [
    { name: "absent", rating: { ratingValue: 3.5 } },
    { name: "a string", rating: { ratingValue: 3.5, ratingCount: "many" } },
    { name: "null", rating: { ratingValue: 3.5, ratingCount: null } },
    { name: "negative", rating: { ratingValue: 3.5, ratingCount: -4 } },
    { name: "fractional", rating: { ratingValue: 3.5, ratingCount: 2.5 } },
  ];

  for (const { name, rating } of unreadable) {
    test(`a count that is ${name} leaves both fields empty`, () => {
      const row = onlyRow(rating);
      expect(row.rating).toBeNull();
      expect(row.rating_count).toBeNull();
    });
  }
});

describe("a rating the site did publish", () => {
  test("a rating with voters travels through unchanged", () => {
    const row = onlyRow({ ratingValue: 3.5, ratingCount: 2 });
    expect(row.rating).toBe(3.5);
    expect(row.rating_count).toBe(2);
  });

  test("the bottom of the scale travels through", () => {
    const row = onlyRow({ ratingValue: 1, ratingCount: 1 });
    expect(row.rating).toBe(1);
    expect(row.rating_count).toBe(1);
  });

  test("the top of the scale travels through", () => {
    const row = onlyRow({ ratingValue: 5, ratingCount: 1 });
    expect(row.rating).toBe(5);
    expect(row.rating_count).toBe(1);
  });
});

describe("a rating that is not an object", () => {
  const shapes: { name: string; rating: unknown }[] = [
    { name: "absent", rating: undefined },
    { name: "null", rating: null },
    { name: "a string", rating: "4" },
    { name: "a number", rating: 4 },
  ];

  for (const { name, rating } of shapes) {
    test(`a rating that is ${name} leaves both fields empty`, () => {
      const row = onlyRow(rating);
      expect(row.rating).toBeNull();
      expect(row.rating_count).toBeNull();
    });
  }
});

describe("the note about rows held back by the subscription", () => {
  test("one row removed is stated in the singular", async () => {
    const client = clientServing([searchRow(1, true), searchRow(2, false)], []);
    const result = await runWith(client, { query: "lemon", exclude_premium: true });
    expectAgreement(noteMatching(notesOf(result.structuredContent), SUBSCRIPTION_NOTE), 1);
  });

  test("three rows removed are stated in the plural", async () => {
    const rows = [searchRow(1, true), searchRow(2, true), searchRow(3, true), searchRow(4, false)];
    const client = clientServing(rows, []);
    const result = await runWith(client, { query: "lemon", exclude_premium: true });
    expectAgreement(noteMatching(notesOf(result.structuredContent), SUBSCRIPTION_NOTE), 3);
  });
});

describe("the note about rows set aside as unreadable", () => {
  test("one row set aside is stated in the singular", async () => {
    const client = clientServing([searchRow(1, false)], ["row 2: no identifier"]);
    const result = await runWith(client, { query: "lemon" });
    expectAgreement(noteMatching(notesOf(result.structuredContent), UNREADABLE_NOTE), 1);
  });

  test("three rows set aside are stated in the plural", async () => {
    const skipped = ["row 2: no identifier", "row 3: no title", "row 4: no address"];
    const client = clientServing([searchRow(1, false)], skipped);
    const result = await runWith(client, { query: "lemon" });
    expectAgreement(noteMatching(notesOf(result.structuredContent), UNREADABLE_NOTE), 3);
  });
});
