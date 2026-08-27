import { describe, expect, it } from "vitest";
import { scaleLine } from "../../src/recipe/scale.js";

/** One rendered line, as a caller reads it. */
type Line = ReturnType<typeof scaleLine>;

/** Every numeric field a caller may quote from a line. */
function numbersOf(line: Line): (number | null)[] {
  return [line.amount, line.amount_max];
}

describe("a range keeps both bounds in one unit", () => {
  it("carries a kilogram range down to grams", () => {
    const line = scaleLine("0.5-2 kg beef", 1);

    expect(line.text).toBe("500-2000 g beef");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(500, 6);
    expect(line.amount_max).toBeCloseTo(2000, 6);
    expect(line.unit).toBe("g");
  });

  it("carries a tablespoon range down to teaspoons", () => {
    const line = scaleLine("2-3 tbsp oil", 0.25);

    expect(line.text).toBe("1½-2¼ tsp oil");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.amount_max).toBeCloseTo(2.25, 6);
    expect(line.unit).toBe("tsp");
  });

  it("carries a gram range down to milligrams", () => {
    const line = scaleLine("100-200 g flour", 0.005);

    expect(line.text).toBe("500-1000 mg flour");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(500, 6);
    expect(line.amount_max).toBeCloseTo(1000, 6);
    expect(line.unit).toBe("mg");
  });

  it("keeps a countable range without a unit", () => {
    const line = scaleLine("4-6 eggs", 2);

    expect(line.text).toBe("8-12 eggs");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(8, 6);
    expect(line.amount_max).toBeCloseTo(12, 6);
  });
});

describe("a thousands separator is not a decimal comma", () => {
  it("reads 1,000g as a thousand grams", () => {
    const line = scaleLine("1,000g strong white flour", 1);

    expect(line.text).toBe("1 kg strong white flour");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1, 6);
    expect(line.unit).toBe("kg");
  });

  it("reads 1,500ml as a litre and a half", () => {
    const line = scaleLine("1,500ml chicken stock", 1);

    expect(line.text).toBe("1.5 l chicken stock");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.unit).toBe("l");
  });

  it("reads 1,250g as a kilogram and a quarter", () => {
    const line = scaleLine("1,250g sugar", 1);

    expect(line.text).toBe("1.25 kg sugar");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1.25, 6);
    expect(line.unit).toBe("kg");
  });

  it("reads 0,5 l as half a litre", () => {
    const line = scaleLine("0,5 l milk", 1);

    expect(line.text).toBe("500 ml milk");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(500, 6);
    expect(line.unit).toBe("ml");
  });

  it("reads 1,5 kg as a kilogram and a half", () => {
    const line = scaleLine("1,5 kg beef", 1);

    expect(line.text).toBe("1.5 kg beef");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.unit).toBe("kg");
  });

  it("renders a comma spelling that is neither reading as it stands", () => {
    const line = scaleLine("1,23,456 g flour", 2);

    expect(line.text).toBe("1,23,456 g flour");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });
});

describe("a whole number glued to a typographic fraction reads", () => {
  it("doubles one and a half teaspoons into a tablespoon", () => {
    const line = scaleLine("1½ tsp ground cumin", 2);

    expect(line.text).toBe("1 tbsp ground cumin");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1, 6);
    expect(line.unit).toBe("tbsp");
  });

  // A spoon and a cup are stated in fractions, the way a recipe writes them,
  // and only a metric measure is read off a scale as a decimal.
  it("keeps one and a half teaspoons at their own scale", () => {
    const line = scaleLine("1½ tsp ground cumin", 1);

    expect(line.text).toBe("1½ tsp ground cumin");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.unit).toBe("tsp");
  });

  it("keeps two and a half tablespoons", () => {
    const line = scaleLine("2½ tbsp oil", 1);

    expect(line.text).toBe("2½ tbsp oil");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(2.5, 6);
    expect(line.unit).toBe("tbsp");
  });

  it("keeps one and two thirds of a cup", () => {
    const line = scaleLine("1⅔ cups flour", 1);

    expect(line.text).toBe("1⅔ cup flour");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(5 / 3, 6);
    expect(line.unit).toBe("cup");
  });
});

describe("no quantity is infinite", () => {
  it("refuses a null denominator behind a whole number", () => {
    const line = scaleLine("1 1/0 cups flour", 2);

    expect(line.text).toBe("1 1/0 cups flour");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });

  it("refuses a bare null denominator", () => {
    const line = scaleLine("1/0 tsp salt", 2);

    expect(line.text).toBe("1/0 tsp salt");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });
});

describe("a number glued to a sign is not a quantity", () => {
  it("leaves a cocoa percentage alone", () => {
    const line = scaleLine("70% dark chocolate", 0.5);

    expect(line.text).toBe("70% dark chocolate");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });

  it("leaves a cocoa solids percentage alone", () => {
    const line = scaleLine("85% cocoa solids", 2);

    expect(line.text).toBe("85% cocoa solids");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });

  it("scales a weight that carries a percentage in its name", () => {
    const line = scaleLine("200g 70% dark chocolate", 2);

    expect(line.text).toBe("400 g 70% dark chocolate");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(400, 6);
    expect(line.unit).toBe("g");
  });
});

describe("a line carrying two measures is not scaled by halves", () => {
  it("leaves a metric and imperial pair alone", () => {
    const line = scaleLine("500ml/18fl oz milk", 2);

    expect(line.text).toBe("500ml/18fl oz milk");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });

  it("leaves a spoon measure with its parenthesised equivalent alone", () => {
    const line = scaleLine("2 tbsp (30ml) oil", 0.5);

    expect(line.text).toBe("2 tbsp (30ml) oil");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
  });

  it("scales a single measure followed by a food", () => {
    const line = scaleLine("200g plain flour", 2);

    expect(line.text).toBe("400 g plain flour");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(400, 6);
    expect(line.unit).toBe("g");
  });

  it("scales a count followed by a qualifier that carries no number", () => {
    const line = scaleLine("1 onion, finely chopped", 2);

    expect(line.text).toBe("2 onion, finely chopped");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(2, 6);
  });
});

describe("a range whose bounds meet is written once", () => {
  it("writes a single figure when both bounds land together", () => {
    const line = scaleLine("2-3 eggs", 0.3);

    expect(line.text).toBe("1 eggs");
    expect(line.scaling).toBe("rounded");
    expect(line.amount).toBeCloseTo(1, 6);
    expect([null, 1]).toContain(line.amount_max);
  });
});

describe("amount_max never falls under amount", () => {
  const ranges: { line: string; factor: number }[] = [
    { line: "0.5-2 kg beef", factor: 1 },
    { line: "0.5-2 kg beef", factor: 0.001 },
    { line: "100-200 g flour", factor: 0.005 },
    { line: "100-200 g flour", factor: 20 },
    { line: "2-3 tbsp oil", factor: 0.25 },
    { line: "2-3 tbsp oil", factor: 8 },
    { line: "1-2 l stock", factor: 0.1 },
    { line: "250-500 ml milk", factor: 0.002 },
    { line: "1-3 tsp salt", factor: 3 },
    { line: "4-6 eggs", factor: 2 },
    { line: "4-6 eggs", factor: 0.25 },
    { line: "1000-2000 g sugar", factor: 0.0005 },
  ];

  for (const { line, factor } of ranges) {
    it(`keeps ${line} ordered at a factor of ${factor}`, () => {
      const rendered = scaleLine(line, factor);

      if (rendered.amount !== null && rendered.amount_max !== null) {
        expect(rendered.amount_max).toBeGreaterThanOrEqual(rendered.amount);
      }
    });
  }
});

describe("no rendered line carries Infinity or NaN", () => {
  const awkward: string[] = [
    "1 1/0 cups flour",
    "1/0 tsp salt",
    "1 1/000 g flour",
    "1/0.0 kg beef",
    "2 0/0 tsp salt",
    `${"9".repeat(400)} g flour`,
    "1e5 g flour",
    "1e5g flour",
    "1-1/0 kg beef",
  ];

  for (const written of awkward) {
    const label =
      written.length > 40 ? `${written.slice(0, 20)}… (${written.length} chars)` : written;

    it(`renders ${label} without an infinite or absent number`, () => {
      const line = scaleLine(written, 2);

      for (const value of numbersOf(line)) {
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }

      expect(line.text).not.toMatch(/Infinity|NaN/);
    });

    it(`survives a round trip through JSON for ${label}`, () => {
      const line = scaleLine(written, 2);
      const revived = JSON.parse(JSON.stringify(line)) as Record<string, unknown>;

      if (typeof line.amount === "number") {
        expect(revived.amount).not.toBeNull();
      }
      if (typeof line.amount_max === "number") {
        expect(revived.amount_max).not.toBeNull();
      }
    });
  }
});

describe("what already reads right goes on reading right", () => {
  it("doubles two hundred grams", () => {
    const line = scaleLine("200g", 2);

    expect(line.text).toBe("400 g");
    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBeCloseTo(400, 6);
    expect(line.unit).toBe("g");
  });

  it("halves three eggs into a usable count", () => {
    const line = scaleLine("3 eggs", 0.5);

    expect(line.text).toBe("2 eggs");
    expect(line.scaling).toBe("rounded");
    expect(line.amount).toBeCloseTo(2, 6);
  });

  it("quarters one onion", () => {
    const line = scaleLine("1 onion", 0.25);

    expect(line.text).toBe("¼ onion");
    expect(line.amount).toBeCloseTo(0.25, 6);
  });

  it("leaves a line that carries no quantity alone", () => {
    const line = scaleLine("salt and pepper", 2);

    expect(line.text).toBe("salt and pepper");
    expect(line.scaling).toBe("unscaled");
    expect(line.amount).toBeNull();
    expect(line.amount_max).toBeNull();
  });

  it("steps grams down to milligrams", () => {
    const line = scaleLine("2 g", 0.1);

    expect(line.text).toBe("200 mg");
    expect(line.amount).toBeCloseTo(200, 6);
    expect(line.unit).toBe("mg");
  });

  it("steps grams up to kilograms", () => {
    const line = scaleLine("200 g", 20);

    expect(line.text).toBe("4 kg");
    expect(line.amount).toBeCloseTo(4, 6);
    expect(line.unit).toBe("kg");
  });

  it("steps an awkward gram figure up to kilograms", () => {
    const line = scaleLine("1875 g", 1);

    expect(line.text).toBe("1.875 kg");
    expect(line.amount).toBeCloseTo(1.875, 6);
    expect(line.unit).toBe("kg");
  });
});
