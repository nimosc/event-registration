"use client";

/**
 * העלאת קובץ חשבונית מהדפדפן ישירות ל-Vercel Blob.
 *
 * הקובץ לא עובר דרך פונקציית שרת: השרת רק מנפיק טוקן חתום
 * (/api/invoices/upload-token), והדפדפן מעלה בעצמו — כולל multipart לקבצים
 * גדולים — ומקבל URL. את ה-URL הזה שולחים אחר כך ל-/extract ולהגשה.
 */
import { upload } from "@vercel/blob/client";
import { buildInvoiceBlobPathname, INVOICE_MAX_UPLOAD_BYTES } from "./blobPaths";

const MULTIPART_THRESHOLD_BYTES = 5 * 1024 * 1024;

export async function uploadInvoiceFileToBlob(
  artistId: string,
  file: File,
  onProgress?: (percentage: number) => void
): Promise<string> {
  if (file.size > INVOICE_MAX_UPLOAD_BYTES) {
    throw new Error(`הקובץ גדול מדי (מעל ${Math.round(INVOICE_MAX_UPLOAD_BYTES / 1048576)}MB)`);
  }
  const result = await upload(buildInvoiceBlobPathname(artistId, file.name), file, {
    access: "private",
    handleUploadUrl: "/api/invoices/upload-token",
    contentType: file.type || undefined,
    multipart: file.size > MULTIPART_THRESHOLD_BYTES,
    onUploadProgress: onProgress ? ({ percentage }) => onProgress(percentage) : undefined,
  });
  return result.url;
}

/** הודעה למשתמש על כשל העלאה — בלי "שגיאת רשת" גנרי. */
export function describeUploadError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (/גדול מדי/.test(message)) return message;
  if (/401|לא מורשה/.test(message)) return "פג תוקף ההתחברות — רענן את הדף והתחבר שוב";
  return "העלאת הקובץ נכשלה — בדוק את החיבור ונסה שוב";
}
