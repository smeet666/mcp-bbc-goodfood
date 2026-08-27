import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { parseRecipe } from "../../src/bbcgoodfood/parse.js";
import { createLogger, loadConfig } from "../../src/config.js";
import { createServer } from "../../src/server.js";
import { runGetRecipe } from "../../src/tools/getRecipe.js";
import type { Read, Recipe } from "../../src/types.js";

/**
 * A recipe page, built from the payload alone.
 *
 * The site publishes everything a recipe page states inside one JSON island, so
 * a page is that island wrapped in the least markup a document needs.
 */
function recipePage(pageProps: unknown): string {
  const payload = JSON.stringify({ props: { pageProps } });
  return [
    "<!doctype html>",
    "<html><head><title>page</title></head><body>",
    `<script id="__NEXT_DATA__" type="application/json">${payload}</script>`,
    "</body></html>",
  ].join("");
}

const READABLE_GROUP = {
  heading: "For the base",
  ingredients: [{ ingredientText: "flour", quantityText: "200g" }],
};

const READABLE_STEP = {
  type: "step",
  content: [{ type: "html", data: { value: "<p>Mix.</p>" } }],
};

/** A recipe every field of which is stated, to vary one field at a time from. */
const STATED: Recipe = {
  id: "recipes/cake",
  title: "Cake",
  url: "https://www.bbcgoodfood.com/recipes/cake",
  premium: false,
  yield_text: "Serves 4",
  yield_count: 4,
  prep_minutes: 10,
  cook_minutes: 20,
  total_minutes: 30,
  difficulty: "Easy",
  diets: ["Vegetarian"],
  author: "Jane Cook",
  rating: 4.5,
  rating_count: 12,
  description: "Tasty",
  ingredients: [
    {
      heading: "For the base",
      ingredients: [
        {
          text: "200g flour",
          amount: 200,
          unit: "g",
          item: "flour",
          note: null,
          term: null,
        },
      ],
    },
    {
      heading: null,
      ingredients: [
        {
          text: "1 tsp salt",
          amount: null,
          unit: null,
          item: "salt",
          note: null,
          term: null,
        },
      ],
    },
  ],
  steps: ["Mix."],
  nutrition: [{ label: "kcal", value: 200, unit: "" }],
  nutrition_per: "serving",
};

/**
 * A reader that answers with what a test states, without reaching anywhere.
 *
 * The tool asks its client for one method, so a literal carrying that method is
 * all it needs; the cast states that narrowing rather than hiding it.
 */
function readerOf(data: Recipe, skipped?: string[]): GoodFoodClient {
  const reader = {
    getRecipe: async (): Promise<Read<Recipe>> =>
      skipped === undefined ? { data, cached: false } : { data, cached: false, skipped },
  };
  return reader as unknown as GoodFoodClient;
}

function renderedText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("parseRecipe on shapes the page has no business carrying", () => {
  it("reads no ingredient group from an `ingredients` that is not a list", () => {
    const shapes: unknown[] = [undefined, "1 tbsp olive oil", { heading: "A" }, null, 7];

    for (const shape of shapes) {
      const { recipe } = parseRecipe(
        recipePage({ title: "Cake", ingredients: shape }),
        "recipes/cake",
      );

      expect(recipe.ingredients).toStrictEqual([]);
    }
  });

  it("sets aside a group that is not an object and keeps its neighbours", () => {
    const { recipe, skipped } = parseRecipe(
      recipePage({
        title: "Cake",
        ingredients: [
          READABLE_GROUP,
          "For the topping",
          null,
          5,
          {
            heading: "For the icing",
            ingredients: [{ ingredientText: "sugar", quantityText: "2 tbsp" }],
          },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.ingredients.map((group) => group.heading)).toStrictEqual([
      "For the base",
      "For the icing",
    ]);
    expect(skipped).toHaveLength(3);
    for (const line of skipped) {
      expect(line).not.toBe("");
    }
  });

  it("keeps a group whose `ingredients` is not a list, with nothing in it", () => {
    const { recipe } = parseRecipe(
      recipePage({
        title: "Cake",
        ingredients: [{ heading: "For the base", ingredients: "200g flour" }],
      }),
      "recipes/cake",
    );

    expect(recipe.ingredients).toStrictEqual([{ heading: "For the base", ingredients: [] }]);
  });

  it("reads no step from a `methodSteps` that is not a list", () => {
    const shapes: unknown[] = [undefined, "Mix.", { type: "step" }, null, 3];

    for (const shape of shapes) {
      const { recipe } = parseRecipe(
        recipePage({ title: "Cake", methodSteps: shape }),
        "recipes/cake",
      );

      expect(recipe.steps).toStrictEqual([]);
    }
  });

  it("ignores a content part that is not an object, or whose `data` is not one", () => {
    const { recipe } = parseRecipe(
      recipePage({
        title: "Cake",
        methodSteps: [
          {
            type: "step",
            content: [
              "Mix.",
              4,
              null,
              { type: "html", data: "Mix." },
              { type: "html", data: { value: "<p>Mix.</p>" } },
            ],
          },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.steps).toStrictEqual(["Mix."]);
  });

  it("sets aside a step that is not an object and keeps its neighbours", () => {
    const { recipe, skipped } = parseRecipe(
      recipePage({
        title: "Cake",
        methodSteps: [
          READABLE_STEP,
          "Bake.",
          7,
          null,
          { type: "step", content: [{ type: "html", data: { value: "<p>Bake.</p>" } }] },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.steps).toStrictEqual(["Mix.", "Bake."]);
    expect(skipped).toHaveLength(3);
  });

  it("drops a nutrition entry that is not an object, or that names nothing", () => {
    const { recipe } = parseRecipe(
      recipePage({
        title: "Cake",
        nutritions: [
          "kcal",
          null,
          3,
          { value: 12, unit: "g" },
          { label: "   ", value: 12, unit: "g" },
          { label: "kcal", value: 200, unit: "" },
          { label: "fat", value: 9, unit: "g" },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.nutrition).toStrictEqual([
      { label: "kcal", value: 200, unit: "" },
      { label: "fat", value: 9, unit: "g" },
    ]);
  });

  it("states no author where `authors` gives none to read", () => {
    const shapes: unknown[] = [
      undefined,
      "Jane Cook",
      null,
      4,
      [],
      ["Jane Cook"],
      [7, { name: "Jane Cook" }],
    ];

    for (const shape of shapes) {
      const { recipe } = parseRecipe(recipePage({ title: "Cake", authors: shape }), "recipes/cake");

      expect(recipe.author).toBeNull();
    }
  });

  it("reads the diets it can and ignores the rest", () => {
    const notAList = parseRecipe(recipePage({ title: "Cake", diet: "Vegetarian" }), "recipes/cake");
    expect(notAList.recipe.diets).toStrictEqual([]);

    const mixed = parseRecipe(
      recipePage({
        title: "Cake",
        diet: [
          { slug: "vegetarian", display: "Vegetarian" },
          "gluten-free",
          null,
          3,
          { slug: "dairy-free" },
        ],
      }),
      "recipes/cake",
    );
    expect(mixed.recipe.diets).toStrictEqual(["Vegetarian"]);
  });

  it("falls back to the identifier where the page states no title", () => {
    const shapes: unknown[] = [undefined, "", "   ", 42, null];

    for (const shape of shapes) {
      const { recipe } = parseRecipe(recipePage({ title: shape }), "recipes/untitled");

      expect(recipe.title).toBe("recipes/untitled");
    }
  });

  it("keeps the wording of a yield no whole number can be read from", () => {
    const { recipe } = parseRecipe(
      recipePage({ title: "Cake", servings: "Serves a crowd" }),
      "recipes/cake",
    );

    expect(recipe.yield_text).toBe("Serves a crowd");
    expect(recipe.yield_count).toBeNull();
  });
});

describe("the entities a page writes", () => {
  it("resolves named, decimal and hexadecimal entities in a step", () => {
    const { recipe } = parseRecipe(
      recipePage({
        title: "Cake",
        methodSteps: [
          {
            type: "step",
            content: [
              {
                type: "html",
                data: { value: "<p>Salt &amp; pepper &lt;&nbsp;caf&#233; caf&#xE9;</p>" },
              },
            ],
          },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.steps).toStrictEqual(["Salt & pepper < café café"]);
  });

  it("resolves the same three forms in the description", () => {
    const { recipe } = parseRecipe(
      recipePage({ title: "Cake", description: "Salt &amp; pepper &lt;&nbsp;caf&#233; caf&#xE9;" }),
      "recipes/cake",
    );

    expect(recipe.description).toBe("Salt & pepper < café café");
  });

  it("leaves an entity nothing defines standing, rather than rendering it empty", () => {
    const { recipe } = parseRecipe(
      recipePage({
        title: "Cake",
        description: "&frobnicate; &#0; &#xZZ;",
        methodSteps: [
          {
            type: "step",
            content: [{ type: "html", data: { value: "<p>&frobnicate; &#0; &#xZZ;</p>" } }],
          },
        ],
      }),
      "recipes/cake",
    );

    expect(recipe.description).toBe("&frobnicate; &#0; &#xZZ;");
    expect(recipe.steps).toStrictEqual(["&frobnicate; &#0; &#xZZ;"]);
  });
});

describe("what runGetRecipe renders", () => {
  it("states none of the marks the recipe carries none of, and leaves no separator behind", async () => {
    const result = await runGetRecipe(
      readerOf({
        ...STATED,
        yield_text: null,
        yield_count: null,
        total_minutes: null,
        difficulty: null,
        rating: null,
        rating_count: null,
      }),
      { id: "recipes/cake" },
    );

    const text = renderedText(result);
    expect(text).toContain("Cake");
    expect(text).toContain(STATED.url);
    expect(text).not.toContain("·");
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
    for (const line of text.split("\n")) {
      expect(line).not.toMatch(/^\s*·/);
      expect(line).not.toMatch(/·\s*$/);
    }
  });

  it("renders the heading a group carries, and a plain one where it carries none", async () => {
    const result = await runGetRecipe(readerOf(STATED), { id: "recipes/cake" });

    const text = renderedText(result);
    expect(text).toContain("For the base");
    expect(text).toContain("- 200g flour");
    expect(text).toContain("Ingredients");
    expect(text).toContain("- 1 tsp salt");
  });

  it("renders no method where the recipe has no step", async () => {
    const result = await runGetRecipe(readerOf({ ...STATED, steps: [] }), {
      id: "recipes/cake",
    });

    expect(renderedText(result)).not.toContain("Method");
  });

  it("says one line was set aside, in the singular", async () => {
    const result = await runGetRecipe(readerOf(STATED, ["a step carries no words to follow"]), {
      id: "recipes/cake",
    });

    const text = renderedText(result);
    const note = text.split("\n").find((line) => line.includes("set aside")) ?? "";
    expect(note).toContain("1 line");
    expect(note).not.toMatch(/\b1 lines\b/);
    expect(note).not.toMatch(/\bwere\b/);
  });

  it("says how many lines were set aside, in the plural", async () => {
    const result = await runGetRecipe(
      readerOf(STATED, [
        "a step carries no words to follow",
        "an ingredient group arrived in a shape with no fields to read",
        "an ingredient line names nothing",
      ]),
      { id: "recipes/cake" },
    );

    const text = renderedText(result);
    const note = text.split("\n").find((line) => line.includes("set aside")) ?? "";
    expect(note).toContain("3 lines");
    expect(note).not.toMatch(/\b3 line\b/);
    expect(note).not.toMatch(/\bwas\b/);
  });
});

describe("get_recipe through the server", () => {
  async function connected(fetchImpl: typeof fetch): Promise<Client> {
    const server = createServer({ fetchImpl });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "margins", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("answers a reachable page with the recipe it publishes", async () => {
    const client = await connected(
      async () =>
        new Response(
          recipePage({
            title: "Chicken & chorizo jambalaya",
            servings: "Serves 4",
            skillLevel: "Easy",
          }),
          { status: 200, headers: { "content-type": "text/html" } },
        ),
    );

    const call = client.callTool({
      name: "get_recipe",
      arguments: { id: "recipes/chicken-chorizo-jambalaya" },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await call;

    expect(result.structuredContent).toMatchObject({
      id: "recipes/chicken-chorizo-jambalaya",
      title: "Chicken & chorizo jambalaya",
      yield_text: "Serves 4",
      yield_count: 4,
      difficulty: "Easy",
      source: "BBC Good Food",
    });

    await client.close();
  });

  it("hands back a named refusal when the read fails under it", async () => {
    const client = await connected(async () => {
      throw new TypeError("fetch failed");
    });

    const call = client.callTool({
      name: "get_recipe",
      arguments: { id: "recipes/chicken-chorizo-jambalaya" },
    });
    for (let tick = 0; tick < 20; tick += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    const result = await call;

    expect(result.isError).toBe(true);
    const text = renderedText(result as { content: { type: string; text?: string }[] });
    expect(text).toMatch(
      /^\[(invalid_input|not_found|rate_limited|parse_failure|network_error|timeout)]/,
    );

    await client.close();
  });
});

describe("a client given no transport of its own", () => {
  it("reads through the runtime's own fetch", async () => {
    const stub = vi.fn(
      async () =>
        new Response(recipePage({ title: "Cake" }), {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    vi.stubGlobal("fetch", stub);

    const client = new GoodFoodClient({
      config: loadConfig(),
      logger: createLogger("silent"),
    });
    const read = client.getRecipe("recipes/cake");
    await vi.advanceTimersByTimeAsync(10_000);

    expect((await read).data.title).toBe("Cake");
    expect(stub).toHaveBeenCalled();

    vi.unstubAllGlobals();
    expect(fetch).not.toBe(stub);
  });
});

describe("what a read carries back from a page that cost it lines", () => {
  it("names them, so a caller learns the page was not read whole", async () => {
    const degraded = recipePage({
      title: "Cake",
      ingredients: [
        {
          heading: "For the base",
          ingredients: [{ ingredientText: "flour", quantityText: "200g" }],
        },
        "For the topping",
      ],
      methodSteps: [
        { type: "step", content: [{ type: "html", data: { value: "<p>Mix.</p>" } }] },
        7,
      ],
    });
    const client = new GoodFoodClient({
      config: loadConfig(),
      logger: createLogger("silent"),
      fetchImpl: async () =>
        new Response(degraded, { status: 200, headers: { "content-type": "text/html" } }),
    });

    const pending = client.getRecipe("recipes/cake");
    await vi.advanceTimersByTimeAsync(10_000);
    const read = await pending;

    expect(read.data.title).toBe("Cake");
    expect(read.skipped).toHaveLength(2);
  });
});
