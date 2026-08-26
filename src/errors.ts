/**
 * One error type, carrying a code the caller can branch on.
 *
 * The distinction that matters most is between "the site holds no such thing"
 * and "the question could not be asked". Collapsing the two lets a model report
 * an absence it never established, which is a false statement about the world
 * rather than a missing feature.
 */

import { REPO_URL } from "./version.js";

export type ErrorCode =
  /** The site answered, and there is no such recipe or page. */
  | "not_found"
  /** The arguments cannot produce a request, or the site refused them. */
  | "invalid_input"
  /** The site asked this client to slow down. */
  | "rate_limited"
  /** A response arrived in a shape this server cannot read. */
  | "parse_failure"
  /** The request could not be completed. */
  | "network_error"
  /** The request was abandoned before an answer arrived. */
  | "timeout";

export interface ErrorDetails {
  /** What the caller can do about it, when there is something. */
  hint?: string;
  /** The address that produced the failure, for a bug report. */
  url?: string;
  status?: number;
  /** What was raised underneath, kept for the bug report the hint asks for. */
  cause?: unknown;
}

export class GoodFoodError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "GoodFoodError";
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message: string, details?: ErrorDetails): GoodFoodError =>
  new GoodFoodError("not_found", message, details);

export const invalidInput = (message: string, hint?: string): GoodFoodError =>
  new GoodFoodError("invalid_input", message, hint ? { hint } : {});

export const rateLimited = (message: string, details?: ErrorDetails): GoodFoodError =>
  new GoodFoodError("rate_limited", message, {
    hint: "Wait a moment and ask again. This says nothing about whether the recipe exists.",
    ...details,
  });

export const parseFailure = (message: string, details?: ErrorDetails): GoodFoodError =>
  new GoodFoodError("parse_failure", message, {
    hint: `The site may have changed how it answers. Please report this at ${REPO_URL}/issues with the arguments you used.`,
    ...details,
  });

export const networkError = (message: string, details?: ErrorDetails): GoodFoodError =>
  new GoodFoodError("network_error", message, details);

export const timeout = (message: string, details?: ErrorDetails): GoodFoodError =>
  new GoodFoodError("timeout", message, details);
