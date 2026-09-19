/**
 * תוכן עמודת "קובץ ממתין (URL)" בלוח החשבוניות.
 *
 * כשצירוף קובץ ל-Monday נכשל אחרי שהרשומה כבר נוצרה, שומרים כאן מספיק מידע
 * כדי שניסיון חוזר (/api/invoices/retry-file) ידע מה לעשות בלי לשאול את
 * האומן: איזה blob, לאילו עמודות קובץ, ואיזה סטטוס הגשה לקבוע אחרי ההצלחה.
 */
export interface PendingBlob {
  url: string;
  /** עמודות הקובץ שאליהן צריך לצרף */
  columns: string[];
  /** סטטוס הגשה לקבוע אחרי צירוף מוצלח (למסמך חשבונאי) */
  thenSubmissionStatus?: string;
}

export function serializePendingBlob(pending: PendingBlob): string {
  return JSON.stringify(pending);
}

/** מקבל גם URL גולמי (תאימות) — אז אין עמודות ידועות. */
export function parsePendingBlob(text: string | null | undefined): PendingBlob | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<PendingBlob>;
      if (typeof parsed.url === "string" && parsed.url) {
        return {
          url: parsed.url,
          columns: Array.isArray(parsed.columns) ? parsed.columns.map(String) : [],
          thenSubmissionStatus: parsed.thenSubmissionStatus || undefined,
        };
      }
    } catch {
      return null;
    }
    return null;
  }
  return { url: raw, columns: [] };
}
