import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { MODELS_DEV_URL, normalizeModelsDev } from "../src/lib/models";

/** "Refresh now" is ignored if a download was tried this recently. */
const REFRESH_COOLDOWN_MS = 30_000;

const modelValidator = v.object({
  id: v.string(),
  provider: v.union(v.literal("google"), v.literal("openai"), v.literal("anthropic")),
  model: v.string(),
  label: v.string(),
  input: v.number(),
  output: v.number(),
  files: v.union(v.literal("pdf"), v.literal("image"), v.literal("text")),
  releaseDate: v.optional(v.string()),
  deprecated: v.optional(v.boolean()),
});

/** Sync state for the Setup page and for the app's first-run download. Never includes the model list. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("modelCatalog").first();
    return {
      source: MODELS_DEV_URL,
      syncedAt: row?.syncedAt ?? null,
      attemptedAt: row?.attemptedAt ?? null,
      error: row?.error ?? null,
      count: row?.models.length ?? 0,
    };
  },
});

export const lastAttempt = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("modelCatalog").first())?.attemptedAt ?? null,
});

export const save = internalMutation({
  args: { models: v.optional(v.array(modelValidator)), error: v.optional(v.string()) },
  handler: async (ctx, { models, error }) => {
    const row = await ctx.db.query("modelCatalog").first();
    const now = Date.now();
    // A failed download keeps the last good list; only the error and attempt time change.
    const next = models
      ? { source: MODELS_DEV_URL, syncedAt: now, attemptedAt: now, error: undefined, models }
      : { source: MODELS_DEV_URL, syncedAt: row?.syncedAt, attemptedAt: now, error, models: row?.models ?? [] };
    if (row) await ctx.db.replace(row._id, next);
    else await ctx.db.insert("modelCatalog", next);
  },
});

/** Downloads the catalog and keeps the extraction-capable models. Runs daily (crons.ts) and on demand. */
export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const response = await fetch(MODELS_DEV_URL, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`models.dev answered ${response.status}`);
      const models = normalizeModelsDev(await response.json());
      if (models.length === 0) throw new Error("The catalog had no usable models");
      await ctx.runMutation(internal.modelCatalog.save, { models });
      return { ok: true as const, count: models.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      await ctx.runMutation(internal.modelCatalog.save, { error: message });
      return { ok: false as const, error: message };
    }
  },
});

/** "Refresh now" on the Setup page, and the first download on a fresh install. */
export const refresh = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; count?: number; error?: string; skipped?: boolean }> => {
    const attemptedAt = await ctx.runQuery(internal.modelCatalog.lastAttempt, {});
    if (attemptedAt && Date.now() - attemptedAt < REFRESH_COOLDOWN_MS) return { ok: true, skipped: true };
    return await ctx.runAction(internal.modelCatalog.sync, {});
  },
});
