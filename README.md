# Chips

Chips is a local-first poker chip calculator and game tracker for physical
no-limit Texas Hold'em games. One device acts as the table operator while the
application tracks stacks, bets, pots, turn order, streets, and settlement.

The product and technical design is documented in
[`docs/design.md`](docs/design.md).
Accepted implementation decisions are recorded in
[`docs/adr`](docs/adr).

## Status

Implemented through the operator hand and betting shell:

- framework-independent domain engine for setup, blinds, turn order, betting,
  street transitions, all-ins, side pots, showdown settlement, uncontested
  settlement, bust detection, game completion, undo snapshots, and stack
  correction;
- application session and one-active-game repository boundary for persistence,
  recovery, revision conflicts, reset, undo orchestration, showdown settlement,
  and stack correction;
- browser shell for setup, local recovery, corrupt-record reset, active-game
  summary, hand start, current-hand verification, legal betting controls, and
  explicit street-transition confirmation.

The UI intentionally still delegates poker legality and persistence semantics to
the domain/application seams. Browser storage remains isolated to the IndexedDB
adapter.

## Remaining work plan

### 1. Complete the operator hand lifecycle UI

- Add showdown settlement controls that derive/display each pot, list only
  eligible winners, support split winners and manual allocation overrides, call
  `GameSession.settleShowdown`, and preserve UI state on rejected commands.
- Add settled-hand and completed-game result views, including the final winner
  state when one player owns the chip supply.
- Extend component tests to cover normal showdown, side-pot settlement,
  invalid settlement rejection, game completion, and reload at showdown and
  settled boundaries.

### 2. Add operator recovery tools

- Add undo UI for the latest reversible betting/street actions, including the
  action being reverted, explicit confirmation, persistence, and error display.
- Add stack-correction UI with read-only commitments, editable stacks, total
  conservation preview, required reason, audit visibility, and persistence.
- Cover undo and correction with component tests plus application regression
  tests where a UI path exposes a new boundary condition.

### 3. Harden the browser operator experience

- Improve responsive layout for mobile/tablet/desktop, including the documented
  320 px viewport target.
- Verify keyboard-only operation and accessible labels/status regions for setup,
  action controls, settlement, undo, and correction flows.
- Add browser-level smoke coverage for create/recover, complete hand, side-pot
  settlement, undo, correction, game completion, and reload during betting,
  deal prompt, showdown, and settled states.

### 4. Ship PWA and GitHub Pages deployment

- Add web app manifest, icons, production base-path handling, static asset
  caching, and service worker registration scoped to the GitHub Pages deployment.
- Add GitHub Actions deployment for the static build.
- Verify installability, offline startup after first load, interrupted-session
  recovery, and local game restoration on the same browser profile.

### 5. Documentation cleanup

- Keep `README.md`, `docs/design.md`, and ADRs aligned when increment numbering
  or scope decisions change.
- Record a new ADR only for material boundary decisions, not for routine UI
  completion over existing domain/application APIs.
