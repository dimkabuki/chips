import type { Game } from "./game.js";

export interface InvariantViolation {
  readonly code: string;
  readonly message: string;
}

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value > 0;

export const validateGameInvariants = (
  game: Game,
): readonly InvariantViolation[] => {
  const violations: InvariantViolation[] = [];
  const playerIds = new Set(game.players.map(({ id }) => id));
  const seats = new Set(game.players.map(({ seat }) => seat));
  const stackTotal = game.players.reduce((total, player) => total + player.stack, 0);
  const commitmentTotal =
    game.currentHand?.participants.reduce(
      (total, participant) => total + participant.handCommitment,
      0,
    ) ?? 0;
  const hand = game.currentHand;

  if (playerIds.size !== game.players.length) {
    violations.push({
      code: "invariant.players.id.unique",
      message: "Player IDs must be unique.",
    });
  }
  if (seats.size !== game.players.length) {
    violations.push({
      code: "invariant.players.seat.unique",
      message: "Player seats must be unique.",
    });
  }
  if (
    game.players.some((player) => {
      const zeroStackIsAllIn =
        player.stack === 0 &&
        game.currentHand?.participants.some(
          (participant) =>
            participant.playerId === player.id && participant.allIn,
        );
      return (
        !Number.isInteger(player.stack) ||
        player.stack < 0 ||
        (player.status === "active" &&
          player.stack === 0 &&
          !zeroStackIsAllIn)
      );
    })
  ) {
    violations.push({
      code: "invariant.players.stack",
      message: "Active player stacks must be positive integers.",
    });
  }
  if (
    !isPositiveInteger(game.chipSupply) ||
    stackTotal + commitmentTotal !== game.chipSupply
  ) {
    violations.push({
      code: "invariant.chips.conserved",
      message: "Player stacks must equal the configured chip supply.",
    });
  }
  if (!playerIds.has(game.dealerPlayerId)) {
    violations.push({
      code: "invariant.dealer.seated",
      message: "The dealer must be a seated player.",
    });
  }
  if (
    hand?.participants.some(
      (participant) =>
        !Number.isInteger(participant.streetCommitment) ||
        !Number.isInteger(participant.handCommitment) ||
        participant.streetCommitment < 0 ||
        participant.handCommitment < participant.streetCommitment ||
        (participant.folded && participant.allIn),
    )
  ) {
    violations.push({
      code: "invariant.hand.commitments",
      message: "Hand commitments and participant states must be valid.",
    });
  }
  if (hand?.actorPlayerId !== undefined) {
    const actor = hand.participants.find(
      ({ playerId }) => playerId === hand.actorPlayerId,
    );
    if (actor === undefined || actor.folded || actor.allIn) {
      violations.push({
        code: "invariant.hand.actor.actionable",
        message: "The current actor must be actionable.",
      });
    }
  }
  if (
    game.players.some(
      (player) =>
        (player.stack === 0 && player.status !== "busted" && hand?.status === "settled") ||
        (player.stack > 0 && player.status !== "active"),
    )
  ) {
    violations.push({
      code: "invariant.players.status",
      message: "Player status must agree with the settled stack.",
    });
  }
  if (
    game.status === "completed" &&
    game.players.filter(({ stack }) => stack > 0).length !== 1
  ) {
    violations.push({
      code: "invariant.game.completed",
      message: "A completed game must have exactly one player with chips.",
    });
  }

  return violations;
};
