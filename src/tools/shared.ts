/** Rendering and error mapping shared by the tools. */

import { GoodFoodError } from "../errors.js";

/**
 * Many MCP clients render only the text block, so it has to answer on its own.
 * This ceiling is what keeps a long listing from arriving as a wall of text.
 */
export const MAX_TEXT_CHARS = 2200;

/** The name every answer credits, and the value the structured output carries. */
export const SOURCE_NAME = "BBC Good Food";
export const ATTRIBUTION = `Source: ${SOURCE_NAME}`;

export interface ToolResult {
  // The SDK's result type carries an index signature for protocol extensions.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Keep text from the site out of the shape this server's own lines take.
 *
 * The block ends with lines opening "Note:" and "Source:", and a caller has no
 * way to tell one of those from the same words inside a recipe the site titled.
 * A body line opening with one of those words is quoted, which survives a
 * reader trimming the line where a leading space would not. The structured
 * output still carries the text exactly as it was published.
 */
function quoteMarkerLines(body: string): string {
  return body.replace(/^(Note:|Source:)/gm, "> $1");
}

/**
 * Build a result whose text block ends with its notes and its credit.
 *
 * The body is truncated to fit around the trailer rather than the whole block
 * being cut afterwards. Appending the credit and then truncating loses exactly
 * the credit, which is the one line that must survive.
 *
 * The notes belong to the trailer for the same reason. They are what qualifies
 * an answer, saying that a list is an excerpt or that a total states a floor. A
 * client rendering only the text reads an unqualified answer without them.
 */
export function ok(
  structured: Record<string, unknown>,
  body: string,
  options: { notes?: string[] } = {},
): ToolResult {
  const trailer = [...(options.notes ?? []).map((note) => `Note: ${note}`), ATTRIBUTION].join("\n");
  const cut = "…";
  const budget = Math.max(0, MAX_TEXT_CHARS - trailer.length - 2);

  const safe = quoteMarkerLines(body);
  const text =
    safe.length <= budget
      ? `${safe}\n\n${trailer}`
      : `${truncate(safe, Math.max(0, budget - cut.length))}${cut}\n\n${trailer}`;

  return { content: [{ type: "text", text }], structuredContent: structured };
}

/**
 * Errors carry no structured payload: the SDK checks it against the tool's
 * declared output schema, and a failure does not fit that shape.
 */
export function toToolError(error: unknown): ToolResult {
  const known =
    error instanceof GoodFoodError
      ? error
      : new GoodFoodError("network_error", error instanceof Error ? error.message : String(error));

  const lines = [`[${known.code}] ${known.message}`];
  if (known.details.hint) {
    lines.push(`Hint: ${known.details.hint}`);
  }
  return { content: [{ type: "text", text: lines.join("\n") }], isError: true };
}
