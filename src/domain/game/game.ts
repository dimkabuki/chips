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
  readonly completedHands: readonly never[];
  readonly auditLog: readonly never[];
}
