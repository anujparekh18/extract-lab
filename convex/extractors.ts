import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  deleteDocumentCascade,
  fail,
  getExtractorBySlug,
  latestPromptVersion,
  latestSchemaVersion,
  requireExtractor,
  savePromptVersion,
  saveSchemaVersion,
  schemaFields,
  slugify,
} from "./helpers";
import { getTemplate } from "../src/lib/templates";
import { DEFAULT_MODEL_ID, parseModelId } from "../src/lib/models";
import { countFields } from "../src/lib/fields";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const extractors = await ctx.db.query("extractors").collect();
    const rows = await Promise.all(
      extractors.map(async (extractor) => {
        const [documents, lastRun, schema] = await Promise.all([
          ctx.db
            .query("documents")
            .withIndex("by_extractor", (q) => q.eq("extractorId", extractor._id))
            .collect(),
          ctx.db
            .query("runs")
            .withIndex("by_extractor", (q) => q.eq("extractorId", extractor._id))
            .order("desc")
            .first(),
          latestSchemaVersion(ctx, extractor._id),
        ]);
        const testDocs = documents.filter((d) => d.origin !== "api");
        return {
          _id: extractor._id,
          slug: extractor.slug,
          name: extractor.name,
          description: extractor.description,
          documentCount: testDocs.length,
          testCaseCount: testDocs.filter((d) => d.expected !== undefined).length,
          fieldCount: schema ? countFields(schemaFields(schema)) : 0,
          isPublished: Boolean(extractor.published),
          lastActivityAt: Math.max(extractor.updatedAt, lastRun?.createdAt ?? 0),
        };
      }),
    );
    return rows.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const extractor = await getExtractorBySlug(ctx, slug);
    if (!extractor) return null;
    const [prompt, schema] = await Promise.all([
      latestPromptVersion(ctx, extractor._id),
      latestSchemaVersion(ctx, extractor._id),
    ]);
    return { ...extractor, latestPrompt: prompt, latestSchema: schema };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    templateId: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) fail("Give the extractor a name.");
    const template = getTemplate(args.templateId) ?? getTemplate("blank")!;

    let slug = slugify(name);
    for (let i = 2; await getExtractorBySlug(ctx, slug); i++) slug = `${slugify(name)}-${i}`;

    const now = Date.now();
    const extractorId = await ctx.db.insert("extractors", {
      slug,
      name,
      description: template.id === "blank" ? undefined : template.description,
      defaultModel: DEFAULT_MODEL_ID,
      createdAt: now,
      updatedAt: now,
    });
    await savePromptVersion(ctx, extractorId, template.prompt);
    await saveSchemaVersion(ctx, extractorId, template.fields);

    // File samples (PDFs, photos) are uploaded by the browser afterwards; see useCreateExtractor.
    for (const [index, sample] of template.samples.entries()) {
      if (sample.text === undefined) continue;
      await ctx.db.insert("documents", {
        extractorId,
        title: sample.title,
        kind: "text",
        text: sample.text,
        expected: sample.expected,
        expectedUpdatedAt: now,
        // Keep template order stable in the newest-first document list.
        createdAt: now - index,
        updatedAt: now,
      });
    }
    return { slug, extractorId };
  },
});

export const update = mutation({
  args: {
    id: v.id("extractors"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    defaultModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.id);
    const patch: { name?: string; description?: string; defaultModel?: string; updatedAt: number } = {
      updatedAt: Date.now(),
    };
    if (args.name !== undefined) {
      if (!args.name.trim()) fail("Give the extractor a name.");
      patch.name = args.name.trim();
    }
    if (args.description !== undefined) patch.description = args.description.trim();
    if (args.defaultModel !== undefined) {
      if (!parseModelId(args.defaultModel)) fail("Unknown model.");
      patch.defaultModel = args.defaultModel;
    }
    await ctx.db.patch(args.id, patch);
  },
});

export const remove = mutation({
  args: { id: v.id("extractors") },
  handler: async (ctx, { id }) => {
    await requireExtractor(ctx, id);
    const active = await ctx.db
      .query("runs")
      .withIndex("by_extractor", (q) => q.eq("extractorId", id))
      .filter((q) => q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running")))
      .first();
    if (active) fail("Wait for running extractions to finish before deleting.");

    const documents = await ctx.db
      .query("documents")
      .withIndex("by_extractor", (q) => q.eq("extractorId", id))
      .collect();
    for (const document of documents) await deleteDocumentCascade(ctx, document);
    for (const table of ["evals", "promptVersions", "schemaVersions"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_extractor", (q) => q.eq("extractorId", id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(id);
  },
});
