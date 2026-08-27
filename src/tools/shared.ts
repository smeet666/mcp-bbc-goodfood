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

/** Every run of blank space, including the ones that would open a line. */
const BLANKS = /\s+/g;

/**
 * A value the site wrote, brought onto one line.
 *
 * A recipe title or an ingredient may carry a line feed, and a line feed in the
 * middle of a value puts the rest of it at the start of a line of its own,
 * where it reads as a line this server wrote. The structured output still
 * carries the text exactly as the site published it.
 */
export function oneLine(text: string): string {
  return text.replace(BLANKS, " ").trim();
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
 *
 * The match is deliberately loose about everything except the word: leading
 * space, a tab, capitals and a space before the colon all read as the same line
 * to someone skimming an answer, so they are all neutralised. Nothing is
 * removed; a quoted line still carries every word it carried.
 */
const MARKER_LINE = /^[ \t]*(note|source|important|system|assistant|instruction|warning)[ \t]*:/gim;

function quoteMarkerLines(body: string): string {
  return body.replace(MARKER_LINE, (line) => `> ${line.trimStart()}`);
}

/**
 * The words a note counts with, so both halves of it agree.
 *
 * The noun follows how many lines there were and the verb follows how many were
 * lost, because "1 of the 2 lines does not fit" agrees on both counts at once.
 */
function agreeing(missing: number, total: number): { verb: string; noun: string } {
  return {
    verb: missing === 1 ? "does" : "do",
    noun: total === 1 ? "line" : "lines",
  };
}

/**
 * What a body says about itself once it no longer fits.
 *
 * A client that renders only the text block reads a cut list as the whole list
 * unless the answer says otherwise, so the count of what is missing is part of
 * the answer rather than a detail of its formatting.
 */
function noteForCut(body: string, notes: readonly string[]): string | null {
  if (body.length <= budgetFor(notes)) {
    return null;
  }
  const total = body.split("\n").length;
  const describe = (budget: number): string => {
    const missing = total - truncate(body, budget).split("\n").length;
    const said = agreeing(missing, total);
    // A body of one long line loses characters rather than lines, and saying
    // "1 of the 1 line" would describe a loss the reader cannot act on.
    return missing > 0
      ? `${missing} of the ${total} ${said.noun} ${said.verb} not fit in this block; the whole answer is in the structured output.`
      : "This block was cut short to fit; the whole answer is in the structured output.";
  };
  // The note takes room of its own, so it changes how much of the body fits and
  // therefore what it has to say. Reading it back once settles the count.
  return describe(budgetFor([...notes, describe(budgetFor(notes))]));
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
 *
 * Where the notes alone would fill the block, they are the part that gives way,
 * and the answer says so: a ceiling that is announced and not applied is worth
 * less than the announcement.
 */
export function ok(
  structured: Record<string, unknown>,
  body: string,
  options: { notes?: string[] } = {},
): ToolResult {
  const safe = quoteMarkerLines(body);
  const notes = [...(options.notes ?? [])];

  const first = noteForCut(safe, notes);
  if (first !== null) {
    notes.push(first);
  }

  const shortened = fitNotes(notes);
  const trailer = [...shortened.map((note) => `Note: ${note}`), ATTRIBUTION].join("\n");
  const budget = Math.max(0, MAX_TEXT_CHARS - trailer.length - 2);
  const text = `${truncate(safe, budget)}\n\n${trailer}`;

  return { content: [{ type: "text", text }], structuredContent: structured };
}

/** The room a body has once these notes and the credit have taken theirs. */
function budgetFor(notes: readonly string[]): number {
  const trailer = [...notes.map((note) => `Note: ${note}`), ATTRIBUTION].join("\n");
  return Math.max(0, MAX_TEXT_CHARS - trailer.length - 2);
}

/** Room kept for the body when the notes would otherwise take the whole block. */
const BODY_SHARE = 200;

/**
 * Notes cut down to what the block can hold, saying so when any were dropped.
 *
 * A note qualifies an answer, so dropping one silently would leave a reader
 * more confident than the answer deserves.
 */
function fitNotes(notes: readonly string[]): string[] {
  const room = MAX_TEXT_CHARS - ATTRIBUTION.length - BODY_SHARE;
  const cost = (note: string): number => note.length + "Note: \n".length;
  const spent = (lines: readonly string[]): number =>
    lines.reduce((sum, note) => sum + cost(note), 0);

  if (spent(notes) <= room) {
    return [...notes];
  }
  const kept = [...notes];
  for (;;) {
    kept.pop();
    const dropped = notes.length - kept.length;
    const last =
      dropped === 1
        ? "1 further note does not fit in this block."
        : `${dropped} further notes do not fit in this block.`;
    if (spent(kept) + cost(last) <= room || kept.length === 0) {
      return [...kept, last];
    }
  }
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
