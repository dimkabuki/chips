import type { Game } from "../../domain/game/game.js";
import { createEnvelope, parsePersistedEnvelope, serializeEnvelope, type GameRepository, type LoadGameResult, type SaveGameResult } from "../../application/persistence.js";

const DB_NAME = "chips";
const STORE = "activeGame";
const KEY = "active";

const requestAsPromise = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => { resolve(request.result); };
  request.onerror = () => { reject(request.error ?? new Error("IndexedDB request failed.")); };
});

const openDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
  request.onsuccess = () => { resolve(request.result); };
  request.onerror = () => { reject(request.error ?? new Error("IndexedDB request failed.")); };
});

export class IndexedDbGameRepository implements GameRepository {
  async load(): Promise<LoadGameResult> {
    const db = await openDb();
    try {
      const raw = await requestAsPromise<string | undefined>(db.transaction(STORE, "readonly").objectStore(STORE).get(KEY) as IDBRequest<string | undefined>);
      return raw === undefined ? { ok: true, envelope: undefined } : parsePersistedEnvelope(raw);
    } finally { db.close(); }
  }
  async save(game: Game, expectedRevision: number | undefined, undoSnapshots: readonly Game[] = []): Promise<SaveGameResult> {
    const loaded = await this.load();
    if (!loaded.ok) return { ok: false, code: "persistence.revisionConflict", actualRevision: undefined };
    const actual = loaded.envelope?.revision;
    if (actual !== expectedRevision) return { ok: false, code: "persistence.revisionConflict", actualRevision: actual };
    const envelope = createEnvelope(game, (actual ?? 0) + 1, undefined, undoSnapshots);
    const db = await openDb();
    try {
      await requestAsPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(serializeEnvelope(envelope), KEY));
      return { ok: true, envelope };
    } finally { db.close(); }
  }
  async delete(): Promise<void> {
    const db = await openDb();
    try { await requestAsPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY)); }
    finally { db.close(); }
  }
}
