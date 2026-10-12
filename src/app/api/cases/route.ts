import { NextResponse } from "next/server";
import { listCases } from "@/lib/paypal/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { mode, cases } = await listCases();
    return NextResponse.json({ mode, cases, count: cases.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
