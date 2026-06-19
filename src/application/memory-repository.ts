import { createEnvelope, parsePersistedEnvelope, serializeEnvelope, type GameRepository, type LoadGameResult, type SaveGameResult } from "./persistence.js";
import type { Game } from "../domain/game/game.js";

export class MemoryGameRepository implements GameRepository {
  private raw: string | undefined;
  constructor(raw?: string) { this.raw = raw; }
  corrupt(raw: string): void { this.raw = raw; }
  rawValue(): string | undefined { return this.raw; }
  load(): Promise<LoadGameResult> {
    return Promise.resolve(this.raw === undefined ? { ok: true, envelope: undefined } : parsePersistedEnvelope(this.raw));
  }
  async save(game: Game, expectedRevision: number | undefined, undoSnapshots: readonly Game[] = []): Promise<SaveGameResult> {
    const loaded = await this.load();
    if (!loaded.ok) return { ok: false, code: "persistence.revisionConflict", actualRevision: undefined };
    const actual = loaded.envelope?.revision;
    if (expectedRevision !== actual) return { ok: false, code: "persistence.revisionConflict", actualRevision: actual };
    const envelope = createEnvelope(game, (actual ?? 0) + 1, undefined, undoSnapshots);
    this.raw = serializeEnvelope(envelope);
    return { ok: true, envelope };
  }
  delete(): Promise<void> { this.raw = undefined; return Promise.resolve(); }
}
