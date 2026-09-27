# Reference Route Inventory (normalized, 21 Sept 2026)

This document preserves structural navigation findings while intentionally
normalizing third-party-specific paths, domains, identifiers and branding.

Legend: OBSERVED = interaction pattern rendered/confirmed. UNVERIFIED = a route or
link family was visible but its body was not fully confirmed.

| Normalized route / surface | Status | Structural behavior |
|---|---|---|
| `/` | OBSERVED | Sportsbook home: header, sports strip, quick links, center feed, right betslip, footer |
| `/sport/<sport>` | OBSERVED | Sport listing: competition tree, time tabs, market-column presets, event rows |
| `/sport/<sport>/today` | OBSERVED | Today filter |
| `/sport/<sport>?window=<period>&sort=<mode>` | OBSERVED | Time-window and sort filtering |
| `/sport/<sport>/<competition>` | OBSERVED | Competition/league listing |
| `/sport/live` | OBSERVED (partial) | Live betting surface with counters, clocks and score state |
| `/games` | OBSERVED | Games lobby with search, catalogue cards and player-count badges |
| `/virtuals` | UNVERIFIED | Scheduled virtuals entry |
| `/instant-virtuals` | OBSERVED (link) | Instant virtuals entry |
| `/jackpot` | UNVERIFIED | Jackpot entry |
| external livescore surface | OBSERVED | Calendar, filters, FT/HT/AP grid, pins, match-radar style visualization |
| `/results` | UNVERIFIED | Results surface |
| `/promotions` | OBSERVED | Promotions hub with categories and mixed dated/evergreen promos |
| `/promotions/<slug>` | OBSERVED (links) | Promotion detail family |
| `/account/loyalty` | UNVERIFIED | Loyalty surface |
| `/mobile` | UNVERIFIED | App-download surface |
| `/booking/load` | OBSERVED | Booking-code load surface |
| `/booking/hub` | OBSERVED | Booking-code discovery surface |
| `/account/reset-password` | OBSERVED | Password recovery |
| `/help/<topic>` | OBSERVED (links) | Help-centre article family |
| external operational-status surface | OBSERVED | Public system-status link |
| external social/support links | OBSERVED | Social channels and support/contact surface |

Observed route conventions were used only to understand navigation depth and
information architecture. BTE routes should use clean original slugs with internal
IDs and must not expose upstream provider identifiers.
