# SPORTSBOOK MASTER PLAN — source of truth (Sept 2026)

Original build. Comparable depth/workflows/usability to the audited product;
NO trademarks, logos, copied graphics/code/copy, scraped odds, or trade dress.
Real-money mode DISABLED until licensed. Dev = PLAY MONEY + sandbox.

## Verified implementation checkpoints

- [x] Slice 01 — canonical sports domain + deterministic fixture provider
- [x] Slice 02 — immutable play-money wallet + double-entry ledger
- [x] Slice 03 — atomic, idempotent server-authoritative bet placement
- [x] Slice 04 — idempotent settlement, payout/refund, partial-void math, bet history
- [x] Slice 05 — booking codes + persisted betslip lifecycle
- [ ] Slice 06 — live/realtime stream + reconnect/stale-state guarantees
- [ ] Slice 07 — customer sportsbook web UI + responsive design system
- [ ] Later — explicit resettlement/corrections, cashout, sandbox payments, promos,
      accounts/RG/compliance/admin, games/virtuals/jackpot, hardening

Current verified gate after Slice 05: 62/62 tests + typecheck + lint + build.
Real-money mode remains OFF.

## Phase 0 — Foundations & unknowns

- [x] Backend manifests created; exact current package versions pinned
- [x] PostgreSQL + Prisma backend foundation established
- [x] Prisma v6 transaction/error/raw-SQL docs checked for current concurrency behavior
- [ ] Choose and pin the customer-web framework/design-system stack
- [ ] Close OPEN_QUESTIONS 1–5 via re-audit (event detail, live, search, slip tabs, filters)
- [ ] Close OPEN_QUESTIONS 6–11 via provider/help docs (games, jackpot, payments, loyalty)
- [ ] Threat-model + RG/compliance review sign-off
- Acceptance: versions pinned, docs logged, unknowns triaged into phases
- Risks: provider sandbox delays; legal timelines
- Maintenance debt: pinned ESLint 9.39.5 is reported unsupported upstream; upgrade separately

## Phase 1 — Public sportsbook (prematch) + design system

- [ ] IA: home, sport listing, league page, livescore, results, promos, help/legal, footer
- [ ] Components: header, sports nav, tree, league blocks, event rows, odds buttons, +N links
- [ ] Responsive 320→1440 per RESPONSIVE_AUDIT principles; skeletons/empty/error states
- [x] Canonical catalogue + provider-adapter boundary + deterministic fixture feeds
- Acceptance: fixture-driven pages render all routes; a11y + 44px targets; no provider IDs leak

## Phase 2 — Live betting + real-time

- [ ] WS/SSE gateway, price-version ticks, clock/score/period/cards metadata
- [ ] Live rows: flash moves, suspend/lock overlay, stale/reconnect resync
- [ ] Acceptance: kill-feed test shows suspend ≤1 tick; reconnect never uses stale quotes

## Phase 3 — Betslip, booking, bet lifecycle

- [ ] Client betslip state machine from BETSLIP_STATE_MACHINE.md
- [x] Atomic placement from BET_LIFECYCLE.md
      - server-authoritative event/market/outcome/price validation
      - immutable accepted-price snapshots
      - atomic stake debit + bet persistence
      - idempotent replay
      - DB-safe concurrent overspend protection
- [ ] Explicit bet-type layer: Singles / Multiple / System / Bet Builder
      - current placement engine accepts one or multiple independent legs
      - System and Builder semantics are NOT implemented yet
- [x] Persisted server-side draft slips
      - same outcome toggles off; same-market alternative replaces
      - persisted stake + ownership boundaries
      - reconcile current / changed / suspended / unavailable selections
      - explicit accept-new-price step before preparation
      - clean slip prepares Slice 03 expected price/version inputs
- [x] Book/load/import/share-code backend
      - cryptographically generated 12-character codes
      - immutable slip snapshot + TTL + atomic max-use counters
      - load/import always revalidates CURRENT prices
      - booking code never reserves price, places a bet or moves ledger value
- [ ] Receipt surface with betRef/txnRef
- [ ] Cashout quotes/acceptance
- [x] Settlement v1
      - WON / LOST / VOID / PARTIAL_VOID
      - void-leg removal from multiple odds
      - all-void stake refund
      - settlement + ledger credit/refund in one DB transaction
      - idempotent concurrent replay
      - open/settled history query
- [ ] Result correction + resettlement ledger adjustments
      - currently newer resultVersion returns RESETTLEMENT_REQUIRED
      - no historical settlement is overwritten
- Acceptance: concurrency tests (double-submit, stale-price, suspend-mid-submit,
  double-settlement) safe; correction/resettlement still required before Phase 3 is complete

## Phase 4 — Wallet, payments (sandbox), promos

- [x] Immutable double-entry ledger using integer minor units
- [x] Derived balances; no mutable user balance column
- [x] Caller-owned transaction participation for atomic financial/domain writes
- [x] Row-lock protection for balance-sensitive concurrent debits
- [ ] PaymentProvider abstraction
- [ ] Replay-safe payment webhooks
- [ ] Deposit/withdrawal reconciliation
- [ ] Bonus wallet: original Flexi/1Cut/2UP/Odds-Boost-style mechanics
- Acceptance: sandbox deposit→bet→settle→withdraw loop reconciles to zero exceptions

## Phase 5 — Games/virtuals/jackpot (provider-backed)

- [ ] Lobby + provider-iframe launch + login gating; virtuals schedule + results
- [ ] Jackpot picks/rounds/prizes; crash/instant via certified providers only (no homebrew RNG)
- Acceptance: provider-sandbox round trip; limits + fairness pages live

## Phase 6 — Accounts, RG, compliance, admin

- [ ] Register/login/recovery, KYC tiers, GeoDecision, limits/cool-off/self-exclusion
- [ ] Admin console (SPORTSBOOK_DATA_MODEL ops entities): users, KYC, payments, events/markets,
      settlement, bets/txns, promos/CMS, geo, support, audit, status
- Acceptance: RBAC + SoD + MFA; every privileged action audited; RG flows e2e tested

## Phase 7 — Hardening & launch-readiness (play-money)

- [ ] Security pass (SECURITY_MODEL.md), load/chaos (feed loss, clock skew), dispute drills
- [ ] Compliance packet for counsel/regulator; go/no-go for licensing track
- Acceptance: pen-test + reconciliation clean; real-money flag still OFF

## MVP boundary

Target remains: prematch + live + slip/booking + play-money wallet + settlement
on fixture feeds.

The backend transaction core now covers:
catalogue → placement → ledger debit → open bet → settlement → payout/refund → history.

Still required for MVP:
- customer sportsbook UI
- live/realtime delivery
- explicit correction/resettlement
- receipt surface + remaining Phase 3 acceptance work

## Production boundary (post Phase 7 + external gates)

Licensed entity, provider + payment contracts, KYC/geo vendors, audited RNG/games,
support SLAs, regulator approvals — each a checkbox before enabling real money.

## Risks & unknowns

- Live re-verification gaps (see OPEN_QUESTIONS.md) — mitigated by PROPOSED specs
- Provider/WAF throttling observed (CloudFront 403s, CDP stalls) — fixture-first dev
- Legal/licensing long pole — play-money architecture keeps build unblocked
- Payment/KYC rails unconfirmed in-product — sandbox + contract-gated integration
