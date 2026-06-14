import { describe, expect, it } from "vitest";

import {
  AVATARS,
  createGame,
  type CreateGameInput,
  type CreatePlayerInput,
} from "../../../src/domain/game/create-game.js";

const ada: CreatePlayerInput = {
  id: "player-1",
  name: "Ada",
  avatar: AVATARS[0],
  stack: 1_000,
};
const linus: CreatePlayerInput = {
  id: "player-2",
  name: "Linus",
  avatar: AVATARS[1],
  stack: 1_000,
};

const validInput = (overrides: Partial<CreateGameInput> = {}): CreateGameInput => ({
  id: "game-1",
  smallBlind: 5,
  bigBlind: 10,
  initialDealerPlayerId: "player-1",
  players: [ada, linus],
  ...overrides,
});

describe("createGame", () => {
  it("creates a validated game and derives its conserved chip supply", () => {
    const result = createGame(validInput());

    expect(result).toEqual({
      ok: true,
      value: {
        id: "game-1",
        schemaVersion: 1,
        status: "active",
        settings: { smallBlind: 5, bigBlind: 10 },
        chipSupply: 2_000,
        players: [
          {
            id: "player-1",
            seat: 0,
            name: "Ada",
            avatar: "red",
            stack: 1_000,
            status: "active",
          },
          {
            id: "player-2",
            seat: 1,
            name: "Linus",
            avatar: "blue",
            stack: 1_000,
            status: "active",
          },
        ],
        dealerPlayerId: "player-1",
        handNumber: 0,
        completedHands: [],
        auditLog: [],
      },
    });
  });

  it.each([
    ["requires 2 players", { players: validInput().players.slice(0, 1) }, "players.count"],
    [
      "allows no more than 8 players",
      {
        players: Array.from({ length: 9 }, (_, index) => ({
          id: `player-${String(index)}`,
          name: `Player ${String(index)}`,
          avatar: AVATARS[index % AVATARS.length] ?? AVATARS[0],
          stack: 100,
        })),
      },
      "players.count",
    ],
    [
      "requires unique player IDs",
      {
        players: [ada, { ...linus, id: "player-1" }],
      },
      "players.id.duplicate",
    ],
    [
      "requires unique names after trimming and case folding",
      {
        players: [ada, { ...linus, name: " ada " }],
      },
      "players.name.duplicate",
    ],
    [
      "requires positive integer stacks",
      {
        players: [{ ...ada, stack: 0 }, linus],
      },
      "players.stack.invalid",
    ],
    ["requires a positive integer small blind", { smallBlind: 1.5 }, "smallBlind.invalid"],
    ["requires a positive integer big blind", { bigBlind: 0 }, "bigBlind.invalid"],
    [
      "requires the small blind to be lower than the big blind",
      { smallBlind: 10, bigBlind: 10 },
      "blinds.order",
    ],
    [
      "requires the initial dealer to be seated",
      { initialDealerPlayerId: "missing" },
      "dealer.invalid",
    ],
  ] satisfies ReadonlyArray<
    readonly [string, Partial<CreateGameInput>, string]
  >)("%s", (_name, overrides, expectedCode) => {
    const result = createGame(validInput(overrides));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: expectedCode }),
      );
    }
  });

  it("reports a warning when a stack is below the big blind", () => {
    const input = validInput({
      players: [{ ...ada, stack: 5 }, linus],
    });

    expect(createGame(input)).toMatchObject({
      ok: true,
      warnings: [
        {
          code: "players.stack.belowBigBlind",
          playerId: "player-1",
        },
      ],
    });
  });
});
