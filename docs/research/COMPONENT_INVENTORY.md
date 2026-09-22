# Component Inventory (structural, no styling copied)

OBSERVED desktop DOM (classes noted as integration landmarks, not to reuse):

- `header`: logo link, search, `+234` Mobile Number + Password, Login/Register,
  Forgot Password, Deactivate/Reactivate, Print, Refresh.
- Top ribbon nav: 10 product links (Sports…App hot).
- Sports strip: Home, Football…eIce Hockey + More Sports popover.
- Left nav: quick links (Today's Football, Next 3 Hours, named leagues) on
  home; country accordion tree (`Top Leagues 326`, `England 107`…) on listing.
- League block: header (name), view-preset tabs (`tabs-v2`: Matches,
  Outrights, 3 Way & O/U, Double Chance, GG/NG, Draw No Bet, Other Markets),
  event rows, `View All`.
- Event row: time + `ID: <n>` | home | away | 3 odds buttons | O/U line
  selector (`2.5 ^` + 2 prices) | `+N` link. Live variant adds clock, H1/H2,
  score.
- Right rail: `m-betslip-wrapper` → `betslip-tabs` (`Betslip<n>` + `Cashout`)
  → `m-betslips` (SIM/REAL toggle, selection cards, stake, potential, Place
  Bet / Book Bet / Print) + Booking Code box (textbox + Load).
- Promo/registration banner ("Instant Registration…").
- Footer: brand strap, Nigeria link column, How-To-Play column, social icons,
  phones/email, ZA/BR links, 18+/addiction/NLRC-0001014 strip, © 2026.
- Games lobby (iframe): search box, cards with POPULAR/NEW/EXCLUSIVE +
  `<n> players` badges; detail overlay with Exit + Login.
- Promotions hub: H1 + All/Games/Features filter + dated promo cards +
  evergreen feature cards (Odds Boost, 2UP, Flexi, 1Cut).
- Livescore: calendar, Filters, Favourites, FT/HT/AP grid, pin + quick-stats
  per row, Match Radar.
- States seen: count badges, disabled buttons (Load, Create Account), checked
  T&C checkbox, live counters. Skeletons/toasts/odds-flash NOT captured →
  PROPOSED: skeleton rows, price up/down flash, suspended overlay, toast,
  empty-slip, error/expired-code, offline banner.
