import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { runListFilters } from "../../src/tools/listFilters.js";
import type { FilterGroup, FilterReport, Read } from "../../src/types.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/** The tool's argument object, handed over as the tool declares it. */
function args(value: Record<string, unknown>): Parameters<typeof runListFilters>[1] {
  return value as unknown as Parameters<typeof runListFilters>[1];
}

function reportOf(filters: FilterGroup[], totalAvailable: number | null): FilterReport {
  return {
    query: "chicken",
    filters,
    filter_count: filters.length,
    total_available: totalAvailable,
    total_is_ceiling: totalAvailable === 10_000,
  };
}

/** A stand-in client: no site is reached from a unit test. */
function fakeClient(report: FilterReport): GoodFoodClient {
  return {
    listFilters: async (): Promise<Read<FilterReport>> => ({ data: report, cached: false }),
  } as unknown as GoodFoodClient;
}

/** The concatenated text of every `content` part, each of which must be text. */
function textOf(content: unknown[]): string {
  expect(content.length).toBeGreaterThan(0);
  return content
    .map((part) => {
      const record = part as Record<string, unknown>;
      expect(record["type"]).toBe("text");
      expect(typeof record["text"]).toBe("string");
      return record["text"] as string;
    })
    .join("\n");
}

async function textFor(report: FilterReport): Promise<string> {
  const out = await runListFilters(fakeClient(report), args({ query: "chicken" }));
  return textOf(out.content);
}

/** Every occurrence of a token in a text. */
function occurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

const SAYS_NONE = /\b(none|no values?|no options?|not listed|nothing|empty)\b/i;

describe("runListFilters — how a group heads its block", () => {
  it("states a group whose label repeats its name only once", async () => {
    const text = await textFor(
      reportOf(
        [
          {
            name: "spice",
            label: "spice",
            options: [{ value: "mild", label: "Mild", count: 3 }],
            option_count: 1,
          },
        ],
        151,
      ),
    );

    expect(text).toContain("spice");
    // "spice (spice)" spends a line on nothing: the second reading adds no name
    // the caller did not already have.
    expect(occurrences(text, "spice")).toBe(1);
  });

  it("states both the label and the name when they differ", async () => {
    const text = await textFor(
      reportOf(
        [
          {
            name: "mealType",
            label: "Meal type",
            options: [{ value: "supper", label: "Supper", count: 3 }],
            option_count: 1,
          },
        ],
        151,
      ),
    );

    expect(text).toContain("Meal type");
    expect(text).toContain("mealType");
  });
});

describe("runListFilters — what it writes where the site published nothing", () => {
  it("states that a group carries no listed value rather than heading an empty block", async () => {
    const text = await textFor(
      reportOf([{ name: "cuisine", label: "Cuisine", options: [], option_count: 0 }], 151),
    );

    expect(text).toContain("cuisine");
    const line = text.split("\n").find((candidate) => candidate.includes("cuisine")) ?? "";
    expect(line, `the block says nothing about the empty group: ${JSON.stringify(text)}`).toMatch(
      SAYS_NONE,
    );
  });

  it("states an option whose count is absent without a figure beside it", async () => {
    const text = await textFor(
      reportOf(
        [
          {
            name: "diet",
            label: "Diets",
            options: [{ value: "vegetarian", label: "Vegetarian", count: null }],
            option_count: 1,
          },
        ],
        151,
      ),
    );

    expect(text).toContain("vegetarian");
    // A count nobody published must not come back as a figure on a scale that
    // starts at zero.
    expect(text).not.toMatch(/vegetarian\D{0,4}\d/);
  });

  it("invents no figure for a scope whose total is unreadable", async () => {
    const out = await runListFilters(
      fakeClient(
        reportOf(
          [
            {
              name: "diet",
              label: "Diets",
              options: [{ value: "vegetarian", label: "Vegetarian", count: null }],
              option_count: 1,
            },
          ],
          null,
        ),
      ),
      args({ query: "chicken" }),
    );
    const text = textOf(out.content);
    const structured = out.structuredContent as Record<string, unknown>;

    expect(structured["total_available"]).toBeNull();
    // A total nobody published is neither zero nor the service ceiling: the
    // block states no figure the caller cannot find again in the structure.
    expect(text).not.toMatch(/\d{3,}/);
    expect(text).not.toMatch(/\b0\b/);
  });
});
