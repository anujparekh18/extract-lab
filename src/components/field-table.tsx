import { useMemo, useState, type ReactNode } from "react";
import { Check, CornerDownLeft, Pencil, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { compareOutputs, formatLeafValue, parseLooseNumber, type FieldStatus } from "@/lib/compare";
import { flattenLeaves, type Field, type FieldSpec } from "@/lib/fields";
import { checkRules, issuesByPath } from "@/lib/rules";
import { Tooltip } from "./ui/misc";

export type FieldRow = {
  path: string;
  spec: FieldSpec;
  actual: unknown;
  expected?: unknown;
  status?: FieldStatus;
  /** Changed by hand during review, not yet saved. */
  edited?: boolean;
  /** Field rules this value breaks, in plain words. */
  ruleIssues?: string[];
  /** Marked important in the schema. */
  important?: boolean;
  /** The correct value isn't known, so this field isn't scored. */
  notSure?: boolean;
};

export function buildRows(
  fields: Field[],
  output: unknown,
  expected: unknown | undefined,
  notSure?: readonly string[],
): FieldRow[] {
  const ruleIssues = issuesByPath(checkRules(fields, output));
  const unknown = new Set(notSure ?? []);
  if (expected !== undefined) {
    // Every field is listed; the ones whose correct value isn't known just carry no verdict.
    return compareOutputs(fields, expected, output).fields.map((f) => ({
      path: f.path,
      spec: f.spec,
      actual: f.actual,
      expected: f.expected,
      status: unknown.has(f.path) ? undefined : f.status,
      notSure: unknown.has(f.path) || undefined,
      ruleIssues: ruleIssues[f.path],
      important: f.important,
    }));
  }
  return flattenLeaves(fields, output).map((leaf) => ({
    path: leaf.path,
    spec: leaf.spec,
    actual: leaf.value,
    notSure: unknown.has(leaf.path) || undefined,
    ruleIssues: ruleIssues[leaf.path],
    important: leaf.important,
  }));
}

/** Whether a row deserves attention: wrong or failing a rule. */
export function rowNeedsLook(row: FieldRow) {
  if (row.notSure) return false;
  return (row.status !== undefined && row.status !== "match") || Boolean(row.ruleIssues?.length);
}

const STATUS_META: Record<FieldStatus, { label: string; bar: string; text: string }> = {
  match: { label: "Correct", bar: "bg-ok", text: "text-ok" },
  mismatch: { label: "Wrong", bar: "bg-bad", text: "text-bad" },
  missing: { label: "Missing: should have a value", bar: "bg-warn", text: "text-warn" },
  unexpected: { label: "Should be empty", bar: "bg-warn", text: "text-warn" },
};

/**
 * One row per extracted value. The left gutter carries the verdict: agreement with the
 * correct answer when there is one, otherwise whether the value breaks a field rule.
 */
export function FieldTable({
  rows,
  showExpected,
  onEditExpected,
  onFixOutput,
  fixTip,
  issuesOnly = false,
  emptyHint,
  valueLabel = "Model's answer",
}: {
  rows: FieldRow[];
  showExpected: boolean;
  onEditExpected?: (path: string, value: unknown) => void;
  /** Without a correct answer yet: fixing a value of the model's answer saves the correct answer. */
  onFixOutput?: (path: string, value: unknown) => void;
  /** Tooltip for the fix pencil, when fixing does something other than save right away. */
  fixTip?: string;
  issuesOnly?: boolean;
  emptyHint?: ReactNode;
  /** Heading of the value column, when the values aren't a model's answer. */
  valueLabel?: string;
}) {
  const visible = useMemo(() => (issuesOnly ? rows.filter(rowNeedsLook) : rows), [rows, issuesOnly]);

  const columns = cn(
    "grid items-start gap-3",
    showExpected
      ? "grid-cols-[minmax(110px,0.9fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]"
      : "grid-cols-[minmax(110px,0.8fr)_minmax(0,2fr)]",
  );

  return (
    <div className="text-[12.5px]">
      <div className={cn(columns, "sticky top-0 z-10 border-b border-line bg-panel py-1.5 pl-4 pr-3 eyebrow text-faint")}>
        <span>Field</span>
        <span>{valueLabel}</span>
        {showExpected ? <span>Correct answer</span> : null}
      </div>
      {visible.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-muted">{emptyHint ?? "No fields."}</div>
      ) : (
        visible.map((row) => (
          <Row
            key={row.path}
            row={row}
            columns={columns}
            showExpected={showExpected}
            onEditExpected={onEditExpected}
            onFixOutput={onFixOutput}
            fixTip={fixTip}
          />
        ))
      )}
    </div>
  );
}

function Row({
  row,
  columns,
  showExpected,
  onEditExpected,
  onFixOutput,
  fixTip,
}: {
  row: FieldRow;
  columns: string;
  showExpected: boolean;
  onEditExpected?: (path: string, value: unknown) => void;
  onFixOutput?: (path: string, value: unknown) => void;
  fixTip?: string;
}) {
  const failsRule = Boolean(row.ruleIssues?.length);
  const bar = row.notSure
    ? "bg-line-strong"
    : row.status
      ? STATUS_META[row.status].bar
      : failsRule
        ? "bg-bad"
        : "bg-transparent";
  const barLabel = row.notSure
    ? "Not sure: not scored"
    : row.status
      ? STATUS_META[row.status].label
      : failsRule
        ? "Fails a check"
        : undefined;

  return (
    <div className={cn(columns, "group relative border-b border-line/70 py-1.5 pl-4 pr-3 hover:bg-sunken/50")}>
      <span className={cn("absolute inset-y-1 left-1.5 w-[3px] rounded-full", bar)} title={barLabel} aria-label={barLabel} />
      <div className="flex min-w-0 items-start gap-1">
        <PathLabel path={row.path} />
        {row.important ? (
          <Tooltip content="Important field">
            <Star className="mt-[3px] size-3 shrink-0 fill-current text-ink-2" aria-label="Important" />
          </Tooltip>
        ) : null}
        {row.notSure ? (
          <Tooltip content="The correct value isn't known, so this field isn't scored.">
            <span className="mt-px shrink-0 cursor-help rounded bg-sunken px-1 text-[10.5px] leading-4 text-muted">not sure</span>
          </Tooltip>
        ) : null}
      </div>
      {onFixOutput && !showExpected ? (
        <div className="flex min-w-0 items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <EditableValue
              value={row.actual}
              spec={row.spec}
              onEdit={(value) => onFixOutput(row.path, value)}
              editLabel={`Fix ${row.path}`}
              editTip={fixTip ?? "Fix this value. Saves the corrected answer as this document's correct answer."}
            />
          </div>
          {row.edited ? <span className="mt-0.5 shrink-0 text-2xs font-medium text-ink-2">edited</span> : null}
        </div>
      ) : (
        <Value value={row.actual} spec={row.spec} strike={row.status === "mismatch" || row.status === "unexpected"} />
      )}
      {showExpected ? (
        <EditableValue
          value={row.expected}
          spec={row.spec}
          onEdit={onEditExpected ? (value) => onEditExpected(row.path, value) : undefined}
          onAccept={
            onEditExpected && row.status !== undefined && row.status !== "match"
              ? () => onEditExpected(row.path, row.actual ?? null)
              : undefined
          }
          editLabel={`Edit correct answer for ${row.path}`}
          acceptLabel={`Use the model's answer for ${row.path}`}
          editTip="Edit the correct answer"
          correct={row.status === "match"}
        />
      ) : null}
      {failsRule ? (
        <div className="col-span-full -mt-0.5 flex flex-col gap-0.5 pb-0.5 text-2xs leading-4 text-bad">
          {row.ruleIssues!.map((message) => (
            <span key={message}>✗ {message}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PathLabel({ path }: { path: string }) {
  const lastDot = path.lastIndexOf(".");
  const parent = lastDot >= 0 ? path.slice(0, lastDot + 1) : "";
  const leaf = lastDot >= 0 ? path.slice(lastDot + 1) : path;
  return (
    <span className="min-w-0 break-words pt-px font-mono text-[12px] leading-[18px]" title={path}>
      <span className="text-faint">{parent}</span>
      <span className="text-ink-2">{leaf}</span>
    </span>
  );
}

function Value({ value, spec, strike }: { value: unknown; spec: FieldSpec; strike?: boolean }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <span className="pt-px font-mono text-[12px] leading-[18px] text-faint">{Array.isArray(value) ? "[ ]" : "null"}</span>;
  }
  const numeric = spec.type === "number" || spec.type === "integer";
  return (
    <span
      className={cn(
        "min-w-0 whitespace-pre-wrap break-words leading-[18px] text-ink",
        numeric && "tabular font-mono text-[12px]",
        spec.type === "enum" && "font-mono text-[12px]",
        strike && "text-bad",
      )}
    >
      {formatLeafValue(value)}
    </span>
  );
}

function EditableValue({
  value,
  spec,
  onEdit,
  onAccept,
  editLabel,
  acceptLabel,
  editTip,
  correct,
}: {
  value: unknown;
  spec: FieldSpec;
  onEdit?: (value: unknown) => void;
  /** Shown when the model's answer differs: take it as the correct answer. */
  onAccept?: () => void;
  editLabel: string;
  acceptLabel?: string;
  editTip: string;
  correct?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing && onEdit) {
    const commit = () => {
      onEdit(parseInput(draft, spec));
      setEditing(false);
    };
    return (
      <input
        autoFocus
        aria-label={editLabel}
        onFocus={(e) => e.currentTarget.select()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="empty = null"
        className="-my-0.5 h-6 min-w-0 rounded border border-accent bg-panel px-1.5 text-[12.5px] outline-none ring-2 ring-accent/15"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1">
        <Value value={value} spec={spec} />
      </div>
      {onEdit ? (
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onAccept ? (
            <Tooltip content="Use the model's answer as correct">
              <button
                type="button"
                aria-label={acceptLabel}
                onClick={onAccept}
                className="flex size-5 items-center justify-center rounded text-muted hover:bg-ok-soft hover:text-ok"
              >
                <CornerDownLeft className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip content={editTip}>
            <button
              type="button"
              aria-label={editLabel}
              onClick={() => {
                setDraft(value === null || value === undefined ? "" : formatLeafValue(value));
                setEditing(true);
              }}
              className="flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-ink"
            >
              <Pencil className="size-3" />
            </button>
          </Tooltip>
        </div>
      ) : null}
      {correct ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok opacity-60" aria-label="Correct" /> : null}
    </div>
  );
}

function parseInput(raw: string, spec: FieldSpec): unknown {
  const text = raw.trim();
  if (!text || text === "null") return null;
  if (spec.type === "number" || spec.type === "integer") {
    const n = parseLooseNumber(text);
    return n ?? text;
  }
  if (spec.type === "boolean") return /^(true|yes|1)$/i.test(text);
  return text;
}
