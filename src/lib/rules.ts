import { parseLooseNumber, toIsoDate } from "./compare";
import { flattenLeaves, isEmptyValue, type Field, type FieldSpec, type Leaf } from "./fields";

/**
 * Field rules: free, exact checks on extracted values that need no correct answer and no AI,
 * so they work on every document, in the playground and in production. A rule never changes a
 * value; it only flags it with a plain-language reason.
 *
 * Cross-field rules (`sumOf`, `notBefore`) refer to other fields by shape, e.g. "subtotal" or
 * "items[].price" (every item's price, summed).
 */
export type FieldRules = {
  /** Flag the field when it comes back empty. */
  required?: boolean;
  /** Text fields: a common format. */
  format?: "email" | "url" | "phone";
  /** Text fields: the whole value must match this regular expression. */
  pattern?: string;
  /** Number fields. */
  min?: number;
  max?: number;
  /** Date fields: can't be later than today. */
  notInFuture?: boolean;
  /** Number fields: must equal the sum of these fields (within rounding). */
  sumOf?: string[];
  /** Date fields: must be on or after this date field. */
  notBefore?: string;
};

export type RuleKind = keyof FieldRules;

export type RuleIssue = { path: string; rule: RuleKind; message: string };

export const FORMAT_LABELS: Record<NonNullable<FieldRules["format"]>, string> = {
  email: "Email address",
  url: "Web address",
  phone: "Phone number",
};

const FORMAT_TESTS: Record<NonNullable<FieldRules["format"]>, (value: string) => boolean> = {
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
  url: (v) => /^(https?:\/\/)?([\p{L}\p{N}-]+\.)+[\p{L}]{2,}(\/\S*)?$/u.test(v.trim()),
  phone: (v) => {
    const digits = v.replace(/\D/g, "");
    return /^[+\d\s().\-/]+$/.test(v.trim()) && digits.length >= 7 && digits.length <= 15;
  },
};

/** Allowed difference when comparing a total with the sum of its parts. */
function tolerance(expected: number) {
  return Math.max(0.011, Math.abs(expected) * 0.001);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseLooseNumber(value);
  return null;
}

function formatNumber(value: number) {
  return Number(value.toFixed(4)).toString();
}

function hasRules(spec: FieldSpec) {
  return Boolean(spec.rules && Object.values(spec.rules).some((v) => v !== undefined && v !== false));
}

/** Checks every rule in the schema against one extraction. `today` is YYYY-MM-DD (UTC by default). */
export function checkRules(fields: Field[], output: unknown, today = new Date().toISOString().slice(0, 10)): RuleIssue[] {
  const leaves = flattenLeaves(fields, output);
  if (!leaves.some((leaf) => hasRules(leaf.spec))) return [];
  const byShape = new Map<string, Leaf[]>();
  for (const leaf of leaves) byShape.set(leaf.shape, [...(byShape.get(leaf.shape) ?? []), leaf]);

  const issues: RuleIssue[] = [];
  for (const leaf of leaves) {
    const rules = leaf.spec.rules;
    if (!rules || !hasRules(leaf.spec)) continue;
    const push = (rule: RuleKind, message: string) => issues.push({ path: leaf.path, rule, message });

    if (isEmptyValue(leaf.value)) {
      if (rules.required) push("required", "Empty, but this field should always have a value.");
      continue;
    }

    if (typeof leaf.value === "string") {
      if (rules.format && !FORMAT_TESTS[rules.format](leaf.value)) {
        push("format", `Doesn't look like a valid ${FORMAT_LABELS[rules.format].toLowerCase()}.`);
      }
      if (rules.pattern) {
        const regex = safeRegex(rules.pattern);
        if (regex && !regex.test(leaf.value.trim())) push("pattern", `Doesn't match the expected pattern ${rules.pattern}.`);
      }
    }

    const number = leaf.spec.type === "number" || leaf.spec.type === "integer" ? asNumber(leaf.value) : null;
    if (number !== null) {
      if (rules.min !== undefined && number < rules.min) push("min", `${formatNumber(number)} is below the minimum of ${rules.min}.`);
      if (rules.max !== undefined && number > rules.max) push("max", `${formatNumber(number)} is above the maximum of ${rules.max}.`);
      if (rules.sumOf?.length) {
        const parts = rules.sumOf.flatMap((shape) => byShape.get(shape) ?? []).map((l) => asNumber(l.value));
        const present = parts.filter((p): p is number => p !== null);
        if (present.length > 0) {
          const sum = present.reduce((a, b) => a + b, 0);
          if (Math.abs(number - sum) > tolerance(sum)) {
            push("sumOf", `Should equal ${rules.sumOf.join(" + ")} = ${formatNumber(sum)}, but is ${formatNumber(number)}.`);
          }
        }
      }
    }

    if (leaf.spec.type === "date") {
      const date = toIsoDate(leaf.value);
      if (date) {
        if (rules.notInFuture && date > today) push("notInFuture", `${date} is in the future.`);
        if (rules.notBefore) {
          const other = (byShape.get(rules.notBefore) ?? []).map((l) => toIsoDate(l.value)).find(Boolean);
          if (other && date < other) push("notBefore", `${date} is before ${rules.notBefore} (${other}).`);
        }
      }
    }
  }
  return issues;
}

/** Issues grouped by field path, for showing next to each value. */
export function issuesByPath(issues: RuleIssue[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) (out[issue.path] ??= []).push(issue.message);
  return out;
}

function safeRegex(pattern: string) {
  try {
    return new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    return null;
  }
}

/** Mistakes in how rules are set up (bad pattern, a reference to a field that doesn't exist). */
export function ruleSetupProblems(fields: Field[]): string[] {
  const shapes = new Map(numberAndDateShapes(fields).map((s) => [s.shape, s.type]));
  const problems: string[] = [];
  const visit = (list: Field[], prefix: string) => {
    for (const field of list) {
      const shape = prefix ? `${prefix}.${field.key}` : field.key;
      const spec = field.type === "array" ? field.item ?? { type: "string" } : field;
      const rules = spec.rules;
      if (rules?.pattern && !safeRegex(rules.pattern)) problems.push(`${shape}: the pattern isn't a valid regular expression.`);
      if ((rules?.sumOf?.length || rules?.notBefore) && (shape.includes("[]") || field.type === "array")) {
        problems.push(`${shape}: rules that compare with other fields only work outside lists.`);
      }
      for (const ref of rules?.sumOf ?? []) {
        if (shapes.get(ref) !== "number") problems.push(`${shape}: "${ref}" isn't a number field to add up.`);
      }
      if (rules?.notBefore && shapes.get(rules.notBefore) !== "date") {
        problems.push(`${shape}: "${rules.notBefore}" isn't a date field.`);
      }
      if (rules?.min !== undefined && rules?.max !== undefined && rules.min > rules.max) {
        problems.push(`${shape}: the minimum is larger than the maximum.`);
      }
      if (field.type === "object") visit(field.fields ?? [], shape);
      if (field.type === "array" && field.item?.type === "object") visit(field.item.fields ?? [], `${shape}[]`);
    }
  };
  visit(fields, "");
  return problems;
}

/** Number and date fields by shape, to offer as references in cross-field rules. */
export function numberAndDateShapes(fields: Field[], prefix = ""): Array<{ shape: string; type: "number" | "date" }> {
  return fields.flatMap((field) => {
    const shape = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.type === "number" || field.type === "integer") return [{ shape, type: "number" as const }];
    if (field.type === "date") return [{ shape, type: "date" as const }];
    if (field.type === "object") return numberAndDateShapes(field.fields ?? [], shape);
    if (field.type === "array") {
      const item = field.item ?? { type: "string" };
      if (item.type === "object") return numberAndDateShapes(item.fields ?? [], `${shape}[]`);
      if (item.type === "number" || item.type === "integer") return [{ shape: `${shape}[]`, type: "number" as const }];
    }
    return [];
  });
}

/** Short descriptions of a field's rules, e.g. for a summary under the field name. */
export function describeRules(rules: FieldRules | undefined): string[] {
  if (!rules) return [];
  const out: string[] = [];
  if (rules.required) out.push("always filled");
  if (rules.format) out.push(FORMAT_LABELS[rules.format].toLowerCase());
  if (rules.pattern) out.push(`matches ${rules.pattern}`);
  if (rules.min !== undefined && rules.max !== undefined) out.push(`${rules.min} to ${rules.max}`);
  else if (rules.min !== undefined) out.push(`at least ${rules.min}`);
  else if (rules.max !== undefined) out.push(`at most ${rules.max}`);
  if (rules.notInFuture) out.push("not in the future");
  if (rules.sumOf?.length) out.push(`= ${rules.sumOf.join(" + ")}`);
  if (rules.notBefore) out.push(`on or after ${rules.notBefore}`);
  return out;
}
