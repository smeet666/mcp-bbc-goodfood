import { describe, expect, it } from "vitest";
import { parseSearchRows } from "../../src/bbcgoodfood/parse.js";
import { getRecipeArgs } from "../../src/tools/getRecipe.js";

/**
 * The identifier a row carries is what a later read is given, so it has to be
 * the thing the site answers to: the path of the page. The numeric identifier
 * the payload also carries answers with the site's index instead.
 */

interface RowSeed {
  id: string;
  title: string;
  url: unknown;
  isPremium?: boolean;
}

function payloadOf(rows: RowSeed[]): unknown {
  return {
    searchResults: {
      totalItems: rows.length,
      limit: 30,
      items: rows.map((seed) => ({
        id: seed.id,
        title: seed.title,
        url: seed.url,
        isPremium: seed.isPremium ?? false,
        rating: { ratingValue: 4.2, ratingCount: 341 },
        image: { url: "https://images.example.invalid/row.jpg" },
        authorName: "Wren Holloway",
        terms: [
          { slug: "time", display: "50 mins" },
          { slug: "skillLevel", display: "Easy" },
        ],
      })),
    },
  };
}

function onlyRowOf(seed: RowSeed): ReturnType<typeof parseSearchRows>["rows"][number] {
  const parsed = parseSearchRows(payloadOf([seed]));
  expect(parsed.skipped).toStrictEqual([]);
  expect(parsed.rows).toHaveLength(1);
  return parsed.rows[0]!;
}

describe("the identifier a search row hands back", () => {
  it("is the path of the page, without its leading slash", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    });

    expect(row.id).toBe("recipes/chicken-chorizo-jambalaya");
  });

  it("keeps the row's own full address alongside it", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    });

    expect(row.url).toBe("https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya");
  });

  it("keeps the subscription section a page sits under", () => {
    const row = onlyRowOf({
      id: "5119876",
      title: "Brown sugar pavlova",
      url: "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
      isPremium: true,
    });

    expect(row.id).toBe("premium/brown-sugar-pavlova");
  });

  it("drops a query string", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya?utm_source=search",
    });

    expect(row.id).toBe("recipes/chicken-chorizo-jambalaya");
  });

  it("drops a fragment", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya#method",
    });

    expect(row.id).toBe("recipes/chicken-chorizo-jambalaya");
  });

  it("drops a trailing slash", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya/",
    });

    expect(row.id).toBe("recipes/chicken-chorizo-jambalaya");
  });

  it("never hands back the numeric identifier the payload carries", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    });

    expect(row.id).not.toBe("233479");
  });
});

describe("a row whose address yields no usable path", () => {
  const unusable: RowSeed[] = [
    { id: "900001", title: "Empty address soup", url: "" },
    { id: "900002", title: "Bare word cassoulet", url: "jambalaya" },
    { id: "900003", title: "Pathless pavlova", url: "https://www.bbcgoodfood.com/" },
  ];

  it("is set aside, exactly as a row carrying no address is", () => {
    const parsed = parseSearchRows(payloadOf(unusable));

    expect(parsed.rows).toStrictEqual([]);
  });

  it("is named among the rows set aside, one entry each", () => {
    const parsed = parseSearchRows(payloadOf(unusable));

    expect(parsed.skipped).toHaveLength(unusable.length);
    const named = parsed.skipped.join("\n");
    for (const seed of unusable) {
      expect([seed.id, seed.title].some((mark) => named.includes(mark))).toBe(true);
    }
  });

  it("leaves the readable rows of the same page alone", () => {
    const parsed = parseSearchRows(
      payloadOf([
        ...unusable,
        {
          id: "233479",
          title: "Chicken & chorizo jambalaya",
          url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
        },
      ]),
    );

    expect(parsed.rows.map((row) => row.id)).toStrictEqual(["recipes/chicken-chorizo-jambalaya"]);
  });
});

describe("the loop a search row opens", () => {
  it("hands back an identifier the read tool accepts, for a plain recipe", () => {
    const row = onlyRowOf({
      id: "233479",
      title: "Chicken & chorizo jambalaya",
      url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    });

    const accepted = getRecipeArgs.safeParse({ id: row.id });

    expect(accepted.success).toBe(true);
  });

  it("hands back an identifier the read tool accepts, for a subscription recipe", () => {
    const row = onlyRowOf({
      id: "5119876",
      title: "Brown sugar pavlova",
      url: "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
      isPremium: true,
    });

    const accepted = getRecipeArgs.safeParse({ id: row.id });

    expect(accepted.success).toBe(true);
  });
});
