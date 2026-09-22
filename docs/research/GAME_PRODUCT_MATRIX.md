# Game Product Matrix (OBSERVED structure, no mechanics copied)

| Product | Entry (observed) | Lobby/detail (observed) | Round/stake concepts (PROPOSED — verify w/ provider docs) |
|---|---|---|---|
| Sportsbook | `/ng/` home | Rows + `+N` deep links | Standard bet lifecycle |
| Live betting | `/ng/sport/live/` | Counters seen; rows stalled | Clock/score/suspend/accept-delay |
| Games/Casino | `/ng/games` iframe lobby, search, POPULAR/NEW/EXCLUSIVE + player counts | Overlay w/ Exit + Login gate | Provider-iframe launch, demo-vs-real, limits |
| Instant/virtuals | `/instant-virtuals`, vFootball | Routes only | Rapid rounds, multi-panel stake, multiplier, cashout, auto-bet/cashout, history, fairness page |
| Scheduled virtuals | `/ng/virtual/` | Route only | Timed draws, countdown, results archive |
| Jackpot | `/ng/jackpot/` + help entry | Route only | Picks grid, rounds, prize tiers, rollover |
| Lucky Numbers | Help entry only | Unverified | Number-draw betting |
| Promotions | `/ng/promotions/` hub + `activityId` details | 15+ promos; Flexi/1Cut/2UP/Odds Boost evergreen | Bonus wallet + wagering engine |
| Loyalty | `/my_accounts/loyalty` | Unverified (auth-gated) | Points/tiers engine |
| Livescore | Subdomain, rich grid | FT/HT/AP, pins, radar | Read-only data product |

Crash/instant (Aviator/JetX-type) known ONLY from promo titles ("Aviator
Missions", "JetX: NGN 50,000 in Free Bet Gifts", "Ride the crash") — round
lifecycle, fairness (RNG/provably-fair), and limits are OPEN QUESTIONS.
PROPOSED rule: no production RNG in reconnaissance; game outcomes come from
certified providers behind an adapter; our wallet only debits/credits.
