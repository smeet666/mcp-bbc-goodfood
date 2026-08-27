import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";

/**
 * What a caller of scale_ingredients gets back through the transport.
 *
 * Every argument of the tool is optional on its own, so a call stating none of
 * them satisfies the schema and reaches the tool itself. The refusal is the
 * tool's, and this is where it has to survive the trip back to the caller.
 */
async function call(args: Record<string, unknown>): Promise<{
  isError?: boolean;
  content: { type: string; text?: string }[];
}> {
  const server = createServer();
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "contract", version: "0.0.0" });
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  try {
    return (await client.callTool({ name: "scale_ingredients", arguments: args })) as {
      isError?: boolean;
      content: { type: string; text?: string }[];
    };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("scale_ingredients answered through the transport", () => {
  it("returns a refusal a caller can read when neither the factor nor the pair is stated", async () => {
    const answer = await call({ ingredients: ["200g plain flour"] });

    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain("[invalid_input]");
  });

  it("returns a refusal when only one end of the servings pair is stated", async () => {
    const answer = await call({ ingredients: ["200g plain flour"], from_servings: 4 });

    expect(answer.isError).toBe(true);
    expect(answer.content[0]?.text).toContain("[invalid_input]");
  });

  it("returns the scaled list when the factor is stated", async () => {
    const answer = await call({ ingredients: ["200g plain flour"], factor: 2 });

    expect(answer.isError).toBeFalsy();
    expect(answer.content[0]?.text).toContain("400 g plain flour");
  });
});
