/**
 * Putting a recipe to a different number of people.
 *
 * Nothing here multiplies blindly. A recipe for four brought to three gives
 * 0.75 of an egg, and no kitchen measures that out. What replaces the
 * multiplication is written in three rules, and `scaling` says on every line
 * which of them applied.
 */

import { invalidInput } from "../errors.js";
import { divisibilityOf } from "./divisibility.js";
import type { Divisibility, UnitInfo } from "./units.js";
import { demoteUnit, lookupUnit, promoteUnit, usesFractions } from "./units.js";

export interface ScaledIngredient {
  /** The line as it now reads. */
  text: string;
  /** The line as it was given. */
  original: string;
  /**
   * 'scaled' means the arithmetic landed exactly. 'rounded' means the value
   * moved to stay usable in a kitchen. 'unscaled' means the line carries
   * nothing that can be multiplied and was left alone.
   */
  scaling: "scaled" | "rounded" | "unscaled";
  amount: number | null;
  /** The upper bound when the line gives a range. */
  amount_max: number | null;
  unit: string | null;
}

/** The smallest share of one thing still worth putting in a bowl. */
const SMALLEST_SHARE: Readonly<Record<Divisibility, number>> = {
  whole: 1,
  half: 0.5,
  quarter: 0.25,
};

/** Below this a measure states less than any kitchen scale reads. */
const SMALLEST_MEASURE = 0.01;

const VULGAR: Readonly<Record<string, number>> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
};

/** Every way a recipe writes one number, longest spelling first. */
const NUMBER =
  "\\d+\\s+\\d+/\\d+|\\d+\\s*[\u00bd\u00bc\u00be\u2153\u2154\u215b]|\\d+/\\d+|[\u00bd\u00bc\u00be\u2153\u2154\u215b]|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?";

/**
 * The quantity a line opens with, and the upper bound when it gives a range.
 *
 * The number may not run straight into another digit or comma: "1,23,456" is
 * neither a decimal nor a group of thousands, and reading the part of it that
 * happens to parse would state a quantity the line never gave. It may not run
 * into a percent sign either, since "70% dark chocolate" names a cocoa content
 * and not seventy chocolates.
 */
const QUANTITY = new RegExp(
  `^\\s*(${NUMBER})(?![,\\d%])\\s*(?:(?:-|\u2013|\u2014|to)\\s*(${NUMBER})(?![,\\d%])\\s*)?`,
);

/** A number the rest of a line still carries, and the word that follows it. */
const TRAILING_NUMBER = new RegExp(
  `(?:^|[^A-Za-z0-9])(?:${NUMBER})\\s*([A-Za-z]+)(?:\\s+([A-Za-z]+))?`,
  "g",
);

const FIRST_WORD = /^\s*([A-Za-z]+)\.?\s*/;
/** A whole number and a fraction written side by side, such as "1 1/2". */
const MIXED_NUMBER = /^(\d+)\s+(\d+)\/(\d+)$/;
/** What stands before a fraction glyph written against it, as in "1½". */
const WHOLE_PART = /^\d+\s*$/;
/** A fraction written with a slash, such as "3/4". */
const SLASHED_FRACTION = /^(\d+)\/(\d+)$/;
/** Digits in groups of three, as a large number is written out. */
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

function readNumber(written: string): number | null {
  const vulgar = VULGAR[written];
  if (vulgar !== undefined) {
    return vulgar;
  }
  const glued = VULGAR[written.slice(-1)];
  if (glued !== undefined && WHOLE_PART.test(written.slice(0, -1))) {
    return Number(written.slice(0, -1)) + glued;
  }
  const mixed = MIXED_NUMBER.exec(written);
  if (mixed) {
    return Number(mixed[3]) === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = SLASHED_FRACTION.exec(written);
  if (fraction) {
    return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  }
  const plain = Number(
    THOUSANDS.test(written) ? written.replaceAll(",", "") : written.replace(",", "."),
  );
  return Number.isFinite(plain) ? plain : null;
}

/** What a written line says before its ingredient: a quantity, a unit, or neither. */
interface Head {
  amount: number;
  amountMax: number | null;
  unit: UnitInfo | null;
  rest: string;
}

/**
 * The unit a line names right after its quantity, and what is left after it.
 *
 * A word that names no unit belongs to the ingredient, so it stays where it is.
 */
function readUnit(after: string): { unit: UnitInfo | null; rest: string } {
  const word = FIRST_WORD.exec(after);
  if (!word?.[1]) {
    return { unit: null, rest: after };
  }
  const unit = lookupUnit(word[1]);
  return unit === null ? { unit: null, rest: after } : { unit, rest: after.slice(word[0].length) };
}

/**
 * Whether what follows the quantity states a second measure of its own.
 *
 * A recipe writes "500ml/18fl oz milk" and "2 tbsp (30ml) oil", giving the same
 * amount twice. Multiplying the first and leaving the second would publish a
 * line that states two different quantities and calls itself exact, so such a
 * line is left exactly as it was written.
 */
function statesASecondMeasure(rest: string): boolean {
  TRAILING_NUMBER.lastIndex = 0;
  let found = TRAILING_NUMBER.exec(rest);
  while (found !== null) {
    const named = [found[1], found[2]].some(
      (word) => word !== undefined && lookupUnit(word) !== null,
    );
    if (named) {
      return true;
    }
    found = TRAILING_NUMBER.exec(rest);
  }
  return false;
}

function readHead(line: string): Head | null {
  const match = QUANTITY.exec(line);
  if (!match?.[1]) {
    return null;
  }
  const amount = readNumber(match[1]);
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const amountMax = match[2] === undefined ? null : readNumber(match[2]);
  if (match[2] !== undefined && (amountMax === null || !Number.isFinite(amountMax))) {
    return null;
  }

  const said = readUnit(line.slice(match[0].length));
  const rest = said.rest.trim();
  return statesASecondMeasure(rest) ? null : { amount, amountMax, unit: said.unit, rest };
}

function isExact(value: number, target: number): boolean {
  return Math.abs(value - target) < 1e-9;
}

/** Round to a step, ties away from zero, never below one step. */
function snap(raw: number, step: number): number {
  return Math.max(step, Math.round(raw / step) * step);
}

interface Landed {
  amount: number;
  unit: UnitInfo | null;
  exact: boolean;
  /** How many of the landed unit one of the written unit makes. */
  per: number;
}

/**
 * Where a quantity lands once it has been multiplied.
 *
 * A measure walks down its ladder before it is rounded, so a share smaller than
 * one of its unit is restated in a smaller unit rather than rounded away to
 * nothing. A counted thing lands on the smallest share a cook takes out of one.
 */
/**
 * A measure at the precision the kitchen that reads it works to.
 *
 * A recipe states spoons and cups in fractions, so two thirds of a cup is kept
 * whole rather than flattened to 0.7. A metric measure is read off a scale, and
 * a tenth of its unit is as fine as that scale goes.
 */
function settle(value: number, unit: UnitInfo): number {
  if (usesFractions(unit)) {
    return Math.max(SMALLEST_MEASURE, value);
  }
  return value >= 1
    ? Math.round(value * 10) / 10
    : Math.max(SMALLEST_MEASURE, Math.round(value * 100) / 100);
}

/** How many decimals a raised figure may carry and still be written out. */
const RAISED_PLACES = 1000;

/**
 * The same quantity said in the largest unit that still states it exactly.
 *
 * 4000 g is 4 kg and reads better for it. 7492.5 g stays in grams, because
 * 7.4925 kg needs a decimal the written figure would not carry, and a figure a
 * cook cannot weigh back is worse than a long one.
 */
function raise(amount: number, unit: UnitInfo): { amount: number; unit: UnitInfo } {
  let value = amount;
  let current = unit;
  for (;;) {
    const step = promoteUnit(current);
    if (!step || value < step.per) {
      return { amount: value, unit: current };
    }
    const above = value / step.per;
    if (!isExact(Math.round(above * RAISED_PLACES) / RAISED_PLACES, above)) {
      return { amount: value, unit: current };
    }
    value = above;
    current = step.unit;
  }
}

function land(raw: number, unit: UnitInfo | null, item: string): Landed {
  if (unit?.measures) {
    let value = raw;
    let current = unit;
    let per = 1;
    while (value < 1) {
      const step = demoteUnit(current);
      if (!step) {
        break;
      }
      value *= step.per;
      per *= step.per;
      current = step.unit;
    }
    const rounded = settle(value, current);
    const raised = raise(rounded, current);
    return {
      amount: raised.amount,
      unit: raised.unit,
      exact: isExact(rounded, value),
      per: (per * raised.amount) / rounded,
    };
  }

  const step = SMALLEST_SHARE[divisibilityOf(unit, item)];
  const landed = snap(raw, step);
  return { amount: landed, unit, exact: isExact(landed, raw), per: 1 };
}

/**
 * The upper bound of a range, said in the unit its lower bound landed in.
 *
 * Both bounds name one quantity, so they have to share one unit. Landing them
 * apart let the upper bound keep the unit it was written in while wearing the
 * label of the lower one, which turned "0.5-2 kg" into "500-2 g".
 */
function landUpper(raw: number, low: Landed, item: string): { amount: number; exact: boolean } {
  const value = raw * low.per;
  if (low.unit?.measures) {
    const rounded = settle(value, low.unit);
    return { amount: rounded, exact: isExact(rounded, value) };
  }
  const step = SMALLEST_SHARE[divisibilityOf(low.unit, item)];
  const landed = snap(value, step);
  return { amount: landed, exact: isExact(landed, value) };
}

/**
 * A quantity as a recipe writes it.
 *
 * A fraction glyph belongs to what a kitchen counts: half an onion, a quarter of
 * a can. A measure is written as a number, because "12\u00bd g" is a weight nobody
 * puts on a scale.
 */
function renderAmount(value: number, unit: UnitInfo | null): string {
  if (isExact(value, Math.round(value))) {
    return String(Math.round(value));
  }
  if (unit === null || usesFractions(unit)) {
    const whole = Math.floor(value);
    const part = value - whole;
    for (const [glyph, fraction] of Object.entries(VULGAR)) {
      if (isExact(part, fraction)) {
        return whole === 0 ? glyph : `${whole}${glyph}`;
      }
    }
  }
  return String(Math.round(value * 1000) / 1000);
}

function requireFactor(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw invalidInput(`The factor must be a finite number above zero, and ${factor} is not.`);
  }
}

function compose(
  head: { amount: number; amountMax: number | null; unit: UnitInfo | null },
  rest: string,
): string {
  const quantity =
    head.amountMax === null
      ? renderAmount(head.amount, head.unit)
      : `${renderAmount(head.amount, head.unit)}-${renderAmount(head.amountMax, head.unit)}`;
  const unit = head.unit ? ` ${head.unit.canonical}` : "";
  return `${quantity}${unit} ${rest}`.trim();
}

/** Scale one written line by a factor. */
export function scaleLine(line: string, factor: number): ScaledIngredient {
  requireFactor(factor);

  const head = readHead(line);
  if (!head) {
    return {
      text: line,
      original: line,
      scaling: "unscaled",
      amount: null,
      amount_max: null,
      unit: null,
    };
  }

  const low = land(head.amount * factor, head.unit, head.rest);
  const high = head.amountMax === null ? null : landUpper(head.amountMax * factor, low, head.rest);
  const exact = low.exact && (high === null || high.exact);
  // A range whose ends meet names one quantity, and states it once.
  const upper = high === null || isExact(high.amount, low.amount) ? null : high.amount;

  return {
    text: compose({ amount: low.amount, amountMax: upper, unit: low.unit }, head.rest),
    original: line,
    scaling: exact ? "scaled" : "rounded",
    amount: low.amount,
    amount_max: upper,
    unit: low.unit?.canonical ?? null,
  };
}

/**
 * Scale one line already split into its parts, as a recipe page publishes it.
 *
 * The site's own wording is kept wherever it can be read, because its parts drop
 * words its line carries: "1small onion" is published with "onion" as the item,
 * and rebuilding the line from the item alone would serve a cook an onion of no
 * particular size. The parts are used when the line itself states no quantity.
 */
export function scaleParts(
  parts: {
    text: string;
    amount: number | null;
    unit: string | null;
    item: string;
    note: string | null;
  },
  factor: number,
): ScaledIngredient {
  requireFactor(factor);

  const written = scaleLine(parts.text, factor);
  if (written.scaling !== "unscaled" || parts.amount === null) {
    return written;
  }

  const unit = parts.unit === null ? null : lookupUnit(parts.unit);
  const landed = land(parts.amount * factor, unit, parts.item);
  const said = landed.unit?.canonical ?? parts.unit;
  const head =
    `${renderAmount(landed.amount, landed.unit)}${said ? ` ${said}` : ""} ${parts.item}`.trim();

  return {
    text: parts.note === null ? head : `${head}, ${parts.note}`,
    original: parts.text,
    scaling: landed.exact ? "scaled" : "rounded",
    amount: landed.amount,
    amount_max: null,
    unit: said,
  };
}
