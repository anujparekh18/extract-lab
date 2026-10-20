import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { fail, isActive, requireDocument, savePromptVersion, saveSchemaVersion, schemaFields } from "./helpers";
import { parseModelId } from "../src/lib/models";
import { compareOutputs } from "../src/lib/compare";
import type { Field } from "../src/lib/fields";

export async function queueRun(
  ctx: MutationCtx,
  args: {
    document: Doc<"documents">;
    promptVersionId: Id<"promptVersions">;
    schemaVersionId: Id<"schemaVersions">;
    model: string;
    source: Doc<"runs">["source"];
    evalId?: Id<"evals">;
    release?: number;
    idempotencyKey?: string;
    delayMs?: number;
  },
) {
  if (!parseModelId(args.model)) fail(`Unknown model "${args.model}".`);
  const runId = await ctx.db.insert("runs", {
    extractorId: args.document.extractorId,
    documentId: args.document._id,
    promptVersionId: args.promptVersionId,
    schemaVersionId: args.schemaVersionId,
    model: args.model,
    source: args.source,
    evalId: args.evalId,
    release: args.release,
    idempotencyKey: args.idempotencyKey,
    status: "queued",
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(args.delayMs ?? 0, internal.execution.run, { runId });
  return runId;
}

/** Runs a prompt and schema on one document, from the playground or a coding agent. Unchanged prompt/schema reuse their existing version. */
export const start = mutation({
  args: {
    documentId: v.id("documents"),
    prompt: v.string(),
    fields: v.any(),
    model: v.string(),
    /** "agent" for runs started through the MCP server. */
    source: v.optional(v.union(v.literal("playground"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const document = await requireDocument(ctx, args.documentId);
    const promptVersionId = await savePromptVersion(ctx, document.extractorId, args.prompt);
    const schemaVersionId = await saveSchemaVersion(ctx, document.extractorId, args.fields as Field[]);
    const runId = await queueRun(ctx, {
      document,
      promptVersionId,
      schemaVersionId,
      model: args.model,
      source: args.source ?? "playground",
    });
    await ctx.db.patch(document.extractorId, { defaultModel: args.model, updatedAt: Date.now() });
    return runId;
  },
});

export const listByDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const document = await ctx.db.get(documentId);
    if (!document) return [];
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_document", (q) => q.eq("documentId", documentId))
      .order("desc")
      .take(50);

    const promptVersions = new Map<string, number>();
    const schemaCache = new Map<string, Doc<"schemaVersions"> | null>();
    return await Promise.all(
      runs.map(async (run) => {
        if (!promptVersions.has(run.promptVersionId)) {
          promptVersions.set(run.promptVersionId, (await ctx.db.get(run.promptVersionId))?.version ?? 0);
        }
        if (!schemaCache.has(run.schemaVersionId)) {
          schemaCache.set(run.schemaVersionId, await ctx.db.get(run.schemaVersionId));
        }
        const schema = schemaCache.get(run.schemaVersionId);
        const score =
          document.expected !== undefined && run.status === "success" && schema
            ? compareOutputs(schemaFields(schema), document.expected, run.output, document.expectedNotSure)
            : null;
        return {
          ...run,
          promptVersion: promptVersions.get(run.promptVersionId) ?? 0,
          schemaVersion: schema?.version ?? 0,
          score: score ? { accuracy: score.accuracy, matched: score.matched, total: score.total } : null,
        };
      }),
    );
  },
});

/** How many runs the Runs tab loads at once. */
const RUN_HISTORY_LIMIT = 300;

/**
 * Every run of an extractor (or of one document), newest first, for the Runs tab: what ran,
 * with which versions, and how it scores against the document's current correct answer.
 */
export const listByExtractor = query({
  args: { extractorId: v.id("extractors"), documentId: v.optional(v.id("documents")) },
  handler: async (ctx, { extractorId, documentId }) => {
    const runs = documentId
      ? await ctx.db
          .query("runs")
          .withIndex("by_document", (q) => q.eq("documentId", documentId))
          .order("desc")
          .take(RUN_HISTORY_LIMIT)
      : await ctx.db
          .query("runs")
          .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
          .order("desc")
          .take(RUN_HISTORY_LIMIT);

    const documents = new Map<string, Doc<"documents"> | null>();
    const prompts = new Map<string, number>();
    const schemas = new Map<string, Doc<"schemaVersions"> | null>();
    for (const run of runs) {
      if (!documents.has(run.documentId)) documents.set(run.documentId, await ctx.db.get(run.documentId));
      if (!prompts.has(run.promptVersionId)) prompts.set(run.promptVersionId, (await ctx.db.get(run.promptVersionId))?.version ?? 0);
      if (!schemas.has(run.schemaVersionId)) schemas.set(run.schemaVersionId, await ctx.db.get(run.schemaVersionId));
    }
    const rows = runs.map((run) => {
      const document = documents.get(run.documentId);
      const schema = schemas.get(run.schemaVersionId);
      const score =
        document?.expected !== undefined && run.status === "success" && schema
          ? compareOutputs(schemaFields(schema), document.expected, run.output, document.expectedNotSure)
          : null;
      return {
        _id: run._id,
        documentId: run.documentId,
        documentTitle: document?.title ?? (run.purgedAt ? "API document (deleted after retention)" : "Deleted document"),
        model: run.model,
        source: run.source,
        evalId: run.evalId,
        status: run.status,
        error: run.error,
        costUsd: run.costUsd ?? 0,
        latencyMs: run.latencyMs,
        createdAt: run.createdAt,
        release: run.release,
        purged: Boolean(run.purgedAt),
        promptVersion: prompts.get(run.promptVersionId) ?? 0,
        schemaVersion: schema?.version ?? 0,
        score: score
          ? {
              matched: score.matched,
              total: score.total,
              importantMatched: score.importantMatched,
              importantTotal: score.importantTotal,
            }
          : null,
      };
    });
    return { rows, limited: runs.length === RUN_HISTORY_LIMIT };
  },
});

export const get = query({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) return null;
    const [prompt, schema] = await Promise.all([ctx.db.get(run.promptVersionId), ctx.db.get(run.schemaVersionId)]);
    return {
      ...run,
      prompt: prompt ? { version: prompt.version, text: prompt.text } : null,
      schema: schema ? { version: schema.version, fields: schemaFields(schema) } : null,
    };
  },
});

export const activeCount = query({
  args: {},
  handler: async (ctx) => {
    const [queued, running] = await Promise.all([
      ctx.db.query("runs").withIndex("by_status", (q) => q.eq("status", "queued")).collect(),
      ctx.db.query("runs").withIndex("by_status", (q) => q.eq("status", "running")).collect(),
    ]);
    return queued.length + running.length;
  },
});

export const remove = mutation({
  args: { id: v.id("runs") },
  handler: async (ctx, { id }) => {
    const run = await ctx.db.get(id);
    if (!run) return;
    if (isActive(run.status)) fail("Wait for this run to finish.");
    await ctx.db.delete(id);
  },
});

// ---------------------------------------------------------------------------
// Internal: used by the execution action
// ---------------------------------------------------------------------------

export const getForExecution = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return null;
    const [document, prompt, schema] = await Promise.all([
      ctx.db.get(run.documentId),
      ctx.db.get(run.promptVersionId),
      ctx.db.get(run.schemaVersionId),
    ]);
    if (!document || !prompt || !schema) return null;
    return { run, document, prompt: prompt.text, fields: schemaFields(schema) };
  },
});

export const markRunning = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "queued") return false;
    await ctx.db.patch(runId, { status: "running", startedAt: Date.now() });
    return true;
  },
});

export const finish = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(v.literal("success"), v.literal("failed")),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    validationErrors: v.optional(v.array(v.string())),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, { runId, ...patch }) => {
    if (!(await ctx.db.get(runId))) return;
    await ctx.db.patch(runId, { ...patch, finishedAt: Date.now() });
  },
});

