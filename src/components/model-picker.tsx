import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { useModels, useSetup } from "@/lib/hooks";
import { PROVIDERS, modelLabel, pickerModels, type CatalogModel, type FileSupport, type ProviderId } from "@/lib/models";
import { Badge, Tooltip } from "./ui/misc";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";

const FILE_LABEL: Record<FileSupport, string> = { pdf: "PDF", image: "Images", text: "Text only" };
const FILE_TIP: Record<FileSupport, string> = {
  pdf: "Reads PDFs, images, and text",
  image: "Reads images and text, but not PDFs",
  text: "Reads text only: no PDFs or images",
};

export function FileSupportBadge({ files, className }: { files: FileSupport; className?: string }) {
  return (
    <Tooltip content={FILE_TIP[files]}>
      <Badge tone={files === "text" ? "warn" : "neutral"} className={cn("cursor-help", className)}>
        {FILE_LABEL[files]}
      </Badge>
    </Tooltip>
  );
}

export function formatPrice(model: Pick<CatalogModel, "input" | "output">) {
  const money = (n: number) => `$${n < 1 ? Number(n.toFixed(3)) : Number(n.toFixed(2))}`;
  return `${money(model.input)} / ${money(model.output)}`;
}

/** Groups models by provider, keeping each provider's order (newest first from the catalog). */
export function groupByProvider(models: CatalogModel[]) {
  return (Object.keys(PROVIDERS) as ProviderId[])
    .map((provider) => ({ provider, models: models.filter((m) => m.provider === provider) }))
    .filter((group) => group.models.length > 0);
}

/**
 * Searchable model dropdown, fed by the synced catalog. Shows current models first, with the
 * rest one click away, and what each model can read.
 */
export function ModelPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const setup = useSetup();
  const catalog = useModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const models = useMemo(() => pickerModels(catalog, { query, showAll, keep: [value] }), [catalog, query, showAll, value]);
  const hiddenCount = pickerModels(catalog, { showAll: true }).length - pickerModels(catalog, { keep: [value] }).length;
  const groups = groupByProvider(models);
  const selectable = models.filter((m) => setup.providers?.[m.provider]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Model"
          className={cn(
            "inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink outline-none hover:border-line-strong focus:border-accent",
            className,
          )}
        >
          <span className="truncate">{modelLabel(value)}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-3.5 shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && selectable[0]) pick(selectable[0].id);
            }}
            placeholder="Search models"
            aria-label="Search models"
            className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
        </div>
        <div className="max-h-[360px] overflow-y-auto p-1">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted">No models match "{query}".</p>
          ) : (
            groups.map(({ provider, models: providerModels }) => {
              const hasKey = Boolean(setup.providers?.[provider]);
              return (
                <div key={provider} className="py-0.5">
                  <div className="flex items-center justify-between px-2 pb-1 pt-2 eyebrow text-faint">
                    {PROVIDERS[provider].label}
                    {!hasKey && !setup.loading ? <span className="normal-case tracking-normal">no API key</span> : null}
                  </div>
                  {providerModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      disabled={!hasKey}
                      onClick={() => pick(model.id)}
                      className="relative flex h-8 w-full items-center gap-2 rounded-md pl-7 pr-2 text-left text-[13px] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {model.id === value ? <Check className="absolute left-2 size-3.5 text-ink" /> : null}
                      <span className="min-w-0 flex-1 truncate">{model.label}</span>
                      {model.deprecated ? <Badge tone="warn">Retiring</Badge> : null}
                      <FileSupportBadge files={model.files} />
                      <span className="tabular w-[88px] shrink-0 text-right text-2xs text-muted" title="USD per 1M input / output tokens">
                        {formatPrice(model)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
        {!query && hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="flex h-8 w-full items-center justify-center border-t border-line text-xs text-muted hover:bg-hover hover:text-ink"
          >
            {showAll ? "Show current models only" : `Show ${hiddenCount} older models`}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
