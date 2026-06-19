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
  return checksumStable(game);
};

const checksumEnvelopeContent = (game: Game, undoSnapshots: readonly Game[]): string => {
  return checksumStable({ game, undoSnapshots });
};

const checksumStable = (value: unknown): string => {
  let hash = 0x811c9dc5;
  for (const char of stable(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const createEnvelope = (game: Game, revision: number, savedAt = new Date().toISOString(), undoSnapshots: readonly Game[] = []): PersistedGameEnvelope => ({
  schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION,
  revision,
  savedAt,
  checksum: checksumEnvelopeContent(game, undoSnapshots),
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
  if (!isObject(parsed) || typeof parsed.revision !== "number" || typeof parsed.checksum !== "string" || typeof parsed.savedAt !== "string" || typeof parsed.schemaVersion !== "number") {
    return { ok: false, code: "persistence.parse" };
  }
  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== CURRENT_PERSISTENCE_SCHEMA_VERSION) return { ok: false, code: "persistence.migration" };
  const migrated = migrateGameToCurrent(parsed.game);
  if (!migrated.ok) return { ok: false, code: "persistence.migration" };
  const rawSnapshots = parsed.schemaVersion === 1 ? [] : Array.isArray(parsed.undoSnapshots) ? parsed.undoSnapshots : [];
  const undoSnapshots: Game[] = [];
  for (const snapshot of rawSnapshots.slice(0, 3)) {
    const migratedSnapshot = migrateGameToCurrent(snapshot);
    if (!migratedSnapshot.ok) return { ok: false, code: "persistence.migration" };
    if (validateGameInvariants(migratedSnapshot.game).length > 0) return { ok: false, code: "persistence.invariant" };
    undoSnapshots.push(migratedSnapshot.game);
  }
  const expectedChecksum = parsed.schemaVersion === 1 ? checksumGame(migrated.game) : checksumEnvelopeContent(migrated.game, undoSnapshots);
  if (expectedChecksum !== parsed.checksum) return { ok: false, code: "persistence.checksum" };
  if (validateGameInvariants(migrated.game).length > 0) return { ok: false, code: "persistence.invariant" };
  return { ok: true, envelope: { schemaVersion: CURRENT_PERSISTENCE_SCHEMA_VERSION, revision: parsed.revision, savedAt: parsed.savedAt, checksum: parsed.checksum, game: migrated.game, undoSnapshots } };
};

export const serializeEnvelope = (envelope: PersistedGameEnvelope): string => JSON.stringify(envelope);
