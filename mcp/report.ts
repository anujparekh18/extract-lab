import type { FunctionReturnType } from "convex/server";
import type { api } from "../convex/_generated/api";
import { compareOutputs } from "../src/lib/compare";
import { fieldsToZod, isNullable, isRecord, type Field, type FieldSpec } from "../src/lib/fields";

/**
 * Turns Extract Lab's results into compact reports for an agent: scores, and only the fields
 * that went wrong, so a long check fits in a tool result and points straight at what to fix.
 */

type Check = NonNullable<FunctionReturnType<typeof api.evals.get>>;

/** Rounds money and shares so reports stay readable. */
function round(value: number | null | undefined, digits = 4) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

export function checkReport(check: Check, { allFields = false }: { allFields?: boolean } = {}) {
  const { summary } = check;

  // Which fields go wrong most often, across documents: the first place to look when improving a prompt.
  // Grouped by shape, so `items[0].price` and `items[3].price` count as one field.
  const byField = new Map<string, { wrong: number; total: number; important: boolean }>();
  for (const doc of check.docs) {
    for (const field of doc.fields) {
      const stat = byField.get(field.shape) ?? { wrong: 0, total: 0, important: field.important };
      stat.total++;
      if (field.status !== "match") stat.wrong++;
      byField.set(field.shape, stat);
    }
  }
  const weakestFields = [...byField.entries()]
    .filter(([, s]) => s.wrong > 0)
    .sort((a, b) => Number(b[1].important) - Number(a[1].important) || b[1].wrong - a[1].wrong)
    .map(([field, s]) => ({ field, ...(s.important ? { important: true } : {}), wrong: s.wrong, of: s.total }));

  const documents = check.docs
    .filter((doc) => allFields || doc.accuracy !== 1 || doc.ruleFailures > 0)
    .map((doc) => ({
      documentId: doc.documentId,
      title: doc.title,
      status: doc.run?.status ?? "not run",
      error: doc.run?.status === "failed" ? doc.run.error : undefined,
      correct: `${doc.matched}/${doc.total}`,
      fields: doc.fields
        .filter((f) => allFields || f.status !== "match" || f.ruleIssues?.length)
        .map((f) => ({
          path: f.path,
          ...(f.important ? { important: true } : {}),
          status: f.status,
          correctAnswer: f.expected,
          modelAnswer: f.actual,
          ...(f.ruleIssues?.length ? { checksFailed: f.ruleIssues } : {}),
        })),
    }));

  return {
    checkId: check.eval._id,
    model: check.eval.model,
    promptVersion: check.promptVersion,
    schemaVersion: check.schemaVersion,
    running: summary.running,
    documents: summary.total,
    failedRuns: summary.failed,
    ...(summary.importantTotalFields
      ? {
          importantFieldsCorrect: `${summary.importantMatchedFields}/${summary.importantTotalFields}`,
          documentsWithImportantFieldsRight: `${summary.importantPerfectDocs}/${summary.scoredDocs}`,
        }
      : {}),
    fieldsCorrect: `${summary.matchedFields}/${summary.totalFields}`,
    fieldAccuracy: round(summary.fieldAccuracy),
    perfectDocuments: `${summary.perfectDocs}/${summary.scoredDocs}`,
    documentsFailingChecks: summary.docsFailingRules,
    avgCostUsd: round(summary.avgCostUsd, 6),
    medianLatencyMs: summary.p50LatencyMs,
    weakestFields,
    ...(allFields ? { documentResults: documents } : { documentsWithProblems: documents }),
  };
}

/** Fields of one extraction that differ from the correct answer. */
export function wrongFields(fields: Field[], expected: unknown, output: unknown, notSure?: readonly string[]) {
  const comparison = compareOutputs(fields, expected, output, notSure);
  return {
    correct: `${comparison.matched}/${comparison.total}`,
    ...(comparison.importantTotal ? { importantCorrect: `${comparison.importantMatched}/${comparison.importantTotal}` } : {}),
    wrong: comparison.fields
      .filter((f) => f.status !== "match")
      .map((f) => ({
        path: f.path,
        ...(f.important ? { important: true } : {}),
        status: f.status,
        correctAnswer: f.expected,
        modelAnswer: f.actual,
      })),
  };
}

/**
 * Fills keys a correct answer leaves out with empty values (null, or [] for lists), the way the
 * app's editor starts a blank answer. Spreadsheets usually just leave empty values out.
 */
export function completeAnswer(fields: Field[], answer: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...answer };
  for (const field of fields) out[field.key] = completeValue(field, answer[field.key]);
  return out;
}

function completeValue(spec: FieldSpec, value: unknown): unknown {
  if (spec.type === "object") {
    if (isRecord(value)) return completeAnswer(spec.fields ?? [], value);
    return value === undefined && !isNullable(spec) ? completeAnswer(spec.fields ?? [], {}) : (value ?? null);
  }
  if (spec.type === "array") {
    if (!Array.isArray(value)) return value ?? [];
    return value.map((item) => completeValue(spec.item ?? { type: "string" }, item));
  }
  return value === undefined ? null : value;
}

/**
 * Problems with a correct answer before it's saved: keys the extractor doesn't have, and values
 * of the wrong type. An answer that doesn't fit the fields would quietly count as wrong forever.
 */
export function answerProblems(fields: Field[], answer: unknown): string[] {
  if (!isRecord(answer)) return ["The correct answer must be a JSON object with one key per field."];
  const problems: string[] = [];
  unknownKeys(fields, answer, "", problems);
  const parsed = fieldsToZod(fields).safeParse(completeAnswer(fields, answer));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }
  return problems;
}

function unknownKeys(fields: Field[], value: Record<string, unknown>, prefix: string, problems: string[]) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const spec = byKey.get(key);
    if (!spec) problems.push(`"${path}" isn't a field of this extractor.`);
    else checkNested(spec, child, path, problems);
  }
}

function checkNested(spec: FieldSpec, value: unknown, path: string, problems: string[]) {
  if (spec.type === "object" && isRecord(value)) unknownKeys(spec.fields ?? [], value, path, problems);
  if (spec.type === "array" && Array.isArray(value)) {
    value.forEach((item, i) => checkNested(spec.item ?? { type: "string" }, item, `${path}[${i}]`, problems));
  }
}
