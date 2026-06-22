import type { ReactNode } from "react";

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export const Badge = ({ tone = "neutral", children }: { readonly tone?: BadgeTone; readonly children: ReactNode }) => <span className={`badge badge--${tone}`}>{children}</span>;
