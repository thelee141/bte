# Feature Matrix (observed / inferred / proposed, 21 Sept 2026)

`O` = observed live · `I` = inferred · `?` = unverified this pass · `P` = proposed requirement

## Sportsbook

| Feature | State | Evidence / note |
|---|---|---|
| Sports nav (10+ sports + More) | O | Home + football strips |
| Country → competition tree w/ counts | O | Dense competition navigation |
| Today / Next-3h / Upcoming / Outrights | O | Tabs + deep links |
| Column presets (3Way&O/U, DC, GG/NG, DNB…) | O | Per-league view switchers |
| Event rows: time, ID, teams, 3 prices, O/U line, +N | O | Dense prematch event table |
| Market counts to 300+ on top fixtures | O | Large per-fixture market depth |
| Live strip w/ clock, half, score | O | Live rows with period + score |
| Live counters | O | Live page headers |
| Favourites (pin) | O | Livescore pins; slip favs ? |
| Search | O(exists)/? (results) | Header + games search boxes |
| Livescore (FT/HT/AP, calendar, radar) | O | External livescore surface |
| Results | ? | Route/title observed |
| Event detail full markets | ? | Row click behavior inconclusive |
| Bet Builder | O(link)/? (UI) | Help nav entry |
| Odds filter + slider | O(exists)/? (semantics) | Control seen, meaning open |

## Betslip & booking

| Feature | State | Evidence / note |
|---|---|---|
| Click-odds → auto-add selection | O | Badge increment + selection card |
| Selection card (comp/fixture/market/price) | O | Competition/fixture/market/price content |
| SIM/REAL toggle | O | Slip header |
| Total Stake + Potential Win live calc | O | Reactive potential-return calculation |
| Place Bet / Book Bet / Print | O | Slip actions |
| Booking-code textbox + Load | O | Right rail |
| Code Hub / Load Code pages | O | Dedicated booking-code surfaces |
| Singles/Multiple/System tabs | I/? | Not visible at one selection; required P |
| Bonuses / insurance-style mechanics | O (promo)/? (slip) | Promo hub feature families |
| Cashout tab | O (tab)/? (quotes) | Tab observed |
| Price-change / suspend handling | P | Required for safe transaction UX |

## Games & content

| Feature | State | Evidence / note |
|---|---|---|
| Games lobby (search, badges + player counts) | O | Large card catalogue |
| Game launch iframe w/ Exit + Login gate | O | Embedded game launch |
| Scheduled Virtuals, vFootball, instant virtuals | O(links)/? (mechanics) | Routes observed |
| Crash / instant-game promotions | O (promo)/? (round UI) | Promo titles only |
| Jackpot | O(link)/? (picks/prize) | Route + help entry |
| Promotions hub (categories, dated + evergreen) | O | Multi-card promo hub |
| Loyalty, App download | ? | Routes only |

## Account / wallet / ops

| Feature | State | Evidence / note |
|---|---|---|
| Mobile+password login, Register modal, Forgot PW, Deactivate/Reactivate | O | Header + modal DOM |
| 18+ gate, licence strip, responsible-gaming footer links | O | Footer compliance strip |
| Help hub (multiple sections) | O(links)/? (bodies) | Bodies JS-gated |
| Deposits/withdrawals rails, KYC docs | ?/third-party only | No in-product evidence; see PAYMENT_FLOW.md |
| Open/settled bets, txn history, limits, self-exclusion | ? | Auth-gated; specified as P |
| External system-status surface | O(link) | Public operational-status link |
| Support (phone/email/chat/messaging) | O(footer)/third-party | Multi-channel support surface |
