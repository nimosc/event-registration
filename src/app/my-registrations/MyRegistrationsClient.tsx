"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { SessionUser } from "@/lib/auth";

interface Registration {
  orderId: string;
  orderName: string;
  date: string;
  location: string;
  activityHours?: string;
  orderStatus: string;
  subitemId: string;
  attendanceStatus: string;
  candidacyStatus: string;
  role: string;
  invoiceStatus: string;
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
  return `${HEBREW_MONTHS[parseInt(month, 10)]} ${year}`;
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateDDMMYY(dateStr: string): string {
  if (!dateStr) return "—";
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  return `${d}/${m}/${y.slice(-2)}`;
}

function StatusBadge({ status, type }: { status: string; type: "attendance" | "candidacy" }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        ממתין
      </span>
    );
  }

  const approvedColor = type === "attendance" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-blue-50 text-blue-700 border-blue-200";
  const approvedDot = type === "attendance" ? "bg-emerald-500" : "bg-blue-500";
  const map: Record<string, string> = {
    מאושר: approvedColor,
    נדחה: "bg-red-50 text-red-600 border-red-200",
  };
  const dotMap: Record<string, string> = {
    מאושר: approvedDot,
    נדחה: "bg-red-500",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${map[status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[status] || "bg-gray-400"}`} />
      {status}
    </span>
  );
}

export default function MyRegistrationsClient({ user }: MyRegistrationsClientProps) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [unregisteringId, setUnregisteringId] = useState<string | null>(null);

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/my-registrations");
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "שגיאה בטעינת המועמדויות");
        return;
      }
      const sorted = [...(data.registrations ?? [])].sort((a: Registration, b: Registration) =>
        (a.date || "").localeCompare(b.date || "")
      );
      setRegistrations(sorted);
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistrations();
  }, [fetchRegistrations]);

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
    const keys = new Set<string>([getCurrentMonthKey()]);
    registrations.forEach((r) => {
      const key = parseMonthKey(r.date);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort();
  }, [registrations]);

  const filtered = useMemo(() => {
    if (selectedMonth === "all") return registrations;
    return registrations.filter((r) => parseMonthKey(r.date) === selectedMonth);
  }, [registrations, selectedMonth]);

  const today = new Date().toISOString().split("T")[0];
  const canUnregister = (reg: Registration) => !reg.date || reg.date >= today;
  const filteredTotalCount = filtered.length;
  const approvedCount = filtered.filter((r) => r.candidacyStatus === "מאושר").length;
  const pendingCount = filtered.filter((r) => !r.candidacyStatus).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ההזמנות שלי</h1>
              <p className="text-sm text-gray-500 mt-1">כל ההזמנות שהגשת אליהן מועמדות והסטטוס שלהן</p>
            </div>
            <button
              onClick={fetchRegistrations}
              disabled={loading}
              className="mt-1 p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-40"
              title="רענן"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {!loading && filteredTotalCount > 0 && (
            <div className="flex gap-3 mt-5 flex-wrap">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-gray-700 font-medium">{filteredTotalCount}</span>
                <span className="text-gray-500">מועמדויות</span>
              </div>
              {approvedCount > 0 && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-700 font-medium">{approvedCount}</span>
                  <span className="text-emerald-600">מאושרות</span>
                </div>
              )}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-amber-700 font-medium">{pendingCount}</span>
                  <span className="text-amber-600">ממתינות</span>
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && (
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
              {availableMonths.map((key) => (
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

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse shadow-sm">
                <div className="h-5 bg-gray-100 rounded-lg w-1/2 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : registrations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h3 className="text-lg font-semibold text-gray-600 mb-1">אין מועמדויות עדיין</h3>
            <p className="text-sm text-gray-400 mb-5">עבור להזמנות פתוחות כדי להגיש מועמדות</p>
            <Link href="/orders" className="btn-primary">הזמנות פתוחות</Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-gray-500 mb-3">אין מועמדויות בחודש זה</p>
            <button onClick={() => setSelectedMonth("all")} className="text-sm text-blue-500 hover:underline">
              הצג את כל החודשים
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-right border-collapse">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-200">
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">מיקום</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">תאריך</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סטטוס מועמדות</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((reg) => (
                    <tr key={reg.subitemId} className="hover:bg-gray-50/70">
                      <td className="px-5 py-4 font-medium text-gray-900">
                        <div>{reg.location || reg.orderName || "—"}</div>
                        {reg.activityHours && <div className="text-xs text-gray-500 mt-1">{reg.activityHours}</div>}
                      </td>
                      <td className="px-5 py-4 text-gray-700 tabular-nums">{formatDateDDMMYY(reg.date)}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={reg.candidacyStatus} type="candidacy" />
                      </td>
                      <td className="px-5 py-4">
                        {canUnregister(reg) ? (
                          <button
                            type="button"
                            onClick={() => handleUnregister(reg)}
                            disabled={unregisteringId === reg.subitemId}
                            className="btn-danger text-xs py-2 px-3 rounded-lg"
                          >
                            {unregisteringId === reg.subitemId ? "מבטל..." : "בטל מועמדות"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">לא ניתן לבטל</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
