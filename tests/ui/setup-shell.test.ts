// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameSession } from "../../src/application/game-session.js";
import { MemoryGameRepository } from "../../src/application/memory-repository.js";
import { createEnvelope, serializeEnvelope } from "../../src/application/persistence.js";
import { createGame } from "../../src/domain/game/create-game.js";
import { act, getLegalActions, startHand } from "../../src/domain/game/hand-engine.js";
import { renderApp } from "../../src/ui/app.js";

const text = () => document.body.textContent;
const required = <T extends Element>(element: T | null): T => {
  if (element === null) throw new Error("Missing test element");
  return element;
};
const input = (name: string): HTMLInputElement => required(document.querySelector<HTMLInputElement>(`[name="${name}"]`));
const select = (name: string): HTMLSelectElement => required(document.querySelector<HTMLSelectElement>(`[name="${name}"]`));
const click = async (label: string): Promise<void> => {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent === label);
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const clickAction = async (action: string): Promise<void> => {
  required(document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const setAmount = (type: string, value: string): void => {
  const amount = required(document.querySelector<HTMLInputElement>(`[name="${type}-target"]`));
  amount.value = value;
  amount.dispatchEvent(new Event("input", { bubbles: true }));
};
const setInput = (selector: string, value: string): void => {
  const target = required(document.querySelector<HTMLInputElement>(selector));
  target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
};
const checkInput = (selector: string): void => {
  required(document.querySelector<HTMLInputElement>(selector)).click();
};

const fixtureGame = () => {
  const result = createGame({ id: "game-existing", smallBlind: 5, bigBlind: 10, initialDealerPlayerId: "player-1", players: [
    { id: "player-1", name: "Ada", avatar: "red", stack: 1000 },
    { id: "player-2", name: "Linus", avatar: "blue", stack: 1000 },
  ] });
  if (!result.ok) throw new Error("bad fixture");
  return result.value;
};


const showdownGame = () => {
  const game = fixtureGame();
  const started = startHand(game, { handId: "hand-showdown" });
  if (!started.ok) throw new Error("bad fixture");
  const hand = started.value.currentHand;
  if (hand === undefined) throw new Error("missing hand");
  return {
    ...started.value,
    currentHand: { ...hand, status: "showdown" as const, street: "river" as const },
  };
};

const sidePotShowdownGame = () => ({
  id: "game-side-pot",
  schemaVersion: 1 as const,
  status: "active" as const,
  settings: { smallBlind: 5, bigBlind: 10 },
  chipSupply: 300,
  players: [
    { id: "player-1", seat: 0, name: "Ada", avatar: "red" as const, stack: 50, status: "active" as const },
    { id: "player-2", seat: 1, name: "Linus", avatar: "blue" as const, stack: 0, status: "active" as const },
    { id: "player-3", seat: 2, name: "Grace", avatar: "green" as const, stack: 0, status: "active" as const },
  ],
  dealerPlayerId: "player-1",
  handNumber: 1,
  currentHand: {
    id: "hand-side-pot",
    number: 1,
    status: "showdown" as const,
    street: "river" as const,
    buttonPlayerId: "player-1",
    smallBlindPlayerId: "player-2",
    bigBlindPlayerId: "player-3",
    currentBet: 0,
    lastFullRaiseSize: 10,
    participants: [
      { playerId: "player-1", stackAtStart: 100, streetCommitment: 0, handCommitment: 50, folded: false, allIn: true, actedSinceFullRaise: true, raiseReopened: false },
      { playerId: "player-2", stackAtStart: 100, streetCommitment: 0, handCommitment: 100, folded: false, allIn: true, actedSinceFullRaise: true, raiseReopened: false },
      { playerId: "player-3", stackAtStart: 100, streetCommitment: 0, handCommitment: 100, folded: false, allIn: true, actedSinceFullRaise: true, raiseReopened: false },
    ],
    actions: [],
  },
  completedHands: [],
  auditLog: [],
});

const setup = async (repo = new MemoryGameRepository()) => {
  document.body.innerHTML = "<div id='app'></div>";
  const session = new GameSession(repo);
  await renderApp(required(document.querySelector<HTMLElement>("#app")), { session });
  return { session, repo };
};

describe("operator UI shell", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("presents setup validation issues, below-big-blind warnings, and chip supply preview", async () => {
    await setup();
    input("player-1-name").value = " Ada "; input("player-1-stack").value = "5";
    input("player-2-name").value = "ada"; input("player-2-stack").value = "1000";
    input("smallBlind").value = "10"; input("bigBlind").value = "10";
    input("player-1-name").dispatchEvent(new Event("input", { bubbles: true }));
    expect(text()).toContain("Total chip supply: 1005");
    expect(text()).toContain("Player 1 stack is below the big blind.");
    await click("Create game");
    expect(text()).toContain("Player names must be unique.");
    expect(text()).toContain("The small blind must be lower than the big blind.");
  });

  it("creates and persists a valid game through the session seam", async () => {
    const { session, repo } = await setup();
    input("player-1-name").value = " Ada "; input("player-2-name").value = "Linus";
    select("dealer").value = "player-2";
    await click("Create game");
    expect(session.current()?.dealerPlayerId).toBe("player-2");
    expect(session.current()?.players.map((p) => p.name)).toEqual(["Ada", "Linus"]);
    expect(repo.rawValue()).toBeDefined();
    expect(text()).toContain("Dealer: Linus");
  });

  it("loads a persisted game summary on app start", async () => {
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1))));
    expect(text()).toContain("Recovered saved game.");
    expect(text()).toContain("Ada");
    expect(text()).toContain("Blinds: 5/10");
  });

  it("fails closed for corrupt persisted state until destructive reset is confirmed", async () => {
    const { repo } = await setup(new MemoryGameRepository("{"));
    expect(text()).toContain("Recovery failed: persistence.parse");
    expect(text()).not.toContain("Create game");
    await click("Reset corrupted game");
    expect(repo.rawValue()).toBe("{");
    required(document.querySelector<HTMLInputElement>("[name='confirmReset']")).checked = true;
    await click("Reset corrupted game");
    expect(repo.rawValue()).toBeUndefined();
    expect(text()).toContain("Create game");
  });

  it("requires explicit confirmation before replacing an existing persisted game", async () => {
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1))));
    await click("New game");
    input("player-1-name").value = "Grace"; input("player-2-name").value = "Hopper";
    await click("Create game");
    expect(text()).toContain("Confirm replacement before creating a new game.");
    required(document.querySelector<HTMLInputElement>("[name='confirmReplace']")).checked = true;
    await click("Create game");
    expect(text()).toContain("Grace");
    expect(text()).not.toContain("Confirm replacement before creating a new game.");
  });

  it("starts a hand through the session seam, persists it, and reloads the same summary", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1)));
    const { session } = await setup(repo);
    await click("Start hand");
    expect(session.current()?.currentHand?.number).toBe(1);
    expect(repo.rawValue()).toBeDefined();
    expect(text()).toContain("Hand #1");
    expect(text()).toContain("Blinds: Ada / Linus");
    expect(document.querySelector("[aria-label='hand-progress']")).not.toBeNull();
    expect(text()).toContain("Pre-flop");
    expect(text()).toContain("Actor: Ada");
    expect(text()).toContain("AdaStack: 995Committed: 5Actor");
    expect(text()).not.toContain("Last full raise size:");
    await setup(repo);
    expect(text()).toContain("Recovered saved game.");
    expect(text()).toContain("Hand #1");
    expect(text()).toContain("Actor: Ada");
  });

  it("renders betting controls from domain legal actions and previews target plus incremental cost", async () => {
    const { session } = await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1))));
    await click("Start hand");
    const game = session.current();
    if (game === undefined) throw new Error("missing game");
    const legal = getLegalActions(game);
    expect(legal?.actions.map((action) => action.type)).toEqual(["fold", "allIn", "call", "raise"]);
    expect(document.querySelector("[data-action='bet']")).toBeNull();
    expect(document.querySelector("[data-action='check']")).toBeNull();
    expect(text()).toContain("Fold");
    expect(text()).toContain("Call 10 (+5)");
    expect(text()).toContain("All-in 1000 (+995)");
    setAmount("raise", "25");
    expect(text()).toContain("Raise target 25, cost 20");
  });

  it("submits fold, check, call, bet, raise, and all-in through GameSession and persists each", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1)));
    const { session } = await setup(repo);
    await click("Start hand");
    await clickAction("raise");
    expect(session.current()?.currentHand?.actions.at(-1)?.type).toBe("raise");
    expect(session.current()?.currentHand?.currentBet).toBe(20);
    expect(repo.rawValue()).toContain('"type":"raise"');
    await clickAction("call");
    expect(session.current()?.currentHand?.status).toBe("dealPrompt");
    expect(repo.rawValue()).toContain('"type":"call"');
    await click("Deal the flop");
    await clickAction("check");
    expect(session.current()?.currentHand?.actions.at(-1)?.type).toBe("check");
    setAmount("bet", "10");
    await clickAction("bet");
    expect(session.current()?.currentHand?.actions.at(-1)?.type).toBe("bet");
    await clickAction("allIn");
    expect(session.current()?.currentHand?.actions.at(-1)?.type).toBe("allIn");
    await clickAction("fold");
    expect(session.current()?.currentHand?.status).toBe("settled");
    expect(repo.rawValue()).toContain('"status":"settled"');
  });

  it("surfaces invalid action rejection without replacing current UI state", async () => {
    const game = fixtureGame();
    const started = startHand(game, { handId: "hand-fixed" });
    if (!started.ok) throw new Error("bad fixture");
    const { session } = await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(started.value, 1))));
    const before = session.current();
    const button = required(document.querySelector<HTMLButtonElement>("[data-action='call']"));
    button.dataset.action = "check";
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(text()).toContain("That action is not legal.");
    expect(session.current()).toBe(before);
    expect(text()).toContain("Actor: Ada");
  });

  it("undoes the last undoable command through the session seam and persists the restored game", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1)));
    const { session } = await setup(repo);
    await click("Start hand");
    expect(required(document.querySelector<HTMLButtonElement>("[data-action='undo']")).disabled).toBe(true);
    await clickAction("raise");
    expect(session.undoDepth()).toBe(1);
    expect(text()).toContain("Undo last action");
    expect(text()).toContain("Last reversible action: Ada raise for 15 chips");
    expect(required(document.querySelector<HTMLButtonElement>("[data-action='undo']")).disabled).toBe(true);
    checkInput("[name='confirmUndo']");
    expect(required(document.querySelector<HTMLButtonElement>("[data-action='undo']")).disabled).toBe(false);
    await clickAction("undo");
    expect(session.undoDepth()).toBe(0);
    expect(session.current()?.currentHand?.actions).toEqual([]);
    expect(repo.rawValue()).toContain('"type":"undo"');
    expect(text()).toContain("Action log: none");
    expect(required(document.querySelector<HTMLButtonElement>("[data-action='undo']")).disabled).toBe(true);
  });

  it("corrects stacks through the session seam with a reason and persisted audit entry", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1)));
    const { session } = await setup(repo);
    setInput("[name='correction-player-1']", "900");
    setInput("[name='correction-player-2']", "1100");
    setInput("[name='correction-reason']", "chip count");
    await clickAction("correct-stacks");
    expect(session.current()?.players.map(({ stack }) => stack)).toEqual([900, 1100]);
    expect(repo.rawValue()).toContain('"type":"stackCorrection"');
    expect(repo.rawValue()).toContain('"reason":"chip count"');
    expect(text()).toContain("AdaStack: 900Committed: 0Live");
    expect(text()).toContain("LinusStack: 1100Committed: 0Live");
    expect(text()).toContain("#1 stackCorrection - chip count");
  });

  it("surfaces rejected stack corrections without replacing current UI state", async () => {
    const { session } = await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(fixtureGame(), 1))));
    const before = session.current();
    setInput("[name='correction-player-1']", "900");
    setInput("[name='correction-player-2']", "1000");
    setInput("[name='correction-reason']", "bad count");
    expect(text()).toContain("Correction preview does not preserve total chip supply.");
    expect(required(document.querySelector<HTMLButtonElement>("[data-action='correct-stacks']")).disabled).toBe(true);
    expect(session.current()).toBe(before);
    expect(text()).toContain("AdaStack: 1000Committed: 0Live");
  });

  it("confirms pending street prompts through the session seam and persists advancement", async () => {
    const game = fixtureGame();
    const started = startHand(game, { handId: "hand-fixed" });
    if (!started.ok) throw new Error("bad fixture");
    const called = act(started.value, { playerId: "player-1", type: "call" });
    if (!called.ok) throw new Error("bad call");
    const checked = act(called.value, { playerId: "player-2", type: "check" });
    if (!checked.ok) throw new Error("bad check");
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(checked.value, 1)));
    const { session } = await setup(repo);
    expect(text()).toContain("Ready to deal flop");
    await click("Deal the flop");
    expect(session.current()?.currentHand?.street).toBe("flop");
    expect(repo.rawValue()).toContain('"street":"flop"');
  });

  it("renders no betting controls when no current actor exists", async () => {
    const game = fixtureGame();
    const started = startHand(game, { handId: "hand-fixed" });
    if (!started.ok) throw new Error("bad fixture");
    const called = act(started.value, { playerId: "player-1", type: "call" });
    if (!called.ok) throw new Error("bad call");
    const checked = act(called.value, { playerId: "player-2", type: "check" });
    if (!checked.ok) throw new Error("bad check");
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(checked.value, 1))));
    expect(text()).toContain("Ready: Flop");
    expect(document.querySelector("[aria-label='betting-actions']")).toBeNull();
  });
  it("renders showdown derived pots and eligible players only", async () => {
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(sidePotShowdownGame(), 1))));
    expect(text()).toContain("Pot 1 - 150 chips");
    expect(text()).toContain("Pot 2 - 100 chips");
    const pot2 = required(document.querySelector<HTMLElement>("[data-pot-index='1']"));
    expect(pot2.textContent).not.toContain("Ada");
    expect(pot2.textContent).toContain("Linus");
    expect(pot2.textContent).toContain("Grace");
  });

  it("settles a single showdown pot through the session seam and renders result state", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(showdownGame(), 1)));
    const { session } = await setup(repo);
    checkInput("[name='pot-0-winner'][value='player-1']");
    await clickAction("settle-showdown");
    expect(session.current()?.currentHand?.status).toBe("settled");
    expect(repo.rawValue()).toContain('"awards"');
    expect(text()).toContain("Showdown result");
    expect(text()).toContain("Pot 1 - 10 chips - awards Ada 10");
    expect(text()).toContain("Start hand");
  });

  it("settles side and split pots, persists, and renders awards", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(sidePotShowdownGame(), 1)));
    await setup(repo);
    checkInput("[name='pot-0-winner'][value='player-1']");
    checkInput("[name='pot-0-winner'][value='player-2']");
    checkInput("[name='pot-1-winner'][value='player-3']");
    await clickAction("settle-showdown");
    expect(repo.rawValue()).toContain('"potIndex":1');
    expect(text()).toContain("Pot 1 - 150 chips - awards Ada 75, Linus 75");
    expect(text()).toContain("Pot 2 - 100 chips - awards Grace 100");
  });

  it("surfaces invalid showdown rejection without replacing current UI state", async () => {
    const { session } = await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(showdownGame(), 1))));
    const before = session.current();
    checkInput("[name='pot-0-winner'][value='player-1']");
    setInput("[name='pot-0-allocation-player-1']", "1");
    await clickAction("settle-showdown");
    expect(text()).toContain("Allocations must equal the pot amount.");
    expect(session.current()).toBe(before);
    expect(text()).toContain("Showdown settlement");
    expect(required(document.querySelector<HTMLInputElement>("[name='pot-0-winner'][value='player-1']")).checked).toBe(true);
    expect(required(document.querySelector<HTMLInputElement>("[name='pot-0-allocation-player-1']")).value).toBe("1");
  });

  it("reloads at showdown with the same settlement prompt", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(sidePotShowdownGame(), 1)));
    await setup(repo);
    await setup(repo);
    expect(text()).toContain("Recovered saved game.");
    expect(text()).toContain("Showdown settlement");
    expect(text()).toContain("Pot 2 - 100 chips");
  });

  it("reloads after settlement with the same result summary", async () => {
    const repo = new MemoryGameRepository(serializeEnvelope(createEnvelope(showdownGame(), 1)));
    await setup(repo);
    checkInput("[name='pot-0-winner'][value='player-2']");
    await clickAction("settle-showdown");
    await setup(repo);
    expect(text()).toContain("Recovered saved game.");
    expect(text()).toContain("Showdown result");
    expect(text()).toContain("Pot 1 - 10 chips - awards Linus 10");
  });

  it("renders completed final winner and no start-hand or betting controls", async () => {
    const base = sidePotShowdownGame();
    const completed = { ...base, status: "completed" as const, players: [
      { id: "player-1", seat: 0, name: "Ada", avatar: "red" as const, stack: 0, status: "busted" as const },
      { id: "player-2", seat: 1, name: "Linus", avatar: "blue" as const, stack: 300, status: "active" as const },
      { id: "player-3", seat: 2, name: "Grace", avatar: "green" as const, stack: 0, status: "busted" as const },
    ], currentHand: { ...base.currentHand, status: "settled" as const, pots: [{ amount: 300, eligiblePlayerIds: ["player-2"] }], awards: [{ potIndex: 0, allocations: { "player-2": 300 } }], participants: base.currentHand.participants.map((p) => ({ ...p, streetCommitment: 0, handCommitment: 0 })) } };
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(completed, 1))));
    expect(text()).toContain("Game completed");
    expect(text()).toContain("Final winner: Linus");
    expect(text()).not.toContain("Start hand");
    expect(document.querySelector("[aria-label='betting-actions']")).toBeNull();
  });

  it("keeps uncontested settlement result rendered without showdown controls", async () => {
    const game = fixtureGame();
    const started = startHand(game, { handId: "hand-fixed" });
    if (!started.ok) throw new Error("bad fixture");
    const folded = act(started.value, { playerId: "player-1", type: "fold" });
    if (!folded.ok) throw new Error("bad fold");
    await setup(new MemoryGameRepository(serializeEnvelope(createEnvelope(folded.value, 1))));
    expect(text()).toContain("Uncontested winner: Linus");
    expect(text()).toContain("Pot amount: 15");
    expect(text()).not.toContain("Showdown settlement");
  });


});
