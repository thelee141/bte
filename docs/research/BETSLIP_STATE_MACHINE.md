# Betslip State Machine (OBSERVED → PROPOSED)

Observed anchor points (21 Sept 2026): click-odds auto-adds a card
(`Home / Arsenal v Leeds United / 1X2 / 1.38`); SIM/REAL toggle; Total Stake
NGN; Potential Win live value (138.00 at default stake ⇒ INFERRED default
100); Place Bet / Book Bet / Print; Booking Code + Load (disabled when
empty); `Betslip<n>`/`Cashout` tabs.

```
EMPTY ──odds click──▶ SELECTIONS(1) ──odds click──▶ SELECTIONS(n)
  │                        │                              │
  │ stake?                 ▼                              ▼
  └─(empty: Load disabled,│SINGLE view                    MULTI-LEG view:
     Book Bet hidden/dis.)│ stake × price = potential    Singles|Multiple|System tabs,
                           │                              total odds = Π prices (voids
                           ▼                              excluded at settlement),
                     PRICE_CHECK                           per-leg + combo stakes
                     (revalidate versions)                 (system: banker?/combos)
                           │ concentrate / correlate check
                           ▼
                     ┌─VALID──────▶ REVIEW (show total odds, potential,
                     │               bonuses: Flexi/1Cut/2UP eligibility) ─▶
                     │               SUBMITTING ─▶ ACCEPTED (receipt + ref)
                     │                              ├─ PARTIAL (some legs dead)
                     │                              └─ REJECTED (reason + retry)
                     └─STALE (odds changed → accept-new / re-quote flow)
                       SUSPENDED (leg locked → remove or wait; slip blocked)
                       INVALID (dupe / mutually-exclusive / contingent →
                                auto-explain + offer fix)
```

Rules (PROPOSED, server-authoritative):

- Duplicates: same outcome re-click toggles off; same market different
  outcome replaces with notice.
- Mutual exclusion: outcomes of one market cannot combine (except Bet Builder
  legs, which become ONE leg with combined price).
- Contingent/correlated: server rejects or reprices; never silently accept.
- Max selections (e.g. 30–40, operator-configured), min stake (e.g. ₦100),
  max payout cap per slip; bonus eligibility (Flexi/1Cut/2UP/Odds Boost)
  computed server-side, displayed as line items.
- Price versions: slip stores `priceVersionId` per leg; any drift →
  explicit accept-new-prices step (auto-accept toggle OPTIONAL + RG-capped).
- Booking: BOOK (persist slip → short code + TTL) / LOAD (code → selections
  at CURRENT prices, unavailable legs flagged) / share link / print.
- Receipt: immutable `betRef` + `txnRef` per bet; idempotency key on submit
  (double-click safe); rejected legs return machine-readable codes.
- Cashout tab: quote → accept-window countdown → accepted/expired; quotes
  never client-computed.

Live-betting addenda: acceptance delay window; suspension mid-submit →
offer re-quote; abandonment → void path; reconnect → resync versions, never
reuse stale quotes (see BET_LIFECYCLE.md).
