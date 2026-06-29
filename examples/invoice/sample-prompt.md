EXTRACTION TASK:
Extract seller, buyer, invoice details, and amounts from the invoice.

                  FIELD DEFINITIONS:

                  1. SELLER (the entity ISSUING the invoice - look for "From", "Supplier", or header company):
                    - name: Business/company name
                    - address: Complete address as printed
                    - state: State name in UPPERCASE (e.g., "MAHARASHTRA")
                    - stateCode: First 2 digits of GST number (e.g., "27" for Maharashtra)
                    - gstNo: Complete 15-character GSTIN
                    - email: Business email address (look for "Email:", "E-mail:", or "@" symbol)

                  2. BUYER (the entity RECEIVING the invoice - look for "To", "Bill To", "Ship To", "Buyer"):
                    - name: Business/company name
                    - address: Complete address as printed
                    - state: State name in UPPERCASE
                    - stateCode: First 2 digits of GST number
                    - gstNo: Complete 15-character GSTIN
                    - email: Business email address (look for "Email:", "E-mail:", or "@" symbol)

                  3. INVOICE DETAILS:
                    - date: Convert to YYYY-MM-DD format (e.g., "11-Dec-25" → "2025-12-11")
                    - dueDate: Payment due date. Look for fields labeled "Due date", "Payment due date", "Mode/Terms of payment", or similar. Convert to YYYY-MM-DD format.
                    - invoiceNumber: Exact invoice/bill number as shown

                  4. AMOUNTS (extract as numbers, remove commas and currency symbols):
                    - totalMT: Total quantity in Metric Tons. If quantity is in KG/Kgs/Kilograms, convert to MT (divide by 1000). Look for "MT", "M.T.", "Metric Ton", "Tons", "KG", "Kgs", "Kilograms".
                    - grossAmount: STRICTLY sum of goods line-item amounts only (items subtotal). Exclude freight, loading, handling, taxes, discounts, round-off, and any other charges.
                    - billAmount: Grand Total / Final payable amount (total on the invoice)

                  EXTRACTION RULES:
                  - Return null for fields not found or unclear - NEVER guess
                  - stateCode must match first 2 digits of the corresponding GST number
                  - Parse Indian number format: "1,43,504.71" → 143504.71
                  - Dates: Handle formats like "10-Dec-25", "11/12/2025", "2025-12-11"
                  - Email must be a valid email format with @ symbol
                  - Set confidence: 1.0 for clear extractions, lower if any field is uncertain
