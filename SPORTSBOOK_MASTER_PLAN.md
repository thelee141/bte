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
- [x] Slice 06 — live/realtime stream + reconnect/stale-state guarantees
- [x] Slice 07 — customer sportsbook web UI + responsive design system
- [x] Slice 08 — append-only result corrections + resettlement accounting
- [ ] Later — cashout, sandbox payments, promos, accounts/RG/compliance/admin,
      games/virtuals/jackpot, hardening

All 8 numbered slices are implemented.
Current verified gate after Slice 08: 86/86 tests + core/web typecheck + lint +
production build + seven-migration replay + historical Slice 08 upgrade check.
Real-money mode remains OFF.

## Phase 0 — Foundations & unknowns

- [x] Backend manifests created; exact current package versions pinned
- [x] PostgreSQL + Prisma backend foundation established
- [x] Prisma v6 transaction/error/raw-SQL docs checked for current concurrency behavior
- [x] Customer web stack pinned: React 19.3 + Vite 8.3.1 + original CSS design system
- [ ] Close OPEN_QUESTIONS 1–5 via re-audit (event detail, live, search, slip tabs, filters)
- [ ] Close OPEN_QUESTIONS 6–11 via provider/help docs (games, jackpot, payments, loyalty)
- [ ] Threat-model + RG/compliance review sign-off
- Acceptance: versions pinned, docs logged, unknowns triaged into phases
- Risks: provider sandbox delays; legal timelines
- Maintenance debt: pinned ESLint 9.39.5 is reported unsupported upstream; upgrade separately

## Phase 1 — Public sportsbook (prematch) + design system

- [~] IA: home, live, results, promotions, help, My Bets and footer are rendered;
      dedicated event-detail/livescore/legal routes remain later work
- [x] Components: header, sports nav, competition rail, league blocks, event rows,
      odds buttons, +N links, desktop betslip and mobile bottom navigation
- [x] Responsive 320→1440 per RESPONSIVE_AUDIT principles; empty/loading/error
      states plus 44px mobile touch targets on core controls
- [x] Canonical catalogue + provider-adapter boundary + deterministic fixture feeds
- Acceptance for Slice 07 customer shell: fixture-driven routes render, provider IDs
  stay behind canonical contracts, and headed-browser QA covers desktop/mobile

## Phase 2 — Live betting + real-time

- [x] SSE gateway + canonical versioned realtime hub
      - global monotonic stream sequence + per-entity versions
      - price, market state, event state, clock/period, score, cards/corners
      - bounded replay journal + authoritative snapshot fallback
      - Last-Event-ID reconnect cursor + heartbeat + backpressure handling
- [x] Realtime state feeds the same SportsProvider contract used by betslip/placement
      - a price tick changes transaction-time authoritative price
      - market suspension blocks betslip/placement through the overlay provider
- [x] Client-state stale/gap protection + reconnect resync
- [x] Live-row visual price flashes + suspend/lock state in Slice 07 UI
- [x] Acceptance: connected client sees suspend in the published tick; reconnect
      replay/snapshot never regresses price or market state

## Phase 3 — Betslip, booking, bet lifecycle

- [x] Core customer betslip state machine from BETSLIP_STATE_MACHINE.md
      - add/replace/toggle selection, persisted stake, blocked trading states
      - explicit changed-price acceptance, submit/receipt, booking load/import
      - advanced Singles/System/Builder semantics remain separate below
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
- [x] Receipt surface with immutable betRef + ledger txnRef
- [ ] Cashout quotes/acceptance
- [x] Settlement v1
      - WON / LOST / VOID / PARTIAL_VOID
      - void-leg removal from multiple odds
      - all-void stake refund
      - settlement + ledger credit/refund in one DB transaction
      - idempotent concurrent replay
      - open/settled history query
- [x] Result correction + resettlement ledger adjustments
      - higher resultVersion appends a new settlement revision and never overwrites history
      - prior full entitlement is reversed with immutable double-entry accounting
      - corrected full entitlement is awarded/refunded with source-account semantics preserved
      - signed adjustmentMinor records the delta versus the immediately previous revision
      - stale versions, replay and concurrent identical corrections are handled safely
      - spent winnings may be clawed back into a signed negative derived balance while
        ordinary debits still enforce insufficient-funds/frozen-wallet rules
- Acceptance: double-submit, stale-price, suspend-mid-submit, double-settlement,
  correction replay/concurrency and negative-balance clawback paths are covered

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

The eight numbered slices now provide a working fixture-fed play-money MVP shell:
prematch + live/realtime + persisted slip/booking + wallet + placement + settlement
+ append-only corrections + history + customer web UI + immutable receipt references.

The transaction/customer path now covers:
catalogue → slip → quote reconciliation → placement → ledger debit → open bet →
settlement → payout/refund → corrected result/reversal/re-award → history/receipt.

Still required before the broader product can be treated as launch-ready:
- Singles/System/Bet Builder product semantics beyond the current simple
  single-or-multiple independent-leg engine
- cashout quotes/acceptance
- dedicated event-detail/livescore/legal surfaces and remaining audited unknowns
- later payment/KYC/RG/admin/security/compliance work below

## Production boundary (post Phase 7 + external gates)

Licensed entity, provider + payment contracts, KYC/geo vendors, audited RNG/games,
support SLAs, regulator approvals — each a checkbox before enabling real money.

## Risks & unknowns

- Live re-verification gaps (see OPEN_QUESTIONS.md) — mitigated by PROPOSED specs
- Provider/WAF throttling observed (CloudFront 403s, CDP stalls) — fixture-first dev
- Legal/licensing long pole — play-money architecture keeps build unblocked
- Payment/KYC rails unconfirmed in-product — sandbox + contract-gated integration
