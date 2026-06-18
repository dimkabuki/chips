// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GameSession } from "../../src/application/game-session.js";
import { MemoryGameRepository } from "../../src/application/memory-repository.js";
import { createEnvelope, serializeEnvelope } from "../../src/application/persistence.js";
import { createGame } from "../../src/domain/game/create-game.js";
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

const fixtureGame = () => {
  const result = createGame({ id: "game-existing", smallBlind: 5, bigBlind: 10, initialDealerPlayerId: "player-1", players: [
    { id: "player-1", name: "Ada", avatar: "red", stack: 1000 },
    { id: "player-2", name: "Linus", avatar: "blue", stack: 1000 },
  ] });
  if (!result.ok) throw new Error("bad fixture");
  return result.value;
};

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
});
