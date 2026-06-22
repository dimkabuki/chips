import type { Hand } from "../../domain/game/game.js";

interface HandProgressProps {
  readonly hand: Hand;
  readonly actorName?: string | undefined;
}

const streets = ["preflop", "flop", "turn", "river"] as const;
const streetLabels: Record<(typeof streets)[number], string> = {
  preflop: "Pre-flop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const statusLabel = (hand: Hand, actorName?: string): string => {
  if (hand.status === "betting") return `Actor: ${actorName ?? hand.actorPlayerId ?? "none"}`;
  if (hand.status === "dealPrompt" && hand.pendingTransition !== undefined) return `Ready: ${streetLabels[hand.pendingTransition]}`;
  if (hand.status === "showdown") return "Showdown";
  return "Settled";
};

export const HandProgress = ({ hand, actorName }: HandProgressProps) => {
  const activeIndex = streets.indexOf(hand.street);
  return <section aria-label="hand-progress" className="hand-progress">
    <div className="hand-progress__meta">
      <p className="eyebrow">Hand #{String(hand.number)}</p>
      <p className="hand-progress__status">{statusLabel(hand, actorName)}</p>
    </div>
    <ol className="hand-progress__streets" aria-label="streets">
      {streets.map((street, index) => {
        const isActive = street === hand.street;
        const isComplete = index < activeIndex || hand.status === "settled";
        return <li className={["hand-progress__street", isActive ? "hand-progress__street--active" : "", isComplete ? "hand-progress__street--complete" : ""].filter(Boolean).join(" ")} key={street} aria-current={isActive ? "step" : undefined}>
          <span className="hand-progress__dot" aria-hidden="true" />
          <span>{streetLabels[street]}</span>
        </li>;
      })}
    </ol>
    <div className="card-slots" aria-hidden="true">
      {Array.from({ length: 5 }, (_value, index) => <span className={index < Math.max(0, activeIndex + 2) ? "card-slot card-slot--ready" : "card-slot"} key={index} />)}
    </div>
  </section>;
};
