import {
  AVATARS,
  type Avatar,
  type Game,
  type Player,
} from "./game.js";
import { validateGameInvariants } from "./invariants.js";

export { AVATARS };

export interface CreatePlayerInput {
  readonly id: string;
  readonly name: string;
  readonly avatar: Avatar;
  readonly stack: number;
}

export interface CreateGameInput {
  readonly id: string;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly initialDealerPlayerId: string;
  readonly players: readonly CreatePlayerInput[];
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly playerId?: string;
}

export type CreateGameResult =
  | {
      readonly ok: true;
      readonly value: Game;
      readonly warnings?: readonly ValidationIssue[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly ValidationIssue[];
    };

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

const duplicateValues = (values: readonly string[]): Set<string> => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return duplicates;
};

export const createGame = (input: CreateGameInput): CreateGameResult => {
  const errors: ValidationIssue[] = [];

  if (input.players.length < 2 || input.players.length > 8) {
    errors.push({
      code: "players.count",
      message: "A game requires 2 to 8 players.",
    });
  }
  if (duplicateValues(input.players.map(({ id }) => id)).size > 0) {
    errors.push({
      code: "players.id.duplicate",
      message: "Player IDs must be unique.",
    });
  }
  if (
    duplicateValues(
      input.players.map(({ name }) => name.trim().toLocaleLowerCase("en-US")),
    ).size > 0
  ) {
    errors.push({
      code: "players.name.duplicate",
      message: "Player names must be unique.",
    });
  }
  for (const player of input.players) {
    if (player.name.trim().length === 0) {
      errors.push({
        code: "players.name.empty",
        message: "Player names must not be empty.",
        playerId: player.id,
      });
    }
    if (!isPositiveInteger(player.stack)) {
      errors.push({
        code: "players.stack.invalid",
        message: "Player stacks must be positive integers.",
        playerId: player.id,
      });
    }
  }
  if (!isPositiveInteger(input.smallBlind)) {
    errors.push({
      code: "smallBlind.invalid",
      message: "The small blind must be a positive integer.",
    });
  }
  if (!isPositiveInteger(input.bigBlind)) {
    errors.push({
      code: "bigBlind.invalid",
      message: "The big blind must be a positive integer.",
    });
  }
  if (
    isPositiveInteger(input.smallBlind) &&
    isPositiveInteger(input.bigBlind) &&
    input.smallBlind >= input.bigBlind
  ) {
    errors.push({
      code: "blinds.order",
      message: "The small blind must be lower than the big blind.",
    });
  }
  if (
    !input.players.some(({ id }) => id === input.initialDealerPlayerId)
  ) {
    errors.push({
      code: "dealer.invalid",
      message: "The initial dealer must be a seated player.",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const players: Player[] = input.players.map((player, seat) => ({
    ...player,
    name: player.name.trim(),
    seat,
    status: "active",
  }));
  const game: Game = {
    id: input.id,
    schemaVersion: 1,
    status: "active",
    settings: {
      smallBlind: input.smallBlind,
      bigBlind: input.bigBlind,
    },
    chipSupply: players.reduce((total, player) => total + player.stack, 0),
    players,
    dealerPlayerId: input.initialDealerPlayerId,
    handNumber: 0,
    completedHands: [],
    auditLog: [],
  };
  const invariantErrors = validateGameInvariants(game);
  if (invariantErrors.length > 0) {
    return { ok: false, errors: invariantErrors };
  }

  const warnings = players
    .filter(({ stack }) => stack < input.bigBlind)
    .map(({ id }) => ({
      code: "players.stack.belowBigBlind",
      message: "The player's stack is below the big blind.",
      playerId: id,
    }));

  return warnings.length > 0
    ? { ok: true, value: game, warnings }
    : { ok: true, value: game };
};
