import { NextResponse } from "next/server";
import { getCase } from "@/lib/paypal/client";
import { triageCase } from "@/lib/steward/agent";

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
    return NextResponse.json({ case: c, triage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
