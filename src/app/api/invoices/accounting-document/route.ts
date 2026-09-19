import { NextRequest, NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { sha256OfFile, verifyExtractionToken } from "@/lib/extractionToken";
import { BlobAccessError, BlobNotFoundError, deleteInvoiceBlobQuietly, downloadInvoiceBlob } from "@/lib/blobUpload";
import { serializePendingBlob } from "@/lib/invoicePendingBlob";
import {
  getArtistTaxStatus,
  getColumnValue,
  getInvoiceItemForArtist,
  linkSubitemsToInvoice,
  markSubitemsInvoiceSubmitted,
  attachInvoiceFileWithRetry,
  setInvoiceFileState,
  INVOICE_FILE_STATUS,
  updateInvoiceSubmissionStatus,
  updateInvoiceMatchStatus,
  updateInvoiceAccountingDetails,
  INVOICE_ACCOUNTING_FILE_COLUMN_ID,
  getArtistSubitemIdsForOrderIds,
  getOrdersByIdsForInvoice,
} from "@/lib/monday";
import {
  getInvoiceMonthSubmissionError,
  parseInvoiceMonthKey,
} from "@/lib/invoiceEligibility";
import {
  checkDocumentTypeForAccounting,
  getFollowUpAccountingDocument,
  INVOICE_MATCH_STATUS,
  INVOICE_SUBMISSION_STATUS,
} from "@/lib/invoiceDocuments";
import {
  extractInvoiceDataWithTimeout,
  invoiceAmountsMatch,
  validateExtractedAgainstExpected,
} from "@/lib/invoiceAiValidation";

export const maxDuration = 60;

function parseMonthKeyFromDate(dateStr: string): string {
  const match = dateStr?.match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

    const artistId = parseInt(session.id, 10);

    const body = (await req.json().catch(() => ({}))) as {
      invoiceId?: string;
      blobUrl?: string;
      invoiceNumber?: string;
      extractionToken?: string;
    };
    const invoiceId = String(body.invoiceId ?? "").trim();
    const blobUrl = String(body.blobUrl ?? "").trim();
    const invoiceNumber = String(body.invoiceNumber ?? "");
    const extractionToken = String(body.extractionToken ?? "");

    if (!invoiceId) {
      return NextResponse.json({ error: "חסר מזהה חשבונית" }, { status: 400 });
    }
    if (!blobUrl) {
      return NextResponse.json({ error: "חובה לצרף מסמך חשבונאי" }, { status: 400 });
    }
    // הקובץ כבר ב-Vercel Blob (העלאה ישירה מהדפדפן) — מורידים אותו לעיבוד.
    let file: File;
    try {
      file = await downloadInvoiceBlob(blobUrl, session.id);
    } catch (err) {
      if (err instanceof BlobAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
      if (err instanceof BlobNotFoundError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
    if (!invoiceNumber.trim()) {
      return NextResponse.json({ error: "חובה למלא מספר חשבונית / קבלה" }, { status: 400 });
    }

    // Kick off independent work in parallel: Monday reads + extraction resolution.
    const taxStatusPromise = getArtistTaxStatus(artistId);
    const invoicePromise = getInvoiceItemForArtist(invoiceId, session.id);
    const fileHash = await sha256OfFile(file);
    const signedExtraction = extractionToken
      ? verifyExtractionToken(extractionToken, fileHash)
      : null;
    const extractionPromise = signedExtraction ? null : extractInvoiceDataWithTimeout(file);

    const taxStatus = await taxStatusPromise;
    if (taxStatus !== "מורשה" && taxStatus !== "פטור") {
      return NextResponse.json({ error: "יש לבחור סוג עוסק לפני הגשה" }, { status: 400 });
    }

    const accountingDocument = getFollowUpAccountingDocument(taxStatus);

    const invoice = await invoicePromise;
    if (!invoice) {
      return NextResponse.json({ error: "הרשומה לא נמצאה" }, { status: 404 });
    }
    if (invoice.submissionStatus === INVOICE_SUBMISSION_STATUS.ACCOUNTING) {
      after(async () => {
        try {
          const subitemIds = await getArtistSubitemIdsForOrderIds(
            invoice.orderIds,
            artistId,
            session.name
          );
          if (subitemIds.length > 0) {
            await linkSubitemsToInvoice(subitemIds, invoiceId);
            await markSubitemsInvoiceSubmitted(subitemIds);
          }
        } catch (err) {
          console.error(`post-submit subitem sync failed for invoice ${invoiceId}:`, err);
        }
      });
      return NextResponse.json({
        success: true,
        invoiceId,
        alreadySubmitted: true,
        submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
      });
    }
    if (invoice.submissionStatus !== INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST) {
      return NextResponse.json({ error: `ניתן להעלות ${accountingDocument.fileLabel} רק לאחר הגשת בקשת תשלום` }, { status: 400 });
    }

    const orders = await getOrdersByIdsForInvoice(invoice.orderIds);
    const monthKeys = new Set(
      orders
        .map((order) => parseMonthKeyFromDate(getColumnValue(order, "date_mm18mqn2")?.text || ""))
        .filter(Boolean)
    );
    const invoiceMonthKey = parseInvoiceMonthKey(invoice.date);
    if (invoiceMonthKey) monthKeys.add(invoiceMonthKey);
    if (monthKeys.size === 0) {
      return NextResponse.json({ error: "חסר חודש להגשה" }, { status: 400 });
    }
    for (const key of monthKeys) {
      const monthSubmissionError = getInvoiceMonthSubmissionError(key);
      if (monthSubmissionError) {
        return NextResponse.json({ error: monthSubmissionError }, { status: 400 });
      }
    }
    if (monthKeys.size > 1) {
      return NextResponse.json(
        { error: `${accountingDocument.fileLabel} ניתנת להגשה לחודש אחד בלבד — פנה למנהל` },
        { status: 400 }
      );
    }

    const expectedAmount = invoice.reportedAmount || invoice.actualAmount || invoice.amount;
    const extracted = signedExtraction ?? (extractionPromise ? await extractionPromise : null);
    // Typo guard: a declared number that contradicts the file still blocks.
    const numberError = validateExtractedAgainstExpected({
      extracted,
      expectedAmount,
      declaredNumber: invoiceNumber,
      requireAmountWhenExtracted: false,
      requireNumberWhenBothPresent: true,
    });
    if (numberError) {
      return NextResponse.json({ error: numberError }, { status: 400 });
    }
    // Amount mismatch vs the payment request is accepted and flagged for admin review.
    const receiptAmountMismatch =
      extracted?.amount != null && !invoiceAmountsMatch(extracted.amount, expectedAmount);

    // אימות סוג המסמך: מצופה מסמך חשבונאי (קבלה / חשבונית מס קבלה).
    const typeCheck = checkDocumentTypeForAccounting(
      extracted?.documentType,
      accountingDocument.fileLabel
    );
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error }, { status: 400 });
    }
    // אין סיווג (חילוץ AI לא זמין) → עובר (fail-open) אך מסומן לבדיקה.
    const needsTypeReview = typeCheck.needsReview === true;

    // המטא-דאטה נכתב תמיד; סטטוס "הוגש מסמך חשבונאי" נקבע רק אם הקובץ צורף
    // בפועל (הסטטוס לא יתקיים בלי קובץ). כשל צירוף → "קובץ חסר" + blob נשמר
    // לניסיון חוזר, שגם יקבע את הסטטוס.
    await Promise.all([
      updateInvoiceAccountingDetails(invoiceId, {
        invoiceNumber: invoiceNumber.trim(),
        extractedAmount: extracted?.amount ?? undefined,
      }),
      needsTypeReview
        ? updateInvoiceMatchStatus(invoiceId, INVOICE_MATCH_STATUS.NEEDS_REVIEW)
        : receiptAmountMismatch
          ? updateInvoiceMatchStatus(invoiceId, INVOICE_MATCH_STATUS.RECEIPT_DIFFERENT)
          : Promise.resolve(),
    ]);

    let fileAttached = true;
    try {
      await attachInvoiceFileWithRetry(invoiceId, [INVOICE_ACCOUNTING_FILE_COLUMN_ID], file, file.name);
      await Promise.all([
        updateInvoiceSubmissionStatus(invoiceId, accountingDocument.submissionStatus),
        setInvoiceFileState(invoiceId, { status: INVOICE_FILE_STATUS.ATTACHED, pendingBlobUrl: "" }),
      ]);
      after(() => deleteInvoiceBlobQuietly(blobUrl));
    } catch (err) {
      fileAttached = false;
      console.error(`[invoice ${invoiceId}] accounting file attach failed, marking pending:`, err);
      await setInvoiceFileState(invoiceId, {
        status: INVOICE_FILE_STATUS.MISSING,
        pendingBlobUrl: serializePendingBlob({
          url: blobUrl,
          columns: [INVOICE_ACCOUNTING_FILE_COLUMN_ID],
          thenSubmissionStatus: accountingDocument.submissionStatus,
        }),
      });
      return NextResponse.json({ success: true, invoiceId, fileAttached });
    }

    // Subitem bookkeeping runs after the response is sent.
    after(async () => {
      try {
        const subitemIds = await getArtistSubitemIdsForOrderIds(
          invoice.orderIds,
          artistId,
          session.name
        );
        if (subitemIds.length > 0) {
          await linkSubitemsToInvoice(subitemIds, invoiceId);
          await markSubitemsInvoiceSubmitted(subitemIds);
        }
      } catch (err) {
        console.error(`post-submit subitem sync failed for invoice ${invoiceId}:`, err);
      }
    });

    return NextResponse.json({
      success: true,
      invoiceId,
      fileAttached,
      submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
    });
  } catch (error) {
    console.error("Accounting document upload error:", error);
    const message = error instanceof Error ? error.message : "שגיאה בהעלאת מסמך חשבונאי";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
