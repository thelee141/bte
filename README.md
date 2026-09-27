# bte sportsbook — original sportsbook platform (play-money dev)

Source of truth: `SPORTSBOOK_MASTER_PLAN.md` + `docs/research/`.

Real-money mode is **DISABLED**. Current development uses deterministic fixture
sports data and PLAY MONEY only.

## Runtime and tooling

Verified 27 Sept 2026:

| Tool | Version |
|---|---:|
| Node.js | 24.19.0 |
| pnpm | 11.22.0 |
| TypeScript | 5.9.3 |
| Prisma / @prisma/client | 6.19.3 |
| React / React DOM | 19.3.0 |
| Vite | 8.3.1 |
| Vitest | 3.2.7 |
| ESLint | 9.39.5 |
| PostgreSQL | local `bte_dev` database |

Direct package versions are pinned in `package.json` and `pnpm-lock.yaml`.

## Commands

| Purpose | Command |
|---|---|
| install | `pnpm install` |
| API dev server | `pnpm run dev:api` |
| customer web dev server | `pnpm run dev:web` |
| typecheck | `pnpm run typecheck` |
| lint | `pnpm run lint` |
| test | `pnpm test` |
| production build | `pnpm run build` |
| serve built customer app + API | `pnpm start` |
| migrate | `pnpm run db:migrate` |
| Prisma generate | `pnpm run db:generate` |

## Verified implementation checkpoints

### Slice 01 — sports domain + deterministic fixture provider

- `src/sports/`: canonical sports types, deterministic `FixtureSportsProvider`,
  normalization guards, provider-ID isolation, versioned prices.
- PostgreSQL catalogue schema and migrations.
- Sports tests cover canonicalization, deterministic fixtures, filtering and stale
  price handling.

### Slice 02 — wallet + immutable ledger

- `src/wallet/`: minor-unit money math, signed derived balances, typed wallet
  errors, immutable double-entry ledger and play-money funding.
- No mutable balance column; balances derive from ledger entries.
- Ledger posting can now join a caller-owned Prisma transaction, so financial
  effects can commit atomically with betting/settlement state.
- Database row locks protect balance-sensitive concurrent debits.

### Slice 03 — atomic idempotent bet placement

- `src/betting/`: server-authoritative selection/price validation, accepted-price
  snapshots, atomic stake debit + bet persistence, idempotency and concurrency
  handling.
- PostgreSQL `FOR UPDATE` + Serializable transactions protect concurrent placement.
- Bounded serialization retries prevent raw Prisma/PostgreSQL transaction errors
  leaking through the betting contract.

### Slice 04 — settlement + payout/refund + history

- `src/settlement/`: versioned, idempotent settlement for WON / LOST / VOID /
  PARTIAL_VOID outcomes.
- Winning payouts and void refunds are committed in the same DB transaction as
  settlement records and bet/leg terminal state.
- Void legs drop out of multiple odds; all-void bets refund the stake.
- Concurrent identical settlement is replay-safe and cannot double-credit.
- Open/settled bet-history queries are available.
- Result corrections/resettlement are intentionally **not** enabled yet: a newer
  result version returns `RESETTLEMENT_REQUIRED` until correction accounting is
  implemented explicitly.

### Slice 05 — persisted betslip + booking codes

- `src/betslip/`: owned draft slips, persisted stake/selections, same-market
  replacement and identical-outcome toggle behavior.
- Stored selections are revalidated against the current provider quote before
  placement; price changes require explicit acceptance and suspended/unavailable
  legs block preparation.
- `prepareForPlacement` bridges a clean persisted slip into Slice 03 while Slice
  03 still performs the authoritative placement-time recheck.
- Booking codes are 12-character cryptographically generated human-safe tokens
  backed by immutable JSON snapshots, TTLs and atomic max-use counters.
- Loading a code never reserves historical odds: current prices are returned and
  changed/suspended/unavailable legs are surfaced explicitly.
- Importing a booking persists current available quotes; loading/importing a code
  never places a bet or moves ledger value.
- Cross-user slip access is rejected, including before a booking-code use can be
  consumed.

### Slice 06 — canonical realtime stream + SSE reconnect

- `src/realtime/`: monotonic canonical realtime hub with price, market state,
  event state, clock/period, score and cards/corners ticks.
- Per-entity versions reject stale/duplicate updates before they enter the stream;
  global sequence numbers provide reconnect ordering.
- Bounded in-memory replay supports `Last-Event-ID`; clients outside the retained
  journal receive an authoritative snapshot instead of replaying stale data.
- `RealtimeClientState` rejects sequence gaps and stale entity versions.
- `RealtimeOverlayProvider` feeds accepted realtime state back into the same
  `SportsProvider` contract consumed by betslip and bet placement, preventing
  browser-stream odds from diverging from transaction-time authority.
- `RealtimeSseGateway` is an actual Node HTTP `text/event-stream` endpoint with
  replay cursors, snapshot resync, heartbeat, bootstrap-race protection and
  response backpressure buffering.
- The deterministic fixture feed emits price → suspend → clock → score →
  cards/corners → reopen cycles for repeatable QA.
- Live suspension reaches connected client state in the same published tick;
  reconnect tests prove missed events cannot regress quotes or market state.

### Slice 07 — customer sportsbook web UI + responsive design system

- React 19 + Vite customer application in `web/`, backed by the real verified
  sportsbook services through a thin Node HTTP API in `src/app/`.
- Customer routes cover sports/highlights, live, My Bets, results, promotions,
  games placeholder and help; the desktop shell includes sport navigation,
  competition filtering, event/odds rows and a sticky betslip.
- Realtime SSE updates drive live clocks/scores/stats, odds flashes and suspended
  trading states directly in the rendered UI.
- Persisted betslip flows are wired end-to-end: select/replace odds, persist stake,
  explicit changed-price acceptance, book/load codes and clear.
- Placement bridges through the existing Slice 03 transaction engine; accepted
  bets render an immutable receipt with both `betRef` and the ledger transaction
  reference `txnRef`.
- The receipt migration backfills historical bets from their immutable `BET`
  ledger transaction before enforcing the new unique non-null `txnRef`.
- Responsive QA was performed at 1440 desktop, 390 mobile and the 320px floor.
  Mobile uses a bottom navigation + betslip sheet and 44px touch targets for core
  odds/tab actions.
- A real browser smoke flow verified odd selection → mobile slip → ₦10 stake →
  accepted receipt, and an HTTP integration test verifies bootstrap → slip →
  placement → receipt → open-history.
- Production builds emit `web-dist/`; generated assets are ignored from Git and
  the Node customer server serves the built SPA with API/SSE routes.

### Slice 08 — result corrections + resettlement accounting

- Settlement results are append-only revisions: a higher `resultVersion`
  supersedes the latest settlement without mutating historical settlement rows.
- Each revision records the full corrected entitlement, the signed adjustment
  versus the immediately previous revision, and the settlement it supersedes.
- Prior awards/refunds are reversed with immutable double-entry
  `SETTLEMENT_REVERSAL` transactions before the corrected entitlement becomes
  authoritative.
- Corrections preserve source-account semantics: prior stake refunds reverse
  against the stake pool; prior win credits reverse against the play-money mint.
- Replays and concurrent identical corrections are idempotent; stale result
  versions are rejected.
- Authoritative corrections can claw back already-spent winnings into the existing
  signed derived balance and can settle a previously accepted bet even after the
  wallet is frozen. Ordinary funding/stake writes still reject frozen or
  insufficient accounts.
- The ledger's negative/frozen-account escape hatches are runtime-restricted to
  settlement/resettlement transaction kinds/ref types; ordinary callers cannot opt
  into them.
- `listSettlementRevisions()` exposes the audit chain while bet history continues
  to project only the latest authoritative settlement.
- The Slice 08 migration was verified both from a clean migration replay and
  against an isolated pre-Slice-08 database containing a historical settlement;
  historical first revisions backfill `adjustmentMinor = creditMinor`.

Current verification gate: **86 tests**, plus core/web typecheck, lint,
production build and a clean seven-migration Prisma replay.

## Transaction / realtime docs consulted

The transaction/concurrency implementation was checked against current Prisma ORM
v6 documentation on 26 Sept 2026:

- Prisma transactions / isolation levels / P2034 retry guidance
- Prisma v6 error reference, including P2010 raw-query errors
- Prisma raw SQL documentation

The realtime gateway was checked against current Node.js 24 HTTP documentation and
the browser SSE/EventSource event-stream format on 27 Sept 2026:

- Node.js v24 `node:http` server / `ServerResponse.write()` behavior
- SSE `text/event-stream` framing, named `event:`, `data:`, `id:`, reconnect
  semantics and comment heartbeats
- Browser `EventSource` one-way connection/reconnect model

See `SPORTSBOOK_MASTER_PLAN.md` for remaining product phases.

## Maintenance note

`eslint@9.39.5` is the version already installed and is now pinned for
reproducibility, but pnpm reports that release as unsupported upstream. Upgrade it
in a dedicated tooling-maintenance change rather than mixing it into sportsbook
domain work.
