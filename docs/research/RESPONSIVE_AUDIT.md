# Responsive Reference Audit (21 Sept 2026)

## Measured desktop reference

- Viewport class around 1440×900 used a centered fixed-width container with no
  page-level horizontal scroll.
- A sticky right-side betslip occupied roughly a narrow sidebar.
- The main sportsbook content was arranged as navigation / event feed / slip.
- Event rows followed the common pattern: kickoff + ID | teams | primary prices |
  secondary market selector | additional-market count.
- Tab controls were reused across betting and listing contexts.

These observations are retained only as structural design input. BTE uses its own
component names, spacing, typography, colors and responsive implementation.

## Breakpoints required by BTE

| Viewport | Requirement |
|---|---|
| 1440×900 | Full desktop 3-region sportsbook shell |
| 1280×800, 1024×768 | Compact desktop/tablet reflow |
| 320/360/375/390/412/540 | Mobile-first single-column experience with no page overflow |

## Mobile structure requirements

- Bottom navigation for primary customer destinations.
- Betslip count remains visible and opens a mobile sheet.
- Header condenses substantially.
- Competition navigation leaves the main feed.
- Odds remain readable without page-level horizontal overflow.
- Core interactive targets are at least 44px high where practical.

## BTE design-system principles

- Desktop max-width container with navigation / feed / sticky slip regions.
- Mobile single-column feed with fixed bottom navigation and betslip sheet.
- League-grouped event feed and tabular numerals for odds/clocks.
- Explicit loading, empty, suspended, stale-price and error states.
- Original colors, radii, typography, icons and component implementation.

## Open measurements

Exact tablet reflow points, secondary-market horizontal-scroll behavior,
offline/reconnect affordances and some event-detail layouts remain subject to
BTE-specific product iteration.
