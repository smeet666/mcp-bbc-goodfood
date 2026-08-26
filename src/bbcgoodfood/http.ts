/**
 * One GET, with a deadline and bounded retries.
 *
 * Two things separate a retry worth making from one that only adds load. A
 * refusal that carries a time to come back is obeyed rather than guessed at,
 * and an answer the site meant is never retried: asking again for a page that
 * does not exist wastes a request and delays the honest answer.
 */

import type { Logger } from "../config.js";
import {
  invalidInput,
  networkError,
  notFound,
  parseFailure,
  rateLimited,
  timeout as timeoutError,
} from "../errors.js";
import type { RateLimiter } from "./rateLimiter.js";

export interface FetchOptions {
  url: string;
  userAgent: string;
  timeoutMs: number;
  maxRetries: number;
  limiter: RateLimiter;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/** Statuses worth another attempt: the site is busy rather than answering "no". */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Statuses that mean the site is asking for room. */
const PUSH_BACK = new Set([429, 503]);

/**
 * The longest wait worth taking rather than reporting.
 *
 * A refusal may name any delay, and an hour is a legal answer. Sleeping through
 * it holds the one request slot this server has, so every other tool waits
 * behind a call whose caller has long since given up. Past this point the wait
 * is the answer, and the caller decides what to do with it.
 */
const LONGEST_WAIT_MS = 30_000;

/**
 * How many times a request that never answered is worth repeating.
 *
 * A route that did not respond within its budget is busy. Repeating the same
 * query adds load to what is already struggling, and each attempt holds the
 * slot for the full deadline again.
 */
const RETRIES_AFTER_SILENCE = 1;

/**
 * Read a Retry-After header, which is either a number of seconds or a date.
 * Returns null when it says neither, so the caller falls back to its own wait.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  // A value that reads as a number is a number of seconds, and that settles it:
  // letting a negative one fall through to the date form has it parsed as a
  // year and clamped to zero, which reads as "come back at once" from a header
  // that said something impossible.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.round(seconds * 1000) : null;
  }

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) {
    return null;
  }
  return Math.max(0, at - now);
}

/**
 * Let go of a body this never reads.
 *
 * An abandoned body keeps its socket out of the pool until it is consumed or
 * cancelled. Cancelling can itself fail, on a stream that is already gone, and
 * that failure says nothing about the answer being reported: swallowing it here
 * keeps a refusal from being reported as a transport fault.
 */
const discardBody = (response: Response): Promise<void> =>
  response.body?.cancel().catch(() => undefined) ?? Promise.resolve();

/** What a refusal amounts to, and what it costs the pacing. */
type Refusal =
  | { kind: "refused"; error: Error; pushBack: boolean }
  | { kind: "again"; waitMs: number; pushBack: boolean };

/**
 * Read a status the site answered with, apart from the loop that retries.
 *
 * An abandoned body keeps its socket out of the pool until it is consumed or
 * cancelled, so a body this never reads is cancelled here. A request the site
 * read and would not run, and an address it says does not exist, are both
 * settled questions: calling either a network failure invites a retry of
 * something only the caller can fix.
 */
async function readRefusal(
  response: Response,
  url: string,
  attempt: number,
  maxRetries: number,
): Promise<Refusal> {
  if (PUSH_BACK.has(response.status)) {
    await discardBody(response);
    const asked = parseRetryAfter(response.headers.get("retry-after"));

    if (asked !== null && asked > LONGEST_WAIT_MS) {
      return {
        kind: "refused",
        pushBack: true,
        error: rateLimited(
          `BBC Good Food asked this client to wait ${Math.round(asked / 1000)} seconds (HTTP ${response.status}).`,
          { url, status: response.status },
        ),
      };
    }
    if (attempt >= maxRetries) {
      return {
        kind: "refused",
        pushBack: true,
        error: rateLimited(
          `BBC Good Food asked this client to slow down (HTTP ${response.status}).`,
          { url, status: response.status },
        ),
      };
    }
    return { kind: "again", pushBack: true, waitMs: asked ?? backoffMs(attempt) };
  }

  if (RETRYABLE.has(response.status) && attempt < maxRetries) {
    await discardBody(response);
    return { kind: "again", pushBack: false, waitMs: backoffMs(attempt) };
  }

  if (response.status === 400 || response.status === 422) {
    await discardBody(response);
    return {
      kind: "refused",
      pushBack: false,
      error: invalidInput(
        "BBC Good Food would not accept this request.",
        "Check the arguments: a term carrying an unencoded character is refused rather than answered.",
      ),
    };
  }

  if (response.status === 404 || response.status === 410) {
    await discardBody(response);
    return {
      kind: "refused",
      pushBack: false,
      error: notFound("BBC Good Food holds nothing at this address.", {
        url,
        status: response.status,
      }),
    };
  }

  await discardBody(response);
  return {
    kind: "refused",
    pushBack: false,
    error: networkError(`BBC Good Food answered HTTP ${response.status}.`, {
      url,
      status: response.status,
    }),
  };
}

/**
 * What a thrown attempt amounts to, or the error it has become.
 *
 * An error this module raised on purpose already says what happened. Silence is
 * given fewer attempts than a refusal, since asking again costs both sides the
 * same wait.
 */
function readFailure(
  error: unknown,
  attempts: { url: string; attempt: number; maxRetries: number; timeoutMs: number },
): Error {
  const { url, attempt, maxRetries, timeoutMs } = attempts;

  if (error instanceof Error && error.name === "GoodFoodError") {
    throw error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    if (attempt >= Math.min(maxRetries, RETRIES_AFTER_SILENCE)) {
      throw timeoutError(`No answer from BBC Good Food within ${timeoutMs}ms.`, { url });
    }
    return error;
  }

  const failure = error instanceof Error ? error : new Error(String(error));
  if (attempt >= maxRetries) {
    throw networkError(`Could not reach BBC Good Food: ${failure.message}`, { url });
  }
  return failure;
}

/**
 * A deadline that rejects on its own, beside the abort signal it also raises.
 *
 * Aborting only ends a request that listens for it. This layer accepts a fetch
 * from its caller, and one that ignores the signal would leave the read pending
 * with nothing to end it. Since the limiter serialises every request through one
 * queue, that single call would hold every tool behind it for the life of the
 * process. Racing the deadline is what makes the timeout the server's own
 * promise rather than the transport's.
 */
function startDeadline(
  timeoutMs: number,
  controller: AbortController,
): { expired: Promise<never>; clear: () => void } {
  // Declared without a value: the executor assigns it before the promise is
  // handed back, and an initialiser here would be a line no state reaches.
  let expire!: (reason: Error) => void;
  const expired = new Promise<never>((_resolve, reject) => {
    expire = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    // Named as an abort so the one reader of failures treats a deadline the
    // same way whether the transport raised it or this timer did.
    const reason = new Error(`no answer within ${timeoutMs}ms`);
    reason.name = "AbortError";
    expire(reason);
  }, timeoutMs);
  return { expired, clear: () => clearTimeout(timer) };
}

/** Growing wait with jitter, so several clients do not return in step. */
function backoffMs(attempt: number): number {
  const base = Math.min(8000, 400 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

export async function fetchText(options: FetchOptions): Promise<string> {
  const { url, userAgent, timeoutMs, maxRetries, limiter, logger } = options;
  const doFetch = options.fetchImpl ?? fetch;

  let lastError: Error | null = null;
  /** Honoured before the next attempt rather than slept after the last one. */
  let askedWaitMs = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (askedWaitMs > 0) {
      logger.debug(`waiting ${askedWaitMs}ms, as asked`);
      // Read once into a constant: the timer closes over what this attempt was
      // told to wait, rather than over whatever a later attempt puts there.
      const asked = askedWaitMs;
      await new Promise((resolve) => setTimeout(resolve, asked));
      askedWaitMs = 0;
    }
    await limiter.beforeRequest();

    const controller = new AbortController();
    const deadline = startDeadline(timeoutMs, controller);

    try {
      logger.debug(`GET ${url}`);
      const response = await Promise.race([
        doFetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "user-agent": userAgent, accept: "application/json" },
        }),
        deadline.expired,
      ]);

      if (response.ok) {
        limiter.succeeded();
        return await response.text();
      }

      const verdict = await readRefusal(response, url, attempt, maxRetries);
      if (verdict.pushBack) {
        limiter.pushBack();
      }
      if (verdict.kind === "refused") {
        throw verdict.error;
      }
      askedWaitMs = verdict.waitMs;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      deadline.clear();

      lastError = readFailure(error, { url, attempt, maxRetries, timeoutMs });
      askedWaitMs = backoffMs(attempt);
    } finally {
      deadline.clear();
    }
  }

  /* v8 ignore next 4 -- The loop leaves by returning or by raising, and its last
     turn can only raise, so this is the exit the compiler requires and no state
     reaches. */
  throw networkError(`Could not reach BBC Good Food: ${lastError?.message ?? "unknown"}`, { url });
}

/** Fetch and parse JSON, keeping the two failures apart. */
export async function fetchJson<T = unknown>(options: FetchOptions): Promise<T> {
  const body = await fetchText(options);
  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    throw parseFailure("BBC Good Food answered with something that is not JSON.", {
      url: options.url,
      cause,
    });
  }
}
