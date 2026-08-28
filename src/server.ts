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
import {
  runSearchRecipes,
  searchRecipesArgs,
  searchRecipesDescription,
  searchRecipesOutputShape,
} from "./tools/searchRecipes.js";
import type { SearchRecipesArgs } from "./tools/searchRecipes.js";
import {
  getRecipeArgs,
  getRecipeDescription,
  getRecipeOutputShape,
  runGetRecipe,
} from "./tools/getRecipe.js";
import type { GetRecipeArgs } from "./tools/getRecipe.js";
import {
  runScaleIngredients,
  scaleIngredientsArgs,
  scaleIngredientsDescription,
  scaleIngredientsOutputShape,
} from "./tools/scaleIngredients.js";
import type { ScaleIngredientsArgs } from "./tools/scaleIngredients.js";
import { toToolError } from "./tools/shared.js";
import { PKG_VERSION } from "./version.js";

export interface CreateServerOptions {
  config?: Config;
  logger?: Logger;
  fetchImpl?: typeof fetch;
}

/** This server only reads, so every tool is read-only. */
/** A tool that reads the site. What it answers depends on what the site holds. */
const READS_THE_SITE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/**
 * A tool whose world is closed: it reaches nothing outside its arguments, so
 * the same call answers the same thing for as long as the server exists.
 */
const READS_NOTHING = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const INSTRUCTIONS = [
  "Tools for reading recipes on BBC Good Food. No API key and no account are needed.",
  "Typical flow: list_filters to learn the values a restriction takes, then search_recipes to find recipes, then get_recipe on the path a row carries to read one.",
  "Call list_filters before narrowing a search. The site accepts any value on a facet and answers one it does not know with a total of zero, so a guessed spelling comes back as a confident absence rather than as a refusal.",
  "The values list_filters returns are an excerpt of the most frequent ones, and the site accepts others it does not publish: an absent option is not an unusable one.",
  "Counts are measured inside a scope. Pass 'query' to count within one search, and leave it out to count across the whole listing; the two answer different questions and are not comparable.",
  "A total marked 'total_is_ceiling' sits on the largest number of rows one search will serve, so it states a floor rather than a count.",
  "A count the site published nothing for is null, never zero.",
  "A recipe behind the site's subscription comes back without its ingredients and steps: send the user to its page rather than reconstructing them.",
  "get_recipe takes 'servings', and scale_ingredients takes any list of lines, to put a recipe to a different number of people. Those figures are this server's arithmetic and not the site's, so tell the user they were recomputed, and read 'scaling' on each line: 'rounded' means the figure moved to stay usable in a kitchen, since half an egg is not an amount a kitchen measures out.",
  "A scaled quantity is said in the unit that states it exactly, so a line can come back in a different unit from the one it was written in: 200 g multiplied by twenty reads 4 kg, and 2 g divided by ten reads 200 mg. Read the unit each line carries rather than the one it started with.",
  "A recipe whose page states no number of servings cannot be put to a number of people, and the answer says so rather than guessing what it serves.",
  "The site writes many of its recipes twice, once for its own readers and once restated for readers in the United States, and 'unit_system' on get_recipe chooses between them: both are the site's own words, and nothing is converted here. The rendition served is named under 'unit_system' in the answer, since a recipe the site restated nowhere comes back as it published it. In the United States rendition the measure is restated inside each line, while 'amount' and 'unit' beside it stay metric, because that is the figure the site publishes for both: a line reading '6 oz' carries 185 g.",
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
      annotations: READS_THE_SITE,
    },
    async (args) => {
      try {
        return await runListFilters(client, args as ListFiltersArgs);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "search_recipes",
    {
      title: "Search recipes",
      description: searchRecipesDescription,
      inputSchema: searchRecipesArgs,
      outputSchema: z.object(searchRecipesOutputShape),
      annotations: READS_THE_SITE,
    },
    async (args) => {
      try {
        return await runSearchRecipes(client, args as SearchRecipesArgs);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Read a recipe",
      description: getRecipeDescription,
      inputSchema: getRecipeArgs,
      outputSchema: z.object(getRecipeOutputShape),
      annotations: READS_THE_SITE,
    },
    async (args) => {
      try {
        return await runGetRecipe(client, args as GetRecipeArgs);
      } catch (error) {
        return toToolError(error);
      }
    },
  );

  server.registerTool(
    "scale_ingredients",
    {
      title: "Scale a list of ingredients",
      description: scaleIngredientsDescription,
      inputSchema: scaleIngredientsArgs,
      outputSchema: z.object(scaleIngredientsOutputShape),
      annotations: READS_NOTHING,
    },
    (args) => {
      try {
        return runScaleIngredients(args as ScaleIngredientsArgs);
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
