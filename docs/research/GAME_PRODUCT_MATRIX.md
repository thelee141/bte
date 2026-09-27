# Game Product Matrix (structural reference, no mechanics copied)

| Product | Entry pattern | Lobby/detail pattern | Round/stake concepts (PROPOSED — verify with provider docs) |
|---|---|---|---|
| Sportsbook | sportsbook home | Rows + market-depth links | Standard bet lifecycle |
| Live betting | live sportsbook surface | Counters, clocks, score state | Clock/score/suspend/accept-delay |
| Games/Casino | games lobby + search + catalogue badges | Embedded provider launch + login gate | Provider iframe launch, demo-vs-real, limits |
| Instant/virtuals | instant virtuals surface | Route family only | Rapid rounds, multi-panel stake, multiplier, cashout, auto-bet/cashout, history, fairness page |
| Scheduled virtuals | scheduled virtuals surface | Route family only | Timed draws, countdown, results archive |
| Jackpot | jackpot surface + help entry | Route family only | Picks grid, rounds, prize tiers, rollover |
| Lucky Numbers | Help entry only | Unverified | Number-draw betting |
| Promotions | promotions hub + detail pages | Multiple promo categories | Bonus wallet + wagering engine |
| Loyalty | account loyalty surface | Unverified (auth-gated) | Points/tiers engine |
| Livescore | external livescore surface | FT/HT/AP, pins, radar | Read-only data product |

Crash/instant-game mechanics were not reverse-engineered. Round lifecycle,
fairness (RNG/provably-fair), and limits remain OPEN QUESTIONS.
PROPOSED rule: no production RNG in reconnaissance; game outcomes come from
certified providers behind an adapter; BTE's wallet only debits/credits.
