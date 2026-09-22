/**
 * החלטת "חריג / לא חריג" לבקשת תשלום ברגע ההגשה.
 *
 * לא חריג → סטטוס תשלום "העבר לתשלום" אוטומטית.
 * חריג → נשאר "בבדיקה", והסיבות נכתבות כאפדייט על הרשומה כדי שהמנהל ידע
 * מה לבדוק. ההחלטה נקבעת פעם אחת, ביצירה; אחר כך הסטטוס בידי המנהלים.
 *
 * מודול טהור — אין תלות ב-Monday, כדי שאפשר יהיה לבדוק אותו בנפרד.
 */
import { INVOICE_MATCH_STATUS, INVOICE_SUBMISSION_TYPE } from "./invoiceDocuments";
import { invoiceAmountsMatch } from "./invoiceValidation";

export interface InvoiceReviewInput {
  submissionType: string;
  matchStatus: string;
  /** הסכום שהמערכת חישבה מהאירועים (0 בהגשה ידנית) */
  expectedAmount: number;
  /** הסכום שהאומן דיווח */
  reportedAmount: number;
  amountNote: string;
  fileAttached: boolean;
  /** פרטי הבנק בהגשה שונים ממה ששמור על האומן (או שלא היו שמורים) */
  bankDetailsChanged: boolean;
}

export interface InvoiceReviewDecision {
  exceptional: boolean;
  /** סיבות בעברית, מוכנות להצגה למנהל. ריק כשלא חריג. */
  reasons: string[];
}

const formatIls = (n: number) => `${n.toLocaleString("he-IL")} ₪`;

export function decideInvoiceReview(input: InvoiceReviewInput): InvoiceReviewDecision {
  const reasons: string[] = [];

  if (input.submissionType === INVOICE_SUBMISSION_TYPE.REVIEW) {
    reasons.push("הגשה ידנית (\"חסר במערכת\") — אין אירועים במערכת לאמת מולם את הסכום");
  }

  if (
    input.submissionType !== INVOICE_SUBMISSION_TYPE.REVIEW &&
    !invoiceAmountsMatch(input.reportedAmount, input.expectedAmount)
  ) {
    const note = input.amountNote.trim();
    reasons.push(
      `הסכום שדווח (${formatIls(input.reportedAmount)}) שונה מהסכום המחושב (${formatIls(input.expectedAmount)})` +
        (note ? ` — סיבת האומן: ${note}` : "")
    );
  }

  if (input.matchStatus === INVOICE_MATCH_STATUS.NEEDS_REVIEW) {
    reasons.push("סוג המסמך לא אומת אוטומטית (חילוץ ה-AI לא היה זמין) — יש לוודא שזו בקשת תשלום");
  }

  if (!input.fileAttached) {
    reasons.push("הקובץ לא צורף לרשומה ב-Monday — אין מסמך לבדוק");
  }

  if (input.bankDetailsChanged) {
    reasons.push("פרטי הבנק בהגשה שונים מהפרטים השמורים על האומן (או שלא היו שמורים) — יש לאמת לפני העברה");
  }

  return { exceptional: reasons.length > 0, reasons };
}

/** טקסט האפדייט שנכתב על הרשומה ב-Monday */
export function formatInvoiceReviewUpdate(decision: InvoiceReviewDecision): string {
  if (!decision.exceptional) {
    return "✅ אושר אוטומטית לתשלום — כל הבדיקות עברו (סוג הגשה חודשי, סכום תואם למחושב, סוג מסמך אומת, קובץ מצורף, פרטי בנק ללא שינוי).";
  }
  return [
    "⚠️ נשאר בבדיקה — נדרשת בדיקת מנהל לפני העברה לתשלום:",
    ...decision.reasons.map((r) => `• ${r}`),
    "",
    "לאחר הבדיקה, העבירו את סטטוס התשלום ל\"העבר לתשלום\".",
  ].join("\n");
}
