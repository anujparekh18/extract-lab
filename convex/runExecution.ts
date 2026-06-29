"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { getSchema, hasSchemaVersion } from "../src/extraction/schema-registry";
import { estimateCostUsd, type UsageShape } from "../src/extraction/models";

function extractUsage(generation: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerMetadata?: Record<string, unknown>;
}): UsageShape {
  const googleMeta = (generation.providerMetadata?.google ?? {}) as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };

  const inputTokens = generation.usage?.inputTokens ?? googleMeta.promptTokenCount;
  const outputTokens = generation.usage?.outputTokens ?? googleMeta.candidatesTokenCount;
  const totalTokens =
    generation.usage?.totalTokens ??
    googleMeta.totalTokenCount ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function extractValidationErrors(error: unknown): string[] | undefined {
  const source = error as
    | {
        issues?: Array<{ path?: PropertyKey[]; message?: string }>;
        cause?: unknown;
      }
    | undefined;

  const directIssues = source?.issues;
  if (Array.isArray(directIssues) && directIssues.length > 0) {
    return directIssues.map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length > 0
          ? issue.path.map((segment) => String(segment)).join(".")
          : "(root)";
      return `${path}: ${issue.message ?? "Invalid value"}`;
    });
  }

  const nestedIssues = (source?.cause as { issues?: Array<{ path?: PropertyKey[]; message?: string }> } | undefined)
    ?.issues;
  if (Array.isArray(nestedIssues) && nestedIssues.length > 0) {
    return nestedIssues.map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length > 0
          ? issue.path.map((segment) => String(segment)).join(".")
          : "(root)";
      return `${path}: ${issue.message ?? "Invalid value"}`;
    });
  }

  return undefined;
}

export const execute = action({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(api.runs.getRunForExecution, { runId: args.runId });
    if (!payload) {
      return;
    }

    const { run, document } = payload;
    const startedAt = Date.now();

    if (run.status === "queued") {
      await ctx.runMutation(api.runs.markRunning, {
        runId: args.runId,
        startedAt,
      });
    }

    const usageDefaults: UsageShape = {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    };

    try {
      if (!hasSchemaVersion(run.schemaSnapshot.docTypeKey, run.schemaSnapshot.schemaVersion)) {
        const finishedAt = Date.now();
        await ctx.runMutation(api.runs.finalizeFailure, {
          runId: args.runId,
          finishedAt,
          errorMessage: "Schema support missing in code registry.",
          validationErrors: [
            `Missing schema for ${run.schemaSnapshot.docTypeKey}:${run.schemaSnapshot.schemaVersion}`,
          ],
          latencyMs: finishedAt - startedAt,
        });
        return;
      }

      const schema = getSchema(run.schemaSnapshot.docTypeKey, run.schemaSnapshot.schemaVersion);
      if (!schema) {
        const finishedAt = Date.now();
        await ctx.runMutation(api.runs.finalizeFailure, {
          runId: args.runId,
          finishedAt,
          errorMessage: "Failed to resolve schema.",
          latencyMs: finishedAt - startedAt,
        });
        return;
      }

      const sourceType = document.sourceType ?? "file";
      const content: Array<
        | {
            type: "file";
            data: ArrayBuffer;
            mediaType: string;
          }
        | {
            type: "text";
            text: string;
          }
      > = [];

      if (sourceType === "text") {
        const textContent = document.textContent?.trim();
        if (!textContent) {
          const finishedAt = Date.now();
          await ctx.runMutation(api.runs.finalizeFailure, {
            runId: args.runId,
            finishedAt,
            errorMessage: "Document text not found.",
            latencyMs: finishedAt - startedAt,
          });
          return;
        }

        content.push({
          type: "text",
          text: `Input document:\n\n${textContent}`,
        });
      } else {
        if (!document.storageId || !document.mimeType) {
          const finishedAt = Date.now();
          await ctx.runMutation(api.runs.finalizeFailure, {
            runId: args.runId,
            finishedAt,
            errorMessage: "Document file metadata not found.",
            latencyMs: finishedAt - startedAt,
          });
          return;
        }

        const fileBlob = await ctx.storage.get(document.storageId);
        if (!fileBlob) {
          const finishedAt = Date.now();
          await ctx.runMutation(api.runs.finalizeFailure, {
            runId: args.runId,
            finishedAt,
            errorMessage: "Document file not found.",
            latencyMs: finishedAt - startedAt,
          });
          return;
        }

        const arrayBuffer = await fileBlob.arrayBuffer();
        content.push({
          type: "file",
          data: arrayBuffer,
          mediaType: document.mimeType,
        });
      }

      content.push({
        type: "text",
        text: run.promptSnapshot,
      });

      const generation = await generateObject({
        model: google(run.modelSnapshot.model),
        schema,
        messages: [
          {
            role: "user",
            content,
          },
        ],
      });

      const usage = extractUsage(generation);
      const finishedAt = Date.now();

      await ctx.runMutation(api.runs.finalizeSuccess, {
        runId: args.runId,
        finishedAt,
        parsedOutput: generation.object,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: estimateCostUsd(run.modelSnapshot.model, usage),
        latencyMs: finishedAt - startedAt,
      });
    } catch (error) {
      const finishedAt = Date.now();
      const validationErrors = extractValidationErrors(error);
      await ctx.runMutation(api.runs.finalizeFailure, {
        runId: args.runId,
        finishedAt,
        errorMessage: error instanceof Error ? error.message : "Run execution failed.",
        validationErrors,
        inputTokens: usageDefaults.inputTokens,
        outputTokens: usageDefaults.outputTokens,
        totalTokens: usageDefaults.totalTokens,
        latencyMs: finishedAt - startedAt,
      });
    }
  },
});
