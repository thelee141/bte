# Feature Matrix (OBSERVED vs INFERRED, 21 Sept 2026)

`O` = observed live · `I` = inferred · `?` = unverified this pass · `P` = proposed requirement

## Sportsbook

| Feature | State | Evidence / note |
|---|---|---|
| Sports nav (10+ sports + More) | O | Home + football strips |
| Country → competition tree w/ counts | O | England 107, Top Leagues 326… |
| Today / Next-3h / Upcoming / Outrights | O | Tabs + deep links |
| Column presets (3Way&O/U, DC, GG/NG, DNB…) | O | Per-league view switchers |
| Event rows: time, ID, teams, 3 prices, O/U line, +N | O | E.g. Arsenal–Leeds 1.38/5.18/8.23 +301 |
| Market counts to 300+ on top fixtures | O | +220…+306 EPL rows |
| Live strip w/ clock, half, score | O | 66:22 H2 etc. on home |
| Live counters (30 / ~175) | O | Live page headers |
| Favourites (pin) | O | Livescore pins; slip favs ? |
| Search | O(exists)/? (results) | Header + games search boxes |
| Livescore (FT/HT/AP, calendar, radar) | O | livescore subdomain |
| Results | ? | Title only |
| Event detail full markets | ? | Row click re-rendered listing |
| Bet Builder | O(link)/? (UI) | Help nav entry |
| Odds filter + slider | O(exists)/? (semantics) | Control seen, meaning open |

## Betslip & booking

| Feature | State | Evidence / note |
|---|---|---|
| Click-odds → auto-add selection | O | Badge 0→1, card appeared |
| Selection card (comp/fixture/market/price) | O | "Arsenal v Leeds, 1X2, 1.38" |
| SIM/REAL toggle | O | Slip header |
| Total Stake NGN + Potential Win live calc | O | 138.00 on default stake |
| Place Bet / Book Bet / Print | O | Slip actions |
| Booking-code textbox + Load (disabled empty) | O | Right rail |
| Code Hub / Load Code pages | O (search) | `/ng/m/code-hub`, `/m/load_code` |
| Singles/Multiple/System tabs | I/? | Not visible at 1 selection; required P |
| Bonuses (Flexi/1Cut/2UP), insurance | O (promo)/? (slip) | Promo hub lists Flexi, 1Cut, 2UP, Odds Boost |
| Cashout tab | O (tab)/? (quotes) | Tab seen, empty state not reached |
| Price-change / suspend handling | P | Standard; unverified visually |

## Games & content

| Feature | State | Evidence / note |
|---|---|---|
| Games lobby (search, POPULAR/NEW/EXCLUSIVE + player counts) | O | 200+ card snapshot |
| Game launch iframe w/ Exit + Login gate | O | games-detail-1.txt |
| Scheduled Virtuals, vFootball, instant virtuals | O(links)/? (mechanics) | Routes seen |
| Crash (Aviator/JetX missions) | O (promo)/? (round UI) | Promo titles only |
| Jackpot | O(link)/? (picks/prize) | Route + help entry |
| Promotions hub (All/Games/Features, dated + evergreen) | O | 15+ promos listed |
| Loyalty, App download | ? | Routes only |

## Account / wallet / ops

| Feature | State | Evidence / note |
|---|---|---|
| Mobile+password login, Register modal w/ password rule, Forgot PW, Deactivate/Reactivate | O | Header + modal DOM |
| 18+ gate, NLRC licence strip, RG footer links | O | Footer compliance strip |
| Help hub (13 sections) | O(links)/? (bodies) | Bodies JS-gated |
| Deposits/withdrawals rails, KYC docs | ?/third-party only | No in-product evidence; see PAYMENT_FLOW.md |
| Open/settled bets, txn history, limits, self-exclusion | ? | Auth-gated; specified as P |
| System Status page | O(link) | [third-party URL removed] |
| Support (phone/email/chat/WhatsApp) | O(footer)/third-party | 07008888888, nigeria.support@… |
