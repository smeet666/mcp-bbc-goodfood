# mcp-bbc-goodfood

## Tagline

Read BBC Good Food recipes, and put their ingredients to any number of people.

## Description

An MCP server for BBC Good Food. Search its recipes, read one from the page a
search row carries, and put its ingredients to a different number of people.

What it will not do is state something the site did not publish. A count the
site published nothing for comes back as null and never as zero. A total that
sits on the largest number of rows one search will serve says it states a floor
rather than a count. The site accepts any value on a facet and answers one it
does not know with a total of zero, so the server publishes the vocabulary and
warns that a guessed spelling comes back as a confident absence.

Quantities put to another number of people are announced as the server's own
arithmetic and never as the site's, and every line says whether the figure
landed exactly or moved to stay usable in a kitchen: three eggs halved come back
as two, because half an egg is not an amount a kitchen measures out.

A recipe behind the site's subscription comes back with everything except its
ingredients and steps, and says so. The page carries them, which is exactly why
the rule exists.

It is for anyone who wants an assistant to quote a recipe accurately, credit it,
and link where it came from.

## Setup Requirements

- `BGF_USER_AGENT` (optional): Identify your own client. The project's own identifier is appended so the site can always reach a human.
- `BGF_MIN_INTERVAL_MS` (optional): Minimum gap between requests. Default 1500, and the floor cannot be lowered from outside.
- `BGF_TIMEOUT_MS` (optional): Per-request deadline, covering the body. Default 20000.
- `BGF_MAX_RETRIES` (optional): Attempts after the first. Default 3.
- `BGF_CACHE_TTL_MS` (optional): In-memory cache lifetime. Default 900000. Set 0 to turn it off.
- `BGF_CACHE_MAX_ENTRIES` (optional): Entries kept in memory. Default 200.
- `BGF_LOG_LEVEL` (optional): silent, error, info or debug. Default error, on stderr.

No API key and no account are needed.

## Category

Content & Media

## Features

- Search recipes by free text, narrowed by diet, cuisine, meal type or difficulty
- Bound a search by time, calories, servings or rating
- Leave out what sits behind the site's subscription
- List the axes a search can be narrowed along, with the values each takes
- Count within one search or across the whole listing, and say which was measured
- Read one recipe: ingredients, steps, times, rating, diets and nutrition
- Put a recipe to any number of people, from 1 to 100
- Scale any list of ingredient lines offline, with no request to the site
- Say on every line whether a figure is exact or was moved to stay usable
- State a quantity in the unit that holds it: 200 g times twenty reads 4 kg
- Round by the food, so an egg stays whole where an onion goes to quarters
- Name every line a page carried that could not be read, rather than dropping it
- Pace itself, and say when the site asked it to slow down

## Getting Started

- "What can I narrow a BBC Good Food search by, for chicken?"
- "Find me ten recipes with red peppers, under 30 minutes"
- "Read the classic cheese souffle recipe for two people"
- "Scale this ingredient list from 4 servings to 12"
- Tool: list_filters — the axes a search takes, the values each one holds, and the argument that restricts it
- Tool: search_recipes — search the site and get a listing, each row carrying the page to read it on
- Tool: get_recipe — read one recipe, optionally put to a number of people
- Tool: scale_ingredients — put any list of ingredient lines to another number of people, offline

## Tags

recipes, cooking, food, bbc-good-food, ingredients, scaling, meal-planning, no-api-key, read-only, content

## Documentation URL

https://github.com/smeet666/mcp-bbc-goodfood#readme
