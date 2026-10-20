import { createContext, useContext, useState } from "react";
import { ArrowUp, ChevronRight, CornerDownRight, ListChecks, Plus, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  MATCH_MODE_LABELS,
  isNullable,
  isScalar,
  type Field,
  type FieldSpec,
  type FieldType,
  type MatchMode,
} from "@/lib/fields";
import { FORMAT_LABELS, describeRules, numberAndDateShapes, type FieldRules } from "@/lib/rules";
import { Select } from "./ui/overlay";
import { Tooltip } from "./ui/misc";

/**
 * Edits a field tree. Each row is: name · type · description, with details
 * (options, "can be empty", answer matching) behind a disclosure to keep rows scannable.
 */
/** The whole schema, so a field's checks can refer to other fields. */
const RootFieldsContext = createContext<Field[]>([]);

export function SchemaEditor({ fields, onChange }: { fields: Field[]; onChange: (fields: Field[]) => void }) {
  return (
    <RootFieldsContext.Provider value={fields}>
    <div className="text-[13px]">
      <div className="grid grid-cols-[minmax(120px,1fr)_104px_minmax(0,1.6fr)_56px] gap-2 border-b border-line px-2 pb-1.5 eyebrow text-faint">
        <span className="pl-5">Field</span>
        <span>Type</span>
        <span>Description for the model</span>
        <span />
      </div>
      <FieldList fields={fields} onChange={onChange} depth={0} prefix="" />
    </div>
    </RootFieldsContext.Provider>
  );
}

function FieldList({
  fields,
  onChange,
  depth,
  prefix,
}: {
  fields: Field[];
  onChange: (fields: Field[]) => void;
  depth: number;
  /** Shape of the parent, e.g. "seller" or "items[]"; "" at the top. */
  prefix: string;
}) {
  const update = (index: number, next: Field) => onChange(fields.map((f, i) => (i === index ? next : f)));
  const remove = (index: number) => onChange(fields.filter((_, i) => i !== index));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  const add = () => onChange([...fields, { key: nextKey(fields), type: "string" }]);

  return (
    <div className={cn(depth > 0 && "ml-5 border-l border-line pl-2")}>
      {fields.map((field, index) => (
        <FieldRow
          key={index}
          field={field}
          depth={depth}
          prefix={prefix}
          onChange={(next) => update(index, next)}
          onRemove={() => remove(index)}
          onMove={(delta) => move(index, index + delta)}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="mt-0.5 flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink"
      >
        <Plus className="size-3.5" />
        {depth === 0 ? "Add field" : "Add nested field"}
      </button>
    </div>
  );
}

function FieldRow({
  field,
  depth,
  prefix,
  onChange,
  onRemove,
  onMove,
}: {
  field: Field;
  depth: number;
  prefix: string;
  onChange: (field: Field) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const shape = prefix ? `${prefix}.${field.key}` : field.key;
  const scalar = field.type === "array" ? field.item : field;
  const checks = describeRules(scalar?.rules);
  const hasChildren = field.type === "object" || (field.type === "array" && field.item?.type === "object");

  return (
    <div className="group/row py-0.5">
      <div className="grid grid-cols-[minmax(120px,1fr)_104px_minmax(0,1.6fr)_56px] items-center gap-2 rounded-md px-2 py-0.5 hover:bg-sunken/70">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            aria-label={open ? "Hide field options" : "Show field options"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex size-4 shrink-0 items-center justify-center rounded text-faint hover:text-ink"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
          <input
            value={field.key}
            spellCheck={false}
            aria-label="Field name"
            onChange={(e) => onChange({ ...field, key: e.target.value.replace(/\s+/g, "_") })}
            className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 font-mono text-[12.5px] text-ink outline-none hover:border-line focus:border-accent focus:bg-panel"
          />
          {checks.length ? (
            <Tooltip content={`Checks: ${checks.join(", ")}`}>
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`${checks.length} ${checks.length === 1 ? "check" : "checks"} on ${field.key}`}
                className="flex shrink-0 items-center gap-0.5 rounded px-1 text-2xs text-muted hover:text-ink"
              >
                <ListChecks className="size-3" />
                {checks.length}
              </button>
            </Tooltip>
          ) : null}
          <ImportantToggle field={field} onChange={onChange} />
        </div>
        <TypeSelect spec={field} onChange={(spec) => onChange({ ...spec, key: field.key, important: field.important })} />
        <input
          value={field.description ?? ""}
          placeholder={placeholderFor(field)}
          aria-label="Description"
          onChange={(e) => onChange({ ...field, description: e.target.value || undefined })}
          className="h-7 min-w-0 rounded border border-transparent bg-transparent px-1.5 text-[12.5px] text-ink-2 outline-none placeholder:text-faint hover:border-line focus:border-accent focus:bg-panel"
        />
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          <Tooltip content="Move up">
            <button
              type="button"
              aria-label="Move up"
              onClick={() => onMove(-1)}
              className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink"
            >
              <ArrowUp className="size-3.5" />
            </button>
          </Tooltip>
          <Tooltip content="Remove field">
            <button
              type="button"
              aria-label={`Remove ${field.key}`}
              onClick={onRemove}
              className="flex size-6 items-center justify-center rounded text-faint hover:bg-bad-soft hover:text-bad"
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {open ? <FieldOptions field={field} onChange={onChange} depth={depth} shape={shape} /> : null}

      {hasChildren ? (
        field.type === "object" ? (
          <FieldList fields={field.fields ?? []} onChange={(fields) => onChange({ ...field, fields })} depth={depth + 1} prefix={shape} />
        ) : (
          <div>
            <div className="ml-7 flex h-6 items-center gap-1 text-2xs text-faint">
              <CornerDownRight className="size-3" /> each item has
            </div>
            <FieldList
              fields={field.item?.fields ?? []}
              onChange={(fields) => onChange({ ...field, item: { ...(field.item ?? { type: "object" }), fields } })}
              depth={depth + 1}
              prefix={`${shape}[]`}
            />
          </div>
        )
      ) : null}
    </div>
  );
}

const IMPORTANT_TIP = "Important: must be right. Accuracy checks score important fields on their own.";

/** A star next to the name: filled when the field is important, shown on hover otherwise. */
function ImportantToggle({ field, onChange }: { field: Field; onChange: (field: Field) => void }) {
  const on = Boolean(field.important);
  const groupTip = field.type === "object" || field.type === "array" ? " Applies to every field inside." : "";
  return (
    <Tooltip content={on ? `${IMPORTANT_TIP}${groupTip} Click to unmark.` : `Mark as important.${groupTip}`}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? `${field.key} is important` : `Mark ${field.key} as important`}
        onClick={() => onChange({ ...field, important: on ? undefined : true })}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded hover:bg-hover",
          on ? "text-ink" : "text-faint opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100",
        )}
      >
        <Star className={cn("size-3.5", on && "fill-current")} />
      </button>
    </Tooltip>
  );
}

function placeholderFor(field: Field) {
  if (field.type === "date") return "Formatted as YYYY-MM-DD";
  if (field.type === "array") return "What each item is";
  if (field.type === "object") return "What this group describes";
  return "What to extract, and how to format it";
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  ...FIELD_TYPES.filter((t) => t !== "array").map((t) => ({ value: t, label: FIELD_TYPE_LABELS[t] })),
  ...(["string", "number", "object"] as const).map((t) => ({
    value: `array:${t}`,
    label: t === "object" ? "List of groups" : `List of ${FIELD_TYPE_LABELS[t].toLowerCase()}`,
  })),
];

function TypeSelect({ spec, onChange }: { spec: FieldSpec; onChange: (spec: FieldSpec) => void }) {
  const value = spec.type === "array" ? `array:${spec.item?.type === "object" ? "object" : spec.item?.type ?? "string"}` : spec.type;
  const options = TYPE_OPTIONS.some((o) => o.value === value)
    ? TYPE_OPTIONS
    : [...TYPE_OPTIONS, { value, label: `List of ${FIELD_TYPE_LABELS[spec.item?.type ?? "string"].toLowerCase()}` }];
  return (
    <Select
      size="sm"
      ariaLabel="Type"
      value={value}
      options={options}
      className="border-transparent bg-transparent hover:border-line"
      onValueChange={(next) => {
        const base: FieldSpec = { description: spec.description, match: spec.match, type: "string" };
        if (next.startsWith("array:")) {
          const itemType = next.slice(6) as FieldType;
          onChange({
            ...base,
            type: "array",
            item:
              itemType === "object"
                ? { type: "object", fields: spec.type === "object" ? spec.fields : spec.item?.fields ?? [{ key: "name", type: "string" }] }
                : { type: itemType },
          });
          return;
        }
        const type = next as FieldType;
        if (type === "object") {
          onChange({ ...base, type, fields: spec.fields ?? spec.item?.fields ?? [{ key: "name", type: "string" }] });
        } else if (type === "enum") {
          onChange({ ...base, type, nullable: spec.nullable, enumValues: spec.enumValues ?? ["option_a", "option_b"] });
        } else {
          onChange({ ...base, type, nullable: spec.nullable });
        }
      }}
    />
  );
}

function FieldOptions({
  field,
  onChange,
  depth,
  shape,
}: {
  field: Field;
  onChange: (field: Field) => void;
  depth: number;
  shape: string;
}) {
  const scalarSpec = field.type === "array" ? field.item ?? { type: "string" } : field;
  const setScalar = (patch: Partial<FieldSpec>) =>
    field.type === "array" ? onChange({ ...field, item: { ...scalarSpec, ...patch } }) : onChange({ ...field, ...patch });

  return (
    <div className="mb-1.5 ml-7 mr-2 mt-0.5 grid gap-3 rounded-md border border-line bg-sunken/60 px-3 py-2.5 text-xs sm:grid-cols-2">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 accent-[var(--c-accent)]"
          checked={Boolean(field.important)}
          onChange={(e) => onChange({ ...field, important: e.target.checked || undefined })}
        />
        <span>
          <span className="font-medium text-ink-2">Important</span>
          <span className="block text-muted">
            Must be right. Accuracy checks score important fields on their own
            {field.type === "object" || field.type === "array" ? ", and this applies to every field inside" : ""}.
          </span>
        </span>
      </label>
      {scalarSpec.type === "enum" ? (
        <div className="sm:col-span-2">
          <div className="mb-1 font-medium text-ink-2">Options</div>
          <EnumEditor values={scalarSpec.enumValues ?? []} onChange={(enumValues) => setScalar({ enumValues })} />
        </div>
      ) : null}
      {field.type !== "array" ? (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--c-accent)]"
            checked={isNullable(field)}
            onChange={(e) => onChange({ ...field, nullable: e.target.checked })}
          />
          <span>
            <span className="font-medium text-ink-2">Can be empty</span>
            <span className="block text-muted">
              The model may return null when the document doesn't have it, instead of guessing.
            </span>
          </span>
        </label>
      ) : null}
      {isScalar(scalarSpec.type) ? (
        <div>
          <div className="mb-1 font-medium text-ink-2">When checking against the correct answer</div>
          <Select<MatchMode>
            size="sm"
            value={scalarSpec.match ?? "exact"}
            onValueChange={(match) => setScalar({ match: match === "exact" ? undefined : match })}
            options={[
              { value: "exact", label: `${MATCH_MODE_LABELS.exact}: same value, ignoring case and spacing` },
              { value: "loose", label: `${MATCH_MODE_LABELS.loose}: mostly the same words (addresses, names)` },
              { value: "ignore", label: `${MATCH_MODE_LABELS.ignore}: free text like summaries` },
            ]}
          />
        </div>
      ) : null}
      {isScalar(scalarSpec.type) ? (
        <RulesEditor
          spec={scalarSpec}
          shape={field.type === "array" ? `${shape}[]` : shape}
          inList={field.type === "array" || shape.includes("[]")}
          onChange={(rules) => setScalar({ rules })}
        />
      ) : null}
      {depth === 0 && field.type === "object" ? (
        <p className="text-muted sm:col-span-2">Groups keep related fields together, e.g. seller and buyer details.</p>
      ) : null}
    </div>
  );
}

/** Drops unset rules so an untouched field stores nothing. */
function cleanRules(rules: FieldRules): FieldRules | undefined {
  const entries = Object.entries(rules).filter(
    ([, value]) => value !== undefined && value !== false && value !== "" && !(Array.isArray(value) && value.length === 0),
  );
  return entries.length ? (Object.fromEntries(entries) as FieldRules) : undefined;
}

const FORMAT_OPTIONS = ["none", "email", "url", "phone", "pattern"] as const;
type FormatOption = (typeof FORMAT_OPTIONS)[number];

/**
 * Free, exact checks for one field. Cross-field checks (sum, date order) are offered only outside
 * lists, where "the other field" is unambiguous.
 */
function RulesEditor({
  spec,
  shape,
  inList,
  onChange,
}: {
  spec: FieldSpec;
  shape: string;
  inList: boolean;
  onChange: (rules: FieldRules | undefined) => void;
}) {
  const root = useContext(RootFieldsContext);
  const rules = spec.rules ?? {};
  const set = (patch: Partial<FieldRules>) => onChange(cleanRules({ ...rules, ...patch }));
  const others = numberAndDateShapes(root).filter((s) => s.shape !== shape);
  const numeric = spec.type === "number" || spec.type === "integer";
  const format: FormatOption = rules.pattern !== undefined ? "pattern" : (rules.format ?? "none");

  return (
    <div className="sm:col-span-2">
      <div className="mb-1 font-medium text-ink-2">
        Checks <span className="font-normal text-muted">· free and exact, no AI; a failed check flags the value</span>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--c-accent)]"
            checked={Boolean(rules.required)}
            onChange={(e) => set({ required: e.target.checked })}
          />
          <span>
            Flag when empty
            <span className="block text-muted">Every document should have it, so an empty value needs a look.</span>
          </span>
        </label>

        {spec.type === "string" ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted">Format</span>
            <Select<FormatOption>
              size="sm"
              value={format}
              onValueChange={(next) =>
                next === "pattern"
                  ? // Keep an empty pattern so the input stays open while it's typed.
                    onChange({ ...rules, format: undefined, pattern: rules.pattern ?? "" })
                  : set({ format: next === "none" ? undefined : next, pattern: undefined })
              }
              options={[
                { value: "none", label: "Any text" },
                { value: "email", label: FORMAT_LABELS.email },
                { value: "url", label: FORMAT_LABELS.url },
                { value: "phone", label: FORMAT_LABELS.phone },
                { value: "pattern", label: "Custom pattern (regex)" },
              ]}
            />
          </div>
        ) : null}
        {spec.type === "string" && format === "pattern" ? (
          <input
            value={rules.pattern ?? ""}
            onChange={(e) => onChange({ ...rules, pattern: e.target.value, format: undefined })}
            placeholder="e.g. [A-Z]{3}-\d{4}"
            aria-label="Pattern"
            spellCheck={false}
            className="h-7 rounded border border-line bg-panel px-2 font-mono text-[12px] outline-none focus:border-accent sm:col-span-2"
          />
        ) : null}

        {numeric ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted">Between</span>
            <NumberInput value={rules.min} onChange={(min) => set({ min })} label="Minimum" />
            <span className="text-muted">and</span>
            <NumberInput value={rules.max} onChange={(max) => set({ max })} label="Maximum" />
          </div>
        ) : null}

        {spec.type === "date" ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-[var(--c-accent)]"
              checked={Boolean(rules.notInFuture)}
              onChange={(e) => set({ notInFuture: e.target.checked })}
            />
            <span>Can't be in the future</span>
          </label>
        ) : null}

        {numeric && !inList ? (
          <div className="sm:col-span-2">
            <div className="mb-1 text-muted">Equals the sum of</div>
            <div className="flex flex-wrap gap-1">
              {others.filter((o) => o.type === "number").map((o) => {
                const on = rules.sumOf?.includes(o.shape) ?? false;
                return (
                  <button
                    key={o.shape}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set({ sumOf: on ? rules.sumOf?.filter((s) => s !== o.shape) : [...(rules.sumOf ?? []), o.shape] })
                    }
                    className={cn(
                      "h-6 rounded border px-2 font-mono text-[11.5px]",
                      on ? "border-ink bg-ink text-bg" : "border-line bg-panel text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {o.shape}
                  </button>
                );
              })}
              {others.every((o) => o.type !== "number") ? <span className="text-faint">No other number fields.</span> : null}
            </div>
          </div>
        ) : null}

        {spec.type === "date" && !inList ? (
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-muted">On or after</span>
            <Select<string>
              size="sm"
              value={rules.notBefore ?? "__none"}
              onValueChange={(next) => set({ notBefore: next === "__none" ? undefined : next })}
              options={[
                { value: "__none", label: "Any date" },
                ...others.filter((o) => o.type === "date").map((o) => ({ value: o.shape, label: o.shape })),
              ]}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NumberInput({ value, onChange, label }: { value: number | undefined; onChange: (value: number | undefined) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      inputMode="decimal"
      aria-label={label}
      placeholder="any"
      value={draft ?? (value === undefined ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const text = (draft ?? "").trim();
        setDraft(null);
        const parsed = text === "" ? undefined : Number(text);
        onChange(parsed === undefined || Number.isFinite(parsed) ? parsed : value);
      }}
      className="tabular h-7 w-20 rounded border border-line bg-panel px-2 text-[12px] outline-none placeholder:text-faint focus:border-accent"
    />
  );
}

function EnumEditor({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((value) => (
        <span key={value} className="inline-flex h-6 items-center gap-1 rounded border border-line bg-panel pl-2 pr-1 font-mono text-[11.5px]">
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(values.filter((v) => v !== value))}
            className="rounded p-0.5 text-faint hover:text-bad"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder="Add option ↵"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        className="h-6 w-28 rounded border border-line bg-panel px-1.5 font-mono text-[11.5px] outline-none focus:border-accent"
      />
    </div>
  );
}

function nextKey(fields: Field[]) {
  let i = fields.length + 1;
  while (fields.some((f) => f.key === `field_${i}`)) i++;
  return `field_${i}`;
}
