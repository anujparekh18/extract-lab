import type { Field } from "./fields";

export type TemplateSample = {
  title: string;
  expected: Record<string, unknown>;
} & (
  | { text: string; file?: undefined }
  /** A file served from `public/`, e.g. "/samples/acme-invoice.pdf". The app uploads it when the extractor is created. */
  | { file: string; text?: undefined }
);

export type Template = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  fields: Field[];
  samples: TemplateSample[];
};

const party = (who: string): Field[] => [
  { key: "name", type: "string", description: `Legal or trading name of the ${who}.` },
  { key: "address", type: "string", match: "loose", description: "Full postal address on one line, as printed." },
  { key: "tax_id", type: "string", description: "VAT, GST, EIN, or other tax registration number, exactly as printed." },
  { key: "email", type: "string", rules: { format: "email" } },
];

const invoice: Template = {
  id: "invoice",
  name: "Invoice",
  description: "Vendor, customer, dates, line items, and totals from supplier invoices.",
  prompt: `You extract data from invoices for an accounts-payable system.

- The seller issues the invoice; the buyer is billed ("Bill to", "Customer").
- Copy identifiers (invoice number, tax IDs) exactly, including dashes and letters.
- Amounts are plain numbers without currency symbols or thousands separators.
- If a value is not on the invoice, return null. Do not calculate missing totals.`,
  fields: [
    { key: "invoice_number", type: "string", important: true, rules: { required: true } },
    { key: "issue_date", type: "date", important: true, rules: { notInFuture: true } },
    { key: "due_date", type: "date", rules: { notBefore: "issue_date" } },
    { key: "currency", type: "string", description: "ISO 4217 code, e.g. USD, EUR, INR." },
    { key: "seller", type: "object", nullable: false, fields: party("seller") },
    { key: "buyer", type: "object", nullable: false, fields: party("buyer") },
    {
      key: "line_items",
      type: "array",
      item: {
        type: "object",
        nullable: false,
        fields: [
          { key: "description", type: "string", match: "loose" },
          { key: "quantity", type: "number" },
          { key: "unit_price", type: "number" },
          { key: "amount", type: "number", description: "Line total as printed." },
        ],
      },
    },
    { key: "subtotal", type: "number", description: "Total before tax.", rules: { sumOf: ["line_items[].amount"] } },
    { key: "tax", type: "number", description: "Total tax amount." },
    { key: "total", type: "number", description: "Final amount due.", important: true, rules: { sumOf: ["subtotal", "tax"] } },
  ],
  samples: [
    {
      title: "Acme Design Studio – ACME-1042",
      file: "/samples/acme-invoice.pdf",
      expected: {
        invoice_number: "ACME-1042",
        issue_date: "2026-09-15",
        due_date: "2026-10-15",
        currency: "USD",
        seller: {
          name: "Acme Design Studio LLC",
          address: "500 Example Avenue, Suite 12, Springfield, IL 62701, USA",
          tax_id: "12-3456789",
          email: "billing@acme.example",
        },
        buyer: {
          name: "Example Corp",
          address: "42 Sample Street, Floor 3, Portland, OR 97201, USA",
          tax_id: "98-7654321",
          email: "ap@examplecorp.example",
        },
        line_items: [
          { description: "UX research and user interviews", quantity: 16, unit_price: 95, amount: 1520 },
          { description: "Visual design — page templates", quantity: 6, unit_price: 450, amount: 2700 },
          { description: "Design system handoff", quantity: 1, unit_price: 800, amount: 800 },
        ],
        subtotal: 5020,
        tax: 401.6,
        total: 5421.6,
      },
    },
    {
      title: "Northwind Cloud – INV-2026-0412",
      text: `NORTHWIND CLOUD SERVICES LTD
14 Harbour Street, Leeds LS1 4AB, United Kingdom
VAT: GB 123 4567 89   billing@northwind.example

INVOICE
Invoice no.: INV-2026-0412
Date: 3 August 2026
Payment due: 2 September 2026

Bill to:
Pinecrest Analytics GmbH
Rosenthaler Str. 40, 10178 Berlin, Germany
USt-IdNr.: DE123456789
accounts@pinecrest.example

Description                         Qty    Unit price     Amount
Managed Postgres – Standard tier     1      £420.00       £420.00
Object storage (TB-month)            3       £18.50        £55.50
Priority support                     1      £150.00       £150.00

                                   Subtotal             £625.50
                                   VAT 0% (reverse charge) £0.00
                                   TOTAL DUE             £625.50

Pay by bank transfer to Example Bank, sort code 00-00-00, account 12345678.`,
      expected: {
        invoice_number: "INV-2026-0412",
        issue_date: "2026-08-03",
        due_date: "2026-09-02",
        currency: "GBP",
        seller: {
          name: "Northwind Cloud Services Ltd",
          address: "14 Harbour Street, Leeds LS1 4AB, United Kingdom",
          tax_id: "GB 123 4567 89",
          email: "billing@northwind.example",
        },
        buyer: {
          name: "Pinecrest Analytics GmbH",
          address: "Rosenthaler Str. 40, 10178 Berlin, Germany",
          tax_id: "DE123456789",
          email: "accounts@pinecrest.example",
        },
        line_items: [
          { description: "Managed Postgres – Standard tier", quantity: 1, unit_price: 420, amount: 420 },
          { description: "Object storage (TB-month)", quantity: 3, unit_price: 18.5, amount: 55.5 },
          { description: "Priority support", quantity: 1, unit_price: 150, amount: 150 },
        ],
        subtotal: 625.5,
        tax: 0,
        total: 625.5,
      },
    },
    {
      title: "Kaveri Print Works – KPW/26-27/118",
      text: `Kaveri Print Works
Plot 22, Peenya Industrial Area, Bengaluru, Karnataka 560058
GSTIN: 29ABCDE1234F1Z5

TAX INVOICE                      No: KPW/26-27/118
                                 Date: 17/07/2026

Billed to: Lotus Bakes Pvt Ltd, 3rd Floor, 81 Residency Road, Bengaluru 560025
GSTIN: 29PQRST5678K1Z2

Sl  Item                          HSN    Qty   Rate      Amount
1   Paper bags, printed (500 pcs) 4819   4     1,250.00  5,000.00
2   Sticker labels (roll)         4821   10    180.00    1,800.00

Taxable value                                             6,800.00
CGST @ 6%                                                   408.00
SGST @ 6%                                                   408.00
Grand Total (INR)                                         7,616.00

Rupees Seven Thousand Six Hundred Sixteen only.`,
      expected: {
        invoice_number: "KPW/26-27/118",
        issue_date: "2026-07-17",
        due_date: null,
        currency: "INR",
        seller: {
          name: "Kaveri Print Works",
          address: "Plot 22, Peenya Industrial Area, Bengaluru, Karnataka 560058",
          tax_id: "29ABCDE1234F1Z5",
          email: null,
        },
        buyer: {
          name: "Lotus Bakes Pvt Ltd",
          address: "3rd Floor, 81 Residency Road, Bengaluru 560025",
          tax_id: "29PQRST5678K1Z2",
          email: null,
        },
        line_items: [
          { description: "Paper bags, printed (500 pcs)", quantity: 4, unit_price: 1250, amount: 5000 },
          { description: "Sticker labels (roll)", quantity: 10, unit_price: 180, amount: 1800 },
        ],
        subtotal: 6800,
        tax: 816,
        total: 7616,
      },
    },
  ],
};

const receipt: Template = {
  id: "receipt",
  name: "Receipt",
  description: "Merchant, date, items, and totals from shop and restaurant receipts, for expense apps.",
  prompt: `Extract expense data from a purchase receipt.

- Use the merchant name as printed at the top, not the payment processor.
- Amounts are plain numbers. Tip is separate from tax.
- Pick the category that best describes the purchase.`,
  fields: [
    { key: "merchant", type: "string", important: true, rules: { required: true } },
    { key: "date", type: "date", important: true, rules: { notInFuture: true } },
    { key: "category", type: "enum", enumValues: ["meals", "groceries", "travel", "office", "other"] },
    {
      key: "items",
      type: "array",
      item: {
        type: "object",
        nullable: false,
        fields: [
          { key: "name", type: "string" },
          { key: "price", type: "number", description: "Line total." },
        ],
      },
    },
    { key: "tax", type: "number" },
    { key: "tip", type: "number" },
    {
      key: "total",
      type: "number",
      description: "Amount charged, including tax and tip.",
      important: true,
      rules: { sumOf: ["items[].price", "tax", "tip"] },
    },
    { key: "payment_method", type: "enum", enumValues: ["card", "cash", "mobile", "other"] },
  ],
  samples: [
    {
      title: "Little Fern Bakery (photo)",
      file: "/samples/little-fern-receipt.png",
      expected: {
        merchant: "Little Fern Bakery",
        date: "2026-10-04",
        category: "meals",
        items: [
          { name: "Sourdough loaf", price: 8.5 },
          { name: "Croissant x2", price: 7 },
          { name: "Oat milk latte", price: 5.25 },
          { name: "Cinnamon roll", price: 4.75 },
        ],
        tax: 1.85,
        tip: null,
        total: 27.35,
        payment_method: "card",
      },
    },
    {
      title: "Blue Door Café",
      text: `BLUE DOOR CAFÉ
221 Valencia St, San Francisco CA
Table 7   Server: Maya
09/12/2026 12:48 PM

2  Flat white            9.00
1  Avocado toast        14.50
1  Blueberry muffin      4.25

Subtotal                27.75
Tax 8.625%               2.39
Tip                      5.00
TOTAL                   35.14

VISA ****4417  APPROVED
Thanks for stopping by!`,
      expected: {
        merchant: "Blue Door Café",
        date: "2026-09-12",
        category: "meals",
        items: [
          { name: "Flat white", price: 9 },
          { name: "Avocado toast", price: 14.5 },
          { name: "Blueberry muffin", price: 4.25 },
        ],
        tax: 2.39,
        tip: 5,
        total: 35.14,
        payment_method: "card",
      },
    },
    {
      title: "Metro Hardware",
      text: `METRO HARDWARE & SUPPLY
Store #0381

2026-08-29  17:05

USB-C charging cable 2m     12.99
A4 printer paper x5         27.45
Desk lamp LED               34.00

SUBTOTAL                    74.44
SALES TAX                    6.14
TOTAL                       80.58
CASH                       100.00
CHANGE                      19.42`,
      expected: {
        merchant: "Metro Hardware & Supply",
        date: "2026-08-29",
        category: "office",
        items: [
          { name: "USB-C charging cable 2m", price: 12.99 },
          { name: "A4 printer paper x5", price: 27.45 },
          { name: "Desk lamp LED", price: 34 },
        ],
        tax: 6.14,
        tip: null,
        total: 80.58,
        payment_method: "cash",
      },
    },
  ],
};

const resume: Template = {
  id: "resume",
  name: "Resume",
  description: "Contact details, experience, and skills from CVs for an applicant tracker.",
  prompt: `Extract a candidate profile from a resume.

- List experience in the order it appears.
- Dates are YYYY-MM; use null for "Present" end dates.
- Skills are short keywords as written (e.g. "PostgreSQL", not "databases").`,
  fields: [
    { key: "full_name", type: "string", important: true, rules: { required: true } },
    { key: "email", type: "string", important: true, rules: { format: "email" } },
    { key: "phone", type: "string", rules: { format: "phone" } },
    { key: "location", type: "string", description: "City and country as written." },
    {
      key: "experience",
      type: "array",
      item: {
        type: "object",
        nullable: false,
        fields: [
          { key: "company", type: "string" },
          { key: "title", type: "string" },
          { key: "start", type: "string", description: "YYYY-MM" },
          { key: "end", type: "string", description: "YYYY-MM, or null if current." },
        ],
      },
    },
    { key: "skills", type: "array", item: { type: "string" } },
  ],
  samples: [
    {
      title: "John Doe – CV",
      text: `JOHN DOE
Backend Engineer · Austin, USA
john.doe@example.com · +1 555 010 0123 · github.com/example

EXPERIENCE
Senior Software Engineer — Razorleaf Payments        Mar 2023 – Present
- Owns the settlement service (Go, PostgreSQL, Kafka); cut reconciliation time by 60%.

Software Engineer — Tidewater Logistics               Jul 2020 – Feb 2023
- Built shipment tracking APIs in Node.js and TypeScript.

EDUCATION
B.S. Computer Science, Example State University, 2020

SKILLS
Go, TypeScript, PostgreSQL, Kafka, Kubernetes`,
      expected: {
        full_name: "John Doe",
        email: "john.doe@example.com",
        phone: "+1 555 010 0123",
        location: "Austin, USA",
        experience: [
          { company: "Razorleaf Payments", title: "Senior Software Engineer", start: "2023-03", end: null },
          { company: "Tidewater Logistics", title: "Software Engineer", start: "2020-07", end: "2023-02" },
        ],
        skills: ["Go", "TypeScript", "PostgreSQL", "Kafka", "Kubernetes"],
      },
    },
  ],
};

const supportEmail: Template = {
  id: "support_email",
  name: "Support email",
  description: "Turn inbound customer emails into triaged tickets with category, urgency, and account details.",
  prompt: `You triage inbound support emails into tickets.

- Summarize the problem in one sentence, in plain English.
- Urgency is "high" only if the customer is blocked or losing money now.
- Order and account IDs must be copied exactly as written.`,
  fields: [
    { key: "customer_name", type: "string" },
    { key: "customer_email", type: "string", rules: { format: "email" } },
    { key: "category", type: "enum", important: true, enumValues: ["billing", "bug", "account", "feature_request", "other"] },
    { key: "urgency", type: "enum", important: true, enumValues: ["low", "normal", "high"] },
    { key: "order_id", type: "string" },
    { key: "summary", type: "string", match: "ignore", description: "One sentence." },
    { key: "wants_refund", type: "boolean" },
  ],
  samples: [
    {
      title: "Charged twice for order",
      text: `From: Jane Doe <jane.doe@example.com>
Subject: charged twice?!

Hi,
I just noticed my card was charged twice for order #A-58213 (both $49.00, same day).
Can you refund the duplicate please? Not urgent but I'd like it sorted this week.

Thanks,
Jane`,
      expected: {
        customer_name: "Jane Doe",
        customer_email: "jane.doe@example.com",
        category: "billing",
        urgency: "normal",
        order_id: "A-58213",
        summary: "Customer was charged twice for the same order and wants the duplicate refunded.",
        wants_refund: true,
      },
    },
    {
      title: "Checkout down",
      text: `From: Alex Smith <alex@lumenstore.example>
Subject: URGENT - checkout broken since update

Our checkout page returns a 500 error since your SDK update this morning (v4.2.0).
No customer can pay right now. Account ID: acct_77Qk2. Please call me: +1 555 010 0199.

Alex Smith
Head of Engineering, Lumen Store`,
      expected: {
        customer_name: "Alex Smith",
        customer_email: "alex@lumenstore.example",
        category: "bug",
        urgency: "high",
        order_id: null,
        summary: "Checkout returns a 500 error after the v4.2.0 SDK update, blocking all payments.",
        wants_refund: false,
      },
    },
  ],
};

const blank: Template = {
  id: "blank",
  name: "Blank",
  description: "Start from an empty schema.",
  prompt: "Extract the requested fields from the document. Return null for anything that is not present.",
  fields: [{ key: "title", type: "string", description: "The document's title." }],
  samples: [],
};

export const TEMPLATES: Template[] = [invoice, receipt, resume, supportEmail, blank];

export function getTemplate(id: string) {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * The name a new extractor gets from a template: the template's own name ("Invoice"), or
 * "Invoice 2" when that's taken, so a new extractor never looks like an existing one.
 */
export function defaultExtractorName(templateName: string, existingNames: string[]) {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  if (!taken.has(templateName.toLowerCase())) return templateName;
  for (let i = 2; ; i++) if (!taken.has(`${templateName} ${i}`.toLowerCase())) return `${templateName} ${i}`;
}
