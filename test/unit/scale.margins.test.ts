import { describe, expect, it } from "vitest";
import { scaleLine, scaleParts } from "../../src/recipe/scale.js";

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

/**
 * A line whose wording states no quantity, and whose published parts do.
 *
 * The site sometimes writes an amount only in the parts it publishes beside a
 * line, so the parts are what is left to scale from.
 */
describe("a published line the wording alone cannot scale", () => {
  it("scales from the parts when the wording states no quantity", () => {
    const line = scaleParts(
      { text: "a good handful of parsley", amount: 1, unit: null, item: "parsley", note: null },
      3,
    );

    expect(line.original).toBe("a good handful of parsley");
    expect(line.amount).toBe(3);
    expect(line.text).toBe("3 parsley");
    expect(line.scaling).toBe("scaled");
  });

  it("keeps the note the site publishes beside the line", () => {
    const line = scaleParts(
      { text: "sea salt, to taste", amount: 2, unit: "pinch", item: "sea salt", note: "to taste" },
      2,
    );

    expect(line.text).toBe("4 pinch sea salt, to taste");
    expect(line.unit).toBe("pinch");
  });

  it("moves the figure of a published part that cannot be halved", () => {
    const line = scaleParts(
      { text: "eggs, beaten", amount: 3, unit: null, item: "eggs", note: "beaten" },
      0.5,
    );

    expect(line.scaling).toBe("rounded");
    expect(line.amount).toBe(2);
    expect(line.text).toBe("2 eggs, beaten");
  });

  it("leaves a line alone when neither its wording nor its parts state a quantity", () => {
    const line = scaleParts(
      {
        text: "icing sugar, for dusting",
        amount: null,
        unit: null,
        item: "icing sugar",
        note: "for dusting",
      },
      2,
    );

    expect(line.scaling).toBe("unscaled");
    expect(line.text).toBe("icing sugar, for dusting");
    expect(line.amount).toBeNull();
  });
});
