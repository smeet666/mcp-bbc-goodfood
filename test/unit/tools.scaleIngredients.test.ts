import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GoodFoodError } from "../../src/errors.js";
import { createServer } from "../../src/server.js";
import {
  scaleIngredientsArgs,
  scaleIngredientsDescription,
  scaleIngredientsInput,
  scaleIngredientsOutputShape,
  runScaleIngredients,
} from "../../src/tools/scaleIngredients.js";

const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

/** One line as the tool renders it, in the shape the contract publishes. */
interface ScaledLine {
  text: string;
  original: string;
  scaling: "scaled" | "rounded" | "unscaled";
  amount: number | null;
  amount_max: number | null;
  unit: string | null;
}

/** The whole structured answer the tool publishes. */
interface ScaleOutput {
  factor: number;
  ingredients: ScaledLine[];
  scaled_count: number;
  rounded_count: number;
  unscaled_count: number;
  source: string;
  notes: string[];
}

type ScaleArgs = Parameters<typeof runScaleIngredients>[0];

/**
 * The tool's argument object, handed over as the tool declares it. The suite
 * states the arguments the contract names, whatever shape the signature takes.
 */
function run(value: Record<string, unknown>): ReturnType<typeof runScaleIngredients> {
  return runScaleIngredients(value as unknown as ScaleArgs);
}

function outputOf(value: Record<string, unknown>): ScaleOutput {
  const result = run(value);
  return (result as { structuredContent: unknown }).structuredContent as ScaleOutput;
}

function textOf(value: Record<string, unknown>): string {
  const result = run(value) as { content: { type?: string; text?: string }[] };
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function refusalOf(value: Record<string, unknown>): GoodFoodError {
  try {
    run(value);
  } catch (error) {
    return error as GoodFoodError;
  }
  throw new Error("the tool accepted arguments it had to refuse");
}

function lineOf(output: ScaleOutput, original: string): ScaledLine {
  const found = output.ingredients.find((line) => line.original === original);
  if (found === undefined) {
    throw new Error(`no rendered line carries the original ${JSON.stringify(original)}`);
  }
  return found;
}

function jsonSchema(): { additionalProperties?: unknown; properties?: Record<string, unknown> } {
  return z.toJSONSchema(scaleIngredientsArgs) as {
    additionalProperties?: unknown;
    properties?: Record<string, unknown>;
  };
}

describe("the arguments scale_ingredients declares", () => {
  it("carries the lines, the factor and the two servings, and nothing else", () => {
    expect(Object.keys(scaleIngredientsInput)).toStrictEqual([
      "ingredients",
      "factor",
      "from_servings",
      "to_servings",
    ]);
  });

  it("announces that no other property is accepted", () => {
    expect(jsonSchema().additionalProperties).toBe(false);
  });

  it("applies that refusal rather than only announcing it", () => {
    const parsed = scaleIngredientsArgs.safeParse({
      ingredients: ["200g plain flour"],
      factor: 2,
      servings: 4,
    });

    expect(parsed.success).toBe(false);
  });

  it("opens every schema refusal with the invalid_input marker", () => {
    const parsed = scaleIngredientsArgs.safeParse({ ingredients: [], factor: 0 });

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    for (const issue of parsed.error.issues) {
      expect(issue.message.startsWith("[invalid_input]")).toBe(true);
    }
  });

  it("requires the lines", () => {
    expect(scaleIngredientsArgs.safeParse({ factor: 2 }).success).toBe(false);
  });

  it("refuses an empty list of lines", () => {
    expect(scaleIngredientsArgs.safeParse({ ingredients: [], factor: 2 }).success).toBe(false);
  });

  it("accepts a hundred lines", () => {
    const ingredients = Array.from({ length: 100 }, (_, index) => `${index + 1}g flour`);

    expect(scaleIngredientsArgs.safeParse({ ingredients, factor: 2 }).success).toBe(true);
  });

  it("refuses a hundred and one lines", () => {
    const ingredients = Array.from({ length: 101 }, (_, index) => `${index + 1}g flour`);

    expect(scaleIngredientsArgs.safeParse({ ingredients, factor: 2 }).success).toBe(false);
  });

  it("accepts a line of three hundred characters", () => {
    const ingredients = ["a".repeat(300)];

    expect(scaleIngredientsArgs.safeParse({ ingredients, factor: 2 }).success).toBe(true);
  });

  it("refuses a line of three hundred and one characters", () => {
    const ingredients = ["a".repeat(301)];

    expect(scaleIngredientsArgs.safeParse({ ingredients, factor: 2 }).success).toBe(false);
  });

  it("refuses a line that carries nothing at all", () => {
    expect(scaleIngredientsArgs.safeParse({ ingredients: [""], factor: 2 }).success).toBe(false);
  });

  const badFactors: [string, unknown][] = [
    ["zero", 0],
    ["a negative number", -2],
    ["not a number", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
  ];

  for (const [wording, factor] of badFactors) {
    it(`refuses a factor that is ${wording}`, () => {
      const parsed = scaleIngredientsArgs.safeParse({ ingredients: ["3 eggs"], factor });

      expect(parsed.success).toBe(false);
    });
  }

  it("accepts a factor below one", () => {
    expect(scaleIngredientsArgs.safeParse({ ingredients: ["3 eggs"], factor: 0.5 }).success).toBe(
      true,
    );
  });

  const badServings: [string, Record<string, unknown>][] = [
    ["a starting serving of zero", { from_servings: 0, to_servings: 4 }],
    ["a target serving past a hundred", { from_servings: 4, to_servings: 101 }],
    ["a starting serving past a hundred", { from_servings: 101, to_servings: 4 }],
    ["a target serving of zero", { from_servings: 4, to_servings: 0 }],
    ["a fractional serving", { from_servings: 2.5, to_servings: 4 }],
  ];

  for (const [wording, servings] of badServings) {
    it(`refuses ${wording}`, () => {
      const parsed = scaleIngredientsArgs.safeParse({ ingredients: ["3 eggs"], ...servings });

      expect(parsed.success).toBe(false);
    });
  }

  it("accepts the pair at both ends of what it takes", () => {
    const parsed = scaleIngredientsArgs.safeParse({
      ingredients: ["3 eggs"],
      from_servings: 1,
      to_servings: 100,
    });

    expect(parsed.success).toBe(true);
  });
});

describe("choosing between a factor and a pair of servings", () => {
  it("refuses a call that names neither", () => {
    const refusal = refusalOf({ ingredients: ["200g plain flour"] });

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect(refusal.code).toBe("invalid_input");
  });

  it("refuses a call that names both", () => {
    const refusal = refusalOf({
      ingredients: ["200g plain flour"],
      factor: 2,
      from_servings: 4,
      to_servings: 6,
    });

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect(refusal.code).toBe("invalid_input");
  });

  it("refuses a call that names only where the servings start", () => {
    const refusal = refusalOf({ ingredients: ["200g plain flour"], from_servings: 4 });

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect(refusal.code).toBe("invalid_input");
  });

  it("refuses a call that names only where the servings land", () => {
    const refusal = refusalOf({ ingredients: ["200g plain flour"], to_servings: 6 });

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect(refusal.code).toBe("invalid_input");
  });

  it("reads four servings becoming six as a factor of one and a half", () => {
    const output = outputOf({
      ingredients: ["200g plain flour"],
      from_servings: 4,
      to_servings: 6,
    });

    expect(output.factor).toBeCloseTo(1.5, 6);
  });

  it("publishes the factor it was handed, when it was handed one", () => {
    const output = outputOf({ ingredients: ["200g plain flour"], factor: 2 });

    expect(output.factor).toBe(2);
  });

  it("refuses an empty list of lines with the invalid_input code", () => {
    const refusal = refusalOf({ ingredients: [], factor: 2 });

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect(refusal.code).toBe("invalid_input");
  });
});

describe("what the tool publishes", () => {
  const list: string[] = ["200g plain flour", "3 eggs", "salt and pepper"];

  it("carries exactly the fields the contract names", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    expect(Object.keys(output).sort()).toStrictEqual(
      [
        "factor",
        "ingredients",
        "notes",
        "rounded_count",
        "scaled_count",
        "source",
        "unscaled_count",
      ].sort(),
    );
  });

  it("credits the site the lines were written by", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    expect(output.source).toBe("BBC Good Food");
  });

  it("survives its own declared shape without losing a field", () => {
    const result = run({ ingredients: list, factor: 0.5 }) as { structuredContent: unknown };

    const parsed = z.object(scaleIngredientsOutputShape).parse(result.structuredContent);

    expect(parsed).toStrictEqual(result.structuredContent);
  });

  it("renders one line for each line it was handed", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    expect(output.ingredients).toHaveLength(list.length);
    expect(output.ingredients.map((line) => line.original)).toStrictEqual(list);
  });

  it("repeats every line it was handed, character for character", () => {
    const written = ["200g plain flour", "Note: 3 eggs", "salt and pepper", "1 1/2 cups milk"];

    const output = outputOf({ ingredients: written, factor: 2 });

    expect(output.ingredients.map((line) => line.original)).toStrictEqual(written);
  });

  it("hands the tool the lines its own schema settled on", () => {
    const parsed = scaleIngredientsArgs.parse({
      ingredients: ["  200g plain flour  "],
      factor: 2,
    }) as { ingredients: string[] };

    const output = outputOf({ ingredients: parsed.ingredients, factor: 2 });

    expect(output.ingredients.map((line) => line.original)).toStrictEqual(parsed.ingredients);
  });

  it("gives each line the six fields the contract names", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    for (const line of output.ingredients) {
      expect(Object.keys(line).sort()).toStrictEqual(
        ["amount", "amount_max", "original", "scaling", "text", "unit"].sort(),
      );
      expect(["scaled", "rounded", "unscaled"]).toContain(line.scaling);
    }
  });

  it("sums the three counters to the number of lines it rendered", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    expect(output.scaled_count + output.rounded_count + output.unscaled_count).toBe(
      output.ingredients.length,
    );
  });

  it("counts each of the three cases the mixed list carries", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });

    expect(output.scaled_count).toBe(1);
    expect(output.rounded_count).toBe(1);
    expect(output.unscaled_count).toBe(1);
  });

  it("keeps the counters agreeing with the lines themselves", () => {
    const output = outputOf({ ingredients: list, factor: 0.5 });
    const tally = (scaling: ScaledLine["scaling"]): number =>
      output.ingredients.filter((line) => line.scaling === scaling).length;

    expect(output.scaled_count).toBe(tally("scaled"));
    expect(output.rounded_count).toBe(tally("rounded"));
    expect(output.unscaled_count).toBe(tally("unscaled"));
  });
});

describe("the arithmetic the contract fixes", () => {
  it("doubles two hundred grams of flour, and calls it scaled", () => {
    const output = outputOf({ ingredients: ["200g plain flour"], factor: 2 });
    const line = lineOf(output, "200g plain flour");

    expect(line.amount).toBe(400);
    expect(line.scaling).toBe("scaled");
  });

  it("halves three eggs into two, and calls it rounded", () => {
    const output = outputOf({ ingredients: ["3 eggs"], factor: 0.5 });
    const line = lineOf(output, "3 eggs");

    expect(line.amount).toBe(2);
    expect(line.scaling).toBe("rounded");
  });

  it("quarters one onion, and calls it scaled", () => {
    const output = outputOf({ ingredients: ["1 onion"], factor: 0.25 });
    const line = lineOf(output, "1 onion");

    expect(line.amount).toBeCloseTo(0.25, 6);
    expect(line.scaling).toBe("scaled");
  });

  const withoutQuantity: string[] = ["salt and pepper", "a splash of oil"];

  for (const written of withoutQuantity) {
    it(`leaves "${written}" alone, with no quantity to publish`, () => {
      const output = outputOf({ ingredients: [written], factor: 3 });
      const line = lineOf(output, written);

      expect(line.scaling).toBe("unscaled");
      expect(line.amount).toBeNull();
      expect(line.amount_max).toBeNull();
      expect(line.text).toBe(written);
    });
  }
});

describe("the note every answer carries", () => {
  const lists: string[][] = [
    ["200g plain flour"],
    ["salt and pepper"],
    ["200g plain flour", "3 eggs", "salt and pepper"],
    ["a splash of oil", "1 onion"],
  ];

  for (const list of lists) {
    it(`says the quantities were worked out here, for ${JSON.stringify(list)}`, () => {
      const output = outputOf({ ingredients: list, factor: 0.5 });

      expect(
        output.notes.some(
          (note) =>
            /this server/i.test(note) &&
            /\b(not|rather than|never)\b/i.test(note) &&
            /(the site|bbc good food)/i.test(note),
        ),
      ).toBe(true);
    });

    it(`points at the scaling field on each line, for ${JSON.stringify(list)}`, () => {
      const output = outputOf({ ingredients: list, factor: 0.5 });

      expect(output.notes.some((note) => /\bscaling\b/.test(note))).toBe(true);
    });
  }

  it("repeats every published note in the text block beside the answer", () => {
    const args = { ingredients: ["200g plain flour"], factor: 2 };
    const output = outputOf(args);
    const text = textOf(args);

    expect(output.notes.length).toBeGreaterThan(0);
    for (const note of output.notes) {
      expect(text.includes(note)).toBe(true);
    }
  });
});

describe("the same question asked twice", () => {
  it("answers a factor identically", () => {
    const args = { ingredients: ["200g plain flour", "3 eggs", "salt and pepper"], factor: 0.5 };

    const first = outputOf(args);
    const second = outputOf(args);

    expect(second).toStrictEqual(first);
  });

  it("answers a pair of servings identically", () => {
    const args = { ingredients: ["200g plain flour", "1 onion"], from_servings: 4, to_servings: 6 };

    const first = outputOf(args);
    const second = outputOf(args);

    expect(second).toStrictEqual(first);
  });
});

describe("the words the tool publishes about itself", () => {
  function argumentDescriptions(): string[] {
    const properties = jsonSchema().properties ?? {};
    return Object.values(properties)
      .map((property) => (property as { description?: unknown }).description)
      .filter((description): description is string => typeof description === "string");
  }

  it("describes itself in a sentence a caller can read", () => {
    expect(typeof scaleIngredientsDescription).toBe("string");
    expect(scaleIngredientsDescription.length).toBeGreaterThan(0);
  });

  it("says the arithmetic is done here", () => {
    expect(/this server/i.test(scaleIngredientsDescription)).toBe(true);
  });

  it("names no other server by its repository", () => {
    expect(/\bmcp[-_][a-z0-9-]+/i.test(scaleIngredientsDescription)).toBe(false);
  });

  it("describes each argument it declares", () => {
    expect(argumentDescriptions()).toHaveLength(Object.keys(scaleIngredientsInput).length);
  });

  it("names no other server by its repository in an argument either", () => {
    for (const description of argumentDescriptions()) {
      expect(/\bmcp[-_][a-z0-9-]+/i.test(description)).toBe(false);
    }
  });
});

describe("the tool a server registers under the name scale_ingredients", () => {
  const refusingFetch: typeof fetch = () =>
    Promise.reject(new Error("this suite asks the site nothing"));

  type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

  async function registered(): Promise<ListedTool> {
    const server = createServer({ fetchImpl: refusingFetch });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "scaling", version: "0.0.0" });
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    const listed = await client.listTools();
    await client.close();
    await server.close();
    const tool = listed.tools.find((candidate) => candidate.name === "scale_ingredients");
    if (tool === undefined) {
      throw new Error("scale_ingredients is not registered");
    }
    return tool;
  }

  it("declares a description", async () => {
    const tool = await registered();

    expect(typeof tool.description).toBe("string");
    expect((tool.description ?? "").length).toBeGreaterThan(0);
  });

  it("publishes the same description the module states", async () => {
    const tool = await registered();

    expect(tool.description).toBe(scaleIngredientsDescription);
  });

  it("declares an output schema", async () => {
    const tool = await registered();

    expect(tool.outputSchema).toBeDefined();
  });

  it("refuses an argument it does not know", async () => {
    const tool = await registered();

    expect(tool.inputSchema.additionalProperties).toBe(false);
  });

  it("gives itself as read-only", async () => {
    const tool = await registered();

    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).not.toBe(true);
  });

  it("gives itself as a closed world, since it reads nothing", async () => {
    const tool = await registered();

    expect(tool.annotations?.openWorldHint).toBe(false);
  });
});
