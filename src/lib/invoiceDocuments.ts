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
    return "הגשת בקשת תשלום — צריך להגיש מסמך חשבונאי";
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

export function getSubitemInvoiceStatusDisplay(status: string): string {
  if (isSubitemAwaitingAccounting(status)) {
    return "הגשת בקשת תשלום — צריך להגיש מסמך חשבונאי";
  }
  if (isSubitemInvoiceComplete(status)) {
    return SUBITEM_INVOICE_STATUS.SUBMITTED;
  }
  if (status.trim() === SUBITEM_INVOICE_STATUS.NOT_SUBMITTED) {
    return "טרם הוגשה";
  }
  return status.trim() || "טרם הוגשה";
}
