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
3. Edit the draft if you want → **Approve & stage** → audit log shows mock/sandbox result.
4. Click an overdue invoice → draft reminder → approve send-reminder stub.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cases` | List disputes + invoices (`mock` or `sandbox`) |
| POST | `/api/triage` | `{ "case_id": "PP-D-401" }` → triage + staged action |
| POST | `/api/actions` | `{ "approved": true, "action": { ... } }` → execute |

## Stack

- Next.js 15 + TypeScript + Tailwind
- MiniMax optional (`MINIMAX_API_KEY`)
- PayPal sandbox stubs (env placeholders only — never commit secrets)
- MIT License

## Contest notes

- Contest: [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/)
- Deadline: 2026-11-13 04:00 Beijing
- This repo is a scaffold + runnable demo; full polish continues after Graph Hacks / Amazon Entry Gate deadlines.

## Author

Qin HEYI · `qinheyi@agentmail.to` · GitHub [@qinheyi](https://github.com/qinheyi)
