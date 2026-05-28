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
  return isInvoiceStatusEligible(input) && (input.invoiceStatus?.trim() || "") !== "הוגשה";
}
