import { describe, expect, it } from "vitest";
import { scaleLine } from "../../src/recipe/scale.js";

describe("scaleLine reads a written line", () => {
  it("reads a whole number followed by a unit and a food", () => {
    const line = scaleLine("200 g flour", 1);

    expect(line.amount).toBe(200);
    expect(line.amount_max).toBeNull();
    expect(line.unit).toMatch(/^(g|grams?)$/i);
    expect(line.text).toContain("flour");
  });

  it("reads a decimal amount", () => {
    const line = scaleLine("1.5 tbsp oil", 1);

    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.unit).toMatch(/^(tbsp|tablespoons?)$/i);
  });

  it("reads a written fraction", () => {
    const line = scaleLine("1/2 tsp salt", 1);

    expect(line.amount).toBeCloseTo(0.5, 6);
    expect(line.unit).toMatch(/^(tsp|teaspoons?)$/i);
  });

  it("reads a typographic fraction", () => {
    const line = scaleLine("½ tsp salt", 1);

    expect(line.amount).toBeCloseTo(0.5, 6);
    expect(line.unit).toMatch(/^(tsp|teaspoons?)$/i);
  });

  it("reads a whole number followed by a fraction", () => {
    const line = scaleLine("1 1/2 cups milk", 1);

    expect(line.amount).toBeCloseTo(1.5, 6);
    expect(line.unit).toMatch(/^(cups?)$/i);
  });

  it("reads a count carrying no unit", () => {
    const line = scaleLine("3 onions, finely chopped", 1);

    expect(line.amount).toBe(3);
    expect(line.unit).toBeNull();
    expect(line.amount_max).toBeNull();
  });

  it("reads a hyphenated range", () => {
    const line = scaleLine("4-6 eggs", 1);

    expect(line.amount).toBe(4);
    expect(line.amount_max).toBe(6);
  });

  it("reads a range written with 'to'", () => {
    const line = scaleLine("4 to 6 eggs", 1);

    expect(line.amount).toBe(4);
    expect(line.amount_max).toBe(6);
  });
});

describe("scaleLine leaves a line carrying no quantity alone", () => {
  const noQuantity: string[] = ["salt, to taste", "oil, for frying", "a pinch of cinnamon"];

  for (const line of noQuantity) {
    it(`reports "${line}" as unscaled`, () => {
      const result = scaleLine(line, 2);

      expect(result.scaling).toBe("unscaled");
      expect(result.amount).toBeNull();
      expect(result.amount_max).toBeNull();
      expect(result.text).toBe(result.original);
      expect(result.text).toBe(line);
    });
  }

  it("leaves such a line alone whatever the factor", () => {
    const result = scaleLine("salt, to taste", 0.25);

    expect(result.scaling).toBe("unscaled");
    expect(result.amount).toBeNull();
    expect(result.text).toBe("salt, to taste");
  });
});

describe("scaleLine keeps the line it was given", () => {
  it("keeps the original on a scaled line", () => {
    const result = scaleLine("2 eggs", 2);

    expect(result.scaling).toBe("scaled");
    expect(result.original).toBe("2 eggs");
  });

  it("keeps the original on a rounded line", () => {
    const result = scaleLine("3 eggs", 0.5);

    expect(result.scaling).toBe("rounded");
    expect(result.original).toBe("3 eggs");
  });

  it("keeps the original on an unscaled line", () => {
    const result = scaleLine("oil, for frying", 3);

    expect(result.scaling).toBe("unscaled");
    expect(result.original).toBe("oil, for frying");
  });
});

describe("scaleLine with a factor of one", () => {
  it("leaves a counted line untouched", () => {
    const result = scaleLine("3 onions, finely chopped", 1);

    expect(result.scaling).toBe("scaled");
    expect(result.text).toBe("3 onions, finely chopped");
    expect(result.original).toBe("3 onions, finely chopped");
    expect(result.amount).toBe(3);
  });

  it("leaves a measured line untouched", () => {
    const result = scaleLine("200 g flour", 1);

    expect(result.scaling).toBe("scaled");
    expect(result.text).toBe("200 g flour");
    expect(result.amount).toBe(200);
  });
});

describe("scaleLine on a range", () => {
  it("scales both bounds upwards", () => {
    const result = scaleLine("4-6 eggs", 2);

    expect(result.amount).toBe(8);
    expect(result.amount_max).toBe(12);
    expect(result.scaling).toBe("scaled");
    expect(result.text).toMatch(/8\s*(-|–|to)\s*12/);
  });

  it("scales both bounds downwards", () => {
    const result = scaleLine("4-6 eggs", 0.5);

    expect(result.amount).toBe(2);
    expect(result.amount_max).toBe(3);
    expect(result.scaling).toBe("scaled");
  });

  it("reports rounded when one bound had to move", () => {
    const result = scaleLine("3-5 eggs", 0.5);

    expect(result.scaling).toBe("rounded");
    expect(result.amount).toBe(2);
    expect(result.amount_max).toBe(3);
  });

  it("leaves amount_max null when the line gives no range", () => {
    const result = scaleLine("200 g flour", 2);

    expect(result.amount).toBe(400);
    expect(result.amount_max).toBeNull();
  });
});
