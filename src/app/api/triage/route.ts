import { NextResponse } from "next/server";
import { getCase } from "@/lib/paypal/client";
import { triageCase } from "@/lib/steward/agent";
import { auditLog } from "@/lib/steward/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { case_id?: string };
    if (!body.case_id) {
      return NextResponse.json({ error: "case_id required" }, { status: 400 });
    }
    const c = await getCase(body.case_id);
    if (!c) {
      return NextResponse.json({ error: `case not found: ${body.case_id}` }, { status: 404 });
    }
    const triage = await triageCase(c);
    auditLog.append({
      event: "triaged",
      case_id: c.id,
      action_type: triage.staged_action.type,
      amount: triage.staged_action.amount,
      actor: "steward",
      detail: `${triage.recommended_action} · ${triage.severity} · conf ${triage.confidence.toFixed(2)} (${triage.source})`,
    });
    return NextResponse.json({ case: c, triage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
