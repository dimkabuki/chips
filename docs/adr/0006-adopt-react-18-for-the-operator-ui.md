# ADR 0006: Adopt React 18 for the operator UI

- Status: Accepted
- Date: 2026-06-18
- Scope: Operator UI architecture
- Supersedes: [ADR 0005](0005-keep-operator-shell-at-the-application-boundary.md)

## Context

The operator UI has grown beyond the initial setup and betting shell. Showdown
settlement drafts, undo, stack correction, accessibility hardening, and PWA
hardening need clearer state and component boundaries than the vanilla TypeScript
shell provides without brittleness.

## Decision

Adopt React 18 for the operator UI. The app remains client-side only and does
not use server components.

The domain and application seams are unchanged. React components must call
existing domain and application APIs, including `GameSession` commands,
`getLegalActions`, and `derivePots`, rather than reimplementing poker legality or
persistence semantics in presentation code.

## Consequences

- React is allowed in `src/ui`.
- Domain, application, and infrastructure persistence code stay
  framework-independent.
- Existing UI tests remain characterization coverage for the migration and future
  UI refactors.
- UI structure can evolve toward component boundaries for settlement drafts,
  undo, correction, accessibility, and PWA hardening without changing domain
  ownership.
