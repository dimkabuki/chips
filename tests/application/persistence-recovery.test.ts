import { describe, expect, it } from "vitest";
import { GameSession } from "../../src/application/game-session.js";
import { MemoryGameRepository } from "../../src/application/memory-repository.js";
import { checksumGame, createEnvelope, serializeEnvelope } from "../../src/application/persistence.js";
import { AVATARS, createGame, type CreatePlayerInput } from "../../src/domain/game/create-game.js";
import { act, confirmStreet, getLegalActions, settleShowdown, startHand } from "../../src/domain/game/hand-engine.js";
import type { Game } from "../../src/domain/game/game.js";

const fixture = (count = 4): Game => {
  const players: CreatePlayerInput[] = Array.from({ length: count }, (_, i) => ({ id: `player-${String(i + 1)}`, name: `Player ${String(i + 1)}`, avatar: AVATARS[i % AVATARS.length] ?? AVATARS[0], stack: 1_000 }));
  const result = createGame({ id: "game-1", smallBlind: 5, bigBlind: 10, initialDealerPlayerId: "player-1", players });
  if (!result.ok) throw new Error("bad fixture");
  return result.value;
};
const ok = (result: { readonly ok: true; readonly value: Game } | { readonly ok: false; readonly errors: readonly { readonly code: string }[] }): Game => {
  if (!result.ok) throw new Error(result.errors[0]?.code);
  return result.value;
};
const legalTypes = (game: Game): readonly string[] => getLegalActions(game)?.actions.map(({ type }) => type) ?? [];

describe("persistence and recovery", () => {
  it("round-trips a checked envelope and rejects stale revision saves", async () => {
    const repo = new MemoryGameRepository();
    const save1 = await repo.save(fixture(), undefined);
    expect(save1).toMatchObject({ ok: true, envelope: { revision: 1 } });
    const save2 = await repo.save(fixture(), undefined);
    expect(save2).toEqual({ ok: false, code: "persistence.revisionConflict", actualRevision: 1 });
    const loaded = await repo.load();
    expect(loaded).toMatchObject({ ok: true, envelope: { revision: 1, game: fixture() } });
  });

  it.each([
    ["truncated JSON", "{" , "persistence.parse"],
    ["checksum-invalid", serializeEnvelope({ ...createEnvelope(fixture(), 1), checksum: "bad" }), "persistence.checksum"],
    ["migration-invalid", JSON.stringify({ ...createEnvelope(fixture(), 1), game: { schemaVersion: 0 } }), "persistence.migration"],
    ["invariant-invalid", serializeEnvelope(createEnvelope({ ...fixture(), players: fixture().players.map((p) => ({ ...p, stack: 1 })) }, 1)), "persistence.invariant"],
  ])("fails closed for %s", async (_name, raw, code) => {
    const repo = new MemoryGameRepository(raw);
    await expect(repo.load()).resolves.toMatchObject({ ok: false, code });
  });

  it("reloads equivalent legal actions and state across current hand states", async () => {
    const betting = ok(startHand(fixture(2), { handId: "hand-1" }));
    let dealPrompt = ok(act(betting, { playerId: "player-1", type: "call" }));
    dealPrompt = ok(act(dealPrompt, { playerId: "player-2", type: "check" }));
    let showdown = ok(confirmStreet(dealPrompt));
    showdown = ok(act(showdown, { playerId: "player-2", type: "allIn" }));
    showdown = ok(act(showdown, { playerId: "player-1", type: "call" }));
    const settled = ok(settleShowdown(showdown, [{ potIndex: 0, winnerPlayerIds: ["player-1"] }]));
    const completed = ok(settleShowdown(ok(act(ok(act(betting, { playerId: "player-1", type: "allIn" })), { playerId: "player-2", type: "call" })), [{ potIndex: 0, winnerPlayerIds: ["player-1"] }]));

    for (const game of [betting, dealPrompt, showdown, settled, completed]) {
      const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(game, 1)));
      const loaded = await repo.load();
      expect(loaded).toMatchObject({ ok: true, envelope: { game } });
      if (loaded.ok && loaded.envelope !== undefined) expect(legalTypes(loaded.envelope.game)).toEqual(legalTypes(game));
    }
  });

  it("undoes only latest 3 operator betting/street actions, not settlement, and stack correction audits and clears undo", async () => {
    const repo = new MemoryGameRepository();
    const session = new GameSession(repo);
    await session.replace(fixture(3));
    await session.startHand({ handId: "hand-1" });
    const afterStart = session.current();
    await session.act({ playerId: "player-1", type: "call" });
    await session.act({ playerId: "player-2", type: "call" });
    await session.act({ playerId: "player-3", type: "check" });
    expect(session.undoDepth()).toBe(3);
    await session.undo();
    expect(session.current()?.currentHand?.actorPlayerId).toBe("player-3");
    expect(session.current()?.auditLog.at(-1)).toMatchObject({ type: "undo" });
    await session.correctStacks({ reason: "operator count", stacks: { "player-1": 980, "player-2": 990, "player-3": 1_000 } });
    expect(session.undoDepth()).toBe(0);
    expect(session.current()?.auditLog.at(-1)).toMatchObject({ type: "stackCorrection", reason: "operator count" });
    expect(session.current()?.currentHand?.actorPlayerId).toBe("player-3");
    expect(session.current()?.currentHand?.street).toBe(afterStart?.currentHand?.street);

    const settledSession = new GameSession(new MemoryGameRepository());
    await settledSession.replace(fixture(2));
    await settledSession.startHand({ handId: "hand-1" });
    await settledSession.act({ playerId: "player-1", type: "allIn" });
    await settledSession.act({ playerId: "player-2", type: "call" });
    expect(settledSession.undoDepth()).toBe(2);
    await settledSession.settleShowdown([{ potIndex: 0, winnerPlayerIds: ["player-1"] }]);
    expect(settledSession.undoDepth()).toBe(0);
  });


  it("persists undo history across reload and undo persists restored state", async () => {
    const repo = new MemoryGameRepository();
    const session = new GameSession(repo);
    await session.replace(fixture(3));
    await session.startHand({ handId: "hand-1" });
    await session.act({ playerId: "player-1", type: "call" });
    await session.act({ playerId: "player-2", type: "call" });
    expect(session.undoDepth()).toBe(2);

    const reloaded = new GameSession(repo);
    await reloaded.load();
    expect(reloaded.undoDepth()).toBe(2);
    await reloaded.undo();
    expect(reloaded.current()?.currentHand?.actions.map(({ type }) => type)).toEqual(["call"]);
    expect(reloaded.current()?.auditLog.at(-1)).toMatchObject({ type: "undo" });

    const reloadedAgain = new GameSession(repo);
    await reloadedAgain.load();
    expect(reloadedAgain.current()?.currentHand?.actions.map(({ type }) => type)).toEqual(["call"]);
    expect(reloadedAgain.undoDepth()).toBe(1);
  });

  it("persists only the latest 3 undo snapshots", async () => {
    const repo = new MemoryGameRepository();
    const session = new GameSession(repo);
    await session.replace(fixture(2));
    await session.startHand({ handId: "hand-1" });
    await session.act({ playerId: "player-1", type: "call" });
    await session.act({ playerId: "player-2", type: "check" });
    await session.confirmStreet();
    await session.act({ playerId: "player-2", type: "check" });
    expect(session.undoDepth()).toBe(3);
    const reloaded = new GameSession(repo);
    await reloaded.load();
    expect(reloaded.undoDepth()).toBe(3);
  });

  it("clears persisted undo for new hand, settlement, stack correction, reset, and replace", async () => {
    const repo = new MemoryGameRepository();
    const session = new GameSession(repo);
    await session.replace(fixture(2));
    await session.startHand({ handId: "hand-1" });
    await session.act({ playerId: "player-1", type: "call" });
    await session.correctStacks({ reason: "count", stacks: { "player-1": 990, "player-2": 990 } });
    const afterCorrection = new GameSession(repo);
    await afterCorrection.load();
    expect(afterCorrection.undoDepth()).toBe(0);

    await session.replace(fixture(2));
    await session.startHand({ handId: "hand-2" });
    await session.act({ playerId: "player-1", type: "allIn" });
    await session.act({ playerId: "player-2", type: "call" });
    expect(session.undoDepth()).toBe(2);
    await session.settleShowdown([{ potIndex: 0, winnerPlayerIds: ["player-1"] }]);
    const afterSettlement = new GameSession(repo);
    await afterSettlement.load();
    expect(afterSettlement.undoDepth()).toBe(0);

    await session.startHand({ handId: "hand-3" });
    const afterNewHand = new GameSession(repo);
    await afterNewHand.load();
    expect(afterNewHand.undoDepth()).toBe(0);

    await session.replace(fixture(2));
    await session.startHand({ handId: "hand-5" });
    await session.act({ playerId: session.current()?.currentHand?.actorPlayerId ?? "player-1", type: "call" });
    expect(session.undoDepth()).toBe(1);
    await session.replace(fixture(2));
    const afterReplace = new GameSession(repo);
    await afterReplace.load();
    expect(afterReplace.undoDepth()).toBe(0);

    await session.startHand({ handId: "hand-6" });
    await session.act({ playerId: "player-1", type: "call" });
    expect(session.undoDepth()).toBe(1);
    await session.reset();
    await session.load();
    expect(session.undoDepth()).toBe(0);
  });

  it("requires correction reasons and preserves chip supply including commitments", async () => {
    const game = ok(startHand(fixture(3), { handId: "hand-1" }));
    const session = new GameSession(new MemoryGameRepository());
    await session.replace(game);
    await expect(session.correctStacks({ reason: "", stacks: { "player-1": 1_000 } })).resolves.toMatchObject({ ok: false, errors: [{ code: "correction.reason.required" }] });
    await expect(session.correctStacks({ reason: "bad count", stacks: { "player-1": 2_000 } })).resolves.toMatchObject({ ok: false, errors: [{ code: "correction.chips.conserved" }] });
  });

  it("uses checksum over game content only", () => {
    expect(checksumGame(fixture())).toBe(checksumGame(fixture()));
  });
});
