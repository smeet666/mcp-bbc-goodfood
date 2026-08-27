import { describe, expect, it } from "vitest";
import { scaleLine } from "../../src/recipe/scale.js";
import { lookupUnit, promoteUnit, type UnitInfo } from "../../src/recipe/units.js";

/** The unit a word names, or a failure that says which word went missing. */
function mustLookup(word: string): UnitInfo {
  const found = lookupUnit(word);
  if (found === null) {
    throw new Error(`the unit table does not know "${word}"`);
  }
  return found;
}

interface Step {
  from: string;
  to: string;
  per: number;
}

/** Every rung a quantity may climb, with how many of the smaller fit in the larger. */
const steps: Step[] = [
  { from: "mg", to: "g", per: 1000 },
  { from: "g", to: "kg", per: 1000 },
  { from: "ml", to: "l", per: 1000 },
  { from: "cl", to: "l", per: 100 },
  { from: "dl", to: "l", per: 10 },
  { from: "tsp", to: "tbsp", per: 3 },
  { from: "oz", to: "lb", per: 16 },
];

/**
 * Words that name nothing a scale can climb: the top of a scale, and the units
 * a kitchen counts rather than measures.
 */
const summits: string[] = ["kg", "l", "lb"];
const countedOut: string[] = [
  "pinch",
  "handful",
  "clove",
  "can",
  "slice",
  "sheet",
  "bottle",
  "jar",
  "block",
];

describe("promoteUnit names the rung above a unit", () => {
  for (const step of steps) {
    it(`climbs from ${step.from} to ${step.to}, ${step.per} to one`, () => {
      const climbed = promoteUnit(mustLookup(step.from));

      expect(climbed).not.toBeNull();
      expect(climbed?.unit.canonical).toBe(step.to);
      expect(climbed?.unit.measures).toBe(true);
      expect(climbed?.per).toBe(step.per);
    });
  }

  it("skips centilitres when climbing out of millilitres", () => {
    const climbed = promoteUnit(mustLookup("ml"));

    expect(climbed?.unit.canonical).toBe("l");
    expect(climbed?.per).toBe(1000);
  });

  for (const word of summits) {
    it(`answers null at the top of the ${word} scale`, () => {
      expect(promoteUnit(mustLookup(word))).toBeNull();
    });
  }

  for (const word of countedOut) {
    it(`answers null for ${word}, which measures nothing`, () => {
      expect(promoteUnit(mustLookup(word))).toBeNull();
    });
  }

  it("leaves tbsp where it is, since a large volume is written in litres", () => {
    expect(promoteUnit(mustLookup("tbsp"))).toBeNull();
  });

  it("leaves cup where it is, since a recipe that never said cups would be odd in cups", () => {
    expect(promoteUnit(mustLookup("cup"))).toBeNull();
  });
});

interface Climb {
  line: string;
  factor: number;
  amount: number;
  unit: string;
}

/** Lines whose scaled quantity the rung above states exactly. */
const climbs: Climb[] = [
  { line: "200g plain flour", factor: 20, amount: 4, unit: "kg" },
  { line: "100g butter", factor: 20, amount: 2, unit: "kg" },
  { line: "140g ground almond", factor: 20, amount: 2.8, unit: "kg" },
  { line: "50g chocolate", factor: 20, amount: 1, unit: "kg" },
  { line: "250g trout", factor: 7.5, amount: 1.875, unit: "kg" },
  { line: "500g butter", factor: 7.5, amount: 3.75, unit: "kg" },
  { line: "100ml milk", factor: 10, amount: 1, unit: "l" },
  { line: "4 oz sugar", factor: 20, amount: 5, unit: "lb" },
  { line: "9 tsp salt", factor: 10, amount: 30, unit: "tbsp" },
];

describe("scaleLine climbs a scaled quantity", () => {
  for (const climb of climbs) {
    it(`writes "${climb.line}" times ${climb.factor} as ${climb.amount} ${climb.unit}`, () => {
      const scaled = scaleLine(climb.line, climb.factor);

      expect(scaled.amount).toBeCloseTo(climb.amount, 6);
      expect(scaled.unit).toBe(climb.unit);
      expect(scaled.text).toContain(`${climb.amount} ${climb.unit}`);
    });
  }

  it("carries the climbed unit in the unit field rather than the one it started in", () => {
    const scaled = scaleLine("200g plain flour", 20);

    expect(scaled.unit).toBe("kg");
    expect(scaled.amount).toBe(4);
    expect(scaled.text).toContain("4 kg plain flour");
  });
});

interface Stay {
  line: string;
  factor: number;
  amount: number;
  unit: string;
  because: string;
}

/** Lines the rung above would state less exactly, or could not state at all. */
const stays: Stay[] = [
  {
    line: "999g flour",
    factor: 7.5,
    amount: 7492.5,
    unit: "g",
    because: "7.4925 kg asks for a fourth decimal",
  },
  {
    line: "250ml double cream",
    factor: 1,
    amount: 250,
    unit: "ml",
    because: "it sits under a litre",
  },
  { line: "2 tbsp oil", factor: 20, amount: 40, unit: "tbsp", because: "tbsp climbs nowhere" },
  { line: "1 tsp salt", factor: 20, amount: 20, unit: "tsp", because: "20 over 3 is not exact" },
];

describe("scaleLine leaves a quantity where the rung above would blur it", () => {
  for (const stay of stays) {
    it(`keeps "${stay.line}" times ${stay.factor} in ${stay.unit}, since ${stay.because}`, () => {
      const scaled = scaleLine(stay.line, stay.factor);

      expect(scaled.amount).toBeCloseTo(stay.amount, 6);
      expect(scaled.unit).toBe(stay.unit);
      expect(scaled.text).toContain(`${stay.amount} ${stay.unit}`);
    });
  }
});

describe("climbing leaves the rest of a line alone", () => {
  it("keeps an exact line scaled once it has climbed", () => {
    const scaled = scaleLine("200g plain flour", 20);

    expect(scaled.scaling).toBe("scaled");
    expect(scaled.original).toBe("200g plain flour");
  });

  it("keeps a moved figure rounded once it has climbed", () => {
    const scaled = scaleLine("1 egg", 2.5);

    expect(scaled.scaling).toBe("rounded");
  });

  it("keeps a climbed line whose figure moved marked rounded", () => {
    // 1999.96 g is not a figure a kitchen weighs out, so the gram figure moves
    // before the climb, and the kilo figure it becomes still says it moved.
    const scaled = scaleLine("999.98g flour", 2);

    expect(scaled.scaling).toBe("rounded");
    expect(scaled.amount).toBeCloseTo(2, 6);
    expect(scaled.unit).toBe("kg");
  });

  it("keeps descending past a unit that would state the figure in fractions", () => {
    // A thousandth of a kilo is a gram, so half a thousandth is half a gram. A
    // kitchen weighs 500 mg and does not weigh half a gram, so the descent takes
    // the rung below rather than stopping on a fraction.
    const scaled = scaleLine("1 kg potatoes", 0.0005);

    expect(scaled.amount).toBeCloseTo(500, 6);
    expect(scaled.unit).toBe("mg");
    expect(scaled.text).toContain("500 mg potatoes");
  });

  it("says half a kilo in grams rather than climbing back to kilos", () => {
    const scaled = scaleLine("1 kg potatoes", 0.5);

    expect(scaled.amount).toBeCloseTo(500, 6);
    expect(scaled.unit).toBe("g");
    expect(scaled.text).toContain("500 g potatoes");
  });

  it("stays in kilos when a kilo is multiplied", () => {
    const scaled = scaleLine("1 kg rice", 10);

    expect(scaled.amount).toBeCloseTo(10, 6);
    expect(scaled.unit).toBe("kg");
    expect(scaled.text).toContain("10 kg rice");
  });

  it("leaves a line carrying no quantity untouched", () => {
    const scaled = scaleLine("salt and pepper", 20);

    expect(scaled.scaling).toBe("unscaled");
    expect(scaled.text).toBe("salt and pepper");
    expect(scaled.amount).toBeNull();
    expect(scaled.unit).toBeNull();
  });
});
