import type { GameSession } from "../application/game-session.js";
import type { LoadGameResult } from "../application/persistence.js";
import type { Game, Hand, HandParticipant } from "../domain/game/game.js";
import { AVATARS, createGame, type ValidationIssue } from "../domain/game/create-game.js";
import { getLegalActions, type LegalAction, type PlayerActionType } from "../domain/game/hand-engine.js";
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
  commandErrors: readonly string[];
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

const playerName = (game: Game, playerId: string | undefined): string => {
  if (playerId === undefined) return "none";
  return game.players.find((player) => player.id === playerId)?.name ?? playerId;
};

const participantRow = (game: Game, participant: HandParticipant): string => {
  const player = game.players.find(({ id }) => id === participant.playerId);
  return `<li>${String((player?.seat ?? 0) + 1)}. ${escapeHtml(player?.name ?? participant.playerId)} - stack ${String(player?.stack ?? 0)} - street ${String(participant.streetCommitment)} - hand ${String(participant.handCommitment)} - ${participant.folded ? "folded" : "live"} - ${participant.allIn ? "all-in" : "not all-in"}</li>`;
};

const actionLog = (game: Game, hand: Hand): string => hand.actions.length === 0
  ? "<p>Action log: none</p>"
  : `<ol aria-label='action-log'>${hand.actions.map((action) => `<li>#${String(action.sequence)} ${escapeHtml(playerName(game, action.playerId))} ${action.type} target ${String(action.targetStreetCommitment)} cost ${String(action.chipsAdded)} stack ${String(action.resultingStack)}</li>`).join("")}</ol>`;

const amountInput = (type: "bet" | "raise", action: Extract<LegalAction, { minTarget: number }>, hand: Hand): string => {
  const current = String(action.minTarget);
  const actor = hand.participants.find(({ playerId }) => playerId === hand.actorPlayerId);
  const cost = action.minTarget - (actor?.streetCommitment ?? 0);
  return `<label>${type === "bet" ? "Bet" : "Raise"} target <input name='${type}-target' value='${current}' inputmode='numeric' data-amount-type='${type}'></label><p data-preview='${type}'>${type === "bet" ? "Bet" : "Raise"} target ${current}, cost ${String(cost)}</p><button type='button' data-action='${type}'>${type === "bet" ? "Bet" : "Raise"}</button>`;
};

const bettingControls = (game: Game): string => {
  const legal = getLegalActions(game);
  const hand = game.currentHand;
  if (legal === undefined || hand === undefined) return "";
  const buttons = legal.actions.map((action) => {
    if (action.type === "fold") return "<button type='button' data-action='fold'>Fold</button>";
    if (action.type === "check") return "<button type='button' data-action='check'>Check</button>";
    if (action.type === "call") return `<button type='button' data-action='call'>Call ${String(action.targetStreetCommitment)} (+${String(action.chipsAdded)})</button>`;
    if (action.type === "allIn") return `<button type='button' data-action='allIn'>All-in ${String(action.targetStreetCommitment)} (+${String(action.chipsAdded)})</button>`;
    return amountInput(action.type, action, hand);
  }).join("");
  return `<section aria-label='betting-actions'><h3>Actions for ${escapeHtml(playerName(game, legal.playerId))}</h3>${buttons}</section>`;
};

const handSummary = (game: Game): string => {
  const hand = game.currentHand;
  if (hand === undefined) return "<p>Current hand: none</p>";
  const transition = hand.status === "dealPrompt" && hand.pendingTransition !== undefined
    ? `<section aria-label='street-transition'><p>Ready to deal ${hand.pendingTransition}</p><button type='button' data-action='confirm-street'>Deal the ${hand.pendingTransition}</button></section>`
    : "";
  return `<section aria-label='current-hand'><h3>Hand #${String(hand.number)}</h3><p>Button: ${escapeHtml(playerName(game, hand.buttonPlayerId))}</p><p>Small blind: ${escapeHtml(playerName(game, hand.smallBlindPlayerId))}</p><p>Big blind: ${escapeHtml(playerName(game, hand.bigBlindPlayerId))}</p><p>Street: ${hand.street}</p><p>Hand status: ${hand.status}</p><p>Current actor: ${escapeHtml(hand.status === "betting" ? playerName(game, hand.actorPlayerId) : "none")}</p><p>Current bet: ${String(hand.currentBet)}</p><p>Last full raise size: ${String(hand.lastFullRaiseSize)}</p><ul aria-label='participants'>${hand.participants.map((participant) => participantRow(game, participant)).join("")}</ul>${actionLog(game, hand)}${transition}${bettingControls(game)}</section>`;
};

const gameSummary = (game: Game, recovered: boolean, commandErrors: readonly string[]): string => {
  const dealer = game.players.find((p) => p.id === game.dealerPlayerId)?.name ?? game.dealerPlayerId;
  const players = game.players.map((p) => `<li>${String(p.seat + 1)}. ${escapeHtml(p.name)} (${p.avatar}) - stack ${String(p.stack)} - ${p.status}</li>`).join("");
  const canStart = game.status === "active" && game.currentHand === undefined;
  const start = canStart ? "<button type='button' data-action='start-hand'>Start hand</button>" : "";
  return `${recovered ? "<p role='status'>Recovered saved game.</p>" : ""}<section aria-label='active-game'><h2>Active game</h2><div role='alert'>${commandErrors.map((error) => `<p>${escapeHtml(error)}</p>`).join("")}</div><p>Status: ${game.status}</p><p>Dealer: ${escapeHtml(dealer)}</p><p>Blinds: ${String(game.settings.smallBlind)}/${String(game.settings.bigBlind)}</p>${handSummary(game)}<ul>${players}</ul>${start}<button type='button' data-action='new-game'>New game</button></section>`;
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
  const state: State = { screen: "loading", form: defaultSetupForm(), errors: [], recovered: false, replacing: false, replacementRequired: false, commandErrors: [] };
  const draw = (): void => {
    const game = session.current();
    if (state.screen === "active" && game !== undefined) root.innerHTML = gameSummary(game, state.recovered, state.commandErrors);
    else if (state.screen === "recoveryError") root.innerHTML = `<section role='alert'><p>Recovery failed: ${state.recoveryCode ?? "unknown"}</p><label><input type='checkbox' name='confirmReset'> Confirm destructive reset</label><button type='button' data-action='reset-corrupt'>Reset corrupted game</button></section>`;
    else root.innerHTML = setupHtml(state);
  };
  const loaded: LoadGameResult = await session.load();
  if (!loaded.ok) { state.screen = "recoveryError"; state.recoveryCode = loaded.code; }
  else if (loaded.envelope !== undefined) { state.screen = "active"; state.recovered = true; }
  else state.screen = "setup";
  draw();

  root.addEventListener("input", (event) => {
    if (state.screen === "setup") { state.form = formFromDom(root, state.form); state.errors = []; state.replacementRequired = false; draw(); }
    else if (state.screen === "active") {
      const amount = event.target instanceof HTMLInputElement ? event.target : undefined;
      const type = amount?.dataset.amountType;
      const game = session.current();
      const hand = game?.currentHand;
      const actor = hand?.participants.find(({ playerId }) => playerId === hand.actorPlayerId);
      if ((type === "bet" || type === "raise") && hand !== undefined && actor !== undefined) {
        const value = Number(amount?.value ?? 0);
        const preview = root.querySelector<HTMLElement>(`[data-preview='${type}']`);
        if (preview !== null) preview.textContent = `${type === "bet" ? "Bet" : "Raise"} target ${String(value)}, cost ${String(value - actor.streetCommitment)}`;
      }
    }
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
    if (action === "new-game") { state.screen = "setup"; state.replacing = session.current() !== undefined; state.recovered = false; state.errors = []; state.commandErrors = []; draw(); return; }
    if (action === "reset-corrupt") {
      if (!root.querySelector<HTMLInputElement>("[name='confirmReset']")?.checked) return;
      await session.reset(); state.screen = "setup"; delete state.recoveryCode; draw(); return;
    }
    if (action === "start-hand") {
      const result = await session.startHand({ handId: `hand-${Date.now().toString()}` });
      state.commandErrors = result.ok ? [] : [saveErrorMessage(result)];
      draw(); return;
    }
    if (action === "confirm-street") {
      const result = await session.confirmStreet();
      state.commandErrors = result.ok ? [] : [saveErrorMessage(result)];
      draw(); return;
    }
    const actionTypes: readonly PlayerActionType[] = ["fold", "check", "call", "bet", "raise", "allIn"];
    if (action !== undefined && actionTypes.includes(action as PlayerActionType)) {
      const game = session.current();
      const playerId = game?.currentHand?.actorPlayerId;
      if (playerId === undefined) return;
      const targetName = action === "bet" || action === "raise" ? `${action}-target` : undefined;
      const rawTarget = targetName === undefined ? undefined : root.querySelector<HTMLInputElement>(`[name='${targetName}']`)?.value;
      const targetStreetCommitment = rawTarget === undefined ? undefined : Number(rawTarget);
      const result = await session.act({ playerId, type: action as PlayerActionType, ...(targetStreetCommitment === undefined ? {} : { targetStreetCommitment }) });
      state.commandErrors = result.ok ? [] : [saveErrorMessage(result)];
      draw(); return;
    }
    if (action !== "create") return;
    state.form = formFromDom(root, state.form);
    if (state.replacing && !root.querySelector<HTMLInputElement>("[name='confirmReplace']")?.checked) { state.replacementRequired = true; draw(); return; }
    const result = createGame(toCreateGameInput(state.form, `game-${Date.now().toString()}`));
    if (!result.ok) { state.errors = result.errors; draw(); return; }
    const saved = await session.replace(result.value);
    if (!saved.ok) { state.errors = [{ code: "setup.persistence", message: saveErrorMessage(saved) }]; draw(); return; }
    state.screen = "active"; state.recovered = false; state.replacing = false; state.errors = []; state.commandErrors = []; state.replacementRequired = false; draw();
  };
};
