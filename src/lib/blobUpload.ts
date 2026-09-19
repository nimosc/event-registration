/**
 * צד השרת של העלאת קבצי חשבונית דרך Vercel Blob (store פרטי).
 *
 * הזרימה: הלקוח מעלה ישירות ל-Blob (טוקן חתום מ-/api/invoices/upload-token),
 * ושולח לשרת רק את ה-URL. כאן מורידים את הקובץ כדי לחלץ ממנו נתונים ולצרף
 * אותו ל-Monday, ומוחקים אותו כשהצירוף הצליח.
 */
import { del, get } from "@vercel/blob";
import {
  blobPathnameBelongsToArtist,
  blobUrlToPathname,
  originalFilenameFromPathname,
} from "./blobPaths";

/** ה-URL לא שייך לאומן המחובר (או לא תקין) */
export class BlobAccessError extends Error {
  constructor() {
    super("הקובץ אינו שייך למשתמש המחובר");
    this.name = "BlobAccessError";
  }
}

/** ה-blob נמחק או פג — האומן צריך לצרף את הקובץ מחדש */
export class BlobNotFoundError extends Error {
  constructor() {
    super("הקובץ לא נמצא — צרף אותו שוב");
    this.name = "BlobNotFoundError";
  }
}

/**
 * מוריד blob של חשבונית כ-File עם השם המקורי. זורק BlobAccessError אם ה-URL
 * אינו תחת התיקייה של האומן, ו-BlobNotFoundError אם הוא כבר לא קיים.
 */
export async function downloadInvoiceBlob(blobUrl: string, artistId: string): Promise<File> {
  const pathname = blobUrlToPathname(blobUrl);
  if (!pathname || !blobPathnameBelongsToArtist(pathname, artistId)) {
    throw new BlobAccessError();
  }

  const result = await get(blobUrl, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new BlobNotFoundError();

  const bytes = await new Response(result.stream).arrayBuffer();
  const filename = originalFilenameFromPathname(result.blob.pathname || pathname);
  return new File([bytes], filename, { type: result.blob.contentType || undefined });
}

/** מחיקה שלא מפילה את הזרימה — כשל נרשם ללוג וה-cron הלילי ינקה. */
export async function deleteInvoiceBlobQuietly(blobUrl: string): Promise<void> {
  try {
    await del(blobUrl);
  } catch (err) {
    console.error(`[blob] delete failed for ${blobUrl}:`, err);
  }
}
