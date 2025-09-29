import React from "react";

/** Generic card container with rounded corners + border. */
export const Card = ({ className = "", children }) => (
  <div className={`bg-white border rounded-2xl ${className}`}>{children}</div>
);

/** Spacing wrapper used inside <Card /> elements. */
export const CardContent = ({ className = "", children }) => (
  <div className={`p-4 sm:p-6 ${className}`}>{children}</div>
);

/**
 * Button primitive used everywhere in the UI.
 * The "variant" prop controls the color treatment.
 */
export const Button = ({
  variant = "default",
  className = "",
  disabled,
  onClick,
  title,
  children,
}) => {
  const baseClasses =
    "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 border";

  const variantClasses =
    variant === "secondary"
      ? "bg-slate-100 hover:bg-slate-200 border-slate-200"
      : variant === "outline"
      ? "bg-white hover:bg-slate-50 border-slate-300"
      : "bg-slate-900 text-white hover:bg-black border-slate-900";

  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`${baseClasses} ${variantClasses} disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
};

/** Styled input used in search + filtering controls. */
export const Input = ({ className = "", ...props }) => (
  <input
    className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`}
    {...props}
  />
);

/** Reusable select/dropdown control. */
export const Select = ({ value, onChange, children, className = "" }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={`rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`}
  >
    {children}
  </select>
);

/** Wrapper around <option> for readability. */
export const SelectItem = ({ value, children }) => <option value={value}>{children}</option>;

