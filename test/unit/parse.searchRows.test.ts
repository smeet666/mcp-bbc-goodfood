import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSearchRows } from "../../src/bbcgoodfood/parse.js";
import type { SearchRow } from "../../src/types.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

/** A search payload carrying exactly the rows a case is about. */
const payloadOf = (items: unknown[]): unknown => ({
  searchResults: { totalItems: items.length, limit: 30, items },
});

/** One readable row, so a case states only the field it is about. */
const rowOf = (extra: Record<string, unknown>): unknown => ({
  id: "1",
  title: "Keldish greens",
  url: "https://www.bbcgoodfood.com/recipes/keldish-greens",
  ...extra,
});

const onlyRow = (extra: Record<string, unknown>): SearchRow => {
  const { rows } = parseSearchRows(payloadOf([rowOf(extra)]));
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

const timeRow = (terms: unknown): SearchRow => onlyRow({ terms });

describe("parseSearchRows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the five rows of a served page in the site's own order", () => {
    const { rows, skipped } = parseSearchRows(fixture("search-page.json"));

    // The identifier is the page's own path. The site's numeric id resolves to
    // nothing a caller can read, so handing it back would name a recipe by
    // something that cannot fetch it.
    expect(rows.map((row: SearchRow) => row.id)).toEqual([
      "recipes/keldish-greens-chorizo",
      "recipes/easy-keldish-bravas",
      "recipes/marran-almond-wafers",
      "recipes/keldish-pepper-broth",
      "recipes/ostrean-plum-tart",
    ]);
    expect(rows.map((row: SearchRow) => row.title)).toEqual([
      "Keldish greens with chorizo",
      "Easy keldish bravas",
      "Marran almond wafers",
      "Keldish pepper broth",
      "Ostrean plum tart",
    ]);
    expect(skipped).toEqual([]);
  });

  it("renders a complete row with every field the shape declares", () => {
    const { rows } = parseSearchRows(fixture("search-page.json"));

    expect(rows[0]).toEqual({
      id: "recipes/keldish-greens-chorizo",
      title: "Keldish greens with chorizo",
      url: "https://www.bbcgoodfood.com/recipes/keldish-greens-chorizo",
      image_url: "https://images.example.invalid/keldish-greens-chorizo.jpg",
      rating: 4.2,
      rating_count: 341,
      premium: false,
      total_minutes: 50,
      difficulty: "Easy",
      author: "Wren Holloway",
    });
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "author",
      "difficulty",
      "id",
      "image_url",
      "premium",
      "rating",
      "rating_count",
      "title",
      "total_minutes",
      "url",
    ]);
  });

  describe("the rating the site published", () => {
    it("carries the value and the count when the site published them", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows[1]!.rating).toBe(3.85);
      expect(rows[1]!.rating_count).toBe(342);
    });

    it("holds null on the row the site rated with nothing", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows[2]!.rating).toBeNull();
      expect(rows[2]!.rating_count).toBeNull();
    });

    // A score runs from one to five and needs someone to have given it, so a
    // zero on either side is not a score. The two rows part company on the
    // count instead: nobody voting is a figure the site established, and what
    // they would have said is not.
    it("tells an absent rating from an unjudged one by the count, neither being a score", () => {
      const absent = onlyRow({ rating: null });
      const zero = onlyRow({ rating: { ratingValue: 0, ratingCount: 0 } });

      expect(absent.rating).toBeNull();
      expect(absent.rating_count).toBeNull();
      expect(zero.rating).toBeNull();
      expect(zero.rating_count).toBe(0);
    });

    it("holds null when the rating object states no figure", () => {
      const partial = onlyRow({ rating: { ratingCount: 12 } });
      const countless = onlyRow({ rating: { ratingValue: 4.5 } });

      expect(partial.rating).toBeNull();
      expect(partial.rating_count).toBe(12);
      // A figure nobody is said to have given is not a rating either, so the
      // score goes with the count that would have stood behind it.
      expect(countless.rating).toBeNull();
      expect(countless.rating_count).toBeNull();
    });

    it("holds null when the row carries no rating key at all", () => {
      const row = onlyRow({});

      expect(row.rating).toBeNull();
      expect(row.rating_count).toBeNull();
    });
  });

  describe("the image address", () => {
    it("carries the address the row publishes", () => {
      const row = onlyRow({ image: { url: "https://images.example.invalid/keldish.jpg" } });

      expect(row.image_url).toBe("https://images.example.invalid/keldish.jpg");
    });

    it("holds null when no address is carried", () => {
      expect(onlyRow({}).image_url).toBeNull();
      expect(onlyRow({ image: null }).image_url).toBeNull();
      expect(onlyRow({ image: { alt: "Keldish greens", width: 440 } }).image_url).toBeNull();
      expect(onlyRow({ image: "not an image" }).image_url).toBeNull();
    });
  });

  describe("the minutes the site states", () => {
    it("reads them from the term whose slug is time", () => {
      expect(timeRow([{ slug: "time", display: "50 mins" }]).total_minutes).toBe(50);
    });

    it("adds the hours to the minutes", () => {
      expect(timeRow([{ slug: "time", display: "1 hr 20 mins" }]).total_minutes).toBe(80);
    });

    it("reads a whole hour and whole hours", () => {
      expect(timeRow([{ slug: "time", display: "1 hr" }]).total_minutes).toBe(60);
      expect(timeRow([{ slug: "time", display: "2 hrs" }]).total_minutes).toBe(120);
    });

    it("ignores a term carrying another slug", () => {
      const row = timeRow([
        { slug: "skillLevel", display: "Easy" },
        { slug: "time", display: "1 hr 20 mins" },
      ]);

      expect(row.total_minutes).toBe(80);
    });

    it("holds null, never zero, on a wording it cannot read", () => {
      const unreadable: unknown[] = [
        [{ slug: "time", display: "a while" }],
        [{ slug: "time", display: "" }],
        [{ slug: "time" }],
        [{ slug: "skillLevel", display: "Easy" }],
        [],
        "not a list of terms",
        null,
      ];

      for (const terms of unreadable) {
        const row = timeRow(terms);
        expect(row.total_minutes).toBeNull();
        expect(row.total_minutes).not.toBe(0);
      }
    });

    it("holds null when the row carries no terms key", () => {
      expect(onlyRow({}).total_minutes).toBeNull();
    });

    it("reads the page's premium row as an hour and twenty minutes", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows[3]!.total_minutes).toBe(80);
      expect(rows.map((row: SearchRow) => row.total_minutes)).toEqual([50, 50, 50, 80, 50]);
    });
  });

  describe("the difficulty the site states", () => {
    it("keeps the site's own wording", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows.map((row: SearchRow) => row.difficulty)).toEqual([
        "Easy",
        "Easy",
        "Easy",
        "More effort",
        "Easy",
      ]);
    });

    it("reads the term whose slug is skillLevel and nothing else", () => {
      const row = onlyRow({
        terms: [
          { slug: "time", display: "50 mins" },
          { slug: "skillLevel", display: "A challenge" },
        ],
      });

      expect(row.difficulty).toBe("A challenge");
    });

    it("holds null when the site states none", () => {
      expect(onlyRow({}).difficulty).toBeNull();
      expect(onlyRow({ terms: [{ slug: "time", display: "50 mins" }] }).difficulty).toBeNull();
      expect(onlyRow({ terms: [{ slug: "skillLevel" }] }).difficulty).toBeNull();
    });
  });

  describe("the subscription mark", () => {
    it("carries what isPremium states", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows.map((row: SearchRow) => row.premium)).toEqual([false, false, false, true, false]);
    });

    it("is false when the field is absent", () => {
      expect(onlyRow({}).premium).toBe(false);
    });
  });

  describe("the author", () => {
    it("carries authorName when the site names one", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows[0]!.author).toBe("Wren Holloway");
    });

    it("holds null on the row the site credits to nobody", () => {
      const { rows } = parseSearchRows(fixture("search-page.json"));

      expect(rows[4]!.author).toBeNull();
      expect(onlyRow({}).author).toBeNull();
      expect(onlyRow({ authorName: null }).author).toBeNull();
    });
  });
});
