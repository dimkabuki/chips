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

  return violations;
};
