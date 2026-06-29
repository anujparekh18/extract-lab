export type UsageShape = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ModelPricing = {
  input: number;
  output: number;
};

export type RunCostShape = {
  estimatedCostUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  modelSnapshot?: { model?: string };
};

export type CostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  inputRate: number;
  outputRate: number;
  inputCost: number;
  inputCostInr: number;
  outputCost: number;
  outputCostInr: number;
  totalCostUsd: number;
  totalCostInr: number;
};

export const GOOGLE_PROVIDER = "google";

export const SUPPORTED_GOOGLE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
  "gemini-3-flash-preview",
] as const;

export type SupportedGoogleModel = (typeof SUPPORTED_GOOGLE_MODELS)[number];

export const DEFAULT_MODEL = "gemini-3-flash-preview";
export const USD_TO_INR_RATE = 94;
export const COST_CURRENCY_LABEL = "USD / INR";

export const MODEL_PRICING_PER_1M_TOKENS_USD: Record<string, ModelPricing> = {
  "gemini-3-flash-preview": { input: 0.5, output: 3 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-1.5-pro": { input: 1.25, output: 10 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
};

export function normalizePricingKey(model: string) {
  if (model.includes("3-flash-preview")) return "gemini-3-flash-preview";
  if (model.includes("2.5-flash")) return "gemini-2.5-flash";
  if (model.includes("2.5-pro")) return "gemini-2.5-pro";
  if (model.includes("1.5-pro")) return "gemini-1.5-pro";
  if (model.includes("2.0-flash")) return "gemini-2.0-flash";
  return model;
}

export function isSupportedGoogleModel(model: string): model is SupportedGoogleModel {
  return (SUPPORTED_GOOGLE_MODELS as readonly string[]).includes(model);
}

export function getModelPricing(model: string) {
  return MODEL_PRICING_PER_1M_TOKENS_USD[normalizePricingKey(model)];
}

export function estimateCostUsd(model: string, usage: UsageShape) {
  const pricing = getModelPricing(model);
  if (!pricing) return undefined;

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return Number((inputCost + outputCost).toFixed(6));
}

export function formatModelOptionLabel(model: string) {
  const pricing = getModelPricing(model);
  // Models without pricing can still run; they just won't show cost estimates.
  if (!pricing) return model;
  return `${model} (${pricing.input}/${pricing.output})`;
}

export function formatExchangeRateLabel() {
  return `FX: 1 USD = ₹${USD_TO_INR_RATE.toFixed(2)}`;
}

export function formatCost(value: number | undefined) {
  if (value === undefined || value === null) return "-";
  const inr = value * USD_TO_INR_RATE;
  return `$${value.toFixed(6)} / ₹${inr.toFixed(4)}`;
}

export function resolveRunCostUsd(run: RunCostShape) {
  if (run.estimatedCostUsd !== undefined && run.estimatedCostUsd !== null) {
    return run.estimatedCostUsd;
  }

  const model = run.modelSnapshot?.model;
  if (!model) return undefined;

  return estimateCostUsd(model, {
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  });
}

export function buildCostBreakdown(
  run: RunCostShape,
  estimatedCostUsd: number | undefined,
): CostBreakdown | null {
  const model = run.modelSnapshot?.model;
  if (!model) return null;

  const pricing = getModelPricing(model);
  if (!pricing) return null;

  const inputTokens = run.inputTokens;
  const outputTokens = run.outputTokens;
  if (inputTokens === undefined && outputTokens === undefined) {
    return null;
  }

  const safeInputTokens = inputTokens ?? 0;
  const safeOutputTokens = outputTokens ?? 0;
  const inputCost = (safeInputTokens / 1_000_000) * pricing.input;
  const outputCost = (safeOutputTokens / 1_000_000) * pricing.output;
  const inputCostInr = inputCost * USD_TO_INR_RATE;
  const outputCostInr = outputCost * USD_TO_INR_RATE;
  const totalCostUsd = estimatedCostUsd ?? inputCost + outputCost;
  const totalCostInr = totalCostUsd * USD_TO_INR_RATE;

  return {
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens,
    inputRate: pricing.input,
    outputRate: pricing.output,
    inputCost,
    inputCostInr,
    outputCost,
    outputCostInr,
    totalCostUsd,
    totalCostInr,
  };
}
