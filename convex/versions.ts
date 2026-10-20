import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireExtractor, savePromptVersion, saveSchemaVersion } from "./helpers";
import type { Field } from "../src/lib/fields";

export const prompts = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    return await ctx.db
      .query("promptVersions")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .order("desc")
      .collect();
  },
});

export const schemas = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const rows = await ctx.db
      .query("schemaVersions")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .order("desc")
      .collect();
    return rows.map((row) => ({ ...row, fields: row.fields as Field[] }));
  },
});

/** How many runs used each prompt and schema version, for the Versions tab. */
export const usage = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .collect();
    const prompts: Record<string, number> = {};
    const schemas: Record<string, number> = {};
    for (const run of runs) {
      prompts[run.promptVersionId] = (prompts[run.promptVersionId] ?? 0) + 1;
      schemas[run.schemaVersionId] = (schemas[run.schemaVersionId] ?? 0) + 1;
    }
    return { prompts, schemas };
  },
});

export const savePrompt = mutation({
  args: { extractorId: v.id("extractors"), text: v.string() },
  handler: async (ctx, { extractorId, text }) => {
    await requireExtractor(ctx, extractorId);
    const id = await savePromptVersion(ctx, extractorId, text);
    return (await ctx.db.get(id))!.version;
  },
});

export const saveSchema = mutation({
  args: { extractorId: v.id("extractors"), fields: v.any() },
  handler: async (ctx, { extractorId, fields }) => {
    await requireExtractor(ctx, extractorId);
    const id = await saveSchemaVersion(ctx, extractorId, fields as Field[]);
    return (await ctx.db.get(id))!.version;
  },
});
