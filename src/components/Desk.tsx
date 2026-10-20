"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionResult, StewardCase } from "@/lib/paypal/types";
import type { TriageResult } from "@/lib/steward/types";

interface CasesPayload {
  mode: string;
  cases: StewardCase[];
}

interface TriagePayload {
  case: StewardCase;
  triage: TriageResult;
}

interface AuditEntry {
  at: string;
  text: string;
}

interface ServerAuditEntry {
  seq: number;
  at: string;
  event: "triaged" | "blocked" | "executed" | "failed";
  case_id: string;
  action_type?: string;
  amount?: { currency_code: string; value: string };
  actor: string;
  detail: string;
  paypal_ref?: string;
  hash: string;
}

interface AuditPayload {
  count: number;
  chain: { valid: boolean; brokenAt?: number };
  entries: ServerAuditEntry[];
}

function eventColor(e: ServerAuditEntry["event"]) {
  if (e === "executed") return "text-emerald-300";
  if (e === "blocked") return "text-rose-300";
  if (e === "failed") return "text-orange-300";
  return "text-sky-300";
}

function money(c?: { currency_code: string; value: string }) {
  if (!c) return "—";
  return `${c.currency_code} ${c.value}`;
}

function badge(kind: string) {
  return kind === "dispute"
    ? "bg-rose-500/20 text-rose-200 border-rose-400/40"
    : "bg-sky-500/20 text-sky-200 border-sky-400/40";
}

function severityColor(s: string) {
  if (s === "high") return "text-rose-300";
  if (s === "medium") return "text-amber-300";
  return "text-emerald-300";
}

export default function Desk() {
  const [mode, setMode] = useState("mock");
  const [cases, setCases] = useState<StewardCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingTriage, setLoadingTriage] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [showReasoning, setShowReasoning] = useState(true);
  const [ledger, setLedger] = useState<AuditPayload | null>(null);
  const [refundValue, setRefundValue] = useState("");
  const [policyNotes, setPolicyNotes] = useState<string[]>([]);

  const loadLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/audit", { cache: "no-store" });
      if (res.ok) setLedger((await res.json()) as AuditPayload);
    } catch {
      /* ledger is best-effort in the UI */
    }
  }, []);

  const pushAudit = useCallback((text: string) => {
    setAudit((a) => [{ at: new Date().toLocaleTimeString(), text }, ...a].slice(0, 20));
  }, []);

  const loadCases = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      const data = (await res.json()) as CasesPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load cases");
      setMode(data.mode);
      setCases(data.cases);
      pushAudit(`Loaded ${data.cases.length} cases (${data.mode} mode)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, [pushAudit]);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  async function runTriage(id: string) {
    setSelectedId(id);
    setLoadingTriage(true);
    setTriage(null);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case_id: id }),
      });
      const data = (await res.json()) as TriagePayload & { error?: string };
      if (!res.ok) throw new Error(data.error || "Triage failed");
      setTriage(data.triage);
      setDraft(data.triage.draft_reply);
      setRefundValue(data.triage.staged_action.amount?.value ?? "");
      setPolicyNotes([]);
      void loadLedger();
      pushAudit(
        `Triaged ${id} → ${data.triage.recommended_action} (${data.triage.source}, conf ${data.triage.confidence.toFixed(2)})`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingTriage(false);
    }
  }

  async function approveAction() {
    if (!triage) return;
    setActing(true);
    setError(null);
    setPolicyNotes([]);
    try {
      const base = triage.staged_action;
      const staged = {
        ...base,
        note: draft.slice(0, 500) || base.note,
        amount:
          base.amount && refundValue
            ? { currency_code: base.amount.currency_code, value: refundValue.trim() }
            : base.amount,
      };
      const send = (confirmHighValue: boolean) =>
        fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ approved: true, confirm_high_value: confirmHighValue, action: staged }),
        });

      let res = await send(false);
      let data = (await res.json()) as ActionResult & {
        error?: string;
        needs_high_value_confirmation?: boolean;
        policy?: { violations?: string[]; adjustments?: string[] };
      };
      if (
        res.status === 422 &&
        data.needs_high_value_confirmation &&
        (data.policy?.violations?.length ?? 0) === 1 &&
        window.confirm(
          `High-value refund: ${staged.amount?.currency_code} ${staged.amount?.value} on ${staged.case_id}. Confirm a second time?`
        )
      ) {
        res = await send(true);
        data = (await res.json()) as typeof data;
      }
      if (res.status === 422) {
        setPolicyNotes(data.policy?.violations ?? [data.error || "Blocked by policy"]);
        pushAudit(`⛔ policy blocked ${staged.type} on ${staged.case_id}`);
        return;
      }
      if (!res.ok) throw new Error(data.error || data.message || "Action failed");
      setPolicyNotes((data.policy?.adjustments ?? []).map((a) => `adjusted: ${a}`));
      pushAudit(`✓ ${data.message}${data.paypal_ref ? ` [${data.paypal_ref}]` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
      void loadLedger();
    }
  }

  const selected = cases.find((c) => c.id === selectedId) || null;

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300/80">
            PayPal AI Hackathon · DisputeSteward
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Merchant desk
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300">
            AI triages PayPal disputes & overdue invoices, drafts replies, and stages refunds —
            money only moves after you approve.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200">
            mode: <strong className="text-amber-200">{mode}</strong>
          </span>
          <button
            type="button"
            onClick={() => void loadCases()}
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
          >
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Open cases
            </h2>
            <span className="text-xs text-slate-400">{cases.length} items</span>
          </div>
          {loadingList ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void runTriage(c.id)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                      selectedId === c.id
                        ? "border-amber-400/50 bg-amber-400/10"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge(c.kind)}`}>
                        {c.kind}
                      </span>
                      <span className="font-mono text-xs text-slate-400">{c.id}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-white">
                      {c.kind === "dispute" ? c.item_title || c.reason : c.item_title || c.invoice_number}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {c.kind === "dispute"
                        ? `${c.status} · ${money(c.dispute_amount)}`
                        : `${c.status} · ${money(c.amount)}${c.days_overdue ? ` · ${c.days_overdue}d overdue` : ""}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-xl backdrop-blur">
          {!selected && !loadingTriage && (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-slate-400">
              <p className="text-lg text-slate-200">Select a case</p>
              <p className="mt-1 max-w-sm text-sm">
                Steward will triage with MiniMax (or a template fallback) and stage a governed PayPal action.
              </p>
            </div>
          )}

          {loadingTriage && (
            <p className="text-sm text-amber-200/80">Steward is triaging…</p>
          )}

          {selected && triage && !loadingTriage && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${badge(selected.kind)}`}>
                    {selected.kind}
                  </span>
                  <h2 className="text-lg font-semibold text-white">{selected.id}</h2>
                  <span className={`text-xs font-semibold uppercase ${severityColor(triage.severity)}`}>
                    {triage.severity}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{selected.summary}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Recommend</p>
                  <p className="mt-1 font-mono text-sm text-amber-200">{triage.recommended_action}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Confidence</p>
                  <p className="mt-1 font-mono text-sm text-white">{(triage.confidence * 100).toFixed(0)}%</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400">Source</p>
                  <p className="mt-1 font-mono text-sm text-white">{triage.source}</p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={showReasoning}
                  onChange={(e) => setShowReasoning(e.target.checked)}
                />
                Show reasoning
              </label>
              {showReasoning && (
                <p className="rounded-xl border border-white/10 bg-black/25 p-3 text-sm text-slate-300">
                  {triage.rationale}
                </p>
              )}

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Draft reply (editable)
                </label>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-400/50"
                />
              </div>

              <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/80">
                  Staged PayPal action (requires approval)
                </p>
                <p className="mt-1 font-mono text-sm text-white">
                  {triage.staged_action.type}
                  {triage.staged_action.amount
                    ? ` · ${money(triage.staged_action.amount)}`
                    : ""}
                </p>
                {triage.staged_action.type === "partial_refund" && triage.staged_action.amount && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                    Refund amount ({triage.staged_action.amount.currency_code})
                    <input
                      value={refundValue}
                      onChange={(e) => setRefundValue(e.target.value)}
                      inputMode="decimal"
                      className="w-28 rounded-md border border-white/15 bg-black/30 px-2 py-1 font-mono text-sm text-white outline-none focus:border-amber-400/50"
                    />
                    <span className="text-slate-500">policy caps partial refunds at 50% of the dispute</span>
                  </label>
                )}
                {policyNotes.length > 0 && (
                  <ul className="mt-2 space-y-1 rounded-lg border border-rose-400/30 bg-rose-500/10 p-2 text-xs text-rose-100">
                    {policyNotes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void approveAction()}
                  className="mt-3 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-50"
                >
                  {acting ? "Executing…" : "Approve & stage"}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Session activity (this browser)</h2>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No actions yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-400">
            {audit.map((a, i) => (
              <li key={`${a.at}-${i}`}>
                <span className="text-slate-500">[{a.at}]</span> {a.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Governance ledger (server, hash-chained)
          </h2>
          {ledger && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                ledger.chain.valid
                  ? "border-emerald-400/40 text-emerald-200"
                  : "border-rose-400/40 text-rose-200"
              }`}
            >
              {ledger.chain.valid ? `chain verified · ${ledger.count} entries` : `chain broken at #${ledger.chain.brokenAt}`}
            </span>
          )}
        </div>
        {!ledger || ledger.entries.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Triage a case to start the ledger.</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-xs text-slate-400">
            {ledger.entries.slice(0, 15).map((e) => (
              <li key={e.seq}>
                <span className="text-slate-500">#{e.seq}</span>{" "}
                <span className={eventColor(e.event)}>{e.event}</span> {e.case_id}
                {e.action_type ? ` · ${e.action_type}` : ""}
                {e.amount ? ` · ${money(e.amount)}` : ""} — {e.detail}{" "}
                <span className="text-slate-600">{e.hash.slice(0, 10)}…</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pb-6 text-center text-xs text-slate-500">
        DisputeSteward · mock PayPal by default · set PAYPAL_MODE=sandbox + Client ID/Secret for live sandbox calls ·
        MiniMax optional
      </footer>
    </div>
  );
}
