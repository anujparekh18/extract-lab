import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { listSchemaSupport } from "../src/extraction/schema-registry";

function normalizeKey(rawKey: string) {
  return rawKey.trim().toLowerCase();
}

function assertDocTypeKeyFormat(key: string) {
  const normalized = normalizeKey(key);
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error("Doc type key must contain only lowercase letters, numbers, and underscore.");
  }
  return normalized;
}

function getDeleteState(counts: { documentCount: number; promptCount: number; runCount: number }) {
  const blockers: string[] = [];
  if (counts.documentCount > 0) blockers.push("Documents");
  if (counts.promptCount > 0) blockers.push("Prompts");
  if (counts.runCount > 0) blockers.push("Runs");
  const blockerList =
    blockers.length <= 2
      ? blockers.join(" and ")
      : `${blockers.slice(0, -1).join(", ")}, and ${blockers[blockers.length - 1]}`;

  return {
    canDelete: blockers.length === 0,
    deletionDisabledReason:
      blockers.length === 0 ? null : `Delete linked ${blockerList} first.`,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const support = listSchemaSupport();
    const supportMap = new Map(support.map((entry) => [entry.docTypeKey, entry.versions]));

    const docTypes = await ctx.db.query("docTypes").collect();

    const enriched = await Promise.all(
      docTypes.map(async (docType) => {
        const docs = await ctx.db
          .query("documents")
          .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
          .collect();
        const prompts = await ctx.db
          .query("prompts")
          .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
          .collect();
        const runs = await ctx.db
          .query("runs")
          .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
          .collect();

        const versions = supportMap.get(docType.key) ?? [];

        return {
          ...docType,
          schemaVersions: versions,
          isSchemaSupported: versions.length > 0,
          documentCount: docs.length,
          promptCount: prompts.length,
          runCount: runs.length,
          ...getDeleteState({
            documentCount: docs.length,
            promptCount: prompts.length,
            runCount: runs.length,
          }),
        };
      }),
    );

    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listForHub = query({
  args: {},
  handler: async (ctx) => {
    const support = listSchemaSupport();
    const supportMap = new Map(support.map((entry) => [entry.docTypeKey, entry.versions]));

    const [docTypes, documents, prompts, runs] = await Promise.all([
      ctx.db.query("docTypes").collect(),
      ctx.db.query("documents").collect(),
      ctx.db.query("prompts").collect(),
      ctx.db.query("runs").collect(),
    ]);

    const docCountByType = new Map<string, number>();
    const promptCountByType = new Map<string, number>();
    const runCountByType = new Map<string, number>();
    const lastActivityByType = new Map<string, number>();

    for (const doc of documents) {
      docCountByType.set(doc.docTypeKey, (docCountByType.get(doc.docTypeKey) ?? 0) + 1);
      const current = lastActivityByType.get(doc.docTypeKey) ?? 0;
      lastActivityByType.set(doc.docTypeKey, Math.max(current, doc.updatedAt));
    }

    for (const prompt of prompts) {
      promptCountByType.set(prompt.docTypeKey, (promptCountByType.get(prompt.docTypeKey) ?? 0) + 1);
      const current = lastActivityByType.get(prompt.docTypeKey) ?? 0;
      lastActivityByType.set(prompt.docTypeKey, Math.max(current, prompt.updatedAt));
    }

    for (const run of runs) {
      runCountByType.set(run.docTypeKey, (runCountByType.get(run.docTypeKey) ?? 0) + 1);
      const current = lastActivityByType.get(run.docTypeKey) ?? 0;
      lastActivityByType.set(run.docTypeKey, Math.max(current, run.updatedAt));
    }

    const enriched = docTypes.map((docType) => {
      const versions = supportMap.get(docType.key) ?? [];
      const lastActivityAt = Math.max(lastActivityByType.get(docType.key) ?? 0, docType.updatedAt);

      return {
        ...docType,
        schemaVersions: versions,
        isSchemaSupported: versions.length > 0,
        documentCount: docCountByType.get(docType.key) ?? 0,
        promptCount: promptCountByType.get(docType.key) ?? 0,
        runCount: runCountByType.get(docType.key) ?? 0,
        lastActivityAt,
        ...getDeleteState({
          documentCount: docCountByType.get(docType.key) ?? 0,
          promptCount: promptCountByType.get(docType.key) ?? 0,
          runCount: runCountByType.get(docType.key) ?? 0,
        }),
      };
    });

    return enriched.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  },
});

export const getByKey = query({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const key = normalizeKey(args.key);
    const docType = await ctx.db
      .query("docTypes")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (!docType) return null;

    const support = listSchemaSupport();
    const supportMap = new Map(support.map((entry) => [entry.docTypeKey, entry.versions]));
    const versions = supportMap.get(docType.key) ?? [];

    const [documents, prompts, runs] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
        .collect(),
      ctx.db
        .query("prompts")
        .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
        .collect(),
      ctx.db
        .query("runs")
        .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
        .collect(),
    ]);

    const lastActivityAt = Math.max(
      docType.updatedAt,
      ...documents.map((doc) => doc.updatedAt),
      ...prompts.map((prompt) => prompt.updatedAt),
      ...runs.map((run) => run.updatedAt),
    );

    return {
      ...docType,
      schemaVersions: versions,
      isSchemaSupported: versions.length > 0,
      documentCount: documents.length,
      promptCount: prompts.length,
      runCount: runs.length,
      lastActivityAt,
      ...getDeleteState({
        documentCount: documents.length,
        promptCount: prompts.length,
        runCount: runs.length,
      }),
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    key: v.string(),
  },
  handler: async (ctx, args) => {
    const key = assertDocTypeKeyFormat(args.key);
    const name = args.name.trim();

    if (!name) {
      throw new Error("Doc type name is required.");
    }

    const existing = await ctx.db
      .query("docTypes")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      throw new Error(`Doc type with key '${key}' already exists.`);
    }

    const now = Date.now();

    return await ctx.db.insert("docTypes", {
      key,
      name,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateName = mutation({
  args: {
    id: v.id("docTypes"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const docType = await ctx.db.get(args.id);
    if (!docType) {
      throw new Error("Doc type not found.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new Error("Doc type name is required.");
    }

    await ctx.db.patch(args.id, {
      name,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("docTypes"),
  },
  handler: async (ctx, args) => {
    const docType = await ctx.db.get(args.id);
    if (!docType) {
      throw new Error("Doc type not found.");
    }

    const linkedDocs = await ctx.db
      .query("documents")
      .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
      .collect();
    if (linkedDocs.length > 0) {
      throw new Error("Cannot delete doc type with linked documents.");
    }

    const linkedPrompts = await ctx.db
      .query("prompts")
      .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
      .collect();
    if (linkedPrompts.length > 0) {
      throw new Error("Cannot delete doc type with linked prompts.");
    }

    const linkedRuns = await ctx.db
      .query("runs")
      .withIndex("by_doc_type", (q) => q.eq("docTypeKey", docType.key))
      .collect();
    if (linkedRuns.length > 0) {
      throw new Error("Cannot delete doc type with linked runs.");
    }

    await ctx.db.delete(args.id);
  },
});
