import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { geoEqualEarth } from "d3-geo";
import { ArrowLeftRight, Search, Info } from "lucide-react";

// --- UI primitives ---
const Card = ({ className = "", children }) => <div className={"bg-white border rounded-2xl " + className}>{children}</div>;
const CardContent = ({ className = "", children }) => <div className={"p-4 sm:p-6 " + className}>{children}</div>;
const Button = ({ variant = "default", className = "", disabled, onClick, title, children }) => {
  const base = "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 border";
  const styles = variant === "secondary" ? " bg-slate-100 hover:bg-slate-200 border-slate-200" : variant === "outline" ? " bg-white hover:bg-slate-50 border-slate-300" : " bg-slate-900 text-white hover:bg-black border-slate-900";
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${styles} disabled:opacity-60 disabled:cursor-not-allowed ${className}`}>
      {children}
    </button>
  );
};
const Input = ({ className = "", ...props }) => <input className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`} {...props} />;
const Select = ({ value, onChange, children, className = "" }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={`rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 ${className}`}>
    {children}
  </select>
);
const SelectItem = ({ value, children }) => <option value={value}>{children}</option>;

// --- Constants & helpers ---
const geoUrl = "https://geojson.xyz/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson";
const BASE_W = 960, BASE_H = 520, ASPECT = BASE_H / BASE_W;
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_KEY = "wb:lastRefreshed";
const getIso3 = (props) => { const iso = props?.ISO_A3 ?? props?.iso_a3 ?? props?.ISO_A3_EH ?? props?.iso_a3_eh ?? props?.ADM0_A3 ?? props?.adm0_a3 ?? props?.ISO3 ?? props?.iso3; return !iso || iso === "-99" ? null : String(iso).toUpperCase(); };
const getNameProp = (props) => props?.NAME ?? props?.name ?? props?.NAME_LONG ?? props?.name_long ?? props?.ADMIN ?? "";
const whiteBlue = (t) => `hsl(210, 70%, ${Math.round(98 - 40 * Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)))}%)`;
const whiteBluePalette = (n) => Array.from({ length: n }, (_, i) => whiteBlue(n === 1 ? 1 : i / (n - 1)));
const numberFmt = (v) => { if (v === null || v === undefined || v === "") return "—"; const n = Number(v); if (!Number.isFinite(n)) return String(v); if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + "T"; if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B"; if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "M"; if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(2) + "K"; return String(n) };
const truncateTo = (v, d = 2) => Math.trunc(Number(v) * 10 ** d) / 10 ** d;
const smallNumberFmt = (v, d = 2) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) ? "—" : truncateTo(Number(v), d).toFixed(d).replace(/\.0+$/, "").replace(/\.$/, "");
const legendFmt = (v) => { const n = Number(v); if (!Number.isFinite(n)) return "—"; return Math.abs(n) >= 1e3 ? numberFmt(n) : smallNumberFmt(n, 2); };
const pctFmt = (v) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (v >= 0 ? "+" : "") + truncateTo(v * 100, 1).toFixed(1) + "%";
const fmtTime = (ts) => { try { return new Date(ts).toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return String(ts); } };

const DiffCell = ({ a, b, suffix = "" }) => { if (a == null || b == null || a === "" || b === "") return <span>—</span>; const diff = b - a, pct = a !== 0 ? diff / a : null, sign = diff > 0 ? "+" : diff < 0 ? "" : "", abs = Math.abs(diff); const display = abs >= 1000 ? numberFmt(abs) : smallNumberFmt(abs, 2); return (<div className="text-sm"><div className={"font-medium " + (diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-500")}>{sign}{display}{suffix}</div><div className="text-xs text-slate-500">{pctFmt(pct)}</div></div>)};
const relAB = (a, b) => { if (a == null || a === "" || b == null || b === "") return "na"; const an = Number(a), bn = Number(b); if (!Number.isFinite(an) || !Number.isFinite(bn)) return "na"; return an === bn ? "tie" : an > bn ? "A" : "B"; };

const StatRow = ({ label, field, dataA, dataB, fmt = (v) => v, diffSuffix = "", latestYear, defaultYear }) => {
  const sA = dataA?.__series?.[field] || {}, sB = dataB?.__series?.[field] || {};
  const yA = Object.keys(sA).map(Number).filter(Number.isFinite), yB = Object.keys(sB).map(Number).filter(Number.isFinite);
  const common = yA.filter((y) => yB.includes(y));
  let rowYear = null; if (common.length) rowYear = Math.max(...common); else if (yA.length || yB.length) rowYear = Math.max(...(yA.length ? yA : [-Infinity]), ...(yB.length ? yB : [-Infinity]));
  const aVal = rowYear != null ? sA[rowYear] : null, bVal = rowYear != null ? sB[rowYear] : null, rel = relAB(aVal, bVal);
  const icon = (k) => (<span className="ml-2 inline-flex items-center rounded px-1.5 py-0.5 ring-1 shrink-0" style={{ backgroundColor: k === 'higher' ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.10)', color: k === 'higher' ? 'rgb(5,122,85)' : 'rgb(190,18,60)', borderColor: k === 'higher' ? 'rgba(16,185,129,0.35)' : 'rgba(244,63,94,0.35)' }} title={k === 'higher' ? 'Higher' : 'Lower'}><span aria-hidden="true" className="text-[10px] leading-none">{k === 'higher' ? '▲' : '▼'}</span><span className="sr-only">{k === 'higher' ? 'Higher' : 'Lower'}</span></span>);
  const metric = (<span className="inline-flex items-center gap-2"><span>{label}</span>{rowYear && defaultYear && rowYear < defaultYear ? (<span className="text-[10px] text-amber-600" title={`Older data: ${rowYear} (default ${defaultYear})`}>({rowYear})</span>) : null}</span>);
  const hiA = rel === 'A' ? 'bg-emerald-50/30' : rel === 'B' ? 'bg-rose-50/30' : '', hiB = rel === 'B' ? 'bg-emerald-50/30' : rel === 'A' ? 'bg-rose-50/30' : '';
  return (<tr className="border-b last:border-0"><td className="py-2 pr-2 text-xs sm:text-sm text-slate-500">{metric}</td><td className={`py-2 pr-2 font-medium whitespace-nowrap ${hiA}`}><span className="inline-flex items-center gap-1 align-middle">{fmt(aVal)}{rel === 'A' && icon('higher')}{rel === 'B' && icon('lower')}</span></td><td className={`py-2 pr-2 font-medium whitespace-nowrap ${hiB}`}><span className="inline-flex items-center gap-1 align-middle">{fmt(bVal)}{rel === 'B' && icon('higher')}{rel === 'A' && icon('lower')}</span></td><td className="py-2"><DiffCell a={aVal} b={bVal} suffix={diffSuffix} /></td></tr>);
};

const SearchBox = ({ placeholder, value, onChange }) => (<div className="relative w-full"><Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" /><Input className="pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} /></div>);

export default function App() {
  // --- Metrics catalog ---
  const METRICS = [
    { field: "population", label: "Population", code: "SP.POP.TOTL", fmt: numberFmt },
    { field: "gdp_nominal_usd", label: "GDP (nominal, USD)", code: "NY.GDP.MKTP.CD", fmt: (v) => "$" + numberFmt(v) },
    { field: "gdp_per_capita_usd", label: "GDP per capita (USD)", code: "NY.GDP.PCAP.CD", fmt: (v) => "$" + numberFmt(v) },
    { field: "life_expectancy", label: "Life expectancy (yrs)", code: "SP.DYN.LE00.IN", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1)) },
    { field: "co2_tonnes_per_capita", label: "CO₂ per capita (t)", code: "EN.ATM.CO2E.PC", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1)) },
    { field: "unemployment_rate_pct", label: "Unemployment (%)", code: "SL.UEM.TOTL.ZS", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
    { field: "inflation_cpi_pct", label: "Inflation (CPI, %)", code: "FP.CPI.TOTL.ZG", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
    { field: "area_km2", label: "Area (km²)", code: "AG.SRF.TOTL.K2", fmt: numberFmt },
    { field: "internet_users_pct", label: "Internet users (%)", code: "IT.NET.USER.ZS", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
    { field: "urban_pop_pct", label: "Urban population (%)", code: "SP.URB.TOTL.IN.ZS", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
    { field: "health_exp_gdp_pct", label: "Health expenditure (% GDP)", code: "SH.XPD.CHEX.GD.ZS", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
    { field: "exports_usd", label: "Exports (USD)", code: "NE.EXP.GNFS.CD", fmt: (v) => "$" + numberFmt(v) },
    { field: "imports_usd", label: "Imports (USD)", code: "NE.IMP.GNFS.CD", fmt: (v) => "$" + numberFmt(v) },
    { field: "renewables_pct", label: "Renewables electricity (%)", code: "EG.ELC.RNEW.ZS", fmt: (v) => (v == null ? "—" : Number(v).toFixed(1) + "%"), diffSuffix: "%" },
  ];

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

  // --- Fetch World Bank + GeoJSON ---
  const fetchLive = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const cJson = await (await fetch("https://api.worldbank.org/v2/country?format=json&per_page=400")).json();
      const countries = cJson[1] || [];
      const wbCountries = countries.filter((c) => c.region?.id !== "NA" && c.iso3Code).map((c) => ({ iso3: c.iso3Code.toUpperCase(), country: c.name }));
      const wbNameMap = new Map(wbCountries.map((c) => [c.iso3, c.country]));

      const gJson = await (await fetch(geoUrl)).json();
      const features = gJson?.features || [];
      const featureCollection = { type: "FeatureCollection", features };
      const geoCountries = features.map((f) => { const iso = getIso3(f.properties), nm = getNameProp(f.properties); return iso ? { iso3: iso, country: nm } : null; }).filter(Boolean);
      const geoNameMap = new Map(geoCountries.map((c) => [c.iso3, c.country]));
      Array.isArray(features) && features.length > 0 && setWorldFC(featureCollection);

      const fetchIndicator = async (code) => {
        const rows = (await (await fetch(`https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&MRV=10`)).json())[1]?.filter((r) => r.countryiso3code) || [];
        const latest = new Map(), series = new Map();
        for (const r of rows) {
          const iso = String(r.countryiso3code).toUpperCase();
          const vRaw = r.value, yr = parseInt(r.date, 10);
          if (vRaw == null || Number.isNaN(Number(vRaw))) continue;
          const v = typeof vRaw === 'string' ? Number(vRaw) : vRaw;
          if (!series.has(iso)) series.set(iso, {});
          const s = series.get(iso); if (s[yr] == null) s[yr] = v;
          const prev = latest.get(iso); if (!prev || yr > prev.year) latest.set(iso, { value: v, year: yr });
        }
        return { latest, series };
      };

      const bundles = await Promise.all(METRICS.map((m) => fetchIndicator(m.code)));
      const allIso = new Set([...wbNameMap.keys(), ...geoNameMap.keys()]);
      bundles.forEach((b) => b.latest.forEach((_, iso) => allIso.add(iso)));
      const nameMap = new Map(geoNameMap); wbNameMap.forEach((n, iso) => nameMap.set(iso, n));
      const out = Array.from(allIso).filter((iso) => wbNameMap.has(iso) || geoNameMap.has(iso)).map((iso) => {
        const row = { iso3: iso, country: nameMap.get(iso) || iso, __years: {} };
        METRICS.forEach((m, i) => { const L = bundles[i].latest.get(iso), S = bundles[i].series.get(iso); if (L) { row[m.field] = L.value; row.__years[m.field] = L.year; } row.__series || (row.__series = {}); if (S) row.__series[m.field] = S; });
        return row;
      });
      setLiveRows(out); const now = Date.now(); setLastRefreshed(now); try { localStorage.setItem(LAST_KEY, String(now)); } catch {}
    } catch (e) {
      setError(e?.message || "Failed to fetch live data");
    } finally { setLoading(false); }
  }, []);

  // --- Once-per-day refresh policy ---
  useEffect(() => {
    let last = null; try { const raw = localStorage.getItem(LAST_KEY); if (raw) last = Number(raw); } catch {}
    const now = Date.now();
    if (!last || !Number.isFinite(last) || now - last > DAY_MS || !liveRows.length) fetchLive(); else setLastRefreshed(last);
    const id = setInterval(fetchLive, DAY_MS);
    return () => clearInterval(id);
  }, [fetchLive]);

  const activeRows = liveRows;
  const dataByIso3 = useMemo(() => { const m = new Map(); for (const r of activeRows) r.iso3 && m.set(r.iso3.toUpperCase(), r); return m; }, [activeRows]);
  const countryList = useMemo(() => { const arr = [...dataByIso3.values()].map((r) => ({ iso3: r.iso3, country: r.country || r.iso3 })), seen = new Set(), unique = []; for (const c of arr) if (!seen.has(c.iso3)) { seen.add(c.iso3); unique.push(c); } return unique.sort((a, b) => a.country.localeCompare(b.country)); }, [dataByIso3]);
  const dataA = codeA ? dataByIso3.get(codeA.toUpperCase()) : null; const dataB = codeB ? dataByIso3.get(codeB.toUpperCase()) : null;

  const metrics = useMemo(() => { const base = METRICS.map((m) => m.field), found = new Set(base); for (const r of activeRows) for (const [k, v] of Object.entries(r)) if (!["iso3", "country", "__years"].includes(k) && typeof v === "number" && !Number.isNaN(v)) found.add(k); return Array.from(found); }, [activeRows]);
  const labelFor = (field) => METRICS.find((m) => m.field === field)?.label || field; const fmtFor = (field) => METRICS.find((m) => m.field === field)?.fmt || numberFmt; const diffSuffixFor = (field) => METRICS.find((m) => m.field === field)?.diffSuffix || "";

  const latestYearByField = useMemo(() => { const obj = {}; metrics.forEach((f) => { let max = null; for (const r of activeRows) { const y = r.__years?.[f]; if (typeof y === 'number' && (max === null || y > max)) max = y; } obj[f] = max; }); return obj; }, [activeRows, metrics]);
  const defaultYear = useMemo(() => { const years = Object.values(latestYearByField).filter((y) => typeof y === 'number'); return years.length ? Math.max(...years) : null; }, [latestYearByField]);

  const valueStats = useMemo(() => { const vals = activeRows.map((r) => r[colorMetric]).filter((v) => typeof v === "number" && !Number.isNaN(v)).sort((a, b) => a - b); if (!vals.length) return { vals: [], thresholds: [], palette: [] }; const q = (p) => { const idx = (vals.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx); if (lo === hi) return vals[lo]; const t = idx - lo; return vals[lo] * (1 - t) + vals[hi] * t; }; const thresholds = [0.2, 0.4, 0.6, 0.8].map(q); const palette = whiteBluePalette(5); return { vals, thresholds, palette }; }, [activeRows, colorMetric]);
  const linearStats = useMemo(() => { const vals = activeRows.map((r) => r[colorMetric]).filter((v) => typeof v === "number" && !Number.isNaN(v)); if (!vals.length) return { min: 0, max: 0, hasVals: false, range: 0 }; const min = Math.min(...vals), max = Math.max(...vals); return { min, max, hasVals: true, range: max - min }; }, [activeRows, colorMetric]);
  const colorFor = (v) => { if (typeof v !== "number" || Number.isNaN(v)) return whiteBlue(0); if (colorScaleMode === "quantile") { if (!valueStats.vals.length) return whiteBlue(0); const { thresholds, palette } = valueStats; let i = 0; while (i < thresholds.length && v > thresholds[i]) i++; return palette[i]; } else { if (!linearStats.hasVals || linearStats.max === linearStats.min) return whiteBlue(0); const t = (v - linearStats.min) / (linearStats.max - linearStats.min); return whiteBlue(t); } };

  const filtered = useMemo(() => countryList.filter((c) => (c.country || "").toLowerCase().includes(filter.toLowerCase())), [countryList, filter]);

  const [lastA, setLastA] = useState(0), [lastB, setLastB] = useState(0);
  const setSelection = (iso3) => { if (!iso3) return; const iso = iso3.toUpperCase(); if (iso === codeA || iso === codeB) return; const now = Date.now(); if (!codeA && !codeB) { setCodeA(iso); setLastA(now); return; } if (!codeA) { setCodeA(iso); setLastA(now); return; } if (!codeB) { setCodeB(iso); setLastB(now); return; } if (lastA <= lastB) { setCodeA(iso); setLastA(now); } else { setCodeB(iso); setLastB(now); } };
  const swap = () => { const a = codeA, b = codeB; setCodeA(b); setCodeB(a); };
  const clear = () => { setCodeA(null); setCodeB(null); };

  // --- Self-tests ---
  useEffect(() => {
    console.group("Country Comparator - self-tests");
    try {
      console.assert(numberFmt(1e3) === "1.00K");
      console.assert(numberFmt(1500) === "1.50K");
      console.assert(numberFmt(2e6) === "2.00M");
      console.assert(numberFmt(null) === "—");
      console.assert(numberFmt(1.5e12) === "1.50T");
      console.assert(pctFmt(.1) === "+10.0%" && pctFmt(-.25) === "-25.0%" && pctFmt(null) === "—");
      console.assert(pctFmt(.1999) === "+19.9%");
      console.assert(smallNumberFmt(1.239, 2) === "1.23" && smallNumberFmt(1.2, 2) === "1.2");
      console.assert(smallNumberFmt(-1.239, 2) === "-1.23");
      console.assert(typeof getNameProp({ NAME: "Test" }) === "string");
      console.assert(getIso3({ ISO_A3: "USA" }) === "USA" && getIso3({ iso_a3: "fra" }) === "FRA");
      console.assert(getIso3({ ISO_A3: "-99" }) === null);
      console.assert(whiteBlue(0) === 'hsl(210, 70%, 98%)');
      console.assert(whiteBlue(1) === 'hsl(210, 70%, 58%)');
      console.assert(whiteBlue(-1) === 'hsl(210, 70%, 98%)');
      console.assert(whiteBlue(2) === 'hsl(210, 70%, 58%)');
      console.assert(whiteBluePalette(5)[0] === whiteBlue(0) && whiteBluePalette(5)[4] === whiteBlue(1));
      console.assert(legendFmt(12.3456) === "12.34" && legendFmt(1234) === "1.23K", "legendFmt rounding");
      if (linearStats.hasVals) console.assert(typeof legendFmt(linearStats.min) === 'string' && typeof legendFmt(linearStats.max) === 'string', 'linear legend labels');
      if (valueStats.vals.length) { const th = valueStats.thresholds; console.assert(th.length === 4 && th.every((v, i, a) => i === 0 || v >= a[i - 1])); const minColorQ = colorFor(valueStats.vals[0]), maxColorQ = colorFor(valueStats.vals[valueStats.vals.length - 1]); console.assert(minColorQ !== maxColorQ); }
      if (linearStats.hasVals) { const mid = (linearStats.min + linearStats.max) / 2, cMin = colorFor(linearStats.min), cMid = colorFor(mid), cMax = colorFor(linearStats.max); console.assert(cMin !== cMax && cMin !== cMid && cMid !== cMax); }
      const grad = 'linear-gradient(to right, ' + whiteBlue(0) + ', ' + whiteBlue(1) + ')'; console.assert(typeof grad === 'string' && grad.includes('linear-gradient'));
      if (valueStats.palette.length) console.assert(valueStats.palette[0] === whiteBlue(0) && valueStats.palette.at(-1) === whiteBlue(1));
      if (mapW && mapH) console.assert(typeof computedScale === 'number' && computedScale > 0);
      if (defaultYear) Object.values(latestYearByField).forEach((y) => { if (typeof y === 'number') console.assert(defaultYear >= y); });
      console.assert(latestYearByField && typeof latestYearByField === 'object');
      if (!codeA && !codeB) { const hdrA = (dataA?.country) || "—", hdrB = (dataB?.country) || "—"; console.assert(hdrA === "—" && hdrB === "—"); }
      console.assert(relAB(5, 3) === 'A' && relAB(3, 5) === 'B' && relAB(2, 2) === 'tie' && relAB(null, 1) === 'na');
      console.assert(relAB("10", 9.999) === 'A');
      console.assert(relAB("5", "5") === 'tie');
      console.assert(typeof fmtTime(Date.now()) === 'string');
      console.assert(typeof zoom === 'number' && Array.isArray(center) && center.length === 2);
      console.assert(typeof clear === 'function' && typeof swap === 'function', 'clear/swap exist');
      console.assert(metrics.includes('population'), 'metrics include base fields');
      // daily refresh checks (non-fatal)
      console.assert(typeof localStorage !== 'undefined', 'localStorage available');
      if (lastRefreshed) console.assert(lastRefreshed <= Date.now(), 'lastRefreshed sane');
    } catch (e) { console.error("Self-tests error:", e); } finally { console.groupEnd(); }
  }, []);

  // Accessibility: keyboard select
  const onGeoKeyDown = (e, iso3, disabled) => { if (disabled) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection(iso3); } };

  // Zoom + responsive sizing
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState([0, 0]);
  const containerRef = useRef(null);
  const [mapW, setMapW] = useState(BASE_W);
  const [mapH, setMapH] = useState(BASE_H);
  const [worldFC, setWorldFC] = useState(null);
  const computedScale = useMemo(() => { try { if (worldFC && mapW && mapH) { const proj = geoEqualEarth().fitSize([mapW, mapH], worldFC); return proj.scale(); } } catch {} return 150 * (mapW / BASE_W); }, [worldFC, mapW, mapH]);
  useEffect(() => { const el = containerRef.current; if (!el) return; const update = (w) => { const width = Math.max(320, w); setMapW(width); setMapH(Math.round(width * ASPECT)); }; update(el.clientWidth || BASE_W); const ro = new ResizeObserver((entries) => { for (const entry of entries) update(entry.contentRect.width); }); ro.observe(el); return () => ro.disconnect(); }, []);

  const hasLegendVals = colorScaleMode === 'quantile' ? valueStats.vals.length >= 2 : linearStats.hasVals && linearStats.min !== linearStats.max;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Country Comparator</h1>
            <p className="text-sm text-slate-500 mt-1">Click two countries to compare. Data loads live from the World Bank (latest non-null year shown). Auto-refreshes once daily.</p>
            {error && <p className="text-xs mt-1 text-rose-600">{error}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={swap} className="gap-2"><ArrowLeftRight className="h-4 w-4" />Swap</Button>
            <Button variant="outline" onClick={clear} className="gap-2">Clear</Button>
            <span className="text-xs text-slate-500">Last updated: <span className="font-medium">{lastRefreshed ? fmtTime(lastRefreshed) : '—'}</span></span>
          </div>
        </header>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 mt-4">
          <Card className="lg:col-span-8 rounded-2xl shadow-sm">
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 text-sm text-slate-500"><Info className="h-4 w-4" /><span>Click the map to select up to two countries. Click a different country to replace the older selection, or use Clear.</span></div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Color by</span>
                  <Select value={colorMetric} onChange={setColorMetric} className="w-64">{metrics.map((m) => <SelectItem key={m} value={m}>{labelFor(m)}</SelectItem>)}</Select>
                  <span className="text-xs text-slate-500">Scale</span>
                  <Select value={colorScaleMode} onChange={setColorScaleMode} className="w-40"><SelectItem value="quantile">Quantile (quintiles)</SelectItem><SelectItem value="linear">Linear</SelectItem></Select>
                </div>
              </div>

              <div className="border rounded-2xl overflow-hidden">
                <div className="relative w-full" ref={containerRef}>
                  <div className="absolute z-10 right-2 top-2 flex flex-col gap-2">
                    <Button variant="outline" onClick={() => setZoom((z) => Math.min(z * 1.5, 8))}>+</Button>
                    <Button variant="outline" onClick={() => setZoom((z) => Math.max(z / 1.5, 1))}>-</Button>
                    <Button variant="outline" onClick={() => { setZoom(1); setCenter([0, 0]); }}>Reset</Button>
                  </div>
                  {hoverName && <div className="absolute left-3 top-3 z-10 px-3 py-1.5 rounded-lg bg-white/95 shadow-md ring-1 ring-slate-200 text-xs font-medium text-slate-700 pointer-events-none">{hoverName}</div>}
                  <ComposableMap width={mapW} height={mapH} projection="geoEqualEarth" projectionConfig={{ scale: computedScale }}>
                    <ZoomableGroup zoom={zoom} center={center} onMoveEnd={({ zoom, coordinates }) => { setZoom(zoom); setCenter(coordinates); }} minZoom={1} maxZoom={8} translateExtent={[[0, 0], [mapW, mapH]]}>
                      <Geographies geography={geoUrl}>{({ geographies }) => (
                        <>
                          {geographies.map((geo) => {
                            const iso3 = getIso3(geo.properties), disabled = !iso3;
                            const r = !disabled ? dataByIso3.get(iso3) : null;
                            const isSel = !disabled && (iso3 === codeA || iso3 === codeB);
                            const fill = disabled ? whiteBlue(.05) : isSel ? (iso3 === codeA ? "#10b981" : "#ef4444") : colorFor(r?.[colorMetric]);
                            return (
                              <Geography key={geo.rsmKey} geography={geo}
                                onMouseEnter={() => disabled ? setHoverName("") : setHoverName(getNameProp(geo.properties))}
                                onMouseLeave={() => setHoverName("")}
                                onClick={() => !disabled && setSelection(iso3)}
                                onKeyDown={(e) => onGeoKeyDown(e, iso3, disabled)} tabIndex={disabled ? -1 : 0}
                                style={{ default: { outline: "none", pointerEvents: disabled ? "none" : "auto" }, hover: { outline: "none", filter: disabled ? undefined : "brightness(0.95)" }, pressed: { outline: "none" } }}
                                fill={fill} stroke="#CBD5E1" strokeWidth={0.6}
                              />
                            );
                          })}
                        </>
                      )}</Geographies>
                    </ZoomableGroup>
                  </ComposableMap>
                </div>
              </div>

              <div className="flex items-center justify-end mt-2 text-sm text-slate-500">
                <div>Selected: <span className="font-medium">{dataA?.country || "—"}</span> vs <span className="font-medium">{dataB?.country || "—"}</span></div>
              </div>

              <div className="mt-3" title={`Legend — ${labelFor(colorMetric)}`}>
                {colorScaleMode === 'quantile' ? (
                  hasLegendVals ? (
                    <div className="flex flex-wrap items-center gap-4">
                      {valueStats.palette.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="inline-block w-6 h-3 rounded" style={{ backgroundColor: c }} />
                          <span className="text-xs text-slate-500">{i === 0 ? `≤ ${legendFmt(valueStats.thresholds[0])}` : i === valueStats.palette.length - 1 ? `> ${legendFmt(valueStats.thresholds[3])}` : `${legendFmt(valueStats.thresholds[i - 1])}-${legendFmt(valueStats.thresholds[i])}`}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Not enough data to compute quantile legend.</div>
                  )
                ) : (
                  hasLegendVals ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{legendFmt(linearStats.min)}</span>
                      <div className="h-2 w-56 rounded" style={{ background: 'linear-gradient(to right, ' + whiteBlue(0) + ', ' + whiteBlue(1) + ')' }} />
                      <span className="text-xs text-slate-500">{legendFmt(linearStats.max)}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">Not enough data to compute linear legend.</div>
                  )
                )}
                <div className="text-xs text-slate-500 mt-1">Legend — {labelFor(colorMetric)} ({colorScaleMode === 'quantile' ? 'quintiles' : 'linear'})</div>
              </div>

              <div className="space-y-2 mt-4">
                <SearchBox placeholder="Search/select a country (fills A then B, then replaces the older)" value={filter} onChange={setFilter} />
                <div className="max-h-56 overflow-auto rounded-xl border">
                  {filtered.map((c) => {
                    const sel = c.iso3 === codeA ? 'A' : c.iso3 === codeB ? 'B' : null;
                    return (
                      <button key={c.iso3} className={`w-full flex items-center justify-between text-left px-3 py-2 text-sm border-b last:border-0 hover:bg-slate-50 ${sel === 'A' ? "bg-emerald-50" : sel === 'B' ? "bg-rose-50" : ""}`} onClick={() => setSelection(c.iso3)}>
                        <span>{c.country} <span className="text-xs text-slate-500 ml-2">{c.iso3}</span></span>
                        {sel && <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${sel === 'A' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{sel}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4 rounded-2xl shadow-sm">
            <CardContent>
              <h2 className="text-lg font-semibold mb-1">Comparison</h2>
              <div className="text-xs text-slate-500 mb-3">Data from <span className="font-medium">{defaultYear ?? '—'}</span> unless otherwise specified</div>
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
                    {metrics.map((m) => (
                      <StatRow key={m} label={labelFor(m)} field={m} dataA={dataA} dataB={dataB} fmt={fmtFor(m)} diffSuffix={diffSuffixFor(m)} latestYear={latestYearByField[m]} defaultYear={defaultYear} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-xs text-slate-500 space-y-1">
                <p>Source: World Bank Open Data (most recent non-null year within the last ~10 reported years per indicator). Year badges appear next to values; amber means older than the freshest year available for that metric.</p>
                <p>Tip: Use <span className="font-medium">Swap</span> to flip A/B. <span className="font-medium">Clear</span> resets both selections.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <footer className="mt-6 text-xs text-slate-500"><p>Some indicators may be missing for certain countries or latest years due to gaps in the source dataset.</p></footer>
      </div>
    </div>
  );
}