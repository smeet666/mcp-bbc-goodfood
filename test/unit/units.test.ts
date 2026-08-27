import { describe, expect, it } from "vitest";
import { demoteUnit, lookupUnit, type UnitInfo, unitDivisibility } from "../../src/recipe/units.js";

/** The unit a word names, or a failure that says which word went missing. */
function mustLookup(word: string): UnitInfo {
  const found = lookupUnit(word);
  if (found === null) {
    throw new Error(`the unit table does not know "${word}"`);
  }
  return found;
}

interface Spelling {
  written: string;
  canonical: string;
}

/**
 * Every spelling a recipe page or a caller may write, short and long, singular
 * and plural. A word missing from this list is a word the table will meet.
 */
const spellings: Spelling[] = [
  { written: "g", canonical: "g" },
  { written: "gram", canonical: "g" },
  { written: "grams", canonical: "g" },
  { written: "gramme", canonical: "g" },
  { written: "grammes", canonical: "g" },
  { written: "kg", canonical: "kg" },
  { written: "kgs", canonical: "kg" },
  { written: "kilo", canonical: "kg" },
  { written: "kilos", canonical: "kg" },
  { written: "kilogram", canonical: "kg" },
  { written: "kilograms", canonical: "kg" },
  { written: "kilogramme", canonical: "kg" },
  { written: "kilogrammes", canonical: "kg" },
  { written: "mg", canonical: "mg" },
  { written: "milligram", canonical: "mg" },
  { written: "milligrams", canonical: "mg" },
  { written: "milligramme", canonical: "mg" },
  { written: "milligrammes", canonical: "mg" },
  { written: "ml", canonical: "ml" },
  { written: "mls", canonical: "ml" },
  { written: "millilitre", canonical: "ml" },
  { written: "millilitres", canonical: "ml" },
  { written: "milliliter", canonical: "ml" },
  { written: "milliliters", canonical: "ml" },
  { written: "cl", canonical: "cl" },
  { written: "centilitre", canonical: "cl" },
  { written: "centilitres", canonical: "cl" },
  { written: "centiliter", canonical: "cl" },
  { written: "centiliters", canonical: "cl" },
  { written: "dl", canonical: "dl" },
  { written: "decilitre", canonical: "dl" },
  { written: "decilitres", canonical: "dl" },
  { written: "deciliter", canonical: "dl" },
  { written: "deciliters", canonical: "dl" },
  { written: "l", canonical: "l" },
  { written: "litre", canonical: "l" },
  { written: "litres", canonical: "l" },
  { written: "liter", canonical: "l" },
  { written: "liters", canonical: "l" },
  { written: "tsp", canonical: "tsp" },
  { written: "tsps", canonical: "tsp" },
  { written: "teaspoon", canonical: "tsp" },
  { written: "teaspoons", canonical: "tsp" },
  { written: "tbsp", canonical: "tbsp" },
  { written: "tbsps", canonical: "tbsp" },
  { written: "tablespoon", canonical: "tbsp" },
  { written: "tablespoons", canonical: "tbsp" },
  { written: "cup", canonical: "cup" },
  { written: "cups", canonical: "cup" },
  { written: "oz", canonical: "oz" },
  { written: "ounce", canonical: "oz" },
  { written: "ounces", canonical: "oz" },
  { written: "lb", canonical: "lb" },
  { written: "lbs", canonical: "lb" },
  { written: "pound", canonical: "lb" },
  { written: "pounds", canonical: "lb" },
  { written: "pinch", canonical: "pinch" },
  { written: "pinches", canonical: "pinch" },
  { written: "handful", canonical: "handful" },
  { written: "handfuls", canonical: "handful" },
];

/** Case is written as it comes, so every spelling is asked for three ways. */
function casings(written: string): string[] {
  return [written, written.toUpperCase(), written.charAt(0).toUpperCase() + written.slice(1)];
}

describe("lookupUnit", () => {
  for (const { written, canonical } of spellings) {
    it(`reads "${written}" as ${canonical}`, () => {
      expect(mustLookup(written).canonical).toBe(canonical);
    });

    it(`reads "${written}" the same whatever the case`, () => {
      for (const spelt of casings(written)) {
        expect(mustLookup(spelt).canonical).toBe(canonical);
      }
    });
  }

  it("names no unit for a word the table does not hold", () => {
    expect(lookupUnit("sprig")).toBeNull();
    expect(lookupUnit("knob")).toBeNull();
    expect(lookupUnit("gramophone")).toBeNull();
    expect(lookupUnit("cupboard")).toBeNull();
    expect(lookupUnit("42")).toBeNull();
  });

  it("names no unit for an empty string", () => {
    expect(lookupUnit("")).toBeNull();
  });

  it("names no unit for a string of spaces", () => {
    expect(lookupUnit("   ")).toBeNull();
    expect(lookupUnit("\t")).toBeNull();
  });
});

describe("measures", () => {
  const measuring: string[] = [
    "g",
    "kg",
    "mg",
    "ml",
    "cl",
    "dl",
    "l",
    "tsp",
    "tbsp",
    "cup",
    "oz",
    "lb",
  ];

  for (const word of measuring) {
    it(`holds that ${word} measures`, () => {
      expect(mustLookup(word).measures).toBe(true);
    });
  }

  for (const word of ["pinch", "handful"]) {
    it(`holds that ${word} counts rather than measures`, () => {
      expect(mustLookup(word).measures).toBe(false);
    });
  }

  it("carries the same verdict through every spelling of one unit", () => {
    expect(mustLookup("teaspoons").measures).toBe(true);
    expect(mustLookup("PINCHES").measures).toBe(false);
  });
});

describe("demoteUnit", () => {
  interface Step {
    from: string;
    to: string;
    per: number;
  }

  const ladder: Step[] = [
    { from: "kg", to: "g", per: 1000 },
    { from: "g", to: "mg", per: 1000 },
    { from: "l", to: "cl", per: 100 },
    { from: "dl", to: "cl", per: 10 },
    { from: "cl", to: "ml", per: 10 },
    { from: "tbsp", to: "tsp", per: 3 },
    { from: "cup", to: "tbsp", per: 16 },
    { from: "lb", to: "oz", per: 16 },
  ];

  for (const { from, to, per } of ladder) {
    it(`steps ${from} down to ${to}, ${per} of it to one`, () => {
      const step = demoteUnit(mustLookup(from));
      expect(step).not.toBeNull();
      expect(step?.unit.canonical).toBe(to);
      expect(step?.per).toBe(per);
    });
  }

  for (const bottom of ["mg", "ml", "tsp", "oz"]) {
    it(`has nowhere to send ${bottom}`, () => {
      expect(demoteUnit(mustLookup(bottom))).toBeNull();
    });
  }

  for (const approximate of ["pinch", "handful"]) {
    it(`has nowhere to send a ${approximate}, which keeps the cook's size`, () => {
      expect(demoteUnit(mustLookup(approximate))).toBeNull();
    });
  }

  it("takes cup two steps down to tsp, 48 to one", () => {
    const first = demoteUnit(mustLookup("cup"));
    expect(first?.unit.canonical).toBe("tbsp");
    const second = first === null ? null : demoteUnit(first.unit);
    expect(second?.unit.canonical).toBe("tsp");
    expect((first?.per ?? 0) * (second?.per ?? 0)).toBe(48);
  });

  it("takes kg two steps down to mg, a million to one", () => {
    const first = demoteUnit(mustLookup("kg"));
    expect(first?.unit.canonical).toBe("g");
    const second = first === null ? null : demoteUnit(first.unit);
    expect(second?.unit.canonical).toBe("mg");
    expect((first?.per ?? 0) * (second?.per ?? 0)).toBe(1_000_000);
  });

  it("takes l two steps down to ml, a thousand to one", () => {
    const first = demoteUnit(mustLookup("l"));
    expect(first?.unit.canonical).toBe("cl");
    const second = first === null ? null : demoteUnit(first.unit);
    expect(second?.unit.canonical).toBe("ml");
    expect((first?.per ?? 0) * (second?.per ?? 0)).toBe(1000);
  });

  it("takes dl two steps down to ml, a hundred to one", () => {
    const first = demoteUnit(mustLookup("dl"));
    expect(first?.unit.canonical).toBe("cl");
    const second = first === null ? null : demoteUnit(first.unit);
    expect(second?.unit.canonical).toBe("ml");
    expect((first?.per ?? 0) * (second?.per ?? 0)).toBe(100);
  });

  it("reaches the bottom of the imperial ladder in one step from lb", () => {
    const first = demoteUnit(mustLookup("lb"));
    expect(first?.unit.canonical).toBe("oz");
    expect(first === null ? null : demoteUnit(first.unit)).toBeNull();
  });
});

describe("unitDivisibility", () => {
  for (const approximate of ["pinch", "handful"]) {
    it(`counts a ${approximate} in whole ones`, () => {
      expect(unitDivisibility(mustLookup(approximate))).toBe("whole");
    });
  }

  for (const big of ["bottle", "jar", "block", "slice"]) {
    it(`divides a ${big} in four, a quarter of it still being a portion`, () => {
      expect(unitDivisibility(mustLookup(big))).toBe("quarter");
    });
  }

  const ordinary: string[] = [
    "g",
    "kg",
    "mg",
    "ml",
    "cl",
    "dl",
    "l",
    "tsp",
    "tbsp",
    "cup",
    "oz",
    "lb",
  ];

  for (const word of ordinary) {
    it(`divides ${word} in two`, () => {
      expect(unitDivisibility(mustLookup(word))).toBe("half");
    });
  }
});
