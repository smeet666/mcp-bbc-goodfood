# mcp-bbc-goodfood

Read BBC Good Food from an MCP client. No API key, no account, read-only.

## What it does

**`list_filters`** publishes the axes a recipe search can be narrowed along,
with the values each one takes and how many recipes carry them, measured inside
one search or across the whole listing.

It exists because the site accepts any value on a facet and answers one it does
not know with a total of zero. A caller who guesses a spelling is told that
nothing matches, which is a confident answer to a question the site never
understood. Publishing the vocabulary is what makes the question askable.

## What sets it apart

The site answers a term it holds nothing for with a count and a page of rows all
the same, marking nothing as a miss. This server counts how many of the rows it
was served actually carry a word of the search, and says when none of them do.
Two counts rather than a verdict: a reader seeing two rows out of thirty judges
better than a flag that judges for them.

A total that lands on the largest number of rows one search will serve is
reported as a floor rather than as a count. A figure the site published nothing
for is `null`, never `0`.

## Install

```bash
npx mcp-bbc-goodfood
```

Or in an MCP client's configuration:

```json
{
  "mcpServers": {
    "bbc-goodfood": {
      "command": "npx",
      "args": ["-y", "mcp-bbc-goodfood"]
    }
  }
}
```

## Links

- Source: https://github.com/smeet666/mcp-bbc-goodfood
- Package: https://www.npmjs.com/package/mcp-bbc-goodfood
- Licence: MIT
