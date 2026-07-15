import { NextRequest, NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { sha256OfFile, verifyExtractionToken } from "@/lib/extractionToken";
import {
  getArtistTaxStatus,
  getColumnValue,
  getInvoiceItemForArtist,
  linkSubitemsToInvoice,
  markSubitemsInvoiceSubmitted,
  uploadFileToInvoiceColumn,
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

    const formData = await req.formData();
    const invoiceId = String(formData.get("invoiceId") ?? "").trim();
    const file = formData.get("file") as File | null;
    const invoiceNumber = (formData.get("invoiceNumber") as string) || "";
    const extractionToken = (formData.get("extractionToken") as string) || "";

    if (!invoiceId) {
      return NextResponse.json({ error: "חסר מזהה חשבונית" }, { status: 400 });
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "חובה לצרף מסמך חשבונאי" }, { status: 400 });
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

    // Upload first (the completed status must never exist without the file),
    // then the independent metadata writes run in parallel.
    await uploadFileToInvoiceColumn(invoiceId, INVOICE_ACCOUNTING_FILE_COLUMN_ID, file, file.name);
    await Promise.all([
      updateInvoiceAccountingDetails(invoiceId, {
        invoiceNumber: invoiceNumber.trim(),
        extractedAmount: extracted?.amount ?? undefined,
      }),
      updateInvoiceSubmissionStatus(invoiceId, accountingDocument.submissionStatus),
      receiptAmountMismatch
        ? updateInvoiceMatchStatus(invoiceId, INVOICE_MATCH_STATUS.RECEIPT_DIFFERENT)
        : Promise.resolve(),
    ]);

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
      submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
    });
  } catch (error) {
    console.error("Accounting document upload error:", error);
    const message = error instanceof Error ? error.message : "שגיאה בהעלאת מסמך חשבונאי";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
