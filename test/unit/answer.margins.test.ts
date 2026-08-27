import { describe, expect, it } from "vitest";
import { scaleLine } from "../../src/recipe/scale.js";
import { MAX_TEXT_CHARS, ok } from "../../src/tools/shared.js";

describe("a line carrying a number that names no measure", () => {
  it("scales a line whose remainder counts something rather than measuring it", () => {
    const line = scaleLine("2 tbsp oil, 3 large onions", 2);

    expect(line.scaling).toBe("scaled");
    expect(line.amount).toBe(4);
    expect(line.unit).toBe("tbsp");
    expect(line.text).toBe("4 tbsp oil, 3 large onions");
  });
});

describe("a body that loses a single line", () => {
  it("counts the one line in the singular", () => {
    const body = `${"z".repeat(MAX_TEXT_CHARS)}\nthe line that does not fit`;

    const text = ok({ total: 1 }, body).content[0]?.text ?? "";

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(text).toContain("1 of the 2 lines does not fit in this block");
  });
});
