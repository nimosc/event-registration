"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import NavBar from "@/components/NavBar";
import { SessionUser } from "@/lib/auth";
import { canSubmitInvoice, isInvoiceStatusEligible } from "@/lib/invoiceEligibility";
import {
  getFollowUpAccountingDocument,
  getInitialDocumentForTaxStatus,
  getSubmissionStatusDisplay,
  getSubitemInvoiceStatusDisplay,
  INVOICE_SUBMISSION_STATUS,
  isAwaitingAccountingDocument,
  isInvoiceSubmissionComplete,
  isSubitemAwaitingAccounting,
  isSubitemInvoiceComplete,
  SUBITEM_INVOICE_STATUS,
} from "@/lib/invoiceDocuments";
import { invoiceAmountsMatch, validateExtractedAgainstExpected } from "@/lib/invoiceValidation";

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
  linkedInvoiceId?: string;
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
  submissionStatus: string;
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
const ADDITIONAL_EVENT_PAY_PATUR = 800;
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

function getLastMonthKeys(count: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function isRegistrationInvoiceComplete(
  reg: Registration,
  invoiceList: InvoiceDto[]
): boolean {
  if (isSubitemInvoiceComplete(reg.invoiceStatus)) return true;
  const related = resolveInvoiceForRegistration(reg, invoiceList);
  return isInvoiceSubmissionComplete(related?.submissionStatus || "");
}

function isRegistrationAwaitingAccounting(
  reg: Registration,
  invoiceList: InvoiceDto[]
): boolean {
  if (isRegistrationInvoiceComplete(reg, invoiceList)) return false;
  if (isSubitemAwaitingAccounting(reg.invoiceStatus)) return true;
  const related = resolveInvoiceForRegistration(reg, invoiceList);
  return isAwaitingAccountingDocument(related?.submissionStatus || "");
}

function resolveInvoiceForRegistration(
  reg: Registration,
  invoiceList: InvoiceDto[]
): InvoiceDto | null {
  if (reg.linkedInvoiceId) {
    const byId = invoiceList.find((inv) => inv.id === reg.linkedInvoiceId);
    if (byId) return byId;
  }
  return (
    invoiceList.find((inv) =>
      (inv.orderIds || []).some((id) => String(id) === String(reg.orderId))
    ) ?? null
  );
}

function resolveInvoiceIdForRegistration(
  reg: Registration,
  invoiceList: InvoiceDto[]
): string {
  return resolveInvoiceForRegistration(reg, invoiceList)?.id || reg.linkedInvoiceId || "";
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
  const needsTaxStatusPrompt = !loading && !artistStatus;
  const initialDocumentConfig = artistStatus
    ? getInitialDocumentForTaxStatus(artistStatus)
    : null;
  const followUpAccountingDocument = getFollowUpAccountingDocument();
  const [editingTaxStatus, setEditingTaxStatus] = useState(false);
  const [savingTaxStatus, setSavingTaxStatus] = useState(false);
  const [artistBankDetails, setArtistBankDetails] = useState({
    beneficiaryName: "",
    bankCode: "",
    bankBranch: "",
    bankAccount: "",
  });
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [showMonthInvoiceModal, setShowMonthInvoiceModal] = useState(false);
  const [showVoluntaryModal, setShowVoluntaryModal] = useState(false);
  const [eventsDescription, setEventsDescription] = useState("");
  const [voluntaryAmount, setVoluntaryAmount] = useState("");
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
  const [showAccountingModal, setShowAccountingModal] = useState(false);
  const [accountingInvoiceId, setAccountingInvoiceId] = useState("");
  const [accountingFile, setAccountingFile] = useState<File | null>(null);
  const [accountingInvoiceNumber, setAccountingInvoiceNumber] = useState("");
  const [submittingAccounting, setSubmittingAccounting] = useState(false);
  const [submittingAccountingSeconds, setSubmittingAccountingSeconds] = useState(0);
  const [extractingAccountingFile, setExtractingAccountingFile] = useState(false);
  const [accountingExtractedAmount, setAccountingExtractedAmount] = useState<number | null>(null);
  const [accountingExtractedNumber, setAccountingExtractedNumber] = useState("");
  const accountingInvoice = useMemo(
    () => invoices.find((inv) => inv.id === accountingInvoiceId) ?? null,
    [invoices, accountingInvoiceId]
  );
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
      if (!invoiceFile) return `צרף ${initialDocumentConfig?.fileLabel ?? "מסמך"}`;
      if (missingBankFields.length > 0) return `השלם פרטי בנק: ${missingBankFields.join(", ")}`;
      const reported = getReportedInvoiceAmount(expectedAmount, customAmountEnabled, customAmountValue);
      if (invoiceAmountsDiffer(expectedAmount, reported) && !customAmountNote.trim()) {
        return "סיבה לשינוי הסכום";
      }
      if (extractedActualAmount != null && !invoiceAmountsMatch(reported, extractedActualAmount)) {
        return "הסכום בקובץ לא תואם לסכום להגשה";
      }
      return "";
    },
    [customAmountEnabled, customAmountNote, customAmountValue, extractedActualAmount, initialDocumentConfig?.fileLabel, invoiceFile, missingBankFields]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const invRes = await fetch("/api/invoices");
      if (invRes.ok) {
        const invData = await invRes.json();
        setInvoices((invData.invoices ?? []) as InvoiceDto[]);
      }

      const regRes = await fetch("/api/my-registrations");
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

  useEffect(() => {
    if (!submittingAccounting) {
      setSubmittingAccountingSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSubmittingAccountingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [submittingAccounting]);

  const eligibleByStatus = useMemo(
    () => registrations.filter((r) => isInvoiceStatusEligible(r)),
    [registrations]
  );

  const availableMonths = useMemo(() => {
    const keys = new Set<string>(getLastMonthKeys(4));
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
  const pendingAccountingInvoices = useMemo(
    () => invoices.filter((inv) => isAwaitingAccountingDocument(inv.submissionStatus)),
    [invoices]
  );
  const awaitingAccountingRegsInMonth = useMemo(
    () => filtered.filter((reg) => isRegistrationAwaitingAccounting(reg, invoices)),
    [filtered, invoices]
  );
  const pendingAccountingInvoiceForSelectedMonth = useMemo(() => {
    if (selectedMonth === "all" || awaitingAccountingRegsInMonth.length === 0) return null;
    for (const reg of awaitingAccountingRegsInMonth) {
      const related = resolveInvoiceForRegistration(reg, invoices);
      if (related) return related;
    }
    const monthOrderIds = new Set(awaitingAccountingRegsInMonth.map((r) => String(r.orderId)));
    return (
      pendingAccountingInvoices.find((inv) =>
        inv.orderIds.some((id) => monthOrderIds.has(String(id)))
      ) ??
      invoices.find((inv) => inv.orderIds.some((id) => monthOrderIds.has(String(id)))) ??
      null
    );
  }, [awaitingAccountingRegsInMonth, invoices, pendingAccountingInvoices, selectedMonth]);
  const pendingAccountingInvoiceIdForSelectedMonth = useMemo(() => {
    if (pendingAccountingInvoiceForSelectedMonth) return pendingAccountingInvoiceForSelectedMonth.id;
    const regWithLink = awaitingAccountingRegsInMonth.find((reg) => reg.linkedInvoiceId);
    return regWithLink?.linkedInvoiceId || "";
  }, [awaitingAccountingRegsInMonth, pendingAccountingInvoiceForSelectedMonth]);
  const submittedCount = filtered.filter((r) => isRegistrationInvoiceComplete(r, invoices)).length;
  const awaitingAccountingCount = filtered.filter((r) => isRegistrationAwaitingAccounting(r, invoices)).length;
  const readyToSubmitCount = filtered.filter((r) => canSubmitInvoice(r)).length;
  const showVoluntaryUpload =
    selectedMonth !== "all" && Boolean(artistStatus) && filtered.length === 0;
  const voluntaryDocumentLabel =
    artistStatus === "מורשה" ? "בקשת תשלום" : "קבלה";

  const { incomeBySubitemId } = useMemo(() => {
    const byId: Record<string, number> = {};
    if (!artistStatus) return { incomeBySubitemId: byId };

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

  const handleTaxStatusChange = useCallback(async (taxStatus: "מורשה" | "פטור") => {
    if (taxStatus === artistStatus || savingTaxStatus) return;
    setSavingTaxStatus(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/tax-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בעדכון סוג העוסק");
        return;
      }
      setArtistStatus(taxStatus);
      setEditingTaxStatus(false);
    } catch {
      setError("שגיאת רשת בעדכון סוג העוסק");
    } finally {
      setSavingTaxStatus(false);
    }
  }, [artistStatus, savingTaxStatus]);

  const handleFileChange = useCallback(async (file: File | null) => {
    setInvoiceFile(file);
    if (!file || !initialDocumentConfig?.extractFromFile) return;
    setExtractingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/invoices/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) return;
      setInvoiceForm((f) => ({
        ...f,
        invoiceNumber: data.receiptNumber || f.invoiceNumber,
        description: data.description || f.description,
      }));
      if (data.amount != null) {
        setExtractedActualAmount(data.amount);
        setCustomAmountEnabled(true);
        setCustomAmountValue(String(data.amount));
        setVoluntaryAmount(String(data.amount));
      }
    } catch {
      // חילוץ אוטומטי הוא אופציונלי — הקובץ עדיין מצורף
    } finally {
      setExtractingFile(false);
    }
  }, [initialDocumentConfig?.extractFromFile]);

  const openAccountingModal = useCallback((invoiceId: string, invoiceNumber = "") => {
    setAccountingInvoiceId(invoiceId);
    setAccountingFile(null);
    setAccountingInvoiceNumber(invoiceNumber);
    setAccountingExtractedAmount(null);
    setAccountingExtractedNumber("");
    setShowAccountingModal(true);
  }, []);

  const handleAccountingFileChange = useCallback(async (file: File | null) => {
    setAccountingFile(file);
    setAccountingExtractedAmount(null);
    setAccountingExtractedNumber("");
    if (!file || !followUpAccountingDocument.extractFromFile) return;
    setExtractingAccountingFile(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/invoices/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) return;
      if (data.receiptNumber) {
        setAccountingExtractedNumber(data.receiptNumber);
        if (!accountingInvoiceNumber.trim()) {
          setAccountingInvoiceNumber(data.receiptNumber);
        }
      }
      if (data.amount != null) {
        setAccountingExtractedAmount(Number(data.amount));
      }
    } catch {
      // חילוץ אופציונלי
    } finally {
      setExtractingAccountingFile(false);
    }
  }, [accountingInvoiceNumber, followUpAccountingDocument.extractFromFile]);

  const accountingValidationError = useMemo(() => {
    if (!accountingInvoice || !accountingFile) return null;
    const expectedAmount =
      accountingInvoice.reportedAmount ?? accountingInvoice.actualAmount ?? accountingInvoice.amount;
    return validateExtractedAgainstExpected({
      extracted: {
        receiptNumber: accountingExtractedNumber || accountingInvoiceNumber || null,
        amount: accountingExtractedAmount,
        description: null,
      },
      expectedAmount,
      declaredNumber: accountingInvoiceNumber,
      requireAmountWhenExtracted: true,
      requireNumberWhenBothPresent: true,
    });
  }, [
    accountingExtractedAmount,
    accountingExtractedNumber,
    accountingFile,
    accountingInvoice,
    accountingInvoiceNumber,
  ]);

  const handleSubmitAccountingDocument = useCallback(async () => {
    if (!accountingInvoiceId || !accountingFile) {
      setError("חובה לצרף חשבונית מס קבלה");
      return;
    }
    if (!accountingInvoiceNumber.trim()) {
      setError("חובה למלא מספר חשבונית / קבלה");
      return;
    }
    if (accountingValidationError) {
      setError(accountingValidationError);
      return;
    }
    setSubmittingAccounting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("invoiceId", accountingInvoiceId);
      fd.append("file", accountingFile, accountingFile.name);
      if (accountingInvoiceNumber.trim()) {
        fd.append("invoiceNumber", accountingInvoiceNumber.trim());
      }
      const res = await fetch("/api/invoices/accounting-document", { method: "POST", body: fd });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        setError(res.ok ? "שגיאה בפענוח תשובת השרת" : `שגיאת שרת (${res.status}) — נסה שוב`);
        return;
      }
      if (!res.ok) {
        setError(data.error || "שגיאה בהעלאת מסמך חשבונאי");
        return;
      }
      setShowAccountingModal(false);
      setAccountingInvoiceId("");
      setAccountingFile(null);
      setAccountingInvoiceNumber("");
      setAccountingExtractedAmount(null);
      setAccountingExtractedNumber("");
      setInvoiceSuccess("הרשומה עודכנה — חשבונית מס קבלה הוגשה בהצלחה");
      setTimeout(() => setInvoiceSuccess(null), 5000);
      await fetchData();
    } catch {
      setError("שגיאת רשת.");
    } finally {
      setSubmittingAccounting(false);
    }
  }, [
    accountingFile,
    accountingInvoiceId,
    accountingInvoiceNumber,
    accountingValidationError,
    fetchData,
  ]);

  const openVoluntaryModal = useCallback(() => {
    setEventsDescription("");
    setVoluntaryAmount("");
    setInvoiceForm({
      beneficiaryName: artistBankDetails.beneficiaryName,
      bankCode: artistBankDetails.bankCode,
      bankBranch: artistBankDetails.bankBranch,
      bankAccount: artistBankDetails.bankAccount,
      invoiceNumber: "",
      description: "",
    });
    setInvoiceFile(null);
    setExtractedActualAmount(null);
    setShowVoluntaryModal(true);
  }, [artistBankDetails]);

  const handleSubmitVoluntaryInvoice = useCallback(async () => {
    if (!eventsDescription.trim()) {
      setError("יש לפרט עבור אילו אירועים מדובר");
      return;
    }
    const amount = Number(voluntaryAmount);
    if (!voluntaryAmount || Number.isNaN(amount) || amount <= 0) {
      setError("יש למלא סכום להגשה");
      return;
    }
    if (!invoiceFile) {
      setError(`חובה לצרף ${initialDocumentConfig?.fileLabel ?? "מסמך"}`);
      return;
    }
    if (!hasCompleteBankDetails) {
      setError(`חובה למלא פרטי חשבון בנק: ${missingBankFields.join(", ")}`);
      return;
    }
    if (extractedActualAmount != null && !invoiceAmountsMatch(amount, extractedActualAmount)) {
      setError("הסכום בקובץ לא תואם לסכום להגשה");
      return;
    }

    setSubmittingInvoice(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("voluntarySubmission", "true");
      fd.append("eventsDescription", eventsDescription.trim());
      fd.append("orderIds", "[]");
      fd.append("subitemIds", "[]");
      fd.append("amount", String(amount));
      fd.append("eventDate", `${selectedMonth}-01`);
      fd.append("monthLabel", monthKeyToLabel(selectedMonth));
      fd.append("monthKey", selectedMonth);
      fd.append("beneficiaryName", invoiceForm.beneficiaryName);
      fd.append("bankCode", invoiceForm.bankCode);
      fd.append("bankBranch", invoiceForm.bankBranch);
      fd.append("bankAccount", invoiceForm.bankAccount);
      fd.append(
        "bankDetails",
        [invoiceForm.beneficiaryName, invoiceForm.bankCode, invoiceForm.bankBranch, invoiceForm.bankAccount]
          .filter(Boolean)
          .join(" / ")
      );
      fd.append("invoiceNumber", invoiceForm.invoiceNumber);
      fd.append("description", invoiceForm.description);
      fd.append("file", invoiceFile, invoiceFile.name);

      const res = await fetch("/api/invoices", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בהגשת מסמך");
        return;
      }

      setShowVoluntaryModal(false);
      setEventsDescription("");
      setVoluntaryAmount("");
      setInvoiceForm({ beneficiaryName: "", bankCode: "", bankBranch: "", bankAccount: "", invoiceNumber: "", description: "" });
      setInvoiceFile(null);
      setExtractedActualAmount(null);
      setInvoiceSuccess(
        `המסמך הוגש לבדיקה — ${amount.toLocaleString("he-IL")} ₪. נבדוק את הפרטים ונעדכן.`
      );
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
  }, [
    eventsDescription,
    extractedActualAmount,
    fetchData,
    hasCompleteBankDetails,
    initialDocumentConfig?.fileLabel,
    invoiceFile,
    invoiceForm,
    missingBankFields,
    selectedMonth,
    voluntaryAmount,
  ]);

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
      setError(`חובה לצרף ${initialDocumentConfig?.fileLabel ?? "מסמך"}`);
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
      setInvoiceSuccess(
        initialDocumentConfig?.kind === "payment_request"
          ? `בקשת התשלום הוגשה בהצלחה — ${amount.toLocaleString("he-IL")} ₪`
          : `${initialDocumentConfig?.fileLabel ?? "המסמך"} הוגש בהצלחה — ${amount.toLocaleString("he-IL")} ₪`
      );
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
  }, [customAmountEnabled, customAmountNote, customAmountValue, fetchData, hasCompleteBankDetails, initialDocumentConfig, invoiceFile, invoiceForm, missingBankFields]);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">הגשת חשבוניות</h1>
                {!loading && artistStatus && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-sm font-medium text-gray-700">
                      סוג עוסק: {artistStatus}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingTaxStatus((v) => !v)}
                      disabled={savingTaxStatus}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2 disabled:opacity-50"
                    >
                      {savingTaxStatus ? "שומר..." : editingTaxStatus ? "סגור" : "שנה"}
                    </button>
                    {editingTaxStatus && (
                      <div className="flex items-center gap-1.5">
                        {(["מורשה", "פטור"] as const).map((status) => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleTaxStatusChange(status)}
                            disabled={savingTaxStatus || status === artistStatus}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                              status === artistStatus
                                ? "border-gray-900 bg-gray-900 text-white"
                                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {artistStatus === "מורשה"
                  ? "עוסק מורשה: תחילה מגישים בקשת תשלום, ולאחר קבלת התשלום — חשבונית מס קבלה"
                  : artistStatus === "פטור"
                    ? "עוסק פטור: מגישים קבלה כמסמך חשבונאי"
                    : "הגשת מסמכים מתבצעת פעם בחודש מהכפתור בראש הטבלה"}
              </p>
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
                <span className="text-slate-600">הושלמו</span>
                <span className="font-semibold text-slate-800">{submittedCount}</span>
              </div>
              {awaitingAccountingCount > 0 && (
                <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span className="text-amber-700">ממתינות לחשבונית מס קבלה</span>
                  <span className="font-semibold text-amber-800">{awaitingAccountingCount}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {!loading && pendingAccountingInvoices.length > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-amber-900">
                  הגשת בקשת תשלום — צריך להגיש חשבונית מס קבלה
                </p>
                <p className="text-sm text-amber-800 mt-1">
                  לכל חודש יש רשומה נפרדת — העלה חשבונית מס קבלה לכל חודש בנפרד (לא מסמך אחד לכמה חודשים).
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-amber-900">
              {pendingAccountingInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white/70 px-3 py-2">
                  <span>{inv.name}</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2"
                    onClick={() => openAccountingModal(inv.id, inv.invoiceNumber || "")}
                  >
                    העלה חשבונית מס קבלה
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

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
              {filtered.length > 0 && selectedMonth !== "all" && awaitingAccountingRegsInMonth.length > 0 && pendingAccountingInvoiceIdForSelectedMonth && (
                <button
                  type="button"
                  onClick={() => {
                    const inv = pendingAccountingInvoiceForSelectedMonth
                      ?? invoices.find((i) => i.id === pendingAccountingInvoiceIdForSelectedMonth);
                    openAccountingModal(
                      pendingAccountingInvoiceIdForSelectedMonth,
                      inv?.invoiceNumber || ""
                    );
                  }}
                  className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
                >
                  העלה חשבונית מס קבלה לחודש
                </button>
              )}
              {filtered.length > 0 && selectedMonth !== "all" && awaitingAccountingRegsInMonth.length === 0 && readyToSubmitCount > 0 && (
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
                  {artistStatus === "מורשה" ? "העלה בקשת תשלום לחודש" : "העלה קבלה לחודש"}
                </button>
              )}
              {showVoluntaryUpload && (
                <button
                  type="button"
                  onClick={openVoluntaryModal}
                  className="btn-secondary inline-flex items-center justify-center gap-2 text-sm"
                >
                  חסר במערכת? העלה {voluntaryDocumentLabel}
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

        {error && !needsTaxStatusPrompt && (
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
          <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500">
              {selectedMonth === "all"
                ? "אין אירועים זכאים לחשבונית בטווח שנבחר"
                : `אין אירועים זכאים לחשבונית ב${monthKeyToLabel(selectedMonth)}`}
            </p>
            {showVoluntaryUpload && (
              <div className="mt-6 max-w-lg mx-auto space-y-4">
                <p className="text-sm text-gray-600 leading-relaxed">
                  במידה וחסר מידע במערכת, מוזמנים להעלות{" "}
                  <span className="font-medium text-gray-800">{voluntaryDocumentLabel}</span>
                  {artistStatus === "מורשה"
                    ? " (ולאחר קבלת התשלום — חשבונית מס קבלה)"
                    : ""}
                  . יש לפרט עבור אילו אירועים מדובר — נבדוק אצלנו.
                </p>
                <button
                  type="button"
                  onClick={openVoluntaryModal}
                  className="btn-primary"
                >
                  העלה {voluntaryDocumentLabel} לבדיקה
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-right border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">מיקום</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">תאריך</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סטטוס נוכחות</th>
                    <th className="px-5 py-3.5 text-xs font-semibold text-gray-600">סטטוס חשבונית</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((reg) => {
                    const regOrderId = String(reg.orderId);
                    const relatedInvoice = resolveInvoiceForRegistration(reg, invoices);
                    const isSubmitted = isRegistrationInvoiceComplete(reg, invoices);
                    const awaitingAccountingDoc = isRegistrationAwaitingAccounting(reg, invoices);
                    const accountingInvoiceId = resolveInvoiceIdForRegistration(reg, invoices);
                    return (
                      <tr key={reg.subitemId} className="hover:bg-gray-50/70 transition-colors">
                        <td className="px-5 py-4 font-medium text-gray-900">{reg.location || reg.orderName || "—"}</td>
                        <td className="px-5 py-4 text-gray-700 tabular-nums">{formatDateDDMMYY(reg.date)}</td>
                        <td className="px-5 py-4">
                          <AttendanceBadge status={reg.attendanceStatus} />
                        </td>
                        <td className="px-5 py-4">
                          {isSubmitted ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                              {SUBITEM_INVOICE_STATUS.SUBMITTED}
                            </span>
                          ) : awaitingAccountingDoc ? (
                            <div className="flex flex-col items-end gap-2">
                              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 max-w-xs text-right leading-snug">
                                {getSubitemInvoiceStatusDisplay(SUBITEM_INVOICE_STATUS.PAYMENT_REQUEST)}
                              </span>
                              {(accountingInvoiceId || reg.linkedInvoiceId) && (
                                <button
                                  type="button"
                                  className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2"
                                  onClick={() => {
                                    const invId = accountingInvoiceId || reg.linkedInvoiceId || "";
                                    const inv = invoices.find((i) => i.id === invId);
                                    openAccountingModal(invId, inv?.invoiceNumber || "");
                                  }}
                                >
                                  העלה חשבונית מס קבלה
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-gray-50 text-gray-600 border border-gray-200">
                              {getSubitemInvoiceStatusDisplay(reg.invoiceStatus)}
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
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">סטטוס מסמך</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-600">פעולה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map((inv) => (
                  (() => {
                    const needsAccountingUpload = isAwaitingAccountingDocument(inv.submissionStatus);
                    return (
                  <tr key={inv.id} className={needsAccountingUpload ? "bg-amber-50/40" : undefined}>
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.name}</td>
                    <td className="px-4 py-3 text-gray-500 tabular-nums">{formatDateDDMMYY(inv.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border max-w-xs text-right leading-snug ${
                        needsAccountingUpload
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-gray-50 text-gray-600 border-gray-200"
                      }`}>
                        {getSubmissionStatusDisplay(inv.submissionStatus || inv.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {needsAccountingUpload ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-blue-700 hover:text-blue-800 underline underline-offset-2"
                          onClick={() => openAccountingModal(inv.id, inv.invoiceNumber || "")}
                        >
                          העלה {followUpAccountingDocument.fileLabel}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showVoluntaryModal && selectedMonth !== "all" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowVoluntaryModal(false)}>
            <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden border border-gray-200 flex flex-col" onClick={(e) => e.stopPropagation()}>
              {submittingInvoice && (
                <div className="absolute inset-0 z-10 bg-white/90 flex flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center">
                  <span className="h-8 w-8 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                  <span className="text-base font-semibold text-gray-800">ההגשה בבדיקה</span>
                  <span className="text-sm text-gray-600">זה עשוי לקחת כ-15 שניות</span>
                </div>
              )}
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">
                  הגשה ידנית — {voluntaryDocumentLabel}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{monthKeyToLabel(selectedMonth)}</p>
                <p className="text-sm text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  חסר מידע במערכת? העלה {voluntaryDocumentLabel}, פרט עבור אילו אירועים מדובר — נבדוק אצלנו.
                </p>
              </div>
              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    עבור אילו אירועים? <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    className="input-field mt-1 min-h-[88px] resize-y"
                    placeholder="לדוגמה: 15/03 — תל אביב, 22/03 — חיפה"
                    value={eventsDescription}
                    onChange={(e) => setEventsDescription(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    סכום להגשה <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input-field mt-1"
                    placeholder="סכום בשקלים"
                    value={voluntaryAmount}
                    onChange={(e) => setVoluntaryAmount(e.target.value)}
                  />
                </label>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <div className="text-sm font-semibold text-gray-800">פרטי בנק</div>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="שם המוטב"
                    value={invoiceForm.beneficiaryName}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, beneficiaryName: e.target.value }))}
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      className="input-field"
                      placeholder="קוד בנק"
                      value={invoiceForm.bankCode}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, bankCode: e.target.value }))}
                    />
                    <input
                      type="text"
                      className="input-field"
                      placeholder="סניף"
                      value={invoiceForm.bankBranch}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, bankBranch: e.target.value }))}
                    />
                    <input
                      type="text"
                      className="input-field"
                      placeholder="חשבון"
                      value={invoiceForm.bankAccount}
                      onChange={(e) => setInvoiceForm((f) => ({ ...f, bankAccount: e.target.value }))}
                    />
                  </div>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">
                    {initialDocumentConfig?.fileLabel ?? "מסמך"} <span className="text-red-500">*</span>
                  </span>
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="mt-2 block w-full text-sm"
                    onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                  />
                </label>
                {invoiceFile && initialDocumentConfig?.extractFromFile && (
                  <input
                    type="text"
                    className="input-field"
                    placeholder="מספר חשבונית / קבלה"
                    value={invoiceForm.invoiceNumber}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
                  />
                )}
                {extractingFile && (
                  <p className="text-sm text-blue-700">מחלץ נתונים מהקובץ...</p>
                )}
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">הערות נוספות</span>
                  <input
                    type="text"
                    className="input-field mt-1"
                    placeholder="אופציונלי"
                    value={invoiceForm.description}
                    onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))}
                  />
                </label>
                <div className="flex gap-2 justify-end pt-2">
                  <button type="button" onClick={() => setShowVoluntaryModal(false)} className="btn-secondary" disabled={submittingInvoice}>
                    ביטול
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={submittingInvoice}
                    onClick={handleSubmitVoluntaryInvoice}
                  >
                    {submittingInvoice ? "שולח..." : `הגש ${voluntaryDocumentLabel} לבדיקה`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showMonthInvoiceModal && filtered.length > 0 && selectedMonth !== "all" && (() => {
          const selectedRegs = filtered
            .filter((r) => monthSelectedOrderIds.has(r.orderId) && canSubmitInvoice(r))
            .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
          const selectedIncomeBySubitemId: Record<string, number> = {};
          let monthTotal = 0;
          for (const reg of selectedRegs) {
            const amount = incomeBySubitemId[reg.subitemId] ?? 0;
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
                  <h3 className="text-lg font-semibold text-gray-900">
                    {initialDocumentConfig?.kind === "payment_request"
                      ? "הגשת בקשת תשלום לחודש"
                      : "הגשת קבלה לחודש"}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">{monthKeyToLabel(selectedMonth)}</p>
                  {initialDocumentConfig && (
                    <p className="text-sm text-blue-700 mt-2">{initialDocumentConfig.fileHint}</p>
                  )}
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                  <ul className="mb-5 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden text-sm">
                    {filtered.map((reg) => {
                      const relatedInvoiceForReg = invoices.find((inv) =>
                        (inv.orderIds || []).some((id) => String(id) === String(reg.orderId))
                      );
                      const alreadyInvoiced =
                        isSubitemInvoiceComplete(reg.invoiceStatus)
                        || isSubitemAwaitingAccounting(reg.invoiceStatus)
                        || Boolean(relatedInvoiceForReg);
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
                      {invoiceFile ? "✓" : "•"} צורף {initialDocumentConfig?.fileLabel ?? "מסמך"}
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
                        {initialDocumentConfig?.fileLabel ?? "מסמך"} <span className="text-red-500">*</span>
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
                            {invoiceFile
                              ? "הקובץ הועלה בהצלחה"
                              : `לחץ/י כאן להעלאת ${initialDocumentConfig?.fileLabel ?? "מסמך"}`}
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
                    {invoiceFile && initialDocumentConfig?.extractFromFile && (
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
                          המערכת בודקת שהסכום בקובץ תואם לסכום להגשה
                        </p>
                      </div>
                    )}
                    {extractedActualAmount != null && (
                      <p className="text-xs text-gray-600">
                        סכום שחולץ מהקובץ: {extractedActualAmount.toLocaleString("he-IL")} ₪
                      </p>
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
                            : initialDocumentConfig?.kind === "payment_request"
                              ? `הגש בקשת תשלום — ${effectiveAmount.toLocaleString("he-IL")} ₪`
                              : `הגש ${initialDocumentConfig?.fileLabel ?? "מסמך"} — ${effectiveAmount.toLocaleString("he-IL")} ₪`}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          );
        })()}
      </main>

      {showAccountingModal && accountingInvoiceId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40">
          <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full border border-gray-200" onClick={(e) => e.stopPropagation()}>
            {submittingAccounting && (
              <div className="absolute inset-0 z-10 bg-white/90 flex flex-col items-center justify-center gap-3 rounded-2xl px-6 text-center">
                <span className="h-8 w-8 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
                <span className="text-base font-semibold text-gray-800">ההגשה בבדיקה</span>
                <span className="text-sm text-gray-600">בודקים את המסמך מול בקשת התשלום — עד כ-15 שניות</span>
                <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800 tabular-nums">
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                  {submittingAccountingSeconds} שניות
                </span>
              </div>
            )}
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">עדכון רשומה — {followUpAccountingDocument.fileLabel}</h3>
              {accountingInvoice && (
                <>
                  <p className="text-sm font-medium text-gray-800 mt-2">{accountingInvoice.name}</p>
                  <p className="text-sm text-amber-800 mt-2">
                    סכום שדווח בבקשת התשלום:{" "}
                    {(accountingInvoice.reportedAmount ?? accountingInvoice.actualAmount ?? accountingInvoice.amount).toLocaleString("he-IL")} ₪
                  </p>
                </>
              )}
              <p className="text-sm text-gray-500 mt-1">{followUpAccountingDocument.fileHint}</p>
            </div>
            <div className="p-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">{followUpAccountingDocument.fileLabel} <span className="text-red-500">*</span></span>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="mt-2 block w-full text-sm"
                  onChange={(e) => handleAccountingFileChange(e.target.files?.[0] ?? null)}
                />
              </label>
              {extractingAccountingFile && (
                <div className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  מחלץ נתונים מהקובץ ובודק התאמה לבקשת התשלום...
                </div>
              )}
              <label className="block">
                <span className="text-sm font-medium text-gray-700">מספר חשבונית / קבלה <span className="text-red-500">*</span></span>
                <input
                  type="text"
                  className="input-field mt-1"
                  placeholder="לדוגמה: 12345"
                  value={accountingInvoiceNumber}
                  onChange={(e) => setAccountingInvoiceNumber(e.target.value)}
                />
              </label>
              {accountingExtractedAmount != null && (
                <p className="text-xs text-gray-600">
                  סכום שחולץ מהקובץ: {accountingExtractedAmount.toLocaleString("he-IL")} ₪
                </p>
              )}
              {accountingValidationError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {accountingValidationError}
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={submittingAccounting}
                  onClick={() => setShowAccountingModal(false)}
                >
                  ביטול
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={submittingAccounting || !accountingFile || !accountingInvoiceNumber.trim() || Boolean(accountingValidationError)}
                  onClick={handleSubmitAccountingDocument}
                >
                  {submittingAccounting ? "מעדכן..." : `עדכן רשומה — ${followUpAccountingDocument.fileLabel}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {needsTaxStatusPrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tax-status-prompt-title"
          >
            <h2 id="tax-status-prompt-title" className="text-xl font-bold text-gray-900 mb-2">
              סוג עוסק
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              לפני המשך להגשת חשבוניות, יש לבחור את סוג העוסק שלך:
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => handleTaxStatusChange("פטור")}
                disabled={savingTaxStatus}
                className="btn-primary w-full py-3 text-base disabled:opacity-50"
              >
                {savingTaxStatus ? "שומר..." : "עוסק פטור"}
              </button>
              <button
                type="button"
                onClick={() => handleTaxStatusChange("מורשה")}
                disabled={savingTaxStatus}
                className="btn-secondary w-full py-3 text-base disabled:opacity-50"
              >
                {savingTaxStatus ? "שומר..." : "עוסק מורשה"}
              </button>
            </div>
            {error && (
              <p className="mt-4 text-sm text-red-600 text-center">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
