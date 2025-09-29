import React from "react";

/**
 * Human friendly number formatter used for big magnitudes (thousands, millions…).
 * Returns an em dash for nullish / empty values so the table stays legible.
 */
export const numberFmt = (value) => {
  if (value === null || value === undefined || value === "") return "—";

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);

  const absValue = Math.abs(numeric);
  if (absValue >= 1e12) return (numeric / 1e12).toFixed(1) + "T";
  if (absValue >= 1e9) return (numeric / 1e9).toFixed(1) + "B";
  if (absValue >= 1e6) return (numeric / 1e6).toFixed(1) + "M";
  if (absValue >= 1e3) return (numeric / 1e3).toFixed(1) + "K";

  return String(numeric);
};

/** Helper used by smallNumberFmt + pctFmt to avoid floating point noise. */
const truncateTo = (value, digits = 1) => Math.trunc(Number(value) * 10 ** digits) / 10 ** digits;

/**
 * Produce compact decimal numbers while preserving trailing zeros only when
 * necessary.  Useful for metrics like life expectancy.
 */
export const smallNumberFmt = (value, digits = 1) => {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "—";
  }

  return truncateTo(Number(value), digits)
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
};

/** Format numbers specifically for use in the legend labels. */
export const legendFmt = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";

  return Math.abs(numeric) >= 1e3 ? numberFmt(numeric) : smallNumberFmt(numeric, 1);
};

/** Format fractional values (0.2) as signed percentages (+20.0%). */
export const pctFmt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  const sign = value >= 0 ? "+" : "";
  return sign + truncateTo(value * 100, 1).toFixed(1) + "%";
};

/** Format absolute percentage values (20) with consistent precision. */
export const percentFmt = (value, digits = 1) => {
  if (value === null || value === undefined || value === "") return "—";

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";

  return truncateTo(numeric, digits)
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/\.$/, "")
    .concat("%");
};

/** Present timestamps consistently with local time + 24h clock. */
export const fmtTime = (timestamp) => {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return String(timestamp);
  }
};

/**
 * Small component that renders the absolute + percentage difference between
 * two numeric values (used in the comparison table).
 */
export const DiffCell = ({ a, b, suffix = "" }) => {
  if (a == null || b == null || a === "" || b === "") return <span>—</span>;

  const diff = b - a;
  const pct = a !== 0 ? diff / a : null;
  const sign = diff > 0 ? "+" : diff < 0 ? "" : "";
  const abs = Math.abs(diff);
  const display = abs >= 1000 ? numberFmt(abs) : smallNumberFmt(abs, 1);
  const trendClass =
    diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500";

  return (
    <div className="text-sm text-right">
      <div className={`font-medium ${trendClass}`}>
        {sign}
        {display}
        {suffix}
      </div>
      <div className="text-xs text-slate-500 text-right">{pctFmt(pct)}</div>
    </div>
  );
};

/** Determine whether country A or B has the larger numeric value. */
export const relAB = (a, b) => {
  if (a == null || a === "" || b == null || b === "") return "na";

  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return "na";

  if (an === bn) return "tie";
  return an > bn ? "A" : "B";
};

