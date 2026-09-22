# bte sportbook — original sportsbook platform (play-money dev)

Source of truth: `SPORTSBOOK_MASTER_PLAN.md` + `docs/research/`.

## Commands (verified 22 Sept 2026, node v24.19.0 / npm 11.17.0)

| Purpose    | Command              |
|------------|----------------------|
| install    | `npm install`        |
| typecheck  | `npm run typecheck`  |
| lint       | `npm run lint`       |
| unit test  | `npm test`           |
| build      | `npm run build`      |
| migrate    | `npm run db:migrate` |
| prisma gen | `npm run db:generate`|

No dependencies installed yet — Meta slice 1 declares what it needs.
Real-money mode is DISABLED; dev uses PLAY MONEY + sandbox stubs only.
