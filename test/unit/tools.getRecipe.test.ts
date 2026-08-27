import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createServer } from "../../src/server.js";
import {
  type GetRecipeArgs,
  getRecipeArgs,
  getRecipeInput,
  getRecipeOutputShape,
  runGetRecipe,
} from "../../src/tools/getRecipe.js";
import type { Read, Recipe } from "../../src/types.js";

/** The output the tool publishes: the recipe, who it came from, and its notes. */
interface RecipeOutput extends Recipe {
  source: string;
  notes: string[];
}

interface FakeClient {
  calls: string[];
  client: GoodFoodClient;
}

function plainRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipes/chicken-chorizo-jambalaya",
    title: "Chicken & chorizo jambalaya",
    url: "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    premium: false,
    yield_text: "Serves 4",
    yield_count: 4,
    prep_minutes: 10,
    cook_minutes: 45,
    total_minutes: 55,
    difficulty: "Easy",
    diets: ["Gluten-free"],
    author: "Wren Holloway",
    rating: 4.75,
    rating_count: 3073,
    description: "A one-pan rice dish.",
    ingredients: [
      {
        heading: null,
        ingredients: [
          {
            text: "1 tbsp olive oil",
            amount: 1,
            unit: "tbsp",
            item: "olive oil",
            note: null,
            term: "olive oil",
          },
          {
            text: "1 red pepper, thinly sliced",
            amount: 1,
            unit: null,
            item: "red pepper",
            note: "thinly sliced",
            term: "red pepper",
          },
        ],
      },
    ],
    steps: ["Heat the oil in a large frying pan.", "Stir in the rice and simmer."],
    nutrition: [
      { label: "kcal", value: 621, unit: "" },
      { label: "saturates", value: 5, unit: "g" },
    ],
    nutrition_per: "serving",
    ...overrides,
  };
}

function premiumRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return plainRecipe({
    id: "premium/brown-sugar-pavlova",
    title: "Brown sugar pavlova",
    url: "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
    premium: true,
    ingredients: [],
    steps: [],
    ...overrides,
  });
}

function fakeClient(recipe: Recipe, cached = false): FakeClient {
  const calls: string[] = [];
  const read: Read<Recipe> = { data: recipe, cached };
  const stand = {
    getRecipe(id: string): Promise<Read<Recipe>> {
      calls.push(id);
      return Promise.resolve(read);
    },
  };
  return { calls, client: stand as unknown as GoodFoodClient };
}

async function outputOf(client: GoodFoodClient, id: string): Promise<RecipeOutput> {
  const result = await runGetRecipe(client, { id });
  return result.structuredContent as unknown as RecipeOutput;
}

async function textOf(client: GoodFoodClient, id: string): Promise<string> {
  const result = await runGetRecipe(client, { id });
  const blocks = result.content as { type?: string; text?: string }[];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

async function refusalOf(client: GoodFoodClient, args: unknown): Promise<Error> {
  try {
    await runGetRecipe(client, args as GetRecipeArgs);
  } catch (error) {
    return error as Error;
  }
  throw new Error("the tool accepted arguments it had to refuse");
}

describe("the arguments get_recipe declares", () => {
  it("carries the identifier and the servings, and nothing else", () => {
    expect(Object.keys(getRecipeInput)).toStrictEqual(["id", "servings"]);
  });

  it("requires the identifier", () => {
    const parsed = getRecipeArgs.safeParse({});

    expect(parsed.success).toBe(false);
  });

  it("opens every schema refusal with the invalid_input marker", () => {
    const parsed = getRecipeArgs.safeParse({});

    expect(parsed.success).toBe(false);
    if (parsed.success) {
      return;
    }
    for (const issue of parsed.error.issues) {
      expect(issue.message.startsWith("[invalid_input]")).toBe(true);
    }
  });

  it("accepts an identifier of two hundred characters once trimmed", () => {
    const id = `recipes/${"a".repeat(192)}`;

    expect(getRecipeArgs.safeParse({ id: `  ${id}  ` }).success).toBe(true);
  });

  it("refuses an identifier past two hundred characters", () => {
    const id = `recipes/${"a".repeat(193)}`;

    expect(getRecipeArgs.safeParse({ id }).success).toBe(false);
  });

  it("refuses an identifier that trims away to nothing", () => {
    expect(getRecipeArgs.safeParse({ id: "   " }).success).toBe(false);
  });

  it("announces that no other property is accepted", () => {
    const schema = z.toJSONSchema(getRecipeArgs) as {
      additionalProperties?: unknown;
      required?: string[];
    };

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toStrictEqual(["id"]);
  });

  it("applies that refusal rather than only announcing it", () => {
    const parsed = getRecipeArgs.safeParse({
      id: "recipes/chicken-chorizo-jambalaya",
      portions: 4,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("an identifier that could designate something other than a recipe page", () => {
  const refused: string[] = [
    "",
    "   ",
    "/recipes/chicken-chorizo-jambalaya",
    "http://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    "file:///etc/passwd",
    "//example.invalid/recipes/chicken-chorizo-jambalaya",
    "../secrets",
    "recipes/../../etc/passwd",
  ];

  for (const id of refused) {
    it(`is refused, and asks the site nothing: ${JSON.stringify(id)}`, async () => {
      const fake = fakeClient(plainRecipe());

      const refusal = await refusalOf(fake.client, { id });

      expect(refusal.message.startsWith("[invalid_input]")).toBe(true);
      expect(fake.calls).toStrictEqual([]);
    });
  }
});

describe("an identifier the tool honours", () => {
  it("reaches the client as it was written, for a plain recipe", async () => {
    const fake = fakeClient(plainRecipe());

    await runGetRecipe(fake.client, { id: "recipes/chicken-chorizo-jambalaya" });

    expect(fake.calls).toStrictEqual(["recipes/chicken-chorizo-jambalaya"]);
  });

  it("reaches the client as it was written, for a subscription recipe", async () => {
    const fake = fakeClient(premiumRecipe());

    await runGetRecipe(fake.client, { id: "premium/brown-sugar-pavlova" });

    expect(fake.calls).toStrictEqual(["premium/brown-sugar-pavlova"]);
  });

  it("reaches the client trimmed", async () => {
    const fake = fakeClient(plainRecipe());

    await runGetRecipe(fake.client, { id: "  recipes/chicken-chorizo-jambalaya  " });

    expect(fake.calls).toStrictEqual(["recipes/chicken-chorizo-jambalaya"]);
  });
});

describe("what the tool publishes", () => {
  it("credits the site it read", async () => {
    const fake = fakeClient(plainRecipe());

    const output = await outputOf(fake.client, "recipes/chicken-chorizo-jambalaya");

    expect(output.source).toBe("BBC Good Food");
  });

  it("repeats the recipe the client handed it", async () => {
    const recipe = plainRecipe();
    const fake = fakeClient(recipe);

    const output = await outputOf(fake.client, recipe.id);

    expect(output.id).toBe(recipe.id);
    expect(output.title).toBe(recipe.title);
    expect(output.url).toBe(recipe.url);
    expect(output.ingredients).toStrictEqual(recipe.ingredients);
    expect(output.steps).toStrictEqual(recipe.steps);
    expect(output.nutrition).toStrictEqual(recipe.nutrition);
  });

  it("carries notes as a list, even when it has none to make", async () => {
    const fake = fakeClient(plainRecipe());

    const output = await outputOf(fake.client, "recipes/chicken-chorizo-jambalaya");

    expect(Array.isArray(output.notes)).toBe(true);
  });

  it("survives its own declared shape without losing a field", async () => {
    const fake = fakeClient(plainRecipe());
    const result = await runGetRecipe(fake.client, { id: "recipes/chicken-chorizo-jambalaya" });

    const parsed = z.object(getRecipeOutputShape).parse(result.structuredContent);

    expect(parsed).toStrictEqual(result.structuredContent);
  });

  it("survives its own declared shape for a subscription recipe too", async () => {
    const fake = fakeClient(premiumRecipe());
    const result = await runGetRecipe(fake.client, { id: "premium/brown-sugar-pavlova" });

    const parsed = z.object(getRecipeOutputShape).parse(result.structuredContent);

    expect(parsed).toStrictEqual(result.structuredContent);
  });
});

describe("the note a subscription recipe carries", () => {
  it("says the subscription is what stands in the way", async () => {
    const fake = fakeClient(premiumRecipe());

    const output = await outputOf(fake.client, "premium/brown-sugar-pavlova");

    expect(output.notes.some((note) => /subscri/i.test(note))).toBe(true);
  });

  it("points at the page as the place a subscriber reads it", async () => {
    const fake = fakeClient(premiumRecipe());

    const output = await outputOf(fake.client, "premium/brown-sugar-pavlova");
    const spoken = output.notes.filter((note) => /subscri/i.test(note));

    expect(spoken.some((note) => /\bpage\b|bbcgoodfood\.com/i.test(note))).toBe(true);
  });

  it("never claims the recipe has no ingredients or steps", async () => {
    const fake = fakeClient(premiumRecipe());

    const output = await outputOf(fake.client, "premium/brown-sugar-pavlova");

    for (const note of output.notes) {
      expect(
        /\b(no|without|lacks?|lacking|missing)\s+(ingredients|steps|method)\b/i.test(note),
      ).toBe(false);
    }
  });

  it("stays away from a recipe the site serves to everyone", async () => {
    const fake = fakeClient(plainRecipe());

    const output = await outputOf(fake.client, "recipes/chicken-chorizo-jambalaya");

    expect(output.notes.some((note) => /subscri/i.test(note))).toBe(false);
  });
});

describe("the text block beside the structured answer", () => {
  it("repeats every published note word for word", async () => {
    const fake = fakeClient(premiumRecipe());
    const output = await outputOf(fake.client, "premium/brown-sugar-pavlova");
    const text = await textOf(fake.client, "premium/brown-sugar-pavlova");

    expect(output.notes.length > 0).toBe(true);
    for (const note of output.notes) {
      expect(text.includes(note)).toBe(true);
    }
  });

  it("keeps a site label that mimics a server line from passing for one", async () => {
    const recipe = plainRecipe({
      title: "Note: chill overnight",
      description: "Source: a magazine that is not this site",
    });
    const fake = fakeClient(recipe);
    const output = await outputOf(fake.client, recipe.id);
    const text = await textOf(fake.client, recipe.id);

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("Note:")) {
        expect(output.notes).toContain(trimmed.slice("Note:".length).trim());
      }
      if (trimmed.startsWith("Source:")) {
        expect(trimmed.slice("Source:".length).trim()).toBe("BBC Good Food");
      }
    }
  });

  it("still shows the label the site wrote", async () => {
    const recipe = plainRecipe({ title: "Note: chill overnight" });
    const fake = fakeClient(recipe);

    const text = await textOf(fake.client, recipe.id);

    expect(text.includes("chill overnight")).toBe(true);
  });
});

describe("the tools a server registers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const refusingFetch: typeof fetch = () =>
    Promise.reject(new Error("this suite asks the site nothing"));

  async function registeredTools(): Promise<{ name: string; outputSchema?: unknown }[]> {
    const server = createServer({ fetchImpl: refusingFetch });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "contract", version: "0.0.0" });
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
    const listed = await client.listTools();
    await client.close();
    await server.close();
    return listed.tools;
  }

  it("registers the tools in the order a caller walks them", async () => {
    const tools = await registeredTools();

    expect(tools.map((tool) => tool.name)).toStrictEqual([
      "list_filters",
      "search_recipes",
      "get_recipe",
      "scale_ingredients",
    ]);
  });

  it("declares an output shape for each of them", async () => {
    const tools = await registeredTools();

    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("lists them in the same order from one server to the next", async () => {
    const first = await registeredTools();
    const second = await registeredTools();

    expect(second.map((tool) => tool.name)).toStrictEqual(first.map((tool) => tool.name));
  });
});
