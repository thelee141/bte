# Security Policy

BTE is a play-money sportsbook reference platform. Security reports are welcome,
especially for issues affecting transaction correctness, ledger integrity,
authorization boundaries, realtime state, database migrations, or source-code
supply-chain safety.

## Supported versions

Until BTE publishes versioned releases, security fixes target the current
`main` branch.

| Version | Supported |
|---|---|
| current `main` | yes |
| historical commits / unpublished snapshots | no |

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability.**

When this repository is hosted on GitHub, use **GitHub Private Vulnerability
Reporting** (Security → Report a vulnerability). That will be the preferred
security-reporting channel.

Until a private repository reporting channel is configured, contact the project
owner, **Princely Ondotimi**, through a private channel associated with the
repository/profile. Do not include exploit details in public discussions.

A useful report includes:

- affected commit/version;
- subsystem and route/API involved;
- impact;
- reproduction steps or proof of concept;
- whether the issue is remotely exploitable;
- any suggested mitigation.

Please avoid accessing data that is not yours, degrading services, or performing
testing against third-party systems.

## High-priority issue classes

Particularly important reports include:

- double spend or wallet overspend;
- ledger imbalance or mutation of historical entries;
- duplicate payout/refund/correction effects;
- idempotency bypass;
- authorization bypass between users/slips/bets;
- stale-price acceptance;
- settlement/resettlement history corruption;
- arbitrary use of correction-only negative/frozen-wallet bypasses;
- SQL injection or unsafe raw-query construction;
- path traversal/static-file disclosure;
- SSE/realtime state corruption that can affect transaction-time authority;
- committed credentials or sensitive data;
- dependency or build-chain compromise.

## Scope note

The public BTE distribution intentionally excludes production payment rails,
KYC/AML vendors, licensed sports feeds, real-money operation and operator
secrets. Vulnerabilities in third-party services are outside this repository's
scope and should be reported to the relevant provider.

## Disclosure

Please allow reasonable time to investigate and prepare a fix before public
disclosure. Once a fix is available, the project may publish an advisory
describing impact, affected versions and remediation.
