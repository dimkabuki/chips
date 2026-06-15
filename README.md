# Chips

Chips is a local-first poker chip calculator and game tracker for physical
no-limit Texas Hold'em games. One device acts as the table operator while the
application tracks stacks, bets, pots, turn order, streets, and settlement.

The product and technical design is documented in
[`docs/design.md`](docs/design.md).
Accepted implementation decisions are recorded in
[`docs/adr`](docs/adr).

## Status

Increment 2 provides the framework-independent single-pot hand engine:
positions, blinds, turn order, normal betting actions, street transitions, and
uncontested settlement.
