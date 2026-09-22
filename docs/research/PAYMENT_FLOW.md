# Payment Flow (public evidence + PROPOSED abstraction)

## Observed / public (21 Sept 2026)

- OBSERVED in-product: "Instant Registration — Make a Deposit and Start
  Betting!" banner; `+234` mobile-prefixed identity (phone = account key);
  support contacts for payment issues (07008888888, nigeria.support@…).
- Third-party guides (UNVERIFIED leads, re-verify before build): ₦100 minimum
  deposits; rails named include bank card (Visa/Mastercard/Verve), bank
  transfer (expiring virtual account), USSD, OPay, PalmPay, Quickteller;
  OPay/PalmPay fastest withdrawals; name-match + KYC (NIN/BVN/ID) gates.
  Treat ALL of this as unconfirmed until operator contracts exist.

## PROPOSED provider abstraction (required)

```text
PaymentProvider
  createDeposit(user, amountMinor, currency, method) -> providerRef
  queryDeposit(providerRef) -> DepositStatus
  handleWebhook(signedPayload) -> event (replay-safe)
  createWithdrawal(user, amountMinor, dest) -> providerRef
  queryWithdrawal(providerRef) -> WithdrawalStatus
  reconcile(window) -> exceptions report
```

- Explicit states: `INITIATED → PENDING → {SUCCEEDED | FAILED | EXPIRED} →
  RECONCILED`; withdrawals add `APPROVED → SENT → CONFIRMED`.
- Idempotency keys on create; signature-verified, replay-safe webhooks
  (store `webhookEventId`, dedupe); immutable ledger entries per movement;
  daily reconciliation job vs provider statements; name-match + KYC gates
  before first withdrawal; separate bonus wallet never withdrawable direct.
- No production money movement in dev: PLAY MONEY + sandbox provider stubs.

## UX implications (PROPOSED)

Deposit sheet: amount presets, rail picker, pending-instructions screen
(virtual-account + expiry countdown), success/failure toasts, auto-poll with
backoff. Withdrawal: saved destinations (verified), fee/limits disclosure,
pending → confirmed timeline. Txn history filters (deposits/withdrawals/bets/
bonuses) with references for support.
