import { NextRequest, NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import {
  attachInvoiceFileWithRetry,
  getInvoiceItemForArtist,
  setInvoiceFileState,
  updateInvoiceSubmissionStatus,
  INVOICE_FILE_STATUS,
} from "@/lib/monday";
import { BlobAccessError, BlobNotFoundError, deleteInvoiceBlobQuietly, downloadInvoiceBlob } from "@/lib/blobUpload";
import { parsePendingBlob } from "@/lib/invoicePendingBlob";

export const maxDuration = 60;

/**
 * ניסיון חוזר לצרף ל-Monday קובץ שההגשה שלו נקלטה אבל הצירוף נכשל
 * (סטטוס קובץ = "קובץ חסר"). ה-blob עדיין שמור — האומן לא צריך להעלות שוב.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { invoiceId?: string };
    const invoiceId = String(body.invoiceId ?? "").trim();
    if (!invoiceId) return NextResponse.json({ error: "חסר מזהה חשבונית" }, { status: 400 });

    const invoice = await getInvoiceItemForArtist(invoiceId, session.id);
    if (!invoice) return NextResponse.json({ error: "הרשומה לא נמצאה" }, { status: 404 });

    // כבר מצורף — אין מה לעשות (בטוח ללחוץ פעמיים)
    if (invoice.fileStatus !== INVOICE_FILE_STATUS.MISSING) {
      return NextResponse.json({ success: true, invoiceId, fileAttached: true });
    }

    const pending = parsePendingBlob(invoice.pendingBlobUrl);
    if (!pending || pending.columns.length === 0) {
      return NextResponse.json(
        { error: "לא נמצא קובץ ממתין לרשומה הזו — יש להגיש מחדש" },
        { status: 400 }
      );
    }

    let file: File;
    try {
      file = await downloadInvoiceBlob(pending.url, session.id);
    } catch (err) {
      if (err instanceof BlobAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
      if (err instanceof BlobNotFoundError) {
        return NextResponse.json({ error: "הקובץ הממתין כבר לא זמין — יש להגיש מחדש" }, { status: 400 });
      }
      throw err;
    }

    try {
      await attachInvoiceFileWithRetry(invoiceId, pending.columns, file, file.name);
    } catch (err) {
      console.error(`[invoice ${invoiceId}] retry attach failed:`, err);
      return NextResponse.json(
        { error: "צירוף הקובץ ל-Monday נכשל שוב — נסה מאוחר יותר" },
        { status: 502 }
      );
    }

    await Promise.all([
      setInvoiceFileState(invoiceId, { status: INVOICE_FILE_STATUS.ATTACHED, pendingBlobUrl: "" }),
      pending.thenSubmissionStatus
        ? updateInvoiceSubmissionStatus(invoiceId, pending.thenSubmissionStatus)
        : Promise.resolve(),
    ]);
    after(() => deleteInvoiceBlobQuietly(pending.url));

    return NextResponse.json({ success: true, invoiceId, fileAttached: true });
  } catch (error) {
    console.error("Retry-file error:", error);
    return NextResponse.json({ error: "שגיאה בניסיון החוזר — נסה שוב" }, { status: 500 });
  }
}
