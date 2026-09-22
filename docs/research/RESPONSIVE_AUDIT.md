# Responsive Audit (21 Sept 2026)

## Measured (OBSERVED, desktop 1440×900)

- Viewport 1440 → body scrollWidth 1425: centered fixed container, no page
  horizontal scroll.
- Right betslip module `.m-betslip-wrapper`: 235 × 370 px at x ≈ 977.5.
- Content columns probed ≈ 553 px wide (three similar content blocks).
- Event row: kickoff + ID | teams | 3 price cells | O/U line selector | +N.
- Tabs component class `tabs-v2` reused (slip tabs, listing view presets).

## Breakpoints required by mission vs evidence

| Viewport | Evidence |
|---|---|
| 1440×900 | OBSERVED live (snapshots + screenshots on disk) |
| 1280×800, 1024×768 | NOT re-verified this pass (prior files `1440-*` only; no 1280/1024 shots) → OPEN |
| 320/360/375/390/412/540 | Prior mobile screenshots exist on disk (`mobile-390-home.png` etc.) but this model cannot view images; live re-audit stalled on browser contention → structural mobile claims below are INFERRED from DOM evidence + prior-pass notes, NOT freshly observed |

## Mobile structure (INFERRED, to re-verify)

- Bottom tab bar with sports/home/games/open-bets/account entries; floating
  betslip pill with count badge; header condenses to logo + search + auth;
  left tree becomes drawer/A–Z menu; odds grid keeps 3-cell row with horizontal
  preset scrolling. Touch targets required ≥44px (PROPOSED, WCAG) — not measured.

## Design-system principles (PROPOSED, derived from observed patterns)

- Fixed container max-width ≈ 1425; 3-region desktop (nav / feed / slip),
  slip rail ≈ 235–300px sticky; single-column mobile with bottom nav +
  floating slip; league-grouped feed; tabular numerals for prices/clocks;
  skeleton rows for feed loading; empty-slip illustration + CTA; toast for
  price changes; icon-font action glyphs. Do NOT copy exact colors/radii/type.

## Open measurements (OPEN_QUESTIONS.md)

1280/1024 reflow point, 320–540 touch-target sizes, sticky offsets, odds-cell
px sizes, horizontal-scroll rules for market presets, offline banner.
Screenshots on disk: `/tmp/opencode/reference-audit/*.png` (14 files, 6.3 MB).
