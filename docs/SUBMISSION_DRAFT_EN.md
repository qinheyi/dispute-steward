# DisputeSteward — Devpost submission draft (PayPal AI Hackathon)

> Draft prepared 2026-10-21. Fill the video link and screenshots before submitting.

**Tagline:** An AI desk for small PayPal merchants: it triages disputes and overdue invoices, drafts the reply, and stages the money move — which only happens after you approve it and a server-side policy agrees.

## Inspiration
Freelancers and one-person shops on PayPal handle disputes and late invoices by hand, usually at night, usually under a deadline. Refunding everything to make the problem go away loses money; ignoring a case loses the case. We wanted an agent that does the reading and drafting, but never gets to move money on its own say-so.

## What it does
- Lists open **disputes** and **overdue invoices** (PayPal sandbox, or built-in fixtures so judges can run it without credentials).
- For each case, the steward (MiniMax LLM, with a deterministic fallback) returns severity, a recommended action (refund, partial goodwill refund, provide evidence, invoice reminder, escalate), a confidence score and a buyer-facing draft.
- The merchant edits the draft and clicks **Approve & stage**.
- A **server-side policy** re-derives the action from the case on file before anything reaches PayPal: refunds only on disputes, capture ID pinned to the case, same currency, partial refunds capped at 50%, no refund while PayPal has the case under review, one money move per case, second confirmation above a high-value threshold.
- Every triage, block and execution is appended to a **SHA-256 hash-chained ledger**; the desk shows whether the chain still verifies.

## How we built it
- Next.js 15 + TypeScript + Tailwind, deployed on Vercel.
- PayPal REST (sandbox) via OAuth client credentials; tool surface mirrors the PayPal Agent Toolkit (`list_disputes`, `get_dispute`, `accept_dispute_claim`, `list_invoices`, `send_invoice_reminder`, `create_refund`).
- MiniMax (OpenAI-compatible chat) for triage and drafting; JSON enforced by prompt + parser, template fallback when no key is set.
- `policy.ts` + `audit.ts` with 10 `node:test` cases (caps, currency, capture pinning, idempotency, tamper detection).

## Challenges we ran into
- New sandbox merchant accounts have no disputes, so the demo needed realistic fixtures that use the same shapes as the live API.
- Deciding what the model may decide. We moved every number that matters (amount, currency, capture) out of the model's output and into the server's re-derivation.

## Accomplishments that we're proud of
- A tampered request that asks for a larger refund, another capture, or a second payout is blocked and logged — shown live in the demo.
- The ledger makes "what did the agent do and who approved it" checkable after the fact.

## What we learned
Agentic payments are mostly a permissions problem. The model is useful for reading and writing; the money path should stay boring and testable.

## What's next
Evidence upload for "item not received" disputes, persistent ledger storage, per-merchant policy settings, and subscription dunning.

## Built with
nextjs, typescript, tailwindcss, vercel, paypal-rest-api, paypal-sandbox, minimax

## AI tools used (required statement)
- MiniMax chat model (runtime triage + drafting).
- AI coding assistants were used during development; all code was reviewed and the policy layer is covered by tests.

## Links
- Live demo: https://dispute-steward.vercel.app
- Code (MIT): https://github.com/qinheyi/dispute-steward
- Video (≤3 min, public YouTube): _TODO — user uploads_
