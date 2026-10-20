import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hashString, stableStringify, validateFields, type Field } from "../src/lib/fields";

export function fail(message: string): never {
  throw new ConvexError(message);
}

export async function getExtractorBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("extractors")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
}

export async function requireExtractor(ctx: QueryCtx, id: Id<"extractors">) {
  const extractor = await ctx.db.get(id);
  if (!extractor) fail("Extractor not found.");
  return extractor;
}

export async function requireDocument(ctx: QueryCtx, id: Id<"documents">) {
  const document = await ctx.db.get(id);
  if (!document) fail("Document not found.");
  return document;
}

export async function latestPromptVersion(ctx: QueryCtx, extractorId: Id<"extractors">) {
  return await ctx.db
    .query("promptVersions")
    .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
    .order("desc")
    .first();
}

export async function latestSchemaVersion(ctx: QueryCtx, extractorId: Id<"extractors">) {
  return await ctx.db
    .query("schemaVersions")
    .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
    .order("desc")
    .first();
}

/** Returns the existing version when the text is unchanged, otherwise creates the next one. */
export async function savePromptVersion(ctx: MutationCtx, extractorId: Id<"extractors">, rawText: string) {
  const text = rawText.replace(/\s+$/, "");
  if (!text.trim()) fail("The prompt is empty.");
  const hash = hashString(text);
  const existing = await ctx.db
    .query("promptVersions")
    .withIndex("by_extractor_hash", (q) => q.eq("extractorId", extractorId).eq("hash", hash))
    .first();
  if (existing) return existing._id;
  const latest = await latestPromptVersion(ctx, extractorId);
  return await ctx.db.insert("promptVersions", {
    extractorId,
    version: (latest?.version ?? 0) + 1,
    text,
    hash,
    createdAt: Date.now(),
  });
}

export async function saveSchemaVersion(ctx: MutationCtx, extractorId: Id<"extractors">, fields: Field[]) {
  const errors = validateFields(fields);
  if (errors.length > 0) fail(errors[0]);
  const hash = hashString(stableStringify(fields));
  const existing = await ctx.db
    .query("schemaVersions")
    .withIndex("by_extractor_hash", (q) => q.eq("extractorId", extractorId).eq("hash", hash))
    .first();
  if (existing) return existing._id;
  const latest = await latestSchemaVersion(ctx, extractorId);
  return await ctx.db.insert("schemaVersions", {
    extractorId,
    version: (latest?.version ?? 0) + 1,
    fields,
    hash,
    createdAt: Date.now(),
  });
}

export function schemaFields(version: Doc<"schemaVersions">): Field[] {
  return version.fields as Field[];
}

export async function deleteDocumentCascade(ctx: MutationCtx, document: Doc<"documents">) {
  const runs = await ctx.db
    .query("runs")
    .withIndex("by_document", (q) => q.eq("documentId", document._id))
    .collect();
  for (const run of runs) await ctx.db.delete(run._id);
  if (document.storageId) await ctx.storage.delete(document.storageId);
  await ctx.db.delete(document._id);
}

export function isActive(status: Doc<"runs">["status"]) {
  return status === "queued" || status === "running";
}

export function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "extractor"
  );
}
