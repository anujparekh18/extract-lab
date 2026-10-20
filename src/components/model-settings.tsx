import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Eye, EyeOff, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { useModels, useSetup } from "@/lib/hooks";
import { PROVIDERS, modelIdProblem, pickerModels, priceProblem, type CatalogModel, type ProviderId } from "@/lib/models";
import { FileSupportBadge, groupByProvider } from "./model-picker";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";
import { Badge, Tooltip } from "./ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger, Select, useConfirm } from "./ui/overlay";

/**
 * The model list, synced daily from models.dev and editable in place: rename, fix a price, hide
 * from pickers, or add a model the catalog doesn't have yet. Prices only drive cost estimates.
 */
export function ModelSettings() {
  const catalog = useModels();
  const setup = useSetup();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Providers without a key start collapsed; their models can't run anyway.
  const [expanded, setExpanded] = useState<Partial<Record<ProviderId, boolean>>>({});
  // Hidden models stay listed here (dimmed) so they can be shown again.
  const listed = pickerModels(catalog, { query, showAll, includeHidden: true });
  const olderCount = catalog.length - pickerModels(catalog, { includeHidden: true }).length;

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line pl-4 pr-2">
        <Search className="size-3.5 shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${catalog.length} models`}
          aria-label="Search models"
          className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
        />
        <SyncStatus />
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_72px_84px_84px_56px] gap-2 border-b border-line px-4 py-1.5 eyebrow text-faint sm:grid">
        <span>Name</span>
        <span>Reads</span>
        <span className="text-right">In / 1M</span>
        <span className="text-right">Out / 1M</span>
        <span />
      </div>
      {groupByProvider(listed).map(({ provider, models: rows }) => {
        const hasKey = Boolean(setup.providers?.[provider]);
        const open = Boolean(query) || (expanded[provider] ?? hasKey);
        return (
          <div key={provider} className="border-b border-line last:border-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded((prev) => ({ ...prev, [provider]: !open }))}
              className="flex w-full items-center gap-2 bg-sunken/60 px-4 py-1.5 text-left hover:bg-sunken"
            >
              <ChevronRight className={cn("size-3 shrink-0 text-faint transition-transform", open && "rotate-90")} />
              <span className="eyebrow text-faint">{PROVIDERS[provider].label}</span>
              <span className="text-2xs text-faint">
                {rows.length} {rows.length === 1 ? "model" : "models"}
                {hasKey ? "" : " · no API key"}
              </span>
            </button>
            {open ? rows.map((model) => <ModelRow key={model.id} model={model} />) : null}
          </div>
        );
      })}
      {listed.length === 0 ? <p className="px-4 py-6 text-center text-xs text-muted">No models match "{query}".</p> : null}
      {!query && olderCount > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="flex h-8 w-full items-center justify-center border-t border-line text-xs text-muted hover:bg-hover hover:text-ink"
        >
          {showAll ? "Show current models only" : `Show ${olderCount} older or retiring models`}
        </button>
      ) : null}
      <AddModel />
    </div>
  );
}

/** "Updated 2 hours ago" with a refresh button, next to the search box. */
function SyncStatus() {
  const status = useQuery(api.modelCatalog.status, {});
  const refresh = useAction(api.modelCatalog.refresh);
  const [refreshing, setRefreshing] = useState(false);
  if (!status) return null;

  const label = status.syncedAt
    ? `Updated ${formatRelative(status.syncedAt)}`
    : status.attemptedAt
      ? "Using built-in list"
      : "Downloading…";
  const tip = status.error
    ? `Last refresh failed: ${status.error}`
    : status.syncedAt
      ? `${status.count} models from models.dev. Refreshes daily.`
      : "The model list couldn't be downloaded yet.";

  return (
    <Tooltip content={tip}>
      <Button
        variant="ghost"
        size="sm"
        loading={refreshing}
        className={cn("shrink-0 text-muted", status.error && "text-warn")}
        onClick={async () => {
          setRefreshing(true);
          try {
            const result = await refresh({});
            if (!result.ok) toast.error(`Couldn't refresh: ${result.error}`);
            else if (!result.skipped) toast.success(`Model list updated: ${result.count} models.`);
          } catch (error) {
            toast.error(errorMessage(error));
          } finally {
            setRefreshing(false);
          }
        }}
      >
        {refreshing ? null : <RefreshCw />} {label}
      </Button>
    </Tooltip>
  );
}

function ModelRow({ model }: { model: CatalogModel }) {
  const update = useMutation(api.models.update);
  const reset = useMutation(api.models.reset);
  const confirm = useConfirm();

  async function save(changes: { label?: string; input?: number; output?: number; hidden?: boolean }) {
    try {
      await update({ modelId: model.id, ...changes });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_84px_84px_56px] items-center gap-2 px-4 py-1.5 sm:grid-cols-[minmax(0,1fr)_72px_84px_84px_56px]",
        model.hidden && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <InlineText
          value={model.label}
          title={`Model id: ${model.model}`}
          ariaLabel={`Name of ${model.id}`}
          onCommit={(label) => save({ label })}
        />
        {model.custom ? <Badge>Added</Badge> : model.edited ? <Badge>Edited</Badge> : null}
        {model.deprecated ? <Badge tone="warn">Retiring</Badge> : null}
      </div>
      <span className="hidden sm:block">
        <FileSupportBadge files={model.files} />
      </span>
      <InlinePrice value={model.input} ariaLabel={`Input price of ${model.label}`} onCommit={(input) => save({ input })} />
      <InlinePrice value={model.output} ariaLabel={`Output price of ${model.label}`} onCommit={(output) => save({ output })} />
      <div className="flex justify-end gap-0.5">
        <Tooltip content={model.hidden ? "Hidden from model pickers. Click to show." : "Hide from model pickers"}>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label={model.hidden ? `Show ${model.label}` : `Hide ${model.label}`}
            onClick={() => save({ hidden: !model.hidden })}
          >
            {model.hidden ? <EyeOff /> : <Eye />}
          </Button>
        </Tooltip>
        {model.custom || model.edited ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label={`More for ${model.label}`}>
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {model.custom ? (
                <MenuItem
                  danger
                  icon={<Trash2 />}
                  onSelect={async () => {
                    const ok = await confirm({
                      title: `Remove ${model.label}?`,
                      body: "It disappears from model pickers. Past runs keep their results and costs.",
                      confirmLabel: "Remove",
                      danger: true,
                    });
                    if (ok) await reset({ modelId: model.id }).catch((e) => toast.error(errorMessage(e)));
                  }}
                >
                  Remove
                </MenuItem>
              ) : (
                <MenuItem icon={<RotateCcw />} onSelect={() => reset({ modelId: model.id }).catch((e) => toast.error(errorMessage(e)))}>
                  Use the catalog's name and prices
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        ) : (
          <span className="size-7" />
        )}
      </div>
    </div>
  );
}

/** Looks like text until focused; saves on Enter or blur, reverts on Escape or failure. */
function InlineText({
  value,
  title,
  ariaLabel,
  onCommit,
}: {
  value: string;
  title?: string;
  ariaLabel: string;
  onCommit: (value: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label={ariaLabel}
      title={title}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      onBlur={async () => {
        const next = (draft ?? value).trim();
        setDraft(null);
        if (next && next !== value) await onCommit(next);
      }}
      className="h-7 min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 text-[13px] text-ink outline-none hover:border-line focus:border-accent focus:bg-panel"
    />
  );
}

function InlinePrice({ value, ariaLabel, onCommit }: { value: number; ariaLabel: string; onCommit: (value: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex h-7 items-center rounded-md border border-transparent px-1.5 hover:border-line focus-within:border-accent focus-within:bg-panel">
      <span className="text-2xs text-faint">$</span>
      <input
        aria-label={ariaLabel}
        inputMode="decimal"
        value={draft ?? String(value)}
        onFocus={(e) => {
          setDraft(String(value));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(String(value));
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        onBlur={async () => {
          const text = (draft ?? "").trim();
          setDraft(null);
          if (!text || Number(text) === value) return;
          const next = Number(text);
          const problem = priceProblem(next);
          if (problem) {
            toast.error(problem);
            return;
          }
          await onCommit(next);
        }}
        className="tabular w-full min-w-0 bg-transparent text-right text-[12.5px] text-ink outline-none"
      />
    </div>
  );
}

function AddModel() {
  const add = useMutation(api.models.add);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("google");
  const [model, setModel] = useState("");
  const [label, setLabel] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <div className="border-t border-line px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          <Plus /> Add a model
        </Button>
      </div>
    );
  }

  const idProblem = model ? modelIdProblem(model) : null;
  const prices = [Number(input), Number(output)];
  const priceIssue = input === "" || output === "" ? null : (priceProblem(prices[0]) ?? priceProblem(prices[1]));
  const ready = model.trim() && !idProblem && input !== "" && output !== "" && !priceIssue;

  async function submit() {
    setSaving(true);
    try {
      await add({ provider, model: model.trim(), label: label.trim() || model.trim(), input: prices[0], output: prices[1] });
      toast.success(`Added ${label.trim() || model.trim()}. It's in every model picker now.`);
      setModel("");
      setLabel("");
      setInput("");
      setOutput("");
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="text-[13px] font-medium">Add a model</div>
      <p className="mt-0.5 text-xs text-muted">
        For a model the catalog doesn't list yet: use the id from the provider's docs. It works as soon as that provider's key is set.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Label>Provider</Label>
          <Select<ProviderId>
            value={provider}
            onValueChange={setProvider}
            options={(Object.keys(PROVIDERS) as ProviderId[]).map((id) => ({ value: id, label: PROVIDERS[id].label }))}
          />
        </div>
        <div>
          <Label htmlFor="add-model-id">Model id</Label>
          <Input
            id="add-model-id"
            value={model}
            placeholder={provider === "google" ? "gemini-3.8-flash" : provider === "openai" ? "gpt-5.6-terra" : "claude-sonnet-5"}
            onChange={(e) => setModel(e.target.value)}
            className="font-mono text-[12.5px]"
          />
        </div>
        <div>
          <Label htmlFor="add-model-label" hint="Optional">
            Name
          </Label>
          <Input id="add-model-label" value={label} placeholder={model || "Shown in pickers"} onChange={(e) => setLabel(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:w-[340px]">
        <div>
          <Label htmlFor="add-model-input">Input $ / 1M tokens</Label>
          <Input id="add-model-input" inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0.75" />
        </div>
        <div>
          <Label htmlFor="add-model-output">Output $ / 1M tokens</Label>
          <Input id="add-model-output" inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} placeholder="3.75" />
        </div>
      </div>
      {idProblem || priceIssue ? <p className="mt-2 text-xs text-bad">{idProblem ?? priceIssue}</p> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" loading={saving} disabled={!ready} onClick={submit}>
          Add model
        </Button>
      </div>
    </div>
  );
}
