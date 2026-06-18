# ADR 0004: Persist one active game and recover operator state

- Status: Accepted
- Date: 2026-06-17
- Scope: Increment 4

## Context

Increment 4 adds local recovery, stale-write protection, corruption handling,
operator undo, and stack correction without adding UI, remote sync, or multiple
saved games. The domain remains authoritative for poker state transitions and
must not depend on browser storage.

## Decision

Add an application-level `GameRepository` port for a single active game. The
persistence envelope stores `schemaVersion`, monotonically increasing
`revision`, ISO `savedAt`, checksum, and the domain `game`. Saves require the
caller's expected revision; stale writers receive a conflict instead of
replacement.

Use a pure parse, migration, checksum, and invariant-validation pipeline before
returning loaded state. Any parse, checksum, migration, or invariant failure
fails closed and returns no partial game. The current migration set retains only
schema version 1 and rejects unknown versions.

Provide an IndexedDB adapter behind the repository port. IndexedDB types are
contained in the infrastructure adapter and do not appear in domain code.

Keep undo orchestration in the application session. Accepted player betting
actions and confirmed street transitions snapshot the prior domain state, capped
at three entries. New hands, settlement, destructive reset, and stack correction
clear undo. Undo restores the exact prior domain state and appends an audit
entry.

Implement stack correction as a domain command because it must preserve chip
conservation across stacks plus active commitments and validate against domain
invariants. Commitments, fold/all-in/turn/street state, and hand flow are not
editable. The command requires a short reason and records before/after audit
data.

## Consequences

- Persistence and recovery can be tested without a browser via the repository
  port and in-memory adapter.
- Browser storage behavior is isolated to the IndexedDB adapter.
- Corrupted or invalid chip balances are never repaired silently.
- Undo is an application concern and does not make settlement reversible.
- Future incompatible persistence schemas require explicit pure migrations
  before being accepted by the loader.
