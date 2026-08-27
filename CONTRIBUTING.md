# Contributing

## What this server is, and what it will not become

A read-only client for BBC Good Food, with no API key and no account. It reads,
it renders what it read, and it writes nothing back to the site.

The rule everything else follows: **the server never says anything the data does
not carry.** A breakdown is not an empty result, a figure the site published
nothing for is `null` rather than `0`, and a counter is named for what it counts.
A change that makes an answer sound more helpful at the cost of that rule will
be turned down, however convenient it reads.

## Getting it running

```bash
npm ci
npm run build
npm test
```

The unit suite reads a generated corpus and touches no network. `npm run
build:fixtures` rewrites that corpus; the result is committed, and continuous
integration regenerates it and refuses any difference. A corpus that has drifted
from its generator makes the suite prove something about a file rather than
about the server.

To exercise the real routes:

```bash
BGF_LIVE=1 npm run test:live
```

One request per route, and it is deliberately not part of the ordinary suite.
A nightly job runs it and opens an issue when the site moves.

## The seam

```
src/index.ts          the executable, stdio transport
src/server.ts         where the tools are registered, in a fixed order
src/tools/*.ts        arguments, rendering, notes        ← imports the MCP SDK
──────────────────────────────────────────────────────────  the seam
src/bbcgoodfood/*.ts  http, pacing, storage, reading     ← never imports the SDK
```

The lower layer is published on its own, under the package's `./client`
subpath, so a program can import it as an ordinary library with its pacing, its
storage and its error vocabulary and no protocol attached. Keep it that way: a
`src/bbcgoodfood/` file that reaches for the SDK closes that door.

Every read returns `Read<T> = { data, cached, skipped? }`. Errors use six codes
and no more: `not_found`, `invalid_input`, `rate_limited`, `parse_failure`,
`network_error`, `timeout`. A refused argument opens its message with
`[invalid_input]` whichever path refused it.

## Tests come first

Write the test that states the right answer, watch it fail, then write the code.
A test written afterwards only proves what the code already does.

Tests are deterministic or they do not exist. Anything touching time goes
through `vi.useFakeTimers` with a fixed epoch. No tolerance constants, no
`toBeLessThan(1000)`, no reading of the real clock. A test that passes only on a
fast machine is rewritten or removed.

**Coverage has a floor of 100%, and it does not come down.** A figure below it
is a module nobody asked about. If a line is genuinely unreachable, say why
where it sits rather than lowering the floor.

The gate before a change lands is five consecutive identical passes.

## Writing

Every piece of text has to read on its own. A comment, a line of the README, a
tool description addresses someone meeting the project for the first time, with
no knowledge of any earlier version. Never "as before", "now", "unlike", "used
to". Describe what the code does and **why**, never how it differs from a past
state. The changelog is the one place allowed to compare.

A comment explains an invariant or a reason, never the obvious. If a function is
called `countCarryingRows`, do not write "counts the carrying rows".

A README describes what the server does. Do not enumerate what it does not do,
unless leaving something out was a deliberate and surprising choice.

## What the site is owed

BBC Good Food is free to read and publishes no crawl delay, which is a reason to
be careful rather than a licence to be fast. One request at a time, spaced, and
the floor is not negotiable from the outside.

If you are adding a route, ask first whether the answer is already in a payload
the server reads. Several answers here cost no request at all for that reason.
