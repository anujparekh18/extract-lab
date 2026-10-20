import type { FieldStatus } from "./compare";

/**
 * What changed between two checks of the same documents: answers that went from wrong to
 * right ("fixed") and from right to wrong ("broke"). Only documents scored in both count.
 */

export type CheckDoc = {
  documentId: string;
  title: string;
  /** null while the run is still going. */
  accuracy: number | null;
  fields: Array<{ path: string; status: FieldStatus }>;
};

export type FieldChange = { documentId: string; title: string; path: string };

export type CheckDiff = {
  fixed: FieldChange[];
  broke: FieldChange[];
  /** Documents scored in both checks. */
  compared: number;
};

export function diffChecks(current: CheckDoc[], previous: CheckDoc[]): CheckDiff {
  const before = new Map(previous.map((doc) => [doc.documentId, doc]));
  const fixed: FieldChange[] = [];
  const broke: FieldChange[] = [];
  let compared = 0;

  for (const doc of current) {
    const old = before.get(doc.documentId);
    if (!old || doc.accuracy === null || old.accuracy === null) continue;
    compared++;
    const oldStatus = new Map(old.fields.map((f) => [f.path, f.status]));
    for (const field of doc.fields) {
      const was = oldStatus.get(field.path);
      if (was === undefined) continue;
      const right = field.status === "match";
      const wasRight = was === "match";
      if (right && !wasRight) fixed.push({ documentId: doc.documentId, title: doc.title, path: field.path });
      if (!right && wasRight) broke.push({ documentId: doc.documentId, title: doc.title, path: field.path });
    }
  }
  return { fixed, broke, compared };
}

/**
 * The check to compare with: the same model's most recent check of a different prompt or schema,
 * so "what did my change do" isn't answered by a re-run of the same version. `older` is newest first.
 */
export function previousCheck<T extends { model: string; promptVersionId: string; schemaVersionId: string }>(
  check: T,
  older: T[],
): T | null {
  const sameModel = older.filter((e) => e.model === check.model);
  return (
    sameModel.find((e) => e.promptVersionId !== check.promptVersionId || e.schemaVersionId !== check.schemaVersionId) ??
    sameModel[0] ??
    null
  );
}
