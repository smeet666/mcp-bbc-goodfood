# Security

## Reporting

Report a vulnerability privately through GitHub's advisory form, at
[Security → Report a vulnerability](https://github.com/smeet666/mcp-bbc-goodfood/security/advisories/new).
Please do not open a public issue for something exploitable.

Expect an acknowledgement within a week. A fix goes out as a release, and the
advisory names whoever reported it unless they ask otherwise.

## What this server is

A read-only client for BBC Good Food. It needs no API key and no account, it
sends no credentials, and it writes nothing anywhere: every route it reads is
one a browser reads without signing in.

It speaks over stdio and listens on no port.

## What it stores

Answers from the site are held in memory for as long as their lifetime lasts,
and nothing is written to disk. Closing the process ends the storage.

Nothing a caller asks for is recorded. The server keeps no log of queries beyond
what its own diagnostics print to stderr, which the log level governs and which
is off by default beyond errors.

## Where third-party text reaches a model

A recipe title, a facet label and an author name are written by the site, and
they arrive in an answer this server renders. Two things follow.

**The text block ends with lines the server writes**, opening `Note:` and
`Source:`. A line of site text opening with either of those words is indented by
one space, so a caller can tell the two apart. The structured payload keeps the
text exactly as it was published.

**Nothing from the site is executed, resolved or followed.** Addresses are
rendered as text. The server fetches only the search route it builds itself,
never an address a response hands it.

## What a caller can set

Every setting is an environment variable, and none of them is a secret. A value
outside its range is refused with a line on stderr, and the default stands: a
setting that cannot take effect says so rather than being quietly clamped.

The pacing floor cannot be lowered from the outside, including through the
published `./client` entry point. A caller may slow the server down, never speed
it past a request per second.

The `User-Agent` always carries the project's name and an address where a person
can be reached, even when a caller supplies one of their own. The site has to be
able to reach someone about traffic it did not expect.

## Supported versions

The latest published version. Fixes go into a new release rather than into
patches of older ones.
