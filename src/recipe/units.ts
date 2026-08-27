/**
 * What a written measure names, and how far a kitchen divides one of it.
 *
 * Nothing here knows about the site, the protocol or the clock.
 */

/** How finely a kitchen can divide one of a counted thing. */
export type Divisibility =
  /** An egg: half of one is not an amount a kitchen measures out. */
  | "whole"
  /** A can, a clove, a sheet of gelatine: it splits in two, and no finer. */
  | "half"
  /** An onion, an apple: a knife takes it to quarters. */
  | "quarter";

export interface UnitInfo {
  /** The spelling this server uses for the unit. */
  canonical: string;
  /** True when the unit measures rather than counts or approximates. */
  measures: boolean;
}

/**
 * A measure whose size is the cook's rather than a number.
 *
 * A pinch multiplied by six is six pinches. Turning one into grams would state a
 * weight nobody wrote, so these are counted and never converted.
 */
const APPROXIMATE = new Set(["pinch", "handful"]);

/**
 * Measures a cook takes a quarter of.
 *
 * The half is as far as a measure goes on its own. These four hold enough that a
 * quarter is still a portion someone serves and the rest still keeps: a quarter
 * of a bottle of wine is a glass, a quarter of a block of tofu is a piece cut on
 * a board, a quarter of a slice of bread is a crouton.
 */
const QUARTERED_MEASURE = new Set(["bottle", "jar", "block", "slice"]);

/** Every spelling a caller may write, against the one this server uses. */
const SPELLINGS: Readonly<Record<string, string>> = {
  mg: "mg",
  mgs: "mg",
  milligram: "mg",
  milligrams: "mg",
  milligramme: "mg",
  milligrammes: "mg",
  g: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  kilogramme: "kg",
  kilogrammes: "kg",
  kilo: "kg",
  kilos: "kg",
  ml: "ml",
  mls: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  cl: "cl",
  cls: "cl",
  centilitre: "cl",
  centilitres: "cl",
  centiliter: "cl",
  centiliters: "cl",
  dl: "dl",
  dls: "dl",
  decilitre: "dl",
  decilitres: "dl",
  deciliter: "dl",
  deciliters: "dl",
  l: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  tsp: "tsp",
  tsps: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tbsp: "tbsp",
  tbsps: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  oz: "oz",
  ozs: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  pinch: "pinch",
  pinches: "pinch",
  handful: "handful",
  handfuls: "handful",
  can: "can",
  cans: "can",
  tin: "can",
  tins: "can",
  clove: "clove",
  cloves: "clove",
  sheet: "sheet",
  sheets: "sheet",
  bottle: "bottle",
  bottles: "bottle",
  jar: "jar",
  jars: "jar",
  block: "block",
  blocks: "block",
  slice: "slice",
  slices: "slice",
};

/** Units that state an amount rather than counting a thing. */
const MEASURES = new Set([
  "mg",
  "g",
  "kg",
  "ml",
  "cl",
  "dl",
  "l",
  "tsp",
  "tbsp",
  "cup",
  "oz",
  "lb",
]);

/** Every rung of a ladder is a measure, since only a measure has a ladder. */
function measure(canonical: string): UnitInfo {
  return { canonical, measures: true };
}

/** The unit one step down the ladder, and how many of it fit in one. */
const DEMOTIONS: Readonly<Record<string, { unit: UnitInfo; per: number }>> = {
  kg: { unit: measure("g"), per: 1000 },
  g: { unit: measure("mg"), per: 1000 },
  l: { unit: measure("cl"), per: 100 },
  dl: { unit: measure("cl"), per: 10 },
  cl: { unit: measure("ml"), per: 10 },
  tbsp: { unit: measure("tsp"), per: 3 },
  cup: { unit: measure("tbsp"), per: 16 },
  lb: { unit: measure("oz"), per: 16 },
};

/** The unit a written word names, or null when it names none. */
export function lookupUnit(word: string): UnitInfo | null {
  const canonical = SPELLINGS[word.trim().toLowerCase()];
  if (canonical === undefined) {
    return null;
  }
  return { canonical, measures: MEASURES.has(canonical) };
}

/**
 * The unit one step down, with how many of it fit in one of the current unit.
 * Null at the bottom of a ladder, where there is nothing smaller to say it in.
 */
export function demoteUnit(unit: UnitInfo): { unit: UnitInfo; per: number } | null {
  return DEMOTIONS[unit.canonical] ?? null;
}

/** How finely a kitchen divides one of this measure. */
export function unitDivisibility(unit: UnitInfo): Divisibility {
  if (APPROXIMATE.has(unit.canonical)) {
    return "whole";
  }
  return QUARTERED_MEASURE.has(unit.canonical) ? "quarter" : "half";
}
