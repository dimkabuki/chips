import { describe, expect, it } from "vitest";

import { AVATARS, createGame, type CreatePlayerInput } from "../../../src/domain/game/create-game.js";
import {
  act,
  derivePots,
  getLegalActions,
  settleShowdown,
  startHand,
} from "../../../src/domain/game/hand-engine.js";
import type { Game } from "../../../src/domain/game/game.js";

const create = (stacks: readonly number[], dealerPlayerId = "player-1"): Game => {
  const players: CreatePlayerInput[] = stacks.map((stack, index) => ({
    id: `player-${String(index + 1)}`,
    name: `Player ${String(index + 1)}`,
    avatar: AVATARS[index % AVATARS.length] ?? AVATARS[0],
    stack,
  }));
  const result = createGame({
    id: "game-1",
    smallBlind: 5,
    bigBlind: 10,
    initialDealerPlayerId: dealerPlayerId,
    players,
  });
  if (!result.ok) throw new Error("Invalid fixture");
  const started = startHand(result.value, { handId: "hand-1" });
  if (!started.ok) throw new Error("Could not start fixture");
  return started.value;
};

const perform = (
  game: Game,
  playerId: string,
  type: "fold" | "check" | "call" | "bet" | "raise" | "allIn",
  targetStreetCommitment?: number,
): Game => {
  const result = act(game, { playerId, type, targetStreetCommitment });
  if (!result.ok) {
    throw new Error(
      `${result.errors[0]?.code ?? "unknown"}: ${result.errors[0]?.message ?? "Could not act"}`,
    );
  }
  return result.value;
};

describe("all-in betting", () => {
  it("supports a short all-in call and automatically runs out to showdown", () => {
    let game = create([100, 25, 50]);
    game = perform(game, "player-1", "raise", 50);
    game = perform(game, "player-2", "call");
    game = perform(game, "player-3", "call");

    expect(game.currentHand).toMatchObject({ status: "showdown", street: "river" });
    expect(game.currentHand?.participants[1]).toMatchObject({
      handCommitment: 25,
      allIn: true,
    });
  });

  it("does not reopen raise rights after an incomplete all-in raise", () => {
    let game = create([200, 120, 200, 200]);
    game = perform(game, "player-4", "raise", 100);
    game = perform(game, "player-1", "call");
    game = perform(game, "player-2", "allIn");
    game = perform(game, "player-3", "call");

    expect(game.currentHand).toMatchObject({ actorPlayerId: "player-4", currentBet: 120 });
    expect(getLegalActions(game)?.actions.map(({ type }) => type)).not.toContain("raise");
    expect(getLegalActions(game)?.actions.map(({ type }) => type)).toContain("call");
  });

  it("reopens raise rights after a full all-in raise", () => {
    let game = create([300, 200, 300, 301]);
    game = perform(game, "player-4", "raise", 100);
    game = perform(game, "player-1", "call");
    game = perform(game, "player-2", "allIn");
    game = perform(game, "player-3", "call");

    expect(game.currentHand).toMatchObject({ actorPlayerId: "player-4", currentBet: 200 });
    expect(getLegalActions(game)?.actions.map(({ type }) => type)).toContain("raise");
  });
});

describe("pot derivation and settlement", () => {
  it("returns uncalled excess and derives main and side pots with folded dead money", () => {
    const game = create([100, 300, 500, 300]);
    const hand = game.currentHand;
    if (hand === undefined) throw new Error("Missing hand");
    const source: Game = {
      ...game,
      players: game.players.map((player) => ({ ...player, stack: 0 })),
      currentHand: {
        ...hand,
        status: "showdown",
        street: "river",
        actorPlayerId: undefined,
        participants: hand.participants.map((participant, index) => ({
          ...participant,
          streetCommitment: [100, 300, 500, 300][index] ?? 0,
          handCommitment: [100, 300, 500, 300][index] ?? 0,
          folded: index === 3,
          allIn: true,
        })),
      },
      chipSupply: 1_200,
    };

    expect(derivePots(source)).toEqual({
      returned: { "player-3": 200 },
      pots: [
        { amount: 400, eligiblePlayerIds: ["player-1", "player-2", "player-3"] },
        { amount: 600, eligiblePlayerIds: ["player-2", "player-3"] },
      ],
    });
  });

  it("splits equally and awards odd chips clockwise left of the button", () => {
    let game = create([101, 101, 101]);
    const hand = game.currentHand;
    if (hand === undefined) throw new Error("Missing hand");
    game = {
      ...game,
      players: game.players.map((player) => ({ ...player, stack: 0 })),
      currentHand: {
        ...hand,
        status: "showdown",
        street: "river",
        actorPlayerId: undefined,
        participants: hand.participants.map((participant) => ({
          ...participant,
          streetCommitment: 101,
          handCommitment: 101,
          allIn: true,
        })),
      },
    };

    const result = settleShowdown(game, [{ potIndex: 0, winnerPlayerIds: ["player-1", "player-2"] }]);

    expect(result).toMatchObject({
      ok: true,
      value: {
        players: [{ stack: 151 }, { stack: 152 }, { stack: 0 }],
        currentHand: {
          status: "settled",
          awards: [{ potIndex: 0, allocations: { "player-1": 151, "player-2": 152 } }],
        },
      },
    });
  });

  it("rejects ineligible winners and non-conserving manual allocations atomically", () => {
    let game = create([100, 100, 100]);
    const hand = game.currentHand;
    if (hand === undefined) throw new Error("Missing hand");
    game = {
      ...game,
      players: game.players.map((player) => ({ ...player, stack: 0 })),
      currentHand: {
        ...hand,
        status: "showdown",
        street: "river",
        actorPlayerId: undefined,
        participants: hand.participants.map((participant, index) => ({
          ...participant,
          streetCommitment: 100,
          handCommitment: 100,
          folded: index === 1,
          allIn: true,
        })),
      },
    };

    const ineligible = settleShowdown(game, [{ potIndex: 0, winnerPlayerIds: ["player-2"] }]);
    const invalidTotal = settleShowdown(game, [{
      potIndex: 0,
      winnerPlayerIds: ["player-1"],
      allocations: { "player-1": 1 },
    }]);

    expect(ineligible).toMatchObject({ ok: false, errors: [{ code: "settlement.winner.ineligible" }] });
    expect(invalidTotal).toMatchObject({ ok: false, errors: [{ code: "settlement.allocations.total" }] });
    expect(game.currentHand?.status).toBe("showdown");
  });

  it("settles atomically, marks busted players, and completes the game", () => {
    let game = create([100, 100]);
    game = perform(game, "player-1", "allIn");
    game = perform(game, "player-2", "call");
    const result = settleShowdown(game, [{ potIndex: 0, winnerPlayerIds: ["player-1"] }]);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        players: [
          { id: "player-1", stack: 200, status: "active" },
          { id: "player-2", stack: 0, status: "busted" },
        ],
        currentHand: { status: "settled" },
      },
    });
  });
});
