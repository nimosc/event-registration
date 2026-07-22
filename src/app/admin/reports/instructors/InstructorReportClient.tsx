"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import type { SessionUser } from "@/lib/auth";
import {
  buildInstructorReport,
  emptyCounts,
  filterByDateRange,
  sortRows,
  type MetricCounts,
  type RegistrationRecord,
  type ReportMetric,
  type SortDirection,
} from "@/lib/instructorReportCore";

/** ערכת צבע לכל מטריקה — משמשת גם לכרטיסים וגם לעוצמת ה-heatmap בטבלה */
const METRICS: Record<
  ReportMetric,
  { label: string; short: string; rgb: [number, number, number]; ring: string; text: string; bg: string; bar: string }
> = {
  registered: {
    label: "נרשמו להזמנה",
    short: "נרשמו",
    rgb: [59, 130, 246],
    ring: "ring-blue-500",
    text: "text-blue-700",
    bg: "bg-blue-50",
    bar: "from-blue-400 to-blue-600",
  },
  approved: {
    label: "מועמדות מאושרת",
    short: "אושרו",
    rgb: [16, 185, 129],
    ring: "ring-emerald-500",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    bar: "from-emerald-400 to-emerald-600",
  },
  attended: {
    label: "הגיעו בפועל",
    short: "הגיעו",
    rgb: [139, 92, 246],
    ring: "ring-violet-500",
    text: "text-violet-700",
    bg: "bg-violet-50",
    bar: "from-violet-400 to-violet-600",
  },
};

const METRIC_ORDER: ReportMetric[] = ["registered", "approved", "attended"];

interface ApiPayload {
  registrations: RegistrationRecord[];
  generatedAt: string;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: "הכל", days: null },
  { label: "30 יום", days: 30 },
  { label: "3 חודשים", days: 90 },
  { label: "שנה", days: 365 },
];

/* ── אייקונים ─────────────────────────────────────────────────────────── */

function Icon({ path, className = "w-4 h-4" }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const ICONS = {
  users: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
  check: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  spark: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  pin: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z",
  search: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  calendar: "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5",
  warn: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z",
  refresh: "M16.023 9.348h4.992V4.356m-4.993 4.992l3.181-3.183a8.25 8.25 0 00-13.803 3.7M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7",
  empty: "M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z",
  arrowUp: "M4.5 15.75l7.5-7.5 7.5 7.5",
  arrowDown: "M19.5 8.25l-7.5 7.5-7.5-7.5",
};

const METRIC_ICON: Record<ReportMetric, string> = {
  registered: ICONS.users,
  approved: ICONS.check,
  attended: ICONS.spark,
};

/* ── רכיב ראשי ────────────────────────────────────────────────────────── */

export default function InstructorReportClient({ user }: { user: SessionUser }) {
  const [records, setRecords] = useState<RegistrationRecord[]>([]);
  const [generatedAt, setGeneratedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [metric, setMetric] = useState<ReportMetric>("registered");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("total");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [showUnmapped, setShowUnmapped] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/reports/instructor-activity", {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "שגיאה בטעינת הדוח");
        }
        const data = (await res.json()) as ApiPayload;
        if (!cancelled) {
          setRecords(data.registrations ?? []);
          setGeneratedAt(data.generatedAt ?? "");
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "שגיאה בטעינת הדוח");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const generatedAtLabel = useMemo(() => {
    if (!generatedAt) return "";
    try {
      return new Date(generatedAt).toLocaleString("he-IL", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return "";
    }
  }, [generatedAt]);

  const undatedCount = useMemo(
    () => records.filter((r) => !r.date).length,
    [records]
  );

  const dateFiltered = useMemo(
    () => filterByDateRange(records, from, to),
    [records, from, to]
  );

  const report = useMemo(() => buildInstructorReport(dateFiltered), [dateFiltered]);

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? report.rows.filter((r) => r.name.toLowerCase().includes(q))
      : report.rows;
    return sortRows(filtered, sortKey, sortDir, metric);
  }, [report.rows, search, sortKey, sortDir, metric]);

  const visibleTotals = useMemo(() => {
    const byRegion: Record<string, MetricCounts> = {};
    const total = emptyCounts();
    for (const row of visibleRows) {
      for (const region of report.regions) {
        if (!byRegion[region]) byRegion[region] = emptyCounts();
        const c = row.byRegion[region];
        if (!c) continue;
        byRegion[region].registered += c.registered;
        byRegion[region].approved += c.approved;
        byRegion[region].attended += c.attended;
      }
      total.registered += row.totals.registered;
      total.approved += row.totals.approved;
      total.attended += row.totals.attended;
    }
    return { byRegion, total };
  }, [visibleRows, report.regions]);

  /** הערך המקסימלי בתא — בסיס לעוצמת ה-heatmap */
  const maxCell = useMemo(() => {
    let max = 0;
    for (const row of visibleRows) {
      for (const region of report.regions) {
        const v = row.byRegion[region]?.[metric] ?? 0;
        if (v > max) max = v;
      }
    }
    return max || 1;
  }, [visibleRows, report.regions, metric]);

  const maxTotal = useMemo(() => {
    let max = 0;
    for (const row of visibleRows) if (row.totals[metric] > max) max = row.totals[metric];
    return max || 1;
  }, [visibleRows, metric]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  function applyPreset(days: number | null) {
    if (days === null) {
      setFrom("");
      setTo("");
      return;
    }
    setFrom(daysAgo(days));
    setTo("");
  }

  const activePreset = useMemo(() => {
    if (!from && !to) return "הכל";
    if (to) return null;
    for (const p of DATE_PRESETS) {
      if (p.days !== null && from === daysAgo(p.days)) return p.label;
    }
    return null;
  }, [from, to]);

  const isFiltered = Boolean(from || to || search.trim());
  const theme = METRICS[metric];

  /** רקע התא לפי עוצמה יחסית */
  function cellStyle(value: number): React.CSSProperties {
    if (value <= 0) return {};
    const [r, g, b] = theme.rgb;
    const ratio = Math.min(1, value / maxCell);
    return {
      backgroundColor: `rgba(${r}, ${g}, ${b}, ${(0.07 + 0.45 * ratio).toFixed(3)})`,
      color: ratio > 0.55 ? "#0f172a" : "#334155",
      fontWeight: ratio > 0.55 ? 700 : 500,
    };
  }

  function SortButton({ label, sortId, align = "center" }: { label: string; sortId: string; align?: "center" | "right" }) {
    const active = sortKey === sortId;
    return (
      <button
        onClick={() => toggleSort(sortId)}
        className={`group inline-flex items-center gap-1 w-full ${
          align === "right" ? "justify-start" : "justify-center"
        } rounded-lg px-1.5 py-1 transition-colors hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-blue-400`}
      >
        <span className={active ? "text-slate-900 font-bold" : "text-slate-500 font-semibold"}>
          {label}
        </span>
        <span className={active ? theme.text : "text-slate-300 group-hover:text-slate-400"}>
          <Icon
            path={active && sortDir === "asc" ? ICONS.arrowUp : ICONS.arrowDown}
            className="w-3.5 h-3.5"
          />
        </span>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      <main className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        {/* כותרת */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              פעילות אומנים לפי אזורים
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              מספר הפעולות של כל אומן, מפולח לפי אזור ההזמנה
              {generatedAtLabel && (
                <span className="text-slate-400"> · עודכן {generatedAtLabel}</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors disabled:opacity-50 shadow-sm"
            >
              <Icon path={ICONS.refresh} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              רענן
            </button>
            <Link
              href="/admin"
              className="inline-flex items-center px-3 py-2 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-sm"
            >
              חזרה לניהול
            </Link>
          </div>
        </div>

        {/* כרטיסי מטריקה — משמשים גם כבורר המטריקה הפעילה */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {METRIC_ORDER.map((m) => {
            const t = METRICS[m];
            const active = metric === m;
            const value = report.grandTotals[m];
            const pct =
              report.grandTotals.registered > 0
                ? Math.round((value / report.grandTotals.registered) * 100)
                : 0;
            return (
              <button
                key={m}
                onClick={() => setMetric(m)}
                aria-pressed={active}
                className={`relative overflow-hidden text-right rounded-2xl border bg-white p-4 transition-all duration-200 focus:outline-none focus:ring-2 ${t.ring} ${
                  active
                    ? "border-transparent shadow-lg ring-2 " + t.ring
                    : "border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0 right-0 left-0 h-1 bg-gradient-to-l ${t.bar} ${
                    active ? "opacity-100" : "opacity-25"
                  }`}
                />
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`inline-flex items-center justify-center w-9 h-9 rounded-xl ${t.bg} ${t.text}`}
                  >
                    <Icon path={METRIC_ICON[m]} className="w-5 h-5" />
                  </span>
                  {m !== "registered" && (
                    <span className="text-xs font-semibold text-slate-400">{pct}%</span>
                  )}
                </div>
                <div className="text-3xl font-bold text-slate-900 tabular-nums leading-none">
                  {loading ? "—" : value.toLocaleString("he-IL")}
                </div>
                <div className="text-xs text-slate-500 mt-1.5 font-medium">{t.label}</div>
              </button>
            );
          })}
        </div>

        {/* פילטרים */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 mb-5">
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="relative">
              <span className="absolute inset-y-0 right-3 flex items-center text-slate-400 pointer-events-none">
                <Icon path={ICONS.search} className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="חיפוש אומן…"
                aria-label="חיפוש אומן"
                className="w-full border border-slate-200 rounded-xl pr-9 pl-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
            <div className="relative">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                dir="ltr"
                aria-label="מתאריך"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <span className="absolute -top-2 right-3 px-1 bg-white text-[10px] font-semibold text-slate-400">
                מתאריך
              </span>
            </div>
            <div className="relative">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                dir="ltr"
                aria-label="עד תאריך"
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
              <span className="absolute -top-2 right-3 px-1 bg-white text-[10px] font-semibold text-slate-400">
                עד תאריך
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <Icon path={ICONS.calendar} className="w-4 h-4 text-slate-400" />
            {DATE_PRESETS.map((p) => {
              const active = activePreset === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.days)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                    active
                      ? "bg-gradient-to-l from-blue-500 to-indigo-500 text-white shadow-md shadow-blue-500/25"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
            {isFiltered && (
              <button
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setSearch("");
                }}
                className="px-3 py-1.5 rounded-full text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 transition-colors"
              >
                נקה סינון ✕
              </button>
            )}
            <span className="text-xs text-slate-500 mr-auto font-medium tabular-nums">
              {visibleRows.length} אומנים · {visibleTotals.total[metric].toLocaleString("he-IL")}{" "}
              {theme.short}
            </span>
          </div>

          {(from || to) && undatedCount > 0 && (
            <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5">
              <Icon path={ICONS.warn} className="w-3.5 h-3.5" />
              {undatedCount} הרשמות ללא תאריך אירוע אינן נכללות בסינון
            </p>
          )}
        </div>

        {/* מצב טעינה — שלד */}
        {loading && (
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-8 bg-slate-100 rounded-lg" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 bg-slate-50 rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-rose-100 text-rose-600 mb-3">
              <Icon path={ICONS.warn} className="w-6 h-6" />
            </div>
            <p className="text-rose-800 font-semibold">{error}</p>
            <button onClick={() => setReloadKey((k) => k + 1)} className="btn-secondary text-sm mt-4">
              נסה שוב
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* אזהרת מקומות לא ממופים — מקופלת כברירת מחדל */}
            {report.unmappedVenues.length > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 mb-5 overflow-hidden">
                <button
                  onClick={() => setShowUnmapped((v) => !v)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-right hover:bg-amber-100/60 transition-colors"
                >
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex-shrink-0">
                    <Icon path={ICONS.warn} className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-amber-900">
                      {report.unmappedVenues.length} מקומות לא שויכו לאזור
                    </span>
                    <span className="block text-xs text-amber-700">
                      להזמנות אין עמודת אזור — האזור נגזר משם המקום
                    </span>
                  </span>
                  <span className="text-amber-600 flex-shrink-0">
                    <Icon path={showUnmapped ? ICONS.arrowUp : ICONS.arrowDown} className="w-4 h-4" />
                  </span>
                </button>
                {showUnmapped && (
                  <div className="px-4 pb-3 pt-1 border-t border-amber-200/70">
                    <ul className="flex flex-wrap gap-2">
                      {report.unmappedVenues.map((u) => (
                        <li
                          key={u.venue}
                          className="inline-flex items-center gap-1.5 rounded-full bg-white border border-amber-200 px-3 py-1 text-xs text-amber-900"
                        >
                          <Icon path={ICONS.pin} className="w-3 h-3 text-amber-500" />
                          {u.venue}
                          <span className="font-bold tabular-nums">{u.registrations}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {visibleRows.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-12 text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 mb-3">
                  <Icon path={ICONS.empty} className="w-7 h-7" />
                </div>
                <p className="text-slate-700 font-semibold">אין נתונים להצגה</p>
                <p className="text-sm text-slate-500 mt-1">
                  נסה להרחיב את טווח התאריכים או לנקות את החיפוש
                </p>
                {isFiltered && (
                  <button
                    onClick={() => {
                      setFrom("");
                      setTo("");
                      setSearch("");
                    }}
                    className="btn-secondary text-sm mt-4"
                  >
                    נקה סינון
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* גובה מוגבל + גלילה פנימית — כך שכותרת הטבלה ושורת הסיכום
                    נשארות נעוצות. sticky לא עובד ביחס לעמוד כשהוא בתוך
                    מיכל עם overflow. */}
                <div className="overflow-auto max-h-[calc(100vh-16rem)] min-h-[18rem]">
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-slate-50/95 backdrop-blur border-b border-slate-200">
                        <th
                          scope="col"
                          aria-sort={sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                          className="text-right px-3 py-2.5 sticky right-0 bg-slate-50/95 backdrop-blur z-30 min-w-[190px]"
                        >
                          <SortButton label="אומן" sortId="name" align="right" />
                        </th>
                        {report.regions.map((r) => (
                          <th
                            key={r}
                            scope="col"
                            aria-sort={sortKey === r ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                            className="px-2 py-2.5 whitespace-nowrap min-w-[110px]"
                          >
                            <SortButton label={r} sortId={r} />
                          </th>
                        ))}
                        <th
                          scope="col"
                          aria-sort={sortKey === "total" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                          className="px-2 py-2.5 whitespace-nowrap bg-slate-100/80 min-w-[130px]"
                        >
                          <SortButton label="סה״כ" sortId="total" />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, idx) => (
                        <tr
                          key={row.artistKey}
                          className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 transition-colors group"
                        >
                          <td className="px-3 py-2 sticky right-0 bg-white group-hover:bg-slate-50/70 z-10 transition-colors">
                            <div className="flex items-center gap-2.5">
                              <span className="text-[11px] text-slate-300 font-semibold tabular-nums w-5 text-left flex-shrink-0">
                                {idx + 1}
                              </span>
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${theme.bg} ${theme.text} text-xs font-bold flex-shrink-0`}
                              >
                                {row.name.trim().charAt(0)}
                              </span>
                              <span className="font-medium text-slate-800 truncate">
                                {row.name}
                              </span>
                            </div>
                          </td>
                          {report.regions.map((r) => {
                            const v = row.byRegion[r]?.[metric] ?? 0;
                            return (
                              <td key={r} className="px-2 py-2 text-center">
                                <span
                                  className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-lg text-sm tabular-nums transition-colors"
                                  style={cellStyle(v)}
                                >
                                  {v > 0 ? v : <span className="text-slate-200">–</span>}
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-2 py-2 bg-slate-50/60">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 tabular-nums w-7 text-center flex-shrink-0">
                                {row.totals[metric]}
                              </span>
                              <span className="flex-1 h-1.5 rounded-full bg-slate-200/70 overflow-hidden min-w-[36px]">
                                <span
                                  className={`block h-full rounded-full bg-gradient-to-l ${theme.bar}`}
                                  style={{
                                    width: `${Math.max(3, (row.totals[metric] / maxTotal) * 100)}%`,
                                  }}
                                />
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20">
                      <tr className="bg-slate-100/95 backdrop-blur border-t-2 border-slate-200 font-bold text-slate-900">
                        <td className="px-3 py-2.5 sticky right-0 bg-slate-100 z-30 text-sm">
                          סה״כ · {visibleRows.length} אומנים
                        </td>
                        {report.regions.map((r) => (
                          <td key={r} className="px-2 py-2.5 text-center tabular-nums">
                            {visibleTotals.byRegion[r]?.[metric] ?? 0}
                          </td>
                        ))}
                        <td className="px-2 py-2.5 text-center tabular-nums bg-slate-200/70">
                          {visibleTotals.total[metric].toLocaleString("he-IL")}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            <p className="text-xs text-slate-400 mt-3 text-center">
              עוצמת הצבע בתא מייצגת את גודל המספר יחסית למקסימום בטבלה · לחיצה על
              כותרת עמודה ממיינת לפיה
            </p>
          </>
        )}
      </main>
    </div>
  );
}
