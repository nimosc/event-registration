import Anthropic from "@anthropic-ai/sdk";
import type { DocumentBlockParam, ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { DocumentClassification } from "@/lib/invoiceValidation";

/**
 * סיווג סוג המסמך (DocumentClassification, מוגדר ב-invoiceValidation):
 * - "receipt": קבלה / חשבונית מס קבלה (הוכחת תשלום)
 * - "payment_request": חשבון עסקה / חשבונית / חשבונית מס (דרישת תשלום)
 * - "other": לא נראה כמסמך פיננסי מהסוגים האלה
 */
export interface ExtractedInvoiceData {
  receiptNumber: string | null;
  amount: number | null;
  description: string | null;
  documentType: DocumentClassification | null;
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  // Extraction hits transient 529 "overloaded" errors; retry a bit more than the
  // SDK default (2) with its built-in exponential backoff to ride out short spikes.
  return new Anthropic({ apiKey, maxRetries: 4 });
}

function resolveMediaType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.includes("jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.includes("jpg")) return "image/jpeg";
  if (name.includes("png")) return "image/png";
  return "image/jpeg";
}

export function isInvoiceExtractAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function extractInvoiceData(file: File): Promise<ExtractedInvoiceData> {
  const client = getAnthropicClient();
  if (!client) {
    return { receiptNumber: null, amount: null, description: null, documentType: null };
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = resolveMediaType(file);

  const textBlock: TextBlockParam = {
    type: "text",
    text: `You are analyzing an Israeli financial document. Extract the following fields:
1. receiptNumber: the invoice/receipt number or ID
2. amount: the total amount (as a number, no currency symbol)
3. description: a short 1-sentence description of what the document is for (in Hebrew if the document is in Hebrew)
4. documentTitle: the EXACT main title/header text that names the document TYPE — copy it verbatim from the most prominent heading. In Israeli documents this is one of: "קבלה", "חשבונית מס קבלה", "חשבונית מס", "חשבונית", "חשבון עסקה", "דרישת תשלום", "הצעת מחיר". Copy ONLY the type heading, not the business name. null if there is no such heading.
5. isFinancialDocument: true if this is an invoice/receipt/payment-demand type document; false for anything else (a random photo, a blank page, a bank statement, an ID, etc.).

Return ONLY a valid JSON object:
{
  "receiptNumber": "<string or null>",
  "amount": <number or null>,
  "description": "<string or null>",
  "documentTitle": "<string or null>",
  "isFinancialDocument": <true or false>
}`,
  };

  let contentBlock: ImageBlockParam | DocumentBlockParam;
  if (mediaType.startsWith("image/")) {
    contentBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: base64,
      },
    };
  } else {
    contentBlock = {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64,
      },
    };
  }

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: [contentBlock, textBlock] }],
  });

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { receiptNumber: null, amount: null, description: null, documentType: null };

  const parsed = JSON.parse(match[0]);
  return {
    receiptNumber: parsed.receiptNumber ?? null,
    amount: parsed.amount != null ? Number(parsed.amount) : null,
    description: parsed.description ?? null,
    documentType: classifyDocument(parsed.documentTitle, parsed.isFinancialDocument),
  };
}

/**
 * סיווג דטרמיניסטי מתוך כותרת המסמך — לא מסתמכים על שיפוט הוליסטי של המודל,
 * שנוטה לתייג כל מסמך עם סכום כ"קבלה". הכלל: "מה שחשוב זה הקבלה" —
 * receipt רק אם הכותרת מכילה במפורש "קבלה"; בכל מקרה מעורפל → לא קבלה.
 */
export function classifyDocument(
  documentTitle: unknown,
  isFinancialDocument: unknown
): DocumentClassification | null {
  const title = typeof documentTitle === "string" ? documentTitle.trim() : "";

  // "קבלה" בכותרת (כולל "חשבונית מס קבלה") → קבלה. נבדק ראשון.
  if (title.includes("קבלה")) return "receipt";

  // כותרות מזוהות של בקשת תשלום.
  if (/חשבון\s*עסקה|חשבונית|דרישת\s*תשלום|הצעת\s*מחיר|פרופורמה|proforma|invoice/i.test(title)) {
    return "payment_request";
  }

  // אין כותרת מזוהה: אם המודל אומר שזה לא מסמך פיננסי → other.
  if (isFinancialDocument === false) return "other";

  // מסמך פיננסי עם כותרת לא ברורה → ברירת מחדל ללא-קבלה (מגן על דרישת הקבלה).
  if (isFinancialDocument === true) return "payment_request";

  // אין שום אות ודאי → חסר סיווג (fail-open בהמשך הזרימה).
  return null;
}
