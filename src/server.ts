/**
 * MCP server wiring.
 *
 * One client, one rate limiter and one store are shared by every tool, so
 * pacing applies to the server as a whole rather than per tool. Tools are
 * registered in a fixed order, which is what lets a client cache the listing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GoodFoodClient } from "./bbcgoodfood/client.js";
import type { Config, Logger } from "./config.js";
import { createLogger, loadConfig } from "./config.js";
import {
  listFiltersArgs,
  listFiltersDescription,
  listFiltersOutputShape,
  runListFilters,
} from "./tools/listFilters.js";
import type { ListFiltersArgs } from "./tools/listFilters.js";
import { toToolError } from "./tools/shared.js";
import { PKG_VERSION } from "./version.js";

export interface CreateServerOptions {
  config?: Config;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/** This server only reads, so every tool is read-only. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const INSTRUCTIONS = [
  "Tools for reading recipes on BBC Good Food. No API key and no account are needed.",
  "Call list_filters before narrowing a search. The site accepts any value on a facet and answers one it does not know with a total of zero, so a guessed spelling comes back as a confident absence rather than as a refusal.",
  "The values list_filters returns are an excerpt of the most frequent ones, and the site accepts others it does not publish: an absent option is not an unusable one.",
  "Counts are measured inside a scope. Pass 'query' to count within one search, and leave it out to count across the whole listing; the two answer different questions and are not comparable.",
  "A total marked 'total_is_ceiling' sits on the largest number of rows one search will serve, so it states a floor rather than a count.",
  "A count the site published nothing for is null, never zero.",
  "This server paces itself, and a rate_limited error means the site asked it to slow down, never that nothing matched.",
  "When you show a recipe or a listing to a user, credit BBC Good Food and link the page.",
].join(" ");

export function createServer(options: CreateServerOptions = {}): McpServer {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);
  const client = new GoodFoodClient({
    config,
    logger,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });

  const server = new McpServer(
    { name: "mcp-bbc-goodfood", version: PKG_VERSION },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "list_filters",
    {
      title: "List the ways a search can be narrowed",
      description: listFiltersDescription,
      inputSchema: listFiltersArgs,
      outputSchema: z.object(listFiltersOutputShape),
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return await runListFilters(client, args as ListFiltersArgs);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  logger.info(
    `ready: user-agent="${config.userAgent}", min interval ${config.minIntervalMs}ms, cache ${config.cacheTtlMs}ms`,
  );

  return server;
}
