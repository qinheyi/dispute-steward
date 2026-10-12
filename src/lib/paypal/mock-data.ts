import type { DisputeCase, InvoiceCase } from "./types";

/** Rich fixtures so the demo works without sandbox credentials. */
export const MOCK_DISPUTES: DisputeCase[] = [
  {
    kind: "dispute",
    id: "PP-D-401",
    status: "WAITING_FOR_SELLER_RESPONSE",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    dispute_amount: { currency_code: "USD", value: "128.00" },
    create_time: "2026-10-05T14:22:00Z",
    buyer_email: "alex.buyer@example.com",
    transaction_id: "ACCT-000015",
    capture_id: "CAP-8XH2K9M1",
    item_title: "Custom logo design package",
    seller_response_due: "2026-10-15T23:59:59Z",
    summary:
      "Buyer claims logo files never arrived. Seller notes Dropbox link emailed Oct 3; buyer says spam folder empty.",
  },
  {
    kind: "dispute",
    id: "PP-D-417",
    status: "OPEN",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    dispute_amount: { currency_code: "USD", value: "49.00" },
    create_time: "2026-10-08T09:10:00Z",
    buyer_email: "sam.shop@example.com",
    transaction_id: "5XY98765AB123456E",
    capture_id: "CAP-2LQ7N4P0",
    item_title: "WordPress theme license",
    seller_response_due: "2026-10-18T23:59:59Z",
    summary:
      "Buyer expected lifetime updates; listing said 1-year updates. Screenshots of listing attached by buyer.",
  },
  {
    kind: "dispute",
    id: "PP-D-422",
    status: "UNDER_REVIEW",
    reason: "UNAUTHORISED",
    dispute_amount: { currency_code: "EUR", value: "220.00" },
    create_time: "2026-10-01T18:40:00Z",
    buyer_email: "eu.client@example.com",
    transaction_id: "6YZ11111CD999999F",
    capture_id: "CAP-9RR1T5W3",
    item_title: "Retainer — September consulting",
    summary:
      "Buyer claims card was stolen. PayPal under review; seller should prepare invoice + signed SOW as evidence.",
  },
];

export const MOCK_INVOICES: InvoiceCase[] = [
  {
    kind: "invoice",
    id: "INV2-MOCK-8801",
    status: "SENT",
    invoice_number: "INV-2026-088",
    amount: { currency_code: "USD", value: "750.00" },
    due_date: "2026-09-30",
    recipient_email: "ops@northwind.co",
    recipient_name: "Northwind Ops",
    item_title: "Q3 analytics dashboard build",
    days_overdue: 12,
    summary: "Sent Sep 15, due Sep 30. Two soft reminders already; no reply since Oct 2.",
  },
  {
    kind: "invoice",
    id: "INV2-MOCK-8814",
    status: "PAYMENT_PENDING",
    invoice_number: "INV-2026-091",
    amount: { currency_code: "USD", value: "180.00" },
    due_date: "2026-10-10",
    recipient_email: "hello@brightstudio.io",
    recipient_name: "Bright Studio",
    item_title: "Brand illustration pack (6 assets)",
    days_overdue: 2,
    summary: "Client opened invoice twice; payment pending. Friendly nudge recommended.",
  },
];
