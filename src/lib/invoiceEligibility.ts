import { isSubitemInvoiceBlocked } from "@/lib/invoiceDocuments";

export const INVOICE_MONTH_NOT_CLOSED_ERROR =
  "ניתן להגיש חשבונית לחודש רק לאחר סיום החודש";

export function parseInvoiceMonthKey(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

export function isInvoiceMonthClosedForSubmission(
  monthKey: string,
  now: Date = new Date()
): boolean {
  const match = monthKey.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  const firstDayOfNextMonth = new Date(year, month, 1);
  return now >= firstDayOfNextMonth;
}

export function getLatestClosedMonthKey(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** תנאי התשלום של המערכת: שוטף +60 מסוף חודש האירועים */
export const PAYMENT_TERMS_DAYS = 60;

/**
 * שוטף +60: בקשת תשלום נחשבת ששולמה כשעברו 60 יום מסוף חודש האירועים.
 * מקבלת תאריך חשבונית (YYYY-MM-DD או מפתח חודש YYYY-MM).
 */
export function isPaymentRequestConsideredPaid(
  invoiceDate: string,
  now: Date = new Date()
): boolean {
  const monthKey = parseInvoiceMonthKey(invoiceDate);
  const match = monthKey.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  // new Date(year, month, 0) — היום האחרון של חודש האירועים
  const paidFrom = new Date(year, month, 0);
  paidFrom.setDate(paidFrom.getDate() + PAYMENT_TERMS_DAYS);
  return now >= paidFrom;
}

export function getInvoiceMonthSubmissionError(
  monthKey: string,
  now: Date = new Date()
): string | null {
  if (!parseInvoiceMonthKey(monthKey)) {
    return "חסר חודש להגשה";
  }
  if (!isInvoiceMonthClosedForSubmission(monthKey, now)) {
    return INVOICE_MONTH_NOT_CLOSED_ERROR;
  }
  return null;
}

export interface InvoiceEligibilityInput {
  candidacyStatus?: string | null;
  attendanceStatus?: string | null;
  invoiceStatus?: string | null;
  /**
   * האם קיימת בלוח החשבוניות רשומה עבור ההרשמה הזו.
   * false = הסטטוס "הוגשה" על הסאב-אייטם הוא שריד של חשבונית שנמחקה — החודש פתוח להגשה מחדש.
   * undefined = לא נבדק — הסטטוס לבדו חוסם (ההתנהגות הישנה).
   */
  hasExistingInvoice?: boolean;
}

/**
 * לוח החשבוניות הוא מקור האמת: סטטוס "הוגשה" על הסאב-אייטם חוסם רק כל עוד
 * החשבונית שעבורה נכתב עדיין קיימת. מחיקה של החשבונית מהלוח פותחת את ההגשה מחדש.
 */
export function isSubitemInvoiceEffectivelyBlocked(
  invoiceStatus: string | null | undefined,
  hasExistingInvoice?: boolean
): boolean {
  if (!isSubitemInvoiceBlocked(invoiceStatus?.trim() || "")) return false;
  return hasExistingInvoice !== false;
}

export function isInvoiceStatusEligible(input: InvoiceEligibilityInput): boolean {
  const candidacyStatus = input.candidacyStatus?.trim() || "";
  const attendanceStatus = input.attendanceStatus?.trim() || "";

  if (candidacyStatus !== "מאושר") return false;
  if (attendanceStatus === "נדחה") return false;

  return attendanceStatus === "" || attendanceStatus === "מאושר";
}

export function canSubmitInvoice(input: InvoiceEligibilityInput): boolean {
  return (
    isInvoiceStatusEligible(input) &&
    !isSubitemInvoiceEffectivelyBlocked(input.invoiceStatus, input.hasExistingInvoice)
  );
}
