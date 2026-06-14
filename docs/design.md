# Chips - Product and Technical Design

Status: Proposed
Date: 2026-06-14

## 1. Summary

Chips replaces physical poker chips while players continue to use physical
cards. A single table operator uses one phone, tablet, or desktop browser to
record actions during a no-limit Texas Hold'em game.

The application:

- configures a game for 2 to 8 players;
- tracks dealer position, blinds, stacks, commitments, legal actions, pots,
  side pots, streets, and hand results;
- persists one active game on the current browser and device;
- restores the game after reload, browser closure, or application restart;
- supports undoing up to the last 3 actions and controlled stack correction;
- ends when one active player owns the complete chip supply.

The application does not model cards, evaluate hands, provide accounts, or
synchronize between devices.

## 2. Product decisions

| Area | Decision |
| --- | --- |
| Variant | No-limit Texas Hold'em cash-style game |
| Players | 2 to 8 |
| Blinds | Fixed for the game; no schedule and no ante in v1 |
| Default stack | 1,000 |
| Default small blind | 5 |
| Default big blind | 10 |
| Persistence | Local to one browser profile on one device |
| Recovery code | None |
| Offline behavior | Installable, offline-capable PWA after first load |
| Hosting | Static deployment to GitHub Pages |
| Undo | Up to the latest 3 recorded actions |
| Correction | Explicit stack-edit workflow with validation and audit entry |
| All-ins | Supported, including main and side pots |
| Settlement | One or more eligible winners per pot |
| Folded players | Never eligible to receive a pot |
| Active games | One at a time |

## 3. Scope

### 3.1 In scope for v1

- Responsive operator experience for mobile, tablet, and desktop.
- Game setup with defaults and validation.
- Eight predefined, visually distinct avatar color choices.
- Complete hand flow:
  - dealer rotation;
  - blinds;
  - pre-flop;
  - flop prompt and betting;
  - turn prompt and betting;
  - river prompt and betting;
  - showdown or uncontested settlement.
- Legal fold, check, call, bet, raise, and all-in actions.
- Minimum-bet and minimum-raise enforcement.
- Heads-up position and blind rules.
- Main-pot and side-pot construction.
- Split-pot settlement and configurable winner allocations.
- Automatic uncontested-pot settlement.
- Bust-player exclusion from future hands.
- Final-game winner detection.
- Local persistence, migration, corruption handling, reset, undo, and stack
  correction.

### 3.2 Out of scope for v1

- User accounts, authentication, recovery codes, or cloud backup.
- Cross-browser or cross-device synchronization.
- Multiple concurrent or archived games.
- Tournament blind schedules, antes, rebuys, or add-ons.
- Limit or pot-limit variants.
- Card entry, hand evaluation, equity calculation, or strategy advice.
- Remote player controls.
- Monetary accounting. All quantities are integer chips without currency.

## 4. User model and operating assumptions

One trusted operator records actions for the table. The device is passed around
or kept by one player. The application is authoritative for virtual chip
balances, while physical cards and verbal declarations remain authoritative for
play.

Local persistence works on modern mobile browsers, subject to operating-system
storage policies. Installed PWA mode improves the launch experience but does not
make local data portable or immune to browser-data deletion, private browsing
cleanup, device loss, or storage eviction.

GitHub Pages can host the application because the v1 architecture is entirely
static and client-side. Deployment must account for the repository base path,
use client-side routing compatible with static hosting, and publish HTTPS assets
including the web app manifest and service worker. Hash routing is the simplest
option; a single-screen state-driven application may need no URL router.

## 5. Core terminology

- **Game**: Configuration, players, conserved chip supply, and a sequence of
  hands.
- **Hand**: Play from posting blinds through settlement.
- **Street**: Pre-flop, flop, turn, or river betting round.
- **Stack**: Chips available to a player outside current commitments.
- **Street commitment**: Chips committed by a player during the current street.
- **Hand commitment**: Total chips committed by a player during the hand.
- **Current bet**: Highest street commitment that an actionable player must
  match.
- **Full raise**: A raise at least as large as the previous full bet or raise.
- **Pot**: A settlement tranche with an amount and an eligible-player set.
- **Actionable player**: Active in the hand, not folded, and not all-in.
- **Active player**: Has a positive stack and participates in new hands.
- **Button**: Dealer position for the hand.

## 6. Functional requirements

### 6.1 Game setup

The setup screen must:

1. Accept 2 to 8 uniquely named players.
2. Assign each player one of 8 predefined avatar colors. Colors should be unique
   where possible, but identity must also be conveyed by name and position.
3. Default every starting stack to 1,000.
4. Default blinds to 5/10.
5. Require positive integer stacks and blinds.
6. Require `smallBlind < bigBlind`.
7. Warn, but do not reject, configurations where a starting stack is smaller
   than the big blind.
8. Display the computed total chip supply before confirmation.
9. Choose the initial dealer explicitly or randomly.
10. Require confirmation before replacing an existing game.

Player order is clockwise and is retained throughout the game. Bust players
remain seated and visible but are skipped for dealing and action.

### 6.2 New hand

Starting a hand must:

1. Include every player with a positive stack.
2. Move the dealer button clockwise to the next active player, except for the
   first hand where the configured initial dealer is used.
3. Assign blinds according to standard rules:
   - with 3 or more players, small blind is left of the button and big blind is
     left of the small blind;
   - heads-up, the button posts the small blind and acts first pre-flop; the big
     blind acts first post-flop.
4. Post each blind up to the player's available stack. A short blind is all-in.
5. Set the first pre-flop actor to the first actionable player clockwise after
   the big blind, except heads-up where the button acts first.

### 6.3 Betting actions

For the current actor, the engine returns legal actions and numeric bounds. The
UI must not reconstruct legality independently.

- **Fold**: legal when the player has not folded or gone all-in.
- **Check**: legal when the player's street commitment equals the current bet.
- **Call**: legal when facing a bet, for `min(call amount, stack)`. A short call
  is all-in.
- **Bet**: legal when the current bet is zero. Minimum is the big blind; maximum
  is the player's stack.
- **Raise**: legal when facing a bet and the player has enough chips to increase
  it. A full raise must increase the current bet by at least the last full-raise
  size.
- **All-in**: legal whenever the player has chips. It may be a call, full raise,
  or incomplete raise.

The amount control represents the player's target total street commitment, not
the incremental chips added. The UI displays both the target and the incremental
cost.

An incomplete all-in raise increases the amount to call but does not reopen
raising for a player who has already acted since the latest full raise. The
domain engine tracks whether each player retains raise rights.

After every action, the engine:

1. moves chips from stack to commitments;
2. records an immutable action entry;
3. checks for an uncontested winner;
4. determines whether the betting round is complete;
5. selects the next actionable player or emits the next required transition.

### 6.4 Betting-round completion

A betting round is complete when:

- every non-folded, non-all-in player has acted since the latest full raise; and
- every such player has matched the current bet.

If at most one player can still act and all unmatched commitments can only be
resolved by that player checking or calling, normal legal-action rules remain
in force. The system must not skip a required decision.

When no further betting is possible because all remaining players are all-in,
the app advances through undealt street prompts without requesting actions and
then opens showdown settlement.

### 6.5 Street transitions

At completion of pre-flop, flop, and turn betting, show an explicit operator
prompt:

- "Deal the flop"
- "Deal the turn"
- "Deal the river"

No card identities are entered. Confirmation resets street commitments, sets
the current bet to zero, resets the minimum opening bet to the big blind, and
selects the first actionable player clockwise after the button.

At completion of river betting, enter showdown.

### 6.6 Pots and eligibility

Pots are derived from hand commitments rather than incrementally maintained as
mutable balances. For every distinct positive commitment threshold:

1. take the difference from the previous threshold;
2. multiply it by the number of players whose commitment reaches that
   threshold;
3. create a pot tranche for that amount;
4. mark non-folded players reaching that threshold as eligible.

Folded commitments remain in pot amounts but folded players are excluded from
eligibility.

Uncalled excess above every opponent's maximum matched contribution must be
returned to the contributing player's stack before settlement.

### 6.7 Hand settlement

If only one non-folded player remains, all committed chips are awarded
automatically to that player and no showdown dialog appears.

At showdown:

1. Present each pot separately, from main pot to outermost side pot.
2. List only that pot's eligible players.
3. Allow one or more winners.
4. Default to equal integer allocation among selected winners.
5. Assign indivisible odd chips one at a time to selected winners in clockwise
   order starting left of the button.
6. Allow manual integer allocation overrides.
7. Require every allocation to be non-negative, assigned to an eligible
   selected winner, and sum exactly to the pot amount.
8. Require all pots to be valid before confirming settlement.

Settlement applies all awards atomically, clears commitments, records the hand
result, and verifies chip conservation.

### 6.8 Bust and game completion

After settlement, a player with a zero stack is marked inactive. Inactive
players stay visible in standings but cannot receive the button, post blinds,
or act in later hands.

When exactly one player has a positive stack, show the final winner dialog. The
completed game remains viewable until the operator starts a new game or resets
it.

### 6.9 Undo

The active hand retains reversible snapshots for the latest 3 operator actions.
An action includes a player betting action or a confirmed street transition.
Settlement confirmation is not a normal undo boundary because it changes the
hand lifecycle; reopening a settled hand is out of scope for v1.

Undo must:

- show the action to be reverted;
- require confirmation;
- restore the exact prior domain state;
- append an audit entry describing the undo;
- persist the restored state atomically.

Starting a new hand clears the undo history.

### 6.10 Stack correction

Stack correction is an exceptional operator workflow, not a betting action.

To preserve the game's total chip supply, the editor displays every player's
stack and requires the edited total of:

`all stacks + all current hand commitments`

to equal the configured chip supply. During an active hand, commitments are
read-only; only stacks can be edited. Corrections cannot change fold, all-in,
turn, or street state.

The operator must enter a short reason. Confirmation records before and after
values and clears the 3-action undo history so an old snapshot cannot overwrite
the corrected balances.

### 6.11 Reset

Reset permanently deletes the local game, action history, and settings after a
destructive confirmation. The UI must state that data cannot be recovered.

## 7. User experience

### 7.1 Primary screens

1. **Launch**
   - Resume active game.
   - Start game when no game exists.
   - Reset from a secondary destructive action.
2. **Setup**
   - Player rows, avatar colors, stacks, blinds, dealer selection, and total.
3. **Table**
   - Elliptical table representation with seats arranged in configured order.
   - Each seat shows name, avatar, stack, current commitment, and status.
   - Button, small blind, big blind, current actor, street, pots, amount to
     call, and minimum raise are visually explicit.
   - A single action panel shows only engine-provided legal actions.
4. **Deal prompt**
   - Blocking confirmation between streets.
5. **Showdown**
   - Pot-by-pot winner selection and allocation.
6. **Hand result**
   - Awards, resulting stacks, busted players, and next-hand action.
7. **Game result**
   - Winner and final standings.
8. **Correction**
   - Conserved-total stack editor with reason and audit summary.

### 7.2 Mobile requirements

- Support viewport widths from 320 px without horizontal page scrolling.
- Keep the current actor and legal actions visible without requiring the
  operator to inspect every seat.
- Use touch targets of at least 44 x 44 CSS px.
- Do not depend on hover, color alone, or precise drag gestures.
- Keep amount entry usable with a numeric keypad and explicit min/max values.
- Prevent display sleep only if a future browser capability is deliberately
  adopted; v1 must not depend on it.

### 7.3 Accessibility

- Meet WCAG 2.2 AA contrast and interaction requirements where applicable.
- Give every color avatar a text label and stable seat identity.
- Announce actor, street, pot, and action changes through an ARIA live region.
- Preserve logical keyboard order and visible focus.
- Require confirmation for destructive and irreversible operations.
- Respect reduced-motion preferences.

## 8. Domain model

The domain package has no dependency on React, browser storage, service workers,
or transport code.

```text
Game
  id
  schemaVersion
  status: active | completed
  settings: smallBlind, bigBlind
  chipSupply
  players[]
  dealerPlayerId
  handNumber
  currentHand?
  completedHands[]
  auditLog[]

Player
  id
  seat
  name
  avatar
  stack
  status: active | busted

Hand
  id
  number
  status: betting | dealPrompt | showdown | settled
  street: preflop | flop | turn | river
  buttonPlayerId
  smallBlindPlayerId
  bigBlindPlayerId
  actorPlayerId?
  currentBet
  lastFullRaiseSize
  participants[]
  actions[]
  undoSnapshots[]
  pendingTransition?

HandParticipant
  playerId
  stackAtStart
  streetCommitment
  handCommitment
  folded
  allIn
  actedSinceFullRaise
  raiseReopened

Pot
  amount
  eligiblePlayerIds[]

Action
  sequence
  playerId
  type
  targetStreetCommitment
  chipsAdded
  resultingStack
  occurredAt
```

Commands return either a new valid state plus emitted domain events, or a
structured validation error. State is treated as immutable at the domain
boundary.

## 9. State machine

```text
NoGame
  -> GameSetup
  -> Hand.PreflopBetting

Hand.PreflopBetting
  -> Hand.DealFlopPrompt
  -> Hand.UncontestedSettlement

Hand.DealFlopPrompt
  -> Hand.FlopBetting

Hand.FlopBetting
  -> Hand.DealTurnPrompt
  -> Hand.UncontestedSettlement

Hand.DealTurnPrompt
  -> Hand.TurnBetting

Hand.TurnBetting
  -> Hand.DealRiverPrompt
  -> Hand.UncontestedSettlement

Hand.DealRiverPrompt
  -> Hand.RiverBetting

Hand.RiverBetting
  -> Hand.Showdown
  -> Hand.UncontestedSettlement

Hand.Showdown
  -> Hand.Settled

Hand.Settled
  -> NextHand.PreflopBetting
  -> Game.Completed
```

Every transition is performed by a domain command and followed by durable
persistence before the UI reports success.

## 10. Invariants

The engine must enforce these invariants after every command:

1. All chip values are non-negative integers.
2. Player IDs and seats are unique.
3. The actor, if present, is an actionable participant.
4. A folded player cannot act or win a pot.
5. An all-in player cannot act.
6. Street commitment is less than or equal to hand commitment.
7. Every commitment increase equals the corresponding stack decrease.
8. `sum(stacks) + sum(hand commitments) = chipSupply` during a hand.
9. `sum(stacks) = chipSupply` outside an unsettled hand.
10. Pot amounts equal committed chips after any uncalled excess is returned.
11. Settlement awards equal total pot amounts.
12. Each pot award goes only to a player eligible for that pot.
13. At most one game and one hand are active.
14. A completed game has exactly one player with a positive stack.

A failed invariant rejects the command and leaves persisted state unchanged.

## 11. Persistence and recovery

### 11.1 Storage

Use IndexedDB through a small persistence adapter. Do not expose IndexedDB types
to the domain. Local storage may hold only non-authoritative UI preferences.

Persist one envelope:

```text
PersistedGameEnvelope
  schemaVersion
  revision
  savedAt
  checksum
  game
```

The repository interface:

```text
load(): PersistedGameEnvelope | null
save(expectedRevision, game): newRevision
delete(): void
```

Every accepted command is saved before rendering it as committed. Revision
comparison prevents stale in-memory state from silently overwriting a newer
tab. If another tab changes the revision, block further input and require a
reload; real-time multi-tab coordination is out of scope.

### 11.2 Migration

- Persist an explicit schema version.
- Apply ordered, pure migrations before domain hydration.
- Validate the migrated result against the current schema and invariants.
- Retain the original record until the migrated record is written
  successfully.

### 11.3 Corruption handling

If parsing, checksum, migration, or invariant validation fails:

- do not partially load the game;
- show a recovery screen with diagnostic code and save timestamp;
- permit exporting the raw record for support;
- permit destructive reset after confirmation.

Automatic invention or repair of chip balances is forbidden.

### 11.4 Service worker

The service worker caches only the application shell and static assets. Game
state remains in IndexedDB. Updates should activate after the current session
reloads rather than replacing application code during an action.

## 12. Architecture

Recommended stack:

- TypeScript with strict compiler settings;
- React for the presentation layer;
- Vite for development and static builds;
- Vitest for unit and component tests;
- Testing Library for interaction tests;
- Playwright for critical browser flows;
- IndexedDB persistence adapter;
- a standards-based PWA manifest and service worker integration.

Proposed dependency direction:

```text
apps/web UI
  -> application use cases
    -> domain

apps/web IndexedDB adapter
  -> application repository port

domain
  -> no framework or browser dependencies
```

Suggested initial layout:

```text
src/
  domain/
    game/
    hand/
    betting/
    settlement/
  application/
    commands/
    ports/
  infrastructure/
    persistence/
    pwa/
  ui/
    setup/
    table/
    settlement/
    shared/
tests/
  e2e/
```

This can remain one deployable application. Separate packages or a monorepo are
not justified for v1.

## 13. Security and privacy

- No personal data is required beyond player-entered display names.
- No analytics, remote API, or third-party persistence is required.
- Render names as text, never as HTML.
- Apply a restrictive content security policy compatible with the static build.
- Register the service worker only under the GitHub Pages deployment scope.
- Treat local game data as available to anyone with access to the unlocked
  device/browser profile.
- State clearly that clearing site data deletes the game.

The absence of a backend reduces attack surface but is not an authentication or
backup mechanism.

## 14. Testing strategy

Development starts with domain tests. Each behavior should be introduced by a
failing test before implementation where practical.

### 14.1 Domain unit tests

- setup validation and chip supply;
- button and blind rotation for 2 to 8 seats with busted-seat skipping;
- short blind all-ins;
- legal action calculation for every betting state;
- minimum full raises and incomplete all-in raises;
- raise-right reopening;
- betting-round completion;
- automatic street runout when nobody can act;
- uncontested settlement;
- main and multiple side pots;
- folded dead money;
- uncalled excess returns;
- split pots and odd-chip order;
- settlement validation;
- bust and game completion;
- undo snapshots and stack correction;
- invariant/property tests for chip conservation.

### 14.2 Persistence tests

- round-trip every supported state;
- revision conflict;
- reload after each command type;
- migration from every retained schema version;
- corrupted and truncated records;
- interrupted migration;
- reset.

### 14.3 UI and end-to-end tests

- create and restore a game;
- complete a normal multi-street hand;
- fold to an uncontested winner;
- settle multiple side pots;
- undo each supported boundary;
- correct stacks while preserving total;
- finish a game;
- reload at setup, betting, deal prompt, showdown, and settled states;
- operate at a 320 px viewport and with keyboard-only input;
- install/build under the configured GitHub Pages base path.

## 15. Delivery plan

### Increment 1 - Domain skeleton

- Establish TypeScript, test, lint, and build tooling.
- Implement setup, players, chip values, and invariants.
- Deliver no UI beyond a minimal test harness.

Exit criterion: validated game creation and conserved chip supply.

### Increment 2 - Single-pot hand engine

- Implement positions, blinds, turn order, streets, actions, and uncontested
  settlement.
- Cover heads-up and normal table behavior.

Exit criterion: a hand without all-ins can run entirely through domain commands.

### Increment 3 - All-ins and settlement

- Implement raise reopening, uncalled excess, side pots, showdown allocation,
  split pots, and odd chips.

Exit criterion: representative multi-way all-in scenarios conserve all chips.

### Increment 4 - Persistence and recovery

- Add IndexedDB adapter, revision checks, schema envelope, migrations, reset,
  undo, and stack correction.

Exit criterion: reload at every hand state produces equivalent legal actions.

### Increment 5 - Operator UI

- Build setup, table, action panel, street prompts, settlement, results, and
  correction screens.

Exit criterion: complete game flow works at mobile and desktop viewports.

### Increment 6 - PWA and GitHub Pages

- Add manifest, static asset caching, offline startup, production base path, and
  GitHub Actions deployment.
- Run accessibility, browser, and interrupted-session checks.

Exit criterion: the published GitHub Pages application installs, reloads
offline, and restores its local game on the same device/browser.

## 16. Acceptance scenarios

### Scenario A - Normal hand

Given 4 players with 1,000 chips and blinds 5/10, when all streets complete and
one showdown winner is selected, then the winner receives the complete pot,
every commitment is cleared, stacks total 4,000, and the button advances for the
next hand.

### Scenario B - Uncontested pot

Given a raised pot, when every player except one folds, then the remaining
player receives all commitments automatically and no winner selection is shown.

### Scenario C - Side pots

Given players committing 100, 300, and 500 chips, then the engine returns a
300-chip main pot eligible to all 3, a 400-chip side pot eligible to the latter
2, and returns the unmatched 200-chip excess to the largest contributor.

### Scenario D - Incomplete all-in raise

Given a current bet of 100 and a last full raise size of 50, when an all-in
player raises the current bet to 120, then other players must respond to 120 but
a player who already acted does not regain raise rights solely because of that
20-chip increase.

### Scenario E - Restore

Given an action was accepted and persisted, when the browser closes and the same
site is reopened on the same browser profile, then the exact actor, legal
actions, stacks, commitments, street, and 3-action undo history are restored.

### Scenario F - Correction

Given stacks and commitments total the configured chip supply, when the operator
edits stacks to another distribution with the same total and supplies a reason,
then the correction is accepted, audited, persisted, and old undo snapshots are
discarded.

### Scenario G - Game completion

Given only 2 active players remain, when settlement leaves one at zero and the
other holding the chip supply, then the game becomes completed and identifies
the latter as the final winner.

## 17. Deferred decisions

These are intentionally deferred until evidence justifies expanding scope:

- export/import for manual backup or device transfer;
- hand-history export;
- localization;
- optional wake lock;
- configurable avatar artwork beyond the initial color set;
- multiple saved games;
- tournament mode, antes, and blind schedules;
- cloud synchronization.

No deferred item should influence the initial domain API unless required by a
current invariant or acceptance scenario.
