import { describe, expect, test } from "bun:test";
import { compareOutputs, parseLooseNumber } from "./compare";
import {
  countFields,
  fieldsToJsonSchema,
  fieldsToZod,
  flattenLeaves,
  hashString,
  inferFields,
  jsonSchemaToFields,
  stableStringify,
  validateFields,
  type Field,
} from "./fields";
import { getAtPath, parsePath, setAtPath } from "./paths";
import { fieldsToZodCode, rulesCheckerCode, typeName } from "./codegen";
import { TEMPLATES, defaultExtractorName } from "./templates";
import { diffChecks, previousCheck } from "./check-diff";
import { diffFields, diffLines } from "./version-diff";
import { checkRules, ruleSetupProblems } from "./rules";
import {
  buildCatalog,
  cheapestModel,
  cheapModels,
  estimateCostUsd,
  fileProblem,
  isCurrentModel,
  modelIdProblem,
  normalizeModelsDev,
  pickerModels,
} from "./models";

const fields: Field[] = [
  { key: "vendor", type: "string" },
  { key: "address", type: "string", match: "loose" },
  { key: "summary", type: "string", match: "ignore" },
  { key: "date", type: "date" },
  { key: "total", type: "number" },
  { key: "paid", type: "boolean" },
  { key: "status", type: "enum", enumValues: ["open", "paid"] },
  {
    key: "items",
    type: "array",
    item: { type: "object", fields: [{ key: "name", type: "string" }, { key: "qty", type: "integer" }] },
  },
];

describe("compareOutputs", () => {
  const expected = {
    vendor: "Acme Ltd",
    address: "14 Harbour Street, Leeds LS1 4AB",
    summary: "anything",
    date: "2026-08-03",
    total: 625.5,
    paid: false,
    status: "open",
    items: [{ name: "Widget", qty: 2 }],
  };

  test("identical output scores 100% and ignores 'ignore' fields", () => {
    const result = compareOutputs(fields, expected, { ...expected, summary: "totally different" });
    expect(result.accuracy).toBe(1);
    expect(result.fields.some((f) => f.path === "summary")).toBe(false);
  });

  test("normalizes case, whitespace, number formats and dates", () => {
    const result = compareOutputs(fields, expected, {
      ...expected,
      vendor: "  ACME   ltd ",
      total: "625.50",
      date: "2026-8-3",
      address: "14 Harbour Street Leeds, LS1 4AB",
    });
    expect(result.fields.filter((f) => f.status !== "match")).toEqual([]);
  });

  test("classifies missing, unexpected, and mismatch", () => {
    const result = compareOutputs(fields, expected, {
      ...expected,
      vendor: null,
      paid: true,
      items: [{ name: "Widget", qty: 2 }, { name: "Extra", qty: 1 }],
    });
    const status = Object.fromEntries(result.fields.map((f) => [f.path, f.status]));
    expect(status.vendor).toBe("missing");
    expect(status.paid).toBe("mismatch");
    expect(status["items[1].name"]).toBe("unexpected");
    expect(result.accuracy).toBeLessThan(1);
  });

  test("both empty counts as a match", () => {
    const result = compareOutputs([{ key: "email", type: "string" }], { email: null }, { email: "" });
    expect(result.accuracy).toBe(1);
  });

  test("leaves 'not sure' values out of the score", () => {
    const output = { ...expected, total: 999, items: [{ name: "Widget", qty: 7 }] };
    const scored = compareOutputs(fields, expected, output);
    const unsure = compareOutputs(fields, expected, output, ["total", "items[0].qty"]);
    expect(scored.total - unsure.total).toBe(2);
    expect(unsure.fields.some((f) => f.path === "total" || f.path === "items[0].qty")).toBe(false);
    expect(unsure.accuracy).toBe(1);
  });
});

describe("fields", () => {
  test("zod schema validates nullable scalars and rejects wrong types", () => {
    const schema = fieldsToZod(fields);
    const ok = schema.safeParse({
      vendor: null,
      address: null,
      summary: null,
      date: null,
      total: 1.5,
      paid: null,
      status: "paid",
      items: [],
    });
    expect(ok.success).toBe(true);
    const bad = schema.safeParse({ ...ok.data, status: "refunded" });
    expect(bad.success).toBe(false);
  });

  test("groups are required objects by default", () => {
    const schema = fieldsToZod([{ key: "seller", type: "object", fields: [{ key: "name", type: "string" }] }]);
    expect(schema.safeParse({ seller: null }).success).toBe(false);
    expect(schema.safeParse({ seller: { name: null } }).success).toBe(true);
  });

  test("JSON Schema round-trips through import", () => {
    const back = jsonSchemaToFields(fieldsToJsonSchema(fields));
    expect(back.map((f) => [f.key, f.type])).toEqual(fields.map((f) => [f.key, f.type === "date" ? "string" : f.type]));
    expect(back.find((f) => f.key === "status")?.enumValues).toEqual(["open", "paid"]);
  });

  test("infers a schema from example outputs", () => {
    const inferred = inferFields([
      { id: 4, name: "Bench", sets: [{ reps: 8, kg: 85.5 }], note: null, on: "2026-01-02" },
      { id: 5, name: "Row", sets: [], note: "ok", on: "2026-01-03" },
    ]);
    const byKey = Object.fromEntries(inferred.map((f) => [f.key, f]));
    expect(byKey.id.type).toBe("integer");
    expect(byKey.note.nullable).toBe(true);
    expect(byKey.on.type).toBe("date");
    expect(byKey.sets.type).toBe("array");
    expect(byKey.sets.item?.fields?.map((f) => [f.key, f.type])).toEqual([
      ["reps", "integer"],
      ["kg", "number"],
    ]);
  });

  test("validates names, duplicates, and enum options", () => {
    const errors = validateFields([
      { key: "a b", type: "string" },
      { key: "x", type: "string" },
      { key: "x", type: "enum", enumValues: ["only"] },
    ]);
    expect(errors.length).toBe(3);
  });

  test("flattens leaves with list paths and shapes", () => {
    const leaves = flattenLeaves(fields, { items: [{ name: "A", qty: 1 }, { name: "B", qty: 2 }] });
    expect(leaves.map((l) => l.path)).toContain("items[1].qty");
    expect(leaves.find((l) => l.path === "items[1].qty")?.shape).toBe("items[].qty");
    expect(countFields(fields)).toBe(9);
  });

  test("stable hashing ignores key order", () => {
    expect(hashString(stableStringify({ a: 1, b: [1, { c: 2, d: 3 }] }))).toBe(
      hashString(stableStringify({ b: [1, { d: 3, c: 2 }], a: 1 })),
    );
  });

  test("every template is valid and its samples match its schema", () => {
    for (const template of TEMPLATES) {
      expect(validateFields(template.fields)).toEqual([]);
      const schema = fieldsToZod(template.fields);
      for (const sample of template.samples) {
        const parsed = schema.safeParse(sample.expected);
        if (!parsed.success) throw new Error(`${template.id} / ${sample.title}: ${parsed.error.message}`);
      }
    }
  });
});

describe("paths", () => {
  test("parse, get and set nested paths immutably", () => {
    expect(parsePath("a.b[2].c")).toEqual(["a", "b", 2, "c"]);
    const root = { a: { b: [{ c: 1 }] } };
    const next = setAtPath(root, "a.b[1].c", 5);
    expect(getAtPath(next, "a.b[1].c")).toBe(5);
    expect(getAtPath(root, "a.b[1].c")).toBeUndefined();
  });
});

describe("codegen", () => {
  test("type names and zod code", () => {
    expect(typeName("Vendor invoices")).toBe("VendorInvoice");
    expect(typeName("Receipts")).toBe("Receipt");
    const code = fieldsToZodCode([{ key: "status", type: "enum", enumValues: ["a", "b"] }]);
    expect(code).toContain('z.enum(["a", "b"]).nullable()');
  });
});

describe("parseJsonInput", () => {
  const { parseJsonInput } = require("./json-input") as typeof import("./json-input");

  test("plain JSON", () => {
    const r = parseJsonInput('{"a": 1}');
    expect(r.ok && r.value).toEqual({ a: 1 });
  });

  test("unwraps double-encoded JSON", () => {
    const r = parseJsonInput(JSON.stringify(JSON.stringify({ a: [1, 2] })));
    expect(r.ok && r.value).toEqual({ a: [1, 2] });
    expect(r.ok && r.notes.length).toBe(1);
  });

  test("combines labelled sections, including double-encoded ones", () => {
    const text = `Context:\n\n${JSON.stringify(JSON.stringify({ id: 1 }))}\n\nAnalysis:\n{"delta": -0.2}\n`;
    const r = parseJsonInput(text);
    expect(r.ok && r.value).toEqual({ Context: { id: 1 }, Analysis: { delta: -0.2 } });
  });

  test("rejects trailing prose and reports a position", () => {
    expect(parseJsonInput('Context:\n{"a":1}\n\nNow summarize this.').ok).toBe(false);
    const bad = parseJsonInput('{\n  "a": 1,\n}');
    // V8 (browsers, Convex) reports a position we turn into line/column; other engines just a message.
    expect(!bad.ok && bad.error).toMatch(/line 3|JSON/);
    expect(parseJsonInput("42").ok).toBe(false);
  });
});

describe("diffChecks", () => {
  const doc = (id: string, statuses: Record<string, "match" | "mismatch">, accuracy: number | null = 1) => ({
    documentId: id,
    title: id,
    accuracy,
    fields: Object.entries(statuses).map(([path, status]) => ({ path, status })),
  });

  test("reports fields that were fixed and fields that broke", () => {
    const before = [doc("a", { total: "mismatch", date: "match" }), doc("b", { total: "match" })];
    const after = [doc("a", { total: "match", date: "mismatch" }), doc("b", { total: "match" })];
    const diff = diffChecks(after, before);
    expect(diff.compared).toBe(2);
    expect(diff.fixed.map((f) => f.path)).toEqual(["total"]);
    expect(diff.broke.map((f) => `${f.documentId}:${f.path}`)).toEqual(["a:date"]);
  });

  test("skips documents that weren't scored in both checks", () => {
    const before = [doc("a", { total: "mismatch" }, null)];
    const after = [doc("a", { total: "match" }), doc("new", { total: "match" })];
    expect(diffChecks(after, before)).toEqual({ fixed: [], broke: [], compared: 0 });
  });
});

describe("previousCheck", () => {
  const check = (id: string, model: string, prompt: string, schema = "s1") => ({
    id,
    model,
    promptVersionId: prompt,
    schemaVersionId: schema,
  });

  test("compares with the same model's last different version, not a re-run", () => {
    const current = check("c", "flash", "p2");
    const older = [check("rerun", "flash", "p2"), check("other-model", "pro", "p1"), check("before", "flash", "p1")];
    expect(previousCheck(current, older)?.id).toBe("before");
  });

  test("falls back to a re-run when no other version was checked", () => {
    expect(previousCheck(check("c", "flash", "p1"), [check("rerun", "flash", "p1")])?.id).toBe("rerun");
    expect(previousCheck(check("c", "flash", "p1"), [])).toBeNull();
  });
});

describe("model catalog", () => {
  test("applies edits to built-in models and adds custom ones", () => {
    const catalog = buildCatalog([
      { modelId: "google/gemini-3.8-flash", input: 1, custom: false },
      { modelId: "google/gemini-2.5-flash", hidden: true, custom: false },
      { modelId: "openai/gpt-6", label: "GPT-6", input: 3, output: 15, custom: true },
    ]);
    const flash = catalog.find((m) => m.id === "google/gemini-3.8-flash")!;
    expect(flash.input).toBe(1);
    expect(flash.output).toBe(3.75);
    expect(flash.edited).toBe(true);
    expect(catalog.find((m) => m.id === "google/gemini-2.5-flash")!.hidden).toBe(true);
    const added = catalog.find((m) => m.id === "openai/gpt-6")!;
    expect(added).toMatchObject({ provider: "openai", model: "gpt-6", label: "GPT-6", custom: true });
    expect(estimateCostUsd("openai/gpt-6", { inputTokens: 1_000_000, outputTokens: 0 }, catalog)).toBe(3);
  });

  test("ignores custom rows with an unknown provider", () => {
    expect(buildCatalog([{ modelId: "acme/model-1", custom: true }]).some((m) => m.id === "acme/model-1")).toBe(false);
  });

  test("picks the cheapest visible model that has a key", () => {
    const catalog = buildCatalog([{ modelId: "google/gemini-3.1-flash-lite", hidden: true, custom: false }]);
    const pick = cheapestModel(catalog, (id) => id.startsWith("google/"));
    expect(pick?.id).toBe("google/gemini-2.5-flash");
  });

  test("validates model ids", () => {
    expect(modelIdProblem("gemini 3")).not.toBeNull();
    expect(modelIdProblem("gemini-3.8-flash")).toBeNull();
  });
});

describe("models.dev catalog", () => {
  const raw = {
    google: {
      models: {
        "gemini-9-flash": {
          id: "gemini-9-flash",
          name: "Gemini 9 Flash",
          release_date: "2026-09-01",
          structured_output: true,
          modalities: { input: ["text", "image", "pdf"], output: ["text"] },
          cost: { input: 0.5, output: 2 },
        },
        "gemini-9-flash-tts": {
          id: "gemini-9-flash-tts",
          modalities: { input: ["text"], output: ["audio"] },
          cost: { input: 1, output: 1 },
        },
        "gemini-embedding-9": { id: "gemini-embedding-9", modalities: { input: ["text"], output: ["text"] }, cost: { input: 0.1, output: 0 } },
        "gemini-free": { id: "gemini-free", modalities: { input: ["text"], output: ["text"] } },
      },
    },
    openai: {
      models: {
        "gpt-old": {
          id: "gpt-old",
          name: "GPT Old",
          status: "deprecated",
          release_date: "2024-01-01",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 1, output: 4 },
        },
        "gpt-nostruct": {
          id: "gpt-nostruct",
          structured_output: false,
          modalities: { input: ["text"], output: ["text"] },
          cost: { input: 1, output: 4 },
        },
      },
    },
    mistral: { models: { "mistral-large": { id: "mistral-large", modalities: { input: ["text"], output: ["text"] }, cost: { input: 2, output: 6 } } } },
  };

  test("keeps priced, text-out, structured-output models from supported providers", () => {
    const models = normalizeModelsDev(raw);
    expect(models.map((m) => m.id)).toEqual(["google/gemini-9-flash", "openai/gpt-old"]);
    expect(models[0]).toMatchObject({ label: "Gemini 9 Flash", input: 0.5, output: 2, files: "pdf" });
    expect(models[1]).toMatchObject({ files: "image", deprecated: true });
  });

  test("synced models replace the built-in list, and edits still apply", () => {
    const synced = normalizeModelsDev(raw);
    const catalog = buildCatalog([{ modelId: "google/gemini-9-flash", output: 3, custom: false }], synced);
    expect(catalog.map((m) => m.id)).toEqual(["google/gemini-9-flash", "openai/gpt-old"]);
    expect(catalog[0].output).toBe(3);
    expect(buildCatalog([], []).length).toBeGreaterThan(0);
  });

  test("leads with current models and searches everything", () => {
    const catalog = buildCatalog([], normalizeModelsDev(raw));
    const now = Date.parse("2026-10-01");
    expect(isCurrentModel(catalog[0], now)).toBe(true);
    expect(isCurrentModel(catalog[1], now)).toBe(false);
    expect(pickerModels(catalog, { query: "gpt old" }).map((m) => m.id)).toEqual(["openai/gpt-old"]);
    expect(pickerModels(catalog, { showAll: true })).toHaveLength(2);
  });

  test("explains when a model can't read the file", () => {
    expect(fileProblem({ label: "X", files: "image" }, "application/pdf")).toContain("can't read PDFs");
    expect(fileProblem({ label: "X", files: "text" }, "image/png")).toContain("only reads text");
    expect(fileProblem({ label: "X", files: "pdf" }, "application/pdf")).toBeNull();
  });
});

describe("parseLooseNumber", () => {
  test.each([
    ["1,234.50", 1234.5],
    ["1.234,50", 1234.5],
    ["1 234,50 €", 1234.5],
    ["1,43,504.71", 143504.71],
    ["₹ 1,43,504", 143504],
    ["12,5", 12.5],
    ["1,250", 1250],
    ["1.250.000", 1250000],
    ["$-5", -5],
    ["0.75", 0.75],
  ])("%s → %d", (text, expected) => {
    expect(parseLooseNumber(text)).toBe(expected);
  });

  test("returns null without digits", () => {
    expect(parseLooseNumber("n/a")).toBeNull();
  });
});

describe("field rules", () => {
  const receipt: Field[] = [
    { key: "merchant", type: "string", rules: { required: true } },
    { key: "email", type: "string", rules: { format: "email" } },
    { key: "date", type: "date", rules: { notInFuture: true } },
    { key: "due", type: "date", rules: { notBefore: "date" } },
    { key: "items", type: "array", item: { type: "object", fields: [{ key: "price", type: "number", rules: { min: 0 } }] } },
    { key: "subtotal", type: "number", rules: { sumOf: ["items[].price"] } },
    { key: "tax", type: "number" },
    { key: "total", type: "number", rules: { sumOf: ["subtotal", "tax"], max: 1000 } },
    { key: "code", type: "string", rules: { pattern: "[A-Z]{3}-\\d{4}" } },
  ];
  const good = {
    merchant: "Blue Door",
    email: "hi@bluedoor.cafe",
    date: "2026-09-12",
    due: "2026-10-12",
    items: [{ price: 9 }, { price: 14.5 }],
    subtotal: 23.5,
    tax: "2,39",
    total: 25.89,
    code: "INV-0042",
  };

  test("passes a consistent extraction", () => {
    expect(checkRules(receipt, good, "2026-10-01")).toEqual([]);
  });

  test("flags each broken rule with a reason", () => {
    const bad = { ...good, merchant: " ", email: "hi@bluedoor", date: "2062-09-12", due: "2026-01-01", items: [{ price: -1 }], total: 53.1, code: "inv42" };
    const issues = checkRules(receipt, bad, "2026-10-01");
    expect(issues.map((i) => `${i.path}:${i.rule}`).sort()).toEqual(
      [
        "merchant:required",
        "email:format",
        "date:notInFuture",
        "due:notBefore",
        "items[0].price:min",
        "subtotal:sumOf",
        "total:sumOf",
        "code:pattern",
      ].sort(),
    );
    expect(issues.find((i) => i.path === "total")?.message).toBe("Should equal subtotal + tax = 25.89, but is 53.1.");
  });

  test("tolerates rounding in sums", () => {
    expect(checkRules(receipt, { ...good, total: 25.9 }, "2026-10-01")).toEqual([]);
  });

  test("reports rules that are set up wrong", () => {
    const fields: Field[] = [
      { key: "total", type: "number", rules: { sumOf: ["missing"], pattern: "(" } },
      { key: "items", type: "array", item: { type: "object", fields: [{ key: "a", type: "number", rules: { sumOf: ["total"] } }] } },
    ];
    expect(ruleSetupProblems(fields)).toHaveLength(3);
  });
});

describe("generated rules checker", () => {
  const fields: Field[] = [
    { key: "email", type: "string", rules: { format: "email", required: true } },
    { key: "date", type: "date", rules: { notInFuture: true } },
    { key: "items", type: "array", item: { type: "object", fields: [{ key: "price", type: "number", rules: { min: 0 } }] } },
    { key: "total", type: "number", rules: { sumOf: ["items[].price"] } },
    { key: "code", type: "string", rules: { pattern: "[A-Z]{3}-\\d{4}" } },
  ];

  function compile(): (data: unknown) => string[] {
    const ts = `type Receipt = any;${rulesCheckerCode(fields, "Receipt")}`.replace(/export function/g, "function");
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(ts);
    return new Function(`${js}; return checkReceipt;`)();
  }

  test("is empty when a schema has no rules", () => {
    expect(rulesCheckerCode([{ key: "a", type: "string" }], "X")).toBe("");
  });

  test("agrees with the rules Extract Lab runs", () => {
    const check = compile();
    const good = { email: "a@b.co", date: "2020-01-01", items: [{ price: 1.5 }, { price: 2 }], total: 3.5, code: "INV-0042" };
    expect(check(good)).toEqual([]);
    const bad = { email: "nope", date: "2999-01-01", items: [{ price: -1 }, { price: 2 }], total: 9, code: "x" };
    const problems = check(bad);
    expect(problems).toHaveLength(5);
    expect(problems).toContain("total: should equal items[].price = 1, but is 9.");
    expect(problems.some((p) => p.startsWith("items[0].price:"))).toBe(true);
    expect(check({ ...good, email: "" })).toEqual(["email: empty, but should always have a value."]);
  });
});

describe("template rules", () => {
  test("every sample's correct answer passes its template's rules", () => {
    for (const template of TEMPLATES) {
      for (const sample of template.samples) {
        expect({ template: template.id, sample: sample.title, issues: checkRules(template.fields, sample.expected, "2026-10-05") }).toEqual({
          template: template.id,
          sample: sample.title,
          issues: [],
        });
      }
    }
  });

  test("template rules are set up correctly", () => {
    for (const template of TEMPLATES) expect(ruleSetupProblems(template.fields)).toEqual([]);
  });
});

describe("helper model choice", () => {
  test("prefers current models over cheaper old ones", () => {
    const synced = normalizeModelsDev({
      google: {
        models: {
          old: { id: "old-lite", release_date: "2025-01-01", modalities: { input: ["text", "pdf"], output: ["text"] }, cost: { input: 0.1, output: 0.4 } },
          now: { id: "new-lite", release_date: "2026-08-01", modalities: { input: ["text", "pdf"], output: ["text"] }, cost: { input: 0.25, output: 1.5 } },
        },
      },
    });
    const catalog = buildCatalog([], synced);
    const order = cheapModels(catalog, () => true, Date.parse("2026-10-01")).map((m) => m.model);
    expect(order).toEqual(["new-lite", "old-lite"]);
  });
});

describe("default extractor names", () => {
  test("uses the template's name, numbered only when taken", () => {
    expect(defaultExtractorName("Invoice", ["Receipts"])).toBe("Invoice");
    expect(defaultExtractorName("Invoice", ["invoice"])).toBe("Invoice 2");
    expect(defaultExtractorName("Invoice", ["Invoice", "Invoice 2"])).toBe("Invoice 3");
  });
});

describe("important fields", () => {
  const fields: Field[] = [
    { key: "amount", type: "number", important: true },
    { key: "branch_phone", type: "string" },
    { key: "borrower", type: "object", important: true, fields: [{ key: "name", type: "string" }, { key: "pan", type: "string" }] },
    { key: "charges", type: "array", important: true, item: { type: "object", fields: [{ key: "fee", type: "number" }] } },
  ];

  test("are scored on their own, including fields inside an important group or list", () => {
    const expected = { amount: 500000, branch_phone: "0261 22", borrower: { name: "Asha Mills", pan: "AAAPA1234A" }, charges: [{ fee: 1200 }] };
    const actual = { amount: 500000, branch_phone: "0261 99", borrower: { name: "Asha Mills", pan: "AAAPA1234B" }, charges: [{ fee: 1200 }] };
    const result = compareOutputs(fields, expected, actual);
    expect(result.total).toBe(5);
    expect(result.matched).toBe(3);
    expect(result.importantTotal).toBe(4);
    expect(result.importantMatched).toBe(3);
    expect(result.fields.find((f) => f.path === "borrower.pan")?.important).toBe(true);
    expect(result.fields.find((f) => f.path === "branch_phone")?.important).toBe(false);
  });

  test("count zero when none are marked", () => {
    const plain = fields.map(({ important: _, ...f }) => f as Field);
    const result = compareOutputs(plain, { amount: 1 }, { amount: 1 });
    expect(result.importantTotal).toBe(0);
    expect(result.importantMatched).toBe(0);
  });

  test("are marked on flattened values", () => {
    const leaves = flattenLeaves(fields, { amount: 1, branch_phone: "x", borrower: { name: "A" }, charges: [] });
    expect(leaves.filter((l) => l.important).map((l) => l.path)).toEqual(["amount", "borrower.name", "borrower.pan", "charges"]);
  });

  test("are marked in every starter template", () => {
    for (const template of TEMPLATES.filter((t) => t.id !== "blank")) {
      const leaves = flattenLeaves(template.fields, template.samples[0]?.expected);
      expect(leaves.some((l) => l.important)).toBe(true);
    }
  });
});

describe("version diffs", () => {
  test("diffLines keeps shared lines and marks the rest", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
    expect(diffLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });

  test("diffFields lists added, removed and changed fields, inside lists too", () => {
    const before: Field[] = [
      { key: "total", type: "number" },
      { key: "items", type: "array", item: { type: "object", fields: [{ key: "price", type: "number" }] } },
    ];
    const after: Field[] = [
      { key: "total", type: "number", important: true },
      { key: "items", type: "array", item: { type: "object", fields: [{ key: "qty", type: "integer" }] } },
    ];
    const changes = diffFields(before, after);
    expect(changes).toContainEqual({ kind: "changed", path: "total", changes: ["marked important"] });
    expect(changes.some((c) => c.kind === "added" && c.path === "items[].qty")).toBe(true);
    expect(changes.some((c) => c.kind === "removed" && c.path === "items[].price")).toBe(true);
  });
});
