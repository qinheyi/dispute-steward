/**
 * Money-move policy for DisputeSteward.
 *
 * The browser only *proposes* an action. Before anything reaches PayPal the
 * server re-derives the action from the case it belongs to and checks it
 * against these rules. Amounts, capture IDs and case kinds supplied by the
 * client are never trusted on their own.
 *
 * Runtime imports are intentionally relative/type-only so the unit tests can
 * compile this file without the Next.js path alias.
 */
import type {
  DisputeCase,
  Money,
  StagedAction,
  StewardActionType,
  StewardCase,
} from "../paypal/types";

export const MONEY_MOVES: ReadonlySet<StewardActionType> = new Set([
  "accept_claim_refund",
  "partial_refund",
]);

const ALLOWED_BY_KIND: Record<StewardCase["kind"], ReadonlySet<StewardActionType>> = {
  dispute: new Set(["accept_claim_refund", "partial_refund", "provide_evidence_stub", "escalate"]),
  invoice: new Set(["send_invoice_reminder", "escalate"]),
};

export interface PolicyConfig {
  /** Largest partial refund as a share of the disputed amount (0–1). */
  maxPartialRatio: number;
  /** Money moves at or above this value need a second explicit confirmation. */
  highValueThreshold: number;
  maxNoteLength: number;
}

export function policyConfigFromEnv(env: Record<string, string | undefined> = process.env): PolicyConfig {
  const ratio = Number(env.STEWARD_MAX_PARTIAL_RATIO);
  const threshold = Number(env.STEWARD_HIGH_VALUE_THRESHOLD);
  return {
    maxPartialRatio: Number.isFinite(ratio) && ratio > 0 && ratio <= 1 ? ratio : 0.5,
    highValueThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 250,
    maxNoteLength: 500,
  };
}

export interface PolicyInput {
  proposed: StagedAction;
  caseRecord: StewardCase | null;
  /** case_ids that already had a successful money move (from the audit log). */
  priorMoneyMoves: ReadonlySet<string>;
  /** Second confirmation for high-value money moves. */
  confirmHighValue?: boolean;
  config?: PolicyConfig;
}

export interface PolicyDecision {
  allowed: boolean;
  /** Hard failures — the action is refused. */
  violations: string[];
  /** Changes the server made to the proposal (e.g. amount reset to the case value). */
  adjustments: string[];
  /** The action that will actually be executed when allowed. */
  action?: StagedAction;
  needsHighValueConfirmation?: boolean;
}

const MONEY_RE = /^\d+(\.\d{1,2})?$/;

function toCents(m: Money | undefined): number | null {
  if (!m || typeof m.value !== "string" || !MONEY_RE.test(m.value.trim())) return null;
  return Math.round(Number(m.value) * 100);
}

function centsToValue(c: number): string {
  return (c / 100).toFixed(2);
}

function cleanNote(note: string | undefined, max: number): string {
  // Drop any client-supplied capture marker; the server sets the real one.
  return (note || "").replace(/capture:[A-Z0-9-]+\s*\|?\s*/gi, "").trim().slice(0, max);
}

export function evaluateAction(input: PolicyInput): PolicyDecision {
  const cfg = input.config ?? policyConfigFromEnv();
  const { proposed, caseRecord } = input;
  const violations: string[] = [];
  const adjustments: string[] = [];

  if (!caseRecord) {
    return { allowed: false, violations: [`Unknown case ${proposed?.case_id ?? "(missing)"}`], adjustments };
  }
  if (proposed.case_id !== caseRecord.id) {
    violations.push("case_id does not match the case on file");
  }
  if (proposed.case_kind !== caseRecord.kind) {
    adjustments.push(`case_kind corrected ${proposed.case_kind} → ${caseRecord.kind}`);
  }
  if (!ALLOWED_BY_KIND[caseRecord.kind].has(proposed.type)) {
    violations.push(`${proposed.type} is not allowed on a ${caseRecord.kind}`);
  }

  const action: StagedAction = {
    type: proposed.type,
    case_id: caseRecord.id,
    case_kind: caseRecord.kind,
    note: cleanNote(proposed.note, cfg.maxNoteLength),
    requires_approval: true,
  };

  let needsHighValueConfirmation = false;

  if (MONEY_MOVES.has(proposed.type) && caseRecord.kind === "dispute") {
    const d = caseRecord as DisputeCase;
    if (input.priorMoneyMoves.has(d.id)) {
      violations.push(`A refund was already executed for ${d.id}; refusing a second money move`);
    }
    if (d.status === "RESOLVED") {
      violations.push(`${d.id} is RESOLVED; no refund needed`);
    }
    if (d.status === "UNDER_REVIEW") {
      violations.push(`${d.id} is UNDER_REVIEW by PayPal; submit evidence instead of refunding`);
    }
    const disputed = toCents(d.dispute_amount);
    if (disputed === null || disputed <= 0) {
      violations.push("Case has no valid disputed amount");
    } else if (proposed.type === "accept_claim_refund") {
      const asked = toCents(proposed.amount);
      if (proposed.amount && asked !== disputed) {
        adjustments.push(
          `amount reset to disputed amount ${d.dispute_amount.currency_code} ${centsToValue(disputed)}`
        );
      }
      action.amount = { currency_code: d.dispute_amount.currency_code, value: centsToValue(disputed) };
      needsHighValueConfirmation = disputed >= cfg.highValueThreshold * 100;
    } else if (proposed.type === "partial_refund") {
      const asked = toCents(proposed.amount);
      const cap = Math.round(disputed * cfg.maxPartialRatio);
      if (asked === null || asked <= 0) {
        violations.push("partial_refund needs a positive amount with at most 2 decimals");
      } else if (proposed.amount!.currency_code !== d.dispute_amount.currency_code) {
        violations.push(
          `currency ${proposed.amount!.currency_code} does not match dispute currency ${d.dispute_amount.currency_code}`
        );
      } else if (asked > cap) {
        violations.push(
          `partial refund ${centsToValue(asked)} exceeds the ${Math.round(cfg.maxPartialRatio * 100)}% cap (${centsToValue(cap)})`
        );
      } else {
        action.amount = { currency_code: d.dispute_amount.currency_code, value: centsToValue(asked) };
        needsHighValueConfirmation = asked >= cfg.highValueThreshold * 100;
      }
      if (!d.capture_id) {
        violations.push("Case has no capture_id on file; cannot target a refund");
      } else {
        action.note = `capture:${d.capture_id} | ${action.note || "Goodwill partial refund"}`.slice(
          0,
          cfg.maxNoteLength + 40
        );
      }
    }
    if (needsHighValueConfirmation && !input.confirmHighValue) {
      violations.push(
        `High-value refund (≥ ${cfg.highValueThreshold}) needs a second confirmation (confirm_high_value: true)`
      );
    }
  } else if (proposed.amount) {
    adjustments.push("amount dropped: this action does not move money");
  }

  if (caseRecord.kind === "invoice" && proposed.type === "send_invoice_reminder") {
    if (caseRecord.status === "PAID" || caseRecord.status === "CANCELLED" || caseRecord.status === "MARKED_AS_PAID") {
      violations.push(`Invoice ${caseRecord.invoice_number} is ${caseRecord.status}; no reminder needed`);
    }
  }

  return {
    allowed: violations.length === 0,
    violations,
    adjustments,
    action: violations.length === 0 ? action : undefined,
    needsHighValueConfirmation,
  };
}
