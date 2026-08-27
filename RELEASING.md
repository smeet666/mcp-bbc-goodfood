# Releasing

Releases go to npm from GitHub Actions using npm **trusted publishing** (OIDC).
No npm token is stored on this repository.

## One-time setup

Trusted publishing is configured from a package's own settings page, so it
cannot cover the very first publish of a name that does not exist yet. The first
release goes out from a workstation; everything after that goes out from CI.

### 1. Publish the first version by hand

```bash
npm login --auth-type=web    # opens a browser, covers 2FA including passkeys
npm publish --access public  # prepublishOnly reruns typecheck, tests and build
```

If the account requires two-factor authentication on writes and the second
factor is a security key rather than an authenticator app, the CLI cannot prompt
for it. Use a recovery code from the account's 2FA settings:
`npm publish --access public --otp=<recovery-code>`.

### 2. Register the trusted publisher

On npmjs.com, open the package, then **Settings** and the **Trusted Publisher**
section. Every field is case-sensitive and must match this repository exactly:

| Field                | Value              |
| -------------------- | ------------------ |
| Publisher            | GitHub Actions     |
| Organization or user | `smeet666`         |
| Repository           | `mcp-bbc-goodfood` |
| Workflow filename    | `publish.yml`      |
| Environment          | leave empty        |

### 3. Revoke whatever bootstrapped it

Any token or recovery code used for the first publish is no longer needed once
trusted publishing works, and should be revoked.

## Every release after that

1. Bump the version in **four** files, which have to stay in step. A test reads
   them together, so a laggard fails the suite rather than shipping:
   - `package.json`
   - `server.json`
   - `packaging/manifest.json`
   - `src/version.ts`
2. Write the changelog entry. Several unpublished fixes are pressed into one
   version and one entry rather than going out as four releases.
3. Open a pull request. The default branch requires `check`, `test (24)`,
   `test (26)`, `coverage` and `image`, and it applies to administrators too.
4. Merge, then tag `vX.Y.Z` and push the tag.

The tag starts the chain, and the chain has an order. The registry refuses a
version npm does not serve yet, so the registry entry follows the npm publish,
and the bundle waits on that same publish. Two workflows started by one tag do
not wait for each other on their own: whatever must follow is a job that
declares what it waits for, by name. Renaming a workflow breaks that link with
nothing on screen to say so.

## What the number says

The number says what a version costs whoever installs it. Raising the runtime
floor takes a supported line away and breaks someone's install: that is a major
version, and the changelog names the break first.

## What needs a release, and what does not

The npm archive carries the built code, the README, the licence, the changelog
and the descriptor. npm serves the README frozen at publish time, so a README
correction reaches nobody before the next version.

Workflows, tests, configuration files, the image and the repository's own
settings take effect without a version.

## Verifying a release

- `npm view mcp-bbc-goodfood version` matches the tag.
- The GitHub release carries the `.mcpb` bundle, and its address is the one the
  registry entry names. That address is computed at publish time, never written
  by hand: written by hand it carries a number that survives a bump and makes
  the entry announce one version while serving another's file.
- The registry entry appears, with a description at or under **100 characters**.
  It refuses anything longer and checks that the bundle address downloads.
- The one-click install links in the README encode the package name. Copying
  them from another project offers to install a package that does not exist, so
  read them before announcing.

## Glama

Indexing happens on its own. The rest needs a signed-in session: claim the
server, which `glama.json` with `maintainers: ["smeet666"]` proves, set the
build spec, then press **Build** on its own followed by **Make Release**,
entering the real number. The combined button picks one of its own.

## The live canary

A nightly job at 06:51 UTC runs the live suite against the real routes and opens
an issue when it fails. A failure there means the site moved, never that a pull
request is bad, which is why it sits outside continuous integration.
