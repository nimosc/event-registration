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

export type InvoiceSubmissionStatus =
  (typeof INVOICE_SUBMISSION_STATUS)[keyof typeof INVOICE_SUBMISSION_STATUS];

export type InitialInvoiceDocumentKind = "accounting" | "payment_request";

export function getInitialDocumentForTaxStatus(taxStatus: ArtistTaxStatus) {
  if (taxStatus === "פטור") {
    return {
      kind: "accounting" as const,
      fileLabel: "קבלה",
      fileHint: "עוסק פטור מגיש קבלה כמסמך חשבונאי",
      submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
      subitemInvoiceStatus: SUBITEM_INVOICE_STATUS.SUBMITTED,
      extractFromFile: true,
    };
  }

  return {
    kind: "payment_request" as const,
    fileLabel: "בקשת תשלום",
    fileHint: "עוסק מורשה מגיש תחילה בקשת תשלום. לאחר קבלת התשלום יש להעלות חשבונית מס קבלה",
    submissionStatus: INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST,
    subitemInvoiceStatus: SUBITEM_INVOICE_STATUS.PAYMENT_REQUEST,
    extractFromFile: true,
  };
}

export function getFollowUpAccountingDocument() {
  return {
    fileLabel: "חשבונית מס קבלה",
    fileHint: "לאחר קבלת התשלום, העלה את חשבונית המס קבלה לחודש הרלוונטי — הרשומה הקיימת תתעדכן",
    submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
    extractFromFile: true,
    validateAgainstPaymentRequest: true,
  };
}

export function getSubmissionStatusDisplay(status: string): string {
  if (status === INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST) {
    return "הגשת בקשת תשלום — צריך להגיש חשבונית מס קבלה";
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
    return "הגשת בקשת תשלום — צריך להגיש חשבונית מס קבלה";
  }
  if (isSubitemInvoiceComplete(status)) {
    return SUBITEM_INVOICE_STATUS.SUBMITTED;
  }
  if (status.trim() === SUBITEM_INVOICE_STATUS.NOT_SUBMITTED) {
    return "טרם הוגשה";
  }
  return status.trim() || "טרם הוגשה";
}
