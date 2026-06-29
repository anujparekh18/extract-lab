import { z } from 'zod'

// Schema for party (seller/buyer)
export const PartySchema = z.object({
  name: z.string().nullable().describe('Name of the company/business'),
  address: z.string().nullable().describe('Full address'),
  state: z.string().nullable().describe('State name'),
  stateCode: z.string().nullable().describe('2-digit state code from GST number'),
  gstNo: z.string().nullable().describe('15-digit GST identification number'),
  email: z.string().nullable().describe('Email address of the business'),
})

// Schema for extracted bill data with seller/buyer
export const InvoiceSchema = z.object({
  seller: PartySchema.describe('Seller/vendor details from the bill'),
  buyer: PartySchema.describe('Buyer/customer details from the bill'),
  date: z
    .string()
    .nullable()
    .describe('Invoice date in YYYY-MM-DD format'),
  dueDate: z
    .string()
    .nullable()
    .describe('Payment due date in YYYY-MM-DD format'),
  invoiceNumber: z
    .string()
    .nullable()
    .describe('Invoice or bill number'),
  totalMT: z
    .number()
    .nullable()
    .describe('Total quantity in metric tons (MT)'),
  grossAmount: z
    .number()
    .nullable()
    .describe('Gross amount / sum of all line items / subtotal before taxes'),
  billAmount: z
    .number()
    .nullable()
    .describe('Bill amount / grand total / final payable amount'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence score for the extraction (0-1)'),
})

export type PartyData = z.infer<typeof PartySchema>
export type ExtractedBillData = z.infer<typeof InvoiceSchema>
