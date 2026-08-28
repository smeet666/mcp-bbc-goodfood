/**
 * Reading the search payload, and refusing to read more into it than it says.
 *
 * The site answers a search with the rows, the facets it offers over them, and a
 * total. Each of the three carries a way of misleading a reader, and this module
 * is where those are settled rather than in the tool above it.
 */

import { parseFailure } from "../errors.js";
import { SITE_ORIGIN } from "./urls.js";
import type {
  FilterGroup,
  FilterOption,
  FilterReport,
  IngredientGroup,
  NutritionFact,
  Recipe,
  RecipeIngredient,
  SearchReport,
  SearchRow,
  UsEdition,
} from "../types.js";
import { SERVED_ROW_CEILING } from "../types.js";

const TAGS = /<[^>]*>/g;
const RUN_OF_SPACE = /\s+/g;
const SPACE_BEFORE_PUNCTUATION = /\s+([.,;:!?)\]])/g;
const FIRST_WHOLE_NUMBER = /\d+/;
const LEADING_SLASHES = /^\/+/;
const TRAILING_SLASHES = /\/+$/;
const DATA_BLOCK = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const HOURS = /(\d+)\s*(?:hrs?|hours?)\b/i;
const MINUTES = /(\d+)\s*(?:mins?|minutes?)\b/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string worth keeping, trimmed. Blank and absent are the same thing here. */
function readText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A count the site stated, or null.
 *
 * Zero is a count the site can genuinely state, so it survives. Anything that is
 * not a whole number of recipes says nothing, and saying nothing is null: on a
 * scale that starts at zero, a missing figure rendered as `0` would be
 * indistinguishable from a facet that matches nothing.
 */
function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

/** Whatever wording identifies a discarded entry to someone reading the report. */
function wordingFor(entry: Record<string, unknown>, fallback: string): string {
  return readText(entry.label) ?? readText(entry.name) ?? readText(entry.value) ?? fallback;
}

function readOptions(
  entry: Record<string, unknown>,
  groupName: string,
  skipped: string[],
): FilterOption[] {
  const published: unknown = entry.options;
  if (!Array.isArray(published)) {
    return [];
  }

  const options: FilterOption[] = [];
  for (const candidate of published) {
    if (!isRecord(candidate)) {
      skipped.push(`${groupName}: an option arrived in a shape with no fields to read`);
      continue;
    }
    const value = readText(candidate.value);
    if (value === null) {
      // The value is what a caller passes back to narrow a search. An option
      // without one names something no question can be asked about.
      skipped.push(
        `${groupName}: the option published as "${wordingFor(candidate, "unnamed")}" carries no value to pass back`,
      );
      continue;
    }
    options.push({
      value,
      label: readText(candidate.label) ?? value,
      count: readCount(candidate.count),
    });
  }
  return options;
}

/**
 * Read the facet groups the payload publishes, naming whatever was discarded.
 *
 * A group whose options were all discarded is kept, empty. Its name is what a
 * caller passes back to a search, and the site accepts values the published list
 * never carried, so an empty group still names an axis that answers. Dropping it
 * would hide that axis.
 */
export function parseFilterGroups(payload: unknown): { groups: FilterGroup[]; skipped: string[] } {
  const groups: FilterGroup[] = [];
  const skipped: string[] = [];

  const published: unknown = isRecord(payload) ? payload.filters : undefined;
  if (!Array.isArray(published)) {
    return { groups, skipped };
  }

  for (const entry of published) {
    if (!isRecord(entry)) {
      skipped.push("a filter arrived in a shape with no fields to read");
      continue;
    }
    const name = readText(entry.name);
    if (name === null) {
      skipped.push(
        `the filter published as "${wordingFor(entry, "unnamed")}" carries no name to pass back`,
      );
      continue;
    }
    const options = readOptions(entry, name, skipped);
    groups.push({
      name,
      label: readText(entry.label) ?? name,
      options,
      option_count: options.length,
    });
  }

  return { groups, skipped };
}

/**
 * Read everything a filter listing establishes from one payload.
 *
 * A missing search block is a breakdown rather than an absence of facets, so it
 * is raised: rendering an empty listing would let a caller report that the site
 * offers no way to narrow, which was never established.
 */
export function parseFilterReport(
  payload: unknown,
  query: string | null,
): { report: FilterReport; skipped: string[] } {
  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  if (!isRecord(results)) {
    throw parseFailure("BBC Good Food answered without the block that carries its search results.");
  }

  const { groups, skipped } = parseFilterGroups(payload);
  const total = readCount(results.totalItems);

  return {
    report: {
      query,
      filters: groups,
      filter_count: groups.length,
      total_available: total,
      // A total that lands exactly on the ceiling was cut there, so it states a
      // floor. Reporting it as a catalogue would invent what the site withheld.
      total_is_ceiling: total === SERVED_ROW_CEILING,
    },
    skipped,
  };
}

/**
 * The minutes a row states for the whole recipe.
 *
 * The site writes them as "50 mins", "1 hr" or "1 hr 20 mins", and the two parts
 * add up. A wording carrying neither is unreadable rather than instantaneous, so
 * it yields null: a zero here would say the recipe takes no time at all.
 */
function readMinutes(display: unknown): number | null {
  if (typeof display !== "string") {
    return null;
  }
  const hours = HOURS.exec(display);
  const minutes = MINUTES.exec(display);
  if (!(hours || minutes)) {
    return null;
  }
  return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

/** The wording a row publishes under one of its own term slugs. */
function readTerm(row: Record<string, unknown>, slug: string): string | null {
  const terms: unknown = row.terms;
  if (!Array.isArray(terms)) {
    return null;
  }
  for (const term of terms) {
    if (isRecord(term) && term.slug === slug) {
      return readText(term.display);
    }
  }
  return null;
}

function readRating(row: Record<string, unknown>): { value: number | null; count: number | null } {
  const rating: unknown = row.rating;
  if (!isRecord(rating)) {
    return { value: null, count: null };
  }

  const count = readCount(rating.ratingCount);
  const stated = typeof rating.ratingValue === "number" ? rating.ratingValue : null;

  /*
   * A rating runs from one to five and needs someone to have given it. Zero on
   * either side says nobody judged the recipe, which is a different statement
   * from a poor score, and rendering it as a score puts an unjudged recipe at
   * the bottom of a ranking it never entered.
   *
   * The two fields part company here on purpose: the rating goes, and the
   * number of people who gave one stays at zero. Nobody voting is a figure the
   * site established; what they would have said is not.
   */
  const value = stated === null || stated === 0 || count === null || count === 0 ? null : stated;
  return { value, count };
}

/**
 * The path an address points at, without its leading slash, its query, its
 * fragment or a trailing slash. Null when the address names no page.
 */
function pathOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(LEADING_SLASHES, "").replace(TRAILING_SLASHES, "");
  return path === "" ? null : path;
}

/**
 * One row, or the wording that says why it could not be rendered.
 *
 * Three fields make a row usable and each answers a different need: the
 * identifier is what a later read asks for, the title is what tells one row from
 * another, and the address is what a reader cites. A row missing any of them is
 * set aside rather than rendered half-empty.
 */
function readRow(entry: unknown): SearchRow | string {
  if (!isRecord(entry)) {
    return "a row arrived in a shape with no fields to read";
  }

  const title = readText(entry.title);
  const url = readText(entry.url);
  // The identifier is the page's own path. The site's numeric id resolves to
  // nothing a caller can read, so handing it back would name a recipe by
  // something that cannot fetch it.
  const id = url === null ? null : pathOf(url);
  if (id === null || title === null || url === null) {
    return sayWhyDropped({ title, url, id, siteId: readText(entry.id) });
  }

  const image: unknown = entry.image;
  const rating = readRating(entry);
  return {
    id,
    title,
    url,
    image_url: isRecord(image) ? readText(image.url) : null,
    rating: rating.value,
    rating_count: rating.count,
    premium: entry.isPremium === true,
    total_minutes: readMinutes(readTerm(entry, "time")),
    difficulty: readTerm(entry, "skillLevel"),
    author: readText(entry.authorName),
  };
}

/**
 * Named by everything the row still carries rather than by one of them: which
 * field survives differs from row to row, and the identifier is the one a reader
 * chases the row by.
 */
function sayWhyDropped(read: {
  title: string | null;
  url: string | null;
  id: string | null;
  siteId: string | null;
}): string {
  // The identifier is the page's path, read out of the address. A row whose
  // address names no page of this site therefore has a title and an address and
  // still no way to be fetched, which is a cause of its own.
  const missing = [
    read.title === null ? "no title" : "",
    read.url === null ? "no address" : "",
    read.url !== null && read.id === null ? "an address that names no page on the site" : "",
  ].filter((part) => part !== "");

  // The site's own identifier names the row for a bug report even though it
  // cannot fetch it, which is why it is read here and not used as the id.
  const marks = [
    read.title === null ? "" : `titled "${read.title}"`,
    read.siteId === null ? "" : `carrying id ${read.siteId}`,
    read.url ?? "",
  ].filter((part) => part !== "");

  const named = marks.length > 0 ? marks.join(", ") : "with nothing to name it";
  return `a row ${named} was set aside: ${missing.join(", ")}`;
}

/** Read the rows of a listing, naming whatever could not be rendered. */
export function parseSearchRows(payload: unknown): { rows: SearchRow[]; skipped: string[] } {
  const rows: SearchRow[] = [];
  const skipped: string[] = [];

  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  const served: unknown = isRecord(results) ? results.items : undefined;
  if (!Array.isArray(served)) {
    return { rows, skipped };
  }

  for (const entry of served) {
    const read = readRow(entry);
    if (typeof read === "string") {
      skipped.push(read);
      continue;
    }
    rows.push(read);
  }

  return { rows, skipped };
}

/**
 * Read everything a search establishes from one payload.
 *
 * `rows_seen` counts what the site served and `result_count` counts what could
 * be rendered. They differ only when a row was set aside, and holding both is
 * the only thing that says so: reporting the second alone would make a lost row
 * look like a row that was never there.
 */
export function parseSearchReport(
  payload: unknown,
  query: string,
): { report: SearchReport; skipped: string[] } {
  const results: unknown = isRecord(payload) ? payload.searchResults : undefined;
  if (!isRecord(results)) {
    throw parseFailure("BBC Good Food answered without the block that carries its search results.");
  }

  const { rows, skipped } = parseSearchRows(payload);
  const served: unknown = results.items;
  const total = readCount(results.totalItems);

  return {
    report: {
      query,
      results: rows,
      result_count: rows.length,
      total_available: total,
      total_is_ceiling: total === SERVED_ROW_CEILING,
      rows_seen: Array.isArray(served) ? served.length : 0,
      restrictions_lifted: [],
    },
    skipped,
  };
}

/** The text a fragment of the site's HTML says, links rendered by their words. */
function readProse(html: unknown): string | null {
  if (typeof html !== "string") {
    return null;
  }
  // A tag becomes a space so two words never run together, which then leaves a
  // space before whatever punctuation followed the tag.
  const text = decodeEntities(html.replace(TAGS, " "))
    .replace(RUN_OF_SPACE, " ")
    .replace(SPACE_BEFORE_PUNCTUATION, "$1")
    .trim();
  return text === "" ? null : text;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi;
/** The highest code point a character can have. */
const MAX_CODE_POINT = 0x10ffff;

/** Half of a surrogate pair, which names no character on its own. */
function isSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdfff;
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      // A code point above the highest one, or inside the surrogate range, is
      // not a character. Rendering it would raise or leave half a pair in the
      // text, so it is left written as the page wrote it.
      const named =
        Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT && !isSurrogate(code);
      return named ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** A whole number of minutes from a bound the site states in seconds. */
function readBound(seconds: unknown): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.round(seconds / 60);
}

function readTimes(published: unknown): {
  prep_minutes: number | null;
  cook_minutes: number | null;
  total_minutes: number | null;
} {
  if (!isRecord(published)) {
    return { prep_minutes: null, cook_minutes: null, total_minutes: null };
  }
  // The upper bound is the figure the page prints, and the lower one is zero on
  // every recipe: rendering that zero would say the step takes no time at all.
  return {
    prep_minutes: readBound(published.preparationMax),
    cook_minutes: readBound(published.cookingMax),
    total_minutes: readBound(published.total),
  };
}

function readIngredient(entry: unknown): RecipeIngredient | string {
  if (!isRecord(entry)) {
    return "an ingredient arrived in a shape with no fields to read";
  }
  const item = readText(entry.ingredientText);
  if (item === null) {
    return "an ingredient line carries no name for what goes in";
  }

  const quantity = readText(entry.quantityText);
  const note = readText(entry.note);
  const amount =
    typeof entry.metricQuantity === "number" &&
    Number.isFinite(entry.metricQuantity) &&
    entry.metricQuantity > 0
      ? entry.metricQuantity
      : null;
  const term = isRecord(entry.term) ? readText(entry.term.display) : null;

  // Composed the way the site composes it, and nothing more: a separator the
  // site does not write would be punctuation this server invented.
  const head = quantity === null ? item : `${quantity} ${item}`;
  return {
    text: note === null ? head : `${head}, ${note}`,
    amount,
    unit: readText(entry.metricUnit),
    item,
    note,
    term,
  };
}

function readIngredientGroups(published: unknown, skipped: string[]): IngredientGroup[] {
  if (!Array.isArray(published)) {
    skipped.push("the ingredients arrived in a shape with no lines to read");
    return [];
  }
  const groups: IngredientGroup[] = [];
  for (const group of published) {
    if (!isRecord(group)) {
      skipped.push("an ingredient group arrived in a shape with no fields to read");
      continue;
    }
    const lines: RecipeIngredient[] = [];
    for (const entry of Array.isArray(group.ingredients) ? group.ingredients : []) {
      const read = readIngredient(entry);
      if (typeof read === "string") {
        skipped.push(read);
        continue;
      }
      lines.push(read);
    }
    groups.push({ heading: readText(group.heading), ingredients: lines });
  }
  return groups;
}

function readSteps(published: unknown, skipped: string[]): string[] {
  if (!Array.isArray(published)) {
    skipped.push("the method arrived in a shape with no steps to read");
    return [];
  }
  const steps: string[] = [];
  for (const step of published) {
    const parts = isRecord(step) && Array.isArray(step.content) ? step.content : [];
    const said = parts
      .map((part) => (isRecord(part) && isRecord(part.data) ? readProse(part.data.value) : null))
      .filter((part): part is string => part !== null)
      .join(" ");
    const text = said.trim();
    if (!isRecord(step) || text === "") {
      skipped.push("a step carries no words to follow");
      continue;
    }
    const heading = readText(step.name);
    steps.push(heading === null ? text : `${heading}: ${text}`);
  }
  return steps;
}

function readNutrition(published: unknown): NutritionFact[] {
  if (!Array.isArray(published)) {
    return [];
  }
  const facts: NutritionFact[] = [];
  for (const fact of published) {
    if (!isRecord(fact)) {
      continue;
    }
    const label = readText(fact.label);
    if (label === null) {
      continue;
    }
    facts.push({
      label,
      value: typeof fact.value === "number" && Number.isFinite(fact.value) ? fact.value : null,
      unit: typeof fact.unit === "string" ? fact.unit : "",
    });
  }
  return facts;
}

/**
 * The rendition the site writes for readers in the United States.
 *
 * The flag alone is not the edition: a page that claims one and carries no
 * lines to read would answer a request for it with an absence made up here.
 * Both halves have to be on the page for it to exist.
 */
function readUsEdition(
  page: Record<string, unknown>,
  premium: boolean,
  skipped: string[],
): UsEdition | null {
  if (page.hasUSLocalisation !== true || !Array.isArray(page.ingredientsUS)) {
    return null;
  }
  return {
    ingredients: premium ? [] : readIngredientGroups(page.ingredientsUS, skipped),
    steps: premium ? [] : readSteps(page.methodStepsUS, skipped),
    nutrition: readNutrition(page.nutritionsUS),
  };
}

/**
 * Read one recipe from the page that publishes it.
 *
 * A recipe behind the subscription comes back without its ingredients and its
 * steps, although the page carries them. That is the whole point of the rule:
 * the site put a wall in front of its readers, and reading past it because the
 * bytes happen to be there would make this server the way around it.
 */
export function parseRecipe(html: string, id: string): { recipe: Recipe; skipped: string[] } {
  const block = DATA_BLOCK.exec(html)?.[1];
  if (block === undefined) {
    throw parseFailure("BBC Good Food served a page without the block that carries its recipe.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(block);
  } catch (cause) {
    throw parseFailure("BBC Good Food served a recipe block that is not JSON.", { cause });
  }

  const props: unknown = isRecord(payload) ? payload.props : undefined;
  const page: unknown = isRecord(props) ? props.pageProps : undefined;
  if (!isRecord(page)) {
    throw parseFailure("BBC Good Food served a page carrying no recipe to read.");
  }

  const skipped: string[] = [];
  const premium = page.isPremium === true;
  const yieldText = readText(page.servings);
  const rating = isRecord(page.userRatings)
    ? readRating({
        rating: { ratingValue: page.userRatings.avg, ratingCount: page.userRatings.total },
      })
    : { value: null, count: null };
  const authors = Array.isArray(page.authors) ? page.authors : [];
  const diets = Array.isArray(page.diet) ? page.diet : [];

  return {
    recipe: {
      id,
      title: readText(page.title) ?? id,
      url: `${SITE_ORIGIN}/${id}`,
      premium,
      yield_text: yieldText,
      yield_count:
        yieldText === null ? null : Number(FIRST_WHOLE_NUMBER.exec(yieldText)?.[0]) || null,
      ...readTimes(page.cookAndPrepTime),
      difficulty: readText(page.skillLevel),
      diets: diets
        .map((diet) => (isRecord(diet) ? readText(diet.display) : null))
        .filter((diet): diet is string => diet !== null),
      author: authors.length > 0 && isRecord(authors[0]) ? readText(authors[0].name) : null,
      rating: rating.value,
      rating_count: rating.count,
      description: readProse(page.description),
      ingredients: premium ? [] : readIngredientGroups(page.ingredients, skipped),
      steps: premium ? [] : readSteps(page.methodSteps, skipped),
      nutrition: readNutrition(page.nutritions),
      nutrition_per: readText(page.nutritionalInfoCaption),
      us_edition: readUsEdition(page, premium, skipped),
    },
    skipped,
  };
}
