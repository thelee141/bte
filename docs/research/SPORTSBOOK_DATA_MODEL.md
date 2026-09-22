# Sportsbook Data Model (PROPOSED, original design)

Money: integer minor units (kobo) or fixed-precision decimal; NEVER float.
Balances derived from the immutable ledger, never a bare `users.balance`.

## Identity & compliance

- `User(id, phoneE164 unique, passwordHash, status, registeredAt)`; status:
  ACTIVE | SUSPENDED | SELF_EXCLUDED | DEACTIVATED | PENDING_KYC.
- `UserProfile(userId, displayName, dob, kycTier, …)`; `Session(id, userId,
  deviceId, ip, geoDecisionId, expiresAt, rotatedAt)`; `Device(id, fp, …)`.
- `KycCase(id, userId, tier, documents[], state, reviewedBy, decidedAt)`.
- `GeoDecision(id, sessionId, country, method, allowed, reason)`.
- RG: `AccountLimit(id, userId, kind[deposit|stake|loss|time], period, value,
  state)`; `SelfExclusion`, `CoolingOff`; `ResponsibleGamingEvent` log.

## Catalogue

- `Sport(id, slug, name)` → `Category(id, sportId, country/region, name)` →
  `Competition(id, categoryId, name, seasonId)` → `Season`.
- `Event(id, competitionId, startsAt, status[SCHEDULED|LIVE|PAUSED|SUSPENDED|
  FINAL|ABANDONED|CANCELLED], homeParticipantId, awayParticipantId,
  liveClock?, period?, providerMappingIds[])`.
- `Participant`, `Score(eventId, scope[FULL|HT|…], home, away, updatedAt)`,
  `EventState` history (append-only).
- Trading: `Market(id, eventId, type[1X2|OU|BTTS|DC|DNB|HC|CS|…], line?,
  state[OPEN|SUSPENDED|SETTLED|VOIDED], version)`; `Outcome(id, marketId,
  label, state)`; `Price(id, outcomeId, decimalOdds, version, validFrom,
  validTo)` + `PriceVersion` audit; `MarketState` log; `TradingLimit`.

## Betting

- `Betslip(id, userId, mode[SIM|REAL], state, idempotencyKey)`;
  `BetslipSelection(id, slipId, outcomeId, priceVersionId, builderLegs?)`.
- `Bet(id, userId, type[SINGLE|MULTIPLE|SYSTEM|BUILDER], totalOdds,
  stakeMinor, potentialMinor, state, betRef unique, txnRef unique,
  idempotencyKey unique, placedAt)`; `BetLeg(betId, outcomeId,
  priceVersionId, acceptedOdds, state[OPEN|WON|LOST|VOID|…])`.
- `BetAcceptance / BetRejection(betId, code, message, versions)`.
- Settlement: `Result(eventId, source, payload, version)`; `Settlement(betId,
  resultVersion, outcome, amounts)`; `SettlementRevision`; `Void`;
  `Resettlement` — all idempotent on `(betId, resultVersion)`.
- Cashout: `CashoutQuote(betId, amountMinor, expiresAt)`; `CashoutAcceptance`.
- Booking: `BookingCode(code unique, slipSnapshot JSON, priceBasis, expiresAt,
  maxUses)`; `SharedSlip`.

## Wallet (immutable ledger)

- `WalletAccount(id, userId, kind[REAL|BONUS|…], currency)` — NO balance col.
- `LedgerTransaction(id unique, idempotencyKey unique, kind, refType, refId,
  currency, status, createdAt)` + `LedgerEntry(txnId, accountId, debitMinor,
  creditMinor)` (double-entry, sum-zero per txn); `Deposit`, `Withdrawal`,
  `PaymentAttempt`, `BonusWallet/Grant/Usage`.

## Ops

- `Provider(id, kind[odds|games|payments], config)`; `ProviderEventMapping`;
  `WebhookEvent(id unique, signature, payload, processedAt)`; `AuditLog`;
  `RiskFlag`; `Promotion`, CMS banner entity; support `Case`.

Key relations: Event 1–N Markets 1–N Outcomes 1–N Prices (versioned); Bet 1–N
Legs N–1 Outcomes; every money move N–2 LedgerEntries via 1 LedgerTransaction.
