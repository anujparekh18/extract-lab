import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight, ChevronDown, FileInput, Play } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { countFields, inferFields, jsonSchemaToFields, stableStringify, validateFields, type Field } from "@/lib/fields";
import { formatRelative } from "@/lib/format";
import { modKey } from "@/lib/hooks";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { Kbd, Tooltip } from "../ui/misc";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/overlay";
import { ModelPicker } from "../model-picker";
import { SchemaEditor } from "../schema-editor";
import { CollapseButton } from "./collapsible";
import type { Draft } from "@/lib/draft";

export type { Draft };

type Tab = "prompt" | "schema";

export function EditorPane({
  extractorId,
  draft,
  onChange,
  latestPromptVersion,
  latestSchemaVersion,
  onSave,
  saving,
  onRun,
  running,
  canRun,
  documentTitle,
  onCollapse,
}: {
  extractorId: Id<"extractors">;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  latestPromptVersion: number;
  latestSchemaVersion: number;
  onSave: () => void;
  saving: boolean;
  onRun: () => void;
  running: boolean;
  canRun: { ok: boolean; reason?: string };
  /** The document Run extracts. */
  documentTitle?: string;
  onCollapse?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("prompt");
  const schemaErrors = validateFields(draft.fields);
  const prompts = useQuery(api.versions.prompts, { extractorId });
  const schemas = useQuery(api.versions.schemas, { extractorId });
  // Which saved version the editor holds right now; null once it's been edited into something new.
  const promptVersion = prompts?.find((p) => p.text === draft.prompt)?.version ?? null;
  const fieldsKey = stableStringify(draft.fields);
  const schemaVersion = schemas?.find((s) => stableStringify(s.fields) === fieldsKey)?.version ?? null;
  const loaded = prompts !== undefined && schemas !== undefined;
  const edited = loaded && (promptVersion === null || schemaVersion === null);

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <span className="eyebrow mr-1 text-faint">Next run</span>
        <VersionPicker
          label="Prompt"
          current={promptVersion}
          loaded={loaded}
          latest={latestPromptVersion}
          versions={(prompts ?? []).map((p) => ({ id: p._id, version: p.version, createdAt: p.createdAt, preview: firstLine(p.text) }))}
          onPick={(id) => {
            const picked = prompts?.find((p) => p._id === id);
            if (picked) onChange({ prompt: picked.text });
          }}
          compareKind="prompts"
        />
        <VersionPicker
          label="Schema"
          current={schemaVersion}
          loaded={loaded}
          latest={latestSchemaVersion}
          versions={(schemas ?? []).map((s) => ({
            id: s._id,
            version: s.version,
            createdAt: s.createdAt,
            preview: `${countFields(s.fields)} fields: ${s.fields.map((f) => f.key).join(", ")}`,
          }))}
          onPick={(id) => {
            const picked = schemas?.find((s) => s._id === id);
            if (picked) onChange({ fields: picked.fields });
          }}
          compareKind="schemas"
        />
        <div className="ml-auto flex items-center gap-1">
          {edited ? (
            <Tooltip content={<>Save your edits as a new version ({modKey()} S). Running saves them too.</>}>
              <Button size="sm" onClick={onSave} loading={saving} disabled={schemaErrors.length > 0}>
                Save
              </Button>
            </Tooltip>
          ) : null}
          {onCollapse ? <CollapseButton label="the prompt and schema" vertical onClick={onCollapse} /> : null}
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line/70 px-2">
        <EditorTab active={tab === "prompt"} onClick={() => setTab("prompt")} dirty={loaded && promptVersion === null}>
          Prompt
        </EditorTab>
        <EditorTab
          active={tab === "schema"}
          onClick={() => setTab("schema")}
          dirty={loaded && schemaVersion === null}
          error={schemaErrors.length > 0}
        >
          Schema
        </EditorTab>
        {tab === "schema" ? (
          <div className="ml-auto">
            <SchemaImport onImport={(fields) => onChange({ fields })} />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "prompt" ? (
          <div className="flex h-full flex-col">
            <Textarea
              value={draft.prompt}
              spellCheck={false}
              aria-label="Prompt"
              placeholder="Tell the model what this document is and any rules for tricky fields. The schema's field descriptions are sent too."
              onChange={(e) => onChange({ prompt: e.target.value })}
              className="min-h-0 flex-1 resize-none rounded-none border-0 bg-panel px-4 py-3 font-mono text-[12.5px] leading-[20px] hover:border-0 focus:ring-0"
            />
            <div className="tabular flex h-7 shrink-0 items-center justify-end gap-3 border-t border-line/70 px-3 text-2xs text-faint">
              <span>~{Math.ceil(draft.prompt.length / 4).toLocaleString()} tokens</span>
            </div>
          </div>
        ) : (
          <div className="px-2 py-2">
            <SchemaEditor fields={draft.fields} onChange={(fields) => onChange({ fields })} />
            {schemaErrors.length > 0 ? (
              <div className="mx-2 mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
                {schemaErrors.slice(0, 4).map((e) => (
                  <div key={e}>{e}</div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-sunken/40 px-3 pb-2 pt-1.5">
        <div className="flex items-center gap-1.5 text-2xs text-muted">
          <span className="eyebrow text-faint">Run on this document</span>
          {documentTitle ? <span className="min-w-0 truncate text-ink-2">{documentTitle}</span> : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <ModelPicker value={draft.model} onChange={(model) => onChange({ model })} className="w-52" />
          {!canRun.ok && canRun.reason ? <span className="min-w-0 flex-1 text-2xs leading-4 text-warn">{canRun.reason}</span> : null}
          <Tooltip content={canRun.ok ? (edited ? "Saves your edits as a new version, then runs." : undefined) : canRun.reason}>
            <span className="ml-auto">
              <Button variant="primary" onClick={onRun} loading={running} disabled={!canRun.ok}>
                {!running ? <Play /> : null}
                Run
                <Kbd className="ml-0.5">{modKey()}↵</Kbd>
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function EditorTab({
  active,
  dirty,
  error,
  onClick,
  children,
}: {
  active: boolean;
  dirty?: boolean;
  error?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors",
        active ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
      )}
    >
      {children}
      {error ? (
        <span className="size-1.5 rounded-full bg-bad" aria-label="Has errors" />
      ) : dirty ? (
        <span className="size-1.5 rounded-full bg-accent" aria-label="Unsaved changes" />
      ) : null}
    </button>
  );
}

/** Picks which saved version the next run starts from. Never switches the editor tab. */
function VersionPicker({
  label,
  current,
  loaded,
  latest,
  versions,
  onPick,
  compareKind,
}: {
  label: string;
  /** The saved version the editor matches, or null when it's been edited. */
  current: number | null;
  loaded: boolean;
  latest: number;
  versions: Array<{ id: string; version: number; createdAt: number; preview: string }>;
  onPick: (id: string) => void;
  compareKind: "prompts" | "schemas";
}) {
  const [open, setOpen] = useState(false);
  const { slug } = useParams({ from: "/x/$slug" });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-xs hover:border-line-strong hover:bg-hover"
          aria-label={`${label} version`}
        >
          <span className="text-muted">{label}</span>
          {!loaded ? (
            <span className="text-faint">…</span>
          ) : current === null ? (
            <span className="flex items-center gap-1 font-medium text-accent">
              <span className="size-1.5 rounded-full bg-accent" /> edited
            </span>
          ) : (
            <span className="font-medium">
              v{current}
              {current !== latest ? <span className="font-normal text-faint"> (older)</span> : null}
            </span>
          )}
          <ChevronDown className="size-3 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-1">
        <div className="px-2.5 py-1.5 text-2xs text-muted">
          Start the next run from a saved {label.toLowerCase()}. {current === null ? "This replaces your unsaved edits." : ""}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onPick(v.id);
                setOpen(false);
              }}
              className={cn("block w-full rounded-md px-2.5 py-2 text-left hover:bg-hover", v.version === current && "bg-accent-soft")}
            >
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium">
                  v{v.version}
                  {v.version === latest ? <span className="ml-1.5 font-normal text-faint">latest</span> : null}
                </span>
                <span className="text-faint">{formatRelative(v.createdAt)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 font-mono text-[11px] leading-4 text-muted">{v.preview}</p>
            </button>
          ))}
        </div>
        <Link
          to="/x/$slug/versions"
          params={{ slug }}
          search={compareKind === "schemas" ? { kind: "schemas" } : {}}
          className="mt-1 flex items-center justify-between rounded-md border-t border-line px-2.5 py-2 text-xs text-muted hover:bg-hover hover:text-ink"
        >
          See and compare all versions <ArrowRight className="size-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function firstLine(text: string) {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "(empty)";
}

function SchemaImport({ onImport }: { onImport: (fields: Field[]) => void }) {
  const [mode, setMode] = useState<"example" | "jsonschema" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      const fields = mode === "example" ? inferFields(Array.isArray(parsed) ? parsed : [parsed]) : jsonSchemaToFields(parsed);
      const problems = validateFields(fields);
      if (problems.length) throw new Error(problems[0]);
      onImport(fields);
      setMode(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that JSON.");
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <FileInput /> Import
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setMode("example")}>From example JSON…</MenuItem>
          <MenuItem onSelect={() => setMode("jsonschema")}>From JSON Schema…</MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open) setMode(null);
          setError(null);
        }}
        title={mode === "example" ? "Import from example JSON" : "Import from JSON Schema"}
        description={
          mode === "example"
            ? "Paste the JSON you want back (or an array of examples). Field types are inferred; add descriptions afterwards."
            : "Paste a JSON Schema object, e.g. from z.toJSONSchema() or Pydantic's model_json_schema()."
        }
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="primary" disabled={!text.trim()} onClick={submit}>
              Replace schema
            </Button>
          </>
        }
      >
        <Textarea
          value={text}
          autoFocus
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          className="h-72 resize-y font-mono text-[12px]"
          placeholder={mode === "example" ? '{ "invoice_number": "INV-001", "total": 120.5 }' : '{ "type": "object", "properties": { ... } }'}
        />
        {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
      </Dialog>
    </>
  );
}
