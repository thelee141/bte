# Contributing to BTE

Thanks for your interest in BTE.

BTE is an open-source play-money sportsbook engine licensed under the
GNU Affero General Public License version 3 only (`AGPL-3.0-only`). The project
also intends to offer separately negotiated commercial licences.

That dual-licensing model affects how external code contributions are accepted.

## Before contributing code

Please start with an issue or discussion for any substantial change.

Good proposals include:

- the problem being solved;
- the relevant BTE subsystem;
- the expected behavior and invariants;
- compatibility or migration implications;
- tests you expect to add or change.

Small documentation fixes can usually proceed directly.

## Contributor Licence Agreement

Significant code contributions require acceptance of the
[BTE Contributor Licence Agreement](CLA.md) before they can be merged.

The CLA:

- does **not** transfer ownership of your contribution;
- grants the project copyright and patent permissions needed to distribute the
  contribution under AGPL and separate commercial terms;
- requires you to have the right to submit the contribution.

Until an automated CLA workflow exists, the project owner must explicitly
acknowledge CLA acceptance before merging an external code contribution.

## Development setup

Requirements:

- Node.js 24
- pnpm 11
- PostgreSQL

```bash
cp env.example .env
pnpm install
pnpm run db:migrate
```

Start the API/realtime server:

```bash
pnpm run dev:api
```

Start the customer web app in another terminal:

```bash
pnpm run dev:web
```

## Required verification

Before opening a pull request:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
pnpm exec prisma migrate status
```

Changes to schema or transaction behavior should also include focused tests for
migration safety, idempotency and concurrency.

## Engineering rules

### Preserve transaction invariants

Do not weaken these behaviors:

- money is represented in integer minor units;
- user balances are derived from immutable ledger entries;
- ordinary customer writes cannot create negative balances;
- accepted bet persistence and stake accounting remain atomic;
- server-side sports/price state remains authoritative;
- idempotency prevents duplicate monetary effects;
- settlement/accounting history is append-only;
- result corrections must not rewrite historical settlement rows;
- correction-only wallet bypasses remain restricted to authoritative settlement
  accounting;
- real-money operation remains outside the public distribution.

### Prefer explicit domain boundaries

Keep provider-specific identifiers and behavior behind adapters. Avoid coupling
the browser directly to upstream provider contracts.

### Tests are part of the change

A bug fix should normally include a regression test. Transaction/concurrency
changes should be exercised against PostgreSQL rather than only mocks.

### Database changes

Use Prisma migrations. Do not silently mutate existing migration files after
they have become part of a published release.

A migration that changes a non-null or unique invariant must consider historical
rows and upgrade safety, not only an empty development database.

### Package management

Use **pnpm**. Do not introduce npm/yarn lockfiles.

### Generated output

Do not commit:

- `node_modules/`;
- `dist/`;
- `web-dist/`;
- local databases;
- local environment files;
- browser/session artifacts.

## Pull requests

Keep pull requests focused. A good PR description explains:

1. what changed;
2. why;
3. which invariants are affected;
4. migration implications;
5. tests/verification performed.

Do not combine unrelated refactors with transaction-sensitive changes unless
there is a clear reason.

## Security issues

Do not report suspected vulnerabilities in a public issue.

See [SECURITY.md](SECURITY.md).

## Licensing

By contributing, you agree that your contribution is governed by the repository
licence and, where required, the signed BTE CLA.

The project licence is in [LICENSE](LICENSE).
