import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { fetchText, parseRetryAfter } from "../../src/bbcgoodfood/http.js";
import { parseFilterReport, parseRecipe, parseSearchReport } from "../../src/bbcgoodfood/parse.js";
import { searchUrl } from "../../src/bbcgoodfood/urls.js";
import { createLogger, loadConfig } from "../../src/config.js";
import { GoodFoodError } from "../../src/errors.js";
import type { Read, Recipe } from "../../src/types.js";
import { SERVED_ROW_CEILING } from "../../src/types.js";

/**
 * What the layer that reads the site owes its caller: a queue no single request
 * can freeze, a wait it only takes from a header that says something, and a
 * count of every line it had to set aside on the way.
 */

const NOW = new Date("2026-01-01T00:00:00Z");
const SITE = "https://www.bbcgoodfood.com";
const TIMEOUT_MS = 2000;
const INTERVAL_MS = 1000;
/** The six codes the package publishes, and the whole of them. */
const CODES: string[] = [
  "invalid_input",
  "not_found",
  "rate_limited",
  "parse_failure",
  "network_error",
  "timeout",
];

const config = loadConfig({
  BGF_MIN_INTERVAL_MS: String(INTERVAL_MS),
  BGF_TIMEOUT_MS: String(TIMEOUT_MS),
  BGF_MAX_RETRIES: "0",
  BGF_CACHE_TTL_MS: "3600000",
  BGF_CACHE_MAX_ENTRIES: "50",
  BGF_LOG_LEVEL: "error",
});

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface Site {
  addresses: string[];
  client: GoodFoodClient;
}

function addressOf(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** A client whose transport answers from a queue, repeating its last answer. */
function siteServing(answers: (() => Promise<Response>)[]): Site {
  const addresses: string[] = [];
  const impl = (input: string | URL | Request): Promise<Response> => {
    addresses.push(addressOf(input));
    const answer = answers[Math.min(addresses.length - 1, answers.length - 1)];
    if (answer === undefined) {
      throw new Error("no answer configured for that call");
    }
    return answer();
  };
  const client = new GoodFoodClient({
    config,
    logger: createLogger("error"),
    fetchImpl: impl as unknown as typeof fetch,
  });
  return { addresses, client };
}

function htmlAnswer(body: string, status = 200): () => Promise<Response> {
  return () =>
    Promise.resolve(new Response(body, { status, headers: { "content-type": "text/html" } }));
}

function jsonAnswer(payload: unknown): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
}

/**
 * A transport that hands back a status and then never hands back a body, the
 * way one does when it ignores the signal it was given.
 */
function stalledAnswer(): () => Promise<Response> {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      redirected: false,
      url: `${SITE}/`,
      headers: new Headers({ "content-type": "text/html" }),
      text: (): Promise<string> =>
        new Promise<string>(() => {
          // The status arrived; the body never does.
        }),
    } as unknown as Response);
}

interface Tracked<T> {
  /** Undefined for as long as the call has not settled. */
  outcome: Outcome<T> | undefined;
  followed: Promise<void>;
}

/**
 * Follows a call without waiting on it, so a test can advance the clock by a
 * span of its own and then question whether the call ended within it.
 */
function track<T>(pending: Promise<T>): Tracked<T> {
  const state: Tracked<T> = { outcome: undefined, followed: Promise.resolve() };
  state.followed = pending.then(
    (value): void => {
      state.outcome = { ok: true, value };
    },
    (error: unknown): void => {
      state.outcome = { ok: false, error };
    },
  );
  return state;
}

function codeOf(outcome: Outcome<unknown> | undefined): string | undefined {
  if (outcome === undefined || outcome.ok) {
    return undefined;
  }
  return (outcome.error as GoodFoodError).code;
}

/**
 * Walks the fake clock until `pending` settles, so nothing waits on the real
 * one and a promise that never settles fails loudly instead of hanging.
 */
async function settle<T>(pending: Promise<T>): Promise<Outcome<T>> {
  const tracked: Promise<Outcome<T>> = pending.then(
    (value): Outcome<T> => ({ ok: true, value }),
    (error: unknown): Outcome<T> => ({ ok: false, error }),
  );
  let done = false;
  const watched = tracked.then((outcome: Outcome<T>): Outcome<T> => {
    done = true;
    return outcome;
  });
  for (let step = 0; step < 400 && !done; step += 1) {
    await vi.advanceTimersByTimeAsync(100);
  }
  if (!done) {
    throw new Error("the call never settled on the fake clock");
  }
  return watched;
}

async function readOf<T>(pending: Promise<T>): Promise<T> {
  const outcome = await settle(pending);
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.value;
}

async function refusalOf(pending: Promise<unknown>): Promise<GoodFoodError> {
  const outcome = await settle(pending);
  if (outcome.ok) {
    throw new Error("the call answered where it had to refuse");
  }
  expect(outcome.error).toBeInstanceOf(GoodFoodError);
  return outcome.error as GoodFoodError;
}

/** A recipe page is the site's JSON island in the least markup a document needs. */
function pageOf(pageProps: unknown): string {
  const payload = JSON.stringify({ props: { pageProps } });
  return [
    "<!doctype html><html><head><title>page</title></head><body>",
    `<script id="__NEXT_DATA__" type="application/json">${payload}</script>`,
    "</body></html>",
  ].join("");
}

const READABLE_STEP = {
  type: "step",
  content: [{ type: "html", data: { value: "<p>Mix.</p>" } }],
};

const READABLE_GROUP = {
  heading: "For the base",
  ingredients: [{ ingredientText: "flour", quantityText: "200g" }],
};

function recipeProps(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Keldish greens",
    servings: "Serves 4",
    skillLevel: "Easy",
    isPremium: false,
    description: "<p>Green and good.</p>",
    ingredients: [READABLE_GROUP],
    methodSteps: [READABLE_STEP],
    ...extra,
  };
}

const READABLE_ROW = {
  id: "321",
  title: "Keldish greens",
  url: `${SITE}/recipes/keldish-greens`,
  isPremium: false,
  rating: { ratingValue: 4.2, ratingCount: 361 },
};

/** A search payload shaped like the site's, carrying the rows a case is about. */
function searchPayload(items: unknown[], totalItems: unknown): unknown {
  return {
    tabs: [],
    filters: [],
    searchResults: { totalItems, limit: 30, items },
  };
}

function filterPayload(filters: unknown, totalItems: unknown = 12): unknown {
  return { tabs: [], filters, searchResults: { totalItems, limit: 30, items: [] } };
}

function named(skipped: readonly string[] | undefined): string {
  return (skipped ?? []).join(" | ");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("1. a request cannot freeze the queue", () => {
  /** The deadline, the pacing gap and room to spare on top of both. */
  const WELL_PAST_THE_DEADLINE = TIMEOUT_MS + INTERVAL_MS + 5000;

  it("has not yet given up before the deadline it was given", async () => {
    const site = siteServing([stalledAnswer()]);

    const stalled = track(site.client.getRecipe("recipes/keldish-greens"));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 100);

    expect(stalled.outcome).toBeUndefined();
  });

  it("calls a body that never arrives a timeout, at the delay it was given", async () => {
    const site = siteServing([stalledAnswer()]);

    const stalled = track(site.client.getRecipe("recipes/keldish-greens"));
    await vi.advanceTimersByTimeAsync(WELL_PAST_THE_DEADLINE);

    expect(stalled.outcome?.ok).toBe(false);
    expect(codeOf(stalled.outcome)).toBe("timeout");
  });

  it("lets the call queued behind a stalled body go through", async () => {
    const site = siteServing([stalledAnswer(), htmlAnswer(pageOf(recipeProps()))]);

    const stalled = track(site.client.getRecipe("recipes/keldish-greens"));
    const behind = track(site.client.getRecipe("recipes/marran-wafers"));
    await vi.advanceTimersByTimeAsync(WELL_PAST_THE_DEADLINE * 2);

    expect(codeOf(stalled.outcome)).toBe("timeout");
    expect(behind.outcome?.ok).toBe(true);
    expect(site.addresses).toHaveLength(2);
  });

  it("counts no read as a success while its body has not been read", async () => {
    const calls = { succeeded: 0, pushBack: 0 };
    const limiter = {
      currentIntervalMs: INTERVAL_MS,
      beforeRequest: (): Promise<void> => Promise.resolve(),
      schedule: <T>(run: () => Promise<T>): Promise<T> => run(),
      succeeded: (): void => {
        calls.succeeded += 1;
      },
      pushBack: (): void => {
        calls.pushBack += 1;
      },
    };
    const noted: string[] = [];
    const note = (message: string): void => {
      noted.push(message);
    };
    const broken = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html" }),
      text: (): Promise<string> => Promise.reject(new Error("the connection died mid-body")),
    } as unknown as Response;
    const options = {
      url: `${SITE}/search`,
      userAgent: "test-agent/1.0",
      timeoutMs: TIMEOUT_MS,
      maxRetries: 0,
      limiter,
      logger: { debug: note, info: note, warn: note, error: note },
      fetchImpl: (() => Promise.resolve(broken)) as unknown as typeof fetch,
    };

    const outcome = await settle(fetchText(options as Parameters<typeof fetchText>[0]));

    expect(outcome.ok).toBe(false);
    expect(calls.succeeded).toBe(0);
  });
});

describe("2. an impossible Retry-After says nothing", () => {
  it("takes a date already gone as no usable wait at all", () => {
    const past = new Date(NOW.getTime() - 90_000).toUTCString();

    expect(parseRetryAfter(past)).toBeNull();
  });

  it("takes a negative number of seconds as no usable wait at all", () => {
    expect(parseRetryAfter("-5")).toBeNull();
  });

  it("reads no seconds out of a form that is neither digits nor a date", () => {
    expect(parseRetryAfter("0x10")).toBeNull();
    expect(parseRetryAfter("1e3")).toBeNull();
  });

  it("keeps a stated zero and a still-standing date as the waits they state", () => {
    expect(parseRetryAfter("0")).toBe(0);
    expect(parseRetryAfter(new Date(NOW.getTime() + 60_000).toUTCString())).toBe(60_000);
  });
});

describe("3. the lines set aside reach the caller", () => {
  it("names in listFilters the option and the group it could not read", async () => {
    const site = siteServing([
      jsonAnswer(
        filterPayload([
          {
            label: "Diets",
            name: "diet",
            options: [
              { value: "nut-free", label: "Nut-free", count: 12 },
              { label: "Unnameable", count: 4 },
            ],
          },
          { label: "Difficulty", options: [{ value: "easy", label: "Easy", count: 3 }] },
          "not a group at all",
        ]),
      ),
    ]);

    const read = await readOf(site.client.listFilters("chicken"));

    expect(read.skipped).toBeDefined();
    expect(named(read.skipped)).toContain("Unnameable");
    expect(named(read.skipped)).toContain("Difficulty");
  });

  it("leaves listFilters silent when it had nothing to set aside", async () => {
    const site = siteServing([
      jsonAnswer(
        filterPayload([
          { label: "Diets", name: "diet", options: [{ value: "nut-free", label: "Nut-free" }] },
        ]),
      ),
    ]);

    const read = await readOf(site.client.listFilters("chicken"));

    expect(read.skipped ?? []).toEqual([]);
  });

  it("names in searchRecipes each row it could not read", async () => {
    const site = siteServing([
      jsonAnswer(
        searchPayload(
          [
            READABLE_ROW,
            { id: "322", title: "No address at all", isPremium: false },
            { id: "323", url: `${SITE}/recipes/no-title` },
            "not a row at all",
          ],
          4,
        ),
      ),
    ]);

    const read = await readOf(site.client.searchRecipes("keldish"));

    expect(read.data.result_count).toBe(1);
    expect(read.skipped).toBeDefined();
    expect(read.skipped ?? []).toHaveLength(3);
    expect(named(read.skipped)).toContain("No address at all");
    expect(named(read.skipped)).toContain("323");
  });

  it("keeps naming in getRecipe the group it could not read", async () => {
    const site = siteServing([
      htmlAnswer(pageOf(recipeProps({ ingredients: [READABLE_GROUP, "For the topping"] }))),
    ]);

    const read = await readOf(site.client.getRecipe("recipes/keldish-greens"));

    expect(read.skipped).toBeDefined();
    expect(read.skipped ?? []).not.toHaveLength(0);
  });
});

describe("4. a set-aside line always names a cause", () => {
  async function skippedRows(items: unknown[]): Promise<string[]> {
    const site = siteServing([jsonAnswer(searchPayload(items, items.length))]);
    const read: Read<unknown> = await readOf(site.client.searchRecipes("keldish"));
    expect(read.skipped).toBeDefined();
    return read.skipped ?? [];
  }

  it("ends no sentence on a colon for a row carrying a title and a relative address", async () => {
    const skipped = await skippedRows([
      READABLE_ROW,
      { id: "42", title: "Relative address", url: "/recipes/relative" },
    ]);

    expect(skipped).toHaveLength(1);
    for (const sentence of skipped) {
      expect(sentence).not.toMatch(/:\s*$/);
    }
  });

  it("says of that row that its address names no page on the site", async () => {
    const skipped = await skippedRows([
      READABLE_ROW,
      { id: "42", title: "Relative address", url: "/recipes/relative" },
    ]);

    expect(skipped.join(" | ")).toMatch(/address/i);
  });

  it("names the cause for the missing title, the missing address and the unusable one", async () => {
    const skipped = await skippedRows([
      { id: "43", url: `${SITE}/recipes/no-title` },
      { id: "44", title: "No address at all" },
      { id: "45", title: "Relative address", url: "/recipes/relative" },
    ]);

    expect(skipped).toHaveLength(3);
    for (const sentence of skipped) {
      expect(sentence).not.toMatch(/:\s*$/);
      expect(sentence.split(":").at(-1)?.trim() ?? "").not.toBe("");
    }
  });
});

describe("5. a numeric entity out of range does not bring the read down", () => {
  const OUT_OF_RANGE = "&#1114112;";
  const HALF_A_PAIR = "&#xD800;";

  function pageCarryingBoth(): string {
    return pageOf(
      recipeProps({
        description: `<p>Green ${OUT_OF_RANGE} and good ${HALF_A_PAIR}.</p>`,
        methodSteps: [
          {
            type: "step",
            content: [
              {
                type: "html",
                data: { value: `<p>Mix ${OUT_OF_RANGE} then rest ${HALF_A_PAIR}.</p>` },
              },
            ],
          },
        ],
      }),
    );
  }

  it("reads the page rather than throwing", () => {
    expect(() => parseRecipe(pageCarryingBoth(), "recipes/keldish-greens")).not.toThrow();
  });

  it("leaves both graphies in the text as they were written", () => {
    const { recipe } = parseRecipe(pageCarryingBoth(), "recipes/keldish-greens");

    expect(recipe.description ?? "").toContain(OUT_OF_RANGE);
    expect(recipe.description ?? "").toContain(HALF_A_PAIR);
    expect(recipe.steps.join(" ")).toContain(OUT_OF_RANGE);
  });

  it("does not send the caller back to the site over a page it can read", async () => {
    const site = siteServing([htmlAnswer(pageCarryingBoth())]);

    const outcome = await settle(site.client.getRecipe("recipes/keldish-greens"));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      expect((outcome.error as GoodFoodError).code).not.toBe("network_error");
    }
  });
});

describe("6. a recipe with no ingredients is a claim, not a silence", () => {
  const unusable: { name: string; shape: unknown }[] = [
    { name: "an object", shape: { heading: "For the base" } },
    { name: "a string", shape: "200g flour" },
    { name: "null", shape: null },
  ];

  for (const { name, shape } of unusable) {
    it(`says so when the ingredients of a free recipe arrive as ${name}`, () => {
      const { recipe, skipped } = parseRecipe(
        pageOf(recipeProps({ ingredients: shape })),
        "recipes/keldish-greens",
      );

      expect(recipe.premium).toBe(false);
      expect(recipe.ingredients).toStrictEqual([]);
      expect(skipped.join(" | ")).toMatch(/ingredient/i);
    });
  }

  it("says so when the steps of a free recipe arrive in no readable shape", () => {
    const { recipe, skipped } = parseRecipe(
      pageOf(recipeProps({ methodSteps: { first: "Mix." } })),
      "recipes/keldish-greens",
    );

    expect(recipe.steps).toStrictEqual([]);
    expect(skipped.join(" | ")).toMatch(/step/i);
  });

  it("stays silent about a recipe the subscription empties on purpose", () => {
    const { recipe, skipped } = parseRecipe(
      pageOf(recipeProps({ isPremium: true })),
      "premium/keldish-greens",
    );

    expect(recipe.premium).toBe(true);
    expect(recipe.ingredients).toStrictEqual([]);
    expect(skipped.join(" | ")).not.toMatch(/ingredient/i);
  });
});

describe("7. a warning survives the second read", () => {
  it("hands the cached read the same set-aside lines as the first", async () => {
    const site = siteServing([
      htmlAnswer(pageOf(recipeProps({ ingredients: [READABLE_GROUP, "For the topping"] }))),
    ]);

    const first: Read<Recipe> = await readOf(site.client.getRecipe("recipes/keldish-greens"));
    const second: Read<Recipe> = await readOf(site.client.getRecipe("recipes/keldish-greens"));

    expect(site.addresses).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(first.skipped ?? []).not.toHaveLength(0);
    expect(second.skipped).toStrictEqual(first.skipped);
  });
});

describe("8. a restriction the address ignores is refused", () => {
  it("refuses a facet whose name searchUrl does not know, naming it", () => {
    let refusal: unknown;
    try {
      searchUrl({ search: "cake", facets: { not_a_facet: "x" } });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(GoodFoodError);
    expect((refusal as GoodFoodError).code).toBe("invalid_input");
    expect((refusal as GoodFoodError).message).toContain("not_a_facet");
  });

  it("builds the address as before for the facets it does know", () => {
    const known = new URL(searchUrl({ search: "cake", facets: { diet: "nut-free" } }));

    expect(known.searchParams.get("diet")).toBe("nut-free");
  });

  it("refuses the same facet through the client, without asking the site", async () => {
    const site = siteServing([jsonAnswer(searchPayload([READABLE_ROW], 1))]);

    const refusal = await refusalOf(
      site.client.searchRecipes("keldish", { facets: { not_a_facet: "x" } }),
    );

    expect(refusal.code).toBe("invalid_input");
    expect(refusal.message).toContain("not_a_facet");
    expect(site.addresses).toHaveLength(0);
  });
});

describe("9. what does not change", () => {
  it("renders a count the site published none of as null and never as zero", () => {
    const report = parseSearchReport(searchPayload([READABLE_ROW], undefined), "keldish").report;

    expect(report.total_available).toBeNull();
    expect(report.total_available).not.toBe(0);
  });

  it("marks a total sitting on the served-row ceiling as a floor", () => {
    const search = parseSearchReport(
      searchPayload([READABLE_ROW], SERVED_ROW_CEILING),
      "keldish",
    ).report;
    const filters = parseFilterReport(filterPayload([], SERVED_ROW_CEILING), null).report;

    expect(search.total_is_ceiling).toBe(true);
    expect(filters.total_available).toBe(SERVED_ROW_CEILING);
    expect(filters.total_is_ceiling).toBe(true);
  });

  it("keeps the mark and the number of voters as two fields", () => {
    const report = parseSearchReport(searchPayload([READABLE_ROW], 1), "keldish").report;

    expect(report.results[0]?.rating).toBe(4.2);
    expect(report.results[0]?.rating_count).toBe(361);
  });

  it("lets no address out of the site, whatever the identifier carries", async () => {
    const site = siteServing([htmlAnswer(pageOf(recipeProps()))]);

    await settle(site.client.getRecipe("recipes/crème-brûlée"));
    await settle(site.client.getRecipe("../../evil.example.invalid/steal"));

    expect(site.addresses.length).toBeGreaterThan(0);
    for (const address of site.addresses) {
      expect(new URL(address).origin).toBe(SITE);
      expect(address).not.toContain("crème");
    }
  });

  it("refuses with one of the six codes and no seventh", async () => {
    const notFound = siteServing([htmlAnswer("<html><body>Gone</body></html>", 404)]);
    const unreadable = siteServing([htmlAnswer("<html><body><p>Something else</p></body></html>")]);
    const busy = siteServing([htmlAnswer("Too many requests", 429)]);

    const codes = [
      (await refusalOf(notFound.client.getRecipe("recipes/keldish-greens"))).code,
      (await refusalOf(unreadable.client.getRecipe("recipes/keldish-greens"))).code,
      (await refusalOf(busy.client.getRecipe("recipes/keldish-greens"))).code,
    ];

    expect(codes).toStrictEqual(["not_found", "parse_failure", "rate_limited"]);
    for (const code of codes) {
      expect(CODES).toContain(code);
    }
  });
});
