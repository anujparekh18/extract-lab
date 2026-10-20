import { v } from "convex/values";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { fail } from "./helpers";
import {
  PROVIDERS,
  buildCatalog,
  modelIdProblem,
  priceProblem,
  type ProviderId,
} from "../src/lib/models";

async function catalog(ctx: QueryCtx) {
  const [settings, synced] = await Promise.all([
    ctx.db.query("modelSettings").collect(),
    ctx.db.query("modelCatalog").first(),
  ]);
  return buildCatalog(settings, synced?.models);
}

/** Every model the app knows: the synced catalog (or built-in fallback) with Setup edits applied, plus models added by hand. */
export const list = query({
  args: {},
  handler: async (ctx) => await catalog(ctx),
});

export const catalogInternal = internalQuery({
  args: {},
  handler: async (ctx) => await catalog(ctx),
});

function checkLabel(label: string | undefined) {
  if (label === undefined) return undefined;
  const trimmed = label.trim();
  if (!trimmed) fail("Give the model a name.");
  if (trimmed.length > 80) fail("Keep the name under 80 characters.");
  return trimmed;
}

function checkPrice(price: number | undefined) {
  if (price === undefined) return undefined;
  const problem = priceProblem(price);
  if (problem) fail(problem);
  return price;
}

async function settingFor(ctx: QueryCtx, modelId: string) {
  return await ctx.db
    .query("modelSettings")
    .withIndex("by_model", (q) => q.eq("modelId", modelId))
    .first();
}

/** Change a model's name or prices, or hide it from pickers. Works for built-in and added models. */
export const update = mutation({
  args: {
    modelId: v.string(),
    label: v.optional(v.string()),
    input: v.optional(v.number()),
    output: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
  },
  handler: async (ctx, { modelId, ...changes }) => {
    const listed = (await catalog(ctx)).some((m) => m.id === modelId);
    const existing = await settingFor(ctx, modelId);
    if (!listed && !existing) fail("Model not found.");
    const patch = {
      ...(changes.label !== undefined ? { label: checkLabel(changes.label) } : {}),
      ...(changes.input !== undefined ? { input: checkPrice(changes.input) } : {}),
      ...(changes.output !== undefined ? { output: checkPrice(changes.output) } : {}),
      ...(changes.hidden !== undefined ? { hidden: changes.hidden } : {}),
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("modelSettings", { modelId, custom: false, ...patch });
  },
});

/** Add a model the app doesn't ship with, e.g. a provider release newer than this version. */
export const add = mutation({
  args: {
    provider: v.string(),
    model: v.string(),
    label: v.string(),
    input: v.number(),
    output: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(args.provider in PROVIDERS)) fail("Unknown provider.");
    const model = args.model.trim();
    const problem = modelIdProblem(model);
    if (problem) fail(problem);
    const modelId = `${args.provider as ProviderId}/${model}`;
    const existing = await settingFor(ctx, modelId);
    if ((await catalog(ctx)).some((m) => m.id === modelId)) fail("That model is already in the list.");
    const row = {
      modelId,
      label: checkLabel(args.label) ?? model,
      input: checkPrice(args.input),
      output: checkPrice(args.output),
      hidden: false,
      custom: true,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert("modelSettings", row);
    return modelId;
  },
});

/** Catalog model: back to the catalog's name and prices, and shown again. Added model: removed from the list. */
export const reset = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, { modelId }) => {
    const existing = await settingFor(ctx, modelId);
    if (existing) await ctx.db.delete(existing._id);
  },
});
