import type {
  Game,
  Hand,
  HandAction,
  HandParticipant,
  Player,
  Street,
} from "./game.js";
import { validateGameInvariants } from "./invariants.js";

export interface CommandIssue {
  readonly code: string;
  readonly message: string;
}

export type GameCommandResult =
  | { readonly ok: true; readonly value: Game }
  | { readonly ok: false; readonly errors: readonly CommandIssue[] };

export interface StartHandInput {
  readonly handId: string;
}

export type PlayerActionType = "fold" | "check" | "call" | "bet" | "raise";

export interface PlayerActionInput {
  readonly playerId: string;
  readonly type: PlayerActionType;
  readonly targetStreetCommitment?: number;
}

export type LegalAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | {
      readonly type: "call";
      readonly targetStreetCommitment: number;
      readonly chipsAdded: number;
    }
  | {
      readonly type: "bet" | "raise";
      readonly minTarget: number;
      readonly maxTarget: number;
    };

export interface LegalActions {
  readonly playerId: string;
  readonly actions: readonly LegalAction[];
}

const error = (code: string, message: string): GameCommandResult => ({
  ok: false,
  errors: [{ code, message }],
});

const nextId = (
  players: readonly Player[],
  fromId: string,
  predicate: (player: Player) => boolean,
): string | undefined => {
  const start = players.findIndex(({ id }) => id === fromId);
  for (let offset = 1; offset <= players.length; offset += 1) {
    const player = players[(start + offset) % players.length];
    if (player !== undefined && predicate(player)) return player.id;
  }
  return undefined;
};

const participant = (hand: Hand, playerId: string): HandParticipant | undefined =>
  hand.participants.find((candidate) => candidate.playerId === playerId);

const actionable = (candidate: HandParticipant): boolean =>
  !candidate.folded && !candidate.allIn;

const commandResult = (game: Game): GameCommandResult => {
  const violations = validateGameInvariants(game);
  return violations.length === 0
    ? { ok: true, value: game }
    : { ok: false, errors: violations };
};

export const startHand = (
  game: Game,
  input: StartHandInput,
): GameCommandResult => {
  if (game.status !== "active" || game.currentHand?.status === "betting") {
    return error("hand.cannotStart", "A new hand cannot be started now.");
  }
  const activePlayers = game.players.filter(({ stack }) => stack > 0);
  if (activePlayers.length < 2) {
    return error("hand.players.insufficient", "A hand requires at least 2 active players.");
  }

  const buttonPlayerId =
    game.handNumber === 0
      ? game.dealerPlayerId
      : nextId(game.players, game.dealerPlayerId, ({ stack }) => stack > 0);
  if (buttonPlayerId === undefined) {
    return error("hand.button.missing", "The hand has no eligible button.");
  }
  const headsUp = activePlayers.length === 2;
  const smallBlindPlayerId = headsUp
    ? buttonPlayerId
    : nextId(game.players, buttonPlayerId, ({ stack }) => stack > 0);
  const bigBlindPlayerId =
    smallBlindPlayerId === undefined
      ? undefined
      : nextId(game.players, smallBlindPlayerId, ({ stack }) => stack > 0);
  if (smallBlindPlayerId === undefined || bigBlindPlayerId === undefined) {
    return error("hand.blinds.missing", "The hand has no eligible blinds.");
  }

  const blindByPlayer = new Map<string, number>([
    [smallBlindPlayerId, game.settings.smallBlind],
    [bigBlindPlayerId, game.settings.bigBlind],
  ]);
  const players = game.players.map((player) => {
    const blind = Math.min(blindByPlayer.get(player.id) ?? 0, player.stack);
    return blind === 0 ? player : { ...player, stack: player.stack - blind };
  });
  const participants: HandParticipant[] = activePlayers.map((player) => {
    const blind = Math.min(blindByPlayer.get(player.id) ?? 0, player.stack);
    return {
      playerId: player.id,
      stackAtStart: player.stack,
      streetCommitment: blind,
      handCommitment: blind,
      folded: false,
      allIn: blind === player.stack,
      actedSinceFullRaise: false,
    };
  });
  const actorPlayerId = headsUp
    ? buttonPlayerId
    : nextId(players, bigBlindPlayerId, (player) => {
        const candidate = participants.find(({ playerId }) => playerId === player.id);
        return candidate !== undefined && actionable(candidate);
      });
  const hand: Hand = {
    id: input.handId,
    number: game.handNumber + 1,
    status: "betting",
    street: "preflop",
    buttonPlayerId,
    smallBlindPlayerId,
    bigBlindPlayerId,
    ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
    currentBet: Math.max(...participants.map(({ streetCommitment }) => streetCommitment)),
    lastFullRaiseSize: game.settings.bigBlind,
    participants,
    actions: [],
  };

  return commandResult({
    ...game,
    players,
    dealerPlayerId: buttonPlayerId,
    handNumber: hand.number,
    currentHand: hand,
  });
};

export const getLegalActions = (game: Game): LegalActions | undefined => {
  const hand = game.currentHand;
  if (hand?.status !== "betting" || hand.actorPlayerId === undefined) return undefined;
  const actor = participant(hand, hand.actorPlayerId);
  const player = game.players.find(({ id }) => id === hand.actorPlayerId);
  if (actor === undefined || player === undefined || !actionable(actor)) return undefined;

  const actions: LegalAction[] = [{ type: "fold" }];
  if (actor.streetCommitment === hand.currentBet) {
    actions.push({ type: "check" });
  } else if (hand.currentBet - actor.streetCommitment < player.stack) {
    actions.push({
      type: "call",
      targetStreetCommitment: hand.currentBet,
      chipsAdded: hand.currentBet - actor.streetCommitment,
    });
  }
  const maxTarget = actor.streetCommitment + player.stack - 1;
  if (hand.currentBet === 0 && maxTarget >= game.settings.bigBlind) {
    actions.push({ type: "bet", minTarget: game.settings.bigBlind, maxTarget });
  } else {
    const minTarget = hand.currentBet + hand.lastFullRaiseSize;
    if (maxTarget >= minTarget) {
      actions.push({ type: "raise", minTarget, maxTarget });
    }
  }
  return { playerId: player.id, actions };
};

const nextActor = (game: Game, hand: Hand, fromId: string): string | undefined =>
  nextId(game.players, fromId, (player) => {
    const candidate = participant(hand, player.id);
    return candidate !== undefined && actionable(candidate);
  });

const roundComplete = (hand: Hand): boolean =>
  hand.participants
    .filter(actionable)
    .every(
      (candidate) =>
        candidate.actedSinceFullRaise &&
        candidate.streetCommitment === hand.currentBet,
    );

const afterAction = (game: Game, hand: Hand, actorId: string): Game => {
  const remaining = hand.participants.filter(({ folded }) => !folded);
  if (remaining.length === 1) {
    const winner = remaining[0];
    if (winner === undefined) return game;
    const potAmount = hand.participants.reduce(
      (total, candidate) => total + candidate.handCommitment,
      0,
    );
    return {
      ...game,
      players: game.players.map((player) =>
        player.id === winner.playerId
          ? { ...player, stack: player.stack + potAmount }
          : player,
      ),
      currentHand: {
        ...hand,
        status: "settled",
        winnerPlayerId: winner.playerId,
        potAmount,
        participants: hand.participants.map((candidate) => ({
          ...candidate,
          streetCommitment: 0,
          handCommitment: 0,
        })),
      },
    };
  }
  if (roundComplete(hand)) {
    if (hand.street === "river") {
      return { ...game, currentHand: { ...hand, status: "showdown" } };
    }
    const pendingTransition: Exclude<Street, "preflop"> =
      hand.street === "preflop"
        ? "flop"
        : hand.street === "flop"
          ? "turn"
          : "river";
    return {
      ...game,
      currentHand: { ...hand, status: "dealPrompt", pendingTransition },
    };
  }
  const actorPlayerId = nextActor(game, hand, actorId);
  return {
    ...game,
    currentHand: {
      ...hand,
      ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
    },
  };
};

export const act = (game: Game, input: PlayerActionInput): GameCommandResult => {
  const hand = game.currentHand;
  if (hand?.status !== "betting" || hand.actorPlayerId !== input.playerId) {
    return error("action.outOfTurn", "Only the current actor may act.");
  }
  const legal = getLegalActions(game);
  const actor = participant(hand, input.playerId);
  const player = game.players.find(({ id }) => id === input.playerId);
  if (legal === undefined || actor === undefined || player === undefined) {
    return error("action.actor.invalid", "The current actor is invalid.");
  }
  const option = legal.actions.find(({ type }) => type === input.type);
  if (option === undefined) {
    return error(`action.${input.type}.illegal`, "That action is not legal.");
  }

  let target = actor.streetCommitment;
  if (input.type === "call") target = hand.currentBet;
  if (input.type === "bet" || input.type === "raise") {
    if (input.targetStreetCommitment === undefined) {
      return error("action.target.required", "A bet or raise requires a target.");
    }
    const bounded = option as Extract<LegalAction, { minTarget: number }>;
    if (input.targetStreetCommitment < bounded.minTarget) {
      return error(
        `action.${input.type}.belowMinimum`,
        "The target is below the legal minimum.",
      );
    }
    if (input.targetStreetCommitment > bounded.maxTarget) {
      return error(
        `action.${input.type}.aboveMaximum`,
        "The target is above the legal maximum.",
      );
    }
    target = input.targetStreetCommitment;
  }
  const chipsAdded = target - actor.streetCommitment;
  const raisesBet = target > hand.currentBet;
  const participants = hand.participants.map((candidate) => {
    if (candidate.playerId === actor.playerId) {
      return {
        ...candidate,
        streetCommitment: target,
        handCommitment: candidate.handCommitment + chipsAdded,
        folded: input.type === "fold",
        actedSinceFullRaise: true,
      };
    }
    return raisesBet ? { ...candidate, actedSinceFullRaise: false } : candidate;
  });
  const action: HandAction = {
    sequence: hand.actions.length + 1,
    playerId: player.id,
    type: input.type,
    targetStreetCommitment: target,
    chipsAdded,
    resultingStack: player.stack - chipsAdded,
  };
  const updatedHand: Hand = {
    ...hand,
    currentBet: raisesBet ? target : hand.currentBet,
    lastFullRaiseSize: raisesBet ? target - hand.currentBet : hand.lastFullRaiseSize,
    participants,
    actions: [...hand.actions, action],
  };
  const updatedGame = afterAction(
    {
      ...game,
      players: game.players.map((candidate) =>
        candidate.id === player.id
          ? { ...candidate, stack: candidate.stack - chipsAdded }
          : candidate,
      ),
      currentHand: updatedHand,
    },
    updatedHand,
    player.id,
  );
  return commandResult(updatedGame);
};

export const confirmStreet = (game: Game): GameCommandResult => {
  const hand = game.currentHand;
  if (hand?.status !== "dealPrompt" || hand.pendingTransition === undefined) {
    return error("street.cannotConfirm", "There is no street prompt to confirm.");
  }
  const participants = hand.participants.map((candidate) => ({
    ...candidate,
    streetCommitment: 0,
    actedSinceFullRaise: false,
  }));
  const actorPlayerId = nextId(game.players, hand.buttonPlayerId, (player) => {
    const candidate = participants.find(({ playerId }) => playerId === player.id);
    return candidate !== undefined && actionable(candidate);
  });
  const { pendingTransition: street, ...handWithoutTransition } = hand;
  const nextHand: Hand = {
    ...handWithoutTransition,
    status: "betting",
    street,
    ...(actorPlayerId === undefined ? {} : { actorPlayerId }),
    currentBet: 0,
    lastFullRaiseSize: game.settings.bigBlind,
    participants,
  };
  return commandResult({ ...game, currentHand: nextHand });
};
