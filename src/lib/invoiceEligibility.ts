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
}

export function isInvoiceStatusEligible(input: InvoiceEligibilityInput): boolean {
  const candidacyStatus = input.candidacyStatus?.trim() || "";
  const attendanceStatus = input.attendanceStatus?.trim() || "";

  if (candidacyStatus !== "מאושר") return false;
  if (attendanceStatus === "נדחה") return false;

  return attendanceStatus === "" || attendanceStatus === "מאושר";
}

export function canSubmitInvoice(input: InvoiceEligibilityInput): boolean {
  const invoiceStatus = input.invoiceStatus?.trim() || "";
  return isInvoiceStatusEligible(input) && !isSubitemInvoiceBlocked(invoiceStatus);
}
