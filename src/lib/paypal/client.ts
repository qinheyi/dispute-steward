/**
 * PayPal client stubs — mock by default; sandbox when credentials + PAYPAL_MODE=sandbox.
 * Never commit real Client ID / Secret.
 */

import { MOCK_DISPUTES, MOCK_INVOICES } from "./mock-data";
import type {
  ActionResult,
  DisputeCase,
  InvoiceCase,
  Money,
  StagedAction,
  StewardCase,
  StewardActionType,
} from "./types";

export type PayPalMode = "mock" | "sandbox";

export function getPayPalMode(): PayPalMode {
  const mode = (process.env.PAYPAL_MODE || "mock").toLowerCase();
  if (mode === "sandbox" && process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
    return "sandbox";
  }
  return "mock";
}

function sandboxBase(): string {
  return (process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com").replace(/\/+$/, "");
}

/** OAuth client-credentials. Sandbox only; returns null in mock mode. */
export async function getAccessToken(): Promise<string | null> {
  if (getPayPalMode() !== "sandbox") return null;
  const id = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${sandboxBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal OAuth failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal OAuth: missing access_token");
  return data.access_token;
}

async function sandboxFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new Error("Sandbox mode requires PayPal credentials");
  return fetch(`${sandboxBase()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}

export async function listCases(): Promise<{ mode: PayPalMode; cases: StewardCase[] }> {
  const mode = getPayPalMode();
  if (mode === "mock") {
    return { mode, cases: [...MOCK_DISPUTES, ...MOCK_INVOICES] };
  }

  // Best-effort sandbox list; fall back to mock fixtures on empty/error so demo never dies.
  try {
    const disputes: DisputeCase[] = [];
    const invoices: InvoiceCase[] = [];

    const dRes = await sandboxFetch("/v1/customer/disputes?page_size=20");
    if (dRes.ok) {
      const body = (await dRes.json()) as {
        items?: Array<{
          dispute_id?: string;
          status?: string;
          reason?: string;
          dispute_amount?: Money;
          create_time?: string;
          disputed_transactions?: Array<{
            buyer?: { email?: string };
            seller_transaction_id?: string;
          }>;
        }>;
      };
      for (const item of body.items || []) {
        if (!item.dispute_id) continue;
        disputes.push({
          kind: "dispute",
          id: item.dispute_id,
          status: (item.status as DisputeCase["status"]) || "OTHER",
          reason: item.reason || "OTHER",
          dispute_amount: item.dispute_amount || { currency_code: "USD", value: "0.00" },
          create_time: item.create_time || new Date().toISOString(),
          buyer_email: item.disputed_transactions?.[0]?.buyer?.email,
          transaction_id: item.disputed_transactions?.[0]?.seller_transaction_id,
          summary: `Sandbox dispute ${item.dispute_id} (${item.status || "UNKNOWN"})`,
        });
      }
    }

    const iRes = await sandboxFetch("/v2/invoicing/invoices?page_size=20&total_required=true");
    if (iRes.ok) {
      const body = (await iRes.json()) as {
        items?: Array<{
          id?: string;
          status?: string;
          detail?: { invoice_number?: string; metadata?: { recipient_view_url?: string } };
          amount?: Money;
          primary_recipients?: Array<{ billing_info?: { email_address?: string; name?: { full_name?: string } } }>;
        }>;
      };
      for (const item of body.items || []) {
        if (!item.id) continue;
        invoices.push({
          kind: "invoice",
          id: item.id,
          status: (item.status as InvoiceCase["status"]) || "SENT",
          invoice_number: item.detail?.invoice_number || item.id,
          amount: item.amount || { currency_code: "USD", value: "0.00" },
          recipient_email: item.primary_recipients?.[0]?.billing_info?.email_address,
          recipient_name: item.primary_recipients?.[0]?.billing_info?.name?.full_name,
          summary: `Sandbox invoice ${item.detail?.invoice_number || item.id} (${item.status})`,
        });
      }
    }

    const cases = [...disputes, ...invoices];
    if (cases.length === 0) {
      return { mode: "mock", cases: [...MOCK_DISPUTES, ...MOCK_INVOICES] };
    }
    return { mode, cases };
  } catch {
    return { mode: "mock", cases: [...MOCK_DISPUTES, ...MOCK_INVOICES] };
  }
}

export async function getCase(id: string): Promise<StewardCase | null> {
  const { cases } = await listCases();
  return cases.find((c) => c.id === id) || null;
}

function mockRef(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Execute an approved staged action.
 * Money-moving calls only hit sandbox when PAYPAL_MODE=sandbox + creds present.
 */
export async function executeAction(action: StagedAction): Promise<ActionResult> {
  const mode = getPayPalMode();
  const at = new Date().toISOString();
  const base: Omit<ActionResult, "ok" | "message" | "paypal_ref"> = {
    mode,
    action: action.type,
    case_id: action.case_id,
    at,
  };

  if (mode === "mock") {
    return {
      ...base,
      ok: true,
      message: mockMessage(action.type, action),
      paypal_ref: mockRef("MOCK"),
    };
  }

  try {
    switch (action.type) {
      case "accept_claim_refund": {
        const res = await sandboxFetch(`/v1/customer/disputes/${action.case_id}/accept-claim`, {
          method: "POST",
          body: JSON.stringify({
            note: action.note || "Accepted via DisputeSteward with merchant approval.",
            accept_claim_type: "REFUND",
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ...base, ok: false, message: `accept-claim failed ${res.status}: ${text.slice(0, 240)}` };
        }
        return {
          ...base,
          ok: true,
          message: "Accepted claim (refund) via PayPal sandbox.",
          paypal_ref: action.case_id,
        };
      }
      case "partial_refund": {
        // Requires capture_id on the staged action.note field as "capture:<id>" or amount only in mock.
        const captureMatch = action.note?.match(/capture:([A-Z0-9-]+)/i);
        const captureId = captureMatch?.[1];
        if (!captureId || !action.amount) {
          return {
            ...base,
            ok: false,
            message: "partial_refund needs amount + capture:<CAPTURE_ID> in note for sandbox.",
          };
        }
        const res = await sandboxFetch(`/v2/payments/captures/${captureId}/refund`, {
          method: "POST",
          body: JSON.stringify({
            amount: action.amount,
            note_to_payer: "Goodwill partial refund via DisputeSteward.",
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          return { ...base, ok: false, message: `refund failed ${res.status}: ${text.slice(0, 240)}` };
        }
        let ref = mockRef("REF");
        try {
          const j = JSON.parse(text) as { id?: string };
          if (j.id) ref = j.id;
        } catch {
          /* ignore */
        }
        return { ...base, ok: true, message: "Partial refund created in sandbox.", paypal_ref: ref };
      }
      case "send_invoice_reminder": {
        const res = await sandboxFetch(`/v2/invoicing/invoices/${action.case_id}/remind`, {
          method: "POST",
          body: JSON.stringify({
            subject: "Friendly reminder — invoice due",
            note: action.note || "Quick reminder from DisputeSteward.",
            send_to_recipient: true,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          return { ...base, ok: false, message: `remind failed ${res.status}: ${text.slice(0, 240)}` };
        }
        return { ...base, ok: true, message: "Invoice reminder sent (sandbox).", paypal_ref: action.case_id };
      }
      case "provide_evidence_stub":
      case "escalate":
        return {
          ...base,
          ok: true,
          message: `${action.type} recorded locally (sandbox evidence upload UI not wired in v1).`,
          paypal_ref: mockRef("STUB"),
        };
      default:
        return { ...base, ok: false, message: `Unknown action ${(action as StagedAction).type}` };
    }
  } catch (e) {
    return { ...base, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function mockMessage(type: StewardActionType, action: StagedAction): string {
  switch (type) {
    case "accept_claim_refund":
      return `Mock: accepted claim on ${action.case_id} — full refund staged.`;
    case "partial_refund":
      return `Mock: partial refund ${action.amount?.currency_code} ${action.amount?.value} staged for ${action.case_id}.`;
    case "send_invoice_reminder":
      return `Mock: reminder queued for invoice ${action.case_id}.`;
    case "provide_evidence_stub":
      return `Mock: evidence package prepared for ${action.case_id} (upload stub).`;
    case "escalate":
      return `Mock: ${action.case_id} flagged for human escalation.`;
  }
}
