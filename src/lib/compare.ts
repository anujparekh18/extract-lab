import { type Field, type FieldSpec, isEmptyValue, isRecord } from "./fields";

export type FieldStatus = "match" | "mismatch" | "missing" | "unexpected";

export type FieldComparison = {
  path: string;
  shape: string;
  spec: FieldSpec;
  expected: unknown;
  actual: unknown;
  status: FieldStatus;
  /** Marked important, itself or through its group or list. */
  important: boolean;
};

export type ComparisonSummary = {
  total: number;
  matched: number;
  /** 0..1 */
  accuracy: number;
  /** The same counts for important fields only (0 when none are marked). */
  importantTotal: number;
  importantMatched: number;
  fields: FieldComparison[];
};

/**
 * Compares an output with the expected output, field by field.
 * Lists are compared by position, which matches how people review line items.
 * `notSure` lists paths (e.g. `items[1].price`) whose correct value isn't known; they aren't scored.
 */
export function compareOutputs(
  fields: Field[],
  expected: unknown,
  actual: unknown,
  notSure?: readonly string[],
): ComparisonSummary {
  const all: FieldComparison[] = [];
  compareObject(fields, expected, actual, "", "", false, all);
  const skip = new Set(notSure ?? []);
  const out = skip.size ? all.filter((f) => !skip.has(f.path)) : all;
  const matched = out.filter((f) => f.status === "match").length;
  const important = out.filter((f) => f.important);
  return {
    total: out.length,
    matched,
    accuracy: out.length ? matched / out.length : 1,
    importantTotal: important.length,
    importantMatched: important.filter((f) => f.status === "match").length,
    fields: out,
  };
}

function compareObject(
  fields: Field[],
  expected: unknown,
  actual: unknown,
  path: string,
  shape: string,
  important: boolean,
  out: FieldComparison[],
) {
  const e = isRecord(expected) ? expected : {};
  const a = isRecord(actual) ? actual : {};
  for (const field of fields) {
    const childPath = path ? `${path}.${field.key}` : field.key;
    const childShape = shape ? `${shape}.${field.key}` : field.key;
    compareSpec(field, e[field.key], a[field.key], childPath, childShape, important, out);
  }
}

function compareSpec(
  spec: FieldSpec,
  expected: unknown,
  actual: unknown,
  path: string,
  shape: string,
  inherited: boolean,
  out: FieldComparison[],
) {
  const important = inherited || Boolean(spec.important);
  if (spec.type === "object") {
    compareObject(spec.fields ?? [], expected, actual, path, shape, important, out);
    return;
  }
  if (spec.type === "array") {
    const e = Array.isArray(expected) ? expected : [];
    const a = Array.isArray(actual) ? actual : [];
    const itemSpec = spec.item ?? { type: "string" };
    if (e.length === 0 && a.length === 0) {
      out.push({ path, shape, spec, expected: [], actual: [], status: "match", important });
      return;
    }
    const length = Math.max(e.length, a.length);
    for (let i = 0; i < length; i++) {
      compareSpec(itemSpec, e[i] ?? null, a[i] ?? null, `${path}[${i}]`, `${shape}[]`, important, out);
    }
    return;
  }
  if (spec.match === "ignore") return;
  out.push({
    path,
    shape,
    spec,
    expected: expected ?? null,
    actual: actual ?? null,
    status: scalarStatus(spec, expected, actual),
    important,
  });
}

function scalarStatus(spec: FieldSpec, expected: unknown, actual: unknown): FieldStatus {
  const expectedEmpty = isEmptyValue(expected);
  const actualEmpty = isEmptyValue(actual);
  if (expectedEmpty && actualEmpty) return "match";
  if (actualEmpty) return "missing";
  if (expectedEmpty) return "unexpected";
  return valuesEqual(spec, expected, actual) ? "match" : "mismatch";
}

export function valuesEqual(spec: FieldSpec, expected: unknown, actual: unknown) {
  if (spec.type === "number" || spec.type === "integer") {
    const e = toNumber(expected);
    const a = toNumber(actual);
    // Half a cent, or one part per million for large values.
    if (e !== null && a !== null) return Math.abs(e - a) < Math.max(0.005, Math.abs(e) * 1e-6);
  }
  if (spec.type === "boolean") return String(expected).toLowerCase() === String(actual).toLowerCase();
  if (spec.type === "date") {
    const e = toIsoDate(expected);
    const a = toIsoDate(actual);
    if (e && a) return e === a;
  }
  if (spec.match === "loose") return tokenF1(expected, actual) >= 0.8;
  return normalizeText(expected) === normalizeText(actual);
}

/** Word-overlap F1, ignoring punctuation and order. Used for "loose" fields like addresses. */
function tokenF1(expected: unknown, actual: unknown) {
  const tokens = (value: unknown) => normalizeText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const e = tokens(expected);
  const a = tokens(actual);
  if (e.length === 0 || a.length === 0) return e.length === a.length ? 1 : 0;
  const counts = new Map<string, number>();
  for (const t of e) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of a) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      overlap++;
      counts.set(t, c - 1);
    }
  }
  const precision = overlap / a.length;
  const recall = overlap / e.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  return parseLooseNumber(value);
}

/**
 * Reads a number the way people write it: "1,234.50", "1.234,50", "1 234,50", "1,43,504.71",
 * "$12", "-5". When both separators appear, the last one is the decimal point; a lone comma is a
 * decimal point only when it isn't grouping thousands ("12,5" vs "1,250").
 */
export function parseLooseNumber(text: string): number | null {
  let cleaned = text.replace(/[^0-9.,\-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    cleaned = cleaned.split(grouping).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const groupsOfThree = /^-?\d{1,3}(,\d{2})*,\d{3}$/.test(cleaned);
    cleaned = groupsOfThree || cleaned.split(",").length > 2 ? cleaned.split(",").join("") : cleaned.replace(",", ".");
  } else if (cleaned.split(".").length > 2) {
    cleaned = cleaned.split(".").join("");
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return null;
}

export function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Short, single-line rendering of a leaf value for tables. */
export function formatLeafValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "[ ]" : JSON.stringify(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
