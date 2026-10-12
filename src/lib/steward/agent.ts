import type { DisputeCase, InvoiceCase, StagedAction, StewardCase } from "@/lib/paypal/types";
import { chatCompletion, llmEnabled } from "./llm";
import type { RecommendedAction, TriageResult } from "./types";

function moneyHalf(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return (Math.round(n * 50) / 100).toFixed(2);
}

function stageFromRecommendation(
  c: StewardCase,
  recommended: RecommendedAction,
  note?: string
): StagedAction {
  if (c.kind === "dispute") {
    const d = c as DisputeCase;
    if (recommended === "refund") {
      return {
        type: "accept_claim_refund",
        case_id: d.id,
        case_kind: "dispute",
        amount: d.dispute_amount,
        note: note || "Full refund via accept-claim",
        requires_approval: true,
      };
    }
    if (recommended === "partial_refund") {
      return {
        type: "partial_refund",
        case_id: d.id,
        case_kind: "dispute",
        amount: {
          currency_code: d.dispute_amount.currency_code,
          value: moneyHalf(d.dispute_amount.value),
        },
        note: `capture:${d.capture_id || "UNKNOWN"} | ${note || "Goodwill partial refund"}`,
        requires_approval: true,
      };
    }
    if (recommended === "provide_evidence") {
      return {
        type: "provide_evidence_stub",
        case_id: d.id,
        case_kind: "dispute",
        note: note || "Prepare proof of fulfillment / SOW",
        requires_approval: true,
      };
    }
    return {
      type: "escalate",
      case_id: d.id,
      case_kind: "dispute",
      note: note || "Escalate to human ops",
      requires_approval: true,
    };
  }

  const inv = c as InvoiceCase;
  if (recommended === "remind") {
    return {
      type: "send_invoice_reminder",
      case_id: inv.id,
      case_kind: "invoice",
      note: note || "Friendly payment reminder",
      requires_approval: true,
    };
  }
  return {
    type: "escalate",
    case_id: inv.id,
    case_kind: "invoice",
    note: note || "Collections escalation",
    requires_approval: true,
  };
}

/** Deterministic template triage — always available without LLM. */
export function templateTriage(c: StewardCase): TriageResult {
  if (c.kind === "dispute") {
    const d = c as DisputeCase;
    const reason = d.reason.toUpperCase();
    let recommended: RecommendedAction = "escalate";
    let severity: TriageResult["severity"] = "medium";
    let rationale = "";
    let draft = "";

    if (reason.includes("NOT_RECEIVED")) {
      recommended = "partial_refund";
      severity = "high";
      rationale =
        "Item-not-received with delivery dispute: offer partial goodwill refund while retaining evidence of the delivery link; avoids full chargeback if buyer accepts.";
      draft = `Hi ${d.buyer_email || "there"},\n\nThanks for flagging this. I'm sorry the files didn't reach you. I've re-sent the download link and I'm happy to issue a 50% goodwill refund (${d.dispute_amount.currency_code} ${moneyHalf(d.dispute_amount.value)}) while we confirm delivery.\n\nPlease reply within 48 hours if that works, or let me know if you'd prefer we resend everything again first.\n\nBest,\nMerchant`;
    } else if (reason.includes("NOT_AS_DESCRIBED")) {
      recommended = "provide_evidence";
      severity = "medium";
      rationale =
        "Not-as-described: listing terms matter. Prepare screenshot of the listing + license terms before accepting any refund.";
      draft = `Hi ${d.buyer_email || "there"},\n\nThanks for writing in. The listing specified a 1-year update window for "${d.item_title || "this product"}". I've attached the original listing copy and license terms. If you'd like, I can offer a small goodwill credit toward an upgrade—please let me know.\n\nBest,\nMerchant`;
    } else if (reason.includes("UNAUTHORISED") || reason.includes("UNAUTHORIZED")) {
      recommended = "provide_evidence";
      severity = "high";
      rationale =
        "Unauthorized claim under review: do not refund yet; assemble invoice, SOW, and IP/login evidence for PayPal.";
      draft = `(Internal note — do not send to buyer yet)\nPrepare: signed SOW, invoice ${d.transaction_id || ""}, delivery timestamps, and IP logs. Await PayPal UNDER_REVIEW outcome before any refund.`;
    } else {
      recommended = "escalate";
      severity = "medium";
      rationale = "Unrecognized dispute reason — escalate for human review.";
      draft = `Hi,\n\nWe've received your PayPal case ${d.id} and a teammate will follow up within one business day.\n\nBest,\nMerchant`;
    }

    return {
      case_id: d.id,
      severity,
      recommended_action: recommended,
      confidence: 0.72,
      rationale,
      draft_reply: draft,
      staged_action: stageFromRecommendation(d, recommended),
      source: "template",
    };
  }

  const inv = c as InvoiceCase;
  const overdue = inv.days_overdue ?? 0;
  const recommended: RecommendedAction = overdue > 7 ? "escalate" : "remind";
  const severity: TriageResult["severity"] = overdue > 7 ? "high" : overdue > 0 ? "medium" : "low";
  const rationale =
    overdue > 7
      ? `Invoice ${inv.invoice_number} is ${overdue} days overdue with prior reminders — escalate tone or offer payment plan.`
      : `Invoice ${inv.invoice_number} is lightly overdue — send a polite PayPal reminder.`;
  const draft =
    overdue > 7
      ? `Hi ${inv.recipient_name || "there"},\n\nChecking in on invoice ${inv.invoice_number} (${inv.amount.currency_code} ${inv.amount.value}), now ${overdue} days past due. Happy to split into two payments if that helps — otherwise please settle via the PayPal invoice link this week.\n\nThanks,\nMerchant`
      : `Hi ${inv.recipient_name || "there"},\n\nFriendly reminder that invoice ${inv.invoice_number} (${inv.amount.currency_code} ${inv.amount.value}) was due ${inv.due_date || "recently"}. You can pay securely via the PayPal invoice link.\n\nThanks!\nMerchant`;

  return {
    case_id: inv.id,
    severity,
    recommended_action: recommended,
    confidence: 0.8,
    rationale,
    draft_reply: draft,
    staged_action: stageFromRecommendation(inv, recommended === "escalate" ? "escalate" : "remind"),
    source: "template",
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const ALLOWED: RecommendedAction[] = [
  "refund",
  "partial_refund",
  "provide_evidence",
  "remind",
  "escalate",
];

export async function triageCase(c: StewardCase): Promise<TriageResult> {
  const fallback = templateTriage(c);
  if (!llmEnabled()) return fallback;

  try {
    const { text } = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `You are DisputeSteward, an AI ops agent for PayPal merchants.
Return ONLY a JSON object with keys:
severity ("low"|"medium"|"high"),
recommended_action ("refund"|"partial_refund"|"provide_evidence"|"remind"|"escalate"),
confidence (0-1 number),
rationale (short string),
draft_reply (polite English message to buyer/client; for unauthorized under review use an internal note).
Never execute payments — only recommend. For invoices prefer remind/escalate. For item-not-received prefer partial_refund when delivery is disputed.`,
        },
        {
          role: "user",
          content: `Triage this PayPal case:\n${JSON.stringify(c, null, 2)}`,
        },
      ],
      maxTokens: 500,
      timeoutMs: 45_000,
    });

    const parsed = extractJson(text);
    if (!parsed) return fallback;

    const recommended = ALLOWED.includes(parsed.recommended_action as RecommendedAction)
      ? (parsed.recommended_action as RecommendedAction)
      : fallback.recommended_action;
    const severity =
      parsed.severity === "low" || parsed.severity === "medium" || parsed.severity === "high"
        ? parsed.severity
        : fallback.severity;
    const confidence =
      typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : fallback.confidence;
    const rationale =
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : fallback.rationale;
    const draft_reply =
      typeof parsed.draft_reply === "string" && parsed.draft_reply.trim()
        ? parsed.draft_reply.trim()
        : fallback.draft_reply;

    // Guard: invoices shouldn't get refund actions from a confused model
    let safeRec = recommended;
    if (c.kind === "invoice" && (safeRec === "refund" || safeRec === "partial_refund" || safeRec === "provide_evidence")) {
      safeRec = "remind";
    }
    if (c.kind === "dispute" && safeRec === "remind") {
      safeRec = "provide_evidence";
    }

    return {
      case_id: c.id,
      severity,
      recommended_action: safeRec,
      confidence,
      rationale,
      draft_reply,
      staged_action: stageFromRecommendation(c, safeRec, rationale),
      source: "minimax",
    };
  } catch {
    return fallback;
  }
}
