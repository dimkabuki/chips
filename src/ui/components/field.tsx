import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}

export const Field = ({ label, hint, children, className, ...props }: FieldProps) => (
  <label className={["field", className].filter(Boolean).join(" ")} {...props}>
    <span className="field__label">{label}</span>
    {children}
    {hint !== undefined ? <span className="field__hint">{hint}</span> : null}
  </label>
);

export const TextInput = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input className={["input", className].filter(Boolean).join(" ")} {...props} />;
export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={["input", className].filter(Boolean).join(" ")} {...props} />;
