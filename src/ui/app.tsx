import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { GameSession } from "../application/game-session.js";
import type { LoadGameResult } from "../application/persistence.js";
import type { Game, Hand, HandParticipant } from "../domain/game/game.js";
import { AVATARS, createGame, type ValidationIssue } from "../domain/game/create-game.js";
import { derivePots, getLegalActions, type PlayerActionType, type ShowdownSelection } from "../domain/game/hand-engine.js";
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

const initialState = (): State => ({ screen: "loading", form: defaultSetupForm(), errors: [], recovered: false, replacing: false, replacementRequired: false, commandErrors: [] });

const issueLabel = (issue: ValidationIssue): string => {
  if (issue.code === "players.stack.belowBigBlind" && issue.playerId !== undefined) return `Player ${String(Number(issue.playerId.replace("player-", "")))} stack is below the big blind.`;
  return issue.message;
};

const playerName = (game: Game, playerId: string | undefined): string => {
  if (playerId === undefined) return "none";
  return game.players.find((player) => player.id === playerId)?.name ?? playerId;
};

const saveErrorMessage = (saved: Awaited<ReturnType<GameSession["replace"]>>): string => {
  if (saved.ok) return "";
  if ("code" in saved && saved.code === "persistence.revisionConflict") return "The saved game changed before replacement.";
  if ("errors" in saved) return saved.errors[0]?.message ?? "The game could not be saved.";
  return "The game could not be saved.";
};

const ParticipantRow = ({ game, participant }: { readonly game: Game; readonly participant: HandParticipant }) => {
  const player = game.players.find(({ id }) => id === participant.playerId);
  return <li>{String((player?.seat ?? 0) + 1)}. {player?.name ?? participant.playerId} - stack {String(player?.stack ?? 0)} - street {String(participant.streetCommitment)} - hand {String(participant.handCommitment)} - {participant.folded ? "folded" : "live"} - {participant.allIn ? "all-in" : "not all-in"}</li>;
};

const ActionLog = ({ game, hand }: { readonly game: Game; readonly hand: Hand }) => hand.actions.length === 0
  ? <p>Action log: none</p>
  : <ol aria-label="action-log">{hand.actions.map((action) => <li key={action.sequence}>#{String(action.sequence)} {playerName(game, action.playerId)} {action.type} target {String(action.targetStreetCommitment)} cost {String(action.chipsAdded)} stack {String(action.resultingStack)}</li>)}</ol>;

const BettingControls = ({ game, onAction }: { readonly game: Game; readonly onAction: (type: PlayerActionType, target?: number) => void }) => {
  const legal = getLegalActions(game);
  const hand = game.currentHand;
  const actor = hand?.participants.find(({ playerId }) => playerId === hand.actorPlayerId);
  const rootRef = useRef<HTMLElement>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  useEffect(() => { setTargets({}); }, [hand?.actions.length, hand?.actorPlayerId, hand?.street]);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const listener = (event: Event): void => {
      const input = event.target instanceof HTMLInputElement ? event.target : undefined;
      const type = input?.dataset.amountType;
      if ((type === "bet" || type === "raise") && input !== undefined) { const value = input.value; flushSync(() => { setTargets((current) => ({ ...current, [type]: value })); }); }
    };
    root.addEventListener("input", listener);
    return () => { root.removeEventListener("input", listener); };
  }, []);
  if (legal === undefined || hand === undefined) return null;
  return <section aria-label="betting-actions" ref={rootRef}><h3>Actions for {playerName(game, legal.playerId)}</h3>{legal.actions.map((action) => {
    if (action.type === "fold" || action.type === "check") return <button key={action.type} type="button" data-action={action.type} onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>{action.type === "fold" ? "Fold" : "Check"}</button>;
    if (action.type === "call") return <button key="call" type="button" data-action="call" onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>Call {String(action.targetStreetCommitment)} (+{String(action.chipsAdded)})</button>;
    if (action.type === "allIn") return <button key="allIn" type="button" data-action="allIn" onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>All-in {String(action.targetStreetCommitment)} (+{String(action.chipsAdded)})</button>;
    const value = targets[action.type] ?? String(action.minTarget);
    const numeric = Number(value);
    const label = action.type === "bet" ? "Bet" : "Raise";
    return <React.Fragment key={action.type}><label>{label} target <input name={`${action.type}-target`} defaultValue={value} inputMode="numeric" data-amount-type={action.type} /></label><p data-preview={action.type}>{label} target {String(numeric)}, cost {String(numeric - (actor?.streetCommitment ?? 0))}</p><button type="button" data-action={action.type} onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType, numeric); }}>{label}</button></React.Fragment>;
  })}</section>;
};

type ShowdownDraft = Record<number, { readonly winnerPlayerIds: readonly string[]; readonly allocations: Record<string, string> }>;

const ShowdownSettlement = ({ game, hand, onSettle }: { readonly game: Game; readonly hand: Hand; readonly onSettle: (selections: ShowdownSelection[]) => void }) => {
  const form = useRef<HTMLElement>(null);
  const derived = derivePots(game);
  const draftKey = `${hand.id}:${derived.pots.map((pot) => `${String(pot.amount)}:${pot.eligiblePlayerIds.join("|")}`).join(";")}`;
  const [draft, setDraft] = useState<ShowdownDraft>({});
  useEffect(() => { setDraft({}); }, [draftKey]);
  if (hand.status !== "showdown") return null;
  const potDraft = (potIndex: number) => draft[potIndex] ?? { winnerPlayerIds: [], allocations: {} };
  const updateWinner = (potIndex: number, playerId: string, checked: boolean): void => {
    setDraft((current) => {
      const currentPot = current[potIndex] ?? { winnerPlayerIds: [], allocations: {} };
      const winnerPlayerIds = checked ? [...currentPot.winnerPlayerIds, playerId] : currentPot.winnerPlayerIds.filter((id) => id !== playerId);
      return { ...current, [potIndex]: { ...currentPot, winnerPlayerIds } };
    });
  };
  const updateAllocation = (potIndex: number, playerId: string, value: string): void => {
    setDraft((current) => {
      const currentPot = current[potIndex] ?? { winnerPlayerIds: [], allocations: {} };
      return { ...current, [potIndex]: { ...currentPot, allocations: { ...currentPot.allocations, [playerId]: value } } };
    });
  };
  return <section aria-label="showdown-settlement" ref={form}><h3>Showdown settlement</h3>{Object.entries(derived.returned).length > 0 ? <p>Returned uncalled chips: {Object.entries(derived.returned).map(([id, amount]) => `${playerName(game, id)} ${String(amount)}`).join(", ")}</p> : null}{derived.pots.map((pot, index) => {
    const currentDraft = potDraft(index);
    return <fieldset data-pot-index={String(index)} key={index}><legend>Pot {String(index + 1)} - {String(pot.amount)} chips</legend><p>Eligible winners: {pot.eligiblePlayerIds.map((id) => playerName(game, id)).join(", ")}</p>{pot.eligiblePlayerIds.map((id) => <React.Fragment key={id}><label><input type="checkbox" name={`pot-${String(index)}-winner`} value={id} checked={currentDraft.winnerPlayerIds.includes(id)} onChange={(event) => { updateWinner(index, id, event.currentTarget.checked); }} /> {playerName(game, id)}</label><label>Manual allocation for {playerName(game, id)} <input name={`pot-${String(index)}-allocation-${id}`} inputMode="numeric" value={currentDraft.allocations[id] ?? ""} onInput={(event) => { updateAllocation(index, id, event.currentTarget.value); }} /></label></React.Fragment>)}</fieldset>;
  })}<button type="button" data-action="settle-showdown" onClick={() => {
    const selections = derived.pots.map((_pot, potIndex) => {
      const currentDraft = potDraft(potIndex);
      const allocationEntries = currentDraft.winnerPlayerIds.flatMap((id) => {
        const raw = form.current?.querySelector<HTMLInputElement>(`[name='pot-${String(potIndex)}-allocation-${id}']`)?.value.trim() ?? currentDraft.allocations[id]?.trim() ?? "";
        return raw === "" ? [] : [[id, Number(raw)] as const];
      });
      return { potIndex, winnerPlayerIds: [...currentDraft.winnerPlayerIds], ...(allocationEntries.length === 0 ? {} : { allocations: Object.fromEntries(allocationEntries) }) };
    });
    onSettle(selections);
  }}>Settle showdown</button></section>;
};

const HandResult = ({ game, hand }: { readonly game: Game; readonly hand: Hand }) => {
  if (hand.status !== "settled") return null;
  if (hand.winnerPlayerId !== undefined) return <section aria-label="hand-result"><h3>Hand result</h3><p>Uncontested winner: {playerName(game, hand.winnerPlayerId)}</p><p>Pot amount: {String(hand.potAmount ?? 0)}</p></section>;
  return <section aria-label="hand-result"><h3>Showdown result</h3><ul>{(hand.pots ?? []).map((pot, index) => {
    const award = hand.awards?.find(({ potIndex }) => potIndex === index);
    const allocations = Object.entries(award?.allocations ?? {}).map(([id, amount]) => `${playerName(game, id)} ${String(amount)}`).join(", ");
    return <li key={index}>Pot {String(index + 1)} - {String(pot.amount)} chips - awards {allocations}</li>;
  })}</ul></section>;
};

const readStackCorrection = (root: HTMLElement, game: Game): { readonly stacks: Record<string, number>; readonly reason: string } => ({
  stacks: Object.fromEntries(game.players.map((player) => [player.id, Number(root.querySelector<HTMLInputElement>(`[name='correction-${player.id}']`)?.value ?? player.stack)])),
  reason: root.querySelector<HTMLInputElement>("[name='correction-reason']")?.value ?? "",
});

const StackCorrection = ({ game, session, run }: { readonly game: Game; readonly session: GameSession; readonly run: (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>) => void }) => {
  const rootRef = useRef<HTMLElement>(null);
  return <section aria-label="stack-correction" ref={rootRef}><h3>Stack correction</h3>{game.players.map((player) => <label key={player.id}>{player.name} corrected stack <input name={`correction-${player.id}`} defaultValue={String(player.stack)} inputMode="numeric" /></label>)}<label>Correction reason <input name="correction-reason" maxLength={120} /></label><button type="button" data-action="correct-stacks" onClick={() => {
    const root = rootRef.current;
    if (root === null) return;
    run(() => session.correctStacks(readStackCorrection(root, game)));
  }}>Apply stack correction</button></section>;
};

const CurrentHand = ({ game, session, run }: { readonly game: Game; readonly session: GameSession; readonly run: (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>) => void }) => {
  const hand = game.currentHand;
  if (hand === undefined) return <p>Current hand: none</p>;
  const playerAction = (type: PlayerActionType, targetStreetCommitment?: number): void => {
    const playerId = session.current()?.currentHand?.actorPlayerId;
    if (playerId === undefined) return;
    run(() => session.act({ playerId, type, ...(targetStreetCommitment === undefined ? {} : { targetStreetCommitment }) }));
  };
  return <section aria-label="current-hand"><h3>Hand #{String(hand.number)}</h3><p>Button: {playerName(game, hand.buttonPlayerId)}</p><p>Small blind: {playerName(game, hand.smallBlindPlayerId)}</p><p>Big blind: {playerName(game, hand.bigBlindPlayerId)}</p><p>Street: {hand.street}</p><p>Hand status: {hand.status}</p><p>Current actor: {hand.status === "betting" ? playerName(game, hand.actorPlayerId) : "none"}</p><p>Current bet: {String(hand.currentBet)}</p><p>Last full raise size: {String(hand.lastFullRaiseSize)}</p><ul aria-label="participants">{hand.participants.map((participant) => <ParticipantRow key={participant.playerId} game={game} participant={participant} />)}</ul><ActionLog game={game} hand={hand} />{hand.status === "dealPrompt" && hand.pendingTransition !== undefined ? <section aria-label="street-transition"><p>Ready to deal {hand.pendingTransition}</p><button type="button" data-action="confirm-street" onClick={() => { run(() => session.confirmStreet()); }}>Deal the {hand.pendingTransition}</button></section> : null}<ShowdownSettlement game={game} hand={hand} onSettle={(selections) => { run(() => session.settleShowdown(selections)); }} /><HandResult game={game} hand={hand} /><BettingControls game={game} onAction={playerAction} /></section>;
};

const ActiveGameScreen = ({ state, session, setState }: { readonly state: State; readonly session: GameSession; readonly setState: React.Dispatch<React.SetStateAction<State>> }) => {
  const game = session.current();
  const run = (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>): void => {
    void command().then((result) => { setState((current) => ({ ...current, commandErrors: result.ok ? [] : [saveErrorMessage(result)] })); });
  };
  if (game === undefined) return null;
  const dealer = game.players.find((p) => p.id === game.dealerPlayerId)?.name ?? game.dealerPlayerId;
  const canStart = game.status === "active" && (game.currentHand === undefined || game.currentHand.status === "settled");
  const winners = game.players.filter(({ stack }) => stack > 0);
  return <>{state.recovered ? <p role="status">Recovered saved game.</p> : null}<section aria-label="active-game"><h2>Active game</h2><div role="alert">{state.commandErrors.map((error) => <p key={error}>{error}</p>)}</div><p>Status: {game.status}</p><p>Dealer: {dealer}</p><p>Blinds: {String(game.settings.smallBlind)}/{String(game.settings.bigBlind)}</p>{game.status === "completed" ? <section aria-label="completed-game"><h2>Game completed</h2><p>Final winner: {winners.length === 1 ? winners[0]?.name ?? "unknown" : "undetermined"}</p></section> : null}<CurrentHand game={game} session={session} run={run} /><ul>{game.players.map((p) => <li key={p.id}>{String(p.seat + 1)}. {p.name} ({p.avatar}) - stack {String(p.stack)} - {p.status}</li>)}</ul><button type="button" data-action="undo" disabled={session.undoDepth() === 0} onClick={() => { run(() => session.undo()); }}>Undo last action</button><StackCorrection game={game} session={session} run={run} />{canStart ? <button type="button" data-action="start-hand" onClick={() => { run(() => session.startHand({ handId: `hand-${Date.now().toString()}` })); }}>Start hand</button> : null}<button type="button" data-action="new-game" onClick={() => { setState((current) => ({ ...current, screen: "setup", replacing: session.current() !== undefined, recovered: false, errors: [], commandErrors: [] })); }}>New game</button></section></>;
};

const readSetupForm = (root: HTMLElement, current: SetupForm): SetupForm => ({
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

const SetupScreen = ({ state, session, setState }: { readonly state: State; readonly session: GameSession; readonly setState: React.Dispatch<React.SetStateAction<State>> }) => {
  const rootRef = useRef<HTMLElement>(null);
  const preview = useMemo(() => previewSetup(state.form), [state.form]);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const listener = (): void => { flushSync(() => { setState((current) => ({ ...current, form: readSetupForm(root, current.form), errors: [], replacementRequired: false })); }); };
    root.addEventListener("input", listener);
    root.addEventListener("change", listener);
    return () => { root.removeEventListener("input", listener); root.removeEventListener("change", listener); };
  }, [setState]);
  const updatePlayer = (index: number, patch: Partial<SetupForm["players"][number]>): void => {
    setState((current) => ({ ...current, errors: [], replacementRequired: false, form: { ...current.form, players: current.form.players.map((player, candidate) => candidate === index ? { ...player, ...patch } : player) } }));
  };
  const create = (): void => {
    const form = rootRef.current === null ? state.form : readSetupForm(rootRef.current, state.form);
    if (state.replacing && !document.querySelector<HTMLInputElement>("[name='confirmReplace']")?.checked) { setState((current) => ({ ...current, replacementRequired: true })); return; }
    const result = createGame(toCreateGameInput(form, `game-${Date.now().toString()}`));
    if (!result.ok) { setState((current) => ({ ...current, form, errors: result.errors })); return; }
    void session.replace(result.value).then((saved) => {
      if (!saved.ok) { setState((current) => ({ ...current, errors: [{ code: "setup.persistence", message: saveErrorMessage(saved) }] })); return; }
      setState((current) => ({ ...current, screen: "active", recovered: false, replacing: false, errors: [], commandErrors: [], replacementRequired: false }));
    });
  };
  const issues = [...state.errors.map(issueLabel), ...preview.warnings.map(issueLabel), ...(state.replacementRequired ? ["Confirm replacement before creating a new game."] : [])];
  return <section aria-label="setup" ref={rootRef}><h1>Chips operator</h1><div role="alert">{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>{state.form.players.map((player, index) => {
    const seat = String(index + 1);
    const id = `player-${seat}`;
    return <fieldset key={id}><legend>Player {seat}</legend><input name={`${id}-name`} defaultValue={player.name} aria-label={`Player ${seat} name`} onInput={(event) => { updatePlayer(index, { name: event.currentTarget.value }); }} /><select name={`${id}-avatar`} defaultValue={player.avatar}>{AVATARS.map((avatar) => <option value={avatar} key={avatar}>{avatar}</option>)}</select><input name={`${id}-stack`} defaultValue={player.stack} inputMode="numeric" aria-label={`Player ${seat} stack`} onInput={(event) => { updatePlayer(index, { stack: event.currentTarget.value }); }} /></fieldset>;
  })}<label>Small blind <input name="smallBlind" defaultValue={state.form.smallBlind} /></label><label>Big blind <input name="bigBlind" defaultValue={state.form.bigBlind} /></label><label>Initial dealer <select name="dealer" defaultValue={state.form.dealerPlayerId}>{state.form.players.map((_player, index) => <option value={`player-${String(index + 1)}`} key={index}>Player {String(index + 1)}</option>)}</select></label><p>Total chip supply: {String(preview.totalChipSupply)}</p><button type="button" data-action="add-player" disabled={state.form.players.length >= 8} onClick={() => { setState((current) => { const next = current.form.players.length + 1; return next > 8 ? current : { ...current, form: { ...current.form, players: [...current.form.players, { name: `Player ${String(next)}`, avatar: AVATARS[(next - 1) % AVATARS.length] ?? AVATARS[0], stack: "1000" }] } }; }); }}>Add player</button><button type="button" data-action="remove-player" disabled={state.form.players.length <= 2} onClick={() => { setState((current) => current.form.players.length <= 2 ? current : { ...current, form: { ...current.form, players: current.form.players.slice(0, -1), dealerPlayerId: current.form.dealerPlayerId === `player-${String(current.form.players.length)}` ? "player-1" : current.form.dealerPlayerId } }); }}>Remove player</button>{state.replacing ? <label><input type="checkbox" name="confirmReplace" /> Confirm replacing the saved game</label> : null}<button type="button" data-action="create" onClick={create}>Create game</button></section>;
};

const App = ({ session }: { readonly session: GameSession }) => {
  const [state, setState] = useState<State>(initialState);
  useEffect(() => { let active = true; void session.load().then((loaded: LoadGameResult) => {
    if (!active) return;
    setState((current) => {
      if (!loaded.ok) return { ...current, screen: "recoveryError", recoveryCode: loaded.code };
      if (loaded.envelope !== undefined) return { ...current, screen: "active", recovered: true };
      return { ...current, screen: "setup" };
    });
  }); return () => { active = false; }; }, [session]);
  if (state.screen === "loading") return null;
  if (state.screen === "recoveryError") return <section role="alert"><p>Recovery failed: {state.recoveryCode ?? "unknown"}</p><label><input type="checkbox" name="confirmReset" /> Confirm destructive reset</label><button type="button" data-action="reset-corrupt" onClick={() => { if (!document.querySelector<HTMLInputElement>("[name='confirmReset']")?.checked) return; void session.reset().then(() => { setState((current) => { const next = { ...current, screen: "setup" as const }; delete next.recoveryCode; return next; }); }); }}>Reset corrupted game</button></section>;
  if (state.screen === "active") return <ActiveGameScreen state={state} session={session} setState={setState} />;
  return <SetupScreen state={state} session={session} setState={setState} />;
};

const roots = new WeakMap<HTMLElement, Root>();

export const renderApp = async (root: HTMLElement, { session }: RenderAppOptions): Promise<void> => {
  roots.get(root)?.unmount();
  const reactRoot = createRoot(root);
  roots.set(root, reactRoot);
  flushSync(() => { reactRoot.render(<App session={session} />); });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
