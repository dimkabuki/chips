import type { GameSession } from "../application/game-session.js";
import type { LoadGameResult } from "../application/persistence.js";
import type { Game, Hand } from "../domain/game/game.js";
import { AVATARS, createGame, type ValidationIssue } from "../domain/game/create-game.js";
import { defaultSetupForm, previewSetup, toCreateGameInput, type SetupForm } from "./setup.js";

export interface RenderAppOptions { readonly session: GameSession; }

type Screen = "loading" | "setup" | "active" | "recoveryError";

interface State {
  screen: Screen;
  form: SetupForm;
  errors: readonly ValidationIssue[];
  recoveryCode?: string;
  recovered: boolean;
  replacing: boolean;
  replacementRequired: boolean;
}

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;")
  .replaceAll("'", "&#39;");

const issueLabel = (issue: ValidationIssue): string => {
  if (issue.code === "players.stack.belowBigBlind" && issue.playerId !== undefined) {
    return `Player ${String(Number(issue.playerId.replace("player-", "")))} stack is below the big blind.`;
  }
  return issue.message;
};

const handSummary = (hand: Hand | undefined): string => {
  if (hand === undefined) return "Current hand: none";
  return `Current hand: #${String(hand.number)} ${hand.status} ${hand.street}`;
};

const gameSummary = (game: Game, recovered: boolean): string => {
  const dealer = game.players.find((p) => p.id === game.dealerPlayerId)?.name ?? game.dealerPlayerId;
  const players = game.players.map((p) => `<li>${String(p.seat + 1)}. ${escapeHtml(p.name)} (${p.avatar}) - stack ${String(p.stack)} - ${p.status}</li>`).join("");
  return `${recovered ? "<p role='status'>Recovered saved game.</p>" : ""}<section aria-label='active-game'><h2>Active game</h2><p>Status: ${game.status}</p><p>Dealer: ${escapeHtml(dealer)}</p><p>Blinds: ${String(game.settings.smallBlind)}/${String(game.settings.bigBlind)}</p><p>${handSummary(game.currentHand)}</p><ul>${players}</ul><button type='button' data-action='new-game'>New game</button></section>`;
};

const formFromDom = (root: HTMLElement, current: SetupForm): SetupForm => ({
  smallBlind: root.querySelector<HTMLInputElement>("[name='smallBlind']")?.value ?? current.smallBlind,
  bigBlind: root.querySelector<HTMLInputElement>("[name='bigBlind']")?.value ?? current.bigBlind,
  dealerPlayerId: root.querySelector<HTMLSelectElement>("[name='dealer']")?.value ?? current.dealerPlayerId,
  players: current.players.map((player, index) => {
    const seat = String(index + 1);
    return {
      name: root.querySelector<HTMLInputElement>(`[name='player-${seat}-name']`)?.value ?? player.name,
      avatar: root.querySelector<HTMLSelectElement>(`[name='player-${seat}-avatar']`)?.value ?? player.avatar,
      stack: root.querySelector<HTMLInputElement>(`[name='player-${seat}-stack']`)?.value ?? player.stack,
    };
  }),
});

const setupHtml = (state: State): string => {
  const preview = previewSetup(state.form);
  const playerRows = state.form.players.map((player, index) => {
    const seat = String(index + 1);
    const id = `player-${seat}`;
    return `<fieldset><legend>Player ${seat}</legend><input name='${id}-name' value='${escapeHtml(player.name)}' aria-label='Player ${seat} name'><select name='${id}-avatar'>${AVATARS.map((a) => `<option value='${a}' ${a === player.avatar ? "selected" : ""}>${a}</option>`).join("")}</select><input name='${id}-stack' value='${escapeHtml(player.stack)}' inputmode='numeric' aria-label='Player ${seat} stack'></fieldset>`;
  }).join("");
  const dealerOptions = state.form.players.map((_p, index) => {
    const playerId = `player-${String(index + 1)}`;
    return `<option value='${playerId}' ${state.form.dealerPlayerId === playerId ? "selected" : ""}>Player ${String(index + 1)}</option>`;
  }).join("");
  const issues = [...state.errors.map(issueLabel), ...preview.warnings.map(issueLabel), ...(state.replacementRequired ? ["Confirm replacement before creating a new game."] : [])];
  return `<section aria-label='setup'><h1>Chips operator</h1><div role='alert'>${issues.map((i) => `<p>${escapeHtml(i)}</p>`).join("")}</div>${playerRows}<label>Small blind <input name='smallBlind' value='${escapeHtml(state.form.smallBlind)}'></label><label>Big blind <input name='bigBlind' value='${escapeHtml(state.form.bigBlind)}'></label><label>Initial dealer <select name='dealer'>${dealerOptions}</select></label><p>Total chip supply: ${String(preview.totalChipSupply)}</p><button type='button' data-action='add-player' ${state.form.players.length >= 8 ? "disabled" : ""}>Add player</button><button type='button' data-action='remove-player' ${state.form.players.length <= 2 ? "disabled" : ""}>Remove player</button>${state.replacing ? "<label><input type='checkbox' name='confirmReplace'> Confirm replacing the saved game</label>" : ""}<button type='button' data-action='create'>Create game</button></section>`;
};

const saveErrorMessage = (saved: Awaited<ReturnType<GameSession["replace"]>>): string => {
  if (saved.ok) return "";
  if ("code" in saved && saved.code === "persistence.revisionConflict") return "The saved game changed before replacement.";
  if ("errors" in saved) return saved.errors[0]?.message ?? "The game could not be saved.";
  return "The game could not be saved.";
};

export const renderApp = async (root: HTMLElement, { session }: RenderAppOptions): Promise<void> => {
  const state: State = { screen: "loading", form: defaultSetupForm(), errors: [], recovered: false, replacing: false, replacementRequired: false };
  const draw = (): void => {
    const game = session.current();
    if (state.screen === "active" && game !== undefined) root.innerHTML = gameSummary(game, state.recovered);
    else if (state.screen === "recoveryError") root.innerHTML = `<section role='alert'><p>Recovery failed: ${state.recoveryCode ?? "unknown"}</p><label><input type='checkbox' name='confirmReset'> Confirm destructive reset</label><button type='button' data-action='reset-corrupt'>Reset corrupted game</button></section>`;
    else root.innerHTML = setupHtml(state);
  };
  const loaded: LoadGameResult = await session.load();
  if (!loaded.ok) { state.screen = "recoveryError"; state.recoveryCode = loaded.code; }
  else if (loaded.envelope !== undefined) { state.screen = "active"; state.recovered = true; }
  else state.screen = "setup";
  draw();

  root.addEventListener("input", () => {
    if (state.screen === "setup") { state.form = formFromDom(root, state.form); state.errors = []; state.replacementRequired = false; draw(); }
  });
  root.addEventListener("click", (event) => { void handleClick(event); });

  const handleClick = async (event: MouseEvent): Promise<void> => {
    const target = event.target instanceof HTMLElement ? event.target : undefined;
    const action = target?.dataset.action;
    if (action === "add-player") {
      const next = state.form.players.length + 1;
      if (next <= 8) state.form = { ...state.form, players: [...state.form.players, { name: `Player ${String(next)}`, avatar: AVATARS[(next - 1) % AVATARS.length] ?? AVATARS[0], stack: "1000" }] };
      draw(); return;
    }
    if (action === "remove-player") {
      if (state.form.players.length > 2) state.form = { ...state.form, players: state.form.players.slice(0, -1), dealerPlayerId: state.form.dealerPlayerId === `player-${String(state.form.players.length)}` ? "player-1" : state.form.dealerPlayerId };
      draw(); return;
    }
    if (action === "new-game") { state.screen = "setup"; state.replacing = session.current() !== undefined; state.recovered = false; state.errors = []; draw(); return; }
    if (action === "reset-corrupt") {
      if (!root.querySelector<HTMLInputElement>("[name='confirmReset']")?.checked) return;
      await session.reset(); state.screen = "setup"; delete state.recoveryCode; draw(); return;
    }
    if (action !== "create") return;
    state.form = formFromDom(root, state.form);
    if (state.replacing && !root.querySelector<HTMLInputElement>("[name='confirmReplace']")?.checked) { state.replacementRequired = true; draw(); return; }
    const result = createGame(toCreateGameInput(state.form, `game-${Date.now().toString()}`));
    if (!result.ok) { state.errors = result.errors; draw(); return; }
    const saved = await session.replace(result.value);
    if (!saved.ok) { state.errors = [{ code: "setup.persistence", message: saveErrorMessage(saved) }]; draw(); return; }
    state.screen = "active"; state.recovered = false; state.replacing = false; state.errors = []; state.replacementRequired = false; draw();
  };
};
