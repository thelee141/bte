# Security Model (PROPOSED, anchored on observed auth surface)

Observed: phone(+234)+password login, registration password rule (≥8, upper),
disabled-until-valid submit, Forgot Password route, Deactivate/Reactivate,
Login-gated game launch, CloudFront 403 throttling on automated traffic
(WAF/bot-management INFERRED), HTTPS-only.

## Threats → controls

| Threat | Control (server-authoritative) |
|---|---|
| Account takeover / stuffing | Rate-limit + CAPTCHA/bot-score on login, bcrypt/argon2, device binding, OTP for recovery, session rotation |
| Session theft / CSRF / XSS | HttpOnly+Secure+SameSite cookies (or short JWT + refresh rotation), CSRF tokens on mutations, strict CSP, output-encoding, Vue-template discipline |
| SQLi / broken authz | Parameterised ORM, per-request policy checks (user owns resource; admin roles deny-by-default) |
| Payment replay / webhook spoof | Signed webhooks, `webhookEventId` dedupe, idempotency keys, reconciliation |
| Double spend / duplicate bets | Idempotent placement keys + atomic debit in one txn |
| Stale odds / forged prices / tampered receipts | `priceVersionId` check, server-computed odds/payout, signed receipt refs |
| Promo / multi-account abuse | Device fingerprint + BVN/NIN dedupe review, bonus abuse flags, one-bonus-per-household rules |
| Automated betting | Velocity limits, exposure caps, market suspension tooling |
| Withdrawal fraud | Name-match, KYC tiers, destination allowlist, manual-approval threshold |
| Insider / admin abuse | RBAC + SoD (approver ≠ reviewer), MFA, immutable `AuditLog`, no direct DB edits |

## Principles

Never trust client odds, payout, balance, event state, or settlement state.
Every privileged action audited (who/what/when/before-after). Secrets in a
vault, never in git. PII encrypted at rest, minimised in logs. Play-money
mode cannot touch real rails (build-time + runtime guards).
