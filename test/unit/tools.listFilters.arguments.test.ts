import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GoodFoodClient } from "../../src/bbcgoodfood/client.js";
import { createServer } from "../../src/server.js";
import {
  listFiltersInput,
  listFiltersOutputShape,
  runListFilters,
} from "../../src/tools/listFilters.js";
import type { FilterReport, Read } from "../../src/types.js";

const EPOCH = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(EPOCH);
});

afterEach(() => {
  vi.useRealTimers();
});

const inputSchema = (): z.ZodObject => z.object(listFiltersInput);
const outputSchema = (): z.ZodObject => z.object(listFiltersOutputShape);

/**
 * The tool's argument object, handed over as the tool declares it. The suite
 * states the arguments the contract names, whatever shape the signature takes.
 */
function args(value: Record<string, unknown>): Parameters<typeof runListFilters>[1] {
  return value as unknown as Parameters<typeof runListFilters>[1];
}

/** A stand-in client: no site is reached from a unit test. */
function fakeClient(): GoodFoodClient {
  return {
    listFilters: async (query?: string | null): Promise<Read<FilterReport>> => {
      const filters = [
        {
          name: "diet",
          label: "Diets",
          options: [
            { value: "egg-free", label: "Egg-free", count: 101 },
            { value: "vegetarian", label: "Vegetarian", count: null },
          ],
          option_count: 2,
        },
      ];
      return {
        data: {
          query: query ?? null,
          filters,
          filter_count: filters.length,
          total_available: 151,
          total_is_ceiling: false,
        },
        cached: false,
      };
    },
  } as unknown as GoodFoodClient;
}

/** A fetch that fails the test if the server ever reaches for the network. */
function forbiddenFetch(): typeof fetch {
  return (async () => {
    throw new Error("the unit suite makes no network request");
  }) as unknown as typeof fetch;
}

async function connect(): Promise<Client> {
  const server = createServer({ fetchImpl: forbiddenFetch() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "list-filters-argument-test", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("listFiltersInput", () => {
  it("declares query optional", () => {
    const parsed = inputSchema().safeParse({});
    expect(parsed.success).toBe(true);
    expect(Object.keys(listFiltersInput)).toContain("query");
  });

  it("accepts a query of 1 to 80 characters once trimmed", () => {
    const accepted = (raw: string): unknown => {
      const parsed = inputSchema().safeParse({ query: raw });
      expect(parsed.success, `the schema refuses ${JSON.stringify(raw)}`).toBe(true);
      return (parsed.data as Record<string, unknown> | undefined)?.["query"];
    };

    expect(accepted("a")).toBe("a");
    expect(accepted("x".repeat(80))).toBe("x".repeat(80));
    // The bound is read on the trimmed text, so padding leaves it inside.
    expect(accepted(`   ${"x".repeat(80)}   `)).toBe("x".repeat(80));
  });

  it("refuses a query that is empty or longer than 80 characters once trimmed", () => {
    expect(inputSchema().safeParse({ query: "" }).success).toBe(false);
    expect(inputSchema().safeParse({ query: "x".repeat(81) }).success).toBe(false);
    expect(inputSchema().safeParse({ query: `  ${"x".repeat(81)}  ` }).success).toBe(false);
  });

  it("refuses a query of spaces alone, and opens the refusal with [invalid_input]", () => {
    const parsed = inputSchema().safeParse({ query: "   " });
    expect(parsed.success).toBe(false);
    const messages = parsed.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.startsWith("[invalid_input]"))).toBe(true);
  });
});

describe("the refusal of an unknown argument", () => {
  it("announces additionalProperties: false in the schema the protocol publishes", async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find((entry) => entry.name === "list_filters");

    expect(tool).toBeDefined();
    const schema = tool?.inputSchema as Record<string, unknown> | undefined;
    expect(schema?.["additionalProperties"]).toBe(false);
  });

  it("applies it: a call carrying an unknown argument is refused by [invalid_input]", async () => {
    const client = await connect();

    let message = "";
    try {
      const result = await client.callTool({
        name: "list_filters",
        arguments: { query: "chicken", scope: "sitewide" },
      });
      expect(result.isError).toBe(true);
      message = JSON.stringify(result.content);
      expect(message).toContain("[invalid_input]");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("[invalid_input]");
    }
    expect(message).not.toBe("");
  });

  it("applies it through the tool code as well", async () => {
    await expect(runListFilters(fakeClient(), args({ scope: "sitewide" }))).rejects.toThrow(
      /^\[invalid_input]/,
    );
  });
});

describe("the refusal written by the tool code", () => {
  it("refuses a query of spaces alone with [invalid_input]", async () => {
    await expect(runListFilters(fakeClient(), args({ query: "   " }))).rejects.toThrow(
      /^\[invalid_input]/,
    );
  });

  it("refuses an over-long query with [invalid_input]", async () => {
    await expect(runListFilters(fakeClient(), args({ query: "x".repeat(81) }))).rejects.toThrow(
      /^\[invalid_input]/,
    );
  });
});

describe("listFiltersOutputShape", () => {
  it("describes the output runListFilters actually produces", async () => {
    const out = await runListFilters(fakeClient(), args({ query: "chicken" }));
    const parsed = outputSchema().safeParse(out.structuredContent);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(out.structuredContent);
  });

  it("describes the output produced with no query too", async () => {
    const out = await runListFilters(fakeClient(), args({}));
    const parsed = outputSchema().safeParse(out.structuredContent);

    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown> | undefined)?.["query"]).toBeNull();
  });
});

describe("createServer", () => {
  it("registers list_filters with an output schema", async () => {
    const client = await connect();
    const tool = (await client.listTools()).tools.find((entry) => entry.name === "list_filters");

    expect(tool).toBeDefined();
    expect(tool?.outputSchema).toBeDefined();
    expect((tool?.outputSchema as Record<string, unknown> | undefined)?.["type"]).toBe("object");
    expect(typeof tool?.description).toBe("string");
    expect(tool?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it("registers its tools in a deterministic order", async () => {
    const first = (await (await connect()).listTools()).tools.map((entry) => entry.name);
    const second = (await (await connect()).listTools()).tools.map((entry) => entry.name);

    expect(first).toEqual(second);
    expect(first).toContain("list_filters");
  });
});
