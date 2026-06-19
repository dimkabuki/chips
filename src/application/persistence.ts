import type { Game } from "../domain/game/game.js";
import { validateGameInvariants } from "../domain/game/invariants.js";

export const CURRENT_PERSISTENCE_SCHEMA_VERSION = 2;

export interface PersistedGameEnvelope {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly savedAt: string;
  readonly checksum: string;
  readonly game: Game;
  readonly undoSnapshots: readonly Game[];
}

export interface GameRepository {
  readonly load: () => Promise<LoadGameResult>;
  readonly save: (game: Game, expectedRevision: number | undefined, undoSnapshots?: readonly Game[]) => Promise<SaveGameResult>;
  readonly delete: () => Promise<void>;
}

export type LoadGameResult =
  | { readonly ok: true; readonly envelope: PersistedGameEnvelope | undefined }
  | { readonly ok: false; readonly code: "persistence.parse" | "persistence.checksum" | "persistence.migration" | "persistence.invariant" };
export type SaveGameResult =
  | { readonly ok: true; readonly envelope: PersistedGameEnvelope }
  | { readonly ok: false; readonly code: "persistence.revisionConflict"; readonly actualRevision: number | undefined };

const stable = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
};

export const checksumGame = (game: Game): string => {
  let hash = 0x811c9dc5;
  for (const char of stable(game)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const createEnvelope = (game: Game, revision: number, savedAt = new Date().toISOString(), undoSnapshots: readonly Game[] = []): PersistedGameEnvelope => ({
  schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION,
  revision,
  savedAt,
  checksum: checksumGame(game),
  game,
  undoSnapshots,
});

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export const migrateGameToCurrent = (value: unknown): { ok: true; game: Game } | { ok: false } => {
  if (!isObject(value) || value.schemaVersion !== 1) return { ok: false };
  return { ok: true, game: value as unknown as Game };
};

export const parsePersistedEnvelope = (raw: string): LoadGameResult => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, code: "persistence.parse" }; }
  if (!isObject(parsed) || typeof parsed.revision !== "number" || typeof parsed.checksum !== "string" || typeof parsed.savedAt !== "string") {
    return { ok: false, code: "persistence.parse" };
  }
  const migrated = migrateGameToCurrent(parsed.game);
  if (!migrated.ok) return { ok: false, code: "persistence.migration" };
  if (checksumGame(migrated.game) !== parsed.checksum) return { ok: false, code: "persistence.checksum" };
  const rawSnapshots = Array.isArray(parsed.undoSnapshots) ? parsed.undoSnapshots : [];
  const undoSnapshots: Game[] = [];
  for (const snapshot of rawSnapshots.slice(0, 3)) {
    const migratedSnapshot = migrateGameToCurrent(snapshot);
    if (!migratedSnapshot.ok) return { ok: false, code: "persistence.migration" };
    if (validateGameInvariants(migratedSnapshot.game).length > 0) return { ok: false, code: "persistence.invariant" };
    undoSnapshots.push(migratedSnapshot.game);
  }
  if (validateGameInvariants(migrated.game).length > 0) return { ok: false, code: "persistence.invariant" };
  return { ok: true, envelope: { schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION, revision: parsed.revision, savedAt: parsed.savedAt, checksum: parsed.checksum, game: migrated.game, undoSnapshots } };
};

export const serializeEnvelope = (envelope: PersistedGameEnvelope): string => JSON.stringify(envelope);
