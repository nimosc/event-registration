/**
 * נתיבי קבצי חשבונית ב-Vercel Blob — לוגיקה טהורה, משותפת ללקוח ולשרת.
 *
 * הלקוח בונה כאן את ה-pathname לפני ההעלאה; השרת מאמת בעזרת אותן פונקציות
 * שה-blob שהוגש שייך לאומן המחובר. אין כאן שום תלות ב-@vercel/blob כדי
 * שהמודול ייטען גם בדפדפן.
 */

export const INVOICE_BLOB_PREFIX = "invoices/";
/** גבול סביר לחשבונית; רחוק בסדר גודל מהקבצים בפועל (מקסימום שנצפה 3.7MB). */
export const INVOICE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const INVOICE_ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

/** שומר אותיות (כולל עברית), ספרות, נקודה, מקף וקו תחתון; כל השאר → "_". */
export function sanitizeFilename(name: string): string {
  const cleaned = (name || "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return cleaned || "file";
}

/** `invoices/<artistId>/<uuid>-<safe-name>` — ה-uuid מונע ניחוש והתנגשויות. */
export function buildInvoiceBlobPathname(artistId: string, filename: string): string {
  return `${INVOICE_BLOB_PREFIX}${artistId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;
}

export function blobPathnameBelongsToArtist(pathname: string, artistId: string): boolean {
  return pathname.startsWith(`${INVOICE_BLOB_PREFIX}${artistId}/`);
}

/** מחלץ pathname מ-URL של blob; null אם ה-URL לא תקין. */
export function blobUrlToPathname(blobUrl: string): string | null {
  try {
    return decodeURIComponent(new URL(blobUrl).pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

/** משחזר את שם הקובץ המקורי (אחרי ה-uuid) מתוך ה-pathname. */
export function originalFilenameFromPathname(pathname: string): string {
  const last = pathname.split("/").pop() || "";
  return last.replace(/^[0-9a-f-]{36}-/i, "") || "file";
}
