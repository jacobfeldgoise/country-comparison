import React, { useMemo, useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { geoEqualEarth, geoPath } from "d3-geo";
import { ArrowLeftRight, Search, Info } from "lucide-react";

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------
// The design system in this project is intentionally tiny.  The components
// below provide minimal styling wrappers so the rest of the file can focus on
// application logic rather than className juggling.

/** Generic card container with rounded corners + border. */
const Card = ({ className = "", children }) => (
  <div className={`bg-white border rounded-2xl ${className}`}>{children}</div>
);

/** Spacing wrapper used inside <Card /> elements. */
const CardContent = ({ className = "", children }) => (
  <div className={`p-4 sm:p-6 ${className}`}>{children}</div>
);

/**
 * Button primitive used everywhere in the UI.
 * The "variant" prop controls the color treatment.
 */
const Button = ({
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
const Input = ({ className = "", ...props }) => (
  <input
    className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`}
    {...props}
  />
);

/** Reusable select/dropdown control. */
const Select = ({ value, onChange, children, className = "" }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={`rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`}
  >
    {children}
  </select>
);

/** Wrapper around <option> for readability. */
const SelectItem = ({ value, children }) => <option value={value}>{children}</option>;

// ---------------------------------------------------------------------------
// Map interaction helpers
// ---------------------------------------------------------------------------

const MAP_SELECTION_COLORS = {
  A: {
    fill: "#6366F1",
    listBgClass: "bg-indigo-50",
    chipClass: "bg-indigo-50 text-indigo-700",
    pulseClass: "map-selection-pulse--a",
  },
  B: {
    fill: "#F97316",
    listBgClass: "bg-orange-50",
    chipClass: "bg-orange-50 text-orange-700",
    pulseClass: "map-selection-pulse--b",
  },
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const identityConstrain = (position) => position;

const useBoundedZoomPan = ({
  center = [0, 0],
  zoom = 1,
  minZoom = 1,
  maxZoom = 5,
  zoomSensitivity = 0.025,
  onZoomStart,
  onZoomEnd,
  onMoveStart,
  onMove,
  onMoveEnd,
  disablePanning = false,
  disableZooming = false,
  width = 0,
  height = 0,
  projection,
  constrain = identityConstrain,
}) => {
  const clampPosition = useCallback(
    (pos) => {
      const baseZoom = clampNumber(pos.zoom ?? zoom, minZoom, maxZoom);
      const base = {
        x: pos.x ?? 0,
        y: pos.y ?? 0,
        zoom: baseZoom,
      };

      try {
        const constrained = constrain({ ...base });
        if (!constrained) return base;
        return {
          x: Number.isFinite(constrained.x) ? constrained.x : base.x,
          y: Number.isFinite(constrained.y) ? constrained.y : base.y,
          zoom: clampNumber(constrained.zoom ?? base.zoom, minZoom, maxZoom),
        };
      } catch {
        return base;
      }
    },
    [constrain, maxZoom, minZoom, zoom]
  );

  const projectCenter = useCallback(
    (coordinates, currentZoom) => {
      if (!projection) {
        return {
          x: width / 2,
          y: height / 2,
        };
      }

      try {
        const projected = projection(coordinates);
        if (!Array.isArray(projected) || projected.length < 2) {
          throw new Error("invalid projection");
        }
        const [px, py] = projected;
        if (!Number.isFinite(px) || !Number.isFinite(py)) {
          throw new Error("non-finite projection");
        }
        return {
          x: width / 2 - px * currentZoom,
          y: height / 2 - py * currentZoom,
        };
      } catch {
        return {
          x: width / 2,
          y: height / 2,
        };
      }
    },
    [projection, width, height]
  );

  const [position, setPosition] = useState(() => {
    const projected = projectCenter(center, zoom);
    const clamped = clampPosition({ ...projected, zoom });
    return {
      x: clamped.x,
      y: clamped.y,
      last: [clamped.x, clamped.y],
      zoom: clamped.zoom,
      dragging: false,
      zooming: false,
    };
  });

  const elRef = useRef(null);
  const point = useRef(null);
  const wheelTimer = useRef(null);
  const isPointerDown = useRef(false);
  const pointerOrigin = useRef(null);

  const getPointFromEvent = useCallback((event) => {
    const svg = elRef.current?.closest("svg");
    if (!svg) {
      return { x: 0, y: 0 };
    }

    if (!point.current) {
      point.current = svg.createSVGPoint();
    }

    if (event.targetTouches && event.targetTouches[0]) {
      point.current.x = event.targetTouches[0].clientX;
      point.current.y = event.targetTouches[0].clientY;
    } else {
      point.current.x = event.clientX;
      point.current.y = event.clientY;
    }

    try {
      const invertedMatrix = svg.getScreenCTM().inverse();
      return point.current.matrixTransform(invertedMatrix);
    } catch {
      return { x: 0, y: 0 };
    }
  }, []);

  const handlePointerDown = useCallback(
    (event) => {
      if (disablePanning) return;
      const svg = elRef.current?.closest("svg");
      if (!svg) return;

      isPointerDown.current = true;
      pointerOrigin.current = getPointFromEvent(event);

      setPosition((current) => {
        const next = { ...current, dragging: true };
        if (onMoveStart) onMoveStart(event, next);
        return next;
      });
    },
    [disablePanning, getPointFromEvent, onMoveStart]
  );

  const handlePointerMove = useCallback(
    (event) => {
      if (!isPointerDown.current) return;
      event.preventDefault();
      const pointerPosition = getPointFromEvent(event);

      setPosition((current) => {
        if (!pointerOrigin.current) return current;
        const raw = {
          ...current,
          x: current.last[0] + (pointerPosition.x - pointerOrigin.current.x),
          y: current.last[1] + (pointerPosition.y - pointerOrigin.current.y),
          dragging: true,
        };
        const clamped = clampPosition(raw);
        const next = {
          ...current,
          x: clamped.x,
          y: clamped.y,
          zoom: clamped.zoom,
          dragging: true,
        };
        if (onMove) onMove(event, next);
        return next;
      });
    },
    [clampPosition, getPointFromEvent, onMove]
  );

  const handlePointerUp = useCallback(
    (event) => {
      if (!isPointerDown.current) return;
      isPointerDown.current = false;

      setPosition((current) => {
        const clamped = clampPosition(current);
        const next = {
          ...current,
          x: clamped.x,
          y: clamped.y,
          zoom: clamped.zoom,
          last: [clamped.x, clamped.y],
          dragging: false,
        };
        if (onMoveEnd) onMoveEnd(event, next);
        return next;
      });
    },
    [clampPosition, onMoveEnd]
  );

  const handleWheel = useCallback(
    (event) => {
      if (!event.ctrlKey || disableZooming) return;
      event.preventDefault();

      const speed = event.deltaY * zoomSensitivity;

      setPosition((current) => {
        const newZoom = clampNumber(current.zoom - speed, minZoom, maxZoom);
        const pointerPosition = getPointFromEvent(event);

        const rawX = (current.x - pointerPosition.x) * (newZoom / current.zoom) + pointerPosition.x;
        const rawY = (current.y - pointerPosition.y) * (newZoom / current.zoom) + pointerPosition.y;

        let next = {
          ...current,
          x: rawX,
          y: rawY,
          zoom: newZoom,
          zooming: true,
          last: [rawX, rawY],
        };

        next = { ...next, ...clampPosition(next) };
        next.last = [next.x, next.y];

        window.clearTimeout(wheelTimer.current);
        wheelTimer.current = window.setTimeout(() => {
          setPosition((finalState) => ({ ...finalState, zooming: false }));
          if (onZoomEnd) onZoomEnd(event, next);
        }, 66);

        if (onZoomStart) onZoomStart(event, next);

        return next;
      });
    },
    [clampPosition, disableZooming, getPointFromEvent, maxZoom, minZoom, onZoomEnd, onZoomStart, zoomSensitivity]
  );

  useLayoutEffect(() => {
    const svg = elRef.current?.closest("svg");
    if (!svg) return undefined;

    const down = (event) => handlePointerDown(event);
    const move = (event) => handlePointerMove(event);
    const up = (event) => handlePointerUp(event);

    svg.addEventListener("wheel", handleWheel, { passive: false });

    if (window.PointerEvent) {
      svg.addEventListener("pointerdown", down);
      svg.addEventListener("pointermove", move, { passive: false });
      svg.addEventListener("pointerup", up);
      svg.addEventListener("pointerleave", up);
    } else {
      svg.addEventListener("mousedown", down);
      svg.addEventListener("mousemove", move);
      svg.addEventListener("mouseup", up);
      svg.addEventListener("mouseleave", up);
      svg.addEventListener("touchstart", down);
      svg.addEventListener("touchmove", move, { passive: false });
      svg.addEventListener("touchend", up);
    }

    return () => {
      svg.removeEventListener("wheel", handleWheel);

      if (window.PointerEvent) {
        svg.removeEventListener("pointerdown", down);
        svg.removeEventListener("pointermove", move);
        svg.removeEventListener("pointerup", up);
        svg.removeEventListener("pointerleave", up);
      } else {
        svg.removeEventListener("mousedown", down);
        svg.removeEventListener("mousemove", move);
        svg.removeEventListener("mouseup", up);
        svg.removeEventListener("mouseleave", up);
        svg.removeEventListener("touchstart", down);
        svg.removeEventListener("touchmove", move);
        svg.removeEventListener("touchend", up);
      }
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handleWheel]);

  useEffect(() => {
    setPosition((current) => {
      const updated = clampPosition({ ...current, zoom });
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [clampPosition, zoom]);

  useEffect(() => {
    setPosition((current) => {
      const projected = projectCenter(center, current.zoom);
      const updated = clampPosition({ ...current, ...projected });
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [center, clampPosition, projectCenter]);

  useEffect(() => {
    setPosition((current) => {
      const updated = clampPosition(current);
      return {
        ...current,
        x: updated.x,
        y: updated.y,
        zoom: updated.zoom,
        last: [updated.x, updated.y],
      };
    });
  }, [clampPosition]);

  useEffect(() => () => {
    if (wheelTimer.current) {
      window.clearTimeout(wheelTimer.current);
    }
  }, []);

  return {
    elRef,
    position,
    transformString: `translate(${position.x} ${position.y}) scale(${position.zoom})`,
  };
};

const BoundedZoomableGroup = ({
  children,
  render,
  className = "",
  width,
  height,
  projection,
  constrain,
  ...rest
}) => {
  const { elRef, position, transformString } = useBoundedZoomPan({
    width,
    height,
    projection,
    constrain,
    ...rest,
  });

  return (
    <g ref={elRef} className={`rsm-zoomable-group ${className}`}>
      {render ? render(position) : <g transform={transformString}>{children}</g>}
    </g>
  );
};

// ---------------------------------------------------------------------------
// Constants & helper utilities
// ---------------------------------------------------------------------------

/** URL for the Natural Earth GeoJSON dataset used to draw country boundaries. */
const geoUrl = `${import.meta.env.BASE_URL}data/world-countries.geojson`;

// Base dimensions for the responsive map and related derived constants.
const BASE_W = 960;
const BASE_H = 520;
const ASPECT = BASE_H / BASE_W;

// Cache data for one day in localStorage.
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_KEY = "wb:lastRefreshed";

/**
 * Safely extract an ISO-3 country code from a GeoJSON properties object.
 * Multiple property names are checked because the source dataset is not
 * completely consistent.  Returns `null` if the ISO code is missing or the
 * placeholder value "-99" appears.
 */
const getIso3 = (props) => {
  const iso =
    props?.ISO_A3 ??
    props?.iso_a3 ??
    props?.ISO_A3_EH ??
    props?.iso_a3_eh ??
    props?.ADM0_A3 ??
    props?.adm0_a3 ??
    props?.ISO3 ??
    props?.iso3;

  if (!iso || iso === "-99") return null;
  return String(iso).toUpperCase();
};

/** Friendly display name used for hover tooltips and the selection list. */
const getNameProp = (props) =>
  props?.NAME ?? props?.name ?? props?.NAME_LONG ?? props?.name_long ?? props?.ADMIN ?? "";

/** Extract an ISO-2 country code from GeoJSON properties when available. */
const getIso2 = (props) => {
  const iso2 =
    props?.ISO_A2 ??
    props?.iso_a2 ??
    props?.ISO_A2_EH ??
    props?.iso_a2_eh ??
    props?.WB_A2 ??
    props?.wb_a2;

  if (!iso2 || iso2 === "-99") return null;
  const normalized = String(iso2).toUpperCase();
  return normalized.length === 2 ? normalized : null;
};

/** Convert a two-letter ISO code into its corresponding flag emoji. */
const iso2ToFlagEmoji = (iso2) => {
  if (!iso2 || typeof iso2 !== "string" || iso2.length !== 2) return "";
  const upper = iso2.toUpperCase();
  const chars = Array.from(upper);
  if (chars.some((char) => char < "A" || char > "Z")) return "";
  return String.fromCodePoint(
    ...chars.map((char) => 0x1f1e6 + char.charCodeAt(0) - "A".charCodeAt(0))
  );
};

/** Append the flag emoji (when available) to a country name. */
const countryWithFlag = (name, iso2) => {
  const base = typeof name === "string" ? name.trim() : "";
  const flag = iso2ToFlagEmoji(iso2);
  if (!base) return flag || "";
  return flag ? `${base} ${flag}` : base;
};

/** Map a [0, 1] number to a blue-ish color on a white-to-deep gradient. */
const whiteBlue = (t) => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const lightness = Math.round(98 - 40 * clamped);
  return `hsl(210, 70%, ${lightness}%)`;
};

/** Generate `n` color stops using the gradient above. */
const whiteBluePalette = (n) =>
  Array.from({ length: n }, (_, index) => whiteBlue(n === 1 ? 1 : index / (n - 1)));

/**
 * Human friendly number formatter used for big magnitudes (thousands, millions…).
 * Returns an em dash for nullish / empty values so the table stays legible.
 */
const numberFmt = (value) => {
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
const smallNumberFmt = (value, digits = 1) => {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "—";
  }

  return truncateTo(Number(value), digits)
    .toFixed(digits)
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
};

/** Format numbers specifically for use in the legend labels. */
const legendFmt = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";

  return Math.abs(numeric) >= 1e3 ? numberFmt(numeric) : smallNumberFmt(numeric, 1);
};

/** Format fractional values (0.2) as signed percentages (+20.0%). */
const pctFmt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  const sign = value >= 0 ? "+" : "";
  return sign + truncateTo(value * 100, 1).toFixed(1) + "%";
};

/** Format absolute percentage values (20) with consistent precision. */
const percentFmt = (value, digits = 1) => {
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
const fmtTime = (timestamp) => {
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
const DiffCell = ({ a, b, suffix = "" }) => {
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
const relAB = (a, b) => {
  if (a == null || a === "" || b == null || b === "") return "na";

  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return "na";

  if (an === bn) return "tie";
  return an > bn ? "A" : "B";
};

const StatRow = ({
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
    rowYear = Math.max(...(yearsA.length ? yearsA : [-Infinity]), ...(yearsB.length ? yearsB : [-Infinity]));
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

const SearchBox = ({ placeholder, value, onChange }) => (
  <div className="relative w-full">
    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
    <Input className="pl-8" placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
  </div>
);

export default function App() {
  // -------------------------------------------------------------------------
  // Metrics catalog (World Bank indicator codes + formatting helpers)
  // -------------------------------------------------------------------------
  const METRICS = useMemo(
    () => [
      {
        field: "population",
        label: "Population",
        code: "SP.POP.TOTL",
        fmt: numberFmt,
        alwaysInclude: true,
        category: "Population & Society",
      },
      {
        field: "population_growth_pct",
        label: "Population growth (%)",
        code: "SP.POP.GROW",
        fmt: (value) => percentFmt(value, 2),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Population & Society",
      },
      {
        field: "urban_pop_pct",
        label: "Urban population (%)",
        code: "SP.URB.TOTL.IN.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Population & Society",
      },
      {
        field: "life_expectancy",
        label: "Life expectancy (yrs)",
        code: "SP.DYN.LE00.IN",
        fmt: (value) => smallNumberFmt(value, 1),
        alwaysInclude: true,
        category: "Population & Society",
      },
      {
        field: "fertility_rate",
        label: "Fertility rate (births per woman)",
        code: "SP.DYN.TFRT.IN",
        fmt: (value) => smallNumberFmt(value, 1),
        minCoverage: 0.6,
        category: "Population & Society",
      },
      {
        field: "infant_mortality_per_1000",
        label: "Infant mortality (per 1k births)",
        code: "SP.DYN.IMRT.IN",
        fmt: (value) => smallNumberFmt(value, 1),
        minCoverage: 0.6,
        category: "Population & Society",
      },
      {
        field: "gdp_nominal_usd",
        label: "GDP (nominal, USD)",
        code: "NY.GDP.MKTP.CD",
        fmt: (value) => "$" + numberFmt(value),
        alwaysInclude: true,
        category: "Economy & Trade",
      },
      {
        field: "gdp_per_capita_usd",
        label: "GDP per capita (USD)",
        code: "NY.GDP.PCAP.CD",
        fmt: (value) => "$" + numberFmt(value),
        alwaysInclude: true,
        category: "Economy & Trade",
      },
      {
        field: "gdp_growth_pct",
        label: "GDP growth (%)",
        code: "NY.GDP.MKTP.KD.ZG",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Economy & Trade",
      },
      {
        field: "unemployment_rate_pct",
        label: "Unemployment (%)",
        code: "SL.UEM.TOTL.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Economy & Trade",
      },
      {
        field: "inflation_cpi_pct",
        label: "Inflation (CPI, %)",
        code: "FP.CPI.TOTL.ZG",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Economy & Trade",
      },
      {
        field: "exports_usd",
        label: "Exports (USD)",
        code: "NE.EXP.GNFS.CD",
        fmt: (value) => "$" + numberFmt(value),
        minCoverage: 0.5,
        category: "Economy & Trade",
      },
      {
        field: "imports_usd",
        label: "Imports (USD)",
        code: "NE.IMP.GNFS.CD",
        fmt: (value) => "$" + numberFmt(value),
        minCoverage: 0.5,
        category: "Economy & Trade",
      },
      {
        field: "health_exp_gdp_pct",
        label: "Health expenditure (% GDP)",
        code: "SH.XPD.CHEX.GD.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.5,
        category: "Health",
      },
      {
        field: "health_exp_per_capita_usd",
        label: "Health expenditure per capita (USD)",
        code: "SH.XPD.CHEX.PC.CD",
        fmt: (value) => (value == null ? "—" : "$" + numberFmt(value)),
        minCoverage: 0.5,
        category: "Health",
      },
      {
        field: "access_to_electricity_pct",
        label: "Access to electricity (%)",
        code: "EG.ELC.ACCS.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Infrastructure & Connectivity",
      },
      {
        field: "internet_users_pct",
        label: "Internet users (%)",
        code: "IT.NET.USER.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.5,
        category: "Infrastructure & Connectivity",
      },
      {
        field: "mobile_subscriptions_per_100",
        label: "Mobile subscriptions (per 100)",
        code: "IT.CEL.SETS.P2",
        fmt: (value) => smallNumberFmt(value, 1),
        minCoverage: 0.6,
        category: "Infrastructure & Connectivity",
      },
      {
        field: "area_km2",
        label: "Area (km²)",
        code: "AG.SRF.TOTL.K2",
        fmt: numberFmt,
        alwaysInclude: true,
        category: "Environment & Land",
      },
      {
        field: "forest_area_pct",
        label: "Forest area (%)",
        code: "AG.LND.FRST.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.6,
        category: "Environment & Land",
      },
      {
        field: "renewables_pct",
        label: "Renewables electricity (%)",
        code: "EG.ELC.RNEW.ZS",
        fmt: (value) => percentFmt(value, 1),
        diffSuffix: "%",
        minCoverage: 0.4,
        category: "Environment & Land",
      },
    ],
    []
  );

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [liveRows, setLiveRows] = useState([]);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const [codeA, setCodeA] = useState(null);
  const [codeB, setCodeB] = useState(null);
  const [hoverName, setHoverName] = useState("");
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [filter, setFilter] = useState("");
  const [colorMetric, setColorMetric] = useState("gdp_per_capita_usd");
  const [colorScaleMode, setColorScaleMode] = useState("quantile");
  const [worldFC, setWorldFC] = useState(null);

  // -------------------------------------------------------------------------
  // Fetch World Bank metrics + GeoJSON boundaries
  // -------------------------------------------------------------------------
  const fetchLive = useCallback(async () => {
    setError("");

    try {
      // 1. Country metadata from the World Bank.
      const countryResponse = await fetch(
        "https://api.worldbank.org/v2/country?format=json&per_page=400"
      );
      const countryJson = await countryResponse.json();
      const countries = countryJson[1] || [];

      const wbCountries = countries
        .filter((country) => country.region?.id !== "NA" && country.iso3Code)
        .map((country) => ({
          iso3: country.iso3Code.toUpperCase(),
          iso2: country.iso2Code ? country.iso2Code.toUpperCase() : null,
          country: country.name,
        }));

      const wbNameMap = new Map(wbCountries.map((country) => [country.iso3, country.country]));
      const wbIso2Map = new Map(wbCountries.map((country) => [country.iso3, country.iso2]));

      // 2. GeoJSON boundary data for the world map.
      const geoResponse = await fetch(geoUrl, { cache: "no-store" });
      if (!geoResponse.ok) {
        throw new Error(
          `Failed to load world boundaries (status ${geoResponse.status} ${geoResponse.statusText || ""}).`.trim()
        );
      }

      const geoJson = await geoResponse.json();
      if (!Array.isArray(geoJson?.features)) {
        throw new Error("GeoJSON response did not include a features array.");
      }

      const featureCollection =
        geoJson?.type === "FeatureCollection"
          ? geoJson
          : { type: "FeatureCollection", features: geoJson.features };
      const features = featureCollection.features;

      const geoCountries = features
        .map((feature) => {
          const iso = getIso3(feature.properties);
          const name = getNameProp(feature.properties);
          const iso2 = getIso2(feature.properties);
          return iso ? { iso3: iso, iso2: iso2 || null, country: name } : null;
        })
        .filter(Boolean);

      const geoNameMap = new Map(geoCountries.map((country) => [country.iso3, country.country]));
      const geoIso2Map = new Map(
        geoCountries.filter((country) => country.iso2).map((country) => [country.iso3, country.iso2])
      );

      if (Array.isArray(features) && features.length > 0) {
        setWorldFC(featureCollection);
      }

      // Helper that loads an individual indicator series from the World Bank API.
      const fetchIndicator = async (code) => {
        const indicatorResponse = await fetch(
          `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&MRV=10`
        );
        const indicatorJson = await indicatorResponse.json();
        const rows = indicatorJson[1]?.filter((row) => row.countryiso3code) || [];

        const latest = new Map();
        const series = new Map();

        for (const row of rows) {
          const iso = String(row.countryiso3code).toUpperCase();
          const valueRaw = row.value;
          const year = parseInt(row.date, 10);

          if (valueRaw == null || Number.isNaN(Number(valueRaw))) continue;

          const value = typeof valueRaw === "string" ? Number(valueRaw) : valueRaw;

          if (!series.has(iso)) series.set(iso, {});
          const seriesForCountry = series.get(iso);
          if (seriesForCountry[year] == null) seriesForCountry[year] = value;

          const previous = latest.get(iso);
          if (!previous || year > previous.year) latest.set(iso, { value, year });
        }

        return { latest, series };
      };

      // Pull all indicators in parallel.
      const bundles = await Promise.all(METRICS.map((metric) => fetchIndicator(metric.code)));

      // Combine the GeoJSON + World Bank sets to create the master row list.
      const allIso = new Set([...wbNameMap.keys(), ...geoNameMap.keys()]);
      bundles.forEach((bundle) => bundle.latest.forEach((_, iso) => allIso.add(iso)));

      const nameMap = new Map(geoNameMap);
      wbNameMap.forEach((name, iso) => nameMap.set(iso, name));

      const rows = Array.from(allIso)
        .filter((iso) => wbNameMap.has(iso) || geoNameMap.has(iso))
        .map((iso) => {
          const row = {
            iso3: iso,
            iso2: wbIso2Map.get(iso) || geoIso2Map.get(iso) || null,
            country: nameMap.get(iso) || iso,
            __years: {},
          };

          METRICS.forEach((metric, index) => {
            const latest = bundles[index].latest.get(iso);
            const series = bundles[index].series.get(iso);

            if (latest) {
              row[metric.field] = latest.value;
              row.__years[metric.field] = latest.year;
            }

            row.__series || (row.__series = {});
            if (series) row.__series[metric.field] = series;
          });

          return row;
        });

      setLiveRows(rows);

      const now = Date.now();
      setLastRefreshed(now);
      try {
        localStorage.setItem(LAST_KEY, String(now));
      } catch {
        // Ignore localStorage access failures (e.g., Safari private mode).
      }
    } catch (error) {
      setError(error?.message || "Failed to fetch live data");
    }
  }, [METRICS]);

  // --- Once-per-day refresh policy ---
  useEffect(() => {
    let last = null;
    try {
      const raw = localStorage.getItem(LAST_KEY);
      if (raw) last = Number(raw);
    } catch {
      // Ignore localStorage access failures (e.g., Safari private mode).
    }

    const now = Date.now();
    if (!last || !Number.isFinite(last) || now - last > DAY_MS || !liveRows.length) {
      fetchLive();
    } else {
      setLastRefreshed(last);
    }

    const id = setInterval(fetchLive, DAY_MS);
    return () => clearInterval(id);
  }, [fetchLive, liveRows.length]);

  const activeRows = liveRows;

  const dataByIso3 = useMemo(() => {
    const map = new Map();
    for (const row of activeRows) {
      if (row.iso3) map.set(row.iso3.toUpperCase(), row);
    }
    return map;
  }, [activeRows]);

  const countryList = useMemo(() => {
    const seen = new Set();
    const unique = [];

    for (const row of dataByIso3.values()) {
      if (!row?.iso3 || seen.has(row.iso3)) continue;
      seen.add(row.iso3);
      unique.push({ iso3: row.iso3, iso2: row.iso2 || null, country: row.country || row.iso3 });
    }

    return unique.sort((a, b) => a.country.localeCompare(b.country));
  }, [dataByIso3]);

  const dataA = codeA ? dataByIso3.get(codeA.toUpperCase()) : null;
  const dataB = codeB ? dataByIso3.get(codeB.toUpperCase()) : null;

  const coverageByField = useMemo(() => {
    const stats = {};
    const total = activeRows.length;
    const hasRows = total > 0;

    METRICS.forEach((metric) => {
      stats[metric.field] = { count: 0, ratio: hasRows ? 0 : null };
    });

    if (!hasRows) return stats;

    for (const row of activeRows) {
      METRICS.forEach((metric) => {
        const value = row?.[metric.field];
        if (typeof value === "number" && !Number.isNaN(value)) {
          stats[metric.field].count += 1;
        }
      });
    }

    METRICS.forEach((metric) => {
      const entry = stats[metric.field];
      entry.ratio = total > 0 ? entry.count / total : null;
    });

    return stats;
  }, [activeRows, METRICS]);

  const curatedMetrics = useMemo(
    () =>
      METRICS.filter((metric) => {
        if (metric.alwaysInclude) return true;

        const ratio = coverageByField[metric.field]?.ratio;
        const min = metric.minCoverage ?? 0;
        if (ratio == null) return true;
        return ratio >= min;
      }),
    [METRICS, coverageByField]
  );

  const suppressedMetrics = useMemo(
    () =>
      METRICS.filter((metric) => {
        if (metric.alwaysInclude) return false;
        const ratio = coverageByField[metric.field]?.ratio;
        const min = metric.minCoverage ?? 0;
        return typeof ratio === "number" && ratio < min;
      }),
    [METRICS, coverageByField]
  );

  const curatedMetricFields = useMemo(
    () => curatedMetrics.map((metric) => metric.field),
    [curatedMetrics]
  );

  const metrics = useMemo(() => {
    const found = new Set(curatedMetricFields);

    for (const row of activeRows) {
      for (const [key, value] of Object.entries(row)) {
        if (["iso3", "country", "__years"].includes(key)) continue;
        if (typeof value !== "number" || Number.isNaN(value)) continue;

        if (!found.has(key)) {
          const ratio = coverageByField[key]?.ratio;
          const min = METRICS.find((metric) => metric.field === key)?.minCoverage ?? 0;
          if (ratio == null || typeof ratio !== "number" || ratio >= min) {
            found.add(key);
          }
        }
      }
    }

    return Array.from(found);
  }, [activeRows, curatedMetricFields, coverageByField, METRICS]);

  const findMetricConfig = (field) => METRICS.find((metric) => metric.field === field);

  const labelFor = (field) => {
    if (!field) return "";
    return findMetricConfig(field)?.label || field;
  };

  const fmtFor = (field) => {
    if (!field) return numberFmt;
    return findMetricConfig(field)?.fmt || numberFmt;
  };

  const diffSuffixFor = (field) => {
    if (!field) return "";
    return findMetricConfig(field)?.diffSuffix || "";
  };

  const metricGroups = useMemo(() => {
    if (!metrics.length) return [];

    const curatedSet = new Set(curatedMetrics.map((metric) => metric.field));
    const groups = [];
    const groupMap = new Map();

    const ensureGroup = (title, order) => {
      const key = title || "Additional metrics";
      if (groupMap.has(key)) {
        const existing = groupMap.get(key);
        existing.order = Math.min(existing.order, order);
        return existing;
      }

      const group = { title: key, order, metrics: [] };
      groupMap.set(key, group);
      groups.push(group);
      return group;
    };

    const pushMetric = (metric, order) => {
      const group = ensureGroup(metric.category, order);
      group.metrics.push({
        field: metric.field,
        label: metric.label || metric.field,
        fmt: metric.fmt || numberFmt,
        diffSuffix: metric.diffSuffix || "",
      });
    };

    curatedMetrics.forEach((metric, index) => {
      pushMetric(metric, index);
    });

    metrics.forEach((field, index) => {
      if (curatedSet.has(field)) return;

      const config = METRICS.find((metric) => metric.field === field);
      pushMetric(
        {
          field,
          label: config?.label || field,
          category: config?.category || "Additional metrics",
          fmt: config?.fmt || numberFmt,
          diffSuffix: config?.diffSuffix || "",
        },
        curatedMetrics.length + index
      );
    });

    return groups.sort((a, b) => a.order - b.order);
  }, [metrics, curatedMetrics, METRICS]);

  const hiddenMetricLabels = useMemo(() => {
    if (!suppressedMetrics.length) return [];

    return suppressedMetrics
      .map((metric) => {
        const stats = coverageByField[metric.field];
        if (!stats || typeof stats.ratio !== "number") return null;
        const count = stats.count;
        return `${metric.label} (${count} countries)`;
      })
      .filter(Boolean);
  }, [suppressedMetrics, coverageByField]);

  useEffect(() => {
    if (!metrics.length) {
      if (colorMetric !== null) setColorMetric(null);
      return;
    }

    if (!colorMetric || !metrics.includes(colorMetric)) {
      setColorMetric(metrics[0]);
    }
  }, [metrics, colorMetric]);

  const latestYearByField = useMemo(() => {
    const result = {};

    metrics.forEach((field) => {
      let max = null;
      for (const row of activeRows) {
        const year = row.__years?.[field];
        if (typeof year === "number" && (max === null || year > max)) max = year;
      }
      result[field] = max;
    });

    return result;
  }, [activeRows, metrics]);

  const defaultYear = useMemo(() => {
    const years = Object.values(latestYearByField).filter((year) => typeof year === "number");
    return years.length ? Math.max(...years) : null;
  }, [latestYearByField]);

  const valueStats = useMemo(() => {
    if (!colorMetric) return { vals: [], thresholds: [], palette: [] };

    const values = activeRows
      .map((row) => row[colorMetric])
      .filter((value) => typeof value === "number" && !Number.isNaN(value))
      .sort((a, b) => a - b);

    if (!values.length) return { vals: [], thresholds: [], palette: [] };

    const quantile = (p) => {
      const index = (values.length - 1) * p;
      const lo = Math.floor(index);
      const hi = Math.ceil(index);
      if (lo === hi) return values[lo];
      const t = index - lo;
      return values[lo] * (1 - t) + values[hi] * t;
    };

    const thresholds = [0.2, 0.4, 0.6, 0.8].map(quantile);
    const palette = whiteBluePalette(5);

    return { vals: values, thresholds, palette };
  }, [activeRows, colorMetric]);

  const linearStats = useMemo(() => {
    if (!colorMetric) return { min: 0, max: 0, hasVals: false, range: 0 };

    const values = activeRows
      .map((row) => row[colorMetric])
      .filter((value) => typeof value === "number" && !Number.isNaN(value));

    if (!values.length) return { min: 0, max: 0, hasVals: false, range: 0 };

    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, hasVals: true, range: max - min };
  }, [activeRows, colorMetric]);

  const colorFor = useCallback(
    (value) => {
      if (!colorMetric) return whiteBlue(0);
      if (typeof value !== "number" || Number.isNaN(value)) return whiteBlue(0);

      if (colorScaleMode === "quantile") {
        if (!valueStats.vals.length) return whiteBlue(0);

        const { thresholds, palette } = valueStats;
        let index = 0;
        while (index < thresholds.length && value > thresholds[index]) index += 1;
        return palette[index];
      }

      if (!linearStats.hasVals || linearStats.max === linearStats.min) return whiteBlue(0);
      const t = (value - linearStats.min) / (linearStats.max - linearStats.min);
      return whiteBlue(t);
    },
    [colorScaleMode, linearStats, valueStats]
  );

  const filtered = useMemo(() => {
    const term = filter.toLowerCase();
    return countryList.filter((country) => (country.country || "").toLowerCase().includes(term));
  }, [countryList, filter]);

  const [lastA, setLastA] = useState(0);
  const [lastB, setLastB] = useState(0);

  const setSelection = (iso3) => {
    if (!iso3) return;

    const iso = iso3.toUpperCase();
    if (iso === codeA || iso === codeB) return;

    const now = Date.now();

    if (!codeA && !codeB) {
      setCodeA(iso);
      setLastA(now);
      return;
    }

    if (!codeA) {
      setCodeA(iso);
      setLastA(now);
      return;
    }

    if (!codeB) {
      setCodeB(iso);
      setLastB(now);
      return;
    }

    if (lastA <= lastB) {
      setCodeA(iso);
      setLastA(now);
    } else {
      setCodeB(iso);
      setLastB(now);
    }
  };

  const swap = useCallback(() => {
    setCodeA(codeB);
    setCodeB(codeA);
  }, [codeA, codeB]);

  const clear = useCallback(() => {
    setCodeA(null);
    setCodeB(null);
  }, []);

  // Accessibility: allow keyboard users to select countries.
  const onGeoKeyDown = (event, iso3, disabled) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelection(iso3);
    }
  };

  // -------------------------------------------------------------------------
  // Zoom + responsive sizing
  // -------------------------------------------------------------------------
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState([0, 0]);
  const zoomRef = useRef(zoom);
  const centerRef = useRef(center);
  const draggingRef = useRef(false);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);
  const containerRef = useRef(null);
  const [mapW, setMapW] = useState(BASE_W);
  const [mapH, setMapH] = useState(BASE_H);

  const mapProjection = useMemo(() => {
    const projection = geoEqualEarth().translate([mapW / 2, mapH / 2]);
    try {
      if (worldFC) {
        projection.fitSize([mapW, mapH], worldFC);
      } else {
        projection.scale(150 * (mapW / BASE_W));
      }
    } catch {
      projection.scale(150 * (mapW / BASE_W));
    }
    return projection;
  }, [worldFC, mapW, mapH]);

  const mapDragBounds = useMemo(() => {
    if (!mapProjection || !worldFC) {
      return {
        bounds: [
          [0, 0],
          [mapW, mapH],
        ],
        width: mapW,
        height: mapH,
        padX: 0,
        padY: 0,
      };
    }

    try {
      const path = geoPath(mapProjection);
      const bounds = path.bounds(worldFC);
      if (!bounds || bounds.length !== 2) throw new Error("invalid bounds");

      const [[minX, minY], [maxX, maxY]] = bounds;
      const width = maxX - minX;
      const height = maxY - minY;

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error("non-finite bounds");
      }

      const padX = Math.max(0, (mapW - width) / 2);
      const padY = Math.max(0, (mapH - height) / 2);

      return {
        bounds,
        width,
        height,
        padX,
        padY,
      };
    } catch (error) {
      console.warn("Falling back to default drag bounds", error);
      return {
        bounds: [
          [0, 0],
          [mapW, mapH],
        ],
        width: mapW,
        height: mapH,
        padX: 0,
        padY: 0,
      };
    }
  }, [mapProjection, worldFC, mapW, mapH]);

  const constrainDragPosition = useCallback(
    (position) => {
      const rawZoom = position?.zoom ?? zoomRef.current ?? 1;
      const safeZoom = Math.max(1, Math.min(rawZoom, 8));

      if (!mapProjection || !mapDragBounds) {
        return {
          x: Number.isFinite(position?.x) ? position.x : 0,
          y: Number.isFinite(position?.y) ? position.y : 0,
          zoom: safeZoom,
        };
      }

      const {
        bounds: [[minX, minY], [maxX, maxY]],
        width,
        height,
      } = mapDragBounds;

      const clampAxisValue = (current, minCoord, maxCoord, viewport, contentSize) => {
        if (
          !Number.isFinite(minCoord) ||
          !Number.isFinite(maxCoord) ||
          !Number.isFinite(contentSize)
        ) {
          return Number.isFinite(current) ? current : 0;
        }

        const scaledSize = contentSize * safeZoom;
        if (!Number.isFinite(scaledSize)) {
          return Number.isFinite(current) ? current : 0;
        }

        if (scaledSize <= viewport) {
          const centerCoord = (minCoord + maxCoord) / 2;
          return viewport / 2 - safeZoom * centerCoord;
        }

        let minTranslate = viewport - safeZoom * maxCoord;
        let maxTranslate = -safeZoom * minCoord;

        if (!Number.isFinite(minTranslate) || !Number.isFinite(maxTranslate)) {
          return Number.isFinite(current) ? current : 0;
        }

        if (minTranslate > maxTranslate) {
          const mid = (minTranslate + maxTranslate) / 2;
          minTranslate = mid;
          maxTranslate = mid;
        }

        const base = Number.isFinite(current)
          ? current
          : clampNumber((minTranslate + maxTranslate) / 2, minTranslate, maxTranslate);

        return clampNumber(base, minTranslate, maxTranslate);
      };

      const nextX = clampAxisValue(position?.x, minX, maxX, mapW, width);
      const nextY = clampAxisValue(position?.y, minY, maxY, mapH, height);

      return {
        x: nextX,
        y: nextY,
        zoom: safeZoom,
      };
    },
    [mapDragBounds, mapProjection, mapW, mapH]
  );

  const clampCenter = useCallback(
    (coordinates, rawZoom = zoomRef.current) => {
      const safeZoom = Math.max(1, Math.min(rawZoom ?? 1, 8));
      const [lon = 0, lat = 0] = Array.isArray(coordinates) ? coordinates : [0, 0];

      if (!mapProjection?.invert) {
        return [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))];
      }

      const projected = mapProjection([lon, lat]);
      if (!projected) {
        return [0, 0];
      }

      const initial = {
        x: mapW / 2 - projected[0] * safeZoom,
        y: mapH / 2 - projected[1] * safeZoom,
        zoom: safeZoom,
      };

      const constrained = constrainDragPosition(initial);

      const adjustedProjected = [
        (mapW / 2 - constrained.x) / constrained.zoom,
        (mapH / 2 - constrained.y) / constrained.zoom,
      ];
      const adjusted = mapProjection.invert(adjustedProjected);

      if (!adjusted) {
        return [Math.max(-180, Math.min(180, lon)), Math.max(-90, Math.min(90, lat))];
      }

      return [
        Math.max(-180, Math.min(180, adjusted[0])),
        Math.max(-90, Math.min(90, adjusted[1])),
      ];
    },
    [constrainDragPosition, mapProjection, mapW, mapH]
  );

  const setView = useCallback(
    (nextCenter, rawZoom = zoomRef.current) => {
      const safeZoom = Math.max(1, Math.min(rawZoom ?? 1, 8));
      const safeCenter = clampCenter(nextCenter, safeZoom);

      setZoom((prevZoom) => (Math.abs(prevZoom - safeZoom) < 1e-3 ? prevZoom : safeZoom));
      setCenter((prevCenter) => {
        if (!prevCenter) return safeCenter;
        const [prevLon, prevLat] = prevCenter;
        const [nextLon, nextLat] = safeCenter;
        if (Math.abs(prevLon - nextLon) < 1e-3 && Math.abs(prevLat - nextLat) < 1e-3) {
          return prevCenter;
        }
        return safeCenter;
      });
    },
    [clampCenter]
  );

  const adjustZoom = useCallback(
    (compute) => {
      const nextZoom = compute(zoomRef.current);
      setView(centerRef.current, nextZoom);
    },
    [setView]
  );

  const applyPosition = useCallback(
    (position) => {
      if (!position) return;

      const constrained = constrainDragPosition(position);
      const safeZoom = constrained.zoom;

      if (!mapProjection?.invert) {
        setView(centerRef.current, safeZoom);
        return;
      }

      const projectedX = (mapW / 2 - constrained.x) / safeZoom;
      const projectedY = (mapH / 2 - constrained.y) / safeZoom;
      const derivedCenter = mapProjection.invert([projectedX, projectedY]);

      if (!derivedCenter) {
        setView(centerRef.current, safeZoom);
        return;
      }

      setView(derivedCenter, safeZoom);
    },
    [constrainDragPosition, mapProjection, mapW, mapH, setView]
  );

  const skipClickRef = useRef(false);

  const handleMoveStart = useCallback(() => {
    draggingRef.current = false;
    skipClickRef.current = false;
  }, []);

  const handleMove = useCallback(() => {
    if (!draggingRef.current) {
      draggingRef.current = true;
      setIsDraggingMap(true);
      setHoverName("");
    }
    skipClickRef.current = true;
  }, [setHoverName, setIsDraggingMap]);

  const handleMoveOrZoomEnd = useCallback(
    (_, position) => {
      draggingRef.current = false;
      setIsDraggingMap(false);
      if (typeof window !== "undefined") {
        window.requestAnimationFrame
          ? window.requestAnimationFrame(() => {
              skipClickRef.current = false;
            })
          : setTimeout(() => {
              skipClickRef.current = false;
            }, 0);
      } else {
        skipClickRef.current = false;
      }
      applyPosition(position);
    },
    [applyPosition]
  );

  useEffect(() => {
    setView(centerRef.current, zoomRef.current);
  }, [mapDragBounds, mapProjection, setView]);

  // -------------------------------------------------------------------------
  // Self-tests (run once in development to catch regressions quickly)
  // -------------------------------------------------------------------------
  useEffect(() => {
    console.group("Country Comparator - self-tests");
    try {
      console.assert(numberFmt(1e3) === "1.0K");
      console.assert(numberFmt(1500) === "1.5K");
      console.assert(numberFmt(2e6) === "2.0M");
      console.assert(numberFmt(null) === "—");
      console.assert(numberFmt(1.5e12) === "1.5T");

      console.assert(pctFmt(0.1) === "+10.0%" && pctFmt(-0.25) === "-25.0%" && pctFmt(null) === "—");
      console.assert(pctFmt(0.1999) === "+19.9%");

      console.assert(smallNumberFmt(1.239, 1) === "1.2" && smallNumberFmt(1.2, 1) === "1.2");
      console.assert(smallNumberFmt(-1.239, 1) === "-1.2");

      console.assert(typeof getNameProp({ NAME: "Test" }) === "string");
      console.assert(getIso3({ ISO_A3: "USA" }) === "USA" && getIso3({ iso_a3: "fra" }) === "FRA");
      console.assert(getIso3({ ISO_A3: "-99" }) === null);

      console.assert(whiteBlue(0) === "hsl(210, 70%, 98%)");
      console.assert(whiteBlue(1) === "hsl(210, 70%, 58%)");
      console.assert(whiteBlue(-1) === "hsl(210, 70%, 98%)");
      console.assert(whiteBlue(2) === "hsl(210, 70%, 58%)");
      console.assert(whiteBluePalette(5)[0] === whiteBlue(0) && whiteBluePalette(5)[4] === whiteBlue(1));

      console.assert(legendFmt(12.3456) === "12.3" && legendFmt(1234) === "1.2K", "legendFmt rounding");
      if (linearStats.hasVals) {
        console.assert(
          typeof legendFmt(linearStats.min) === "string" && typeof legendFmt(linearStats.max) === "string",
          "linear legend labels"
        );
      }

      if (valueStats.vals.length) {
        const thresholds = valueStats.thresholds;
        console.assert(
          thresholds.length === 4 && thresholds.every((value, index, arr) => index === 0 || value >= arr[index - 1])
        );
        const minColorQ = colorFor(valueStats.vals[0]);
        const maxColorQ = colorFor(valueStats.vals[valueStats.vals.length - 1]);
        console.assert(minColorQ !== maxColorQ);
      }

      if (linearStats.hasVals) {
        const mid = (linearStats.min + linearStats.max) / 2;
        const cMin = colorFor(linearStats.min);
        const cMid = colorFor(mid);
        const cMax = colorFor(linearStats.max);
        console.assert(cMin !== cMax && cMin !== cMid && cMid !== cMax);
      }

      const gradient = "linear-gradient(to right, " + whiteBlue(0) + ", " + whiteBlue(1) + ")";
      console.assert(typeof gradient === "string" && gradient.includes("linear-gradient"));

      if (valueStats.palette.length) {
        console.assert(valueStats.palette[0] === whiteBlue(0) && valueStats.palette.at(-1) === whiteBlue(1));
      }

      const computedScale = typeof mapProjection?.scale === "function" ? mapProjection.scale() : null;
      if (mapW && mapH) {
        console.assert(typeof computedScale === "number" && computedScale > 0);
      }

      if (defaultYear) {
        Object.values(latestYearByField).forEach((year) => {
          if (typeof year === "number") console.assert(defaultYear >= year);
        });
      }

      console.assert(latestYearByField && typeof latestYearByField === "object");

      if (!codeA && !codeB) {
        const hdrA = dataA?.country || "—";
        const hdrB = dataB?.country || "—";
        console.assert(hdrA === "—" && hdrB === "—");
      }

      console.assert(relAB(5, 3) === "A" && relAB(3, 5) === "B" && relAB(2, 2) === "tie" && relAB(null, 1) === "na");
      console.assert(relAB("10", 9.999) === "A");
      console.assert(relAB("5", "5") === "tie");

      console.assert(typeof fmtTime(Date.now()) === "string");
      console.assert(typeof zoom === "number" && Array.isArray(center) && center.length === 2);
      console.assert(typeof clear === "function" && typeof swap === "function", "clear/swap exist");
      console.assert(metrics.includes("population"), "metrics include base fields");

      // Daily refresh checks (non-fatal)
      console.assert(typeof localStorage !== "undefined", "localStorage available");
      if (lastRefreshed) console.assert(lastRefreshed <= Date.now(), "lastRefreshed sane");
    } catch (error) {
      console.error("Self-tests error:", error);
    } finally {
      console.groupEnd();
    }
  }, [
    center,
    clear,
    codeA,
    codeB,
    colorFor,
    dataA,
    dataB,
    defaultYear,
    lastRefreshed,
    latestYearByField,
    linearStats,
    mapH,
    mapProjection,
    mapW,
    metrics,
    swap,
    valueStats,
    zoom,
  ]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const update = (width) => {
      const safeWidth = Math.max(320, width);
      setMapW(safeWidth);
      setMapH(Math.round(safeWidth * ASPECT));
    };

    update(element.clientWidth || BASE_W);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const hasLegendVals =
    colorScaleMode === "quantile"
      ? valueStats.vals.length >= 2
      : linearStats.hasVals && linearStats.min !== linearStats.max;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        {/* ----------------------------------------------------------------- */}
        {/* Header */}
        {/* ----------------------------------------------------------------- */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Country Comparator</h1>
            <p className="text-sm text-slate-500 mt-1">
              Click two countries to compare. Data loads live from the World Bank (latest non-null year shown). Auto-refreshes once
              daily.
            </p>
            {error && <p className="text-xs mt-1 text-rose-600">{error}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={clear} className="gap-2">
              Clear
            </Button>
            <Button variant="secondary" onClick={swap} className="gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Swap
            </Button>
            <span className="text-xs text-slate-500">
              Data last updated: <span className="font-medium">{lastRefreshed ? fmtTime(lastRefreshed) : "—"}</span>
            </span>
          </div>
        </header>

        {/* ----------------------------------------------------------------- */}
        {/* Content */}
        {/* ----------------------------------------------------------------- */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 mt-4">
          {/* Map + controls */}
          <Card className="lg:col-span-8 rounded-2xl shadow-sm">
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Info className="h-4 w-4" />
                  <span>
                    Click the map to select up to two countries. Click a different country to replace the older selection, or use
                    Clear.
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Color by</span>
                  <Select value={colorMetric || ""} onChange={setColorMetric} className="w-64" disabled={!metrics.length}>
                    {metrics.map((metric) => (
                      <SelectItem key={metric} value={metric}>
                        {labelFor(metric)}
                      </SelectItem>
                    ))}
                  </Select>
                  <span className="text-xs text-slate-500">Scale</span>
                  <Select value={colorScaleMode} onChange={setColorScaleMode} className="w-40">
                    <SelectItem value="quantile">Quantile (quintiles)</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                  </Select>
                </div>
              </div>

              {hiddenMetricLabels.length > 0 ? (
                <p className="text-xs text-slate-500 mb-3">
                  Hidden due to limited data: {hiddenMetricLabels.join(", ")}
                </p>
              ) : null}

              <div className="border rounded-2xl overflow-hidden">
                <div className="relative w-full" ref={containerRef}>
                  {worldFC ? (
                    <>
                      <div className="absolute z-10 right-2 top-2 flex flex-col gap-2">
                        <Button variant="outline" onClick={() => adjustZoom((z) => Math.min(z * 1.5, 8))}>
                          +
                        </Button>
                        <Button variant="outline" onClick={() => adjustZoom((z) => Math.max(z / 1.5, 1))}>
                          -
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setView([0, 0], 1);
                          }}
                        >
                          Reset
                        </Button>
                      </div>

                      {hoverName && !isDraggingMap && (
                        <div className="absolute left-3 top-3 z-10 px-3 py-1.5 rounded-lg bg-white/95 shadow-md ring-1 ring-slate-200 text-xs font-medium text-slate-700 pointer-events-none">
                          {hoverName}
                        </div>
                      )}

                      <ComposableMap width={mapW} height={mapH} projection={mapProjection}>
                        <BoundedZoomableGroup
                          zoom={zoom}
                          center={center}
                          onMoveStart={handleMoveStart}
                          onMove={handleMove}
                          onMoveEnd={handleMoveOrZoomEnd}
                          onZoomEnd={handleMoveOrZoomEnd}
                          minZoom={1}
                          maxZoom={8}
                          width={mapW}
                          height={mapH}
                          projection={mapProjection}
                          constrain={constrainDragPosition}
                        >
                          <Geographies geography={worldFC?.features ?? []}>
                            {({ geographies }) => (
                              <>
                                {geographies.map((geo) => {
                                  const iso3 = getIso3(geo.properties);
                                  const disabled = !iso3;
                                  const row = !disabled ? dataByIso3.get(iso3) : null;
                                  const selectedLabel = !disabled && iso3 === codeA ? "A" : !disabled && iso3 === codeB ? "B" : null;
                                  const fillColor = disabled
                                    ? whiteBlue(0.05)
                                    : selectedLabel
                                    ? MAP_SELECTION_COLORS[selectedLabel].fill
                                    : colorFor(row?.[colorMetric]);
                                  const selectionFilter = selectedLabel ? MAP_SELECTION_COLORS[selectedLabel].fill : null;

                                  const baseStyles = {
                                    outline: "none",
                                    pointerEvents: disabled || isDraggingMap ? "none" : "auto",
                                    transition: "filter 150ms ease",
                                  };

                                  const hoverFilter =
                                    !disabled && !isDraggingMap
                                      ? selectedLabel
                                        ? `drop-shadow(0 0 0.25rem ${selectionFilter}55) drop-shadow(0 0 0.75rem ${selectionFilter}33) brightness(0.95)`
                                        : "brightness(0.95)"
                                      : undefined;

                                  return (
                                    <React.Fragment key={geo.rsmKey}>
                                      <Geography
                                        geography={geo}
                                        onMouseEnter={() => {
                                          if (disabled || draggingRef.current || isDraggingMap) {
                                            setHoverName("");
                                            return;
                                          }
                                          const fallbackName = getNameProp(geo.properties);
                                          const fallbackIso2 = getIso2(geo.properties);
                                          const display = countryWithFlag(
                                            row?.country || fallbackName,
                                            row?.iso2 || fallbackIso2 || null
                                          );
                                          setHoverName(display || fallbackName || "");
                                        }}
                                        onMouseLeave={() => setHoverName("")}
                                        onClick={() => {
                                          if (disabled || draggingRef.current || isDraggingMap || skipClickRef.current) return;
                                          setSelection(iso3);
                                        }}
                                        onKeyDown={(event) => onGeoKeyDown(event, iso3, disabled)}
                                        tabIndex={disabled ? -1 : 0}
                                        style={{
                                          default: {
                                            ...baseStyles,
                                            filter: selectedLabel
                                              ? `drop-shadow(0 0 0.25rem ${selectionFilter}66) drop-shadow(0 0 0.75rem ${selectionFilter}33)`
                                              : undefined,
                                          },
                                          hover: {
                                            ...baseStyles,
                                            filter: hoverFilter,
                                          },
                                          pressed: { outline: "none" },
                                        }}
                                        fill={fillColor}
                                        stroke="#CBD5E1"
                                        strokeWidth={0.6}
                                      />
                                      {selectedLabel && (
                                        <Geography
                                          geography={geo}
                                          className={`map-selection-pulse ${MAP_SELECTION_COLORS[selectedLabel].pulseClass}`}
                                          vectorEffect="non-scaling-stroke"
                                          style={{
                                            default: { pointerEvents: "none" },
                                            hover: { pointerEvents: "none" },
                                            pressed: { pointerEvents: "none" },
                                          }}
                                          fill="none"
                                        />
                                      )}
                                    </React.Fragment>
                                  );
                                })}
                            </>
                          )}
                        </Geographies>
                      </BoundedZoomableGroup>
                    </ComposableMap>
                    </>
                  ) : (
                    <div className="flex items-center justify-center py-24 text-sm text-slate-500">
                      Loading map data…
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end mt-2 text-sm text-slate-500">
                <div>
                  Selected: <span className="font-medium">{countryWithFlag(dataA?.country || "—", dataA?.iso2)}</span> vs {" "}
                  <span className="font-medium">{countryWithFlag(dataB?.country || "—", dataB?.iso2)}</span>
                </div>
              </div>

              <div className="mt-3" title={`Legend — ${labelFor(colorMetric)}`}>
                {colorScaleMode === "quantile" ? (
                  hasLegendVals ? (
                    <div className="flex flex-wrap items-center gap-4">
                      {valueStats.palette.map((color, index) => {
                        const thresholds = valueStats.thresholds;
                        const isFirst = index === 0;
                        const isLast = index === valueStats.palette.length - 1;
                        const lower = !isFirst ? legendFmt(thresholds[index - 1]) : null;
                        const upper = !isLast ? legendFmt(thresholds[index]) : legendFmt(thresholds[thresholds.length - 1]);

                        const label = isFirst
                          ? `≤ ${upper}`
                          : isLast
                          ? `> ${lower}`
                          : `${lower}-${upper}`;

                        return (
                          <div key={index} className="flex items-center gap-2">
                            <span className="inline-block w-6 h-3 rounded" style={{ backgroundColor: color }} />
                            <span className="text-xs text-slate-500">{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Not enough data to compute quantile legend.</div>
                  )
                ) : hasLegendVals ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{legendFmt(linearStats.min)}</span>
                    <div
                      className="h-2 w-56 rounded"
                      style={{ background: `linear-gradient(to right, ${whiteBlue(0)}, ${whiteBlue(1)})` }}
                    />
                    <span className="text-xs text-slate-500">{legendFmt(linearStats.max)}</span>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">Not enough data to compute linear legend.</div>
                )}
                <div className="text-xs text-slate-500 mt-1">
                  Legend — {labelFor(colorMetric)} ({colorScaleMode === "quantile" ? "quintiles" : "linear"})
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <SearchBox
                  placeholder="Search/select a country (fills A then B, then replaces the older)"
                  value={filter}
                  onChange={setFilter}
                />
                <div className="max-h-56 overflow-auto rounded-xl border">
                  {filtered.map((country) => {
                    const selectedLabel = country.iso3 === codeA ? "A" : country.iso3 === codeB ? "B" : null;
                    const baseClasses =
                      "w-full flex items-center justify-between text-left px-3 py-2 text-sm border-b last:border-0 hover:bg-slate-50";
                    const selectionClass = selectedLabel ? MAP_SELECTION_COLORS[selectedLabel].listBgClass : "";

                    return (
                      <button
                        key={country.iso3}
                        className={`${baseClasses} ${selectionClass}`}
                        onClick={() => setSelection(country.iso3)}
                      >
                        <span>
                          {countryWithFlag(country.country, country.iso2)}
                          <span className="text-xs text-slate-500 ml-2">{country.iso3}</span>
                        </span>
                        {selectedLabel && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${
                              selectedLabel ? MAP_SELECTION_COLORS[selectedLabel].chipClass : ""
                            }`}
                          >
                            {selectedLabel}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats table */}
          <Card className="lg:col-span-4 rounded-2xl shadow-sm lg:min-w-[26rem] xl:min-w-[30rem]">
            <CardContent>
              <h2 className="text-lg font-semibold mb-1">Comparison</h2>
              <div className="text-xs text-slate-500 mb-3">
                Data from <span className="font-medium">{defaultYear ?? "—"}</span> unless otherwise specified
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-[38%]" />
                    <col className="w-[22%]" />
                    <col className="w-[22%]" />
                    <col className="w-[18%]" />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="py-2 pr-2 font-medium">Metric</th>
                      <th className="py-2 pr-2 font-medium">
                        <span
                          className="block whitespace-normal break-words"
                          title={countryWithFlag(dataA?.country || "—", dataA?.iso2)}
                        >
                          {countryWithFlag(dataA?.country || "—", dataA?.iso2)}
                        </span>
                      </th>
                      <th className="py-2 pr-2 font-medium">
                        <span
                          className="block whitespace-normal break-words"
                          title={countryWithFlag(dataB?.country || "—", dataB?.iso2)}
                        >
                          {countryWithFlag(dataB?.country || "—", dataB?.iso2)}
                        </span>
                      </th>
                      <th className="py-2 pl-2 font-medium text-right">Δ / %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricGroups.map((group, groupIndex) => (
                      <React.Fragment key={group.title}>
                        <tr>
                          <td
                            colSpan={4}
                            className={`${groupIndex === 0 ? "pt-0" : "pt-5"} pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500`}
                          >
                            {group.title}
                          </td>
                        </tr>
                        {group.metrics.map((metric) => (
                          <StatRow
                            key={metric.field}
                            label={metric.label}
                            field={metric.field}
                            dataA={dataA}
                            dataB={dataB}
                            fmt={metric.fmt}
                            diffSuffix={metric.diffSuffix}
                            defaultYear={defaultYear}
                          />
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs text-slate-500 space-y-1">
                <p>
                  Source: World Bank Open Data (most recent non-null year within the last ~10 reported years per indicator). Some
                  indicators may be missing for certain countries or latest years due to gaps in the source dataset. Year badges
                  appear next to values; amber means older than the freshest year available for that metric.
                </p>
                <p>
                  Tip: Use <span className="font-medium">Swap</span> to flip A/B. <span className="font-medium">Clear</span> resets both
                  selections.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}