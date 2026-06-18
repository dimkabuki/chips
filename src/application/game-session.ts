import type { Game } from "../domain/game/game.js";
import { act, confirmStreet, settleShowdown, startHand, type GameCommandResult, type PlayerActionInput, type ShowdownSelection, type StartHandInput } from "../domain/game/hand-engine.js";
import { correctStacks, type StackCorrectionInput } from "../domain/game/stack-correction.js";
import type { GameRepository, LoadGameResult, SaveGameResult } from "./persistence.js";

type SessionResult = GameCommandResult | SaveGameResult | LoadGameResult;

export class GameSession {
  private game: Game | undefined;
  private revision: number | undefined;
  private undoSnapshots: Game[] = [];
  constructor(private readonly repository: GameRepository) {}
  current(): Game | undefined { return this.game; }
  undoDepth(): number { return this.undoSnapshots.length; }
  async load(): Promise<LoadGameResult> {
    const result = await this.repository.load();
    if (result.ok) { this.game = result.envelope?.game; this.revision = result.envelope?.revision; this.undoSnapshots = []; }
    return result;
  }
  async reset(): Promise<void> { await this.repository.delete(); this.game = undefined; this.revision = undefined; this.undoSnapshots = []; }
  async replace(game: Game): Promise<SessionResult> { this.game = game; this.revision = undefined; this.undoSnapshots = []; return this.persist(); }
  async startHand(input: StartHandInput): Promise<SessionResult> { return this.accept((game) => startHand(game, input), false, true); }
  async act(input: PlayerActionInput): Promise<SessionResult> { return this.accept((game) => act(game, input), true, false); }
  async confirmStreet(): Promise<SessionResult> { return this.accept(confirmStreet, true, false); }
  async settleShowdown(selections: readonly ShowdownSelection[]): Promise<SessionResult> { return this.accept((game) => settleShowdown(game, selections), false, true); }
  async correctStacks(input: StackCorrectionInput): Promise<SessionResult> { return this.accept((game) => correctStacks(game, input), false, true); }
  async undo(): Promise<SessionResult> {
    const previous = this.undoSnapshots[0];
    if (this.game === undefined || previous === undefined) return { ok: false, errors: [{ code: "undo.unavailable", message: "No undo snapshot is available." }] };
    const restored: Game = { ...previous, auditLog: [...previous.auditLog, { sequence: previous.auditLog.length + 1, type: "undo" }] };
    this.game = restored;
    this.undoSnapshots = this.undoSnapshots.slice(1);
    return this.persist();
  }
  private async accept(command: (game: Game) => GameCommandResult, undoable: boolean, clearUndo: boolean): Promise<SessionResult> {
    if (this.game === undefined) return { ok: false, errors: [{ code: "game.missing", message: "No game is loaded." }] };
    const before = this.game;
    const result = command(before);
    if (!result.ok) return result;
    this.game = result.value;
    if (clearUndo) this.undoSnapshots = [];
    else if (undoable) this.undoSnapshots = [before, ...this.undoSnapshots].slice(0, 3);
    return this.persist();
  }
  private async persist(): Promise<SaveGameResult> {
    if (this.game === undefined) throw new Error("No game to persist.");
    const saved = await this.repository.save(this.game, this.revision);
    if (saved.ok) this.revision = saved.envelope.revision;
    return saved;
  }
}
