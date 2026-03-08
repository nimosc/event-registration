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

function getNextMonthKey(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
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

function RegistrationCard({ reg }: { reg: Registration }) {
  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-shadow hover:shadow-md ${
      reg.attendanceStatus === "מאושר" ? "border-emerald-200" :
      reg.attendanceStatus === "נדחה" ? "border-red-200" : "border-gray-100"
    }`}>
      <div className={`h-1 ${
        reg.attendanceStatus === "מאושר" ? "bg-emerald-400" :
        reg.attendanceStatus === "נדחה" ? "bg-red-400" : "bg-blue-300"
      }`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 text-base leading-snug truncate">{reg.orderName}</h3>
            {reg.role && (
              <span className="inline-block mt-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{reg.role}</span>
            )}
          </div>
          <AttendanceBadge status={reg.attendanceStatus} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {reg.date && (
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(reg.date)}
            </div>
          )}
          {reg.location && (
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {reg.location}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyRegistrationsClient({ user }: MyRegistrationsClientProps) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("upcoming");

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
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  const availableMonths = useMemo(() => {
    const curKey = getCurrentMonthKey();
    const keys = new Set<string>();
    registrations.forEach(r => { const k = parseMonthKey(r.date); if (k && k >= curKey) keys.add(k); });
    return Array.from(keys).sort();
  }, [registrations]);

  const filtered = useMemo(() => {
    if (selectedMonth === "all") return registrations;
    if (selectedMonth === "upcoming") {
      const cur = getCurrentMonthKey();
      const next = getNextMonthKey();
      return registrations.filter(r => {
        const k = parseMonthKey(r.date);
        return k === cur || k === next;
      });
    }
    return registrations.filter(r => parseMonthKey(r.date) === selectedMonth);
  }, [registrations, selectedMonth]);

  const confirmedCount = registrations.filter(r => r.attendanceStatus === "מאושר").length;
  const pendingCount = registrations.filter(r => !r.attendanceStatus).length;

  const today = new Date().toISOString().split("T")[0];
  const upcomingRegs = filtered.filter(r => !r.date || r.date >= today);
  const pastRegs = filtered.filter(r => r.date && r.date < today);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ההזמנות שלי</h1>
              <p className="text-sm text-gray-500 mt-1">כל ההזמנות שנרשמת אליהן</p>
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
                <span className="text-gray-500">רישומים</span>
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
        {!loading && availableMonths.length > 0 && (
          <div className="mb-6 -mx-1">
            <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-hide">
              <button
                onClick={() => setSelectedMonth("upcoming")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedMonth === "upcoming"
                    ? "bg-gray-900 text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                החודש + הבא
              </button>
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
            <h3 className="text-lg font-semibold text-gray-600 mb-1">אין רישומים עדיין</h3>
            <p className="text-sm text-gray-400 mb-5">עבור להזמנות פתוחות כדי להירשם לאירועים</p>
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
            <p className="text-gray-500 mb-3">אין רישומים בתקופה זו</p>
            <button onClick={() => setSelectedMonth("all")} className="text-sm text-blue-500 hover:underline">
              הצג את כל החודשים
            </button>
          </div>
        ) : (
          <div className="space-y-8">

            {/* Upcoming */}
            {upcomingRegs.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">קרובות</h2>
                  <span className="text-xs bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full">{upcomingRegs.length}</span>
                </div>
                <div className="space-y-3">
                  {upcomingRegs.map(reg => (
                    <RegistrationCard key={reg.subitemId} reg={reg} />
                  ))}
                </div>
              </section>
            )}

            {/* Past */}
            {pastRegs.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-gray-300 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">עברו</h2>
                  <span className="text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{pastRegs.length}</span>
                </div>
                <div className="space-y-3 opacity-60">
                  {pastRegs.map(reg => (
                    <RegistrationCard key={reg.subitemId} reg={reg} />
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </main>
    </div>
  );
}
