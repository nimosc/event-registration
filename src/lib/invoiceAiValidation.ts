import { extractInvoiceData, isInvoiceExtractAvailable } from "@/lib/invoiceExtract";
import type { ExtractedInvoiceFields } from "@/lib/invoiceValidation";
export {
  invoiceAmountsMatch,
  invoiceNumbersMatch,
  validateExtractedAgainstExpected,
} from "@/lib/invoiceValidation";

export async function extractInvoiceDataWithTimeout(
  file: File,
  timeoutMs = 12000
): Promise<ExtractedInvoiceFields | null> {
  if (!isInvoiceExtractAvailable()) return null;
  try {
    return await Promise.race([
      extractInvoiceData(file),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}
