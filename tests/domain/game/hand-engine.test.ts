import { describe, expect, it } from "vitest";

import {
  act,
  confirmStreet,
  getLegalActions,
  startHand,
} from "../../../src/domain/game/hand-engine.js";
import {
  AVATARS,
  createGame,
  type CreatePlayerInput,
} from "../../../src/domain/game/create-game.js";
import type { Game } from "../../../src/domain/game/game.js";

const players = (count: number): readonly CreatePlayerInput[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `player-${String(index + 1)}`,
    name: `Player ${String(index + 1)}`,
    avatar: AVATARS[index % AVATARS.length] ?? AVATARS[0],
    stack: 1_000,
  }));

const game = (count = 4, dealerPlayerId = "player-1"): Game => {
  const result = createGame({
    id: "game-1",
    smallBlind: 5,
    bigBlind: 10,
    initialDealerPlayerId: dealerPlayerId,
    players: players(count),
  });
  if (!result.ok) {
    throw new Error("Test fixture is invalid.");
  }
  return result.value;
};

const start = (source: Game, handId = "hand-1"): Game => {
  const result = startHand(source, { handId });
  if (!result.ok) {
    throw new Error(result.errors[0]?.message ?? "Could not start hand.");
  }
  return result.value;
};

const perform = (
  source: Game,
  playerId: string,
  type: "fold" | "check" | "call" | "bet" | "raise",
  targetStreetCommitment?: number,
): Game => {
  const result = act(source, {
    playerId,
    type,
    ...(targetStreetCommitment === undefined ? {} : { targetStreetCommitment }),
  });
  if (!result.ok) {
    throw new Error(result.errors[0]?.message ?? "Could not act.");
  }
  return result.value;
};

describe("startHand", () => {
  it("posts blinds and selects normal-table positions", () => {
    const result = start(game(), "hand-1");

    expect(result.currentHand).toMatchObject({
      id: "hand-1",
      number: 1,
      status: "betting",
      street: "preflop",
      buttonPlayerId: "player-1",
      smallBlindPlayerId: "player-2",
      bigBlindPlayerId: "player-3",
      actorPlayerId: "player-4",
      currentBet: 10,
      lastFullRaiseSize: 10,
    });
    expect(result.players.map(({ stack }) => stack)).toEqual([1_000, 995, 990, 1_000]);
    expect(result.currentHand?.participants.map(({ handCommitment }) => handCommitment))
      .toEqual([0, 5, 10, 0]);
  });

  it("uses heads-up button, blind, and action rules", () => {
    const result = start(game(2));

    expect(result.currentHand).toMatchObject({
      buttonPlayerId: "player-1",
      smallBlindPlayerId: "player-1",
      bigBlindPlayerId: "player-2",
      actorPlayerId: "player-1",
    });
  });

  it("posts a short blind as all-in without inventing chips", () => {
    const [first, second, third] = players(3);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("Test fixture is invalid.");
    }
    const sourceResult = createGame({
      id: "game-1",
      smallBlind: 5,
      bigBlind: 10,
      initialDealerPlayerId: "player-1",
      players: [
        first,
        { ...second, stack: 4 },
        third,
      ],
    });
    if (!sourceResult.ok) throw new Error("Test fixture is invalid.");

    const result = start(sourceResult.value);

    expect(result.players[1]?.stack).toBe(0);
    expect(result.currentHand?.participants[1]).toMatchObject({
      playerId: "player-2",
      handCommitment: 4,
      allIn: true,
    });
    expect(
      result.players.reduce((total, player) => total + player.stack, 0) +
        (result.currentHand?.participants.reduce(
          (total, player) => total + player.handCommitment,
          0,
        ) ?? 0),
    ).toBe(result.chipSupply);
  });

  it("rotates the button and skips busted seats after the first hand", () => {
    const source: Game = {
      ...game(),
      dealerPlayerId: "player-1",
      handNumber: 1,
      players: game().players.map((player) =>
        player.id === "player-2"
          ? { ...player, stack: 0, status: "busted" as const }
          : player,
      ),
      chipSupply: 3_000,
    };

    const result = start(source, "hand-2");

    expect(result.currentHand).toMatchObject({
      buttonPlayerId: "player-3",
      smallBlindPlayerId: "player-4",
      bigBlindPlayerId: "player-1",
      actorPlayerId: "player-3",
    });
  });
});

describe("betting commands", () => {
  it("returns engine-owned legal actions and target bounds", () => {
    const result = getLegalActions(start(game()));

    expect(result).toEqual({
      playerId: "player-4",
      actions: [
        { type: "fold" },
        { type: "call", targetStreetCommitment: 10, chipsAdded: 10 },
        { type: "raise", minTarget: 20, maxTarget: 999 },
      ],
    });
  });

  it("rejects out-of-turn and below-minimum raises without changing state", () => {
    const source = start(game());

    expect(act(source, { playerId: "player-1", type: "call" })).toMatchObject({
      ok: false,
      errors: [{ code: "action.outOfTurn" }],
    });
    expect(
      act(source, {
        playerId: "player-4",
        type: "raise",
        targetStreetCommitment: 15,
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "action.raise.belowMinimum" }],
    });
    expect(source.players[3]?.stack).toBe(1_000);
  });

  it("completes a betting round only after every player responds", () => {
    let result = start(game());
    result = perform(result, "player-4", "call");
    result = perform(result, "player-1", "call");
    result = perform(result, "player-2", "call");

    expect(result.currentHand).toMatchObject({
      status: "betting",
      actorPlayerId: "player-3",
    });

    result = perform(result, "player-3", "check");
    expect(result.currentHand).toMatchObject({
      status: "dealPrompt",
      pendingTransition: "flop",
    });
  });

  it("confirms street prompts and selects the first actor left of the button", () => {
    let result = start(game());
    result = perform(result, "player-4", "call");
    result = perform(result, "player-1", "call");
    result = perform(result, "player-2", "call");
    result = perform(result, "player-3", "check");

    const transition = confirmStreet(result);

    expect(transition).toMatchObject({
      ok: true,
      value: {
        currentHand: {
          status: "betting",
          street: "flop",
          actorPlayerId: "player-2",
          currentBet: 0,
          lastFullRaiseSize: 10,
        },
      },
    });
  });

  it("runs a heads-up hand through all streets to a showdown boundary", () => {
    let result = start(game(2));
    result = perform(result, "player-1", "call");
    result = perform(result, "player-2", "check");

    for (const street of ["flop", "turn", "river"] as const) {
      const transition = confirmStreet(result);
      if (!transition.ok) throw new Error("Could not confirm street.");
      result = transition.value;
      expect(result.currentHand?.street).toBe(street);
      result = perform(result, "player-2", "check");
      result = perform(result, "player-1", "check");
    }

    expect(result.currentHand).toMatchObject({
      status: "showdown",
      street: "river",
    });
  });

  it("automatically settles an uncontested pot and conserves chips", () => {
    let result = start(game(3));
    result = perform(result, "player-1", "raise", 30);
    result = perform(result, "player-2", "fold");
    result = perform(result, "player-3", "fold");

    expect(result.currentHand).toMatchObject({
      status: "settled",
      winnerPlayerId: "player-1",
      potAmount: 45,
    });
    expect(result.players.map(({ stack }) => stack)).toEqual([1_015, 995, 990]);
    expect(result.players.reduce((total, player) => total + player.stack, 0)).toBe(3_000);
  });
});
