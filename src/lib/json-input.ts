/**
 * Turns pasted or uploaded text into a JSON value, forgiving the common ways JSON
 * gets mangled on its way into a document:
 *
 *   {"a": 1}                         plain JSON
 *   "{\"a\": 1}"                     JSON that was stringified twice
 *   Context:\n{...}\n\nAnalysis:\n{...}   labelled sections -> { Context: {...}, Analysis: {...} }
 */

export type JsonParseResult =
  | { ok: true; value: unknown; notes: string[] }
  | { ok: false; error: string };

const LABEL_LINE = /^[ \t]*([A-Za-z_][A-Za-z0-9_ .-]*?)[ \t]*:[ \t]*$/gm;

export function parseJsonInput(raw: string): JsonParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "The document is empty." };

  const direct = parseUnwrapped(text);
  if (direct.ok) return direct;

  const sections = parseLabelledSections(text);
  if (sections) return sections;

  return direct;
}

function parseUnwrapped(text: string): JsonParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: describeSyntaxError(text, error) };
  }
  const notes: string[] = [];
  // A JSON string whose contents are themselves JSON: unwrap (at most twice).
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    const inner = value.trim();
    if (!/^[[{"]/.test(inner)) break;
    try {
      value = JSON.parse(inner);
      notes.push("Unwrapped JSON that had been encoded as a string.");
    } catch {
      break;
    }
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "Expected a JSON object or array." };
  }
  return { ok: true, value, notes };
}

function parseLabelledSections(text: string): JsonParseResult | null {
  const matches = Array.from(text.matchAll(LABEL_LINE));
  if (matches.length === 0 || text.slice(0, matches[0].index).trim()) return null;

  const out: Record<string, unknown> = {};
  const notes = new Set<string>();
  for (const [i, match] of matches.entries()) {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[i + 1]?.index ?? text.length;
    const body = text.slice(start, end).trim();
    const parsed = parseUnwrapped(body);
    if (!parsed.ok) return null;
    out[match[1].trim()] = parsed.value;
    parsed.notes.forEach((n) => notes.add(n));
  }
  notes.add(`Combined ${matches.length} labelled sections into one object.`);
  return { ok: true, value: out, notes: Array.from(notes) };
}

function describeSyntaxError(text: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Invalid JSON.";
  const position = Number(message.match(/position (\d+)/)?.[1]);
  if (!Number.isFinite(position)) return message;
  const before = text.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return `Invalid JSON at line ${line}, column ${column}.`;
}

/** Cheap check for "should we offer to treat this as JSON?" */
export function looksLikeJson(raw: string) {
  const text = raw.trimStart();
  return /^[[{"]/.test(text) || /^[A-Za-z_][\w .-]*:\s*\n\s*[[{"]/.test(text);
}

export function compactJson(value: unknown) {
  return JSON.stringify(value);
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}
