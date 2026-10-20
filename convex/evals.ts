import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fail, isActive, requireExtractor, schemaFields } from "./helpers";
import { queueRun } from "./runs";
import { compareOutputs, type ComparisonSummary, type FieldStatus } from "../src/lib/compare";
import type { FieldSpec } from "../src/lib/fields";
import { diffChecks, previousCheck } from "../src/lib/check-diff";
import { checkRules, issuesByPath } from "../src/lib/rules";

/** Space out runs so a large check doesn't trip provider rate limits. */
const STAGGER_MS = 350;

async function documentsWithAnswers(ctx: QueryCtx, extractorId: Id<"extractors">) {
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
    .collect();
  return documents.filter((d) => d.origin !== "api" && d.expected !== undefined);
}

async function startCheck(
  ctx: MutationCtx,
  args: {
    extractorId: Id<"extractors">;
    promptVersionId: Id<"promptVersions">;
    schemaVersionId: Id<"schemaVersions">;
    model: string;
    documents: Doc<"documents">[];
    createdAt: number;
  },
) {
  const evalId = await ctx.db.insert("evals", {
    extractorId: args.extractorId,
    promptVersionId: args.promptVersionId,
    schemaVersionId: args.schemaVersionId,
    model: args.model,
    documentIds: args.documents.map((d) => d._id),
    trigger: "manual",
    createdAt: args.createdAt,
  });
  for (const [docIndex, document] of args.documents.entries()) {
    await queueRun(ctx, {
      document,
      promptVersionId: args.promptVersionId,
      schemaVersionId: args.schemaVersionId,
      model: args.model,
      source: "eval",
      evalId,
      delayMs: docIndex * STAGGER_MS,
    });
  }
  return evalId;
}

export const create = mutation({
  args: {
    extractorId: v.id("extractors"),
    promptVersionId: v.id("promptVersions"),
    schemaVersionId: v.id("schemaVersions"),
    models: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.extractorId);
    if (args.models.length === 0) fail("Pick at least one model.");
    const [prompt, schema] = await Promise.all([ctx.db.get(args.promptVersionId), ctx.db.get(args.schemaVersionId)]);
    if (!prompt || prompt.extractorId !== args.extractorId) fail("Prompt version not found.");
    if (!schema || schema.extractorId !== args.extractorId) fail("Schema version not found.");

    const documents = await documentsWithAnswers(ctx, args.extractorId);
    if (documents.length === 0) fail("Save the correct answer for at least one document first.");

    const evalIds: Id<"evals">[] = [];
    for (const [modelIndex, model] of args.models.entries()) {
      evalIds.push(
        await startCheck(ctx, {
          ...args,
          model,
          documents,
          createdAt: Date.now() + modelIndex,
        }),
      );
    }
    return evalIds;
  },
});

type DocResult = {
  documentId: Id<"documents">;
  title: string;
  run: Doc<"runs"> | null;
  accuracy: number | null;
  matched: number;
  total: number;
  importantMatched: number;
  importantTotal: number;
  fields: Array<{
    path: string;
    shape: string;
    spec: FieldSpec;
    status: FieldStatus;
    important: boolean;
    expected: unknown;
    actual: unknown;
    ruleIssues?: string[];
  }>;
  /** Fields of this extraction that break a field rule. */
  ruleFailures: number;
};

async function evaluate(ctx: QueryCtx, evalDoc: Doc<"evals">) {
  const [runs, prompt, schema] = await Promise.all([
    ctx.db
      .query("runs")
      .withIndex("by_eval", (q) => q.eq("evalId", evalDoc._id))
      .collect(),
    ctx.db.get(evalDoc.promptVersionId),
    ctx.db.get(evalDoc.schemaVersionId),
  ]);
  const fields = schema ? schemaFields(schema) : [];
  const runByDoc = new Map(runs.map((run) => [run.documentId, run]));

  const docs: DocResult[] = [];
  for (const documentId of evalDoc.documentIds) {
    const document = await ctx.db.get(documentId);
    if (!document) continue;
    const run = runByDoc.get(documentId) ?? null;
    const finished = run && !isActive(run.status);
    let comparison: ComparisonSummary | null = null;
    if (finished && document.expected !== undefined) {
      comparison = compareOutputs(fields, document.expected, run.status === "success" ? run.output : null, document.expectedNotSure);
    }
    const ruleIssues = finished && run.status === "success" ? issuesByPath(checkRules(fields, run.output)) : {};
    const succeeded = comparison !== null && run!.status === "success";
    docs.push({
      documentId,
      title: document.title,
      run,
      accuracy: comparison ? (succeeded ? comparison.accuracy : 0) : null,
      matched: succeeded ? comparison!.matched : 0,
      total: comparison?.total ?? 0,
      importantMatched: succeeded ? comparison!.importantMatched : 0,
      importantTotal: comparison?.importantTotal ?? 0,
      fields: (comparison?.fields ?? []).map((f) => ({
        path: f.path,
        shape: f.shape,
        spec: f.spec,
        status: f.status,
        important: f.important,
        expected: f.expected,
        actual: f.actual,
        ruleIssues: ruleIssues[f.path],
      })),
      ruleFailures: Object.keys(ruleIssues).length,
    });
  }

  const finishedRuns = runs.filter((run) => !isActive(run.status));
  const scored = docs.filter((d) => d.accuracy !== null);
  const successful = runs.filter((run) => run.status === "success");
  const latencies = successful.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
  const matched = scored.reduce((s, d) => s + d.matched, 0);
  const total = scored.reduce((s, d) => s + d.total, 0);
  const importantMatched = scored.reduce((s, d) => s + d.importantMatched, 0);
  const importantTotal = scored.reduce((s, d) => s + d.importantTotal, 0);

  return {
    eval: evalDoc,
    promptVersion: prompt?.version ?? 0,
    schemaVersion: schema?.version ?? 0,
    fields,
    docs,
    summary: {
      total: evalDoc.documentIds.length,
      finished: finishedRuns.length,
      failed: runs.filter((r) => r.status === "failed").length,
      running: runs.length - finishedRuns.length,
      /** Share of all scored fields that match, across documents. */
      fieldAccuracy: total ? matched / total : null,
      matchedFields: matched,
      totalFields: total,
      /** Important fields only: matched, total, and their share (null when none are marked). */
      importantMatchedFields: importantMatched,
      importantTotalFields: importantTotal,
      importantAccuracy: importantTotal ? importantMatched / importantTotal : null,
      /** Documents where every important field matches. */
      importantPerfectDocs: scored.filter((d) => d.importantTotal > 0 && d.importantMatched === d.importantTotal).length,
      /** Share of documents where every field matches. */
      perfectDocs: scored.filter((d) => d.accuracy === 1).length,
      scoredDocs: scored.length,
      avgCostUsd: successful.length
        ? successful.reduce((s, r) => s + (r.costUsd ?? 0), 0) / successful.length
        : null,
      p50LatencyMs: latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null,
      /** Documents where at least one value breaks a field rule. */
      docsFailingRules: docs.filter((d) => d.ruleFailures > 0).length,
    },
  };
}

export const list = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const evals = await ctx.db
      .query("evals")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .order("desc")
      .take(50);
    const results = await Promise.all(evals.map((e) => evaluate(ctx, e)));
    return results.map(({ eval: e, promptVersion, schemaVersion, summary, docs }, index) => {
      // The same model's previous check, so each row can say what the change did.
      const previous = previousCheck(e, results.slice(index + 1).map((r) => r.eval));
      const previousResult = previous ? results.find((r) => r.eval._id === previous._id) : undefined;
      let change: { fixed: number; broke: number; promptVersion: number; schemaVersion: number } | null = null;
      if (previousResult && summary.running === 0 && previousResult.summary.running === 0) {
        const diff = diffChecks(toCheckDocs(docs), toCheckDocs(previousResult.docs));
        if (diff.compared > 0) {
          change = {
            fixed: diff.fixed.length,
            broke: diff.broke.length,
            promptVersion: previousResult.promptVersion,
            schemaVersion: previousResult.schemaVersion,
          };
        }
      }
      return {
        _id: e._id,
        model: e.model,
        trigger: e.trigger ?? "manual",
        createdAt: e.createdAt,
        promptVersionId: e.promptVersionId,
        schemaVersionId: e.schemaVersionId,
        promptVersion,
        schemaVersion,
        summary,
        change,
      };
    });
  },
});

function toCheckDocs(docs: DocResult[]) {
  return docs.map((d) => ({
    documentId: d.documentId as string,
    title: d.title,
    accuracy: d.accuracy,
    fields: d.fields.map((f) => ({ path: f.path, status: f.status })),
  }));
}

export const get = query({
  args: { id: v.id("evals") },
  handler: async (ctx, { id }) => {
    const evalDoc = await ctx.db.get(id);
    if (!evalDoc) return null;
    return await evaluate(ctx, evalDoc);
  },
});

export const testSet = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .collect();
    const tests = documents.filter((d) => d.origin !== "api");
    return { total: tests.length, withExpected: tests.filter((d) => d.expected !== undefined).length };
  },
});

export const remove = mutation({
  args: { id: v.id("evals") },
  handler: async (ctx, { id }) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_eval", (q) => q.eq("evalId", id))
      .collect();
    if (runs.some((r) => isActive(r.status))) fail("Wait for this check to finish.");
    for (const run of runs) await ctx.db.delete(run._id);
    await ctx.db.delete(id);
  },
});
