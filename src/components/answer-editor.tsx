import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Braces, CircleHelp, Plus, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { parseLooseNumber } from "@/lib/compare";
import { emptyValue, fieldsToZod, isRecord, stableStringify, type Field, type FieldSpec } from "@/lib/fields";
import { errorMessage } from "@/lib/errors";
import { getAtPath, setAtPath } from "@/lib/paths";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { Tooltip } from "./ui/misc";
import { Dialog, useConfirm } from "./ui/overlay";

type AnswerDocument = {
  _id: Id<"documents">;
  expected?: unknown;
  expectedNotSure?: string[];
};

/**
 * Edits a document's correct answer as a form: one input per field, lists you can add to and
 * remove from, and a "not sure" switch for values nobody knows, which then aren't scored.
 * Typing an answer by hand is enough; `draft` (e.g. a model's output) only pre-fills it.
 */
export function AnswerEditor({
  document,
  fields,
  draft,
  onSaved,
  className,
}: {
  document: AnswerDocument;
  fields: Field[];
  /** Where to start when there's no saved answer yet, e.g. the latest run's output. */
  draft?: { value: unknown; label: string };
  onSaved?: () => void;
  className?: string;
}) {
  const setExpected = useMutation(api.documents.setExpected);
  const confirm = useConfirm();
  const saved = document.expected !== undefined;
  const initial = useMemo(
    () => ({
      value: saved ? document.expected : (draft?.value ?? emptyValue(fields)),
      notSure: document.expectedNotSure ?? [],
    }),
    // Re-read when the document or its saved answer changes, not on every render.
    [document._id, stableStringify(document.expected ?? null), (document.expectedNotSure ?? []).join("|"), saved ? "" : stableStringify(draft?.value ?? null)],
  );
  const [value, setValue] = useState<unknown>(initial.value);
  const [notSure, setNotSure] = useState<string[]>(initial.notSure);
  const [editingJson, setEditingJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = stableStringify(value) !== stableStringify(initial.value) || notSure.join("|") !== initial.notSure.join("|");

  // Follow the saved answer (another tab, the MCP) unless there are unsaved edits.
  useEffect(() => {
    if (dirty) return;
    setValue(initial.value);
    setNotSure(initial.notSure);
  }, [initial]);

  const problems = useMemo(() => answerProblems(fields, value), [fields, value]);

  const ctx: FormContext = {
    value,
    notSure,
    set: (path, next) => setValue((current: unknown) => setAtPath(current, path, next)),
    toggleNotSure: (path) =>
      setNotSure((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path].sort())),
    removeItem: (path, index) => {
      setValue((current: unknown) => {
        const list = getAtPath(current, path);
        return setAtPath(current, path, Array.isArray(list) ? list.filter((_, i) => i !== index) : []);
      });
      setNotSure((current) => shiftNotSure(current, path, index));
    },
  };

  async function save() {
    if (problems.length) return;
    setSaving(true);
    try {
      await setExpected({ id: document._id, expected: value, notSure });
      toast.success(saved ? "Correct answer updated." : "Correct answer saved. This document now counts toward accuracy.");
      onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/70 px-3 py-1.5 text-xs text-muted">
        <span className="min-w-0">
          {saved ? (
            <span className="font-medium text-ink-2">Saved correct answer</span>
          ) : draft ? (
            <>
              <span className="font-medium text-ink-2">Not saved yet.</span> Pre-filled from {draft.label}: check each value against
              the document.
            </>
          ) : (
            <>
              <span className="font-medium text-ink-2">Not saved yet.</span> Fill in what you know. Leave a field empty if the
              document doesn't have it; mark it <span className="font-medium">not sure</span> if you don't know.
            </>
          )}
          {notSure.length ? <span> · {notSure.length} not sure</span> : null}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditingJson(true)}>
          <Braces /> JSON
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <FieldsForm fields={fields} path="" ctx={ctx} />
      </div>

      <div className="shrink-0 border-t border-line px-3 py-2">
        {problems.length ? (
          <ul className="mb-2 space-y-0.5 text-2xs text-bad">
            {problems.slice(0, 4).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {saved ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm({
                  title: "Remove the correct answer?",
                  body: "This document stops counting toward accuracy. Checks that already ran keep their scores.",
                  confirmLabel: "Remove",
                  danger: true,
                });
                if (ok) await setExpected({ id: document._id, expected: null });
              }}
            >
              <Trash2 /> Remove
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {dirty ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setValue(initial.value);
                  setNotSure(initial.notSure);
                }}
              >
                Discard changes
              </Button>
            ) : null}
            <Button variant="primary" loading={saving} disabled={problems.length > 0 || (saved && !dirty)} onClick={save}>
              {saved ? "Save changes" : "Save as correct answer"}
            </Button>
          </div>
        </div>
      </div>

      <ExpectedJsonDialog
        open={editingJson}
        onOpenChange={setEditingJson}
        initial={value}
        onSave={async (next) => {
          setValue(next);
          setEditingJson(false);
        }}
      />
    </div>
  );
}

type FormContext = {
  value: unknown;
  notSure: string[];
  set: (path: string, next: unknown) => void;
  toggleNotSure: (path: string) => void;
  removeItem: (listPath: string, index: number) => void;
};

function join(path: string, key: string) {
  return path ? `${path}.${key}` : key;
}

function FieldsForm({ fields, path, ctx }: { fields: Field[]; path: string; ctx: FormContext }) {
  return (
    <div className="space-y-1">
      {fields.map((field) => (
        <SpecInput key={field.key} label={field.key} spec={field} path={join(path, field.key)} ctx={ctx} />
      ))}
    </div>
  );
}

function SpecInput({ label, spec, path, ctx, onRemove }: { label: string; spec: FieldSpec; path: string; ctx: FormContext; onRemove?: () => void }) {
  if (spec.type === "object") {
    return (
      <fieldset className="rounded-md border border-line px-2.5 pb-2 pt-1">
        <legend className="flex items-center gap-1 px-1 font-mono text-[12px] text-ink-2">
          {label}
          {spec.important ? <Star className="size-3 fill-current" aria-label="Important" /> : null}
          {onRemove ? <RemoveButton label={label} onClick={onRemove} /> : null}
        </legend>
        <FieldsForm fields={spec.fields ?? []} path={path} ctx={ctx} />
      </fieldset>
    );
  }
  if (spec.type === "array") {
    const item = spec.item ?? { type: "string" };
    const list = getAtPath(ctx.value, path);
    const items = Array.isArray(list) ? list : [];
    return (
      <div className="space-y-1.5 py-1">
        <div className="flex items-center gap-1 font-mono text-[12px] text-ink-2">
          {label}
          {spec.important ? <Star className="size-3 fill-current" aria-label="Important" /> : null}
          <span className="font-sans text-2xs text-faint">
            {items.length} {items.length === 1 ? "item" : "items"}
          </span>
        </div>
        {items.map((_, i) => (
          <SpecInput
            key={i}
            label={`${label} ${i + 1}`}
            spec={{ ...item, important: item.important || spec.important }}
            path={`${path}[${i}]`}
            ctx={ctx}
            onRemove={() => ctx.removeItem(path, i)}
          />
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => ctx.set(path, [...items, item.type === "object" ? emptyValue(item.fields ?? []) : null])}
        >
          <Plus /> Add {label.replace(/s$/, "")}
        </Button>
      </div>
    );
  }
  return <ScalarRow label={label} spec={spec} path={path} ctx={ctx} onRemove={onRemove} />;
}

function ScalarRow({ label, spec, path, ctx, onRemove }: { label: string; spec: FieldSpec; path: string; ctx: FormContext; onRemove?: () => void }) {
  const unsure = ctx.notSure.includes(path);
  const value = getAtPath(ctx.value, path);
  return (
    <div className={cn("grid grid-cols-[minmax(110px,0.7fr)_minmax(0,1.6fr)_auto] items-start gap-2 rounded-md px-1 py-1", unsure && "bg-sunken/70")}>
      <Tooltip content={spec.description}>
        <span className={cn("flex min-w-0 items-center gap-1 break-all pt-1.5 font-mono text-[12px] text-ink-2", spec.description && "cursor-help")}>
          {label}
          {spec.important ? <Star className="size-3 shrink-0 fill-current" aria-label="Important" /> : null}
        </span>
      </Tooltip>
      {unsure ? (
        <span className="pt-1.5 text-xs text-muted">Not sure · not scored</span>
      ) : (
        <ScalarInput spec={spec} value={value} label={path} onChange={(next) => ctx.set(path, next)} />
      )}
      <div className="flex items-center pt-0.5">
        <Tooltip content={unsure ? "I know this value: score it again" : "Not sure of the correct value: don't score this field"}>
          <button
            type="button"
            aria-label={`Not sure about ${path}`}
            aria-pressed={unsure}
            onClick={() => ctx.toggleNotSure(path)}
            className={cn(
              "flex size-7 items-center justify-center rounded-md",
              unsure ? "bg-warn-soft text-warn" : "text-faint hover:bg-hover hover:text-ink",
            )}
          >
            <CircleHelp className="size-3.5" />
          </button>
        </Tooltip>
        {onRemove ? <RemoveButton label={label} onClick={onRemove} /> : null}
      </div>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip content={`Remove ${label}`}>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-faint hover:bg-bad-soft hover:text-bad"
      >
        <X className="size-3.5" />
      </button>
    </Tooltip>
  );
}

const selectClass =
  "h-8 w-full rounded-md border border-line bg-panel px-2 text-[13px] text-ink outline-none hover:border-line-strong focus:border-accent";

/** One value. Empty means "not in the document" (null). */
function ScalarInput({ spec, value, label, onChange }: { spec: FieldSpec; value: unknown; label: string; onChange: (next: unknown) => void }) {
  const empty = "empty = not in the document";
  if (spec.type === "boolean") {
    return (
      <select aria-label={label} className={selectClass} value={value === true ? "yes" : value === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "yes")}>
        <option value="">— not in the document</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (spec.type === "enum") {
    return (
      <select aria-label={label} className={selectClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— not in the document</option>
        {(spec.enumValues ?? []).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (spec.type === "date") {
    return <Input aria-label={label} type="date" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />;
  }
  if (spec.type === "number" || spec.type === "integer") return <NumberInput label={label} value={value} onChange={onChange} placeholder={empty} />;
  const text = value === null || value === undefined ? "" : String(value);
  if (text.length > 48) {
    return (
      <Textarea
        aria-label={label}
        rows={Math.min(5, Math.ceil(text.length / 48))}
        value={text}
        placeholder={empty}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="resize-y text-[13px]"
      />
    );
  }
  return <Input aria-label={label} value={text} placeholder={empty} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} />;
}

/** Keeps what's typed (e.g. "9.") while it isn't a number yet, and stores the number. */
function NumberInput({ label, value, onChange, placeholder }: { label: string; value: unknown; onChange: (next: unknown) => void; placeholder: string }) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => {
    const parsed = parseLooseNumber(text);
    if (value === null || value === undefined ? text.trim() !== "" : parsed !== value) {
      setText(value === null || value === undefined ? "" : String(value));
    }
  }, [value]);
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      className="tabular font-mono text-[12.5px]"
      onChange={(e) => {
        setText(e.target.value);
        const raw = e.target.value.trim();
        onChange(raw === "" ? null : (parseLooseNumber(raw) ?? raw));
      }}
    />
  );
}

/** "Not sure" paths after removing item `index` of the list at `listPath`: its own go, later ones move up. */
function shiftNotSure(paths: string[], listPath: string, index: number) {
  const prefix = `${listPath}[`;
  return paths.flatMap((p) => {
    if (!p.startsWith(prefix)) return [p];
    const match = p.slice(prefix.length).match(/^(\d+)\](.*)$/);
    if (!match) return [p];
    const i = Number(match[1]);
    if (i === index) return [];
    return [i > index ? `${prefix}${i - 1}]${match[2]}` : p];
  });
}

/** Why an answer doesn't fit the fields, in plain words. */
function answerProblems(fields: Field[], value: unknown): string[] {
  if (!isRecord(value)) return ["The answer must be an object with one key per field."];
  const result = fieldsToZod(fields).safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "");
    return `${path || "answer"}: ${issue.message}`;
  });
}

export function ExpectedJsonDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: unknown;
  onSave: (value: unknown) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText(JSON.stringify(initial, null, 2));
      setError(null);
    }
  }, [open, initial]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Correct answer"
      description="The exact JSON a correct extraction returns for this document."
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await onSave(JSON.parse(text));
              } catch (e) {
                setError(e instanceof SyntaxError ? `Invalid JSON: ${e.message}` : errorMessage(e));
              }
            }}
          >
            Use this JSON
          </Button>
        </>
      }
    >
      <Textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        className="h-96 resize-y font-mono text-[12px]"
      />
      {error ? <p className="mt-2 text-xs text-bad">{error}</p> : null}
    </Dialog>
  );
}
