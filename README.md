# DisputeSteward

**PayPal AI Hackathon 2026** entry by Qin HEYI.

An AI merchant desk that triages PayPal **customer disputes** and **overdue invoices**, drafts buyer-facing replies, and **stages** sandbox refunds / accept-claim / invoice reminders for one-click human approval.

Money never moves without an explicit `approved: true` action.

## Why this exists

Solo freelancers and small merchants drown in PayPal dispute email and unpaid invoices. Blind auto-refunds are dangerous; ignoring cases is worse. DisputeSteward proposes; you approve.

Aligned with [PayPal Agent Toolkit](https://developer.paypal.com/ai-tools/agent-tools) surfaces:

- Disputes: `list_disputes`, `get_dispute`, `accept_dispute_claim`
- Invoices: `list_invoices`, `send_invoice_reminder`
- Payments: `create_refund` (partial goodwill)

## Quick start

```bash
cp .env.example .env.local
# optional: MINIMAX_API_KEY=...
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default `PAYPAL_MODE=mock` ships rich fixtures so judges can demo without sandbox credentials.

### Optional sandbox

1. Create a REST app in [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) (Sandbox).
2. Set in `.env.local`:

```env
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
```

If the sandbox account has no open disputes/invoices, the app falls back to mock fixtures so the UI still works.

### MiniMax

When `MINIMAX_API_KEY` is set, triage uses MiniMax (OpenAI-compatible chat). Without it, deterministic template triage still produces drafts + staged actions.

## Demo flow

1. Open the desk → see mock disputes + overdue invoices.
2. Click `PP-D-401` (item not received) → Steward recommends partial refund + draft apology.
3. Edit the draft if you want → **Approve & stage** → the governance ledger shows the mock/sandbox result.
4. Change the refund amount to more than 50% of the dispute (e.g. `120.00`) → **blocked by policy**, logged.
5. Approve again on the same dispute → **blocked** (no second money move on one case).
6. Click an overdue invoice → draft reminder → approve send-reminder stub.

## Governance: the model proposes, the server decides

The browser and the LLM only *propose* an action. `src/lib/steward/policy.ts` re-derives it from the
case on file before anything reaches PayPal:

| Rule | Why |
|---|---|
| Action type must fit the case kind (refunds only on disputes, reminders only on invoices) | A confused model can't refund an invoice |
| Full refund amount is reset to the disputed amount; client amounts are ignored | No inflated refunds from a tampered request |
| Partial refund: positive, ≤ 2 decimals, same currency, ≤ 50% of the dispute (`STEWARD_MAX_PARTIAL_RATIO`) | Goodwill stays goodwill |
| Capture ID always comes from the case, never from the note | Can't redirect a refund to another capture |
| No refund while PayPal has the case `UNDER_REVIEW`, or once `RESOLVED` | Evidence first, no double payouts |
| At most one money move per case | Idempotency against double clicks / replays |
| Refunds ≥ `STEWARD_HIGH_VALUE_THRESHOLD` (default 250) need a second confirmation | Two-step approval for big money |

Every triage, block, execution and failure is appended to a SHA-256 **hash-chained ledger**
(`src/lib/steward/audit.ts`, `GET /api/audit`). Editing any earlier entry breaks `verifyChain()`, and
the desk shows "chain verified". The ledger is in-memory per server instance in this demo.

Run the policy and ledger tests:

```bash
npm test   # 10 node:test cases: caps, currency, capture pinning, idempotency, tamper detection
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cases` | List disputes + invoices (`mock` or `sandbox`) |
| POST | `/api/triage` | `{ "case_id": "PP-D-401" }` → triage + staged action |
| POST | `/api/actions` | `{ "approved": true, "confirm_high_value"?: true, "action": { ... } }` → policy check → execute (422 + reasons if blocked) |
| GET | `/api/audit` | Hash-chained governance ledger + `chain.valid` |

## Stack

- Next.js 15 + TypeScript + Tailwind
- MiniMax optional (`MINIMAX_API_KEY`)
- PayPal sandbox stubs (env placeholders only — never commit secrets)
- MIT License

## Contest notes

- Contest: [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/)
- Deadline: 2026-11-13 04:00 Beijing
- Submission draft: [docs/SUBMISSION_DRAFT_EN.md](docs/SUBMISSION_DRAFT_EN.md) · video script: [docs/DEMO_VIDEO_SCRIPT.md](docs/DEMO_VIDEO_SCRIPT.md)

## Author

Qin HEYI · `qinheyi@agentmail.to` · GitHub [@qinheyi](https://github.com/qinheyi)
