export type ProviderId = "google" | "openai" | "anthropic";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  envVar: string;
  keyUrl: string;
  /** Where to look up current model ids and prices. */
  pricingUrl: string;
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  google: {
    id: "google",
    label: "Google Gemini",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    envVar: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    pricingUrl: "https://platform.openai.com/docs/pricing",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    envVar: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing",
  },
};

/** What a model can read besides text: PDFs (and images), images only, or text only. */
export type FileSupport = "pdf" | "image" | "text";

export type ModelInfo = {
  /** `provider/model`, the id stored on runs. */
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
  /** USD per 1M tokens. */
  input: number;
  output: number;
  files: FileSupport;
  /** ISO date, when known. */
  releaseDate?: string;
  /** The provider has announced it's going away. */
  deprecated?: boolean;
};

/** A model as the app sees it: from the synced catalog, the built-in fallback, or added by hand, with edits applied. */
export type CatalogModel = ModelInfo & {
  hidden: boolean;
  /** Added on the Setup page rather than coming from the catalog. */
  custom: boolean;
  /** Name or prices changed on the Setup page. */
  edited: boolean;
};

/** One row of the `modelSettings` table: edits to a catalog model, or a model added by hand. */
export type ModelSetting = {
  modelId: string;
  label?: string;
  input?: number;
  output?: number;
  hidden?: boolean;
  custom: boolean;
};

/**
 * Open, community-maintained catalog of models and prices (https://models.dev). Extract Lab
 * downloads it daily so pickers show current models and prices without anyone editing code.
 */
export const MODELS_DEV_URL = "https://models.dev/api.json";

/** Used until the catalog has been downloaded once (or when it can't be). Prices checked September 2026. */
export const DEFAULT_MODELS: ModelInfo[] = [
  { id: "google/gemini-3.1-flash-lite", provider: "google", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", input: 0.25, output: 1.5, files: "pdf" },
  { id: "google/gemini-3.8-flash", provider: "google", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", input: 0.75, output: 3.75, files: "pdf" },
  { id: "google/gemini-3.1-pro-preview", provider: "google", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", input: 2, output: 12, files: "pdf" },
  { id: "google/gemini-2.5-flash", provider: "google", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash", input: 0.3, output: 2.5, files: "pdf" },
  { id: "openai/gpt-5.6-luna", provider: "openai", model: "gpt-5.6-luna", label: "GPT-5.6 Luna", input: 0.2, output: 1.2, files: "pdf" },
  { id: "openai/gpt-5.6-terra", provider: "openai", model: "gpt-5.6-terra", label: "GPT-5.6 Terra", input: 2, output: 12, files: "pdf" },
  { id: "openai/gpt-5.5", provider: "openai", model: "gpt-5.5", label: "GPT-5.5", input: 5, output: 30, files: "pdf" },
  { id: "anthropic/claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5", label: "Claude Haiku 4.5", input: 1, output: 5, files: "pdf" },
  { id: "anthropic/claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5", input: 2, output: 10, files: "pdf" },
  { id: "anthropic/claude-opus-5", provider: "anthropic", model: "claude-opus-5", label: "Claude Opus 5", input: 5, output: 25, files: "pdf" },
];

export const DEFAULT_MODEL_ID = "google/gemini-3.8-flash";

/** Models that can't do document extraction: media generation, speech, embeddings, agents, live APIs. */
const NOT_FOR_EXTRACTION = /(embedding|tts|audio|realtime|transcribe|live|image|veo|lyria|computer-use|deep-research|search|moderation|customtools|translate|codex|omni)/;

type ModelsDevModel = {
  id: string;
  name?: string;
  release_date?: string;
  status?: string;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
};

/**
 * Turns the models.dev catalog into the models that can extract structured data: providers we
 * support, text out, structured output not ruled out, and a known price.
 */
export function normalizeModelsDev(data: unknown): ModelInfo[] {
  const catalog = (data ?? {}) as Record<string, { models?: Record<string, ModelsDevModel> } | undefined>;
  const models: ModelInfo[] = [];
  for (const provider of Object.keys(PROVIDERS) as ProviderId[]) {
    for (const entry of Object.values(catalog[provider]?.models ?? {})) {
      if (!entry || typeof entry.id !== "string" || NOT_FOR_EXTRACTION.test(entry.id)) continue;
      const input = entry.cost?.input;
      const output = entry.cost?.output;
      if (typeof input !== "number" || typeof output !== "number") continue;
      const outputs = entry.modalities?.output ?? [];
      if (outputs.length !== 1 || outputs[0] !== "text") continue;
      if (entry.structured_output === false) continue;
      const inputs = entry.modalities?.input ?? [];
      models.push({
        id: `${provider}/${entry.id}`,
        provider,
        model: entry.id,
        label: entry.name?.trim() || entry.id,
        input,
        output,
        files: inputs.includes("pdf") ? "pdf" : inputs.includes("image") ? "image" : "text",
        releaseDate: entry.release_date,
        deprecated: entry.status === "deprecated" || undefined,
      });
    }
  }
  return models.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
}

/**
 * Merges the model list (the synced catalog, or the built-in fallback) with the edits and
 * additions stored in the database.
 */
export function buildCatalog(settings: ModelSetting[], synced?: ModelInfo[] | null): CatalogModel[] {
  const base = synced && synced.length > 0 ? synced : DEFAULT_MODELS;
  const byId = new Map(settings.map((s) => [s.modelId, s]));
  const listed = new Set(base.map((m) => m.id));
  const models = base.map((model): CatalogModel => {
    const setting = byId.get(model.id);
    return {
      ...model,
      label: setting?.label ?? model.label,
      input: setting?.input ?? model.input,
      output: setting?.output ?? model.output,
      hidden: setting?.hidden ?? false,
      custom: false,
      edited: setting !== undefined && (setting.label !== undefined || setting.input !== undefined || setting.output !== undefined),
    };
  });
  const added = settings.flatMap((setting): CatalogModel[] => {
    const parsed = parseModelId(setting.modelId);
    if (!setting.custom || !parsed || listed.has(setting.modelId)) return [];
    return [
      {
        id: setting.modelId,
        ...parsed,
        label: setting.label ?? parsed.model,
        input: setting.input ?? 0,
        output: setting.output ?? 0,
        files: "pdf",
        hidden: setting.hidden ?? false,
        custom: true,
        edited: false,
      },
    ];
  });
  return [...models, ...added];
}

/**
 * The catalog the UI currently knows about. Starts as the defaults and is replaced once the
 * database copy loads (see ModelsProvider), so `modelLabel` and friends stay synchronous.
 */
let currentCatalog: CatalogModel[] = buildCatalog([]);

export function setModelCatalog(catalog: CatalogModel[]) {
  currentCatalog = catalog;
}

/** The models to offer in pickers: everything not hidden on the Setup page. */
export function visibleModels(catalog: CatalogModel[] = currentCatalog) {
  return catalog.filter((m) => !m.hidden);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pickers lead with models released in roughly the last ten months; older ones are a click away. */
const CURRENT_FOR_DAYS = 300;

/** Dated snapshots like `claude-haiku-4-5-20251001` duplicate an alias that's already listed. */
function isDatedSnapshot(model: string) {
  return /-\d{8}$|-\d{4}-\d{2}-\d{2}$|-\d{2}-\d{4}$/.test(model);
}

/** Whether to show a model before "Show all": recent, not deprecated, added by hand, or edited. */
export function isCurrentModel(model: CatalogModel, now = Date.now()) {
  if (model.custom || model.edited) return true;
  if (model.deprecated || isDatedSnapshot(model.model)) return false;
  if (!model.releaseDate) return true;
  const released = Date.parse(model.releaseDate);
  return Number.isNaN(released) || now - released < CURRENT_FOR_DAYS * DAY_MS;
}

/**
 * Models to list in a picker: matching every word of `query` (name or id) when searching,
 * otherwise current ones unless `showAll`. Models in `keep` (e.g. the selected one) always stay.
 */
export function pickerModels(
  catalog: CatalogModel[],
  {
    query = "",
    showAll = false,
    keep = [],
    includeHidden = false,
  }: { query?: string; showAll?: boolean; keep?: string[]; includeHidden?: boolean } = {},
) {
  const visible = includeHidden ? catalog : visibleModels(catalog);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return visible.filter((m) => {
      const haystack = `${m.label} ${m.model}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }
  if (showAll) return visible;
  return visible.filter((m) => isCurrentModel(m) || keep.includes(m.id));
}

/** Why a model can't read this kind of file, or null if it can. */
export function fileProblem(model: Pick<ModelInfo, "files" | "label"> | undefined, mimeType: string | undefined): string | null {
  if (!model || !mimeType) return null;
  if (mimeType === "application/pdf" && model.files !== "pdf") {
    return `${model.label} can't read PDFs. Pick a model marked "PDF".`;
  }
  if (mimeType.startsWith("image/") && model.files === "text") {
    return `${model.label} only reads text, not images. Pick a model marked "PDF" or "Images".`;
  }
  return null;
}

/**
 * Models for helper jobs (reading files as text), cheapest first: visible, reads
 * PDFs, and has a key. Current models come first, because old ones are often retired by the
 * provider even while catalogs still list them.
 */
export function cheapModels(catalog: CatalogModel[], hasKey: (modelId: string) => boolean, now = Date.now()) {
  const usable = visibleModels(catalog).filter((m) => m.files === "pdf" && !m.deprecated && hasKey(m.id));
  const byPrice = (a: CatalogModel, b: CatalogModel) => a.input + a.output - (b.input + b.output);
  const current = usable.filter((m) => isCurrentModel(m, now)).sort(byPrice);
  const older = usable.filter((m) => !isCurrentModel(m, now)).sort(byPrice);
  return [...current, ...older];
}

export function cheapestModel(catalog: CatalogModel[], hasKey: (modelId: string) => boolean, now = Date.now()) {
  return cheapModels(catalog, hasKey, now)[0];
}

export function parseModelId(id: string): { provider: ProviderId; model: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0) return null;
  const provider = id.slice(0, slash);
  const model = id.slice(slash + 1);
  if (!(provider in PROVIDERS) || !model) return null;
  return { provider: provider as ProviderId, model };
}

/** Problems with a model id typed into the UI, or null if it looks usable. */
export function modelIdProblem(model: string): string | null {
  const trimmed = model.trim();
  if (!trimmed) return "Enter the model id, e.g. gemini-3.8-flash.";
  if (trimmed.length > 120) return "That model id is too long.";
  if (/\s/.test(trimmed)) return "Model ids don't contain spaces.";
  return null;
}

/** Problems with a price typed into the UI (USD per 1M tokens), or null. */
export function priceProblem(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return "Prices are numbers of dollars, zero or more.";
  if (value > 10_000) return "That price looks too high; it's per 1M tokens.";
  return null;
}

export function getModelInfo(id: string, catalog: CatalogModel[] = currentCatalog): CatalogModel | undefined {
  return catalog.find((m) => m.id === id);
}

export function modelLabel(id: string) {
  return getModelInfo(id)?.label ?? parseModelId(id)?.model ?? id;
}

export type Usage = { inputTokens?: number; outputTokens?: number };

export function estimateCostUsd(modelId: string, usage: Usage, catalog: CatalogModel[] = currentCatalog): number | undefined {
  const info = getModelInfo(modelId, catalog);
  if (!info) return undefined;
  const input = ((usage.inputTokens ?? 0) / 1_000_000) * info.input;
  const output = ((usage.outputTokens ?? 0) / 1_000_000) * info.output;
  return input + output;
}
