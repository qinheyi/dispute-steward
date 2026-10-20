/**
 * Append-only, hash-chained audit log for every governed action.
 *
 * Each entry stores the SHA-256 of the previous entry, so editing or deleting
 * an earlier line breaks verifyChain(). Storage is in-memory per server
 * instance (fine for the hackathon demo; swap for a database in production).
 */
import { createHash } from "node:crypto";

export type AuditEvent = "triaged" | "blocked" | "executed" | "failed";

export interface AuditEntryInput {
  event: AuditEvent;
  case_id: string;
  action_type?: string;
  amount?: { currency_code: string; value: string };
  actor: "steward" | "merchant" | "policy";
  detail: string;
  paypal_ref?: string;
  mode?: string;
}

export interface AuditEntry extends AuditEntryInput {
  seq: number;
  at: string;
  prev_hash: string;
  hash: string;
}

const GENESIS = "0".repeat(64);

function digest(e: Omit<AuditEntry, "hash">): string {
  const canonical = JSON.stringify([
    e.seq,
    e.at,
    e.event,
    e.case_id,
    e.action_type ?? null,
    e.amount ?? null,
    e.actor,
    e.detail,
    e.paypal_ref ?? null,
    e.mode ?? null,
    e.prev_hash,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  append(input: AuditEntryInput, now: Date = new Date()): AuditEntry {
    const prev = this.entries[this.entries.length - 1];
    const base = {
      ...input,
      seq: this.entries.length + 1,
      at: now.toISOString(),
      prev_hash: prev ? prev.hash : GENESIS,
    };
    const entry: AuditEntry = { ...base, hash: digest(base) };
    this.entries.push(entry);
    return entry;
  }

  list(): AuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** case_ids with a successful refund — used to block double refunds. */
  executedMoneyMoves(): Set<string> {
    return new Set(
      this.entries
        .filter(
          (e) =>
            e.event === "executed" &&
            (e.action_type === "accept_claim_refund" || e.action_type === "partial_refund")
        )
        .map((e) => e.case_id)
    );
  }

  /** Test helper: direct access so tamper detection can be demonstrated. */
  _unsafeEntries(): AuditEntry[] {
    return this.entries;
  }
}

export function verifyChain(entries: AuditEntry[]): { valid: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (e.prev_hash !== prev || digest(rest) !== hash) return { valid: false, brokenAt: e.seq };
    prev = hash;
  }
  return { valid: true };
}

// One log per server instance.
const g = globalThis as unknown as { __stewardAudit?: AuditLog };
export const auditLog: AuditLog = g.__stewardAudit ?? (g.__stewardAudit = new AuditLog());
