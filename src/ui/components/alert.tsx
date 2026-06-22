import type { ReactNode } from "react";

type AlertTone = "info" | "success" | "danger" | "warning";

export const Alert = ({ tone = "info", children, role }: { readonly tone?: AlertTone; readonly children: ReactNode; readonly role?: "alert" | "status" }) => (
  <div className={`alert alert--${tone}`} role={role ?? (tone === "danger" || tone === "warning" ? "alert" : "status")}>{children}</div>
);
