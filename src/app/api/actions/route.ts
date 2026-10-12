import { NextResponse } from "next/server";
import { executeAction } from "@/lib/paypal/client";
import type { StagedAction } from "@/lib/paypal/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      approved?: boolean;
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
    const staged: StagedAction = {
      ...body.action,
      requires_approval: true,
    };
    const result = await executeAction(staged);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
