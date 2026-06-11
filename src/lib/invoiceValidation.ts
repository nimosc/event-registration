export function invoiceAmountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.009;
}

export function normalizeDocNumber(value: string): string {
  return value.replace(/\s+/g, "").replace(/[^\dA-Za-zא-ת\-/]/g, "").toLowerCase();
}

export function invoiceNumbersMatch(a: string, b: string): boolean {
  const na = normalizeDocNumber(a);
  const nb = normalizeDocNumber(b);
  if (!na || !nb) return true;
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

export interface ExtractedInvoiceFields {
  receiptNumber: string | null;
  amount: number | null;
  description?: string | null;
}

export function validateExtractedAgainstExpected(params: {
  extracted: ExtractedInvoiceFields | null;
  expectedAmount: number;
  declaredNumber?: string;
  requireAmountWhenExtracted?: boolean;
  requireNumberWhenBothPresent?: boolean;
}): string | null {
  const {
    extracted,
    expectedAmount,
    declaredNumber,
    requireAmountWhenExtracted = true,
    requireNumberWhenBothPresent = true,
  } = params;

  if (!extracted) return null;

  if (
    requireAmountWhenExtracted &&
    extracted.amount != null &&
    !invoiceAmountsMatch(extracted.amount, expectedAmount)
  ) {
    return `הסכום בקובץ (${extracted.amount.toLocaleString("he-IL")} ₪) אינו תואם לסכום שהוצהר (${expectedAmount.toLocaleString("he-IL")} ₪)`;
  }

  if (
    requireNumberWhenBothPresent &&
    declaredNumber?.trim() &&
    extracted.receiptNumber?.trim() &&
    !invoiceNumbersMatch(declaredNumber, extracted.receiptNumber)
  ) {
    return `מספר המסמך בקובץ (${extracted.receiptNumber}) אינו תואם למספר שהוזן (${declaredNumber.trim()})`;
  }

  return null;
}
