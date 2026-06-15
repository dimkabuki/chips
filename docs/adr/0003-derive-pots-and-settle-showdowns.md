# ADR 0003: Derive pots and settle showdowns atomically

- Status: Accepted
- Date: 2026-06-15
- Scope: Increment 3

## Context

Increment 3 adds player-initiated all-ins, incomplete raises, automatic runout,
side pots, split awards, bust detection, and game completion. Card identities
and hand evaluation remain outside the product, so the domain cannot determine
showdown winners itself.

## Decision

The betting engine exposes `allIn` as an explicit legal action whose target is
the actor's complete remaining stack. It classifies increases against the last
full-raise size. Only a full raise resets acted state and reopens raise rights;
an incomplete all-in increase changes the amount to call without reopening a
player who has already acted.

Pots are derived from immutable hand commitments at showdown. A unique unmatched
maximum is returned before tranche derivation. Folded commitments contribute to
pot amounts but folded participants are excluded from eligibility.

Showdown settlement is one atomic command covering every derived pot. The caller
supplies one or more eligible winner IDs per pot and may optionally supply exact
integer allocations. Without overrides, the domain splits equally and assigns
odd chips clockwise starting left of the button. The command validates all pots
before applying any award, clears commitments, updates player status, verifies
chip conservation, and completes the game when one stack remains positive.

## Consequences

- The application or operator remains authoritative for physical-card winner
  selection; the domain remains authoritative for eligibility and chips.
- Failed settlement cannot partially award pots.
- Pot state does not drift during betting because it is not incrementally
  mutated.
- The public hand model records derived pots and final awards as settlement
  evidence without introducing persistence or UI dependencies.

## Alternatives considered

### Let callers submit one aggregate allocation

Rejected because eligibility differs by pot and aggregate validation could
silently award side-pot chips to an ineligible player.

### Persist mutable pots throughout betting

Rejected because commitments are already the source of truth and a second
mutable accounting model would weaken conservation guarantees.
