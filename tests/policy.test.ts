import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAction, type PolicyConfig } from "../src/lib/steward/policy";
import { AuditLog, verifyChain } from "../src/lib/steward/audit";
import type { DisputeCase, InvoiceCase, StagedAction } from "../src/lib/paypal/types";

const cfg: PolicyConfig = { maxPartialRatio: 0.5, highValueThreshold: 250, maxNoteLength: 500 };

const dispute: DisputeCase = {
  kind: "dispute",
  id: "PP-D-401",
  status: "WAITING_FOR_SELLER_RESPONSE",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  dispute_amount: { currency_code: "USD", value: "128.00" },
  create_time: "2026-10-10T00:00:00Z",
  capture_id: "CAP-8XH2K9M1",
  summary: "test",
};

const invoice: InvoiceCase = {
  kind: "invoice",
  id: "INV2-1",
  status: "SENT",
  invoice_number: "0001",
  amount: { currency_code: "USD", value: "300.00" },
  summary: "test",
};

function act(p: Partial<StagedAction>): StagedAction {
  return { type: "partial_refund", case_id: dispute.id, case_kind: "dispute", requires_approval: true, ...p } as StagedAction;
}

const none = new Set<string>();

test("partial refund within the 50% cap is allowed and capture comes from the case", () => {
  const d = evaluateAction({
    proposed: act({ amount: { currency_code: "USD", value: "64.00" }, note: "capture:EVIL-1 | sorry" }),
    caseRecord: dispute,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(d.allowed, true, d.violations.join());
  assert.equal(d.action?.amount?.value, "64.00");
  assert.match(d.action!.note!, /^capture:CAP-8XH2K9M1 \| sorry/);
  assert.doesNotMatch(d.action!.note!, /EVIL/);
});

test("partial refund above the cap is refused", () => {
  const d = evaluateAction({
    proposed: act({ amount: { currency_code: "USD", value: "64.01" } }),
    caseRecord: dispute,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(d.allowed, false);
  assert.match(d.violations.join(), /exceeds the 50% cap/);
});

test("currency mismatch, negative and malformed amounts are refused", () => {
  for (const amount of [
    { currency_code: "EUR", value: "10.00" },
    { currency_code: "USD", value: "-5" },
    { currency_code: "USD", value: "1e3" },
    { currency_code: "USD", value: "10.001" },
  ]) {
    const d = evaluateAction({ proposed: act({ amount }), caseRecord: dispute, priorMoneyMoves: none, config: cfg });
    assert.equal(d.allowed, false, JSON.stringify(amount));
  }
});

test("full refund amount is always reset to the disputed amount", () => {
  const d = evaluateAction({
    proposed: act({ type: "accept_claim_refund", amount: { currency_code: "USD", value: "9999.00" } }),
    caseRecord: dispute,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(d.allowed, true, d.violations.join());
  assert.equal(d.action?.amount?.value, "128.00");
  assert.ok(d.adjustments.some((a) => a.includes("reset")));
});

test("high-value refunds need a second confirmation", () => {
  const big: DisputeCase = { ...dispute, dispute_amount: { currency_code: "USD", value: "400.00" } };
  const first = evaluateAction({
    proposed: act({ type: "accept_claim_refund" }),
    caseRecord: big,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(first.allowed, false);
  assert.equal(first.needsHighValueConfirmation, true);
  const second = evaluateAction({
    proposed: act({ type: "accept_claim_refund" }),
    caseRecord: big,
    priorMoneyMoves: none,
    confirmHighValue: true,
    config: cfg,
  });
  assert.equal(second.allowed, true, second.violations.join());
});

test("no second money move on the same case", () => {
  const d = evaluateAction({
    proposed: act({ amount: { currency_code: "USD", value: "10.00" } }),
    caseRecord: dispute,
    priorMoneyMoves: new Set([dispute.id]),
    config: cfg,
  });
  assert.equal(d.allowed, false);
  assert.match(d.violations.join(), /already executed/);
});

test("refunds are blocked while PayPal reviews the case", () => {
  const d = evaluateAction({
    proposed: act({ type: "accept_claim_refund" }),
    caseRecord: { ...dispute, status: "UNDER_REVIEW" },
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(d.allowed, false);
  assert.match(d.violations.join(), /UNDER_REVIEW/);
});

test("refund actions cannot target an invoice, unknown cases are refused", () => {
  const onInvoice = evaluateAction({
    proposed: { type: "accept_claim_refund", case_id: invoice.id, case_kind: "invoice", requires_approval: true },
    caseRecord: invoice,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(onInvoice.allowed, false);
  const unknown = evaluateAction({ proposed: act({}), caseRecord: null, priorMoneyMoves: none, config: cfg });
  assert.equal(unknown.allowed, false);
});

test("invoice reminder is allowed and drops any amount", () => {
  const d = evaluateAction({
    proposed: {
      type: "send_invoice_reminder",
      case_id: invoice.id,
      case_kind: "invoice",
      amount: { currency_code: "USD", value: "1.00" },
      requires_approval: true,
    },
    caseRecord: invoice,
    priorMoneyMoves: none,
    config: cfg,
  });
  assert.equal(d.allowed, true, d.violations.join());
  assert.equal(d.action?.amount, undefined);
});

test("audit chain verifies and detects tampering; executed refunds are tracked", () => {
  const log = new AuditLog();
  log.append({ event: "triaged", case_id: "A", actor: "steward", detail: "x" });
  log.append({ event: "executed", case_id: "A", action_type: "partial_refund", actor: "merchant", detail: "ok" });
  log.append({ event: "executed", case_id: "B", action_type: "send_invoice_reminder", actor: "merchant", detail: "ok" });
  assert.deepEqual(verifyChain(log.list()), { valid: true });
  assert.deepEqual([...log.executedMoneyMoves()], ["A"]);
  log._unsafeEntries()[1].detail = "edited";
  assert.deepEqual(verifyChain(log.list()), { valid: false, brokenAt: 2 });
});
