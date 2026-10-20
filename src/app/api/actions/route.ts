import { NextResponse } from "next/server";
import { executeAction, getCase, getPayPalMode } from "@/lib/paypal/client";
import type { StagedAction } from "@/lib/paypal/types";
import { auditLog } from "@/lib/steward/audit";
import { evaluateAction } from "@/lib/steward/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      approved?: boolean;
      confirm_high_value?: boolean;
      action?: StagedAction;
    };
    if (!body.approved) {
      return NextResponse.json(
        { error: "Human approval required. Set approved:true after reviewing the staged action." },
        { status: 403 }
      );
    }
    if (!body.action || !body.action.type || !body.action.case_id) {
      return NextResponse.json({ error: "action with type and case_id required" }, { status: 400 });
    }

    const caseRecord = await getCase(body.action.case_id);
    const decision = evaluateAction({
      proposed: body.action,
      caseRecord,
      priorMoneyMoves: auditLog.executedMoneyMoves(),
      confirmHighValue: body.confirm_high_value === true,
    });

    if (!decision.allowed || !decision.action) {
      const entry = auditLog.append({
        event: "blocked",
        case_id: body.action.case_id,
        action_type: body.action.type,
        amount: body.action.amount,
        actor: "policy",
        detail: decision.violations.join("; "),
        mode: getPayPalMode(),
      });
      return NextResponse.json(
        {
          error: `Blocked by policy: ${decision.violations.join("; ")}`,
          policy: decision,
          needs_high_value_confirmation: decision.needsHighValueConfirmation === true,
          audit: entry,
        },
        { status: 422 }
      );
    }

    const result = await executeAction(decision.action);
    const entry = auditLog.append({
      event: result.ok ? "executed" : "failed",
      case_id: decision.action.case_id,
      action_type: decision.action.type,
      amount: decision.action.amount,
      actor: "merchant",
      detail: [result.message, ...decision.adjustments.map((a) => `policy: ${a}`)].join(" · "),
      paypal_ref: result.paypal_ref,
      mode: result.mode,
    });
    return NextResponse.json(
      { ...result, policy: { adjustments: decision.adjustments }, audit: entry },
      { status: result.ok ? 200 : 502 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
