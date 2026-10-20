import { v } from "convex/values";
import { query } from "./_generated/server";
import { schemaFields } from "./helpers";
import { checkRules } from "../src/lib/rules";
import type { Field } from "../src/lib/fields";
import { PROVIDERS, type ProviderId } from "../src/lib/models";

/** Which providers have keys, so the UI only offers what will work. Never returns the keys. */
export const setup = query({
  args: {},
  handler: async () => {
    const providers = Object.fromEntries(
      (Object.keys(PROVIDERS) as ProviderId[]).map((id) => [id, Boolean(process.env[PROVIDERS[id].envVar])]),
    ) as Record<ProviderId, boolean>;
    return {
      providers,
      apiKeyRequired: Boolean(process.env.EXTRACT_LAB_API_KEY),
    };
  },
});

export const recentApiRuns = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
      .order("desc")
      .filter((q) => q.eq(q.field("source"), "api"))
      .take(20);
    const schemas = new Map<string, Field[]>();
    return await Promise.all(
      runs.map(async (run) => {
        if (!schemas.has(run.schemaVersionId)) {
          const schema = await ctx.db.get(run.schemaVersionId);
          schemas.set(run.schemaVersionId, schema ? schemaFields(schema) : []);
        }
        const failedChecks = run.status === "success" && !run.purgedAt ? checkRules(schemas.get(run.schemaVersionId)!, run.output).length : 0;
        return {
          _id: run._id,
          status: run.status,
          model: run.model,
          release: run.release,
          createdAt: run.createdAt,
          latencyMs: run.latencyMs,
          costUsd: run.costUsd,
          error: run.error,
          output: run.output,
          failedChecks,
          purged: Boolean(run.purgedAt),
        };
      }),
    );
  },
});
