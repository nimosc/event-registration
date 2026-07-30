import type { DocumentClassification } from "@/lib/invoiceValidation";

export type ArtistTaxStatus = "מורשה" | "פטור";

export const INVOICE_SUBMISSION_STATUS = {
  PAYMENT_REQUEST: "הוגשה בקשת תשלום",
  ACCOUNTING: "הוגש מסמך חשבונאי",
} as const;

/** Subitem column color_mm3pd8vf (חשבונית) */
export const SUBITEM_INVOICE_STATUS = {
  NOT_SUBMITTED: "לא הוגשה",
  PAYMENT_REQUEST: "הוגשה בקשת תשלום",
  SUBMITTED: "הוגשה",
} as const;

/** Invoice board column "סוג הגשה" */
export const INVOICE_SUBMISSION_TYPE = {
  MONTHLY: "בקשת תשלום חודשית",
  REVIEW: "בקשה לבדיקה",
} as const;

/** Invoice board column "סטטוס התאמה" */
export const INVOICE_MATCH_STATUS = {
  OK: "תקין",
  REQUEST_DIFFERENT: "בקשת תשלום שונה",
  RECEIPT_DIFFERENT: "קבלה שונה מהבקשת תשלום",
  /** ההגשה עברה בלי אימות סוג מסמך (חילוץ AI לא היה זמין) — למנהל לבדוק */
  NEEDS_REVIEW: "לבדיקה",
} as const;

export type InvoiceSubmissionStatus =
  (typeof INVOICE_SUBMISSION_STATUS)[keyof typeof INVOICE_SUBMISSION_STATUS];

export type InitialInvoiceDocumentKind = "accounting" | "payment_request";

/** מסמך חשבונאי לפי סוג עוסק: עוסק פטור — קבלה, עוסק מורשה — חשבונית מס קבלה */
export function getAccountingDocumentLabel(taxStatus: ArtistTaxStatus): string {
  return taxStatus === "פטור" ? "קבלה" : "חשבונית מס קבלה";
}

export function getInitialDocumentForTaxStatus(taxStatus: ArtistTaxStatus) {
  const accountingLabel = getAccountingDocumentLabel(taxStatus);
  return {
    kind: "payment_request" as const,
    fileLabel: "בקשת תשלום",
    fileHint: `תחילה מגישים בקשת תשלום. לאחר קבלת התשלום יש להעלות ${accountingLabel}`,
    submissionStatus: INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST,
    subitemInvoiceStatus: SUBITEM_INVOICE_STATUS.PAYMENT_REQUEST,
    extractFromFile: true,
  };
}

export function getFollowUpAccountingDocument(taxStatus: ArtistTaxStatus) {
  const accountingLabel = getAccountingDocumentLabel(taxStatus);
  return {
    fileLabel: accountingLabel,
    fileHint: `לאחר קבלת התשלום, העלה את ${accountingLabel} לחודש הרלוונטי — הרשומה הקיימת תתעדכן`,
    submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
    extractFromFile: true,
    validateAgainstPaymentRequest: true,
  };
}

export function getSubmissionStatusDisplay(status: string): string {
  if (status === INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST) {
    return "התקבלה בהצלחה בקשת התשלום — לאחר קבלת התשלום יש להעלות מסמך חשבונאי";
  }
  if (status === INVOICE_SUBMISSION_STATUS.ACCOUNTING) {
    return "הוגש מסמך חשבונאי";
  }
  return status || "ממתין";
}

export function isAwaitingAccountingDocument(status: string): boolean {
  return status === INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST;
}

export function isInvoiceSubmissionComplete(status: string): boolean {
  return status.trim() === INVOICE_SUBMISSION_STATUS.ACCOUNTING;
}

export function isSubitemInvoiceComplete(status: string): boolean {
  const normalized = status.trim();
  return normalized === SUBITEM_INVOICE_STATUS.SUBMITTED;
}

export function isSubitemAwaitingAccounting(status: string): boolean {
  return status.trim() === SUBITEM_INVOICE_STATUS.PAYMENT_REQUEST;
}

export function isSubitemInvoiceBlocked(status: string): boolean {
  return isSubitemInvoiceComplete(status) || isSubitemAwaitingAccounting(status);
}

/**
 * תוצאת אימות סוג המסמך מול השלב הנוכחי.
 * - ok=false → לחסום עם `error`.
 * - fillBothColumns → העלו קבלה בשלב בקשת תשלום: לשים בשתי העמודות ולהמשיך.
 * - needsReview → אין סיווג (חילוץ AI לא זמין): fail-open, לסמן "לבדיקה".
 */
export interface DocumentTypeCheck {
  ok: boolean;
  error?: string;
  fillBothColumns?: boolean;
  needsReview?: boolean;
}

const NOT_A_DOCUMENT_ERROR = "המסמך שהועלה אינו נראה כבקשת תשלום או קבלה. יש להעלות מסמך תקין.";

/**
 * שלב 1 — מצופה בקשת תשלום.
 * receipt → מקובל וממלא את שתי העמודות. payment_request → זרימה רגילה.
 * other → נחסם. סיווג חסר (null) → fail-open עם סימון לבדיקה.
 */
export function checkDocumentTypeForPaymentRequest(
  docType: DocumentClassification | null | undefined
): DocumentTypeCheck {
  if (docType == null) return { ok: true, needsReview: true };
  if (docType === "other") return { ok: false, error: NOT_A_DOCUMENT_ERROR };
  if (docType === "receipt") return { ok: true, fillBothColumns: true };
  return { ok: true };
}

/**
 * שלב 2 — מצופה מסמך חשבונאי (קבלה / חשבונית מס קבלה).
 * receipt → זרימה רגילה. payment_request → נחסם עם הודעה מותאמת.
 * other → נחסם. סיווג חסר (null) → fail-open עם סימון לבדיקה.
 */
export function checkDocumentTypeForAccounting(
  docType: DocumentClassification | null | undefined,
  accountingLabel: string
): DocumentTypeCheck {
  if (docType == null) return { ok: true, needsReview: true };
  if (docType === "payment_request") {
    return { ok: false, error: `העלית בקשת תשלום — יש להעלות ${accountingLabel}` };
  }
  if (docType === "other") return { ok: false, error: NOT_A_DOCUMENT_ERROR };
  return { ok: true };
}

export function getSubitemInvoiceStatusDisplay(status: string): string {
  if (isSubitemAwaitingAccounting(status)) {
    return "התקבלה בהצלחה בקשת התשלום — לאחר קבלת התשלום יש להעלות מסמך חשבונאי";
  }
  if (isSubitemInvoiceComplete(status)) {
    return SUBITEM_INVOICE_STATUS.SUBMITTED;
  }
  if (status.trim() === SUBITEM_INVOICE_STATUS.NOT_SUBMITTED) {
    return "טרם הוגשה";
  }
  return status.trim() || "טרם הוגשה";
}
