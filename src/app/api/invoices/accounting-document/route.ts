import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getArtistTaxStatus,
  getColumnValue,
  getInvoiceItemForArtist,
  linkSubitemsToInvoice,
  markSubitemsInvoiceSubmitted,
  uploadFileToInvoiceColumn,
  updateInvoiceSubmissionStatus,
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
  INVOICE_SUBMISSION_STATUS,
} from "@/lib/invoiceDocuments";
import {
  extractInvoiceDataWithTimeout,
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
    const taxStatus = await getArtistTaxStatus(artistId);
    if (taxStatus !== "מורשה") {
      return NextResponse.json({ error: "העלאת מסמך חשבונאי זמינה רק לעוסק מורשה" }, { status: 400 });
    }

    const formData = await req.formData();
    const invoiceId = String(formData.get("invoiceId") ?? "").trim();
    const file = formData.get("file") as File | null;
    const invoiceNumber = (formData.get("invoiceNumber") as string) || "";

    if (!invoiceId) {
      return NextResponse.json({ error: "חסר מזהה חשבונית" }, { status: 400 });
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "חובה לצרף חשבונית מס קבלה" }, { status: 400 });
    }
    if (!invoiceNumber.trim()) {
      return NextResponse.json({ error: "חובה למלא מספר חשבונית / קבלה" }, { status: 400 });
    }

    const invoice = await getInvoiceItemForArtist(invoiceId, session.id);
    if (!invoice) {
      return NextResponse.json({ error: "הרשומה לא נמצאה" }, { status: 404 });
    }
    if (invoice.submissionStatus === INVOICE_SUBMISSION_STATUS.ACCOUNTING) {
      const subitemIds = await getArtistSubitemIdsForOrderIds(
        invoice.orderIds,
        artistId,
        session.name
      );
      if (subitemIds.length > 0) {
        await linkSubitemsToInvoice(subitemIds, invoiceId);
        await markSubitemsInvoiceSubmitted(subitemIds);
      }
      return NextResponse.json({
        success: true,
        invoiceId,
        alreadySubmitted: true,
        submissionStatus: INVOICE_SUBMISSION_STATUS.ACCOUNTING,
      });
    }
    if (invoice.submissionStatus !== INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST) {
      return NextResponse.json({ error: "ניתן להעלות חשבונית מס קבלה רק לאחר הגשת בקשת תשלום" }, { status: 400 });
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
        { error: "חשבונית מס קבלה ניתנת להגשה לחודש אחד בלבד — פנה למנהל" },
        { status: 400 }
      );
    }

    const expectedAmount = invoice.reportedAmount || invoice.actualAmount || invoice.amount;
    const extracted = await extractInvoiceDataWithTimeout(file);
    const validationError = validateExtractedAgainstExpected({
      extracted,
      expectedAmount,
      declaredNumber: invoiceNumber,
      requireAmountWhenExtracted: true,
      requireNumberWhenBothPresent: true,
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await uploadFileToInvoiceColumn(invoiceId, INVOICE_ACCOUNTING_FILE_COLUMN_ID, file, file.name);
    await updateInvoiceAccountingDetails(invoiceId, {
      invoiceNumber: invoiceNumber.trim(),
      extractedAmount: extracted?.amount ?? undefined,
    });
    await updateInvoiceSubmissionStatus(invoiceId, getFollowUpAccountingDocument().submissionStatus);

    const subitemIds = await getArtistSubitemIdsForOrderIds(
      invoice.orderIds,
      artistId,
      session.name
    );

    if (subitemIds.length > 0) {
      await linkSubitemsToInvoice(subitemIds, invoiceId);
      await markSubitemsInvoiceSubmitted(subitemIds);
    }

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
