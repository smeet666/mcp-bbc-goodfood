import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoodFoodError, invalidInput, notFound } from "../../src/errors.js";
import { ATTRIBUTION, MAX_TEXT_CHARS, ok, toToolError, truncate } from "../../src/tools/shared.js";

/**
 * No wait, no randomness lives in this module, but the clock is pinned all the
 * same so that nothing a helper touches can read the machine's own time.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function onlyText(result: { content: Array<{ type: "text"; text: string }> }): string {
  expect(result.content).toHaveLength(1);
  const block = result.content[0];
  if (block === undefined) {
    throw new Error("no text block");
  }
  expect(block.type).toBe("text");
  return block.text;
}

describe("truncate", () => {
  it("returns a text that fits untouched", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("returns a text of exactly the limit untouched", () => {
    const exact = "x".repeat(40);
    expect(truncate(exact, 40)).toBe(exact);
  });

  it("cuts a longer text to the limit and marks the cut", () => {
    const cut = truncate("y".repeat(500), 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("ok", () => {
  it("returns a single text block and the structured payload unchanged", () => {
    const structured = { total: 2, values: ["a", "b"] };
    const result = ok(structured, "the body");

    expect(result.structuredContent).toEqual(structured);
    expect(onlyText(result).startsWith("the body")).toBe(true);
  });

  it("ends on the attribution line when there is no note", () => {
    const text = onlyText(ok({ total: 0 }, "the body"));
    const lines = text.split("\n");

    expect(lines.at(-1)).toBe(ATTRIBUTION);
    expect(text).not.toContain("Note:");
  });

  it("writes one Note line per note, in order, then the attribution", () => {
    const text = onlyText(ok({ total: 0 }, "the body", { notes: ["first", "second"] }));
    const lines = text.split("\n");

    expect(lines.at(-3)).toBe("Note: first");
    expect(lines.at(-2)).toBe("Note: second");
    expect(lines.at(-1)).toBe(ATTRIBUTION);
  });

  it("keeps the whole trailer when the body has to be cut", () => {
    const structured = { total: 1 };
    const result = ok(structured, "z".repeat(MAX_TEXT_CHARS * 3), {
      notes: ["a first note", "a second note"],
    });
    const text = onlyText(result);
    const lines = text.split("\n");

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(lines.at(-3)).toBe("Note: a first note");
    expect(lines.at(-2)).toBe("Note: a second note");
    expect(lines.at(-1)).toBe(ATTRIBUTION);
    expect(text).toContain("…");
    // The structured payload keeps the text as it was published.
    expect(result.structuredContent).toEqual(structured);
  });

  it("indents a body line opening with Note:", () => {
    const result = ok({ body: "Note: from the site" }, "Note: from the site");

    expect(onlyText(result).startsWith(" Note: from the site")).toBe(true);
    expect(result.structuredContent).toEqual({ body: "Note: from the site" });
  });

  it("indents a body line opening with Source:", () => {
    const result = ok({ body: "Source: elsewhere" }, "Source: elsewhere");

    expect(onlyText(result).startsWith(" Source: elsewhere")).toBe(true);
    expect(result.structuredContent).toEqual({ body: "Source: elsewhere" });
  });

  it("indents such a line found in the middle of the body, not only at its head", () => {
    const body = "first line\nNote: forged\nmiddle\nSource: forged too\nlast line";
    const text = onlyText(ok({ body }, body));

    expect(text).toContain("\n Note: forged\n");
    expect(text).toContain("\n Source: forged too\n");
    expect(text).toContain("first line");
    expect(text).toContain("last line");
  });
});

describe("toToolError", () => {
  it("opens with the code and the message, and flags the result", () => {
    const result = toToolError(notFound("nothing there"));

    expect(result.isError).toBe(true);
    expect(onlyText(result).startsWith("[not_found] nothing there")).toBe(true);
  });

  it("carries no structured payload", () => {
    const result = toToolError(notFound("nothing there"));

    expect(result.structuredContent).toBeUndefined();
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
  });

  it("adds a Hint line when the error carries one", () => {
    const result = toToolError(invalidInput("bad facet", "try one of the published values"));
    const lines = onlyText(result).split("\n");

    expect(lines[0]).toBe("[invalid_input] bad facet");
    expect(lines).toContain("Hint: try one of the published values");
  });

  it("writes no Hint line when the error carries none", () => {
    const text = onlyText(toToolError(invalidInput("bad facet")));

    expect(text).toBe("[invalid_input] bad facet");
    expect(text).not.toContain("Hint:");
  });

  it("turns a value that is not a GoodFoodError into a network_error keeping its message", () => {
    const result = toToolError(new Error("socket closed"));

    expect(result.isError).toBe(true);
    expect(onlyText(result).startsWith("[network_error] socket closed")).toBe(true);
  });

  it("turns a value that is not even an Error into a network_error", () => {
    const result = toToolError("plain string trouble");

    expect(result.isError).toBe(true);
    expect(onlyText(result).startsWith("[network_error]")).toBe(true);
  });

  it("keeps a GoodFoodError apart from an ordinary Error", () => {
    expect(notFound("x")).toBeInstanceOf(GoodFoodError);
    expect(new Error("x")).not.toBeInstanceOf(GoodFoodError);
  });
});
