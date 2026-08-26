import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_USER_AGENT,
  LOG_LEVELS,
  MAX_ALLOWED_INTERVAL_MS,
  MIN_ALLOWED_INTERVAL_MS,
  createLogger,
  loadConfig,
} from "../../src/config.js";
import type { Config, LogLevel } from "../../src/config.js";
import process from "node:process";

let stderrLines: string[] = [];
let stdoutLines: string[] = [];

function decode(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return new TextDecoder().decode(chunk);
  }
  return String(chunk);
}

beforeEach(() => {
  stderrLines = [];
  stdoutLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderrLines.push(decode(chunk));
    return true;
  }) as typeof process.stderr.write);
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdoutLines.push(decode(chunk));
    return true;
  }) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** stdout carries the protocol: a stray line there corrupts the session. */
function expectSilentStdout(): void {
  expect(stdoutLines).toEqual([]);
}

interface NumericCase {
  readonly variable: string;
  readonly field: keyof Config;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

const numericCases: readonly NumericCase[] = [
  {
    variable: "BGF_MIN_INTERVAL_MS",
    field: "minIntervalMs",
    fallback: 1500,
    min: 1000,
    max: 60_000,
  },
  { variable: "BGF_TIMEOUT_MS", field: "timeoutMs", fallback: 20_000, min: 1000, max: 120_000 },
  { variable: "BGF_MAX_RETRIES", field: "maxRetries", fallback: 3, min: 0, max: 8 },
  { variable: "BGF_CACHE_TTL_MS", field: "cacheTtlMs", fallback: 900_000, min: 0, max: 86_400_000 },
  {
    variable: "BGF_CACHE_MAX_ENTRIES",
    field: "cacheMaxEntries",
    fallback: 200,
    min: 1,
    max: 5000,
  },
];

describe("loadConfig defaults", () => {
  it("an empty environment yields every documented default", () => {
    const config = loadConfig({});
    expect(config.minIntervalMs).toBe(1500);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.maxRetries).toBe(3);
    expect(config.cacheTtlMs).toBe(900_000);
    expect(config.cacheMaxEntries).toBe(200);
    expect(config.logLevel).toBe("error");
    expect(config.userAgent).toBe(DEFAULT_USER_AGENT);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("reads the ambient environment when called without an argument", () => {
    const config = loadConfig();
    expect(LOG_LEVELS).toContain(config.logLevel);
    expect(typeof config.minIntervalMs).toBe("number");
    expectSilentStdout();
  });

  it("publishes the interval bounds it enforces", () => {
    expect(MIN_ALLOWED_INTERVAL_MS).toBe(1000);
    expect(MAX_ALLOWED_INTERVAL_MS).toBe(60_000);
    expect(LOG_LEVELS).toEqual(["silent", "error", "info", "debug"]);
  });
});

describe.each(numericCases)("$variable", (testCase) => {
  it("takes an in-range integer", () => {
    const config = loadConfig({ [testCase.variable]: String(testCase.min + 1) });
    expect(config[testCase.field]).toBe(testCase.min + 1);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("accepts its lowest allowed value", () => {
    const config = loadConfig({ [testCase.variable]: String(testCase.min) });
    expect(config[testCase.field]).toBe(testCase.min);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("accepts its highest allowed value", () => {
    const config = loadConfig({ [testCase.variable]: String(testCase.max) });
    expect(config[testCase.field]).toBe(testCase.max);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("keeps the default, in silence, when the variable is empty", () => {
    const config = loadConfig({ [testCase.variable]: "" });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("keeps the default, in silence, when the variable is only spaces", () => {
    const config = loadConfig({ [testCase.variable]: "   " });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("warns on stderr and keeps the default for a non-integer value", () => {
    const config = loadConfig({ [testCase.variable]: "12.5" });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(stderrLines.length).toBeGreaterThan(0);
    expectSilentStdout();
  });

  it("warns on stderr and keeps the default for a value that is not a number", () => {
    const config = loadConfig({ [testCase.variable]: "soon" });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(stderrLines.length).toBeGreaterThan(0);
    expectSilentStdout();
  });

  it("warns and keeps the default below the lower bound, without clamping", () => {
    const config = loadConfig({ [testCase.variable]: String(testCase.min - 1) });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(config[testCase.field]).not.toBe(testCase.min);
    expect(stderrLines.length).toBeGreaterThan(0);
    expectSilentStdout();
  });

  it("warns and keeps the default above the upper bound, without clamping", () => {
    const config = loadConfig({ [testCase.variable]: String(testCase.max + 1) });
    expect(config[testCase.field]).toBe(testCase.fallback);
    expect(config[testCase.field]).not.toBe(testCase.max);
    expect(stderrLines.length).toBeGreaterThan(0);
    expectSilentStdout();
  });
});

describe("BGF_LOG_LEVEL", () => {
  it.each(LOG_LEVELS)("accepts %s", (level) => {
    const config = loadConfig({ BGF_LOG_LEVEL: level });
    expect(config.logLevel).toBe(level);
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("warns on stderr and keeps error for an unknown level", () => {
    const config = loadConfig({ BGF_LOG_LEVEL: "chatty" });
    expect(config.logLevel).toBe("error");
    expect(stderrLines.length).toBeGreaterThan(0);
    expectSilentStdout();
  });

  it("keeps error, in silence, when the level is empty", () => {
    expect(loadConfig({ BGF_LOG_LEVEL: "" }).logLevel).toBe("error");
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("keeps error, in silence, when the level is only spaces", () => {
    expect(loadConfig({ BGF_LOG_LEVEL: "  " }).logLevel).toBe("error");
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });
});

describe("user agent", () => {
  it("names the package, its version and the repository", () => {
    expect(DEFAULT_USER_AGENT).toContain("mcp-bbc-goodfood");
    expect(DEFAULT_USER_AGENT).toMatch(/\d+\.\d+\.\d+/);
    expect(DEFAULT_USER_AGENT).toContain("github.com/smeet666/mcp-bbc-goodfood");
  });

  it("appends the default to a supplied user agent", () => {
    const config = loadConfig({ BGF_USER_AGENT: "my-client/2.0" });
    expect(config.userAgent).toBe(`my-client/2.0 ${DEFAULT_USER_AGENT}`);
    expectSilentStdout();
  });

  it("falls back to the default when the variable is absent, empty or blank", () => {
    expect(loadConfig({}).userAgent).toBe(DEFAULT_USER_AGENT);
    expect(loadConfig({ BGF_USER_AGENT: "" }).userAgent).toBe(DEFAULT_USER_AGENT);
    expect(loadConfig({ BGF_USER_AGENT: "   " }).userAgent).toBe(DEFAULT_USER_AGENT);
    expectSilentStdout();
  });
});

describe("createLogger", () => {
  const levels: readonly LogLevel[] = LOG_LEVELS;

  function callEveryMethod(level: LogLevel): void {
    const logger = createLogger(level);
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
  }

  /** The message each written line carries, prefix set aside. */
  function messages(): string[] {
    return stderrLines.map((line) => line.replace(/^\[mcp-bbc-goodfood] \w+: /, "").trimEnd());
  }

  it("silent writes nothing at all", () => {
    callEveryMethod("silent");
    expect(stderrLines).toEqual([]);
    expectSilentStdout();
  });

  it("error lets error and warn through and holds info and debug back", () => {
    callEveryMethod("error");
    expect(messages()).toEqual(["w", "e"]);
    expectSilentStdout();
  });

  it("info adds info", () => {
    callEveryMethod("info");
    expect(messages()).toEqual(["i", "w", "e"]);
    expectSilentStdout();
  });

  it("debug lets everything through, in order", () => {
    callEveryMethod("debug");
    expect(messages()).toEqual(["d", "i", "w", "e"]);
    expectSilentStdout();
  });

  it("prefixes each line with the server name and the level, and ends it with a break", () => {
    callEveryMethod("debug");
    expect(stderrLines).toEqual([
      "[mcp-bbc-goodfood] debug: d\n",
      "[mcp-bbc-goodfood] info: i\n",
      "[mcp-bbc-goodfood] warn: w\n",
      "[mcp-bbc-goodfood] error: e\n",
    ]);
    expectSilentStdout();
  });

  it("writes one line per call, never more", () => {
    callEveryMethod("debug");
    expect(stderrLines.length).toBe(4);
    for (const line of stderrLines) {
      expect(line.endsWith("\n")).toBe(true);
      expect(line.startsWith("[mcp-bbc-goodfood] ")).toBe(true);
    }
  });

  it("never writes on stdout, at any level", () => {
    for (const level of levels) {
      callEveryMethod(level);
    }
    expectSilentStdout();
  });
});
