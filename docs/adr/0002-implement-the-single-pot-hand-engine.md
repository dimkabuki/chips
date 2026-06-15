# ADR 0002: Implement the Increment 2 single-pot hand engine

- Status: Accepted
- Date: 2026-06-15
- Scope: Increment 2

## Context

Increment 2 requires positions, blinds, turn order, street transitions, normal
betting actions, and uncontested settlement. Increment 3 owns all-in behavior,
raise-right reopening, side pots, and showdown allocation.

The domain must remain framework-independent and preserve the immutable command
boundary established by ADR 0001.

## Decision

Add a hand state to `Game` and expose pure domain commands to:

- start a hand using caller-provided hand IDs;
- calculate legal actions and numeric bounds for the current actor;
- apply fold, check, call, bet, and raise actions;
- confirm explicit flop, turn, and river prompts;
- enter a showdown boundary after river betting;
- settle an uncontested pot automatically.

The engine owns legal-action calculation. Action amounts are target street
commitments. Accepted commands return a new game state and run invariant
validation before returning success.

All-in player actions and calls are deliberately excluded from legal actions in
this increment. A blind may still consume a short stack because blind posting is
mandatory, but automated runout and all-in settlement remain Increment 3.

## Consequences

- A hand with no all-ins can advance from blind posting to showdown or complete
  through uncontested settlement.
- The presentation layer must use `getLegalActions` rather than reproduce
  betting rules.
- Showdown is an explicit domain boundary but cannot yet be allocated.
- The hand model can grow in Increment 3 without adding persistence or UI
  dependencies.

## Alternatives considered

### Include single-pot showdown allocation

Rejected because showdown allocation, split pots, and odd chips are one
cohesive settlement concern assigned to Increment 3.

### Represent commands as mutable methods

Rejected because it would weaken the immutable boundary and make failed-command
state preservation harder to verify.
