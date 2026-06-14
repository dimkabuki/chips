# ADR 0001: Establish the Increment 1 domain foundation

- Status: Accepted
- Date: 2026-06-14
- Scope: Increment 1

## Context

Increment 1 requires validated game creation and conserved chip supply without
committing the domain to a UI, persistence mechanism, or deployment platform.
The repository previously contained only the product and technical design.

The foundation must make domain behavior cheap to specify and verify while
leaving hand lifecycle details for later increments.

## Decision

Use a single strict TypeScript project with:

- Vitest for domain unit tests;
- ESLint with type-aware TypeScript rules;
- a declaration-only TypeScript build as the initial build boundary;
- framework-independent domain code under `src/domain`;
- immutable, readonly domain state at the public boundary;
- command results represented as a discriminated success/error union;
- structured validation issue codes, with non-blocking setup warnings kept
  separate from errors;
- invariant validation executed before a newly created game is returned.

The game-creation command accepts caller-provided game and player IDs. ID
generation belongs outside the domain command so tests remain deterministic and
the domain does not depend on browser or framework APIs.

Only setup state needed by Increment 1 is modeled. Hand, audit, persistence, and
UI behavior remain outside this decision until their delivery increments.

## Consequences

- Domain tests run without React, IndexedDB, or browser emulation.
- Application and UI layers must translate structured issues into operator
  messages rather than parsing message text.
- Callers are responsible for generating unique IDs before creating a game.
- Declaration builds provide an early API/type check but do not yet produce a
  runnable application.
- Domain types will grow incrementally; this ADR does not freeze the initial
  `Game` shape as a long-term compatibility contract.

## Alternatives considered

### Scaffold React and Vite now

Rejected for Increment 1 because no UI is required and framework setup would
increase the change surface without validating more domain behavior.

### Use exceptions for expected setup errors

Rejected because invalid operator input is an expected command outcome and
callers need stable, field-oriented error codes.

### Generate IDs inside the domain

Rejected because it introduces an unnecessary side effect or injectable
abstraction before any current requirement needs one.
