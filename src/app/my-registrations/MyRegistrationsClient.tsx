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
  invoiceStatus: string;
}

interface InvoiceDto {
  id: string;
  name: string;
  status: string;
  date: string;
  amount: number;       // expected (system)
  actualAmount: number; // from file (AI)
  invoiceNumber: string;
  bankDetails: string;
  amountNote: string;
  description: string;
  orderIds: string[];
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
  const [artistBankDetails, setArtistBankDetails] = useState("");
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [invoicesByOrderId, setInvoicesByOrderId] = useState<Map<string, InvoiceDto>>(new Map());
  const [invoiceForm, setInvoiceForm] = useState({ bankDetails: "", invoiceNumber: "", description: "" });
  const [extractedActualAmount, setExtractedActualAmount] = useState<number | null>(null);
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [invoiceSuccess, setInvoiceSuccess] = useState<string | null>(null);
  const [monthSelectedOrderIds, setMonthSelectedOrderIds] = useState<Set<string>>(new Set());
  const [singleInvoiceClaim, setSingleInvoiceClaim] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [showInvoicesSection, setShowInvoicesSection] = useState(false);
  const [extractingFile, setExtractingFile] = useState(false);
  const [customAmountEnabled, setCustomAmountEnabled] = useState(false);
  const [customAmountValue, setCustomAmountValue] = useState("");
  const [customAmountNote, setCustomAmountNote] = useState("");

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [regRes, invRes] = await Promise.all([
        fetch("/api/my-registrations"),
        fetch("/api/invoices"),
      ]);
      const regData = await regRes.json();
      if (!regRes.ok) { setError(regData.error || "שגיאה"); return; }
      const sorted = [...(regData.registrations ?? [])].sort((a: Registration, b: Registration) =>
        (a.date || "").localeCompare(b.date || "")
      );
      setRegistrations(sorted);
      setArtistStatus(regData.artistStatus ?? "");
      if (regData.bankDetails) setArtistBankDetails(regData.bankDetails);

      if (invRes.ok) {
        const invData = await invRes.json();
        const invList = (invData.invoices ?? []) as InvoiceDto[];
        setInvoices(invList);
        const map = new Map<string, InvoiceDto>();
        for (const inv of invList) {
          for (const oid of inv.orderIds) map.set(oid, inv);
        }
        setInvoicesByOrderId(map);
      }
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

  const handleSubmitInvoice = useCallback(async (
    orderIds: string[],
    subitemIds: string[],
    amount: number,
    eventDate: string,
    monthLabel: string,
  ) => {
    setSubmittingInvoice(true);
    setError(null);
    try {
      // actualAmount = what's on the physical invoice (AI extracted or user override)
      const actualAmountToSend = customAmountEnabled && customAmountValue !== "" && !isNaN(Number(customAmountValue))
        ? Number(customAmountValue)
        : extractedActualAmount;

      const fd = new FormData();
      fd.append("orderIds", JSON.stringify(orderIds));
      fd.append("subitemIds", JSON.stringify(subitemIds));
      fd.append("amount", String(amount)); // system-calculated (1000/800) → numbernt648wfm
      if (actualAmountToSend != null) fd.append("actualAmount", String(actualAmountToSend)); // invoice actual → numeric_mm3ph0nj
      fd.append("eventDate", eventDate);
      fd.append("monthLabel", monthLabel);
      fd.append("bankDetails", invoiceForm.bankDetails);
      fd.append("invoiceNumber", invoiceForm.invoiceNumber);
      fd.append("amountNote", customAmountNote);
      fd.append("description", invoiceForm.description);
      if (invoiceFile) fd.append("file", invoiceFile, invoiceFile.name);

      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "שגיאה בהגשת חשבונית"); return; }
      setInvoiceFor(null);
      setShowMonthInvoiceModal(false);
      setInvoiceForm({ bankDetails: "", invoiceNumber: "", description: "" });
      setExtractedActualAmount(null);
      setInvoiceFile(null);
      setCustomAmountEnabled(false);
      setCustomAmountValue("");
      setCustomAmountNote("");
      setExtractedActualAmount(null);
      setInvoiceSuccess(`החשבונית הוגשה בהצלחה — ${amount.toLocaleString("he-IL")} ₪`);
      if (invoiceForm.bankDetails) setArtistBankDetails(invoiceForm.bankDetails);
      setTimeout(() => setInvoiceSuccess(null), 5000);
      await fetchRegistrations();
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setSubmittingInvoice(false);
    }
  }, [invoiceForm, invoiceFile, fetchRegistrations]);

  const handleFileChange = useCallback(async (file: File | null) => {
    setInvoiceFile(file);
    if (!file) return;
    setExtractingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/invoices/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בחילוץ נתוני החשבונית");
        return;
      }
      setInvoiceForm(f => ({
        ...f,
        invoiceNumber: data.receiptNumber || f.invoiceNumber,
        description: data.description || f.description,
      }));
      if (data.amount != null) {
        setExtractedActualAmount(data.amount);
        setCustomAmountEnabled(true);
        setCustomAmountValue(String(data.amount));
      }
    } catch {
      setError("שגיאת רשת בחילוץ נתוני החשבונית");
    } finally {
      setExtractingFile(false);
    }
  }, []);

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

        {/* Success toast */}
        {invoiceSuccess && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-700 flex items-center gap-3 text-sm font-medium shadow-sm">
            <svg className="w-5 h-5 flex-shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {invoiceSuccess}
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
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const approved = new Set(
                    filtered
                      .filter(r => r.attendanceStatus === "מאושר" && r.invoiceStatus !== "הוגשה")
                      .map(r => r.orderId)
                  );
                  setMonthSelectedOrderIds(approved);
                  setShowMonthInvoiceModal(true);
                  setInvoiceForm({ bankDetails: artistBankDetails, invoiceNumber: "", description: "" });
                  setInvoiceFile(null);
                  setCustomAmountEnabled(false);
                  setCustomAmountValue("");
                  setCustomAmountNote("");
                  setExtractedActualAmount(null);
                }}
                className="btn-primary inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                העלה חשבוניות לחודש
              </button>
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
                          {reg.invoiceStatus === "הוגשה" ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              חשבונית הוגשה
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => { setInvoiceFor(reg); setInvoiceForm({ bankDetails: artistBankDetails, invoiceNumber: "", description: "" }); setSingleInvoiceClaim(false); setInvoiceFile(null); setCustomAmountEnabled(false); setCustomAmountValue(""); setCustomAmountNote(""); }}
                              className="btn-secondary text-xs py-2 px-3 rounded-lg"
                            >
                              חשבונית
                            </button>
                          )}
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

          {/* Invoices section */}
          {invoices.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowInvoicesSection(v => !v)}
                className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className={`w-4 h-4 transition-transform ${showInvoicesSection ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                החשבוניות שלי ({invoices.length})
              </button>
              {showInvoicesSection && (
                <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <table className="w-full text-right text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600">חשבונית</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600">תאריך</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600">סכום</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600">סטטוס</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {invoices.map(inv => {
                        const statusColor: Record<string, string> = {
                          "שולם": "bg-emerald-50 text-emerald-700 border-emerald-200",
                          "הועבר לתשלום": "bg-blue-50 text-blue-700 border-blue-200",
                          "בבדיקה": "bg-amber-50 text-amber-700 border-amber-200",
                        };
                        return (
                          <tr key={inv.id} className="hover:bg-gray-50/70">
                            <td className="px-4 py-3 font-medium text-gray-800">{inv.name}</td>
                            <td className="px-4 py-3 text-gray-500 tabular-nums">{formatDateDDMMYY(inv.date)}</td>
                            <td className="px-4 py-3 font-semibold text-gray-800 tabular-nums">{inv.amount.toLocaleString("he-IL")} ₪</td>
                            <td className="px-4 py-3">
                              {inv.status ? (
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor[inv.status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
                                  {inv.status}
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-gray-50 text-gray-500 border-gray-200">ממתין</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          </>
        )}

        {/* Month invoices modal */}
        {showMonthInvoiceModal && filtered.length > 0 && selectedMonth !== "all" && (() => {
          // Recalculate income based only on selected events, sorted by date
          const selectedRegs = filtered
            .filter(r => monthSelectedOrderIds.has(r.orderId))
            .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
          const selectedIncomeBySubitemId: Record<string, number> = {};
          let monthTotal = 0;
          for (let i = 0; i < selectedRegs.length; i++) {
            const reg = selectedRegs[i];
            const amount = artistStatus === "פטור"
              ? i === 0 ? FIRST_EVENT_PAY_PATUR : ADDITIONAL_EVENT_PAY_PATUR
              : PAY_MORESH;
            selectedIncomeBySubitemId[reg.subitemId] = amount;
            monthTotal += amount;
          }
          const selectedOrderIds = Array.from(monthSelectedOrderIds);
          const selectedSubitemIds = selectedRegs.map(r => r.subitemId);
          const firstDate = selectedRegs[0]?.date || filtered[0]?.date || "";
          const effectiveAmount = customAmountEnabled && customAmountValue !== "" && !isNaN(Number(customAmountValue))
            ? Number(customAmountValue)
            : monthTotal;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMonthInvoiceModal(false)}>
              <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden border border-gray-200 flex flex-col" onClick={e => e.stopPropagation()}>
                {submittingInvoice && (
                  <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center gap-3 rounded-2xl">
                    <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    <span className="text-sm font-medium text-gray-600">מגיש חשבונית...</span>
                  </div>
                )}
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">הגשת חשבונית לחודש</h3>
                  <p className="text-sm text-gray-500 mt-1">{monthKeyToLabel(selectedMonth)} — {filtered.length} אירועים</p>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <ul className="mb-5 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden text-sm">
                    {filtered.map(reg => {
                      const approved = reg.attendanceStatus === "מאושר";
                      const alreadyInvoiced = reg.invoiceStatus === "הוגשה";
                      const selected = monthSelectedOrderIds.has(reg.orderId);
                      const amount = selectedIncomeBySubitemId[reg.subitemId] ?? 0;
                      return (
                        <li key={reg.subitemId} className={`flex items-center gap-3 px-4 py-3 ${alreadyInvoiced ? "bg-green-50" : selected ? "bg-white" : "bg-gray-50"}`}>
                          <input
                            type="checkbox"
                            id={`month-order-${reg.orderId}`}
                            checked={alreadyInvoiced || selected}
                            disabled={alreadyInvoiced}
                            onChange={e => {
                              if (alreadyInvoiced) return;
                              setMonthSelectedOrderIds(prev => {
                                const next = new Set(prev);
                                e.target.checked ? next.add(reg.orderId) : next.delete(reg.orderId);
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                          />
                          <label htmlFor={`month-order-${reg.orderId}`} className={`flex-1 flex justify-between items-center gap-2 ${alreadyInvoiced ? "cursor-default" : "cursor-pointer"}`}>
                            <span className="flex items-center gap-2">
                              <span className={alreadyInvoiced ? "text-green-700 font-medium" : "text-gray-800"}>{reg.location || reg.orderName || "—"}</span>
                              {alreadyInvoiced && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">הוגשה</span>}
                              {!alreadyInvoiced && !approved && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">טוען שנכחתי</span>
                              )}
                            </span>
                            <span className="tabular-nums text-gray-500 flex gap-3 flex-shrink-0">
                              <span>{formatDateDDMMYY(reg.date)}</span>
                              <span className={`font-medium ${alreadyInvoiced ? "text-green-600" : selected ? "text-gray-800" : "text-gray-400"}`}>
                                {amount.toLocaleString("he-IL")} ₪
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mb-4 flex justify-between items-center px-1">
                    <span className="text-sm text-gray-500">סך הכל לחשבונית:</span>
                    <span className={`text-lg font-bold tabular-nums ${customAmountEnabled ? "line-through text-gray-400" : "text-gray-900"}`}>{monthTotal.toLocaleString("he-IL")} ₪</span>
                  </div>
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      handleSubmitInvoice(selectedOrderIds, selectedSubitemIds, monthTotal, firstDate, monthKeyToLabel(selectedMonth));
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">פרטי בנק</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="שם בנק / מספר חשבון / סניף"
                        value={invoiceForm.bankDetails}
                        onChange={e => setInvoiceForm(f => ({ ...f, bankDetails: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">מספר חשבונית</label>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="מספר חשבונית / קבלה"
                        value={invoiceForm.invoiceNumber}
                        onChange={e => setInvoiceForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        קובץ חשבונית
                        {extractingFile && <span className="mr-2 text-xs text-blue-500 font-normal">מחלץ נתונים...</span>}
                      </label>
                      <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${invoiceFile ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
                        {extractingFile ? (
                          <svg className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        )}
                        <span className="text-sm text-gray-600 flex-1 truncate">
                          {invoiceFile ? invoiceFile.name : "בחר קובץ PDF / תמונה"}
                        </span>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
                      </label>
                    </div>
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={customAmountEnabled}
                          onChange={e => setCustomAmountEnabled(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">שנה את סכום החשבונית</span>
                      </label>
                      {customAmountEnabled && (
                        <div className="space-y-2 pr-6">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            className="input-field"
                            placeholder="סכום בשקלים"
                            value={customAmountValue}
                            onChange={e => setCustomAmountValue(e.target.value)}
                          />
                          <input
                            type="text"
                            className="input-field text-sm"
                            placeholder="סיבה לשינוי הסכום (יופיע בחשבונית)"
                            value={customAmountNote}
                            onChange={e => setCustomAmountNote(e.target.value)}
                          />
                          {customAmountValue !== "" && !isNaN(Number(customAmountValue)) && (
                            <p className="text-xs text-blue-600">סכום שישלח: {Number(customAmountValue).toLocaleString("he-IL")} ₪</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setShowMonthInvoiceModal(false)} className="btn-secondary" disabled={submittingInvoice}>
                        ביטול
                      </button>
                      <button type="submit" className="btn-primary" disabled={submittingInvoice || selectedOrderIds.length === 0}>
                        {submittingInvoice ? "שולח..." : `הגש חשבונית — ${effectiveAmount.toLocaleString("he-IL")} ₪`}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Per-order invoice modal */}

        {invoiceFor && (() => {
          const approved = invoiceFor.attendanceStatus === "מאושר";
          const baseAmount = incomeBySubitemId[invoiceFor.subitemId] ?? 0;
          const effectiveAmount = customAmountEnabled && customAmountValue !== "" && !isNaN(Number(customAmountValue))
            ? Number(customAmountValue)
            : baseAmount;
          const monthLabel = invoiceFor.date ? monthKeyToLabel(invoiceFor.date.slice(0, 7)) : "";
          const canSubmit = approved || singleInvoiceClaim;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setInvoiceFor(null)}>
              <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-200" onClick={e => e.stopPropagation()}>
                {submittingInvoice && (
                  <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center gap-3 rounded-2xl">
                    <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    <span className="text-sm font-medium text-gray-600">מגיש חשבונית...</span>
                  </div>
                )}
                <h3 className="text-lg font-semibold text-gray-900 mb-1">הגשת חשבונית</h3>
                <div className="flex justify-between items-center mb-5 bg-gray-50 rounded-xl px-4 py-3 text-sm">
                  <span className="text-gray-700 font-medium">{invoiceFor.location || invoiceFor.orderName}</span>
                  <span className="flex gap-3 text-gray-500">
                    <span>{formatDateDDMMYY(invoiceFor.date)}</span>
                    <span className={`font-semibold ${customAmountEnabled ? "line-through text-gray-400" : "text-gray-800"}`}>{baseAmount.toLocaleString("he-IL")} ₪</span>
                    {customAmountEnabled && effectiveAmount !== baseAmount && (
                      <span className="font-semibold text-blue-700">{effectiveAmount.toLocaleString("he-IL")} ₪</span>
                    )}
                  </span>
                </div>
                {!approved && (
                  <label className="flex items-start gap-3 mb-5 p-3 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={singleInvoiceClaim}
                      onChange={e => setSingleInvoiceClaim(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-sm text-amber-800">נכחתי באירוע אך נוכחותי טרם אושרה במערכת</span>
                  </label>
                )}
                <form
                  onSubmit={e => {
                    e.preventDefault();
                    handleSubmitInvoice([invoiceFor.orderId], [invoiceFor.subitemId], baseAmount, invoiceFor.date, monthLabel);
                  }}
                  className="space-y-4"
                >
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">פרטי בנק</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="שם בנק / מספר חשבון / סניף"
                      value={invoiceForm.bankDetails}
                      onChange={e => setInvoiceForm(f => ({ ...f, bankDetails: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">מספר חשבונית</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="מספר חשבונית / קבלה"
                      value={invoiceForm.invoiceNumber}
                      onChange={e => setInvoiceForm(f => ({ ...f, invoiceNumber: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      קובץ חשבונית
                      {extractingFile && <span className="mr-2 text-xs text-blue-500 font-normal">מחלץ נתונים...</span>}
                    </label>
                    <label className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${invoiceFile ? "border-blue-300 bg-blue-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"}`}>
                      {extractingFile ? (
                        <svg className="w-5 h-5 animate-spin text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      )}
                      <span className="text-sm text-gray-600 flex-1 truncate">
                        {invoiceFile ? invoiceFile.name : "בחר קובץ PDF / תמונה"}
                      </span>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                  <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customAmountEnabled}
                        onChange={e => setCustomAmountEnabled(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">שנה את סכום החשבונית</span>
                    </label>
                    {customAmountEnabled && (
                      <div className="space-y-2 pr-6">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="input-field"
                          placeholder="סכום בשקלים"
                          value={customAmountValue}
                          onChange={e => setCustomAmountValue(e.target.value)}
                        />
                        <input
                          type="text"
                          className="input-field text-sm"
                          placeholder="סיבה לשינוי הסכום (יופיע בחשבונית)"
                          value={customAmountNote}
                          onChange={e => setCustomAmountNote(e.target.value)}
                        />
                        {customAmountValue !== "" && !isNaN(Number(customAmountValue)) && (
                          <p className="text-xs text-blue-600">סכום שישלח: {Number(customAmountValue).toLocaleString("he-IL")} ₪</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => setInvoiceFor(null)} className="btn-secondary" disabled={submittingInvoice}>
                      ביטול
                    </button>
                    <button type="submit" className="btn-primary" disabled={submittingInvoice || !canSubmit}>
                      {submittingInvoice ? "שולח..." : `הגש חשבונית — ${effectiveAmount.toLocaleString("he-IL")} ₪`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
