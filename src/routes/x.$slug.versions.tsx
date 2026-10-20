import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, GitCompare, Pencil, Play, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useExtractor } from "@/components/extractor-context";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/input";
import { Badge, EmptyState, Kbd, Spinner, Tooltip } from "@/components/ui/misc";
import { Select, useConfirm } from "@/components/ui/overlay";
import { SchemaEditor } from "@/components/schema-editor";
import { cn } from "@/lib/cn";
import { readDraft, storeDraft } from "@/lib/draft";
import { countFields, stableStringify, validateFields, type Field, type FieldSpec } from "@/lib/fields";
import { errorMessage } from "@/lib/errors";
import { modKey, useHotkey } from "@/lib/hooks";
import { formatDateTime, formatRelative } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import { diffFields, diffLines } from "@/lib/version-diff";

type Kind = "prompts" | "schemas";

export const Route = createFileRoute("/x/$slug/versions")({
  validateSearch: (search: Record<string, unknown>): { kind?: Kind } =>
    search.kind === "schemas" ? { kind: "schemas" } : {},
  component: VersionsPage,
});

type Check = FunctionReturnType<typeof api.evals.list>[number];
type PromptVersion = FunctionReturnType<typeof api.versions.prompts>[number];
type SchemaVersion = FunctionReturnType<typeof api.versions.schemas>[number];
type Version = { id: string; version: number; createdAt: number; prompt?: PromptVersion; schema?: SchemaVersion };

/** Every saved prompt and schema: when, how often it ran, how it scored, and what changed between two. */
function VersionsPage() {
  const extractor = useExtractor();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const kind: Kind = search.kind ?? "prompts";
  const prompts = useQuery(api.versions.prompts, { extractorId: extractor._id });
  const schemas = useQuery(api.versions.schemas, { extractorId: extractor._id });
  const usage = useQuery(api.versions.usage, { extractorId: extractor._id });
  const checks = useQuery(api.evals.list, { extractorId: extractor._id });
  const [open, setOpen] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  // Writing a new version, starting from `baseId`.
  const [editing, setEditing] = useState<{ baseId: string } | null>(null);
  // A version just saved: opened in the list once it shows up.
  const [openVersion, setOpenVersion] = useState<number | null>(null);

  if (!prompts || !schemas || !usage || !checks) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  const versions: Version[] =
    kind === "prompts"
      ? prompts.map((p) => ({ id: p._id, version: p.version, createdAt: p.createdAt, prompt: p }))
      : schemas.map((s) => ({ id: s._id, version: s.version, createdAt: s.createdAt, schema: s }));
  const latest = versions[0]?.id;
  const runCounts = kind === "prompts" ? usage.prompts : usage.schemas;
  const checksFor = (id: string) => checks.filter((c) => (kind === "prompts" ? c.promptVersionId : c.schemaVersionId) === id);
  const pickedVersions = picked.map((id) => versions.find((v) => v.id === id)).filter((v): v is Version => Boolean(v));

  function loadIntoPlayground(v: Version) {
    const current = readDraft(extractor._id, {
      prompt: extractor.latestPrompt?.text ?? "",
      fields: (extractor.latestSchema?.fields as Field[] | undefined) ?? [],
      model: extractor.defaultModel,
    });
    storeDraft(extractor._id, v.prompt ? { ...current, prompt: v.prompt.text } : { ...current, fields: v.schema!.fields });
    toast.success(`Loaded ${v.prompt ? "prompt" : "schema"} v${v.version}. The next run uses it.`);
    navigate({ to: "/x/$slug", params: { slug: extractor.slug } });
  }

  if (editing && versions.some((v) => v.id === editing.baseId)) {
    return (
      <VersionEditor
        kind={kind}
        versions={versions}
        initialBaseId={editing.baseId}
        onCancel={() => setEditing(null)}
        onSaved={(version) => {
          setEditing(null);
          setOpen(null);
          setOpenVersion(version);
        }}
        onUse={loadIntoPlayground}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium tracking-[-0.015em]">Versions</h2>
            <p className="mt-0.5 text-xs text-muted">
              Every saved prompt and schema, how often it ran and how it scored. Tick two to see what changed between them.
            </p>
          </div>
          <div className="flex items-center gap-2">
          {latest ? (
            <Button variant="primary" size="sm" onClick={() => setEditing({ baseId: latest })}>
              <Plus /> New {kind === "prompts" ? "prompt" : "schema"}
            </Button>
          ) : null}
          <Segmented<Kind>
            value={kind}
            onChange={(next) => {
              setOpen(null);
              setPicked([]);
              navigate({ search: next === "schemas" ? { kind: next } : {}, replace: true });
            }}
            options={[
              { value: "prompts", label: `Prompts ${prompts.length}` },
              { value: "schemas", label: `Schemas ${schemas.length}` },
            ]}
          />
          </div>
        </header>

        <section className={cn("mt-4 overflow-hidden rounded-lg border bg-panel", picked.length ? "border-accent/40" : "border-dashed border-line")}>
          <div className={cn("flex min-h-10 flex-wrap items-center gap-2 px-4 py-2 text-xs", picked.length === 2 && "border-b border-line")}>
            <GitCompare className="size-3.5 text-muted" />
            <span className="font-medium">Compare</span>
            {pickedVersions
              .sort((a, b) => a.version - b.version)
              .map((v) => (
                <span key={v.id} className="flex items-center gap-1 rounded-md bg-sunken px-2 py-0.5 text-ink-2">
                  v{v.version}
                  <button type="button" aria-label="Remove from comparison" onClick={() => setPicked((p) => p.filter((x) => x !== v.id))} className="text-faint hover:text-ink">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            <span className="text-muted">
              {picked.length === 0 ? `Tick two ${kind === "prompts" ? "prompts" : "schemas"} to see what changed.` : picked.length === 1 ? "Tick one more." : null}
            </span>
          </div>
          {pickedVersions.length === 2 ? <VersionDiff a={pickedVersions[0]} b={pickedVersions[1]} /> : null}
        </section>

        <div className="mt-4 overflow-hidden rounded-lg border border-line bg-panel">
          {versions.length === 0 ? (
            <EmptyState title={`No ${kind} saved yet`}>Run something in the playground and its prompt and schema are saved as versions.</EmptyState>
          ) : (
            versions.map((v) => {
              const isOpen = open === v.id || (open === null && openVersion === v.version);
              const vChecks = checksFor(v.id);
              const best = bestCheck(vChecks);
              return (
                <div key={v.id} className="border-b border-line/70 last:border-0">
                  <div
                    onClick={() => {
                      setOpenVersion(null);
                      setOpen(isOpen ? null : v.id);
                    }}
                    className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-[12.5px] hover:bg-sunken/60", isOpen && "bg-sunken/60")}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Compare v${v.version}`}
                      checked={picked.includes(v.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => setPicked((p) => (p.includes(v.id) ? p.filter((x) => x !== v.id) : [...p, v.id].slice(-2)))}
                      className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
                    />
                    <span className="tabular w-8 font-medium">v{v.version}</span>
                    {v.id === latest ? <Badge tone="accent">Latest</Badge> : null}
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {v.prompt ? firstLine(v.prompt.text) : schemaSummary(v.schema!.fields)}
                    </span>
                    <span className="tabular w-20 text-right text-muted">
                      {runCounts[v.id] ?? 0} {(runCounts[v.id] ?? 0) === 1 ? "run" : "runs"}
                    </span>
                    <span className="w-56 truncate text-right">
                      {best ? (
                        <Tooltip content={`Best of ${vChecks.length} accuracy ${vChecks.length === 1 ? "check" : "checks"}`}>
                          <span className="tabular cursor-help">
                            <CheckScore check={best} /> <span className="text-muted">{modelLabel(best.model)}</span>
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="text-faint">No accuracy check</span>
                      )}
                    </span>
                    <Tooltip content={formatDateTime(v.createdAt)}>
                      <span className="w-24 text-right text-muted">{formatRelative(v.createdAt)}</span>
                    </Tooltip>
                    <ChevronRight className={cn("size-3.5 text-faint transition-transform", isOpen && "rotate-90")} />
                  </div>
                  {isOpen ? (
                    <div className="border-t border-line bg-bg/40 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-2xs text-muted">
                          {vChecks.length
                            ? vChecks.map((c) => `${modelLabel(c.model)} ${scoreText(c)}`).join(" · ")
                            : "Not in any accuracy check yet."}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => setEditing({ baseId: v.id })}>
                            <Pencil /> Edit as new version
                          </Button>
                          <Button size="sm" onClick={() => loadIntoPlayground(v)}>
                            <Play /> Use in next run
                          </Button>
                        </div>
                      </div>
                      {v.prompt ? (
                        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel p-3 font-mono text-[12px] leading-[19px] text-ink-2">
                          {v.prompt.text}
                        </pre>
                      ) : (
                        <FieldList fields={v.schema!.fields} />
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Writes a new prompt or schema version with room to think: the editor on one side and, live,
 * what changed from the version it started from. Saving only saves; it never runs anything.
 */
function VersionEditor({
  kind,
  versions,
  initialBaseId,
  onCancel,
  onSaved,
  onUse,
}: {
  kind: Kind;
  versions: Version[];
  initialBaseId: string;
  onCancel: () => void;
  onSaved: (version: number) => void;
  onUse: (version: Version) => void;
}) {
  const extractor = useExtractor();
  const savePrompt = useMutation(api.versions.savePrompt);
  const saveSchema = useMutation(api.versions.saveSchema);
  const confirm = useConfirm();
  const [baseId, setBaseId] = useState(initialBaseId);
  const base = versions.find((v) => v.id === baseId) ?? versions[0];
  const [text, setText] = useState(base.prompt?.text ?? "");
  const [fields, setFields] = useState<Field[]>(base.schema?.fields ?? []);
  const [saving, setSaving] = useState(false);

  const isPrompt = kind === "prompts";
  const changed = isPrompt ? text !== base.prompt?.text : stableStringify(fields) !== stableStringify(base.schema?.fields ?? []);
  const schemaErrors = isPrompt ? [] : validateFields(fields);
  const next = Math.max(...versions.map((v) => v.version)) + 1;
  const canSave = changed && !saving && (isPrompt ? text.trim().length > 0 : schemaErrors.length === 0);

  async function leave() {
    if (changed) {
      const ok = await confirm({
        title: "Discard this version?",
        body: "Your changes aren't saved.",
        confirmLabel: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    onCancel();
  }

  async function changeBase(id: string) {
    if (changed) {
      const ok = await confirm({
        title: "Start from another version?",
        body: "Your changes are replaced by that version.",
        confirmLabel: "Replace",
        danger: true,
      });
      if (!ok) return;
    }
    const picked = versions.find((v) => v.id === id);
    if (!picked) return;
    setBaseId(id);
    setText(picked.prompt?.text ?? "");
    setFields(picked.schema?.fields ?? []);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const version = isPrompt
        ? await savePrompt({ extractorId: extractor._id, text })
        : await saveSchema({ extractorId: extractor._id, fields });
      const label = isPrompt ? "prompt" : "schema";
      if (version < next) {
        toast.info(`That's the same as ${label} v${version}, so nothing new was saved.`);
      } else {
        const saved: Version = isPrompt
          ? { id: "", version, createdAt: Date.now(), prompt: { ...base.prompt!, text, version } }
          : { id: "", version, createdAt: Date.now(), schema: { ...base.schema!, fields, version } };
        toast.success(`Saved ${label} v${version}.`, {
          action: { label: "Use in next run", onClick: () => onUse(saved) },
        });
      }
      onSaved(version);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  useHotkey("mod+s", () => save());

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel px-6 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium">
            New {isPrompt ? "prompt" : "schema"} <span className="text-muted">v{next}</span>
          </h2>
          <p className="text-2xs text-muted">Saving only saves the version. Nothing runs until you use it.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          Start from
          <div className="w-40">
            <Select
              size="sm"
              ariaLabel="Start from version"
              value={baseId}
              onValueChange={changeBase}
              options={versions.map((v) => ({ value: v.id, label: `v${v.version}${v.id === versions[0].id ? " (latest)" : ""}` }))}
            />
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={leave}>
            Cancel
          </Button>
          <Tooltip content={!changed ? `No changes from v${base.version} yet.` : schemaErrors[0]}>
            <span>
              <Button variant="primary" loading={saving} disabled={!canSave} onClick={save}>
                Save as v{next} <Kbd className="ml-0.5">{modKey()}S</Kbd>
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-px bg-line lg:grid-cols-2">
        <section className="flex min-h-0 flex-col bg-panel">
          <div className="flex h-9 shrink-0 items-center border-b border-line/70 px-4 eyebrow text-faint">
            {isPrompt ? "Prompt" : "Fields"}
            {isPrompt ? <span className="tabular ml-auto normal-case tracking-normal text-faint">~{Math.ceil(text.length / 4).toLocaleString()} tokens</span> : null}
          </div>
          {isPrompt ? (
            <textarea
              value={text}
              autoFocus
              spellCheck={false}
              aria-label="Prompt"
              onChange={(e) => setText(e.target.value)}
              className="min-h-0 flex-1 resize-none bg-panel px-4 py-3 font-mono text-[12.5px] leading-[20px] text-ink outline-none"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              <SchemaEditor fields={fields} onChange={setFields} />
              {schemaErrors.length ? (
                <div className="mx-2 mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-xs text-bad">
                  {schemaErrors.slice(0, 4).map((e) => (
                    <div key={e}>{e}</div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
        <section className="flex min-h-0 flex-col bg-panel">
          <div className="flex h-9 shrink-0 items-center border-b border-line/70 px-4 eyebrow text-faint">Changes from v{base.version}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {changed ? (
              <VersionDiff
                a={base}
                b={isPrompt ? { id: "draft", version: next, createdAt: 0, prompt: { ...base.prompt!, text } } : { id: "draft", version: next, createdAt: 0, schema: { ...base.schema!, fields } }}
              />
            ) : (
              <p className="px-4 py-6 text-center text-xs text-muted">No changes yet. Edit on the left and the differences show up here.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function VersionDiff({ a, b }: { a: Version; b: Version }) {
  const [before, after] = a.version < b.version ? [a, b] : [b, a];
  if (before.prompt && after.prompt) {
    const lines = diffLines(before.prompt.text, after.prompt.text);
    const added = lines.filter((l) => l.kind === "added").length;
    const removed = lines.filter((l) => l.kind === "removed").length;
    return (
      <div>
        <p className="px-4 py-2 text-xs text-ink-2">
          v{before.version} → v{after.version}:{" "}
          {added || removed ? (
            <>
              <span className="text-ok">{added} lines added</span>, <span className="text-bad">{removed} removed</span>.
            </>
          ) : (
            "identical text."
          )}
        </p>
        <pre className="max-h-[560px] overflow-auto border-t border-line font-mono text-[12px] leading-[19px]">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap px-4",
                line.kind === "added" && "bg-ok-soft text-ink",
                line.kind === "removed" && "bg-bad-soft text-ink-2 line-through decoration-bad/40",
                line.kind === "same" && "text-muted",
              )}
            >
              <span className="mr-2 select-none text-faint">{line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}</span>
              {line.text || " "}
            </div>
          ))}
        </pre>
      </div>
    );
  }
  const changes = diffFields(before.schema!.fields, after.schema!.fields);
  return (
    <div className="text-[12.5px]">
      <p className="px-4 py-2 text-xs text-ink-2">
        v{before.version} → v{after.version}: {changes.length ? `${changes.length} ${changes.length === 1 ? "field" : "fields"} changed.` : "the same fields."}
      </p>
      {changes.map((c) => (
        <div key={`${c.kind}:${c.path}`} className="flex items-baseline gap-3 border-t border-line/70 px-4 py-1.5">
          <span
            className={cn(
              "w-16 shrink-0 text-2xs font-medium",
              c.kind === "added" ? "text-ok" : c.kind === "removed" ? "text-bad" : "text-warn",
            )}
          >
            {c.kind === "added" ? "Added" : c.kind === "removed" ? "Removed" : "Changed"}
          </span>
          <span className="font-mono text-[12px] text-ink-2">{c.path}</span>
          <span className="text-xs text-muted">{c.kind === "changed" ? c.changes.join(", ") : c.spec.type}</span>
        </div>
      ))}
    </div>
  );
}

function FieldList({ fields }: { fields: Field[] }) {
  const rows: Array<{ path: string; spec: FieldSpec; depth: number }> = [];
  const walk = (list: Field[], prefix: string, depth: number) => {
    for (const field of list) {
      const path = prefix ? `${prefix}.${field.key}` : field.key;
      rows.push({ path, spec: field, depth });
      if (field.type === "object") walk(field.fields ?? [], path, depth + 1);
      if (field.type === "array" && field.item?.type === "object") walk(field.item.fields ?? [], `${path}[]`, depth + 1);
    }
  };
  walk(fields, "", 0);
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel text-[12.5px]">
      {rows.map((row) => (
        <div key={row.path} className="grid grid-cols-[minmax(0,1fr)_90px_minmax(0,2fr)] gap-3 border-b border-line/70 px-3 py-1.5 last:border-0">
          <span className="flex items-center gap-1 break-all font-mono text-[12px] text-ink-2" style={{ paddingLeft: row.depth * 12 }}>
            {row.path.split(".").pop()}
            {row.spec.important ? <Star className="size-3 shrink-0 fill-current" aria-label="Important" /> : null}
          </span>
          <span className="text-muted">{row.spec.type === "array" ? `list of ${row.spec.item?.type ?? "string"}` : row.spec.type}</span>
          <span className="text-muted">{row.spec.description}</span>
        </div>
      ))}
    </div>
  );
}

function CheckScore({ check }: { check: Check }) {
  const s = check.summary;
  const important = s.importantTotalFields > 0;
  return (
    <span className={cn("font-medium", (important ? s.importantMatchedFields === s.importantTotalFields : s.matchedFields === s.totalFields) ? "text-ok" : "text-ink")}>
      {important ? (
        <>
          <Star className="mr-0.5 inline size-3 -translate-y-px fill-current" aria-label="Important fields" />
          {s.importantMatchedFields}/{s.importantTotalFields}
        </>
      ) : (
        `${s.matchedFields}/${s.totalFields}`
      )}
    </span>
  );
}

function scoreText(check: Check) {
  const s = check.summary;
  return s.importantTotalFields > 0 ? `★ ${s.importantMatchedFields}/${s.importantTotalFields}` : `${s.matchedFields}/${s.totalFields}`;
}

/** The best finished check: most important fields right, then most fields overall. */
function bestCheck(checks: Check[]) {
  const done = checks.filter((c) => c.summary.running === 0 && c.summary.totalFields > 0);
  const rate = (a: number, b: number) => (b ? a / b : 0);
  return done.sort(
    (a, b) =>
      rate(b.summary.importantMatchedFields, b.summary.importantTotalFields) - rate(a.summary.importantMatchedFields, a.summary.importantTotalFields) ||
      rate(b.summary.matchedFields, b.summary.totalFields) - rate(a.summary.matchedFields, a.summary.totalFields),
  )[0];
}

function firstLine(text: string) {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "(empty)";
}

function schemaSummary(fields: Field[]) {
  const important = countImportant(fields);
  return `${countFields(fields)} fields${important ? ` · ${important} important` : ""}: ${fields.map((f) => f.key).join(", ")}`;
}

function countImportant(fields: Field[], inherited = false): number {
  return fields.reduce((n, f) => {
    const imp = inherited || Boolean(f.important);
    if (f.type === "object") return n + countImportant(f.fields ?? [], imp);
    if (f.type === "array") return n + (f.item?.type === "object" ? countImportant(f.item.fields ?? [], imp || Boolean(f.item.important)) : imp ? 1 : 0);
    return n + (imp ? 1 : 0);
  }, 0);
}
