# ADR 0005: Keep the operator shell at the application boundary

- Status: Accepted
- Date: 2026-06-18
- Scope: Increment 5

## Context

Increment 5 introduces a runnable browser shell for setup, recovery, reset, and
active-game summary. The existing domain and application layers already own game
creation, validation, invariants, persistence envelopes, checksums, and the
single active-game repository seam.

## Decision

Build the UI as a thin vanilla TypeScript adapter over `GameSession` and the
`GameRepository` port. The setup screen converts form state into the existing
`createGame` command shape, renders domain validation issues and warnings, and
persists only by calling `GameSession.replace`. Startup recovery calls
`GameSession.load`; failed parse, checksum, migration, or invariant checks render
a fail-closed reset screen, and only an explicitly confirmed reset calls the
application reset boundary.

The browser IndexedDB implementation remains in infrastructure. DOM and browser
storage types do not enter the domain model or commands.

## Consequences

- The UI does not duplicate poker rules or persistence recovery semantics.
- Component-style tests can exercise setup, reload, corrupt recovery, reset, and
  replacement confirmation through the application seam without IndexedDB.
- The shell is runnable with Vite while the domain remains framework-independent.
- Future betting and settlement controls must continue to ask domain/application
  APIs for legality and state transitions rather than reconstructing rules in
  presentation code.
