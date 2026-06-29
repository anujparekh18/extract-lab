import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByDocType = query({
  args: {
    docTypeKey: v.string(),
  },
  handler: async (ctx, args) => {
    const prompts = await ctx.db
      .query("prompts")
      .withIndex("by_doc_type", (q) => q.eq("docTypeKey", args.docTypeKey))
      .collect();

    return prompts
      .map((prompt) => ({
        ...prompt,
        canDelete: true,
        deletionDisabledReason: null,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = query({
  args: {
    id: v.id("prompts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    docTypeKey: v.string(),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const docType = await ctx.db
      .query("docTypes")
      .withIndex("by_key", (q) => q.eq("key", args.docTypeKey))
      .first();

    if (!docType) {
      throw new Error("Doc type not found.");
    }

    const name = args.name.trim();
    const text = args.text.trim();

    if (!name) {
      throw new Error("Prompt name is required.");
    }
    if (!text) {
      throw new Error("Prompt text is required.");
    }

    const now = Date.now();

    return await ctx.db.insert("prompts", {
      docTypeKey: args.docTypeKey,
      name,
      text,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("prompts"),
    name: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.id);
    if (!prompt) {
      throw new Error("Prompt not found.");
    }

    const name = args.name.trim();
    const text = args.text.trim();

    if (!name) {
      throw new Error("Prompt name is required.");
    }
    if (!text) {
      throw new Error("Prompt text is required.");
    }

    await ctx.db.patch(args.id, {
      name,
      text,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("prompts"),
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.id);
    if (!prompt) {
      throw new Error("Prompt not found.");
    }

    await ctx.db.delete(args.id);
  },
});
