# Demo video script (target 2:30, hard limit 3:00)

| Time | Screen | Voice-over (EN) |
|---|---|---|
| 0:00–0:15 | Desk home, list of disputes + invoices | "Small PayPal merchants handle disputes and late invoices by hand. DisputeSteward reads the case, drafts the reply, and stages the money move — but never moves money on its own." |
| 0:15–0:50 | Click `PP-D-401` (item not received) → triage panel | "The steward recommends a partial goodwill refund, explains why, and writes the buyer reply. Confidence and severity are shown." |
| 0:50–1:15 | Edit draft → **Approve & stage** → ledger row appears | "I edit the draft and approve. The server re-checks the action against the case on file, then calls PayPal sandbox. The result lands in a hash-chained ledger." |
| 1:15–1:45 | Change amount to 120.00 → blocked; approve again → blocked | "If the request is tampered — a bigger refund, or a second payout on the same case — policy blocks it, and the block is logged too." |
| 1:45–2:10 | Overdue invoice → reminder draft → approve | "Overdue invoices get a polite reminder, staged the same way." |
| 2:10–2:30 | `GET /api/audit` showing `chain.valid: true`; README policy table | "The model proposes; the server decides. Code is MIT on GitHub, demo on Vercel." |

Recording tips: 1280×720 browser window, mock mode, zoom 110%, no personal data on screen.
