# Proposed Architecture (original, provider-decoupled)

```
sports-data-provider(s) ─▶ provider adapter(s) ─▶ canonical normalizer
        (odds, scores,       (isolate provider IDs,    (Sport→…→Outcome→Price
         results, clocks)     map to canonical IDs)     + EventState/MarketState)
                                                        │
 problems                                              ▼
games providers ──▶ games adapter ──▶            event/market store (RDBMS)
                                              + price stream (cache/pubsub)
                                                        │
wallet rails ──▶ PaymentProvider adapters ──▶    websocket/SSE gateway ─▶ browser SPA
   (card/bank/USSD/                                        ▲ (no direct provider calls
    wallets/sandbox)                                       │  from client; versioned
                                                        API gateway (authN/Z, rate-limit,
                                                        idempotency, geo/RG gates)
                                                        │
bet-placement svc ──▶ ledger (immutable) ──▶ settlement engine (idempotent)
        │                       │                       │
        └─▶ bonus/promo engine  └─▶ reconciliation jobs └─▶ cashout pricer
                                                        │
admin/operator console (RBAC, SoD, audit) ◀─────────────┘
```

- Client: original SPA (mobile-first) consuming versioned API + WS/SSE price
  stream; never trusts its own odds/balance; resyncs on reconnect.
- Backend: modular monolith first (catalog, trading-ingest, betting, wallet,
  settlement, promo, admin), separable later. Outbox + idempotent consumers.
- Data: RDBMS (canonical + ledger), cache for prices/sessions, object storage
  for KYC/docs, append-only audit log.
- Real-time: provider poll/stream → normalizer → store → pubsub → WS/SSE gateway
  with per-entity versions; client flashes moves and suspends on stale state.
- Admin: user/KYC lookup, deposits/withdrawals/reconciliation, events/markets
  + suspension, settlement/resettlement, bet/txn lookup, promo/bonus/CMS,
  geo + support cases, RG actions, audit + system status.
- External product observations informed only interaction-shape requirements.
  BTE does not depend on or claim knowledge of any third-party backend architecture.
