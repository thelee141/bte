# Compliance Gates (OBSERVED footer facts + PROPOSED architecture)

OBSERVED: "Age 18 and above only to register or play"; "Betting is addictive
and can be psychologically harmful"; NLRC Licence No 0001014; Responsible
Gaming + Privacy Policy + T&Cs help entries; Deactivate/Reactivate control;
support contacts (phone/email/chat evidence).

## Gate matrix (PROPOSED — real-money mode DISABLED until licensed)

| Requirement | Implementation gate |
|---|---|
| Adult-only registration | DOB/age check at register; block <18; re-check at login anomalies |
| KYC/identity (NIN/BVN/ID tiers) | `KycCase` workflow; withdrawal locked until tier met |
| AML (name-match, velocity, structuring flags) | Exact-name destination match; `RiskFlag` + manual review queue |
| Jurisdiction restriction + geofencing | `GeoDecision` per session (NG-only at launch); block VPN/tamper signals per policy |
| Responsible gaming | Deposit/stake/loss/time limits, cooling-off, self-exclusion, reality checks, RG event log |
| Privacy / data retention | Consent records, minimisation, retention schedule, DSAR export/delete flow |
| Audit records | Immutable audit log for bets, payments, limits, KYC, admin actions |
| Complaints / disputes | Support case entity with SLA, bet-lookup attachment, escalation to regulator format |

PROPOSED invariant: a single `COMPLIANCE` feature flag disables real-money
placement/withdrawals without it; dev/staging run PLAY MONEY + sandbox
payments only. Nothing here constitutes legal clearance — operator needs
independent jurisdiction-specific licensing and legal sign-off.
