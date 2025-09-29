import React from "react";
import { DiffCell, relAB } from "../lib/formatters";

export const StatRow = ({
  label,
  field,
  dataA,
  dataB,
  fmt = (value) => value,
  diffSuffix = "",
  defaultYear,
}) => {
  const seriesA = dataA?.__series?.[field] || {};
  const seriesB = dataB?.__series?.[field] || {};

  const yearsA = Object.keys(seriesA).map(Number).filter(Number.isFinite);
  const yearsB = Object.keys(seriesB).map(Number).filter(Number.isFinite);

  // Prefer the latest year available in both datasets. If there is no common
  // year, fall back to the most recent year seen in either country.
  const commonYears = yearsA.filter((year) => yearsB.includes(year));
  let rowYear = null;
  if (commonYears.length) {
    rowYear = Math.max(...commonYears);
  } else if (yearsA.length || yearsB.length) {
    rowYear = Math.max(
      ...(yearsA.length ? yearsA : [-Infinity]),
      ...(yearsB.length ? yearsB : [-Infinity])
    );
  }

  const valueA = rowYear != null ? seriesA[rowYear] : null;
  const valueB = rowYear != null ? seriesB[rowYear] : null;
  const relationship = relAB(valueA, valueB);

  const icon = (kind) => (
    <span
      className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 ring-1 shrink-0"
      style={{
        backgroundColor: kind === "higher" ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.10)",
        color: kind === "higher" ? "rgb(5,122,85)" : "rgb(190,18,60)",
        borderColor: kind === "higher" ? "rgba(16,185,129,0.35)" : "rgba(244,63,94,0.35)",
      }}
      title={kind === "higher" ? "Higher" : "Lower"}
    >
      <span aria-hidden="true" className="text-[10px] leading-none">
        {kind === "higher" ? "▲" : "▼"}
      </span>
      <span className="sr-only">{kind === "higher" ? "Higher" : "Lower"}</span>
    </span>
  );

  const metricLabel = (
    <div className="flex items-start justify-between gap-2 min-w-0">
      <span className="flex-1 min-w-0 whitespace-normal break-words">{label}</span>
      {rowYear && defaultYear && rowYear < defaultYear ? (
        <span
          className="text-[10px] text-amber-600 shrink-0 whitespace-nowrap tabular-nums text-right"
          title={`Older data: ${rowYear} (default ${defaultYear})`}
        >
          ({rowYear})
        </span>
      ) : null}
    </div>
  );

  const highlightA = relationship === "A" ? "bg-emerald-50/30" : relationship === "B" ? "bg-rose-50/30" : "";
  const highlightB = relationship === "B" ? "bg-emerald-50/30" : relationship === "A" ? "bg-rose-50/30" : "";
  const displayA = fmt(valueA);
  const displayB = fmt(valueB);

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-xs sm:text-sm text-slate-500 align-top">{metricLabel}</td>
      <td className={`py-2 pr-2 font-medium ${highlightA}`}>
        <div className="flex items-center gap-1 min-w-0">
          <span className="truncate" title={displayA}>
            {displayA}
          </span>
          {relationship === "A" && icon("higher")}
          {relationship === "B" && icon("lower")}
        </div>
      </td>
      <td className={`py-2 pr-2 font-medium ${highlightB}`}>
        <div className="flex items-center gap-1 min-w-0">
          <span className="truncate" title={displayB}>
            {displayB}
          </span>
          {relationship === "B" && icon("higher")}
          {relationship === "A" && icon("lower")}
        </div>
      </td>
      <td className="py-2 pl-2 align-top">
        <DiffCell a={valueA} b={valueB} suffix={diffSuffix} />
      </td>
    </tr>
  );
};

export default StatRow;

