import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ variant = "secondary", className, children, ...props }, ref) => (
  <button ref={ref} className={["button", `button--${variant}`, className].filter(Boolean).join(" ")} {...props}>{children}</button>
));
Button.displayName = "Button";
