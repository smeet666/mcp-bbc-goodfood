import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createLogger, loadConfig } from "../../src/config.js";
import type { GoodFoodError } from "../../src/errors.js";
import type { Read, Recipe } from "../../src/types.js";

/**
 * The read of one recipe page, seen from the layer that talks to the site: the
 * address it asks for, what it keeps, and what it refuses to keep.
 */

const JAMBALAYA = "recipes/chicken-chorizo-jambalaya";
const PAVLOVA = "premium/brown-sugar-pavlova";
/** Long enough for the pacing gap, the timeout and any backoff to elapse. */
const LONG_ENOUGH_MS = 30_000;

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface Site {
  addresses: string[];
  stamps: number[];
  client: GoodFoodClient;
}

const config = loadConfig({
  BGF_MIN_INTERVAL_MS: "1000",
  BGF_TIMEOUT_MS: "2000",
  BGF_MAX_RETRIES: "0",
  BGF_CACHE_TTL_MS: "3600000",
  BGF_CACHE_MAX_ENTRIES: "50",
  BGF_LOG_LEVEL: "error",
});

function recipePage(pageProps: Record<string, unknown>): string {
  return [
    "<!doctype html><html><head><title>BBC Good Food</title></head><body>",
    '<script id="__NEXT_DATA__" type="application/json">',
    JSON.stringify({ props: { pageProps } }),
    "</script>",
    "</body></html>",
  ].join("");
}

function jambalayaPage(): string {
  return recipePage({
    title: "Chicken & chorizo jambalaya",
    servings: "Serves 4",
    cookAndPrepTime: {
      preparationMin: 0,
      preparationMax: 600,
      cookingMin: 0,
      cookingMax: 2700,
      total: 3300,
      note: "",
    },
    skillLevel: "Easy",
    isPremium: false,
    diet: [{ slug: "gluten-free", display: "Gluten-free" }],
    authors: [{ name: "Wren Holloway", bio: "" }],
    userRatings: { avg: 4.75, total: 3073 },
    ingredients: [
      {
        ingredients: [
          {
            metricQuantity: 1,
            metricUnit: "tbsp",
            ingredientText: "olive oil",
            quantityText: "1 tbsp",
            term: { slug: "olive-oil", display: "olive oil" },
          },
        ],
      },
    ],
    methodSteps: [
      { type: "step", content: [{ type: "html", data: { value: "<p>Heat the oil.</p>" } }] },
    ],
    nutritions: [{ label: "kcal", value: 621, unit: "" }],
  });
}

function addressOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function siteServing(reply: (address: string) => Response): Site {
  const addresses: string[] = [];
  const stamps: number[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const address = addressOf(input);
    addresses.push(address);
    stamps.push(Date.now());
    return Promise.resolve(reply(address));
  };
  const client = new GoodFoodClient({
    config,
    logger: createLogger("error"),
    fetchImpl,
  });
  return { addresses, stamps, client };
}

function pageSite(body: string, status = 200): Site {
  return siteServing(
    () => new Response(body, { status, headers: { "content-type": "text/html" } }),
  );
}

function capture<T>(pending: Promise<T>): Promise<Outcome<T>> {
  return pending.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (error: unknown): Outcome<T> => ({ ok: false, error }),
  );
}

async function settle<T>(pending: Promise<T>): Promise<Outcome<T>> {
  const captured = capture(pending);
  await vi.advanceTimersByTimeAsync(LONG_ENOUGH_MS);
  return captured;
}

async function readOf(site: Site, id: string): Promise<Read<Recipe>> {
  const outcome = await settle(site.client.getRecipe(id));
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

async function refusalOf(site: Site, id: string): Promise<GoodFoodError> {
  const outcome = await settle(site.client.getRecipe(id));
  if (outcome.ok) {
    throw new Error("the client returned a page where it had to refuse");
  }
  return outcome.error as GoodFoodError;
}

describe("the address the client asks for", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is the site followed by the path the identifier names", async () => {
    const site = pageSite(jambalayaPage());

    await readOf(site, JAMBALAYA);

    expect(site.addresses).toStrictEqual([
      "https://www.bbcgoodfood.com/recipes/chicken-chorizo-jambalaya",
    ]);
  });

  it("keeps the subscription section of a path that names one", async () => {
    const site = pageSite(jambalayaPage());

    await readOf(site, PAVLOVA);

    expect(site.addresses).toStrictEqual([
      "https://www.bbcgoodfood.com/premium/brown-sugar-pavlova",
    ]);
  });

  it("encodes a character an address cannot carry as written", async () => {
    const site = pageSite(jambalayaPage());

    await readOf(site, "recipes/crème-brûlée");

    expect(site.addresses).toStrictEqual([
      "https://www.bbcgoodfood.com/recipes/cr%C3%A8me-br%C3%BBl%C3%A9e",
    ]);
  });
});

describe("what a second read of the same page costs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("asks the site once and says the second answer was kept", async () => {
    const site = pageSite(jambalayaPage());

    const first = await readOf(site, JAMBALAYA);
    const second = await readOf(site, JAMBALAYA);

    expect(site.addresses).toHaveLength(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  it("hands back the same recipe both times", async () => {
    const site = pageSite(jambalayaPage());

    const first = await readOf(site, JAMBALAYA);
    const second = await readOf(site, JAMBALAYA);

    expect(second.data).toStrictEqual(first.data);
  });

  it("keeps two identifiers as two entries", async () => {
    const site = pageSite(jambalayaPage());

    await readOf(site, JAMBALAYA);
    await readOf(site, PAVLOVA);

    expect(site.addresses).toHaveLength(2);
  });
});

describe("what the client refuses to turn into a recipe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("calls a page the site does not serve not_found", async () => {
    const site = pageSite("<html><body>Not found</body></html>", 404);

    const refusal = await refusalOf(site, JAMBALAYA);

    expect(refusal.name).toBe("GoodFoodError");
    expect(refusal.code).toBe("not_found");
  });

  it("calls a page carrying no readable block parse_failure", async () => {
    const site = pageSite("<html><body><p>Something else entirely</p></body></html>");

    const refusal = await refusalOf(site, JAMBALAYA);

    expect(refusal.code).toBe("parse_failure");
  });

  it("keeps no memory of a page it could not read", async () => {
    const site = pageSite("<html><body><p>Something else entirely</p></body></html>");

    await refusalOf(site, JAMBALAYA);
    await refusalOf(site, JAMBALAYA);

    expect(site.addresses).toHaveLength(2);
  });

  it("calls a refusal to serve rate_limited", async () => {
    const site = pageSite("Too many requests", 429);

    const refusal = await refusalOf(site, JAMBALAYA);

    expect(refusal.code).toBe("rate_limited");
  });

  it("calls an answer that never arrives timeout", async () => {
    const addresses: string[] = [];
    const client = new GoodFoodClient({
      config,
      logger: createLogger("error"),
      fetchImpl: (input) => {
        addresses.push(typeof input === "string" ? input : String(input));
        return new Promise<Response>(() => {
          // The site is asked and never answers.
        });
      },
    });

    const outcome = await settle(client.getRecipe(JAMBALAYA));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      return;
    }
    expect((outcome.error as GoodFoodError).code).toBe("timeout");
  });
});

describe("the pace two reads keep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("leaves the configured interval between two different pages", async () => {
    const site = pageSite(jambalayaPage());

    const outcome = await settle(
      Promise.all([site.client.getRecipe(JAMBALAYA), site.client.getRecipe(PAVLOVA)]),
    );

    expect(outcome.ok).toBe(true);
    expect(site.stamps).toHaveLength(2);
    expect(site.stamps[1]! - site.stamps[0]!).toBeGreaterThanOrEqual(config.minIntervalMs);
  });
});
