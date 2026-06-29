import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const MAX_FILE_SIZE_MB = 30;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function getDocumentSourceType(doc: { sourceType?: "file" | "text" }) {
  return doc.sourceType ?? "file";
}

function getDocumentTitle(doc: { title?: string; fileName?: string; sourceType?: "file" | "text" }) {
  const title = doc.title?.trim();
  if (title) return title;
  if (doc.fileName) return doc.fileName;
  return getDocumentSourceType(doc) === "text" ? "Text input" : "Untitled document";
}

function toDocumentListItem<T extends { textContent?: string; title?: string; fileName?: string; sourceType?: "file" | "text" }>(
  doc: T,
) {
  const { textContent, ...rest } = doc;
  return {
    ...rest,
    sourceType: getDocumentSourceType(doc),
    title: getDocumentTitle(doc),
    textLength: textContent?.length ?? 0,
  };
}

function normalizeMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

export const limits = query({
  args: {},
  handler: async () => {
    return {
      maxFileSizeBytes: MAX_FILE_SIZE,
      allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES),
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    docTypeKey: v.string(),
    fileName: v.string(),
    title: v.optional(v.string()),
    mimeType: v.string(),
    fileSize: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const docType = await ctx.db
      .query("docTypes")
      .withIndex("by_key", (q) => q.eq("key", args.docTypeKey))
      .first();

    if (!docType) {
      throw new Error("Doc type not found.");
    }

    const normalizedMimeType = normalizeMimeType(args.mimeType);

    if (!ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
      throw new Error("Unsupported file type. Allowed: PDF, JPEG, PNG, WebP.");
    }

    if (args.fileSize > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
    }

    const now = Date.now();
    const title = args.title?.trim() || args.fileName;

    return await ctx.db.insert("documents", {
      docTypeKey: args.docTypeKey,
      sourceType: "file",
      title,
      fileName: args.fileName,
      mimeType: normalizedMimeType,
      fileSize: args.fileSize,
      storageId: args.storageId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createText = mutation({
  args: {
    docTypeKey: v.string(),
    title: v.optional(v.string()),
    textContent: v.string(),
  },
  handler: async (ctx, args) => {
    const docType = await ctx.db
      .query("docTypes")
      .withIndex("by_key", (q) => q.eq("key", args.docTypeKey))
      .first();

    if (!docType) {
      throw new Error("Doc type not found.");
    }

    const textContent = args.textContent.trim();
    if (!textContent) {
      throw new Error("Text input is required.");
    }

    const now = Date.now();
    const title = args.title?.trim() || `Text input - ${new Date(now).toLocaleString("en-IN")}`;

    return await ctx.db.insert("documents", {
      docTypeKey: args.docTypeKey,
      sourceType: "text",
      title,
      textContent,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTitle = mutation({
  args: {
    id: v.id("documents"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) {
      throw new Error("Document not found.");
    }

    const title = args.title.trim();
    if (!title) {
      throw new Error("Title is required.");
    }

    await ctx.db.patch(args.id, {
      title,
      updatedAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("documents").collect();

    const enriched = await Promise.all(
      docs.map(async (doc) => {
        const runs = await ctx.db
          .query("runs")
          .withIndex("by_document", (q) => q.eq("documentId", doc._id))
          .collect();

        const latestRun = runs.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
        const activeRun = runs.find((run) => run.status === "queued" || run.status === "running") ?? null;

        return {
          ...toDocumentListItem(doc),
          runCount: runs.length,
          hasActiveRun: Boolean(activeRun),
          latestRun,
        };
      }),
    );

    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const listByDocTypePage = query({
  args: {
    docTypeKey: v.string(),
    search: v.optional(v.string()),
    page: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pageSize = Math.max(1, Math.min(args.pageSize ?? 50, 100));
    const requestedPage = Math.max(1, Math.floor(args.page ?? 1));
    const normalizedSearch = (args.search ?? "").trim().toLowerCase();

    const [documents, runs] = await Promise.all([
      ctx.db
        .query("documents")
        .withIndex("by_doc_type", (q) => q.eq("docTypeKey", args.docTypeKey))
        .collect(),
      ctx.db
        .query("runs")
        .withIndex("by_doc_type", (q) => q.eq("docTypeKey", args.docTypeKey))
        .collect(),
    ]);

    const runSummaryByDocument = new Map<
      string,
      { runCount: number; hasActiveRun: boolean; latestRunStatus?: string; latestRunAt?: number }
    >();

    for (const run of runs) {
      const key = run.documentId;
      const previous = runSummaryByDocument.get(key) ?? {
        runCount: 0,
        hasActiveRun: false,
        latestRunStatus: undefined,
        latestRunAt: undefined,
      };

      const latestRunAt = previous.latestRunAt ?? 0;
      const isLatest = run.createdAt >= latestRunAt;
      runSummaryByDocument.set(key, {
        runCount: previous.runCount + 1,
        hasActiveRun: previous.hasActiveRun || run.status === "queued" || run.status === "running",
        latestRunStatus: isLatest ? run.status : previous.latestRunStatus,
        latestRunAt: isLatest ? run.createdAt : previous.latestRunAt,
      });
    }

    const filtered = documents
      .filter((doc) => {
        if (!normalizedSearch) return true;
        return getDocumentTitle(doc).toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize).map((doc) => {
      const summary = runSummaryByDocument.get(doc._id);
      return {
        ...toDocumentListItem(doc),
        runCount: summary?.runCount ?? 0,
        hasActiveRun: summary?.hasActiveRun ?? false,
        latestRunStatus: summary?.latestRunStatus ?? null,
        latestRunAt: summary?.latestRunAt ?? null,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      pageCount,
      hasPrevPage: page > 1,
      hasNextPage: page < pageCount,
    };
  },
});

export const get = query({
  args: {
    id: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;

    return {
      ...doc,
      sourceType: getDocumentSourceType(doc),
      title: getDocumentTitle(doc),
    };
  },
});

export const getPreviewUrl = query({
  args: {
    id: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) {
      return null;
    }

    if (getDocumentSourceType(doc) === "text") {
      return {
        url: null,
        mimeType: "text/plain",
        fileName: getDocumentTitle(doc),
        textContent: doc.textContent ?? "",
      };
    }

    if (!doc.storageId || !doc.mimeType) {
      return null;
    }

    const url = await ctx.storage.getUrl(doc.storageId);
    return {
      url,
      mimeType: doc.mimeType,
      fileName: getDocumentTitle(doc),
    };
  },
});

export const remove = mutation({
  args: {
    id: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) {
      throw new Error("Document not found.");
    }

    const linkedRuns = await ctx.db
      .query("runs")
      .withIndex("by_document", (q) => q.eq("documentId", args.id))
      .collect();

    if (linkedRuns.length > 0) {
      throw new Error("Cannot delete document with run history. Delete runs first.");
    }

    if (doc.storageId) {
      await ctx.storage.delete(doc.storageId);
    }
    await ctx.db.delete(args.id);
  },
});
