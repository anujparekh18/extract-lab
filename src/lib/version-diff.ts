import { stableStringify, type Field, type FieldSpec } from "./fields";

export type LineChange = { kind: "same" | "added" | "removed"; text: string };

/** Line-by-line diff of two texts (longest common subsequence). Prompts are short, so the simple way is fine. */
export function diffLines(before: string, after: string): LineChange[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lengths[i][j] = longest common subsequence of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out: LineChange[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}

export type FieldChange =
  | { kind: "added"; path: string; spec: FieldSpec }
  | { kind: "removed"; path: string; spec: FieldSpec }
  | { kind: "changed"; path: string; changes: string[] };

/** Which fields a schema change added, removed, or changed, and what changed about each. */
export function diffFields(before: Field[], after: Field[]): FieldChange[] {
  const a = flattenSpecs(before);
  const b = flattenSpecs(after);
  const out: FieldChange[] = [];
  for (const [path, spec] of b) {
    const old = a.get(path);
    if (!old) out.push({ kind: "added", path, spec });
    else {
      const changes = describeChanges(old, spec);
      if (changes.length) out.push({ kind: "changed", path, changes });
    }
  }
  for (const [path, spec] of a) if (!b.has(path)) out.push({ kind: "removed", path, spec });
  return out;
}

/** Every field with its path; list items are written `items[]`. */
function flattenSpecs(fields: Field[], prefix = "", out = new Map<string, FieldSpec>()) {
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key}` : field.key;
    out.set(path, field);
    if (field.type === "object") flattenSpecs(field.fields ?? [], path, out);
    if (field.type === "array" && field.item) {
      out.set(`${path}[]`, field.item);
      if (field.item.type === "object") flattenSpecs(field.item.fields ?? [], `${path}[]`, out);
    }
  }
  return out;
}

function describeChanges(a: FieldSpec, b: FieldSpec): string[] {
  const changes: string[] = [];
  if (a.type !== b.type) changes.push(`type ${a.type} → ${b.type}`);
  if ((a.description ?? "") !== (b.description ?? "")) changes.push("description");
  if (Boolean(a.important) !== Boolean(b.important)) changes.push(b.important ? "marked important" : "no longer important");
  if ((a.nullable ?? null) !== (b.nullable ?? null)) changes.push("can be empty");
  if ((a.match ?? "exact") !== (b.match ?? "exact")) changes.push(`compared ${a.match ?? "exact"} → ${b.match ?? "exact"}`);
  if (stableStringify(a.enumValues ?? []) !== stableStringify(b.enumValues ?? [])) changes.push("allowed values");
  if (stableStringify(a.rules ?? null) !== stableStringify(b.rules ?? null)) changes.push("field checks");
  return changes;
}
