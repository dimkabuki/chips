import type { Game } from "./game.js";
import { validateGameInvariants } from "./invariants.js";
import type { GameCommandResult } from "./hand-engine.js";

export interface StackCorrectionInput {
  readonly stacks: Readonly<Record<string, number>>;
  readonly reason: string;
}

const error = (code: string, message: string): GameCommandResult => ({ ok: false, errors: [{ code, message }] });

export const correctStacks = (game: Game, input: StackCorrectionInput): GameCommandResult => {
  if (input.reason.trim().length === 0 || input.reason.trim().length > 120) return error("correction.reason.required", "A short reason is required.");
  const ids = new Set(game.players.map(({ id }) => id));
  if (Object.keys(input.stacks).some((id) => !ids.has(id))) return error("correction.player.invalid", "Corrections may only target seated players.");
  if (Object.values(input.stacks).some((stack) => !Number.isInteger(stack) || stack < 0)) return error("correction.stack.invalid", "Corrected stacks must be non-negative integers.");
  const commitmentTotal = game.currentHand?.participants.reduce((sum, participant) => sum + participant.handCommitment, 0) ?? 0;
  const players = game.players.map((player) => ({ ...player, stack: input.stacks[player.id] ?? player.stack }));
  if (players.reduce((sum, player) => sum + player.stack, 0) + commitmentTotal !== game.chipSupply) return error("correction.chips.conserved", "Correction must preserve total chip supply.");
  const before = Object.fromEntries(game.players.map(({ id, stack }) => [id, stack]));
  const after = Object.fromEntries(players.map(({ id, stack }) => [id, stack]));
  const corrected: Game = {
    ...game,
    players,
    auditLog: [...game.auditLog, { sequence: game.auditLog.length + 1, type: "stackCorrection", reason: input.reason.trim(), before, after }],
  };
  const violations = validateGameInvariants(corrected);
  return violations.length === 0 ? { ok: true, value: corrected } : { ok: false, errors: violations };
};
