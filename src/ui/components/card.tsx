import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

export const Card = ({ title, eyebrow, actions, children, className, ...props }: CardProps) => (
  <section className={["card", className].filter(Boolean).join(" ")} {...props}>
    {(title !== undefined || eyebrow !== undefined || actions !== undefined) ? <div className="card__header">
      <div>{eyebrow !== undefined ? <p className="card__eyebrow">{eyebrow}</p> : null}{title !== undefined ? <h2 className="card__title">{title}</h2> : null}</div>
      {actions !== undefined ? <div className="card__actions">{actions}</div> : null}
    </div> : null}
    {children}
  </section>
);
