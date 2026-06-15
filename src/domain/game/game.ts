export const AVATARS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "teal",
  "pink",
] as const;

export type Avatar = (typeof AVATARS)[number];

export interface Player {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly avatar: Avatar;
  readonly stack: number;
  readonly status: "active" | "busted";
}

export type Street = "preflop" | "flop" | "turn" | "river";

export interface HandParticipant {
  readonly playerId: string;
  readonly stackAtStart: number;
  readonly streetCommitment: number;
  readonly handCommitment: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly actedSinceFullRaise: boolean;
  readonly raiseReopened: boolean;
}

export interface HandAction {
  readonly sequence: number;
  readonly playerId: string;
  readonly type: "fold" | "check" | "call" | "bet" | "raise" | "allIn";
  readonly targetStreetCommitment: number;
  readonly chipsAdded: number;
  readonly resultingStack: number;
}

export interface Pot {
  readonly amount: number;
  readonly eligiblePlayerIds: readonly string[];
}

export interface PotAward {
  readonly potIndex: number;
  readonly allocations: Readonly<Record<string, number>>;
}

export interface Hand {
  readonly id: string;
  readonly number: number;
  readonly status: "betting" | "dealPrompt" | "showdown" | "settled";
  readonly street: Street;
  readonly buttonPlayerId: string;
  readonly smallBlindPlayerId: string;
  readonly bigBlindPlayerId: string;
  readonly actorPlayerId?: string;
  readonly currentBet: number;
  readonly lastFullRaiseSize: number;
  readonly participants: readonly HandParticipant[];
  readonly actions: readonly HandAction[];
  readonly pendingTransition?: Exclude<Street, "preflop">;
  readonly winnerPlayerId?: string;
  readonly potAmount?: number;
  readonly pots?: readonly Pot[];
  readonly awards?: readonly PotAward[];
}

export interface Game {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly status: "active" | "completed";
  readonly settings: {
    readonly smallBlind: number;
    readonly bigBlind: number;
  };
  readonly chipSupply: number;
  readonly players: readonly Player[];
  readonly dealerPlayerId: string;
  readonly handNumber: number;
  readonly currentHand?: Hand;
  readonly completedHands: readonly never[];
  readonly auditLog: readonly never[];
}
