/**
 * Settings, read from the environment.
 *
 * A value that cannot be read warns and falls back rather than stopping the
 * server: a typo in one variable should not take away every tool. Warnings go
 * to stderr, because stdout carries the protocol and anything written there
 * corrupts the session.
 */

import process from "node:process";
import { PKG_VERSION, REPO_URL } from "./version.js";

export const LOG_LEVELS = ["silent", "error", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * BBC Good Food publishes no crawl delay, so this floor is chosen rather than
 * read. It is not negotiable from the outside: configuration can slow the
 * server down, never speed it past a request per second.
 */
export const MIN_ALLOWED_INTERVAL_MS = 1000;
/** Beyond this a request would look hung rather than paced. */
export const MAX_ALLOWED_INTERVAL_MS = 60_000;

export interface Config {
  userAgent: string;
  minIntervalMs: number;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  logLevel: LogLevel;
}

export const DEFAULT_USER_AGENT = `mcp-bbc-goodfood/${PKG_VERSION} (+${REPO_URL})`;

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const PREFIX = "[mcp-bbc-goodfood]";

export function createLogger(level: LogLevel): Logger {
  const rank = LOG_LEVELS.indexOf(level);
  /**
   * `survivesAt` decides whether the line is written, `label` says what it is.
   * Keeping the two apart is what lets a warning pass at the default setting
   * while still reading as a warning: a line labelled with the threshold it
   * survived would make "rows were dropped" indistinguishable from a failure.
   */
  const write = (label: string, survivesAt: LogLevel, message: string): void => {
    if (rank === 0 || LOG_LEVELS.indexOf(survivesAt) > rank) {
      return;
    }
    process.stderr.write(`${PREFIX} ${label}: ${message}\n`);
  };
  return {
    debug: (m) => write("debug", "debug", m),
    info: (m) => write("info", "info", m),
    // A warning goes out at the error threshold so it survives the default
    // setting: a caller has to know that rows were dropped.
    warn: (m) => write("warn", "error", m),
    error: (m) => write("error", "error", m),
  };
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!(Number.isFinite(value) && Number.isInteger(value))) {
    process.stderr.write(
      `${PREFIX} error: ${name}="${raw}" is not a whole number; using ${fallback}.\n`,
    );
    return fallback;
  }
  if (value < min || value > max) {
    // Clamping silently would let a caller believe a setting took effect when
    // the opposite is true, so the refusal is stated and the default stands.
    process.stderr.write(
      `${PREFIX} error: ${name}=${value} is outside ${min}..${max}; using ${fallback}.\n`,
    );
    return fallback;
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Trimmed before it is judged: a variable holding only spaces is one nobody
  // set, and complaining about it would report a mistake that was never made.
  const level = env.BGF_LOG_LEVEL?.trim();
  const named = level === undefined || level === "" ? undefined : (level as LogLevel);
  const logLevel = named && LOG_LEVELS.includes(named) ? named : "error";
  if (named && !LOG_LEVELS.includes(named)) {
    process.stderr.write(
      `${PREFIX} error: BGF_LOG_LEVEL="${named}" is not one of ${LOG_LEVELS.join(", ")}; using error.\n`,
    );
  }

  const custom = env.BGF_USER_AGENT?.trim();

  return {
    // A caller who wants to be recognised may say who they are, and the
    // contact address stays attached: the site has to be able to reach a human
    // about traffic it did not expect.
    userAgent: custom ? `${custom} ${DEFAULT_USER_AGENT}` : DEFAULT_USER_AGENT,
    minIntervalMs: readInteger(
      env,
      "BGF_MIN_INTERVAL_MS",
      1500,
      MIN_ALLOWED_INTERVAL_MS,
      MAX_ALLOWED_INTERVAL_MS,
    ),
    timeoutMs: readInteger(env, "BGF_TIMEOUT_MS", 20_000, 1000, 120_000),
    maxRetries: readInteger(env, "BGF_MAX_RETRIES", 3, 0, 8),
    cacheTtlMs: readInteger(env, "BGF_CACHE_TTL_MS", 900_000, 0, 86_400_000),
    cacheMaxEntries: readInteger(env, "BGF_CACHE_MAX_ENTRIES", 200, 1, 5000),
    logLevel,
  };
}
