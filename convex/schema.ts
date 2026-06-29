import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { GOOGLE_PROVIDER } from "../src/extraction/models";

const runStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("success"),
  v.literal("failed"),
);

export default defineSchema({
  docTypes: defineTable({
    key: v.string(),
    name: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  documents: defineTable({
    docTypeKey: v.string(),
    sourceType: v.optional(v.union(v.literal("file"), v.literal("text"))),
    title: v.optional(v.string()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    textContent: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_doc_type", ["docTypeKey"]),

  prompts: defineTable({
    docTypeKey: v.string(),
    name: v.string(),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_doc_type", ["docTypeKey"]),

  runs: defineTable({
    documentId: v.id("documents"),
    docTypeKey: v.string(),
    promptId: v.id("prompts"),

    promptSnapshot: v.string(),
    schemaSnapshot: v.object({
      docTypeKey: v.string(),
      schemaVersion: v.string(),
    }),
    modelSnapshot: v.object({
      provider: v.literal(GOOGLE_PROVIDER),
      model: v.string(),
    }),

    status: runStatusValidator,

    parsedOutput: v.optional(v.any()),
    validationErrors: v.optional(v.array(v.string())),
    errorMessage: v.optional(v.string()),

    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),

    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_document_status", ["documentId", "status"])
    .index("by_status", ["status"])
    .index("by_doc_type", ["docTypeKey"]),
});
