import { z } from "zod";
import { ruleSetupProblems, type FieldRules } from "./rules";

/**
 * Extractor schemas are stored as a small field tree instead of raw JSON Schema.
 * The tree is easy to edit in the UI, and converts to Zod (for validation),
 * JSON Schema, TypeScript, and Pydantic (for export).
 */

export const SCALAR_TYPES = ["string", "number", "integer", "boolean", "date", "enum"] as const;
export const FIELD_TYPES = [...SCALAR_TYPES, "object", "array"] as const;

export type ScalarType = (typeof SCALAR_TYPES)[number];
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldSpec = {
  type: FieldType;
  description?: string;
  /** When true, the model returns null if the value isn't in the document. Default: true for scalars, false for groups. */
  nullable?: boolean;
  /** type === "enum" */
  enumValues?: string[];
  /** type === "object" */
  fields?: Field[];
  /** type === "array" */
  item?: FieldSpec;
  /** How evals compare this field with the expected value. Defaults to "exact". */
  match?: MatchMode;
  /** Exact checks on the extracted value (see lib/rules). They never change the value, only flag it. */
  rules?: FieldRules;
  /**
   * Must be right. Accuracy checks score important fields on their own, so one wrong amount
   * isn't hidden by many right phone numbers. On a group or list, applies to everything in it.
   */
  important?: boolean;
};

export type MatchMode = "exact" | "loose" | "ignore";

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  exact: "Exact",
  loose: "Close enough",
  ignore: "Don't check",
};

export type Field = FieldSpec & { key: string };

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  string: "Text",
  number: "Number",
  integer: "Integer",
  boolean: "Yes / no",
  date: "Date",
  enum: "One of",
  object: "Group",
  array: "List",
};

export function isScalar(type: FieldType): type is ScalarType {
  return (SCALAR_TYPES as readonly string[]).includes(type);
}

export function isNullable(spec: FieldSpec) {
  if (spec.type === "array") return false;
  return spec.nullable ?? spec.type !== "object";
}

// ---------------------------------------------------------------------------
// Validation of the field tree itself
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateFields(fields: Field[], prefix = ""): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  if (fields.length === 0) {
    errors.push(prefix ? `${prefix} needs at least one field.` : "Add at least one field.");
  }
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.key || "?"}` : field.key || "?";
    if (!field.key) errors.push(`A field in ${prefix || "the schema"} has no name.`);
    else if (!KEY_PATTERN.test(field.key)) {
      errors.push(`"${path}" must start with a letter and use only letters, numbers, and _.`);
    }
    if (field.key && seen.has(field.key)) errors.push(`"${path}" is defined twice.`);
    seen.add(field.key);
    errors.push(...validateSpec(field, path));
  }
  if (!prefix) errors.push(...ruleSetupProblems(fields));
  return errors;
}

function validateSpec(spec: FieldSpec, path: string): string[] {
  if (spec.type === "enum" && (spec.enumValues ?? []).filter(Boolean).length < 2) {
    return [`"${path}" needs at least two options.`];
  }
  if (spec.type === "object") return validateFields(spec.fields ?? [], path);
  if (spec.type === "array") {
    if (!spec.item) return [`"${path}" needs an item type.`];
    return validateSpec(spec.item, `${path}[]`);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Zod (used for model output + validation)
// ---------------------------------------------------------------------------

export function fieldsToZod(fields: Field[]): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) shape[field.key] = specToZod(field);
  return z.object(shape);
}

function specToZod(spec: FieldSpec): z.ZodType {
  let schema: z.ZodType;
  switch (spec.type) {
    case "string":
      schema = z.string();
      break;
    case "number":
      schema = z.number();
      break;
    case "integer":
      schema = z.number().int();
      break;
    case "boolean":
      schema = z.boolean();
      break;
    case "date":
      schema = z.string();
      break;
    case "enum":
      schema = z.enum(normalizedEnum(spec) as [string, ...string[]]);
      break;
    case "object":
      schema = fieldsToZod(spec.fields ?? []);
      break;
    case "array":
      schema = z.array(specToZod(spec.item ?? { type: "string" }));
      break;
  }
  if (isNullable(spec)) schema = schema.nullable();
  const description = describeSpec(spec);
  return description ? schema.describe(description) : schema;
}

function normalizedEnum(spec: FieldSpec) {
  const values = Array.from(new Set((spec.enumValues ?? []).map((v) => v.trim()).filter(Boolean)));
  return values.length > 0 ? values : ["unknown"];
}

/** The description the model sees. Dates get an explicit format hint. */
export function describeSpec(spec: FieldSpec) {
  const parts = [spec.description?.trim()].filter(Boolean) as string[];
  if (spec.type === "date") parts.push("Format: YYYY-MM-DD.");
  if (isNullable(spec) && spec.type !== "object") parts.push("Use null if not present in the document.");
  return parts.join(" ");
}

export function fieldsToJsonSchema(fields: Field[]) {
  return z.toJSONSchema(fieldsToZod(fields), { target: "draft-2020-12" });
}

// ---------------------------------------------------------------------------
// Import from JSON Schema (paste an existing schema)
// ---------------------------------------------------------------------------

type JsonSchemaNode = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
};

export function jsonSchemaToFields(schema: unknown): Field[] {
  const root = schema as JsonSchemaNode;
  if (!root || typeof root !== "object" || !root.properties) {
    throw new Error("Expected a JSON Schema object with `properties`.");
  }
  return Object.entries(root.properties).map(([key, node]) => ({ key, ...nodeToSpec(node) }));
}

function nodeToSpec(node: JsonSchemaNode): FieldSpec {
  let nullable = false;
  let current = node;
  const variants = node.anyOf ?? node.oneOf;
  if (variants) {
    const nonNull = variants.filter((v) => v.type !== "null");
    nullable = nonNull.length < variants.length;
    current = { ...nonNull[0], description: node.description ?? nonNull[0]?.description };
  }
  let type = current.type;
  if (Array.isArray(type)) {
    nullable = nullable || type.includes("null");
    type = type.find((t) => t !== "null");
  }
  const description = current.description;
  if (current.enum) {
    return {
      type: "enum",
      enumValues: current.enum.filter((v) => v !== null).map(String),
      nullable: nullable || current.enum.includes(null),
      description,
    };
  }
  switch (type) {
    case "object":
      return {
        type: "object",
        description,
        nullable,
        fields: Object.entries(current.properties ?? {}).map(([key, child]) => ({ key, ...nodeToSpec(child) })),
      };
    case "array":
      return { type: "array", description, item: nodeToSpec(current.items ?? { type: "string" }) };
    case "number":
      return { type: "number", description, nullable };
    case "integer":
      return { type: "integer", description, nullable };
    case "boolean":
      return { type: "boolean", description, nullable };
    default:
      return { type: current.format === "date" ? "date" : "string", description, nullable };
  }
}

// ---------------------------------------------------------------------------
// Walking values against the tree
// ---------------------------------------------------------------------------

export type Leaf = {
  /** e.g. `seller.name`, `line_items[2].amount` */
  path: string;
  /** Path with list indexes replaced by [], used to group leaves across documents. */
  shape: string;
  spec: FieldSpec;
  value: unknown;
  /** Marked important, itself or through the group or list it's in. */
  important: boolean;
};

/** Flattens a value into scalar leaves, following the field tree. */
export function flattenLeaves(fields: Field[], value: unknown): Leaf[] {
  const leaves: Leaf[] = [];
  walkObject(fields, value, "", "", false, leaves);
  return leaves;
}

function walkObject(fields: Field[], value: unknown, path: string, shape: string, important: boolean, out: Leaf[]) {
  const record = isRecord(value) ? value : {};
  for (const field of fields) {
    const childPath = path ? `${path}.${field.key}` : field.key;
    const childShape = shape ? `${shape}.${field.key}` : field.key;
    walkSpec(field, record[field.key], childPath, childShape, important, out);
  }
}

function walkSpec(spec: FieldSpec, value: unknown, path: string, shape: string, inherited: boolean, out: Leaf[]) {
  const important = inherited || Boolean(spec.important);
  if (spec.type === "object") {
    walkObject(spec.fields ?? [], value, path, shape, important, out);
    return;
  }
  if (spec.type === "array") {
    const items = Array.isArray(value) ? value : [];
    const itemSpec = spec.item ?? { type: "string" };
    if (items.length === 0) {
      out.push({ path, shape, spec, value: [], important });
      return;
    }
    items.forEach((item, index) => walkSpec(itemSpec, item, `${path}[${index}]`, `${shape}[]`, important, out));
    return;
  }
  out.push({ path, shape, spec, value: value ?? null, important });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function countFields(fields: Field[]): number {
  return fields.reduce((total, field) => total + countSpec(field), 0);
}

function countSpec(spec: FieldSpec): number {
  if (spec.type === "object") return countFields(spec.fields ?? []);
  if (spec.type === "array") return countSpec(spec.item ?? { type: "string" });
  return 1;
}

/** A value with the right shape and every scalar set to null. Used as a starting point for expected output. */
export function emptyValue(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field.key] = emptySpecValue(field);
  return out;
}

function emptySpecValue(spec: FieldSpec): unknown {
  if (spec.type === "array") return [];
  if (spec.type === "object") return isNullable(spec) ? null : emptyValue(spec.fields ?? []);
  return null;
}

// ---------------------------------------------------------------------------
// Stable hashing for version de-duplication
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** FNV-1a; small, deterministic, and good enough to detect "nothing changed". */
export function hashString(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + input.length.toString(16);
}

// ---------------------------------------------------------------------------
// Infer a schema from example JSON (e.g. an output you already have)
// ---------------------------------------------------------------------------

/** Builds fields that fit every example. Unknown/empty values become nullable text. */
export function inferFields(examples: unknown[]): Field[] {
  const spec = inferSpec(examples.filter((e) => e !== undefined));
  if (spec.type !== "object") throw new Error("Examples must be JSON objects.");
  return spec.fields ?? [];
}

function inferSpec(values: unknown[]): FieldSpec {
  const present = values.filter((value) => value !== null && value !== undefined);
  const nullable = present.length < values.length;
  if (present.length === 0) return { type: "string", nullable: true };

  if (present.every(isRecord)) {
    const keys: string[] = [];
    for (const value of present) for (const key of Object.keys(value)) if (!keys.includes(key)) keys.push(key);
    return {
      type: "object",
      nullable,
      fields: keys.map((key) => ({ key, ...inferSpec(present.map((value) => value[key] ?? null)) })),
    };
  }
  if (present.every(Array.isArray)) {
    return { type: "array", item: inferSpec(present.flat()) };
  }
  if (present.every((value) => typeof value === "boolean")) return { type: "boolean", nullable };
  if (present.every((value) => typeof value === "number")) {
    return { type: present.every((value) => Number.isInteger(value)) ? "integer" : "number", nullable };
  }
  if (present.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))) {
    return { type: "date", nullable };
  }
  return { type: "string", nullable };
}
