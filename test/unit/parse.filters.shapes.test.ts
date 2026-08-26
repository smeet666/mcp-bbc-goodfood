import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFilterGroups, parseFilterReport } from "../../src/bbcgoodfood/parse.js";
import { GoodFoodError } from "../../src/errors.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A payload shaped like the site's, carrying whatever `filters` the case needs. */
function payloadOf(filters: unknown): unknown {
  return { filters, searchResults: { totalItems: 12, limit: 24, items: [] } };
}

/** The code of the error a call throws, or a sentence naming what happened instead. */
function codeThrownBy(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof GoodFoodError) {
      return error.code;
    }
    return `threw something else: ${String(error)}`;
  }
  return "threw nothing";
}

/** The values a group renders, in order. */
function valuesOf(options: readonly { value: string }[]): string[] {
  return options.map((option) => option.value);
}

describe("parseFilterGroups — a group whose options are not an array", () => {
  const shapes: [string, unknown][] = [
    ["a string", "nut-free"],
    ["an object", { value: "nut-free" }],
    ["null", null],
    ["a number", 7],
  ];

  for (const [shape, options] of shapes) {
    it(`renders an empty option list when options is ${shape}`, () => {
      const { groups, skipped } = parseFilterGroups(
        payloadOf([{ name: "diet", label: "Diets", options }]),
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]?.name).toBe("diet");
      expect(groups[0]?.options).toEqual([]);
      expect(groups[0]?.option_count).toBe(0);
      // An unreadable option list is an empty list, not a reason to drop a group
      // whose name the caller can still replay.
      expect(skipped).toEqual([]);
    });
  }

  it("renders an empty option list when options is absent altogether", () => {
    const { groups, skipped } = parseFilterGroups(payloadOf([{ name: "diet", label: "Diets" }]));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.options).toEqual([]);
    expect(groups[0]?.option_count).toBe(0);
    expect(skipped).toEqual([]);
  });
});

describe("parseFilterGroups — an entry inside options that is not an object", () => {
  const payload = payloadOf([
    {
      name: "diet",
      label: "Diets",
      options: [
        { value: "vegan", label: "Vegan", count: 3 },
        "loose text",
        null,
        7,
        { value: "keto", label: "Keto", count: 1 },
      ],
    },
  ]);

  it("keeps the neighbours of a discarded entry", () => {
    const { groups } = parseFilterGroups(payload);

    expect(valuesOf(groups[0]?.options ?? [])).toEqual(["vegan", "keto"]);
    expect(groups[0]?.option_count).toBe(2);
  });

  it("names every discarded entry in skipped", () => {
    const { skipped } = parseFilterGroups(payload);

    expect(skipped).toHaveLength(3);
    for (const entry of skipped) {
      expect(typeof entry).toBe("string");
      expect(entry.trim()).not.toBe("");
    }
  });
});

describe("parseFilterGroups — the label a thing falls back to", () => {
  const labels: [string, unknown][] = [
    ["null", null],
    ["a number", 42],
  ];

  it("labels an option by its value when no label is published", () => {
    const { groups } = parseFilterGroups(
      payloadOf([{ name: "diet", label: "Diets", options: [{ value: "gluten-free", count: 4 }] }]),
    );

    expect(groups[0]?.options[0]?.label).toBe("gluten-free");
  });

  for (const [shape, label] of labels) {
    it(`labels an option by its value when its label is ${shape}`, () => {
      const { groups } = parseFilterGroups(
        payloadOf([
          { name: "diet", label: "Diets", options: [{ value: "gluten-free", label, count: 4 }] },
        ]),
      );

      expect(groups[0]?.options[0]?.label).toBe("gluten-free");
    });
  }

  it("labels an option by its value when its label is blank", () => {
    const { groups } = parseFilterGroups(
      payloadOf([
        {
          name: "diet",
          label: "Diets",
          options: [
            { value: "gluten-free", label: "", count: 4 },
            { value: "dairy-free", label: "   ", count: 2 },
          ],
        },
      ]),
    );

    expect(groups[0]?.options[0]?.label).toBe("gluten-free");
    expect(groups[0]?.options[1]?.label).toBe("dairy-free");
  });

  it("labels a group by its name when no label is published", () => {
    const { groups } = parseFilterGroups(
      payloadOf([{ name: "mealType", options: [{ value: "supper", label: "Supper", count: 4 }] }]),
    );

    expect(groups[0]?.label).toBe("mealType");
  });

  for (const [shape, label] of labels) {
    it(`labels a group by its name when its label is ${shape}`, () => {
      const { groups } = parseFilterGroups(
        payloadOf([
          { name: "mealType", label, options: [{ value: "supper", label: "Supper", count: 4 }] },
        ]),
      );

      expect(groups[0]?.label).toBe("mealType");
    });
  }

  it("labels a group by its name when its label is blank", () => {
    const { groups } = parseFilterGroups(
      payloadOf([
        {
          name: "mealType",
          label: "  ",
          options: [{ value: "supper", label: "Supper", count: 4 }],
        },
      ]),
    );

    expect(groups[0]?.label).toBe("mealType");
  });
});

describe("parseFilterGroups — how a discarded thing is named", () => {
  it("names a discarded group by its label first", () => {
    const { groups, skipped } = parseFilterGroups(
      payloadOf([{ label: "Difficulty", options: [{ value: "easy", label: "Easy", count: 3 }] }]),
    );

    expect(groups).toEqual([]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("Difficulty");
  });

  it("names a discarded group even when it has neither label nor name", () => {
    const { skipped } = parseFilterGroups(
      payloadOf([{ options: [{ value: "easy", label: "Easy", count: 3 }] }]),
    );

    expect(skipped).toHaveLength(1);
    // A discard nobody can name is a discard nobody can act on: the fallback
    // still writes a line.
    expect(skipped[0]?.trim()).not.toBe("");
    expect(skipped[0]).not.toContain("undefined");
    expect(skipped[0]).not.toContain("null");
  });

  it("names a discarded option by its label first", () => {
    const { skipped } = parseFilterGroups(
      payloadOf([{ name: "mealType", label: "Meal type", options: [{ label: "Supper" }] }]),
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("Supper");
  });

  it("names a discarded option by its name when it carries no label", () => {
    const { skipped } = parseFilterGroups(
      payloadOf([{ name: "mealType", label: "Meal type", options: [{ name: "supperName" }] }]),
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("supperName");
  });

  it("names a discarded option even when it has neither label nor name nor value", () => {
    const { skipped } = parseFilterGroups(
      payloadOf([{ name: "mealType", label: "Meal type", options: [{ count: 3 }] }]),
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.trim()).not.toBe("");
    expect(skipped[0]).not.toContain("undefined");
    expect(skipped[0]).not.toContain("null");
  });
});

describe("parseFilterGroups — a payload that is not an object", () => {
  const payloads: [string, unknown][] = [
    ["a string", "filters"],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["an array", []],
  ];

  for (const [shape, payload] of payloads) {
    it(`renders no group and raises nothing when the payload is ${shape}`, () => {
      const read = (): ReturnType<typeof parseFilterGroups> => parseFilterGroups(payload);

      expect(read).not.toThrow();
      expect(read().groups).toEqual([]);
      expect(read().skipped).toEqual([]);
    });
  }
});

describe("parseFilterReport — a payload that is not an object", () => {
  const payloads: [string, unknown][] = [
    ["a string", "searchResults"],
    ["a number", 7],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
  ];

  for (const [shape, payload] of payloads) {
    it(`raises parse_failure when the payload is ${shape}`, () => {
      // Nothing is readable there, and an empty report would dress a breakdown
      // up as a result.
      expect(codeThrownBy(() => parseFilterReport(payload, null))).toBe("parse_failure");
    });
  }
});
