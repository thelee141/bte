# SPORTSBOOK MASTER PLAN — source of truth (frozen spec, Sept 2026)

Original build. Comparable depth/workflows/usability to the audited product;
NO trademarks, logos, copied graphics/code/copy, scraped odds, or trade dress.
Real-money mode DISABLED until licensed. Dev = PLAY MONEY + sandbox.

## Phase 0 — Foundations & unknowns

- [ ] Choose stack; create manifests; record exact versions + official docs read
- [ ] Close OPEN_QUESTIONS 1–5 via re-audit (event detail, live, search, slip tabs, filters)
- [ ] Close OPEN_QUESTIONS 6–11 via provider/help docs (games, jackpot, payments, loyalty)
- [ ] threat-model + RG/compliance review sign-off
- Acceptance: versions pinned, docs logged, unknowns triaged into phases
- Risks: provider sandbox delays; legal timelines

## Phase 1 — Public sportsbook (prematch) + design system

- [ ] IA: home, sport listing, league page, livescore, results, promos, help/legal, footer
- [ ] Components: header, sports nav, tree, league blocks, event rows, odds buttons, +N links
- [ ] Responsive 320→1440 per RESPONSIVE_AUDIT principles; skeletons/empty/error states
- [ ] Canonical catalogue + provider-adapter stubs with fixture feeds
- Acceptance: fixture-driven pages render all routes; a11y + 44px targets; no provider IDs leak

## Phase 2 — Live betting + real-time

- [ ] WS/SSE gateway, price-version ticks, clock/score/period/cards metadata
- [ ] Live rows: flash moves, suspend/lock overlay, stale/reconnect resync
- [ ] Acceptance: kill-feed test shows suspend ≤1 tick; reconnect never uses stale quotes

## Phase 3 — Betslip, booking, bet lifecycle

- [ ] State machine (BETSLIP_STATE_MACHINE.md) + atomic placement (BET_LIFECYCLE.md)
- [ ] Singles/Multiple/System + Bet Builder (single-leg combined price)
- [ ] Book/load/share codes; receipts with betRef/txnRef; Cashout quotes
- [ ] Settlement engine: void legs, parlays, corrections, resettlement, audit
- Acceptance: concurrency tests (double-submit, stale-price, suspend-mid-submit) all safe

## Phase 4 — Wallet, payments (sandbox), promos

- [ ] Immutable ledger (minor units), PaymentProvider abstraction, replay-safe webhooks, reconciliation
- [ ] Bonus wallet: Flexi/1Cut/2UP/Odds-Boost-style mechanics with ORIGINAL rules text
- [ ] Acceptance: sandbox deposit→bet→settle→withdraw loop reconciles to zero exceptions

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

## MVP boundary (end of Phase 3 + sandbox wallet)

Prematch + live + slip/booking + play-money wallet + settlement on fixture feeds.

## Production boundary (post Phase 7 + external gates)

Licensed entity, provider + payment contracts, KYC/geo vendors, audited RNG/games,
support SLAs, regulator approvals — each a checkbox before enabling real money.

## Risks & unknowns

- Live re-verification gaps (see OPEN_QUESTIONS.md) — mitigated by PROPOSED specs
- Provider/WAF throttling observed (CloudFront 403s, CDP stalls) — fixture-first dev
- Legal/licensing long pole — play-money architecture keeps build unblocked
- Payment/KYC rails unconfirmed in-product — sandbox + contract-gated integration
