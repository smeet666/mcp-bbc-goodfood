import { describe, expect, it } from "vitest";
import { divisibilityOf } from "../../src/recipe/divisibility.js";
import { scaleLine } from "../../src/recipe/scale.js";
import { type Divisibility, lookupUnit, type UnitInfo } from "../../src/recipe/units.js";

/** The unit a word names, or a failure that says which word went missing. */
function mustLookup(word: string): UnitInfo {
  const found = lookupUnit(word);
  if (found === null) {
    throw new Error(`the unit table does not know "${word}"`);
  }
  return found;
}

/** What a line counting this item divides into, when the line names no unit. */
function ofItem(item: string): Divisibility {
  return divisibilityOf(null, item);
}

describe("a counted unit bounds the division whatever food follows", () => {
  it("halves a can of a food a knife would quarter", () => {
    expect(divisibilityOf(mustLookup("can"), "chopped tomatoes")).toBe("half");
  });

  it("rounds three quarters of one can up to a whole can", () => {
    const result = scaleLine("1 can chopped tomatoes", 0.75);

    expect(result.text).toContain("1 can");
    expect(result.scaling).toBe("rounded");
  });

  it("rounds three quarters of one of two cans up to a whole can", () => {
    const result = scaleLine("2 cans chopped tomatoes", 0.375);

    expect(result.text).toContain("1 can");
    expect(result.scaling).toBe("rounded");
  });

  it("halves one can exactly", () => {
    const result = scaleLine("1 can chopped tomatoes", 0.5);

    expect(result.amount).toBeCloseTo(0.5, 6);
    expect(result.text).toContain("½ can");
    expect(result.scaling).toBe("scaled");
  });

  it("halves a clove exactly", () => {
    const result = scaleLine("2 cloves garlic", 0.75);

    expect(result.amount).toBeCloseTo(1.5, 6);
    expect(result.text).toContain("1½ clove");
    expect(result.scaling).toBe("scaled");
  });

  // A unit that counts bounds the division alongside the food, and the larger
  // of the two shares wins. A tin halves whatever it holds; a block of butter
  // takes a quarter of its own accord, so a quarter is what a quarterable food
  // in a quarterable unit comes to.
  const counted: [string, Divisibility][] = [
    ["can", "half"],
    ["tin", "half"],
    ["clove", "half"],
    ["sheet", "half"],
    ["bottle", "quarter"],
    ["jar", "quarter"],
    ["block", "quarter"],
    ["slice", "quarter"],
  ];

  for (const [unit, expected] of counted) {
    it(`bounds ${unit} of onions at a ${expected}`, () => {
      expect(divisibilityOf(mustLookup(unit), "onions")).toBe(expected);
    });
  }

  it("lets the food hold the line where it is the coarser of the two", () => {
    // A slice takes a quarter of its own accord, and bread halves. The larger
    // of the two shares is what a kitchen ends up taking.
    expect(divisibilityOf(mustLookup("slice"), "sourdough bread")).toBe("half");
  });

  it("lets the unit hold the line where it is the coarser of the two", () => {
    expect(divisibilityOf(mustLookup("pinch"), "onions")).toBe("whole");
  });
});

describe("a herb leaf is counted whole and gelatine is not", () => {
  const rows: [string, Divisibility][] = [
    ["bay leaves", "whole"],
    ["fresh curry leaves", "whole"],
    ["kaffir lime leaves", "whole"],
    ["basil leaves", "whole"],
    ["gelatine leaves", "half"],
    ["leaf gelatine", "half"],
    ["filo pastry sheets", "half"],
    ["lasagne sheets", "half"],
  ];

  for (const [item, expected] of rows) {
    it(`divides ${item} into ${expected} ones`, () => {
      expect(ofItem(item)).toBe(expected);
    });
  }
});

describe("a size word brings a quarterable food back to the whole one", () => {
  const rows: [string, Divisibility][] = [
    ["cherry tomatoes", "whole"],
    ["sun-dried tomatoes", "whole"],
    ["new potatoes", "whole"],
    ["baby potatoes", "whole"],
    ["dried apricots", "whole"],
    ["tomatoes", "quarter"],
    ["potatoes", "quarter"],
    ["apricots", "quarter"],
  ];

  for (const [item, expected] of rows) {
    it(`divides ${item} into ${expected} ones`, () => {
      expect(ofItem(item)).toBe(expected);
    });
  }
});

describe("a cut of poultry is counted", () => {
  const rows: [string, Divisibility][] = [
    ["chicken thighs", "whole"],
    ["chicken drumsticks", "whole"],
    ["chicken breasts", "whole"],
    ["chicken wings", "whole"],
    ["chicken fillets", "whole"],
    ["chicken", "quarter"],
    ["whole chicken", "quarter"],
  ];

  for (const [item, expected] of rows) {
    it(`divides ${item} into ${expected} ones`, () => {
      expect(ofItem(item)).toBe(expected);
    });
  }

  const cuts: string[] = ["thigh", "drumstick", "breast", "wing", "leg", "fillet"];

  for (const cut of cuts) {
    it(`counts a chicken ${cut} whole in the singular and the plural`, () => {
      expect(ofItem(`chicken ${cut}`)).toBe("whole");
      expect(ofItem(`chicken ${cut}s`)).toBe("whole");
    });
  }
});

describe("what is already a portion is counted whole", () => {
  const items: string[] = [
    "sausages",
    "chipolatas",
    "rashers of streaky bacon",
    "scallops",
    "tortillas",
    "wraps",
    "pitta breads",
    "burger buns",
    "cardamom pods",
    "vanilla pods",
    "lamb chops",
    "prawns",
    "star anise",
    "peppercorns",
  ];

  for (const item of items) {
    it(`counts ${item} in whole ones`, () => {
      expect(ofItem(item)).toBe("whole");
    });
  }
});

describe("a word carrying a food inside it stays where it was", () => {
  const items: string[] = ["lemongrass", "chicken stock", "eggnog", "lemon juice"];

  for (const item of items) {
    it(`divides ${item} in half and no finer`, () => {
      expect(ofItem(item)).toBe("half");
    });
  }
});

describe("what the reading already settles", () => {
  const rows: [string, Divisibility][] = [
    ["eggs", "whole"],
    ["egg yolks", "whole"],
    ["egg whites", "whole"],
    ["zest", "whole"],
    ["onions", "quarter"],
    ["apples", "quarter"],
    ["lemons", "quarter"],
    ["peppers", "quarter"],
    ["leeks", "quarter"],
    ["bananas", "quarter"],
    ["quinoa", "half"],
    ["harissa", "half"],
    ["widget", "half"],
  ];

  for (const [item, expected] of rows) {
    it(`divides ${item} into ${expected} ones`, () => {
      expect(ofItem(item)).toBe(expected);
    });
  }

  it("lets a weight divide past what the food would allow", () => {
    const result = scaleLine("200 g potatoes", 0.5);

    expect(result.amount).toBeCloseTo(100, 6);
    expect(result.scaling).toBe("scaled");
  });

  it("lets a spoon divide past what the food would allow", () => {
    const result = scaleLine("2 tbsp chopped onions", 0.5);

    expect(result.amount).toBeCloseTo(1, 6);
    expect(result.scaling).toBe("scaled");
  });
});

describe("no line offers a share of something nobody cuts", () => {
  const whole: string[] = [
    "bay leaves",
    "fresh curry leaves",
    "kaffir lime leaves",
    "basil leaves",
    "cherry tomatoes",
    "sun-dried tomatoes",
    "new potatoes",
    "baby potatoes",
    "dried apricots",
    "chicken thighs",
    "chicken drumsticks",
    "chicken breasts",
    "chicken wings",
    "chicken fillets",
    "sausages",
    "chipolatas",
    "rashers of streaky bacon",
    "scallops",
    "tortillas",
    "wraps",
    "pitta breads",
    "burger buns",
    "cardamom pods",
    "vanilla pods",
    "lamb chops",
    "prawns",
    "star anise",
    "peppercorns",
    "eggs",
    "egg yolks",
    "egg whites",
    "zest",
  ];
  const factors: number[] = [0.5, 0.75, 0.3, 0.45];

  for (const item of whole) {
    for (const factor of factors) {
      it(`renders ${item} at ${factor} without a share of one`, () => {
        const result = scaleLine(`4 ${item}`, factor);

        expect(result.text).not.toMatch(/[½¼¾]/);
        expect(result.text).not.toMatch(/\d\.\d/);
      });
    }
  }
});
