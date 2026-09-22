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

- Client: original SPA (mobile-first) consuming versioned API + WS price
  stream; never trusts its own odds/balance; resyncs on reconnect.
- Backend: modular monolith first (catalog, trading-ingest, betting, wallet,
  settlement, promo, admin), separable later. Outbox + idempotent consumers.
- Data: RDBMS (canonical + ledger), cache for prices/sessions, object storage
  for KYC/docs, append-only audit log.
- Real-time: provider poll/stream → normalizer → store → pubsub → WS gateway
  with `priceVersionId` per tick; client flashes moves, suspends on stale.
- Admin: user/KYC lookup, deposits/withdrawals/reconciliation, events/markets
  + suspension, settlement/resettlement, bet/txn lookup, promo/bonus/CMS,
  geo + support cases, RG actions, audit + system status.
- Docs consulted: none local (empty repo). Before implementation, pin exact
  framework/runtime versions from new manifests and read their current
  official docs (record in MASTER_PLAN Phase 0).

INFERRED about third-party-sportsbook only: Vue SPA + CDN + WAF (from `data-v-*` DOM and
CloudFront 403s). Nothing else claimed about their backend.
