import { describe, expect, it } from "vitest";
import { divisibilityOf } from "../../src/recipe/divisibility.js";
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

describe("what comes out whole or not at all", () => {
  const whole: string[] = [
    "egg",
    "eggs",
    "yolk",
    "yolks",
    "egg yolk",
    "egg yolks",
    "egg white",
    "egg whites",
    "zest",
    "zests",
    "lemon zest",
  ];

  for (const item of whole) {
    it(`counts ${item} in whole ones`, () => {
      expect(ofItem(item)).toBe("whole");
    });
  }
});

describe("what is already a portion on its own", () => {
  const whole: string[] = [
    "prawn",
    "prawns",
    "mussel",
    "mussels",
    "hazelnut",
    "hazelnuts",
    "peppercorn",
    "peppercorns",
    "juniper berry",
    "juniper berries",
    "star anise",
  ];

  for (const item of whole) {
    it(`counts ${item} in whole ones`, () => {
      expect(ofItem(item)).toBe("whole");
    });
  }
});

describe("what is poured or cut in two and no finer", () => {
  const half: string[] = [
    "can",
    "cans",
    "can of chopped tomatoes",
    "garlic clove",
    "garlic cloves",
    "clove of garlic",
    "gelatine leaf",
    "gelatine leaves",
    "juice",
    "lemon juice",
    "orange juice",
  ];

  for (const item of half) {
    it(`divides ${item} in two`, () => {
      expect(ofItem(item)).toBe("half");
    });
  }
});

describe("what a knife divides further", () => {
  const quarter: string[] = [
    "onion",
    "apple",
    "lemon",
    "tomato",
    "cucumber",
    "courgette",
    "aubergine",
    "squash",
    "cabbage",
    "melon",
    "pepper",
    "leek",
    "banana",
    "mango",
    "pineapple",
    "peach",
    "avocado",
    "leg of lamb",
    "baguette",
    "camembert",
    "chorizo",
    "chicken",
  ];

  for (const item of quarter) {
    it(`divides ${item} in four`, () => {
      expect(ofItem(item)).toBe("quarter");
    });
  }

  it("divides those foods in four in the plural too", () => {
    expect(ofItem("onions")).toBe("quarter");
    expect(ofItem("apples")).toBe("quarter");
    expect(ofItem("tomatoes")).toBe("quarter");
    expect(ofItem("peaches")).toBe("quarter");
    expect(ofItem("mangoes")).toBe("quarter");
  });
});

describe("what nothing tells us about", () => {
  const half: string[] = ["quinoa", "sourdough starter", "harissa", "widget", ""];

  for (const item of half) {
    it(`gives half on "${item}", the part most things give by eye`, () => {
      expect(ofItem(item)).toBe("half");
    });
  }
});

describe("a unit that measures overrules what is counted", () => {
  it("divides 100 g of apples as a mass", () => {
    expect(divisibilityOf(mustLookup("g"), "apples")).toBe("half");
  });

  it("divides the same apples in four when the line names no unit", () => {
    expect(ofItem("apples")).toBe("quarter");
  });

  it("divides a weight of eggs as a mass rather than as eggs", () => {
    expect(divisibilityOf(mustLookup("kg"), "eggs")).toBe("half");
    expect(ofItem("eggs")).toBe("whole");
  });

  it("divides a cup of hazelnuts as a cup rather than as hazelnuts", () => {
    expect(divisibilityOf(mustLookup("cup"), "hazelnuts")).toBe("half");
    expect(ofItem("hazelnuts")).toBe("whole");
  });

  it("counts a handful of eggs in whole ones, both readings agreeing", () => {
    expect(mustLookup("handful").measures).toBe(false);
    expect(divisibilityOf(mustLookup("handful"), "eggs")).toBe("whole");
  });
});

describe("case and plural are indifferent", () => {
  it("gives one verdict for onion however it is written", () => {
    expect(ofItem("onion")).toBe("quarter");
    expect(ofItem("Onions")).toBe("quarter");
    expect(ofItem("ONION")).toBe("quarter");
    expect(ofItem("oNiOn")).toBe("quarter");
  });

  it("gives one verdict for egg however it is written", () => {
    expect(ofItem("Egg")).toBe("whole");
    expect(ofItem("EGGS")).toBe("whole");
  });

  it("gives one verdict for a garlic clove however it is written", () => {
    expect(ofItem("Garlic Clove")).toBe("half");
    expect(ofItem("GARLIC CLOVES")).toBe("half");
  });
});

describe("a word that merely contains a food is not that food", () => {
  it("does not read lemongrass as a lemon", () => {
    expect(ofItem("lemon")).toBe("quarter");
    expect(ofItem("lemongrass")).toBe("half");
    expect(ofItem("lemongrass stalks")).toBe("half");
  });

  it("does not read chicken stock as a chicken", () => {
    expect(ofItem("chicken")).toBe("quarter");
    expect(ofItem("chicken stock")).toBe("half");
  });

  it("does not read a peppercorn as a pepper", () => {
    expect(ofItem("pepper")).toBe("quarter");
    expect(ofItem("peppercorns")).toBe("whole");
  });

  it("does not read eggnog or an aubergine as an egg", () => {
    expect(ofItem("eggnog")).toBe("half");
    expect(ofItem("aubergine")).toBe("quarter");
  });
});
