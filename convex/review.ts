import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { fail, isActive, latestPromptVersion, latestSchemaVersion, requireExtractor } from "./helpers";
import { queueRun } from "./runs";

/** Space out runs so extracting a whole folder doesn't trip provider rate limits. */
const STAGGER_MS = 350;
/** Upper bound for one "extract all", so a slip of the finger can't queue thousands of calls. */
const MAX_BATCH = 200;

/**
 * Documents that still need a correct answer, newest first like the documents list, each with
 * its latest extraction. Reviewing them one after another is how a test set gets built.
 */
export const queue = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const documents = (
      await ctx.db
        .query("documents")
        .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
        .order("desc")
        .collect()
    ).filter((d) => d.origin !== "api");
    const [prompt, schema] = await Promise.all([latestPromptVersion(ctx, extractorId), latestSchemaVersion(ctx, extractorId)]);

    const pending = await Promise.all(
      documents
        .filter((d) => d.expected === undefined)
        .map(async (doc) => {
          const run = await ctx.db
            .query("runs")
            .withIndex("by_document", (q) => q.eq("documentId", doc._id))
            .order("desc")
            .first();
          return {
            documentId: doc._id,
            title: doc.title,
            kind: doc.kind,
            mimeType: doc.mimeType,
            run: run
              ? {
                  _id: run._id,
                  status: run.status,
                  model: run.model,
                  /** Extracted with an older prompt or schema than the latest saved one. */
                  outdated: run.promptVersionId !== prompt?._id || run.schemaVersionId !== schema?._id,
                }
              : null,
          };
        }),
    );

    return {
      total: documents.length,
      withAnswers: documents.length - pending.length,
      promptVersion: prompt?.version ?? 0,
      schemaVersion: schema?.version ?? 0,
      pending,
    };
  },
});

/** Extracts several documents with the latest saved prompt and schema. Skips ones already running. */
export const extractMany = mutation({
  args: {
    extractorId: v.id("extractors"),
    documentIds: v.array(v.id("documents")),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.extractorId);
    if (args.documentIds.length > MAX_BATCH) fail(`Extract at most ${MAX_BATCH} documents at a time.`);
    const [prompt, schema] = await Promise.all([
      latestPromptVersion(ctx, args.extractorId),
      latestSchemaVersion(ctx, args.extractorId),
    ]);
    if (!prompt || !schema) fail("Save a prompt and schema first.");

    let queued = 0;
    for (const documentId of args.documentIds) {
      const document = await ctx.db.get(documentId);
      if (!document || document.extractorId !== args.extractorId) continue;
      const latest = await ctx.db
        .query("runs")
        .withIndex("by_document", (q) => q.eq("documentId", documentId))
        .order("desc")
        .first();
      if (latest && isActive(latest.status)) continue;
      await queueRun(ctx, {
        document,
        promptVersionId: prompt._id,
        schemaVersionId: schema._id,
        model: args.model,
        source: "playground",
        delayMs: queued * STAGGER_MS,
      });
      queued++;
    }
    await ctx.db.patch(args.extractorId, { defaultModel: args.model, updatedAt: Date.now() });
    return queued;
  },
});
