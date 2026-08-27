import { describe, expect, it } from "vitest";
import { GoodFoodError } from "../../src/errors.js";
import { scaleLine, scaleParts } from "../../src/recipe/scale.js";

function expectInvalidInput(run: () => unknown): void {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GoodFoodError);
  expect((caught as GoodFoodError).code).toBe("invalid_input");
}

describe("scaleLine rounds what a kitchen cannot divide", () => {
  it("reports arithmetic that lands exactly as scaled", () => {
    const result = scaleLine("2 eggs", 2);

    expect(result.amount).toBe(4);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/\b4\b/);
    expect(result.text).toContain("egg");
  });

  it("rounds half an egg up to a whole one", () => {
    const result = scaleLine("3 eggs", 0.5);

    expect(result.amount).toBe(2);
    expect(result.scaling).toBe("rounded");
    expect(result.text).toMatch(/\b2\b/);
    expect(result.text).not.toMatch(/1\.5|1\s*1?\/2|½/);
  });

  it("halves something that pours", () => {
    const result = scaleLine("1 can tomatoes", 0.5);

    expect(result.amount).toBeCloseTo(0.5, 6);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/½|1\/2|0\.5/);
  });

  it("quarters something a knife divides further", () => {
    const result = scaleLine("1 onion", 0.25);

    expect(result.amount).toBeCloseTo(0.25, 6);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/¼|1\/4|0\.25/);
  });

  it("rounds up something that is a portion on its own", () => {
    const result = scaleLine("5 prawns", 0.5);

    expect(result.amount).toBe(3);
    expect(result.scaling).toBe("rounded");
    expect(result.text).toMatch(/\b3\b/);
  });
});

describe("scaleLine steps down a unit only when it must", () => {
  it("keeps grams when grams still hold the amount", () => {
    const result = scaleLine("200 g flour", 0.1);

    expect(result.amount).toBeCloseTo(20, 6);
    expect(result.unit).toMatch(/^(g|grams?)$/i);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/\b20\s?(g|grams?)\b/i);
    expect(result.text).not.toMatch(/\bmg\b|milligram/i);
  });

  it("steps grams down to milligrams rather than rounding to nothing", () => {
    const result = scaleLine("2 g yeast", 0.1);

    expect(result.amount).toBeCloseTo(200, 6);
    expect(result.unit).toMatch(/^(mg|milligrams?)$/i);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/\b200\s?mg\b/i);
  });

  it("steps down two rungs when one is not enough", () => {
    const result = scaleLine("1 kg potatoes", 0.001);

    expect(result.amount).toBeCloseTo(1, 6);
    expect(result.unit).toMatch(/^(g|grams?)$/i);
    expect(result.text).toMatch(/\b1\s?(g|grams?)\b/i);
  });

  it("steps a tablespoon down to a teaspoon", () => {
    const result = scaleLine("1 tbsp oil", 1 / 3);

    expect(result.amount).toBeCloseTo(1, 6);
    expect(result.unit).toMatch(/^(tsp|teaspoons?)$/i);
    expect(result.scaling).toBe("scaled");
  });

  it("rounds without stepping down at the bottom of a ladder", () => {
    const result = scaleLine("2 mg saffron", 0.001);

    expect(result.unit).toMatch(/^(mg|milligrams?)$/i);
    expect(result.scaling).toBe("rounded");
    expect(result.amount).not.toBeNull();
    expect(result.amount ?? 0).toBeGreaterThan(0);
    expect(result.text).not.toMatch(/(^|[^\d.])0\s?mg\b/i);
  });

  it("counts an approximate measure in whole ones and never converts it", () => {
    const result = scaleLine("2 pinches of salt", 3);

    expect(result.amount).toBe(6);
    expect(result.unit).toMatch(/^(pinch|pinches)$/i);
    expect(result.scaling).toBe("scaled");
    expect(result.text).not.toMatch(/\bg\b/i);
    expect(result.text).not.toMatch(/gram/i);
  });
});

describe("scaleLine refuses a factor that is not finite and positive", () => {
  const factors: number[] = [
    0,
    -1,
    -0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const factor of factors) {
    it(`refuses ${String(factor)}`, () => {
      expectInvalidInput(() => scaleLine("200 g flour", factor));
    });
  }

  it("refuses the same factors through the split entry point", () => {
    expectInvalidInput(() =>
      scaleParts({ text: "200 g flour", amount: 200, unit: "g", item: "flour", note: null }, 0),
    );
    expectInvalidInput(() =>
      scaleParts(
        { text: "200 g flour", amount: 200, unit: "g", item: "flour", note: null },
        Number.NaN,
      ),
    );
  });
});

describe("scaleParts answers as the written line does", () => {
  const pairs: {
    line: string;
    parts: {
      text: string;
      amount: number | null;
      unit: string | null;
      item: string;
      note: string | null;
    };
    factor: number;
  }[] = [
    {
      line: "200 g flour",
      parts: { text: "200 g flour", amount: 200, unit: "g", item: "flour", note: null },
      factor: 0.1,
    },
    {
      line: "3 eggs",
      parts: { text: "3 eggs", amount: 3, unit: null, item: "eggs", note: null },
      factor: 0.5,
    },
    {
      line: "1 onion",
      parts: { text: "1 onion", amount: 1, unit: null, item: "onion", note: null },
      factor: 0.25,
    },
    {
      line: "2 g yeast",
      parts: { text: "2 g yeast", amount: 2, unit: "g", item: "yeast", note: null },
      factor: 0.1,
    },
  ];

  for (const pair of pairs) {
    it(`agrees with scaleLine on "${pair.line}"`, () => {
      const written = scaleLine(pair.line, pair.factor);
      const split = scaleParts(pair.parts, pair.factor);

      expect(split.scaling).toBe(written.scaling);
      expect(split.amount_max).toBe(written.amount_max);
      expect(split.unit).toBe(written.unit);
      if (written.amount === null) {
        expect(split.amount).toBeNull();
      } else {
        expect(split.amount ?? Number.NaN).toBeCloseTo(written.amount, 6);
      }
    });
  }

  it("leaves a part carrying no amount alone", () => {
    const result = scaleParts(
      { text: "salt, to taste", amount: null, unit: null, item: "salt", note: "to taste" },
      2,
    );

    expect(result.scaling).toBe("unscaled");
    expect(result.amount).toBeNull();
    expect(result.amount_max).toBeNull();
    expect(result.text).toBe("salt, to taste");
    expect(result.original).toBe("salt, to taste");
  });

  it("carries the note through the scaling", () => {
    const result = scaleParts(
      {
        text: "3 onions, finely chopped",
        amount: 3,
        unit: null,
        item: "onions",
        note: "finely chopped",
      },
      2,
    );

    expect(result.amount).toBe(6);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toContain("finely chopped");
    expect(result.text).toMatch(/\b6\b/);
    expect(result.original).toBe("3 onions, finely chopped");
  });
});
