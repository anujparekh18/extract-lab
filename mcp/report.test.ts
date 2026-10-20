import { describe, expect, test } from "bun:test";
import type { Field } from "../src/lib/fields";
import { answerProblems, checkReport, completeAnswer, wrongFields } from "./report";

const fields: Field[] = [
  { key: "number", type: "string" },
  { key: "total", type: "number" },
  { key: "seller", type: "object", nullable: false, fields: [{ key: "name", type: "string" }, { key: "gstin", type: "string" }] },
  { key: "items", type: "array", item: { type: "object", fields: [{ key: "name", type: "string" }, { key: "price", type: "number" }] } },
];

describe("correct answers from records", () => {
  test("fills values a spreadsheet leaves out", () => {
    expect(completeAnswer(fields, { total: 10, seller: { name: "Acme" }, items: [{ name: "Bolt" }] })).toEqual({
      number: null,
      total: 10,
      seller: { name: "Acme", gstin: null },
      items: [{ name: "Bolt", price: null }],
    });
    expect(completeAnswer(fields, {})).toEqual({ number: null, total: null, seller: { name: null, gstin: null }, items: [] });
  });

  test("accepts a partial answer that fits the fields", () => {
    expect(answerProblems(fields, { number: "INV-1", total: 10 })).toEqual([]);
  });

  test("names unknown keys, nested ones too, and wrong types", () => {
    const problems = answerProblems(fields, { totl: 1, total: "ten", seller: { name: "Acme", city: "Pune" }, items: [{ qty: 2 }] });
    expect(problems).toContain(`"totl" isn't a field of this extractor.`);
    expect(problems).toContain(`"seller.city" isn't a field of this extractor.`);
    expect(problems).toContain(`"items[0].qty" isn't a field of this extractor.`);
    expect(problems.some((p) => p.startsWith("total:"))).toBe(true);
    expect(answerProblems(fields, [1, 2])).toHaveLength(1);
  });
});

describe("reports for agents", () => {
  test("lists only the wrong fields of an extraction", () => {
    const result = wrongFields(fields, { number: "INV-1", total: 10 }, { number: "INV-1", total: 12 });
    expect(result.wrong).toEqual([{ path: "total", status: "mismatch", correctAnswer: 10, modelAnswer: 12 }]);
    expect(result).not.toHaveProperty("importantCorrect");

    const marked = fields.map((f) => (f.key === "total" ? { ...f, important: true } : f));
    const scored = wrongFields(marked, { number: "INV-1", total: 10 }, { number: "INV-1", total: 12 });
    expect(scored.importantCorrect).toBe("0/1");
    expect(scored.wrong[0]).toMatchObject({ path: "total", important: true });
  });

  test("groups the weakest fields across documents and hides perfect documents", () => {
    const field = (path: string, shape: string, status: string, ruleIssues?: string[]) => ({
      path,
      shape,
      spec: { type: "number" },
      status,
      important: shape === "total",
      expected: 1,
      actual: status === "match" ? 1 : 2,
      ruleIssues,
    });
    const doc = (title: string, fields: ReturnType<typeof field>[], ruleFailures = 0) => ({
      documentId: title,
      title,
      run: { status: "success" },
      accuracy: fields.filter((f) => f.status === "match").length / fields.length,
      matched: fields.filter((f) => f.status === "match").length,
      total: fields.length,
      fields,
      ruleFailures,
    });
    const check = {
      eval: { _id: "check1", model: "google/gemini" },
      promptVersion: 3,
      schemaVersion: 2,
      summary: {
        total: 3,
        running: 0,
        failed: 0,
        matchedFields: 6,
        totalFields: 9,
        fieldAccuracy: 6 / 9,
        perfectDocs: 1,
        scoredDocs: 3,
        avgCostUsd: 0.00123456789,
        p50LatencyMs: 900,
        docsFailingRules: 1,
        importantMatchedFields: 2,
        importantTotalFields: 3,
        importantPerfectDocs: 2,
      },
      docs: [
        doc("A", [field("items[0].price", "items[].price", "mismatch"), field("items[1].price", "items[].price", "mismatch"), field("total", "total", "match")]),
        doc("B", [field("items[0].price", "items[].price", "match"), field("total", "total", "mismatch"), field("x", "x", "match")]),
        doc("C", [field("total", "total", "match", ["Should equal the sum"]), field("x", "x", "match"), field("y", "y", "match")], 1),
      ],
    } as unknown as Parameters<typeof checkReport>[0];

    const report = checkReport(check);
    // Important fields lead, even when another field fails more often.
    expect(report.weakestFields).toEqual([
      { field: "total", important: true, wrong: 1, of: 3 },
      { field: "items[].price", wrong: 2, of: 3 },
    ]);
    expect(report.importantFieldsCorrect).toBe("2/3");
    expect(report.documentsWithImportantFieldsRight).toBe("2/3");
    expect(report.avgCostUsd).toBe(0.001235);
    const problems = "documentsWithProblems" in report ? report.documentsWithProblems : [];
    // C has every value right, but one breaks a field check, so it's still listed.
    expect(problems.map((d) => d.title)).toEqual(["A", "B", "C"]);
    expect(problems[1].fields).toHaveLength(1);
    const full = checkReport(check, { allFields: true });
    expect("documentResults" in full ? full.documentResults : []).toHaveLength(3);
  });
});
