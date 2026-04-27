"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import NavBar from "@/components/NavBar";
import { SessionUser } from "@/lib/auth";
import Link from "next/link";

interface Registration {
  orderId: string;
  orderName: string;
  date: string;
  location: string;
  activityHours?: string;
  orderStatus: string;
  subitemId: string;
  attendanceStatus: string;
  role: string;
}

interface MyRegistrationsClientProps {
  user: SessionUser;
}

const HEBREW_MONTHS: Record<number, string> = {
  1: "ינואר", 2: "פברואר", 3: "מרץ", 4: "אפריל",
  5: "מאי", 6: "יוני", 7: "יולי", 8: "אוגוסט",
  9: "ספטמבר", 10: "אוקטובר", 11: "נובמבר", 12: "דצמבר",
};

function parseMonthKey(dateStr: string): string {
  const match = dateStr?.match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function monthKeyToLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${HEBREW_MONTHS[parseInt(month)]} ${year}`;
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function AttendanceBadge({ status }: { status: string }) {
  if (!status) return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      ממתין לאישור
    </span>
  );
  const map: Record<string, string> = {
    "מאושר": "bg-emerald-50 text-emerald-700 border-emerald-200",
    "נדחה": "bg-red-50 text-red-600 border-red-200",
  };
  const dotMap: Record<string, string> = {
    "מאושר": "bg-emerald-500",
    "נדחה": "bg-red-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${map[status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[status] || "bg-gray-400"}`} />
      {status}
    </span>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${parseInt(day)} ב${HEBREW_MONTHS[parseInt(month)]} ${year}`;
}

/** DD/MM/YY for table */
function formatDateDDMMYY(dateStr: string): string {
  if (!dateStr) return "—";
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  const yy = y!.slice(-2);
  return `${d}/${m}/${yy}`;
}

export default function MyRegistrationsClient({ user }: MyRegistrationsClientProps) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [invoiceFor, setInvoiceFor] = useState<Registration | null>(null);
  const [showMonthInvoiceModal, setShowMonthInvoiceModal] = useState(false);
  const [unregisteringId, setUnregisteringId] = useState<string | null>(null);

  const [artistStatus, setArtistStatus] = useState<"מורשה" | "פטור" | "">("");

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/my-registrations");
      const data = await res.json();
      if (!res.ok) { setError(data.error || "שגיאה"); return; }
      const sorted = [...(data.registrations ?? [])].sort((a: Registration, b: Registration) =>
        (a.date || "").localeCompare(b.date || "")
      );
      setRegistrations(sorted);
      setArtistStatus(data.artistStatus ?? "");
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  const handleUnregister = useCallback(async (reg: Registration) => {
    if (!confirm(`לבטל את המועמדות להזמנה "${reg.orderName}"?`)) return;
    setUnregisteringId(reg.subitemId);
    setError(null);
    try {
      const res = await fetch("/api/register", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: reg.orderId, subitemId: reg.subitemId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בביטול המועמדות");
        return;
      }
      await fetchRegistrations();
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setUnregisteringId(null);
    }
  }, [fetchRegistrations]);

  const availableMonths = useMemo(() => {
    const curKey = getCurrentMonthKey();
    const keys = new Set<string>([curKey]);
    registrations.forEach(r => { const k = parseMonthKey(r.date); if (k) keys.add(k); });
    return Array.from(keys).sort();
  }, [registrations]);

  const filtered = useMemo(() => {
    if (selectedMonth === "all") return registrations;
    return registrations.filter(r => parseMonthKey(r.date) === selectedMonth);
  }, [registrations, selectedMonth]);

  const confirmedCount = registrations.filter(r => r.attendanceStatus === "מאושר").length;
  const pendingCount = registrations.filter(r => !r.attendanceStatus).length;

  const today = new Date().toISOString().split("T")[0];
  const canUnregister = (reg: Registration) => !reg.date || reg.date >= today;

  const FIRST_EVENT_PAY_PATUR = 1000;
  const ADDITIONAL_EVENT_PAY_PATUR = 800;
  const PAY_MORESH = 1000;

  const { incomeBySubitemId, totalIncomeForFiltered } = useMemo(() => {
    const byId: Record<string, number> = {};
    const byMonth = new Map<string, Registration[]>();
    for (const reg of filtered) {
      const k = parseMonthKey(reg.date) || "none";
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k)!.push(reg);
    }
    let total = 0;
    for (const regs of byMonth.values()) {
      const sorted = [...regs].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      for (let i = 0; i < sorted.length; i++) {
        const amount =
          artistStatus === "פטור"
            ? i === 0
              ? FIRST_EVENT_PAY_PATUR
              : ADDITIONAL_EVENT_PAY_PATUR
            : PAY_MORESH;
        byId[sorted[i].subitemId] = amount;
        total += amount;
      }
    }
    return { incomeBySubitemId: byId, totalIncomeForFiltered: total };
  }, [filtered, artistStatus]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">המועמדויות שלי</h1>
              <p className="text-sm text-gray-500 mt-1">כל ההזמנות שהגשת אליהן מועמדות</p>
            </div>
            <button
              onClick={fetchRegistrations}
              disabled={loading}
              title="רענן"
              className="mt-1 p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-40"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Stats */}
          {!loading && registrations.length > 0 && (
            <div className="flex gap-3 mt-5 flex-wrap">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-gray-700 font-medium">{registrations.length}</span>
                <span className="text-gray-500">מועמדויות</span>
              </div>
              {confirmedCount > 0 && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-700 font-medium">{confirmedCount}</span>
                  <span className="text-emerald-600">מאושרים</span>
                </div>
              )}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-amber-700 font-medium">{pendingCount}</span>
                  <span className="text-amber-600">ממתינים</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Month Filter */}
        {!loading && (availableMonths.length > 0 || selectedMonth) && (
          <div className="mb-6 -mx-1">
            <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-hide">
              <button
                onClick={() => setSelectedMonth("all")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedMonth === "all"
                    ? "bg-gray-900 text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                כל החודשים
              </button>
              {availableMonths.map(key => (
                <button
                  key={key}
                  onClick={() => setSelectedMonth(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedMonth === key
                      ? "bg-gray-900 text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  {monthKeyToLabel(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 flex items-center gap-3 text-sm">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse shadow-sm">
                <div className="flex justify-between items-start mb-3">
                  <div className="h-5 bg-gray-100 rounded-lg w-1/2" />
                  <div className="h-6 bg-gray-100 rounded-full w-24" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-gray-100 rounded w-1/3" />
                  <div className="h-4 bg-gray-100 rounded w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : registrations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-5">
              <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-600 mb-1">אין מועמדויות עדיין</h3>
            <p className="text-sm text-gray-400 mb-5">עבור להזמנות פתוחות כדי להגיש מועמדות</p>
            <Link
              href="/orders"
              className="inline-flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              הזמנות פתוחות
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-gray-500 mb-3">
              {selectedMonth === "all" ? "אין מועמדויות" : "אין מועמדויות בחודש זה"}
            </p>
            {selectedMonth !== "all" && (
              <button onClick={() => setSelectedMonth("all")} className="text-sm text-blue-500 hover:underline">
                הצג את כל החודשים
              </button>
            )}
          </div>
        ) : (
          <>
          {filtered.length > 0 && selectedMonth !== "all" && (
            <div className="mb-4 space-y-2">
              <div className="flex justify-end">
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="בקרוב יהיה ניתן להעלות את החשבוניות כאן - כרגע בפיתוח"
                className="btn-primary inline-flex items-center gap-2 opacity-60 cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                העלה חשבוניות לחודש
              </button>
            </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                בקרוב יהיה ניתן להעלות את החשבוניות כאן - כרגע בפיתוח
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm shadow-gray-200/50">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-200">
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">מיקום</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">תאריך</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">נוכחות</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">הכנסה</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600 uppercase tracking-wider pr-5">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map(reg => (
                    <tr key={reg.subitemId} className="bg-white hover:bg-gray-50/70 transition-colors">
                      <td className="px-5 py-4 font-medium text-gray-900">
                        <div className="space-y-1">
                          <div>{reg.location || reg.orderName || "—"}</div>
                          {reg.activityHours ? (
                            <div className="text-xs font-normal text-gray-500 flex items-start gap-1.5">
                              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{reg.activityHours}</span>
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-block px-3 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-sm font-medium text-gray-800 tabular-nums">
                          {formatDateDDMMYY(reg.date)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <AttendanceBadge status={reg.attendanceStatus} />
                      </td>
                      <td className="px-5 py-4 text-sm font-semibold text-gray-800 tabular-nums whitespace-nowrap">
                        {incomeBySubitemId[reg.subitemId] != null
                          ? `${incomeBySubitemId[reg.subitemId].toLocaleString("he-IL")} ₪`
                          : "—"}
                      </td>
                      <td className="px-5 py-4 pr-5 whitespace-nowrap">
                        <div className="flex flex-wrap gap-2 justify-end">
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            title="בקרוב יהיה ניתן להעלות את החשבוניות כאן - כרגע בפיתוח"
                            className="btn-secondary text-xs py-2 px-3 rounded-lg opacity-60 cursor-not-allowed"
                          >
                            חשבונית
                          </button>
                          {canUnregister(reg) && (
                            <button
                              type="button"
                              onClick={() => handleUnregister(reg)}
                              disabled={unregisteringId === reg.subitemId}
                              className="btn-danger text-xs py-2 px-3 rounded-lg"
                            >
                              {unregisteringId === reg.subitemId ? "..." : "בטל מועמדות"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <div className="border-t-2 border-gray-200 bg-gray-100 px-5 py-4 text-left">
                <span className="text-base font-bold text-gray-800">
                  סך הכל {selectedMonth === "all" ? "" : "לחודש"}:{" "}
                  <span className="text-gray-900 tabular-nums">{totalIncomeForFiltered.toLocaleString("he-IL")} ₪</span>
                </span>
              </div>
            )}
          </div>
          </>
        )}

        {/* Month invoices modal */}
        {showMonthInvoiceModal && filtered.length > 0 && selectedMonth !== "all" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMonthInvoiceModal(false)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden border border-gray-200 flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">העלאת חשבוניות לחודש</h3>
                <p className="text-sm text-gray-500 mt-1">{monthKeyToLabel(selectedMonth)} — {filtered.length} אירועים</p>
              </div>
              <div className="p-6 overflow-y-auto flex-1">
                <ul className="mb-4 space-y-2 text-sm text-gray-600">
                  {filtered.map(reg => (
                    <li key={reg.subitemId} className="flex justify-between gap-2">
                      <span>{reg.location || reg.orderName || "—"}</span>
                      <span className="tabular-nums text-gray-500">{formatDateDDMMYY(reg.date)}</span>
                    </li>
                  ))}
                </ul>
                <form onSubmit={e => { e.preventDefault(); setShowMonthInvoiceModal(false); }} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">קישור או קבצים (לא פעיל)</label>
                    <input type="text" className="input-field" placeholder="קישור / העלאה לכל החשבוניות של החודש" readOnly />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setShowMonthInvoiceModal(false)} className="btn-secondary">
                      ביטול
                    </button>
                    <button type="submit" className="btn-primary">
                      שמירה (לא פעיל)
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Invoice placeholder modal */}
        {invoiceFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setInvoiceFor(null)}>
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-200" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 mb-1">העלאת חשבונית</h3>
              <p className="text-sm text-gray-500 mb-4">{invoiceFor.orderName}</p>
              <form onSubmit={e => { e.preventDefault(); setInvoiceFor(null); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">קישור או הערה</label>
                  <input type="text" className="input-field" placeholder="קישור לקובץ / הערה" readOnly />
                </div>
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setInvoiceFor(null)} className="btn-secondary">
                    ביטול
                  </button>
                  <button type="submit" className="btn-primary">
                    שמירה (לא פעיל)
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
