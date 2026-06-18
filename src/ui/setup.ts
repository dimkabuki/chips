import { AVATARS, type CreateGameInput, type ValidationIssue } from "../domain/game/create-game.js";

export interface SetupPlayerForm {
  readonly name: string;
  readonly avatar: string;
  readonly stack: string;
}

export interface SetupForm {
  readonly smallBlind: string;
  readonly bigBlind: string;
  readonly dealerPlayerId: string;
  readonly players: readonly SetupPlayerForm[];
}

export interface SetupPreview {
  readonly totalChipSupply: number;
  readonly warnings: readonly ValidationIssue[];
}

const positiveIntegerOrNaN = (value: string): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

export const toCreateGameInput = (form: SetupForm, gameId: string): CreateGameInput => ({
  id: gameId,
  smallBlind: positiveIntegerOrNaN(form.smallBlind),
  bigBlind: positiveIntegerOrNaN(form.bigBlind),
  initialDealerPlayerId: form.dealerPlayerId,
  players: form.players.map((player, index) => ({
    id: `player-${String(index + 1)}`,
    name: player.name,
    avatar: AVATARS.includes(player.avatar as never) ? player.avatar as (typeof AVATARS)[number] : AVATARS[0],
    stack: positiveIntegerOrNaN(player.stack),
  })),
});

export const previewSetup = (form: SetupForm): SetupPreview => {
  const totalChipSupply = form.players.reduce((total, player) => {
    const stack = positiveIntegerOrNaN(player.stack);
    return Number.isFinite(stack) && stack > 0 ? total + stack : total;
  }, 0);
  const input = toCreateGameInput(form, "preview-game");
  const bigBlind = input.bigBlind;
  const warnings = Number.isInteger(bigBlind) && bigBlind > 0
    ? input.players.filter((player) => Number.isInteger(player.stack) && player.stack > 0 && player.stack < bigBlind).map((player) => ({ code: "players.stack.belowBigBlind", message: "The player's stack is below the big blind.", playerId: player.id }))
    : [];
  return { totalChipSupply, warnings };
};

export const defaultSetupForm = (): SetupForm => ({
  smallBlind: "5",
  bigBlind: "10",
  dealerPlayerId: "player-1",
  players: [0, 1].map((index) => ({ name: `Player ${String(index + 1)}`, avatar: AVATARS[index] ?? AVATARS[0], stack: "1000" })),
});
