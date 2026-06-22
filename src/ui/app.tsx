import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { GameSession } from "../application/game-session.js";
import type { LoadGameResult } from "../application/persistence.js";
import type { Game, Hand } from "../domain/game/game.js";
import { AVATARS, createGame, type ValidationIssue } from "../domain/game/create-game.js";
import { derivePots, getLegalActions, type PlayerActionType, type ShowdownSelection } from "../domain/game/hand-engine.js";
import { defaultSetupForm, previewSetup, toCreateGameInput, type SetupForm } from "./setup.js";
import { Alert } from "./components/alert.js";
import { Badge } from "./components/badge.js";
import { Button } from "./components/button.js";
import { Card } from "./components/card.js";
import { Field, Select, TextInput } from "./components/field.js";
import { HandProgress } from "./components/hand-progress.js";
import { PlayerStatusList } from "./components/player-status-list.js";

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

const ConfirmDialog = ({ title, description, trigger, children }: { readonly title: string; readonly description: string; readonly trigger: React.ReactNode; readonly children: React.ReactNode }) => (
  <Dialog.Root>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog__overlay" />
      <Dialog.Content className="dialog__content">
        <Dialog.Title className="dialog__title">{title}</Dialog.Title>
        <Dialog.Description className="dialog__description">{description}</Dialog.Description>
        <div className="dialog__actions">{children}<Dialog.Close asChild><Button type="button" variant="ghost">Cancel</Button></Dialog.Close></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

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
    if (action.type === "fold" || action.type === "check") return <Button key={action.type} type="button" variant={action.type === "fold" ? "danger" : "secondary"} data-action={action.type} onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>{action.type === "fold" ? "Fold" : "Check"}</Button>;
    if (action.type === "call") return <Button key="call" type="button" variant="primary" data-action="call" onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>Call {String(action.targetStreetCommitment)} (+{String(action.chipsAdded)})</Button>;
    if (action.type === "allIn") return <Button key="allIn" type="button" variant="danger" data-action="allIn" onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType); }}>All-in {String(action.targetStreetCommitment)} (+{String(action.chipsAdded)})</Button>;
    const value = targets[action.type] ?? String(action.minTarget);
    const numeric = Number(value);
    const label = action.type === "bet" ? "Bet" : "Raise";
    return <React.Fragment key={action.type}><Field label={`${label} target`}><TextInput name={`${action.type}-target`} defaultValue={value} inputMode="numeric" data-amount-type={action.type} /></Field><p data-preview={action.type}>{label} target {String(numeric)}, cost {String(numeric - (actor?.streetCommitment ?? 0))}</p><Button type="button" variant="primary" data-action={action.type} onClick={(event) => { onAction(event.currentTarget.dataset.action as PlayerActionType, numeric); }}>{label}</Button></React.Fragment>;
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
  })}<Button type="button" variant="primary" data-action="settle-showdown" onClick={() => {
    const selections = derived.pots.map((_pot, potIndex) => {
      const currentDraft = potDraft(potIndex);
      const allocationEntries = currentDraft.winnerPlayerIds.flatMap((id) => {
        const raw = form.current?.querySelector<HTMLInputElement>(`[name='pot-${String(potIndex)}-allocation-${id}']`)?.value.trim() ?? currentDraft.allocations[id]?.trim() ?? "";
        return raw === "" ? [] : [[id, Number(raw)] as const];
      });
      return { potIndex, winnerPlayerIds: [...currentDraft.winnerPlayerIds], ...(allocationEntries.length === 0 ? {} : { allocations: Object.fromEntries(allocationEntries) }) };
    });
    onSettle(selections);
  }}>Settle showdown</Button></section>;
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

const StackCorrection = ({ game, session, run }: { readonly game: Game; readonly session: GameSession; readonly run: (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>) => void }) => {
  const rootRef = useRef<HTMLElement>(null);
  const [stacks, setStacks] = useState<Record<string, string>>(() => Object.fromEntries(game.players.map((player) => [player.id, String(player.stack)])));
  const [reason, setReason] = useState("");
  useEffect(() => { setStacks(Object.fromEntries(game.players.map((player) => [player.id, String(player.stack)]))); setReason(""); }, [game]);
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const listener = (event: Event): void => {
      const target = event.target instanceof HTMLInputElement ? event.target : undefined;
      if (target === undefined) return;
      flushSync(() => {
        if (target.name === "correction-reason") setReason(target.value);
        else if (target.name.startsWith("correction-")) setStacks((current) => ({ ...current, [target.name.slice("correction-".length)]: target.value }));
      });
    };
    root.addEventListener("input", listener);
    return () => { root.removeEventListener("input", listener); };
  }, []);
  const commitments = Object.fromEntries((game.currentHand?.participants ?? []).map((participant) => [participant.playerId, participant.handCommitment]));
  const correctedTotal = game.players.reduce((total, player) => total + Number(stacks[player.id] ?? player.stack), 0);
  const commitmentTotal = Object.values(commitments).reduce((total, amount) => total + amount, 0);
  const previewTotal = correctedTotal + commitmentTotal;
  const conserves = previewTotal === game.chipSupply;
  return <section aria-label="stack-correction" ref={rootRef}><h3>Stack correction</h3><p role="status">Chip total after correction: {String(previewTotal)} of {String(game.chipSupply)}</p>{!conserves ? <p role="alert">Correction preview does not preserve total chip supply.</p> : null}{game.players.map((player) => <fieldset key={player.id}><legend>{player.name}</legend><p className="field__hint">Current: {String(player.stack)} stack, {String(commitments[player.id] ?? 0)} committed</p><label>Corrected stack <input name={`correction-${player.id}`} value={stacks[player.id] ?? String(player.stack)} inputMode="numeric" onInput={(event) => { const value = event.currentTarget.value; setStacks((current) => ({ ...current, [player.id]: value })); }} /></label></fieldset>)}<label>Correction reason <input name="correction-reason" maxLength={120} value={reason} onInput={(event) => { const value = event.currentTarget.value; setReason(value); }} /></label><Button type="button" variant="primary" data-action="correct-stacks" disabled={!conserves || reason.trim() === ""} onClick={() => {
    run(() => session.correctStacks({ reason, stacks: Object.fromEntries(game.players.map((player) => [player.id, Number(stacks[player.id] ?? player.stack)])) }));
  }}>Apply stack correction</Button></section>;
};

const CurrentHand = ({ game, session, run }: { readonly game: Game; readonly session: GameSession; readonly run: (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>) => void }) => {
  const hand = game.currentHand;
  if (hand === undefined) return <p>Current hand: none</p>;
  const playerAction = (type: PlayerActionType, targetStreetCommitment?: number): void => {
    const playerId = session.current()?.currentHand?.actorPlayerId;
    if (playerId === undefined) return;
    run(() => session.act({ playerId, type, ...(targetStreetCommitment === undefined ? {} : { targetStreetCommitment }) }));
  };
  const actorName = hand.status === "betting" ? playerName(game, hand.actorPlayerId) : undefined;
  return <section aria-label="current-hand"><HandProgress hand={hand} actorName={actorName} /><div className="hand-summary"><p>Button: {playerName(game, hand.buttonPlayerId)}</p><p>Blinds: {playerName(game, hand.smallBlindPlayerId)} / {playerName(game, hand.bigBlindPlayerId)}</p><p>Current bet: {String(hand.currentBet)}</p></div><PlayerStatusList players={game.players} participants={hand.participants} actorPlayerId={hand.status === "betting" ? hand.actorPlayerId : undefined} /><ActionLog game={game} hand={hand} />{hand.status === "dealPrompt" && hand.pendingTransition !== undefined ? <section aria-label="street-transition"><p>Ready to deal {hand.pendingTransition}</p><Button type="button" variant="primary" data-action="confirm-street" onClick={() => { run(() => session.confirmStreet()); }}>Deal the {hand.pendingTransition}</Button></section> : null}<ShowdownSettlement game={game} hand={hand} onSettle={(selections) => { run(() => session.settleShowdown(selections)); }} /><HandResult game={game} hand={hand} /><BettingControls game={game} onAction={playerAction} /></section>;
};

const AuditLog = ({ game }: { readonly game: Game }) => <section aria-label="audit-log"><h3>Audit log</h3>{game.auditLog.length === 0 ? <p>Audit log: none</p> : <ol>{game.auditLog.map((entry) => <li key={entry.sequence}>#{String(entry.sequence)} {entry.type}{"reason" in entry ? ` - ${entry.reason}` : ""}</li>)}</ol>}</section>;

const ActiveGameScreen = ({ state, session, setState }: { readonly state: State; readonly session: GameSession; readonly setState: React.Dispatch<React.SetStateAction<State>> }) => {
  const [undoConfirmed, setUndoConfirmed] = useState(false);
  const game = session.current();
  const run = (command: () => Promise<Awaited<ReturnType<GameSession["replace"]>>>): void => { void command().then((result) => { setState((current) => ({ ...current, commandErrors: result.ok ? [] : [saveErrorMessage(result)] })); }); };
  if (game === undefined) return null;
  const dealer = game.players.find((p) => p.id === game.dealerPlayerId)?.name ?? game.dealerPlayerId;
  const canStart = game.status === "active" && (game.currentHand === undefined || game.currentHand.status === "settled");
  const undoDescription = session.lastUndoDescription() ?? "last reversible action";
  const winners = game.players.filter(({ stack }) => stack > 0);
  return <main className="app-shell">{state.recovered ? <Alert tone="success">Recovered saved game.</Alert> : null}<Card aria-label="active-game" title="Active game" eyebrow={<span className="badge-row"><Badge tone={game.status === "completed" ? "success" : "info"}>{game.status}</Badge><Badge tone="neutral">Blinds: {String(game.settings.smallBlind)}/{String(game.settings.bigBlind)}</Badge></span>} actions={canStart ? <Button type="button" variant="primary" data-action="start-hand" onClick={() => { run(() => session.startHand({ handId: `hand-${Date.now().toString()}` })); }}>Start hand</Button> : undefined}>
    {state.commandErrors.length > 0 ? <Alert tone="danger">{state.commandErrors.map((error) => <p key={error}>{error}</p>)}</Alert> : <div role="alert" className="sr-only" />}
    <div className="status-grid"><p>Status: {game.status}</p><p>Dealer: {dealer}</p><p>Blinds: {String(game.settings.smallBlind)}/{String(game.settings.bigBlind)}</p></div>
    {game.status === "completed" ? <section aria-label="completed-game" className="panel"><h2>Game completed</h2><p>Final winner: {winners.length === 1 ? winners[0]?.name ?? "unknown" : "undetermined"}</p></section> : null}
    <div className="layout-grid"><Card title="Current hand" className="card--accent"><CurrentHand game={game} session={session} run={run} /></Card><Card title="Players"><PlayerStatusList players={game.players} participants={game.currentHand?.participants} actorPlayerId={game.currentHand?.status === "betting" ? game.currentHand.actorPlayerId : undefined} /></Card><Card aria-label="undo-controls" title="Undo"><p>Last reversible action: {undoDescription}</p><label className="checkbox-line"><input type="checkbox" name="confirmUndo" checked={undoConfirmed} onChange={(event) => { setUndoConfirmed(event.currentTarget.checked); }} /> Confirm undo</label><ConfirmDialog title="Undo last action?" description={`This will reverse ${undoDescription}. Confirm at the table before applying it.`} trigger={<Button type="button" variant="danger" data-action="undo" disabled={session.undoDepth() === 0 || !undoConfirmed} onClick={() => { setUndoConfirmed(false); run(() => session.undo()); }}>Undo last action</Button>}><Dialog.Close asChild><Button type="button" variant="danger" onClick={() => { setUndoConfirmed(false); run(() => session.undo()); }}>Undo last action</Button></Dialog.Close></ConfirmDialog></Card><Card title="Stack correction"><StackCorrection game={game} session={session} run={run} /></Card><Card title="Audit"><AuditLog game={game} /></Card></div>
    <Button type="button" variant="ghost" data-action="new-game" onClick={() => { setState((current) => ({ ...current, screen: "setup", replacing: session.current() !== undefined, recovered: false, errors: [], commandErrors: [] })); }}>New game</Button>
  </Card></main>;
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
  useEffect(() => { const root = rootRef.current; if (root === null) return; const listener = (): void => { flushSync(() => { setState((current) => ({ ...current, form: readSetupForm(root, current.form), errors: [], replacementRequired: false })); }); }; root.addEventListener("input", listener); root.addEventListener("change", listener); return () => { root.removeEventListener("input", listener); root.removeEventListener("change", listener); }; }, [setState]);
  const updatePlayer = (index: number, patch: Partial<SetupForm["players"][number]>): void => { setState((current) => ({ ...current, errors: [], replacementRequired: false, form: { ...current.form, players: current.form.players.map((player, candidate) => candidate === index ? { ...player, ...patch } : player) } })); };
  const create = (): void => { const form = rootRef.current === null ? state.form : readSetupForm(rootRef.current, state.form); if (state.replacing && !document.querySelector<HTMLInputElement>("[name='confirmReplace']")?.checked) { setState((current) => ({ ...current, replacementRequired: true })); return; } const result = createGame(toCreateGameInput(form, `game-${Date.now().toString()}`)); if (!result.ok) { setState((current) => ({ ...current, form, errors: result.errors })); return; } void session.replace(result.value).then((saved) => { if (!saved.ok) { setState((current) => ({ ...current, errors: [{ code: "setup.persistence", message: saveErrorMessage(saved) }] })); return; } setState((current) => ({ ...current, screen: "active", recovered: false, replacing: false, errors: [], commandErrors: [], replacementRequired: false })); }); };
  const issues = [...state.errors.map(issueLabel), ...preview.warnings.map(issueLabel), ...(state.replacementRequired ? ["Confirm replacement before creating a new game."] : [])];
  return <main className="app-shell"><section aria-label="setup" ref={rootRef} className="setup-shell"><header className="hero"><p className="eyebrow">Table PWA</p><h1>Chips operator</h1><p>Fast stack setup, visible blinds, and deliberate destructive actions.</p></header>{issues.length > 0 ? <Alert tone="warning">{issues.map((issue) => <p key={issue}>{issue}</p>)}</Alert> : <div role="alert" className="sr-only" />}<Card title="Players" eyebrow={`${String(state.form.players.length)} seats`}>{state.form.players.map((player, index) => { const seat = String(index + 1); const id = `player-${seat}`; return <fieldset className="player-fieldset" key={id}><legend>Player {seat}</legend><Field label="Name"><TextInput name={`${id}-name`} defaultValue={player.name} aria-label={`Player ${seat} name`} onInput={(event) => { updatePlayer(index, { name: event.currentTarget.value }); }} /></Field><Field label="Avatar"><Select name={`${id}-avatar`} defaultValue={player.avatar}>{AVATARS.map((avatar) => <option value={avatar} key={avatar}>{avatar}</option>)}</Select></Field><Field label="Stack"><TextInput name={`${id}-stack`} defaultValue={player.stack} inputMode="numeric" aria-label={`Player ${seat} stack`} onInput={(event) => { updatePlayer(index, { stack: event.currentTarget.value }); }} /></Field></fieldset>; })}<div className="button-row"><Button type="button" data-action="add-player" disabled={state.form.players.length >= 8} onClick={() => { setState((current) => { const next = current.form.players.length + 1; return next > 8 ? current : { ...current, form: { ...current.form, players: [...current.form.players, { name: `Player ${String(next)}`, avatar: AVATARS[(next - 1) % AVATARS.length] ?? AVATARS[0], stack: "1000" }] } }; }); }}>Add player</Button><Button type="button" variant="ghost" data-action="remove-player" disabled={state.form.players.length <= 2} onClick={() => { setState((current) => current.form.players.length <= 2 ? current : { ...current, form: { ...current.form, players: current.form.players.slice(0, -1), dealerPlayerId: current.form.dealerPlayerId === `player-${String(current.form.players.length)}` ? "player-1" : current.form.dealerPlayerId } }); }}>Remove player</Button></div></Card><Card title="Game settings"><div className="settings-grid"><Field label="Small blind"><TextInput name="smallBlind" defaultValue={state.form.smallBlind} inputMode="numeric" /></Field><Field label="Big blind"><TextInput name="bigBlind" defaultValue={state.form.bigBlind} inputMode="numeric" /></Field><Field label="Initial dealer"><Select name="dealer" defaultValue={state.form.dealerPlayerId}>{state.form.players.map((_player, index) => <option value={`player-${String(index + 1)}`} key={index}>Player {String(index + 1)}</option>)}</Select></Field></div><p className="metric">Total chip supply: {String(preview.totalChipSupply)}</p>{state.replacing ? <label className="checkbox-line"><input type="checkbox" name="confirmReplace" /> Confirm replacing the saved game</label> : null}<ConfirmDialog title="Create this game?" description={state.replacing ? "This can replace the saved game after the replacement checkbox is checked." : "Create the game and persist it locally for this table."} trigger={<Button type="button" variant="primary" data-action="create" onClick={create}>Create game</Button>}><Button type="button" variant="primary" onClick={create}>Create game</Button></ConfirmDialog></Card></section></main>;
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
