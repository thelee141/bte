# Bet Lifecycle (PROPOSED design anchored on observed concepts)

Observed concepts: Singles/Multiple/System (promo rules corroborate),
Live (delay/suspension standard), void handling (third-party betting-rules
text, UNVERIFIED as operator's own), receipt/reference expectation
(transaction history links), Cashout tab, Flexi/1Cut/2UP promos.

## States

`DRAFT → PENDING_ACCEPTANCE → {ACCEPTED | REJECTED | PARTIAL} → OPEN →
{CASHED_OUT | WON | LOST | VOID | PARTIAL_VOID | CANCELLED} → SETTLED →
(RESETTLED)*`

- Parlay with void legs: void legs drop out (price 1.00); single void leg in
  a single → stake refund; all void → refund.
- 2UP-style early settlement is a settlement RULE, not a state: leg marked
  won-early, still auditable.
- Cashout produces a `CashoutAcceptance` linked to the bet; bet → CASHED_OUT
  (full) or stays OPEN with reduced stake (partial, if offered).

## Placement atomicity (single DB transaction + outbox)

1. authn → account status → jurisdiction/geo → RG/account limits
2. load selections; validate event/market/outcome states (open, not suspended)
3. verify `priceVersionId`s are current; combination/correlation checks
4. compute total odds (decimal, integer-math safe), limits/exposure
5. funds check → atomically reserve/debit stake (ledger entries)
6. persist bet + legs + accepted price snapshots + idempotency key
7. assign immutable `betRef`/`txnRef`; emit event; return receipt

Any failure → rollback + machine-readable rejection; client retries with SAME
idempotency key (no double debit). Server never trusts client odds/payout/
balance/state.

## Settlement engine

- Inputs: provider result → canonical `Result` via adapter mapping.
- Idempotent executor keyed `(betId, resultVersion)`; supports
  void/cancelled legs, resettlement with `SettlementRevision`, ledger
  reversal + re-credit, full audit trail.
- Corrections: official-result changes create a new revision, never an
  in-place edit.

## Money math

Integer minor units (kobo) everywhere; no floats. Odds stored as
rational/decimal-string with explicit rounding policy (banker's, per-leg vs
slip-level documented in T&Cs-equivalent).
