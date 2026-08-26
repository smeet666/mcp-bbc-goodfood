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
  /** A search that matched, with every axis the site offers over it. */
  "filters-scoped.json": envelope({
    totalItems: 151,
    filters: scopedGroups,
    items: [item("101", "Braised keldish greens", "braised-keldish-greens", 4.5)],
  }),

  /** The unfiltered listing: a total that sits exactly on the serving ceiling. */
  "filters-sitewide.json": envelope({
    totalItems: 10_000,
    filters: siteWideGroups,
    items: [item("102", "Ostrean pepper stew", "ostrean-pepper-stew", 4.1)],
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
};

for (const [name, value] of Object.entries(fixtures)) {
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

process.stdout.write(`wrote ${Object.keys(fixtures).length} fixtures into ${out}\n`);
