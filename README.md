# Chips

Chips is a local-first poker chip calculator and game tracker for physical no-limit Texas Hold'em games. One device acts as the table operator while the application tracks stacks, bets, pots, turn order, streets, settlement, undo, and audited stack correction.

The product and technical design is documented in [`docs/design.md`](docs/design.md). Accepted implementation decisions are recorded in [`docs/adr`](docs/adr).

## Status

v1 development is complete for the single-device static application:

- framework-independent domain engine for setup, blinds, turn order, betting, street transitions, all-ins, side pots, showdown settlement, uncontested settlement, bust detection, game completion, stack correction, and invariants;
- application session and one-active-game repository boundary for persistence, recovery, revision conflicts, reset, undo orchestration with 3 persisted snapshots, showdown settlement, and stack correction;
- React browser shell for setup, local recovery, corrupt-record reset, active-game summary, hand start, current-hand verification, legal betting controls, explicit street-transition confirmation, showdown settlement, settled-hand results, completed-game results, confirmed undo, stack-correction preview, and compact audit visibility;
- static PWA shell with manifest icon, scoped service-worker registration, GitHub Pages base-path support, restrictive CSP, and GitHub Pages deployment workflow;
- automated coverage for domain/application behavior, UI characterization, static build validation, and a Playwright browser smoke path for production-build load, recovery, undo, stack correction, 320 px viewport, accessible names, and offline startup.

The UI intentionally delegates poker legality, settlement, persistence, undo, and correction semantics to domain/application seams. Browser storage remains isolated to the IndexedDB adapter.

## Release checklist

Before publishing a release:

- run `npm test`, `npm run build`, `npm run lint`, `npm run smoke:static`, and `npm run smoke:browser`;
- ensure Playwright's Chromium browser is available in the runner (`npx playwright install chromium` if the environment does not preinstall it);
- build GitHub Pages with `GITHUB_REPOSITORY_NAME` or `BASE_PATH` set when deploying under a project path;
- manually verify installability on the target mobile browser and confirm local data recovery after closing and reopening the installed PWA.

## Scripts

- `npm test` - Vitest domain, application, and UI characterization suite.
- `npm run build` - TypeScript build plus Vite production build.
- `npm run lint` - ESLint.
- `npm run smoke:static` - validates production static artifacts, CSP, manifest icon, and service-worker scope awareness.
- `npm run smoke:browser` - launches the production build with Playwright and exercises the critical operator path.
