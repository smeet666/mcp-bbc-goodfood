import { describe, expect, it } from "vitest";
import {
  GoodFoodError,
  invalidInput,
  networkError,
  notFound,
  parseFailure,
  rateLimited,
  timeout,
} from "../../src/errors.js";

describe("GoodFoodError", () => {
  it("is an Error named GoodFoodError", () => {
    const error = new GoodFoodError("not_found", "gone");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(GoodFoodError);
    expect(error.name).toBe("GoodFoodError");
    expect(error.message).toBe("gone");
    expect(error.code).toBe("not_found");
  });

  it("keeps the details it is given", () => {
    const error = new GoodFoodError("network_error", "boom", {
      url: "https://example.test/a",
      status: 500,
    });
    expect(error.details.url).toBe("https://example.test/a");
    expect(error.details.status).toBe(500);
  });

  it("attaches a supplied cause to the error itself", () => {
    const root = new Error("root");
    const error = new GoodFoodError("network_error", "boom", { cause: root });
    expect(error.cause).toBe(root);
    expect(error.details.cause).toBe(root);
  });

  it("carries no cause when none is supplied", () => {
    const error = new GoodFoodError("network_error", "boom");
    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect(error.cause).toBeUndefined();
  });
});

describe("factories", () => {
  it("each factory sets its own code", () => {
    expect(notFound("a").code).toBe("not_found");
    expect(invalidInput("a").code).toBe("invalid_input");
    expect(rateLimited("a").code).toBe("rate_limited");
    expect(parseFailure("a").code).toBe("parse_failure");
    expect(networkError("a").code).toBe("network_error");
    expect(timeout("a").code).toBe("timeout");
  });

  it("each factory keeps the message and the GoodFoodError shape", () => {
    for (const error of [
      notFound("m1"),
      invalidInput("m2"),
      rateLimited("m3"),
      parseFailure("m4"),
      networkError("m5"),
      timeout("m6"),
    ]) {
      expect(error).toBeInstanceOf(GoodFoodError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("GoodFoodError");
      expect(error.message).toMatch(/^m\d$/);
    }
  });

  it("carries a supplied cause through every details-taking factory", () => {
    const root = new Error("root");
    for (const factory of [notFound, rateLimited, parseFailure, networkError, timeout]) {
      const error = factory("m", { cause: root });
      expect(error.cause).toBe(root);
      expect(error.details.cause).toBe(root);
    }
  });

  it("carries no cause when the caller gives none", () => {
    for (const factory of [notFound, rateLimited, parseFailure, networkError, timeout]) {
      const error = factory("m", { url: "https://example.test/x" });
      expect(Object.hasOwn(error, "cause")).toBe(false);
      expect(error.details.url).toBe("https://example.test/x");
    }
  });

  it("notFound passes url and status through", () => {
    const error = notFound("missing", { url: "https://example.test/r", status: 404 });
    expect(error.details.url).toBe("https://example.test/r");
    expect(error.details.status).toBe(404);
  });

  it("invalidInput without a hint carries empty details", () => {
    const error = invalidInput("bad argument");
    expect(error.details).toEqual({});
  });

  it("invalidInput with a hint carries it", () => {
    const error = invalidInput("bad argument", "use one of the published values");
    expect(error.details.hint).toBe("use one of the published values");
  });

  it("rateLimited carries a default hint about existence", () => {
    const error = rateLimited("too fast");
    expect(typeof error.details.hint).toBe("string");
    expect(error.details.hint).not.toBe("");
    // The hint has to say that being throttled tells nothing about whether what
    // was looked for exists.
    expect(error.details.hint).toMatch(/exist/i);
  });

  it("parseFailure carries a default hint pointing at the repository", () => {
    const error = parseFailure("unreadable page");
    expect(typeof error.details.hint).toBe("string");
    expect(error.details.hint).toMatch(/github\.com/i);
  });

  it("caller details replace the default hint of rateLimited", () => {
    const error = rateLimited("too fast", { hint: "wait a minute" });
    expect(error.details.hint).toBe("wait a minute");
  });

  it("caller details replace the default hint of parseFailure", () => {
    const error = parseFailure("unreadable page", { hint: "report the url" });
    expect(error.details.hint).toBe("report the url");
  });

  it("timeout and networkError take status and url", () => {
    expect(timeout("slow", { url: "https://example.test/t" }).details.url).toBe(
      "https://example.test/t",
    );
    expect(networkError("down", { status: 502 }).details.status).toBe(502);
  });
});
