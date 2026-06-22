import type { HandParticipant, Player } from "../../domain/game/game.js";

interface PlayerStatusListProps {
  readonly players: readonly Player[];
  readonly participants?: readonly HandParticipant[] | undefined;
  readonly actorPlayerId?: string | undefined;
}

const participantState = (participant: HandParticipant | undefined, isActor: boolean): string => {
  if (participant?.folded === true) return "Folded";
  if (participant?.allIn === true) return "All-in";
  if (isActor) return "Actor";
  return "Live";
};

export const PlayerStatusList = ({ players, participants = [], actorPlayerId }: PlayerStatusListProps) => (
  <ul className="player-status-list" aria-label="player-status-list">
    {players.map((player) => {
      const participant = participants.find(({ playerId }) => playerId === player.id);
      const isActor = actorPlayerId === player.id;
      const commitment = participant?.handCommitment ?? 0;
      const state = player.status === "busted" ? "Busted" : participantState(participant, isActor);
      return <li className="player-status-list__item" key={player.id}>
        <span className={["status-dot", `status-dot--${state.toLowerCase().replace("-", "")}`, isActor ? "status-dot--pulse" : ""].filter(Boolean).join(" ")} aria-hidden="true" />
        <span className="player-status-list__seat">{String(player.seat + 1)}</span>
        <span className="player-status-list__main"><strong>{player.name}</strong><span className="player-status-list__meta">Stack: {String(player.stack)}</span><span className="player-status-list__meta">Committed: {String(commitment)}</span></span>
        <span className="player-status-list__state">{state}</span>
      </li>;
    })}
  </ul>
);
