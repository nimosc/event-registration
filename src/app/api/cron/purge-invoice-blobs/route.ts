import { NextRequest, NextResponse } from "next/server";
import { del, list } from "@vercel/blob";
import { INVOICE_BLOB_PREFIX } from "@/lib/blobPaths";
import { getAllPendingInvoiceBlobUrls } from "@/lib/monday";

export const maxDuration = 60;

/** blob שלא צורף תוך שבוע — האומן זנח את הטופס או שהכשל לא תוקן; לא שומרים מסמכים פיננסיים מעבר לזה */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ניקוי לילי (Vercel Cron) של קבצי חשבונית יתומים ב-Blob.
 * לא נוגע ב-blobs שרשומים כ"קובץ ממתין" על רשומה — אותם ניסיון חוזר עדיין צריך.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const pending = await getAllPendingInvoiceBlobUrls();
  const cutoff = Date.now() - MAX_AGE_MS;
  const toDelete: string[] = [];
  let scanned = 0;
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: INVOICE_BLOB_PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      scanned++;
      if (pending.has(blob.url)) continue;
      if (new Date(blob.uploadedAt).getTime() < cutoff) toDelete.push(blob.url);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  if (toDelete.length > 0) await del(toDelete);
  console.log(`[purge-invoice-blobs] scanned=${scanned} pending=${pending.size} deleted=${toDelete.length}`);
  return NextResponse.json({ scanned, pending: pending.size, deleted: toDelete.length });
}
