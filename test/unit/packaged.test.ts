import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";
import { PKG_VERSION } from "../../src/version.js";

// These tests state agreement between the files that ship the package, never
// the values themselves. A test that copied a version number would become a
// second place asserting it, and the day the two diverged neither could
// arbitrate.

const REPO_JSON_FILES = [
  "package.json",
  "server.json",
  "packaging/manifest.json",
  "glama.json",
] as const;

interface PackageJson {
  version: string;
  author: { name: string };
  bin: Record<string, string>;
  exports: Record<string, { types?: string; import?: string }>;
  files: string[];
  engines: { node: string };
}

interface ServerJson {
  description: string;
  version: string;
  packages: { version: string }[];
}

interface ManifestJson {
  version: string;
  author: { name: string };
  tools: { name: string; description?: string }[];
  compatibility: { runtimes: { node: string } };
}

const readRepoText = (relativePath: string): string =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

const readRepoJson = <T>(relativePath: string): T => JSON.parse(readRepoText(relativePath)) as T;

const pkg = readRepoJson<PackageJson>("package.json");
const serverJson = readRepoJson<ServerJson>("server.json");
const manifest = readRepoJson<ManifestJson>("packaging/manifest.json");

const registeredToolNames = async (): Promise<string[]> => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "packaged-test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const listed = await client.listTools();
  await client.close();
  await server.close();
  return listed.tools.map((tool) => tool.name);
};

describe("the author's name", () => {
  it("agrees between package.json, the manifest and the licence", () => {
    const name = pkg.author.name;
    expect(name.trim().length, "package.json author.name is empty").toBeGreaterThan(0);
    expect(manifest.author.name, "packaging/manifest.json author.name left the package").toBe(name);
    expect(readRepoText("LICENSE"), "LICENSE does not name the package author").toContain(name);
  });
});

describe("the version number", () => {
  it("agrees between package.json, server.json, the manifest and PKG_VERSION", () => {
    const declared = pkg.version;
    expect(declared.trim().length, "package.json version is empty").toBeGreaterThan(0);
    expect(serverJson.version, "server.json version left package.json").toBe(declared);
    expect(serverJson.packages[0]?.version, "server.json packages[0].version left the top").toBe(
      declared,
    );
    expect(manifest.version, "packaging/manifest.json version left package.json").toBe(declared);
    expect(PKG_VERSION, "src/version.ts PKG_VERSION left package.json").toBe(declared);
  });
});

describe("the tool list", () => {
  it("agrees between the manifest and what createServer registers", async () => {
    const manifested = new Set(manifest.tools.map((tool) => tool.name));
    const registered = new Set(await registeredToolNames());

    for (const name of manifested) {
      expect(
        registered.has(name),
        `packaging/manifest.json announces ${name}, the server does not register it`,
      ).toBe(true);
    }
    for (const name of registered) {
      expect(
        manifested.has(name),
        `the server registers ${name}, packaging/manifest.json does not announce it`,
      ).toBe(true);
    }
  });

  it("gives every manifested tool a non-empty description", () => {
    expect(manifest.tools.length, "packaging/manifest.json announces no tool").toBeGreaterThan(0);
    for (const tool of manifest.tools) {
      expect(
        (tool.description ?? "").trim().length,
        `packaging/manifest.json describes ${tool.name} with nothing`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the published package shape", () => {
  it("declares an executable", () => {
    expect(Object.keys(pkg.bin).length, "package.json declares no bin").toBeGreaterThan(0);
  });

  it("exports the root and the client, each with types and import", () => {
    for (const entry of [".", "./client"]) {
      const exported = pkg.exports[entry];
      expect(exported, `package.json exports is missing ${entry}`).toBeDefined();
      expect(exported?.types, `package.json exports ${entry} carries no types`).toBeTruthy();
      expect(exported?.import, `package.json exports ${entry} carries no import`).toBeTruthy();
    }
  });

  it("ships the build, the readme, the licence, the changelog and server.json", () => {
    // Presence, never equality to a frozen list: an entry point added later
    // must not turn this red.
    for (const shipped of ["dist", "README.md", "LICENSE", "CHANGELOG.md", "server.json"]) {
      expect(pkg.files, `package.json files does not ship ${shipped}`).toContain(shipped);
    }
  });
});

describe("the Node floor", () => {
  it("agrees between the package and the manifest", () => {
    expect(
      manifest.compatibility.runtimes.node,
      "packaging/manifest.json runtimes.node left package.json engines.node",
    ).toBe(pkg.engines.node);
  });
});

describe("the registry description", () => {
  it("fits under the 100 characters the registry enforces", () => {
    expect(
      serverJson.description.length,
      "server.json description is over the 100 characters the registry accepts",
    ).toBeLessThanOrEqual(100);
  });
});

describe("the repository's JSON files", () => {
  it.each(REPO_JSON_FILES)("%s is valid JSON", (relativePath) => {
    expect(() => JSON.parse(readRepoText(relativePath))).not.toThrow();
  });
});
