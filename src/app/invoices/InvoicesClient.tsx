"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { SessionUser } from "@/lib/auth";
import { canSubmitInvoice, isInvoiceStatusEligible } from "@/lib/invoiceEligibility";

interface Registration {
  orderId: string;
  orderName: string;
  date: string;
  location: string;
  activityHours?: string;
  subitemId: string;
  attendanceStatus: string;
  candidacyStatus: string;
  invoiceStatus: string;
}

interface InvoiceDto {
  id: string;
  name: string;
  status: string;
  date: string;
  amount: number;
  actualAmount: number;
  reportedAmount?: number;
  invoiceNumber: string;
  bankDetails: string;
  beneficiaryName: string;
  bankCode: string;
  bankBranch: string;
  bankAccount: string;
  amountNote: string;
  description: string;
  orderIds: string[];
}

interface InvoicesClientProps {
  user: SessionUser;
}

const HEBREW_MONTHS: Record<number, string> = {
  1: "ינואר", 2: "פברואר", 3: "מרץ", 4: "אפריל",
  5: "מאי", 6: "יוני", 7: "יולי", 8: "אוגוסט",
  9: "ספטמבר", 10: "אוקטובר", 11: "נובמבר", 12: "דצמבר",
};

const FIRST_EVENT_PAY_PATUR = 1000;
const ADDITIONAL_EVENT_PAY_PATUR = 850;
const PAY_MORESH = 1000;

function invoiceAmountsDiffer(expected: number, reported: number): boolean {
  return Math.abs(reported - expected) > 0.009;
}

function getReportedInvoiceAmount(
  expected: number,
  customAmountEnabled: boolean,
  customAmountValue: string
): number {
  if (customAmountEnabled && customAmountValue !== "" && !Number.isNaN(Number(customAmountValue))) {
    return Number(customAmountValue);
  }
  return expected;
}

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

function AttendanceBadge({ status }: { status: string }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        ממתין
      </span>
    );
  }
  const map: Record<string, string> = {
    מאושר: "bg-emerald-50 text-emerald-700 border-emerald-200",
    נדחה: "bg-red-50 text-red-600 border-red-200",
  };
  const dotMap: Record<string, string> = {
    מאושר: "bg-emerald-500",
    נדחה: "bg-red-500",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${map[status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[status] || "bg-gray-400"}`} />
      {status}
    </span>
  );
}

export default function InvoicesClient({ user }: InvoicesClientProps) {
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonthKey());
  const [artistStatus, setArtistStatus] = useState<"מורשה" | "פטור" | "">("");
  const [artistBankDetails, setArtistBankDetails] = useState({
    beneficiaryName: "",
    bankCode: "",
    bankBranch: "",
    bankAccount: "",
  });
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [showMonthInvoiceModal, setShowMonthInvoiceModal] = useState(false);
  const [monthSelectedOrderIds, setMonthSelectedOrderIds] = useState<Set<string>>(new Set());
  const [invoiceForm, setInvoiceForm] = useState({
    beneficiaryName: "",
    bankCode: "",
    bankBranch: "",
    bankAccount: "",
    invoiceNumber: "",
    description: "",
  });
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [submittingSeconds, setSubmittingSeconds] = useState(0);
  const [invoiceSuccess, setInvoiceSuccess] = useState<string | null>(null);
  const [extractingFile, setExtractingFile] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [customAmountEnabled, setCustomAmountEnabled] = useState(false);
  const [customAmountValue, setCustomAmountValue] = useState("");
  const [customAmountNote, setCustomAmountNote] = useState("");
  const [extractedActualAmount, setExtractedActualAmount] = useState<number | null>(null);
  const missingBankFields = useMemo(() => {
    const missing: string[] = [];
    if (!invoiceForm.beneficiaryName.trim()) missing.push("שם מוטב");
    if (!invoiceForm.bankCode.trim()) missing.push("קוד בנק");
    if (!invoiceForm.bankBranch.trim()) missing.push("מספר סניף");
    if (!invoiceForm.bankAccount.trim()) missing.push("מספר חשבון");
    return missing;
  }, [invoiceForm]);
  const hasCompleteBankDetails = useMemo(
    () => missingBankFields.length === 0,
    [missingBankFields]
  );
  const getSubmitBlockingReason = useCallback(
    (selectedCount: number, expectedAmount: number) => {
      if (selectedCount <= 0) return "בחר לפחות אירוע אחד";
      if (!invoiceFile) return "צרף קובץ חשבונית";
      if (missingBankFields.length > 0) return `השלם פרטי בנק: ${missingBankFields.join(", ")}`;
      const reported = getReportedInvoiceAmount(expectedAmount, customAmountEnabled, customAmountValue);
      if (invoiceAmountsDiffer(expectedAmount, reported) && !customAmountNote.trim()) {
        return "סיבה לשינוי הסכום";
      }
      return "";
    },
    [customAmountEnabled, customAmountNote, customAmountValue, invoiceFile, missingBankFields]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [regRes, invRes] = await Promise.all([
        fetch("/api/my-registrations"),
        fetch("/api/invoices"),
      ]);
      const regData = await regRes.json();
      if (!regRes.ok) {
        setError(regData.error || "שגיאה בטעינת נתונים");
        return;
      }

      const sortedRegs = [...(regData.registrations ?? [])].sort((a: Registration, b: Registration) =>
        (a.date || "").localeCompare(b.date || "")
      );
      setRegistrations(sortedRegs);
      setArtistStatus(regData.artistStatus ?? "");
      setArtistBankDetails({
        beneficiaryName: regData.beneficiaryName || "",
        bankCode: regData.bankCode || "",
        bankBranch: regData.bankBranch || "",
        bankAccount: regData.bankAccount || "",
      });

      if (invRes.ok) {
        const invData = await invRes.json();
        setInvoices((invData.invoices ?? []) as InvoiceDto[]);
        // #region agent log
        fetch("http://127.0.0.1:7442/ingest/30911afa-0e0f-4dec-b9b6-19b34bf7d632", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6ee816" },
          body: JSON.stringify({
            sessionId: "6ee816",
            runId: "run1",
            hypothesisId: "H2",
            location: "src/app/invoices/InvoicesClient.tsx:fetchData",
            message: "Loaded invoices in client",
            data: {
              invoicesCount: (invData.invoices ?? []).length,
              sample: (invData.invoices ?? []).slice(0, 5).map((inv: InvoiceDto) => ({
                id: inv.id,
                amount: inv.amount,
                actualAmount: inv.actualAmount,
                reportedAmount: inv.reportedAmount,
                orderIds: inv.orderIds,
              })),
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
      }
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!submittingInvoice) {
      setSubmittingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSubmittingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [submittingInvoice]);

  const eligibleByStatus = useMemo(
    () => registrations.filter((r) => isInvoiceStatusEligible(r)),
    [registrations]
  );

  const availableMonths = useMemo(() => {
    const keys = new Set<string>([getCurrentMonthKey()]);
    eligibleByStatus.forEach((r) => {
      const key = parseMonthKey(r.date);
      if (key) keys.add(key);
    });
    return Array.from(keys).sort();
  }, [eligibleByStatus]);

  const filtered = useMemo(() => {
    if (selectedMonth === "all") return eligibleByStatus;
    return eligibleByStatus.filter((r) => parseMonthKey(r.date) === selectedMonth);
  }, [eligibleByStatus, selectedMonth]);
  const approvedAttendanceCount = filtered.filter((r) => r.attendanceStatus === "מאושר").length;
  const pendingAttendanceCount = filtered.filter((r) => !r.attendanceStatus).length;
  const submittedCount = filtered.filter((r) => r.invoiceStatus === "הוגשה").length;
  const readyToSubmitCount = filtered.filter((r) => canSubmitInvoice(r)).length;

  const { incomeBySubitemId } = useMemo(() => {
    const byId: Record<string, number> = {};
    const byMonth = new Map<string, Registration[]>();
    for (const reg of filtered) {
      const key = parseMonthKey(reg.date) || "none";
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(reg);
    }
    for (const regs of byMonth.values()) {
      const sorted = [...regs].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      for (let i = 0; i < sorted.length; i++) {
        const amount = artistStatus === "פטור"
          ? i === 0
            ? FIRST_EVENT_PAY_PATUR
            : ADDITIONAL_EVENT_PAY_PATUR
          : PAY_MORESH;
        byId[sorted[i].subitemId] = amount;
      }
    }
    return { incomeBySubitemId: byId };
  }, [filtered, artistStatus]);

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
      setInvoiceForm((f) => ({
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

  const handleSubmitInvoice = useCallback(async (
    orderIds: string[],
    subitemIds: string[],
    amount: number,
    eventDate: string,
    monthLabel: string,
    monthKey: string
  ) => {
    if (!orderIds.length || !subitemIds.length) {
      setError("יש לבחור לפחות אירוע אחד");
      return;
    }
    if (!invoiceFile) {
      setError("חובה לצרף קובץ חשבונית");
      return;
    }
    if (!hasCompleteBankDetails) {
      setError(`חובה למלא פרטי חשבון בנק: ${missingBankFields.join(", ")}`);
      return;
    }

    const reportedAmount = getReportedInvoiceAmount(amount, customAmountEnabled, customAmountValue);
    if (invoiceAmountsDiffer(amount, reportedAmount) && !customAmountNote.trim()) {
      setError("כאשר הסכום שונה מהסכום המחושב, יש למלא סיבה לשינוי");
      return;
    }

    setSubmittingInvoice(true);
    setError(null);
    try {
      const actualAmountToSend = invoiceAmountsDiffer(amount, reportedAmount)
        ? reportedAmount
        : undefined;

      const fd = new FormData();
      fd.append("orderIds", JSON.stringify(orderIds));
      fd.append("subitemIds", JSON.stringify(subitemIds));
      fd.append("amount", String(amount));
      if (actualAmountToSend != null) fd.append("actualAmount", String(actualAmountToSend));
      fd.append("eventDate", eventDate);
      fd.append("monthLabel", monthLabel);
      fd.append("monthKey", monthKey);
      fd.append("beneficiaryName", invoiceForm.beneficiaryName);
      fd.append("bankCode", invoiceForm.bankCode);
      fd.append("bankBranch", invoiceForm.bankBranch);
      fd.append("bankAccount", invoiceForm.bankAccount);
      fd.append(
        "bankDetails",
        [invoiceForm.beneficiaryName, invoiceForm.bankCode, invoiceForm.bankBranch, invoiceForm.bankAccount].filter(Boolean).join(" / ")
      );
      fd.append("invoiceNumber", invoiceForm.invoiceNumber);
      fd.append("amountNote", customAmountNote);
      fd.append("description", invoiceForm.description);
      if (invoiceFile) fd.append("file", invoiceFile, invoiceFile.name);

      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בהגשת חשבונית");
        return;
      }

      setShowMonthInvoiceModal(false);
      setInvoiceForm({ beneficiaryName: "", bankCode: "", bankBranch: "", bankAccount: "", invoiceNumber: "", description: "" });
      setInvoiceFile(null);
      setCustomAmountEnabled(false);
      setCustomAmountValue("");
      setCustomAmountNote("");
      setExtractedActualAmount(null);
      setInvoiceSuccess(`החשבונית הוגשה בהצלחה — ${amount.toLocaleString("he-IL")} ₪`);
      setArtistBankDetails({
        beneficiaryName: invoiceForm.beneficiaryName,
        bankCode: invoiceForm.bankCode,
        bankBranch: invoiceForm.bankBranch,
        bankAccount: invoiceForm.bankAccount,
      });
      setTimeout(() => setInvoiceSuccess(null), 5000);
      await fetchData();
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setSubmittingInvoice(false);
    }
  }, [customAmountEnabled, customAmountNote, customAmountValue, fetchData, hasCompleteBankDetails, invoiceFile, invoiceForm, missingBankFields]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">הגשת חשבוניות</h1>
              <p className="text-sm text-gray-500 mt-1">הגשת חשבונית מתבצעת פעם בחודש מהכפתור בראש הטבלה</p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="mt-1 p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-40"
              title="רענן"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          {!loading && filtered.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-2.5">
              <div className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-gray-500">מועמדויות</span>
                <span className="font-semibold text-gray-900">{filtered.length}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-emerald-700">מאושרות נוכחות</span>
                <span className="font-semibold text-emerald-800">{approvedAttendanceCount}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-700">ממתינות נוכחות</span>
                <span className="font-semibold text-amber-800">{pendingAttendanceCount}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-indigo-500" />
                <span className="text-indigo-700">ניתנות להגשה</span>
                <span className="font-semibold text-indigo-800">{readyToSubmitCount}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-slate-500" />
                <span className="text-slate-600">כבר הוגשו</span>
                <span className="font-semibold text-slate-800">{submittedCount}</span>
              </div>
            </div>
          )}
        </div>

        {!loading && (
          <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              {filtered.length > 0 && selectedMonth !== "all" && (
                <button
                  type="button"
                  onClick={() => {
                    const invoiceEligible = new Set(
                      filtered.filter((r) => canSubmitInvoice(r)).map((r) => r.orderId)
                    );
                    setMonthSelectedOrderIds(invoiceEligible);
                    setShowMonthInvoiceModal(true);
                    setInvoiceForm({
                      beneficiaryName: artistBankDetails.beneficiaryName,
                      bankCode: artistBankDetails.bankCode,
                      bankBranch: artistBankDetails.bankBranch,
                      bankAccount: artistBankDetails.bankAccount,
                      invoiceNumber: "",
                      description: "",
                    });
                    setInvoiceFile(null);
                    setCustomAmountEnabled(false);
                    setCustomAmountValue("");
                    setCustomAmountNote("");
                    setExtractedActualAmount(null);
                  }}
                  className="btn-secondary inline-flex items-center justify-center gap-2 text-sm"
                >
                  העלה חשבוניות לחודש
                </button>
              )}
            </div>
          </div>
        )}

        {invoiceSuccess && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-700 text-sm font-medium">
            {invoiceSuccess}
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
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center text-gray-500">
            אין אירועים זכאים לחשבונית בטווח שנבחר
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-right border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">מיקום</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">תאריך</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סטטוס נוכחות</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סכום</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">הסכום שדווח</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סטטוס חשבונית</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((reg) => {
                    const amount = incomeBySubitemId[reg.subitemId] ?? 0;
                    const isSubmitted = reg.invoiceStatus === "הוגשה";
                    const regOrderId = String(reg.orderId);
                    const relatedInvoice = invoices.find((inv) =>
                      (inv.orderIds || []).some((id) => String(id) === regOrderId)
                    );
                    const reportedAmountForRow =
                      relatedInvoice?.reportedAmount != null && !Number.isNaN(relatedInvoice.reportedAmount)
                        ? relatedInvoice.reportedAmount
                        : null;
                    const displayAmount = isSubmitted && reportedAmountForRow != null
                      ? reportedAmountForRow
                      : amount;
                    // #region agent log
                    if (isSubmitted) {
                      fetch("http://127.0.0.1:7442/ingest/30911afa-0e0f-4dec-b9b6-19b34bf7d632", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "6ee816" },
                        body: JSON.stringify({
                          sessionId: "6ee816",
                          runId: "run1",
                          hypothesisId: "H3",
                          location: "src/app/invoices/InvoicesClient.tsx:tableRow",
                          message: "Computed submitted row display amount",
                          data: {
                            regOrderId,
                            calculatedAmount: amount,
                            matchedInvoiceId: relatedInvoice?.id || "",
                            matchedInvoiceOrderIds: relatedInvoice?.orderIds || [],
                            matchedReportedAmount: relatedInvoice?.reportedAmount ?? null,
                            matchedActualAmount: relatedInvoice?.actualAmount ?? null,
                            finalDisplayAmount: displayAmount,
                          },
                          timestamp: Date.now(),
                        }),
                      }).catch(() => {});
                    }
                    // #endregion
                    return (
                      <tr key={reg.subitemId} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-5 py-4 font-medium text-gray-900">{reg.location || reg.orderName || "—"}</td>
                        <td className="px-5 py-4 text-gray-700 tabular-nums">{formatDateDDMMYY(reg.date)}</td>
                        <td className="px-5 py-4">
                          <AttendanceBadge status={reg.attendanceStatus} />
                        </td>
                        <td className="px-5 py-4 text-gray-700 tabular-nums">{displayAmount.toLocaleString("he-IL")} ₪</td>
                        <td className="px-5 py-4 text-gray-700 tabular-nums">
                          {reportedAmountForRow != null
                            ? `${reportedAmountForRow.toLocaleString("he-IL")} ₪`
                            : "—"}
                        </td>
                        <td className="px-5 py-4">
                          {isSubmitted ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              הוגשה
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              טרם הוגשה
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {invoices.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 font-medium text-gray-700">החשבוניות שלי ({invoices.length})</div>
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
                {invoices.map((inv) => (
                  (() => {
                    const displayAmount =
                      inv.reportedAmount != null && !Number.isNaN(inv.reportedAmount)
                        ? inv.reportedAmount
                        : inv.amount;
                    return (
                  <tr key={inv.id}>
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.name}</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{formatDateDDMMYY(inv.date)}</td>
                    <td className="px-4 py-3 font-semibold text-gray-800 tabular-nums">{displayAmount.toLocaleString("he-IL")} ₪</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200">
                        {inv.status || "ממתין"}
                      </span>
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showMonthInvoiceModal && filtered.length > 0 && selectedMonth !== "all" && (() => {
          const selectedRegs = filtered
            .filter((r) => monthSelectedOrderIds.has(r.orderId) && canSubmitInvoice(r))
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
          const selectedSubitemIds = selectedRegs.map((r) => r.subitemId);
          const firstDate = selectedRegs[0]?.date || filtered[0]?.date || "";
          const reportedAmount = getReportedInvoiceAmount(monthTotal, customAmountEnabled, customAmountValue);
          const amountChanged = invoiceAmountsDiffer(monthTotal, reportedAmount);
          const submitBlockReason = getSubmitBlockingReason(selectedOrderIds.length, monthTotal);
          const effectiveAmount = reportedAmount;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowMonthInvoiceModal(false)}>
              <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden border border-gray-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
                {submittingInvoice && (
                  <div className="absolute inset-0 z-10 bg-white/90 flex flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center">
                    <span className="h-8 w-8 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                    <span className="text-base font-semibold text-gray-800">ההגשה בבדיקה</span>
                    <span className="text-sm text-gray-600">זה עשוי לקחת כ-15 שניות</span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800 tabular-nums">
                      <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                      {submittingSeconds} שניות
                    </span>
                  </div>
                )}
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">הגשת חשבונית לחודש</h3>
                  <p className="text-sm text-gray-500 mt-1">{monthKeyToLabel(selectedMonth)}</p>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <ul className="mb-5 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden text-sm">
                    {filtered.map((reg) => {
                      const alreadyInvoiced = reg.invoiceStatus === "הוגשה";
                      const selected = monthSelectedOrderIds.has(reg.orderId);
                      const amount = selectedIncomeBySubitemId[reg.subitemId] ?? 0;
                      const requiresClaim = reg.attendanceStatus !== "מאושר";
                      return (
                        <li key={reg.subitemId} className={`flex items-center gap-3 px-4 py-3 ${alreadyInvoiced ? "bg-green-50" : selected ? "bg-white" : "bg-gray-50"}`}>
                          <input
                            type="checkbox"
                            checked={alreadyInvoiced || selected}
                            disabled={alreadyInvoiced}
                            onChange={(e) => {
                              if (alreadyInvoiced) return;
                              setMonthSelectedOrderIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(reg.orderId);
                                else next.delete(reg.orderId);
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                          />
                          <span className="flex-1 flex justify-between items-center gap-2">
                            <span className={alreadyInvoiced ? "text-green-700 font-medium" : "text-gray-800"}>
                              {reg.location || reg.orderName || "—"}
                              {!alreadyInvoiced && requiresClaim && (
                                <span className="mr-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  הצהרה: נכחתי באירוע
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums text-gray-500 flex gap-3">
                              <span>{formatDateDDMMYY(reg.date)}</span>
                              <span className={selected ? "font-medium text-gray-800" : "text-gray-400"}>
                                {amount.toLocaleString("he-IL")} ₪
                              </span>
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mb-4 flex justify-between items-center px-1">
                    <span className="text-sm text-gray-500">סך הכל לחשבונית:</span>
                    <span className={`text-lg font-bold tabular-nums ${customAmountEnabled ? "line-through text-gray-400" : "text-gray-900"}`}>
                      {monthTotal.toLocaleString("he-IL")} ₪
                    </span>
                  </div>
                  <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm space-y-1.5">
                    <div className={selectedOrderIds.length > 0 ? "text-emerald-700" : "text-amber-700"}>
                      {selectedOrderIds.length > 0 ? "✓" : "•"} נבחרו אירועים להגשה
                    </div>
                    <div className={invoiceFile ? "text-emerald-700" : "text-amber-700"}>
                      {invoiceFile ? "✓" : "•"} צורף קובץ חשבונית
                    </div>
                    <div className={hasCompleteBankDetails ? "text-emerald-700" : "text-amber-700"}>
                      {hasCompleteBankDetails ? "✓" : "•"} פרטי חשבון בנק מלאים
                    </div>
                    {amountChanged && (
                      <div className={customAmountNote.trim() ? "text-emerald-700" : "text-amber-700"}>
                        {customAmountNote.trim() ? "✓" : "•"} סיבה לשינוי הסכום
                      </div>
                    )}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSubmitInvoice(
                        selectedOrderIds,
                        selectedSubitemIds,
                        monthTotal,
                        firstDate,
                        monthKeyToLabel(selectedMonth),
                        selectedMonth
                      );
                    }}
                    className="space-y-4"
                  >
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                      <div className="text-sm font-semibold text-gray-800">פרטי בנק</div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">שם המוטב</label>
                        <input
                          type="text"
                          className="input-field w-full sm:max-w-[360px]"
                          placeholder="שם מלא"
                          value={invoiceForm.beneficiaryName}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, beneficiaryName: e.target.value }))}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">קוד בנק</label>
                        <input
                          type="text"
                          className="input-field w-full sm:max-w-[360px]"
                          placeholder="למשל 12"
                          value={invoiceForm.bankCode}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, bankCode: e.target.value }))}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">מספר סניף</label>
                        <input
                          type="text"
                          className="input-field w-full sm:max-w-[360px]"
                          placeholder="למשל 345"
                          value={invoiceForm.bankBranch}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, bankBranch: e.target.value }))}
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">מספר חשבון</label>
                        <input
                          type="text"
                          className="input-field w-full sm:max-w-[360px]"
                          placeholder="למשל 1234567"
                          value={invoiceForm.bankAccount}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, bankAccount: e.target.value }))}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          className="text-xs text-blue-700 hover:text-blue-800 underline underline-offset-2"
                          onClick={() =>
                            setInvoiceForm((f) => ({
                              ...f,
                              beneficiaryName: artistBankDetails.beneficiaryName,
                              bankCode: artistBankDetails.bankCode,
                              bankBranch: artistBankDetails.bankBranch,
                              bankAccount: artistBankDetails.bankAccount,
                            }))
                          }
                        >
                          מלא מהפרטים השמורים שלי
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                        קובץ חשבונית <span className="text-red-500">*</span>
                      </label>
                      <label
                        className={`w-full sm:max-w-[360px] cursor-pointer rounded-xl border-2 px-4 py-3 transition-colors ${
                          invoiceFile
                            ? "border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
                            : "border-blue-300 bg-blue-50 hover:bg-blue-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className={`text-sm font-medium ${invoiceFile ? "text-emerald-800" : "text-blue-800"}`}>
                            {invoiceFile ? "הקובץ הועלה בהצלחה" : "לחץ/י כאן להעלאת קובץ חשבונית"}
                          </span>
                          <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${invoiceFile ? "bg-emerald-200 text-emerald-800" : "bg-blue-200 text-blue-800"}`}>
                            PDF / תמונה
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-600 truncate text-right">
                          {invoiceFile ? invoiceFile.name : "לא נבחר קובץ"}
                        </div>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)} />
                      </label>
                    </div>
                    {invoiceFile && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">מספר חשבונית / קבלה</label>
                        <input
                          type="text"
                          className="input-field w-full sm:max-w-[360px]"
                          placeholder="לדוגמה: 12345"
                          value={invoiceForm.invoiceNumber}
                          onChange={(e) => setInvoiceForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                        />
                      </div>
                    )}
                    {extractingFile && (
                      <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3">
                        <div className="flex items-center gap-2 text-blue-800 font-semibold text-sm">
                          <span className="inline-block h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
                          מחלץ נתונים מהקובץ...
                        </div>
                        <p className="mt-1 text-xs text-blue-700">
                          המערכת קוראת אוטומטית מספר חשבונית, תיאור וסכום (אם נמצא)
                        </p>
                      </div>
                    )}
                    <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={customAmountEnabled}
                          onChange={(e) => setCustomAmountEnabled(e.target.checked)}
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
                            onChange={(e) => setCustomAmountValue(e.target.value)}
                          />
                          {amountChanged && (
                            <div>
                              <label className="text-sm font-medium text-gray-700">
                                סיבה לשינוי הסכום <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                className="input-field text-sm mt-1"
                                placeholder="למה הסכום בחשבונית שונה מהסכום המחושב?"
                                value={customAmountNote}
                                onChange={(e) => setCustomAmountNote(e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button type="button" onClick={() => setShowMonthInvoiceModal(false)} className="btn-secondary" disabled={submittingInvoice}>
                        ביטול
                      </button>
                      <button
                        type="submit"
                        className="btn-primary"
                        disabled={submittingInvoice || Boolean(submitBlockReason)}
                      >
                        {submittingInvoice
                          ? "שולח..."
                          : submitBlockReason
                            ? `חסר: ${submitBlockReason}`
                            : `הגש חשבונית — ${effectiveAmount.toLocaleString("he-IL")} ₪`}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
