# Route Inventory (observed 21 Sept 2026)

Legend: OBSERVED = rendered/confirmed in-session. UNVERIFIED = route/link
seen but body not confirmed. No authenticated routes touched.

| URL | Status | What renders (structural, no copy) |
|---|---|---|
| `/ng/` | OBSERVED | Sportsbook home: header, sports strip, left quick links, center feed, right betslip, footer |
| `/ng/sport/football/` | OBSERVED | Football listing: country tree, time tabs, column presets, event rows with IDs/prices/+N |
| `/ng/sport/football/today` | OBSERVED (link) | Today's football filter |
| `/ng/sport/football?source=home&time=3h&sort=0` | OBSERVED (link) | Next-3-hours filter |
| `/ng/sport/football/sr:category:1/sr:tournament:17` | OBSERVED (link) | EPL league page pattern `sr:category:<id>/sr:tournament:<id>` |
| `/ng/sport/vFootball/` | UNVERIFIED | vFootball listing (nav link seen) |
| `/ng/sport/basketball/` | UNVERIFIED | Exists; throttled in-session. EuroLeague/WNBA deep links seen |
| `/ng/sport/tennis/`, `/eFootball/`, `/tableTennis/`, `/eBasketball/`, `/iceHockey/`, `/eIceHockey/` | OBSERVED (links) | Sport listing pattern `/ng/sport/<sport>/` |
| `/ng/sport/live/` | OBSERVED (partial) | Live betting; title rendered, counters 30/~175 seen; body stalled |
| `/ng/games?source=TopRibbon` | OBSERVED | Games lobby (iframe catalogue, search, player-count badges) |
| `/ng/virtual/` | UNVERIFIED | Scheduled Virtuals entry |
| `/instant-virtuals` | OBSERVED (link) | Instant virtuals entry |
| `/ng/jackpot/` | UNVERIFIED | Jackpot entry (title only via fetch) |
| `[third-party URL removed] | OBSERVED | Livescore: calendar, filters, FT/HT/AP grid, pins, Match Radar |
| `/ng/liveResult/` | UNVERIFIED | Results (title only; JS body) |
| `/ng/promotions/` | OBSERVED | Promotions hub: All/Games/Features tabs, dated + evergreen promos |
| `/ng/promotions/content/<slug>?activityId=<n>` | OBSERVED (links) | Promo detail pattern (e.g. onecut, live-odds-boost) |
| `/ng/my_accounts/loyalty` | UNVERIFIED | Loyalty (auth-gated expected) |
| `/ng/mobile` | UNVERIFIED | App download ("Download App" title) |
| `/ng/m/load_code` | OBSERVED (search) | Load Code: "Discover thousands of booking codes one click away" |
| `/ng/m/code-hub` | OBSERVED (search) | Code Hub-Football |
| `/ng/profile/reset_password` | OBSERVED (link) | Password recovery |
| `/ng/help?nav=about-us|terms-and-conditions|responsible-gaming|privacy-policy|faq|sports|bet-builder|live-betting|games|live-games|virtuals|jackpot|lucky-numbers|others` | OBSERVED (links; bodies JS-gated) | Help hub articles |
| `/corporate` | OBSERVED (link) | third-party corporate group corporate |
| `[third-party URL removed] | OBSERVED (link) | System Status |
| Social: facebook/x/instagram/telegram, ZA + BR sites, support phone/email | OBSERVED (footer) | External trust/contact surface |

URL conventions (INFERRED): locale prefix `/ng/`; sport slug; `sr:category`
/ `sr:tournament` provider-mapping IDs; query `source=` attribution,
`time=` filter, `sort=` order; `activityId=` promo key. PROPOSED: our routes
use clean slugs with internal numeric IDs, never expose provider IDs.
