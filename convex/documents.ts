import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { deleteDocumentCascade, fail, isActive, requireDocument, requireExtractor } from "./helpers";
import { formatBytes } from "../src/lib/format";
import { parseJsonInput, prettyJson } from "../src/lib/json-input";

export const MAX_FILE_BYTES = 30 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const list = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const documents = await ctx.db
      .query("documents")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .order("desc")
      .collect();
    return await Promise.all(
      documents
        .filter((doc) => doc.origin !== "api")
        .map(async (doc) => {
          const lastRun = await ctx.db
            .query("runs")
            .withIndex("by_document", (q) => q.eq("documentId", doc._id))
            .order("desc")
            .first();
          return {
            _id: doc._id,
            title: doc.title,
            kind: doc.kind,
            format: doc.format,
            mimeType: doc.mimeType,
            fileSize: doc.fileSize,
            textLength: doc.text?.length,
            hasExpected: doc.expected !== undefined,
            notSureCount: doc.expectedNotSure?.length ?? 0,
            createdAt: doc.createdAt,
            lastRun: lastRun ? { status: lastRun.status, createdAt: lastRun.createdAt } : null,
          };
        }),
    );
  },
});

export const get = query({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    const url = doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null;
    return { ...doc, url };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const createFromFile = mutation({
  args: {
    extractorId: v.id("extractors"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    /** Defaults to the file name without its extension. */
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.extractorId);
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) fail("Upload not found. Try again.");
    const mimeType = (meta.contentType ?? "").toLowerCase().replace("image/jpg", "image/jpeg");
    if (!ACCEPTED_MIME_TYPES.includes(mimeType)) {
      await ctx.storage.delete(args.storageId);
      fail(`${args.fileName} isn't supported. Upload a PDF, JPEG, PNG, or WebP.`);
    }
    if (meta.size > MAX_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      fail(`${args.fileName} is ${formatBytes(meta.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
    }
    const now = Date.now();
    return await ctx.db.insert("documents", {
      extractorId: args.extractorId,
      title: args.title?.trim() || args.fileName.replace(/\.[a-z0-9]+$/i, ""),
      kind: "file",
      fileName: args.fileName,
      mimeType,
      fileSize: meta.size,
      storageId: args.storageId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createFromText = mutation({
  args: {
    extractorId: v.id("extractors"),
    title: v.optional(v.string()),
    text: v.string(),
    format: v.optional(v.literal("json")),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.extractorId);
    let text = args.text.trim();
    if (!text) fail("Paste some text first.");
    if (args.format === "json") {
      const parsed = parseJsonInput(text);
      if (!parsed.ok) fail(parsed.error);
      text = prettyJson(parsed.value);
    }
    const now = Date.now();
    const firstLine = text.split("\n").find((line) => line.trim())?.trim().slice(0, 60);
    return await ctx.db.insert("documents", {
      extractorId: args.extractorId,
      title: args.title?.trim() || (args.format === "json" ? "JSON document" : firstLine) || "Pasted text",
      kind: "text",
      format: args.format,
      text,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { id: v.id("documents"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    await requireDocument(ctx, id);
    if (!title.trim()) fail("Title can't be empty.");
    await ctx.db.patch(id, { title: title.trim(), updatedAt: Date.now() });
  },
});

/**
 * Sets or clears the expected output. `null` clears it. `notSure` replaces the paths that aren't
 * scored; leave it out to keep the current ones.
 */
export const setExpected = mutation({
  args: { id: v.id("documents"), expected: v.any(), notSure: v.optional(v.array(v.string())) },
  handler: async (ctx, { id, expected, notSure }) => {
    await requireDocument(ctx, id);
    const now = Date.now();
    const cleared = expected === null;
    await ctx.db.patch(id, {
      expected: cleared ? undefined : expected,
      expectedUpdatedAt: cleared ? undefined : now,
      ...(cleared ? { expectedNotSure: undefined } : notSure !== undefined ? { expectedNotSure: notSure.length ? notSure : undefined } : {}),
      updatedAt: now,
    });
  },
});

/**
 * Moves a document that came in through the HTTP endpoint into the test set, so it can get a
 * correct answer and counts in accuracy checks. It's no longer deleted by the retention period.
 */
export const addToTestSet = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const document = await requireDocument(ctx, id);
    if (document.origin !== "api") return;
    await ctx.db.patch(id, {
      origin: undefined,
      title: document.title.replace(/^API request /, "From API "),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const document = await requireDocument(ctx, id);
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_document", (q) => q.eq("documentId", id))
      .collect();
    if (runs.some((run) => isActive(run.status))) fail("Wait for the running extraction to finish.");
    await deleteDocumentCascade(ctx, document);
  },
});

/** Starts transcribing a file to text (for the Text view and agents), if it isn't already. */
export const requestTranscript = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const document = await requireDocument(ctx, id);
    if (document.kind !== "file") return;
    if (document.transcript?.status === "running" || document.transcript?.status === "ready") return;
    await ctx.db.patch(id, { transcript: { status: "running" } });
    await ctx.scheduler.runAfter(0, internal.execution.transcribe, { documentId: id });
  },
});

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

export const getInternal = internalQuery({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const setTranscript = internalMutation({
  args: {
    id: v.id("documents"),
    transcript: v.object({
      status: v.union(v.literal("running"), v.literal("ready"), v.literal("failed")),
      text: v.optional(v.string()),
      model: v.optional(v.string()),
      costUsd: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { id, transcript }) => {
    if (!(await ctx.db.get(id))) return;
    await ctx.db.patch(id, { transcript });
  },
});

