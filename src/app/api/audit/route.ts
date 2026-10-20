import { NextResponse } from "next/server";
import { auditLog, verifyChain } from "@/lib/steward/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = auditLog.list();
  return NextResponse.json({
    count: entries.length,
    chain: verifyChain(entries),
    entries: entries.reverse(),
  });
}
