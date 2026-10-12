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
    try {
      const staged = {
        ...triage.staged_action,
        note: draft.slice(0, 500) || triage.staged_action.note,
      };
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true, action: staged }),
      });
      const data = (await res.json()) as ActionResult & { error?: string };
      if (!res.ok) throw new Error(data.error || data.message || "Action failed");
      pushAudit(`✓ ${data.message}${data.paypal_ref ? ` [${data.paypal_ref}]` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
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
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Audit log</h2>
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

      <footer className="pb-6 text-center text-xs text-slate-500">
        DisputeSteward · mock PayPal by default · set PAYPAL_MODE=sandbox + Client ID/Secret for live sandbox calls ·
        MiniMax optional
      </footer>
    </div>
  );
}
