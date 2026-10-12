/** PayPal-aligned case shapes used by DisputeSteward (mock + sandbox). */

export type CaseKind = "dispute" | "invoice";

export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";

export type InvoiceStatus = "DRAFT" | "SENT" | "SCHEDULED" | "PAYMENT_PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_PAID" | "MARKED_AS_PAID" | "UNPAID";

export interface Money {
  currency_code: string;
  value: string;
}

export interface DisputeCase {
  kind: "dispute";
  id: string;
  status: DisputeStatus;
  reason: string;
  dispute_amount: Money;
  create_time: string;
  buyer_email?: string;
  transaction_id?: string;
  capture_id?: string;
  item_title?: string;
  seller_response_due?: string;
  summary: string;
}

export interface InvoiceCase {
  kind: "invoice";
  id: string;
  status: InvoiceStatus;
  invoice_number: string;
  amount: Money;
  due_date?: string;
  recipient_email?: string;
  recipient_name?: string;
  item_title?: string;
  days_overdue?: number;
  summary: string;
}

export type StewardCase = DisputeCase | InvoiceCase;

export type StewardActionType =
  | "accept_claim_refund"
  | "partial_refund"
  | "send_invoice_reminder"
  | "provide_evidence_stub"
  | "escalate";

export interface StagedAction {
  type: StewardActionType;
  case_id: string;
  case_kind: CaseKind;
  amount?: Money;
  note?: string;
  /** Human must approve before execution */
  requires_approval: true;
}

export interface ActionResult {
  ok: boolean;
  mode: "mock" | "sandbox";
  action: StewardActionType;
  case_id: string;
  message: string;
  paypal_ref?: string;
  at: string;
}
