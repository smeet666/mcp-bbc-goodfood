import { describe, expect, it } from "vitest";
import { scaleLine } from "../../src/recipe/scale.js";

/**
 * The edges of what a written quantity can say.
 *
 * A line whose number says nothing usable is left exactly as it came. Putting a
 * figure on it would mean stating an amount the line never carried.
 */
describe("a quantity that names no usable amount", () => {
  it("leaves a fraction over zero alone", () => {
    const line = scaleLine("1/0 tsp salt", 2);

    expect(line.scaling).toBe("unscaled");
    expect(line.text).toBe("1/0 tsp salt");
    expect(line.amount).toBeNull();
  });

  it("leaves a quantity of zero alone", () => {
    const line = scaleLine("0 g flour", 2);

    expect(line.scaling).toBe("unscaled");
    expect(line.text).toBe("0 g flour");
  });

  it("leaves a run of digits too long to be a number alone", () => {
    const written = `${"1".repeat(400)} g flour`;

    const line = scaleLine(written, 2);

    expect(line.scaling).toBe("unscaled");
    expect(line.text).toBe(written);
  });

  it("keeps a quantity followed by no word at all", () => {
    const line = scaleLine("2 & more", 2);

    expect(line.scaling).toBe("scaled");
    expect(line.unit).toBeNull();
    expect(line.text).toBe("4 & more");
  });
});
