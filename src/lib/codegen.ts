import type { FieldRules } from "./rules";
import { describeSpec, fieldsToJsonSchema, isNullable, type Field, type FieldSpec } from "./fields";
import { parseModelId, PROVIDERS, type ProviderId } from "./models";

/** "Vendor invoices" -> "VendorInvoice" */
export function typeName(name: string) {
  const pascal = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const singular = pascal.endsWith("ies") ? `${pascal.slice(0, -3)}y` : pascal.replace(/s$/, "");
  return /^[A-Za-z]/.test(singular) ? singular : `Doc${singular || "Extraction"}`;
}

function quote(text: string) {
  return JSON.stringify(text);
}

function indent(text: string, spaces: number) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

export function fieldsToZodCode(fields: Field[]): string {
  const lines = fields.map((f) => `${safeKey(f.key)}: ${specToZod(f)},`);
  return `z.object({\n${indent(lines.join("\n"), 2)}\n})`;
}

function safeKey(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : quote(key);
}

function specToZod(spec: FieldSpec): string {
  let code: string;
  switch (spec.type) {
    case "string":
    case "date":
      code = "z.string()";
      break;
    case "number":
      code = "z.number()";
      break;
    case "integer":
      code = "z.number().int()";
      break;
    case "boolean":
      code = "z.boolean()";
      break;
    case "enum":
      code = `z.enum([${(spec.enumValues ?? []).map(quote).join(", ")}])`;
      break;
    case "object":
      code = fieldsToZodCode(spec.fields ?? []);
      break;
    case "array":
      code = `z.array(${specToZod(spec.item ?? { type: "string" })})`;
      break;
  }
  if (isNullable(spec)) code += ".nullable()";
  const description = describeSpec(spec);
  if (description) code += `.describe(${quote(description)})`;
  return code;
}

// ---------------------------------------------------------------------------
// TypeScript (AI SDK) — mirrors convex/execution.ts so what you tested is what you ship
// ---------------------------------------------------------------------------

const TS_PROVIDER: Record<ProviderId, { pkg: string; factory: string }> = {
  google: { pkg: "@ai-sdk/google", factory: "google" },
  openai: { pkg: "@ai-sdk/openai", factory: "openai" },
  anthropic: { pkg: "@ai-sdk/anthropic", factory: "anthropic" },
};

export function typescriptSnippet(args: { name: string; prompt: string; fields: Field[]; model: string }) {
  const parsed = parseModelId(args.model) ?? { provider: "google" as const, model: args.model };
  const provider = TS_PROVIDER[parsed.provider];
  const type = typeName(args.name);
  const fn = `extract${type}`;
  return `// npm i ai ${provider.pkg} zod
// Needs ${PROVIDERS[parsed.provider].envVar} in your environment.
import { generateText, Output } from "ai";
import { ${provider.factory} } from "${provider.pkg}";
import { z } from "zod";

export const ${type}Schema = ${fieldsToZodCode(args.fields)};

export type ${type} = z.infer<typeof ${type}Schema>;

const PROMPT = ${templateLiteral(args.prompt)};

type Input = { text: string } | { json: unknown } | { data: Uint8Array; mediaType: string };

export async function ${fn}(input: Input): Promise<${type}> {
  const { output } = await generateText({
    model: ${provider.factory}(${quote(parsed.model)}),
    instructions: PROMPT,
    output: Output.object({ schema: ${type}Schema }),
    messages: [
      {
        role: "user",
        content: [
          "text" in input
            ? { type: "text", text: \`<document>\\n\${input.text}\\n</document>\` }
            : "json" in input
              ? { type: "text", text: \`<document format="json">\\n\${JSON.stringify(input.json)}\\n</document>\` }
              : { type: "file", data: input.data, mediaType: input.mediaType },
          { type: "text", text: "Extract the data from this document." },
        ],
      },
    ],
  });
  return output;
}

// Example:
// const pdf = await fs.readFile("invoice.pdf");
// const result = await ${fn}({ data: pdf, mediaType: "application/pdf" });
${rulesCheckerCode(args.fields, type)}`;
}

function templateLiteral(text: string) {
  return `\`${text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
}

// ---------------------------------------------------------------------------
// Python (Pydantic types + the HTTP endpoint)
// ---------------------------------------------------------------------------

export function pythonSnippet(args: {
  name: string;
  fields: Field[];
  endpoint: string;
  apiKeyRequired: boolean;
  /** The release to pin, when one is published. */
  version?: number;
}) {
  const type = typeName(args.name);
  const classes: string[] = [];
  const hasEnum = JSON.stringify(args.fields).includes('"enum"');
  const hasDate = JSON.stringify(args.fields).includes('"date"');
  pydanticClass(type, args.fields, classes);
  const imports = [
    "from __future__ import annotations",
    "",
    hasDate ? "import datetime" : null,
    "import time",
    "import uuid",
    "",
    "import requests  # pip install requests pydantic",
    `from typing import Optional${hasEnum ? ", Literal" : ""}`,
    "from pydantic import BaseModel, Field",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const headers = args.apiKeyRequired ? '{"Authorization": f"Bearer {API_KEY}"}' : "{}";
  const form = args.version ? `{"wait": "30", "version": "${args.version}"}` : '{"wait": "30"}';
  return `${imports}

${classes.join("\n\n")}

ENDPOINT = ${quote(args.endpoint)}${args.apiKeyRequired ? '\nAPI_KEY = "..."  # EXTRACT_LAB_API_KEY' : ""}
HEADERS = ${headers}


def extract_${snake(type)}(path: str, timeout: float = 300) -> ${type}:
    """Send a PDF or image; returns the validated ${type}.

    The server waits up to 30 seconds for the result. Longer documents come back as 202
    with a poll_url, which this polls until the run finishes. The Idempotency-Key makes
    a retried call return the same run instead of starting (and paying for) a new one.
    """
    headers = {**HEADERS, "Idempotency-Key": str(uuid.uuid4())}
    with open(path, "rb") as f:
        response = requests.post(ENDPOINT, headers=headers, files={"file": f}, data=${form}, timeout=90)
    response.raise_for_status()
    run = response.json()

    deadline = time.monotonic() + timeout
    while run["status"] in ("queued", "running"):
        if time.monotonic() > deadline:
            raise TimeoutError(f"Run {run['id']} is still {run['status']}")
        time.sleep(int(response.headers.get("Retry-After", "2")))
        response = requests.get(run["poll_url"], headers=HEADERS, timeout=30)
        response.raise_for_status()
        run = response.json()

    if run["status"] == "failed":
        raise RuntimeError(run["error"])
    return ${type}.model_validate(run["data"])
`;
}

function snake(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function pydanticClass(name: string, fields: Field[], out: string[]) {
  const lines = fields.map((field) => {
    const type = pythonType(field, `${name}${typeName(field.key)}`, out);
    const annotated = isNullable(field) ? `Optional[${type}]` : type;
    const description = describeSpec(field);
    const defaultValue = field.type === "array" ? "default_factory=list" : isNullable(field) ? "default=None" : "...";
    return `    ${field.key}: ${annotated} = Field(${defaultValue}${description ? `, description=${quote(description)}` : ""})`;
  });
  out.push(`class ${name}(BaseModel):\n${lines.join("\n")}`);
}

function pythonType(spec: FieldSpec, nestedName: string, out: string[]): string {
  switch (spec.type) {
    case "string":
      return "str";
    case "date":
      return "datetime.date";
    case "number":
      return "float";
    case "integer":
      return "int";
    case "boolean":
      return "bool";
    case "enum":
      return `Literal[${(spec.enumValues ?? []).map(quote).join(", ")}]`;
    case "object":
      pydanticClass(nestedName, spec.fields ?? [], out);
      return nestedName;
    case "array":
      return `list[${pythonType(spec.item ?? { type: "string" }, nestedName.replace(/s$/, ""), out)}]`;
  }
}

// ---------------------------------------------------------------------------
// JSON Schema and cURL
// ---------------------------------------------------------------------------

export function jsonSchemaSnippet(fields: Field[]) {
  return JSON.stringify(fieldsToJsonSchema(fields), null, 2);
}

export function curlSnippets(endpoint: string, apiKeyRequired: boolean, version?: number) {
  const auth = apiKeyRequired ? ` \\\n  -H "Authorization: Bearer $EXTRACT_LAB_API_KEY"` : "";
  const pin = version ? ` \\\n  -F version=${version}` : "";
  const runsUrl = endpoint.replace(/\/extract\/[^/]+$/, "/runs/<id>");
  return {
    file: `curl ${endpoint}${auth} \\\n  -H "Idempotency-Key: my-doc-0001" \\\n  -F file=@document.pdf \\\n  -F wait=30${pin}`,
    poll: `curl ${runsUrl}${auth}`,
    text: `curl ${endpoint}${auth} \\\n  -F text="Invoice INV-001 ... Total due: $120.50" \\\n  -F wait=30${pin}`,
    url: `curl ${endpoint}${auth} \\\n  -F url=https://example.com/receipt.jpg \\\n  -F wait=30${pin}`,
    json: `curl ${endpoint}${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '{"json": {"order_id": "A-104", "items": []}, "wait": 30${version ? `, "version": ${version}` : ""}}'`,
  };
}

/** Every field that has rules, as [shape, type, rules], e.g. ["items[].price", "number", { min: 0 }]. */
function collectRules(fields: Field[], prefix = ""): Array<[string, string, FieldRules]> {
  return fields.flatMap((field): Array<[string, string, FieldRules]> => {
    const shape = prefix ? `${prefix}.${field.key}` : field.key;
    if (field.type === "object") return collectRules(field.fields ?? [], shape);
    if (field.type === "array") {
      const item = field.item ?? { type: "string" };
      if (item.type === "object") return collectRules(item.fields ?? [], `${shape}[]`);
      return item.rules ? [[`${shape}[]`, item.type, item.rules]] : [];
    }
    return field.rules ? [[shape, field.type, field.rules]] : [];
  });
}

/**
 * A standalone `check<Type>()` with the same field rules Extract Lab runs, so the shipped code
 * flags the same problems. Empty when the schema has no rules.
 */
export function rulesCheckerCode(fields: Field[], type: string) {
  const rules = collectRules(fields).filter(([, , r]) => Object.keys(r).length > 0);
  if (rules.length === 0) return "";
  return `
// Field checks from Extract Lab: free and exact, no AI. Returns plain-language problems; empty means all passed.
// const problems = check${type}(result);
const RULES: Array<[string, string, Record<string, any>]> = ${JSON.stringify(rules)};

export function check${type}(data: ${type}): string[] {
  const problems: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const empty = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
  const formats: Record<string, RegExp> = {
    email: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/,
    url: /^(https?:\\/\\/)?([\\p{L}\\p{N}-]+\\.)+[\\p{L}]{2,}(\\/\\S*)?$/u,
  };
  for (const [shape, type, r] of RULES) {
    for (const [path, value] of valuesAt(data, shape)) {
      if (empty(value)) {
        if (r.required) problems.push(\`\${path}: empty, but should always have a value.\`);
        continue;
      }
      if (typeof value === "string") {
        if (r.format === "phone") {
          const digits = value.replace(/\\D/g, "").length;
          if (!/^[+\\d\\s().\\-/]+$/.test(value.trim()) || digits < 7 || digits > 15) problems.push(\`\${path}: not a valid phone number.\`);
        } else if (r.format && !formats[r.format].test(value.trim())) {
          problems.push(\`\${path}: not a valid \${r.format === "url" ? "web address" : "email address"}.\`);
        }
        if (r.pattern && !new RegExp(\`^(?:\${r.pattern})$\`, "u").test(value.trim())) problems.push(\`\${path}: doesn't match \${r.pattern}.\`);
      }
      if ((type === "number" || type === "integer") && typeof value === "number") {
        if (r.min !== undefined && value < r.min) problems.push(\`\${path}: \${value} is below \${r.min}.\`);
        if (r.max !== undefined && value > r.max) problems.push(\`\${path}: \${value} is above \${r.max}.\`);
        if (r.sumOf?.length) {
          const parts = (r.sumOf as string[])
            .flatMap((s) => valuesAt(data, s))
            .map(([, v]) => v)
            .filter((v): v is number => typeof v === "number");
          const sum = parts.reduce((a, b) => a + b, 0);
          if (parts.length && Math.abs(value - sum) > Math.max(0.011, Math.abs(sum) * 0.001)) {
            problems.push(\`\${path}: should equal \${r.sumOf.join(" + ")} = \${Number(sum.toFixed(4))}, but is \${value}.\`);
          }
        }
      }
      if (type === "date" && typeof value === "string") {
        const date = value.slice(0, 10);
        if (r.notInFuture && date > today) problems.push(\`\${path}: \${date} is in the future.\`);
        const other = r.notBefore ? valuesAt(data, r.notBefore).map(([, v]) => v).find((v) => typeof v === "string") : undefined;
        if (typeof other === "string" && date < other.slice(0, 10)) {
          problems.push(\`\${path}: \${date} is before \${r.notBefore} (\${other.slice(0, 10)}).\`);
        }
      }
    }
  }
  return problems;
}

/** Resolves "items[].price" to every [path, value] it names. */
function valuesAt(data: unknown, shape: string): Array<[string, unknown]> {
  let found: Array<[string, unknown]> = [["", data]];
  for (const part of shape.split(".")) {
    const key = part.replace(/\\[\\]$/, "");
    const each = part.endsWith("[]");
    found = found.flatMap(([path, value]): Array<[string, unknown]> => {
      const child = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
      const childPath = path ? \`\${path}.\${key}\` : key;
      if (!each) return [[childPath, child]];
      return Array.isArray(child) ? child.map((item, i): [string, unknown] => [\`\${childPath}[\${i}]\`, item]) : [];
    });
  }
  return found;
}
`;
}
