import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { hasSchemaVersion } from "../src/extraction/schema-registry";
import { GOOGLE_PROVIDER, isSupportedGoogleModel } from "../src/extraction/models";

export const listByDocument = query({
  args: {
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    return runs.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByDocumentPage = query({
  args: {
    documentId: v.id("documents"),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    sort: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 20, 100));
    const requestedPage = Math.max(1, Math.floor(args.page ?? 1));
    const sort = args.sort ?? "desc";

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();

    const sorted = runs.sort((a, b) => {
      if (sort === "asc") return a.createdAt - b.createdAt;
      return b.createdAt - a.createdAt;
    });

    const total = sorted.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const start = (page - 1) * pageSize;
    const pageRuns = sorted.slice(start, start + pageSize);
    const items = await Promise.all(
      pageRuns.map(async (run) => {
        const prompt = await ctx.db.get(run.promptId);
        return {
          ...run,
          promptName: prompt?.name ?? "Prompt deleted",
        };
      }),
    );

    return {
      items,
      total,
      page,
      pageSize,
      pageCount,
      hasPrevPage: page > 1,
      hasNextPage: page < pageCount,
      sort,
    };
  },
});

export const listInProgress = query({
  args: {},
  handler: async (ctx) => {
    const queuedRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    const runningRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    const runs = [...queuedRuns, ...runningRuns];

    const enriched = await Promise.all(
      runs.map(async (run) => {
        const document = await ctx.db.get(run.documentId);
        return {
          ...run,
          documentFileName: document?.title ?? document?.fileName ?? "Unknown document",
        };
      }),
    );

    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getRunForExecution = query({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;

    const document = await ctx.db.get(run.documentId);
    if (!document) return null;

    return {
      run,
      document,
    };
  },
});

export const createAndQueue = mutation({
  args: {
    documentId: v.id("documents"),
    promptId: v.id("prompts"),
    schemaVersion: v.string(),
    provider: v.literal(GOOGLE_PROVIDER),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error("Document not found.");
    }

    const sourceType = document.sourceType ?? "file";
    if (sourceType === "file" && (!document.storageId || !document.mimeType)) {
      throw new Error("Document file is missing.");
    }
    if (sourceType === "text" && !document.textContent?.trim()) {
      throw new Error("Document text is missing.");
    }

    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) {
      throw new Error("Prompt not found.");
    }

    if (prompt.docTypeKey !== document.docTypeKey) {
      throw new Error("Prompt and document doc type do not match.");
    }

    if (!hasSchemaVersion(document.docTypeKey, args.schemaVersion)) {
      throw new Error(
        `Schema support missing in code registry for ${document.docTypeKey}:${args.schemaVersion}.`,
      );
    }

    const queuedRun = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first();
    const runningRun = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .first();

    if (queuedRun || runningRun) {
      throw new Error("An extraction is already in progress. Only one extraction can run at a time.");
    }

    const model = args.model.trim();

    if (!model) {
      throw new Error("Model is required.");
    }

    if (!isSupportedGoogleModel(model)) {
      throw new Error(`Unsupported Google model '${model}'. Add it to src/extraction/models.ts first.`);
    }

    const now = Date.now();

    const runId = await ctx.db.insert("runs", {
      documentId: args.documentId,
      docTypeKey: document.docTypeKey,
      promptId: args.promptId,
      promptSnapshot: prompt.text,
      schemaSnapshot: {
        docTypeKey: document.docTypeKey,
        schemaVersion: args.schemaVersion,
      },
      modelSnapshot: {
        provider: args.provider,
        model,
      },
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, api.runExecution.execute, { runId });

    return runId;
  },
});

export const markRunning = mutation({
  args: {
    runId: v.id("runs"),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    await ctx.db.patch(args.runId, {
      status: "running",
      startedAt: args.startedAt,
      updatedAt: args.startedAt,
    });
  },
});

export const finalizeSuccess = mutation({
  args: {
    runId: v.id("runs"),
    finishedAt: v.number(),
    parsedOutput: v.any(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "success",
      parsedOutput: args.parsedOutput,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      latencyMs: args.latencyMs,
      finishedAt: args.finishedAt,
      updatedAt: args.finishedAt,
      errorMessage: undefined,
      validationErrors: undefined,
    });
  },
});

export const finalizeFailure = mutation({
  args: {
    runId: v.id("runs"),
    finishedAt: v.number(),
    errorMessage: v.string(),
    validationErrors: v.optional(v.array(v.string())),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "failed",
      errorMessage: args.errorMessage,
      validationErrors: args.validationErrors,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
      latencyMs: args.latencyMs,
      finishedAt: args.finishedAt,
      updatedAt: args.finishedAt,
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.id);
    if (!run) {
      throw new Error("Run not found.");
    }

    if (run.status === "queued" || run.status === "running") {
      throw new Error("Cannot delete a run that is in progress.");
    }

    await ctx.db.delete(args.id);
  },
});
