import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { geoEqualEarth } from "d3-geo";
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
  if (absValue >= 1e12) return (numeric / 1e12).toFixed(2) + "T";
  if (absValue >= 1e9) return (numeric / 1e9).toFixed(2) + "B";
  if (absValue >= 1e6) return (numeric / 1e6).toFixed(2) + "M";
  if (absValue >= 1e3) return (numeric / 1e3).toFixed(2) + "K";

  return String(numeric);
};

/** Helper used by smallNumberFmt + pctFmt to avoid floating point noise. */
const truncateTo = (value, digits = 2) => Math.trunc(Number(value) * 10 ** digits) / 10 ** digits;

/**
 * Produce compact decimal numbers while preserving trailing zeros only when
 * necessary.  Useful for metrics like life expectancy.
 */
const smallNumberFmt = (value, digits = 2) => {
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

  return Math.abs(numeric) >= 1e3 ? numberFmt(numeric) : smallNumberFmt(numeric, 2);
};

/** Format fractional values (0.2) as signed percentages (+20.0%). */
const pctFmt = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  const sign = value >= 0 ? "+" : "";
  return sign + truncateTo(value * 100, 1).toFixed(1) + "%";
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
  const display = abs >= 1000 ? numberFmt(abs) : smallNumberFmt(abs, 2);
  const trendClass =
    diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500";

  return (
    <div className="text-sm">
      <div className={`font-medium ${trendClass}`}>
        {sign}
        {display}
        {suffix}
      </div>
      <div className="text-xs text-slate-500">{pctFmt(pct)}</div>
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
  latestYear,
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
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      {rowYear && defaultYear && rowYear < defaultYear ? (
        <span className="text-[10px] text-amber-600" title={`Older data: ${rowYear} (default ${defaultYear})`}>
          ({rowYear})
        </span>
      ) : null}
    </span>
  );

  const highlightA = relationship === "A" ? "bg-emerald-50/30" : relationship === "B" ? "bg-rose-50/30" : "";
  const highlightB = relationship === "B" ? "bg-emerald-50/30" : relationship === "A" ? "bg-rose-50/30" : "";

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-2 text-xs sm:text-sm text-slate-500">{metricLabel}</td>
      <td className={`py-2 pr-2 font-medium whitespace-nowrap ${highlightA}`}>
        <span className="inline-flex items-center gap-1 align-middle">
          {fmt(valueA)}
          {relationship === "A" && icon("higher")}
          {relationship === "B" && icon("lower")}
        </span>
      </td>
      <td className={`py-2 pr-2 font-medium whitespace-nowrap ${highlightB}`}>
        <span className="inline-flex items-center gap-1 align-middle">
          {fmt(valueB)}
          {relationship === "B" && icon("higher")}
          {relationship === "A" && icon("lower")}
        </span>
      </td>
      <td className="py-2">
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
      { field: "population", label: "Population", code: "SP.POP.TOTL", fmt: numberFmt },
      {
        field: "gdp_nominal_usd",
        label: "GDP (nominal, USD)",
        code: "NY.GDP.MKTP.CD",
        fmt: (value) => "$" + numberFmt(value),
      },
      {
        field: "gdp_per_capita_usd",
        label: "GDP per capita (USD)",
        code: "NY.GDP.PCAP.CD",
        fmt: (value) => "$" + numberFmt(value),
      },
      {
        field: "life_expectancy",
        label: "Life expectancy (yrs)",
        code: "SP.DYN.LE00.IN",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1)),
      },
      {
        field: "co2_tonnes_per_capita",
        label: "CO₂ per capita (t)",
        code: "EN.ATM.CO2E.PC",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1)),
      },
      {
        field: "unemployment_rate_pct",
        label: "Unemployment (%)",
        code: "SL.UEM.TOTL.ZS",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
      {
        field: "inflation_cpi_pct",
        label: "Inflation (CPI, %)",
        code: "FP.CPI.TOTL.ZG",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
      { field: "area_km2", label: "Area (km²)", code: "AG.SRF.TOTL.K2", fmt: numberFmt },
      {
        field: "internet_users_pct",
        label: "Internet users (%)",
        code: "IT.NET.USER.ZS",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
      {
        field: "urban_pop_pct",
        label: "Urban population (%)",
        code: "SP.URB.TOTL.IN.ZS",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
      {
        field: "health_exp_gdp_pct",
        label: "Health expenditure (% GDP)",
        code: "SH.XPD.CHEX.GD.ZS",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
      { field: "exports_usd", label: "Exports (USD)", code: "NE.EXP.GNFS.CD", fmt: (value) => "$" + numberFmt(value) },
      { field: "imports_usd", label: "Imports (USD)", code: "NE.IMP.GNFS.CD", fmt: (value) => "$" + numberFmt(value) },
      {
        field: "renewables_pct",
        label: "Renewables electricity (%)",
        code: "EG.ELC.RNEW.ZS",
        fmt: (value) => (value == null ? "—" : Number(value).toFixed(1) + "%"),
        diffSuffix: "%",
      },
    ],
    []
  );

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [liveRows, setLiveRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const [codeA, setCodeA] = useState(null);
  const [codeB, setCodeB] = useState(null);
  const [hoverName, setHoverName] = useState("");
  const [filter, setFilter] = useState("");
  const [colorMetric, setColorMetric] = useState("gdp_per_capita_usd");
  const [colorScaleMode, setColorScaleMode] = useState("quantile");
  const [worldFC, setWorldFC] = useState(null);

  // -------------------------------------------------------------------------
  // Fetch World Bank metrics + GeoJSON boundaries
  // -------------------------------------------------------------------------
  const fetchLive = useCallback(async () => {
    setLoading(true);
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
          country: country.name,
        }));

      const wbNameMap = new Map(wbCountries.map((country) => [country.iso3, country.country]));

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
          return iso ? { iso3: iso, country: name } : null;
        })
        .filter(Boolean);

      const geoNameMap = new Map(geoCountries.map((country) => [country.iso3, country.country]));

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
          const row = { iso3: iso, country: nameMap.get(iso) || iso, __years: {} };

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
    } finally {
      setLoading(false);
    }
  }, [METRICS]);

  // --- Once-per-day refresh policy ---
  useEffect(() => {
    let last = null; try { const raw = localStorage.getItem(LAST_KEY); if (raw) last = Number(raw); } catch {}
    const now = Date.now();
    if (!last || !Number.isFinite(last) || now - last > DAY_MS || !liveRows.length) fetchLive(); else setLastRefreshed(last);
    const id = setInterval(fetchLive, DAY_MS);
    return () => clearInterval(id);
  }, [fetchLive]);

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
      unique.push({ iso3: row.iso3, country: row.country || row.iso3 });
    }

    return unique.sort((a, b) => a.country.localeCompare(b.country));
  }, [dataByIso3]);

  const dataA = codeA ? dataByIso3.get(codeA.toUpperCase()) : null;
  const dataB = codeB ? dataByIso3.get(codeB.toUpperCase()) : null;

  const metrics = useMemo(() => {
    const base = METRICS.map((metric) => metric.field);
    const found = new Set(base);

    for (const row of activeRows) {
      for (const [key, value] of Object.entries(row)) {
        if (["iso3", "country", "__years"].includes(key)) continue;
        if (typeof value === "number" && !Number.isNaN(value)) {
          found.add(key);
        }
      }
    }

    return Array.from(found);
  }, [METRICS, activeRows]);

  const labelFor = (field) => METRICS.find((metric) => metric.field === field)?.label || field;
  const fmtFor = (field) => METRICS.find((metric) => metric.field === field)?.fmt || numberFmt;
  const diffSuffixFor = (field) => METRICS.find((metric) => metric.field === field)?.diffSuffix || "";

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
    const values = activeRows
      .map((row) => row[colorMetric])
      .filter((value) => typeof value === "number" && !Number.isNaN(value));

    if (!values.length) return { min: 0, max: 0, hasVals: false, range: 0 };

    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, max, hasVals: true, range: max - min };
  }, [activeRows, colorMetric]);

  const colorFor = (value) => {
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
  };

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

  const swap = () => {
    const a = codeA;
    const b = codeB;
    setCodeA(b);
    setCodeB(a);
  };

  const clear = () => {
    setCodeA(null);
    setCodeB(null);
  };

  // -------------------------------------------------------------------------
  // Self-tests (run once in development to catch regressions quickly)
  // -------------------------------------------------------------------------
  useEffect(() => {
    console.group("Country Comparator - self-tests");
    try {
      console.assert(numberFmt(1e3) === "1.00K");
      console.assert(numberFmt(1500) === "1.50K");
      console.assert(numberFmt(2e6) === "2.00M");
      console.assert(numberFmt(null) === "—");
      console.assert(numberFmt(1.5e12) === "1.50T");

      console.assert(pctFmt(0.1) === "+10.0%" && pctFmt(-0.25) === "-25.0%" && pctFmt(null) === "—");
      console.assert(pctFmt(0.1999) === "+19.9%");

      console.assert(smallNumberFmt(1.239, 2) === "1.23" && smallNumberFmt(1.2, 2) === "1.2");
      console.assert(smallNumberFmt(-1.239, 2) === "-1.23");

      console.assert(typeof getNameProp({ NAME: "Test" }) === "string");
      console.assert(getIso3({ ISO_A3: "USA" }) === "USA" && getIso3({ iso_a3: "fra" }) === "FRA");
      console.assert(getIso3({ ISO_A3: "-99" }) === null);

      console.assert(whiteBlue(0) === "hsl(210, 70%, 98%)");
      console.assert(whiteBlue(1) === "hsl(210, 70%, 58%)");
      console.assert(whiteBlue(-1) === "hsl(210, 70%, 98%)");
      console.assert(whiteBlue(2) === "hsl(210, 70%, 58%)");
      console.assert(whiteBluePalette(5)[0] === whiteBlue(0) && whiteBluePalette(5)[4] === whiteBlue(1));

      console.assert(legendFmt(12.3456) === "12.34" && legendFmt(1234) === "1.23K", "legendFmt rounding");
      if (linearStats.hasVals) {
        console.assert(
          typeof legendFmt(linearStats.min) === "string" && typeof legendFmt(linearStats.max) === "string",
          "linear legend labels"
        );
      }

      if (valueStats.vals.length) {
        const thresholds = valueStats.thresholds;
        console.assert(thresholds.length === 4 && thresholds.every((value, index, arr) => index === 0 || value >= arr[index - 1]));
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

      if (mapW && mapH) console.assert(typeof computedScale === "number" && computedScale > 0);

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
  const containerRef = useRef(null);
  const [mapW, setMapW] = useState(BASE_W);
  const [mapH, setMapH] = useState(BASE_H);
  const computedScale = useMemo(() => {
    try {
      if (worldFC && mapW && mapH) {
        const projection = geoEqualEarth().fitSize([mapW, mapH], worldFC);
        return projection.scale();
      }
    } catch {
      // Fall through to default value below.
    }
    return 150 * (mapW / BASE_W);
  }, [worldFC, mapW, mapH]);

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
            <Button variant="secondary" onClick={swap} className="gap-2">
              <ArrowLeftRight className="h-4 w-4" />
              Swap
            </Button>
            <Button variant="outline" onClick={clear} className="gap-2">
              Clear
            </Button>
            <span className="text-xs text-slate-500">
              Last updated: <span className="font-medium">{lastRefreshed ? fmtTime(lastRefreshed) : "—"}</span>
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
                  <Select value={colorMetric} onChange={setColorMetric} className="w-64">
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

              <div className="border rounded-2xl overflow-hidden">
                <div className="relative w-full" ref={containerRef}>
                  {worldFC ? (
                    <>
                      <div className="absolute z-10 right-2 top-2 flex flex-col gap-2">
                        <Button variant="outline" onClick={() => setZoom((z) => Math.min(z * 1.5, 8))}>
                          +
                        </Button>
                        <Button variant="outline" onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}>
                          -
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setZoom(1);
                            setCenter([0, 0]);
                          }}
                        >
                          Reset
                        </Button>
                      </div>

                      {hoverName && (
                        <div className="absolute left-3 top-3 z-10 px-3 py-1.5 rounded-lg bg-white/95 shadow-md ring-1 ring-slate-200 text-xs font-medium text-slate-700 pointer-events-none">
                          {hoverName}
                        </div>
                      )}

                      <ComposableMap
                        width={mapW}
                        height={mapH}
                        projection="geoEqualEarth"
                        projectionConfig={{ scale: computedScale }}
                      >
                        <ZoomableGroup
                          zoom={zoom}
                          center={center}
                          onMoveEnd={({ zoom: nextZoom, coordinates }) => {
                            setZoom(nextZoom);
                            setCenter(coordinates);
                          }}
                          minZoom={1}
                          maxZoom={8}
                          translateExtent={[[0, 0], [mapW, mapH]]}
                        >
                          <Geographies geography={worldFC?.features ?? []}>
                            {({ geographies }) => (
                              <>
                                {geographies.map((geo) => {
                                  const iso3 = getIso3(geo.properties);
                                  const disabled = !iso3;
                                  const row = !disabled ? dataByIso3.get(iso3) : null;
                                  const isSelected = !disabled && (iso3 === codeA || iso3 === codeB);
                                  const fillColor = disabled
                                    ? whiteBlue(0.05)
                                    : isSelected
                                    ? iso3 === codeA
                                      ? "#10b981"
                                      : "#ef4444"
                                    : colorFor(row?.[colorMetric]);

                                  return (
                                    <Geography
                                      key={geo.rsmKey}
                                      geography={geo}
                                      onMouseEnter={() =>
                                        disabled ? setHoverName("") : setHoverName(getNameProp(geo.properties))
                                      }
                                      onMouseLeave={() => setHoverName("")}
                                      onClick={() => !disabled && setSelection(iso3)}
                                      onKeyDown={(event) => onGeoKeyDown(event, iso3, disabled)}
                                      tabIndex={disabled ? -1 : 0}
                                      style={{
                                        default: { outline: "none", pointerEvents: disabled ? "none" : "auto" },
                                        hover: { outline: "none", filter: disabled ? undefined : "brightness(0.95)" },
                                        pressed: { outline: "none" },
                                      }}
                                      fill={fillColor}
                                      stroke="#CBD5E1"
                                      strokeWidth={0.6}
                                    />
                                  );
                                })}
                            </>
                          )}
                        </Geographies>
                      </ZoomableGroup>
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
                  Selected: <span className="font-medium">{dataA?.country || "—"}</span> vs {" "}
                  <span className="font-medium">{dataB?.country || "—"}</span>
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
                    const selectionClass =
                      selectedLabel === "A"
                        ? "bg-emerald-50"
                        : selectedLabel === "B"
                        ? "bg-rose-50"
                        : "";

                    return (
                      <button
                        key={country.iso3}
                        className={`${baseClasses} ${selectionClass}`}
                        onClick={() => setSelection(country.iso3)}
                      >
                        <span>
                          {country.country}
                          <span className="text-xs text-slate-500 ml-2">{country.iso3}</span>
                        </span>
                        {selectedLabel && (
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${
                              selectedLabel === "A"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
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
          <Card className="lg:col-span-4 rounded-2xl shadow-sm">
            <CardContent>
              <h2 className="text-lg font-semibold mb-1">Comparison</h2>
              <div className="text-xs text-slate-500 mb-3">
                Data from <span className="font-medium">{defaultYear ?? "—"}</span> unless otherwise specified
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="py-2 pr-2 font-medium">Metric</th>
                      <th className="py-2 pr-2 font-medium whitespace-nowrap min-w-[8rem]">{dataA?.country || "—"}</th>
                      <th className="py-2 pr-2 font-medium whitespace-nowrap min-w-[8rem]">{dataB?.country || "—"}</th>
                      <th className="py-2 font-medium">Δ / %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <StatRow
                        key={metric}
                        label={labelFor(metric)}
                        field={metric}
                        dataA={dataA}
                        dataB={dataB}
                        fmt={fmtFor(metric)}
                        diffSuffix={diffSuffixFor(metric)}
                        latestYear={latestYearByField[metric]}
                        defaultYear={defaultYear}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs text-slate-500 space-y-1">
                <p>
                  Source: World Bank Open Data (most recent non-null year within the last ~10 reported years per indicator). Year
                  badges appear next to values; amber means older than the freshest year available for that metric.
                </p>
                <p>
                  Tip: Use <span className="font-medium">Swap</span> to flip A/B. <span className="font-medium">Clear</span> resets both
                  selections.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-6 text-xs text-slate-500">
          <p>Some indicators may be missing for certain countries or latest years due to gaps in the source dataset.</p>
        </footer>
      </div>
    </div>
  );
}