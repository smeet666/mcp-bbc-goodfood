#!/usr/bin/env node
/**
 * Writes the corpus the unit suite reads.
 *
 * Every title, facet and count here is invented. The shapes come from what the
 * site publishes, and none of its wording is stored in this repository. A test
 * that needs a payload the site has never produced gets one just as easily,
 * which is the other reason the corpus is written rather than captured.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "test", "fixtures");
mkdirSync(out, { recursive: true });

const option = (value, label, count) => ({ value, label, count });

const group = (name, label, options) => ({
  label,
  name,
  defaultValues: [],
  options,
});

/** The axes a scoped search publishes, with counts that fit inside its total. */
const scopedGroups = [
  group("author", "Author", [
    option("wren-holloway", "Wren Holloway", 12),
    option("iso-tamblin", "Iso Tamblin", 9),
    option("perrin-vale", "Perrin Vale", 4),
  ]),
  group("calories", "Calories", [
    option("lt-250", "Under 250", 18),
    option("lt-500", "Under 500", 96),
    option("lt-750", "Under 750", 140),
  ]),
  group("servings", "Servings", [
    option("gte-1", "1 or more", 151),
    option("gte-4", "4 or more", 118),
  ]),
  group("totalTime", "Total time", [
    option("lt-900", "Under 15 mins", 3),
    option("lt-1800", "Under 30 mins", 41),
  ]),
  group("cuisine", "Cuisine", [
    option("keldish", "Keldish", 22),
    option("marran", "Marran", 17),
    option("ostrean", "Ostrean", 6),
  ]),
  group("diet", "Diets", [
    option("nut-free", "Nut-free", 74),
    option("root-free", "Root-free", 31),
  ]),
  group("difficulty", "Difficulty", [
    option("easy", "Easy", 133),
    option("more-effort", "More effort", 17),
    option("a-challenge", "A challenge", 1),
  ]),
  group("mealType", "Meal type", [option("supper", "Supper", 118), option("side", "Side", 22)]),
  group("ratings", "Ratings", [
    option("gte-3", "3 and above", 149),
    option("gte-4", "4 and above", 131),
  ]),
];

/** The site-wide listing publishes fewer axes than a scoped search does. */
const siteWideGroups = scopedGroups
  .filter((g) => g.name !== "calories")
  .map((g) => ({
    ...g,
    options: g.options.map((o) => option(o.value, o.label, o.count * 40)),
  }));

const item = (id, title, slug, rating, isPremium = false) => ({
  id,
  title,
  url: `https://www.bbcgoodfood.com/recipes/${slug}`,
  isPremium,
  rating: rating === null ? null : { ratingValue: rating, ratingCount: 40 + Number(id) },
  image: { alt: title, height: 400, width: 600 },
});

/** A row as the search route serves it, with the parts a listing renders. */
const row = (id, title, slug, over = {}) => ({
  ...item(id, title, slug, over.rating === undefined ? 4.2 : over.rating, over.isPremium ?? false),
  authorName: over.authorName === undefined ? "Wren Holloway" : over.authorName,
  image: {
    alt: title,
    height: 400,
    width: 440,
    url: `https://images.example.invalid/${slug}.jpg`,
  },
  terms:
    over.terms === undefined
      ? [
          { slug: "time", display: "50 mins" },
          { slug: "skillLevel", display: "Easy" },
        ]
      : over.terms,
});

const envelope = ({ totalItems, items = [], filters = [], limit = 30 }) => ({
  tabs: [{ label: "Recipes", identifier: "recipe", isDefault: true, isCurrent: true }],
  filters,
  sort: [
    { text: "Most relevant", value: "relevant", selected: true },
    { text: "Quickest", value: "quickest", selected: false },
  ],
  searchResults: { totalItems, limit, nextUrl: null, previousUrl: null, items },
  searchUrl: "/api/search-frontend/search",
  searchApiVersion: "6.1",
});

const fixtures = {
  /**
   * A search that matched, with every axis the site offers over it. Two of its
   * three rows carry the word searched for and one does not, which is what a
   * count of matching rows has to tell apart.
   */
  "filters-scoped.json": envelope({
    totalItems: 151,
    filters: scopedGroups,
    items: [
      item("101", "Braised keldish greens", "braised-keldish-greens", 4.5),
      item("102", "Keldish pepper broth", "keldish-pepper-broth", 4.2),
      item("103", "Marran almond wafers", "marran-almond-wafers", 3.8),
    ],
  }),

  /**
   * A search the site answered with rows that carry no word of it.
   *
   * The site matches fragments, so a term it holds nothing for still comes back
   * with a count and a page of rows. Nothing here marks the answer as a miss,
   * which is why the rows are counted rather than trusted.
   */
  "filters-unmatched.json": envelope({
    totalItems: 7,
    filters: [
      group("diet", "Diets", [option("nut-free", "Nut-free", 4)]),
      group("mealType", "Meal type", [option("drink", "Drink", 5)]),
    ],
    items: [
      item("201", "Rhuvarb fizz", "rhuvarb-fizz", 4.6),
      item("202", "Ginger cordial", "ginger-cordial", 4.1),
      item("203", "Wafer bars", "wafer-bars", null),
    ],
  }),

  /** The unfiltered listing: a total that sits exactly on the serving ceiling. */
  "filters-sitewide.json": envelope({
    totalItems: 10_000,
    filters: siteWideGroups,
    items: [
      item("110", "Ostrean pepper stew", "ostrean-pepper-stew", 4.1),
      item("111", "Marran honey loaf", "marran-honey-loaf", 4.4),
    ],
  }),

  /** A scope the site understood and found nothing in. */
  "filters-none.json": envelope({ totalItems: 0, filters: [], items: [] }),

  /** A group with no options, and options missing the parts a row needs. */
  "filters-partial.json": envelope({
    totalItems: 12,
    filters: [
      group("diet", "Diets", [option("nut-free", "Nut-free", 12)]),
      group("cuisine", "Cuisine", []),
      { label: "Meal type", name: "mealType", options: [{ label: "Supper" }] },
      { label: "Difficulty", options: [option("easy", "Easy", 12)] },
      group("ratings", "Ratings", [{ value: "gte-4", label: "4 and above" }]),
    ],
  }),

  /** An answer carrying no facets at all. */
  "filters-absent.json": {
    tabs: [],
    searchResults: { totalItems: 5, limit: 30, items: [] },
  },

  /** An answer whose search block is missing, which no reader can repair. */
  "filters-unreadable.json": { tabs: [], filters: scopedGroups },

  /** A full page of rows, with more pages behind it. */
  "search-page.json": envelope({
    totalItems: 195,
    filters: scopedGroups,
    items: [
      row("301", "Keldish greens with chorizo", "keldish-greens-chorizo"),
      row("302", "Easy keldish bravas", "easy-keldish-bravas", { rating: 3.85 }),
      row("303", "Marran almond wafers", "marran-almond-wafers", { rating: null }),
      row("304", "Keldish pepper broth", "keldish-pepper-broth", {
        isPremium: true,
        terms: [
          { slug: "time", display: "1 hr 20 mins" },
          { slug: "skillLevel", display: "More effort" },
        ],
      }),
      row("305", "Ostrean plum tart", "ostrean-plum-tart", { authorName: null }),
    ],
  }),

  /**
   * A restriction the site did not understand.
   *
   * It answers a facet value it holds nothing for with a count of zero and an
   * empty page, saying nothing about which restriction it failed to read.
   */
  "search-restricted-none.json": envelope({ totalItems: 0, filters: [], items: [] }),

  /** The same search once the restriction is dropped. */
  "search-restriction-dropped.json": envelope({
    totalItems: 12,
    filters: scopedGroups,
    items: [
      row("311", "Keldish greens with chorizo", "keldish-greens-chorizo"),
      row("312", "Keldish pepper broth", "keldish-pepper-broth"),
    ],
  }),

  /**
   * Rows a reader cannot render whole.
   *
   * A row with no address cannot be cited, one with no title cannot be told
   * apart, and an identifier is what a later read needs back. Each is a
   * different kind of gap, and none of them is an empty search.
   */
  "search-degraded.json": envelope({
    totalItems: 6,
    filters: [],
    items: [
      row("321", "Keldish greens", "keldish-greens"),
      { id: "322", title: "No address at all", isPremium: false, rating: null },
      { id: "323", url: "https://www.bbcgoodfood.com/recipes/no-title", rating: null },
      { title: "No identifier", url: "https://www.bbcgoodfood.com/recipes/no-id" },
      "not a row at all",
      null,
    ],
  }),
};

for (const [name, value] of Object.entries(fixtures)) {
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

process.stdout.write(`wrote ${Object.keys(fixtures).length} fixtures into ${out}\n`);
