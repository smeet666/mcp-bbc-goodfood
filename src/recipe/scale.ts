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
import { demoteUnit, lookupUnit } from "./units.js";

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

const QUANTITY =
  /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?)\s*(?:(?:-|–|—|to)\s*(\d+\s+\d+\/\d+|\d+\/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?)\s*)?/;
const FIRST_WORD = /^\s*([A-Za-z]+)\.?\s*/;
/** A whole number and a fraction written side by side, such as "1 1/2". */
const MIXED_NUMBER = /^(\d+)\s+(\d+)\/(\d+)$/;
/** A fraction written with a slash, such as "3/4". */
const SLASHED_FRACTION = /^(\d+)\/(\d+)$/;

function readNumber(written: string): number | null {
  const vulgar = VULGAR[written];
  if (vulgar !== undefined) {
    return vulgar;
  }
  const mixed = MIXED_NUMBER.exec(written);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = SLASHED_FRACTION.exec(written);
  if (fraction) {
    return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  }
  const plain = Number(written.replace(",", "."));
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

function readHead(line: string): Head | null {
  const match = QUANTITY.exec(line);
  if (!match?.[1]) {
    return null;
  }
  const amount = readNumber(match[1]);
  if (amount === null || amount <= 0) {
    return null;
  }
  const amountMax = match[2] === undefined ? null : readNumber(match[2]);

  const said = readUnit(line.slice(match[0].length));
  return { amount, amountMax, unit: said.unit, rest: said.rest.trim() };
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
}

/**
 * Where a quantity lands once it has been multiplied.
 *
 * A measure walks down its ladder before it is rounded, so a share smaller than
 * one of its unit is restated in a smaller unit rather than rounded away to
 * nothing. A counted thing lands on the smallest share a cook takes out of one.
 */
function land(raw: number, unit: UnitInfo | null, item: string): Landed {
  if (unit?.measures) {
    let value = raw;
    let current = unit;
    while (value < 1) {
      const step = demoteUnit(current);
      if (!step) {
        break;
      }
      value *= step.per;
      current = step.unit;
    }
    const rounded =
      value >= 1
        ? Math.round(value * 10) / 10
        : Math.max(SMALLEST_MEASURE, Math.round(value * 100) / 100);
    return { amount: rounded, unit: current, exact: isExact(rounded, value) };
  }

  const step = SMALLEST_SHARE[divisibilityOf(unit, item)];
  const landed = snap(raw, step);
  return { amount: landed, unit, exact: isExact(landed, raw) };
}

function renderAmount(value: number): string {
  if (isExact(value, Math.round(value))) {
    return String(Math.round(value));
  }
  for (const [glyph, fraction] of Object.entries(VULGAR)) {
    if (isExact(value, fraction)) {
      return glyph;
    }
  }
  const whole = Math.floor(value);
  const part = value - whole;
  for (const [glyph, fraction] of Object.entries(VULGAR)) {
    if (whole > 0 && isExact(part, fraction)) {
      return `${whole}${glyph}`;
    }
  }
  return String(Math.round(value * 100) / 100);
}

function requireFactor(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw invalidInput(
      `[invalid_input] The factor must be a finite number above zero, and ${factor} is not.`,
    );
  }
}

function compose(
  head: { amount: number; amountMax: number | null; unit: UnitInfo | null },
  rest: string,
): string {
  const quantity =
    head.amountMax === null
      ? renderAmount(head.amount)
      : `${renderAmount(head.amount)}-${renderAmount(head.amountMax)}`;
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
  const high = head.amountMax === null ? null : land(head.amountMax * factor, low.unit, head.rest);
  const exact = low.exact && (high === null || high.exact);

  return {
    text: compose(
      { amount: low.amount, amountMax: high?.amount ?? null, unit: low.unit },
      head.rest,
    ),
    original: line,
    scaling: exact ? "scaled" : "rounded",
    amount: low.amount,
    amount_max: high?.amount ?? null,
    unit: low.unit?.canonical ?? null,
  };
}

/** Scale one line already split into its parts, as a recipe page publishes it. */
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

  if (parts.amount === null) {
    return {
      text: parts.text,
      original: parts.text,
      scaling: "unscaled",
      amount: null,
      amount_max: null,
      unit: null,
    };
  }

  const unit = parts.unit === null ? null : lookupUnit(parts.unit);
  const landed = land(parts.amount * factor, unit, parts.item);
  const said = landed.unit?.canonical ?? parts.unit;
  const head = `${renderAmount(landed.amount)}${said ? ` ${said}` : ""} ${parts.item}`.trim();

  return {
    text: parts.note === null ? head : `${head}, ${parts.note}`,
    original: parts.text,
    scaling: landed.exact ? "scaled" : "rounded",
    amount: landed.amount,
    amount_max: null,
    unit: said,
  };
}
