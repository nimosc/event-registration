import { NextRequest, NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { sha256OfFile, verifyExtractionToken } from "@/lib/extractionToken";
import { BlobAccessError, BlobNotFoundError, deleteInvoiceBlobQuietly, downloadInvoiceBlob } from "@/lib/blobUpload";
import { serializePendingBlob } from "@/lib/invoicePendingBlob";
import { decideInvoiceReview, formatInvoiceReviewUpdate } from "@/lib/invoiceReview";
import type { ExtractedInvoiceFields } from "@/lib/invoiceValidation";
import {
  createInvoiceItem,
  getArtistInvoices,
  getArtistTaxStatus,
  getOrdersByIdsForInvoice,
  mapMondayAttendanceToInternal,
  mapMondayCandidacyToInternal,
  parseLinkedItemIds,
  attachInvoiceFileWithRetry,
  setInvoiceFileState,
  INVOICE_FILE_STATUS,
  setInvoicePaymentStatus,
  createInvoiceUpdate,
  INVOICE_PAYMENT_STATUS,
  updateArtistBankDetails,
  getArtistBankDetailsFields,
  updateSubitemsInvoiceStatus,
  linkSubitemsToInvoice,
  getArtistSubitemIdsForOrderIds,
  markSubitemsInvoiceSubmitted,
  INVOICE_ACCOUNTING_FILE_COLUMN_ID,
  INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID,
} from "@/lib/monday";
import {
  canSubmitInvoice,
  getInvoiceMonthSubmissionError,
  isPaymentRequestConsideredPaid,
  parseInvoiceMonthKey,
} from "@/lib/invoiceEligibility";
import {
  checkDocumentTypeForPaymentRequest,
  getAccountingDocumentLabel,
  getInitialDocumentForTaxStatus,
  INVOICE_MATCH_STATUS,
  INVOICE_SUBMISSION_STATUS,
  INVOICE_SUBMISSION_TYPE,
} from "@/lib/invoiceDocuments";
import {
  extractInvoiceDataWithTimeout,
  invoiceAmountsMatch,
  validateExtractedAgainstExpected,
} from "@/lib/invoiceAiValidation";

export const maxDuration = 60;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const invoices = await getArtistInvoices(session.id);
  const artistId = parseInt(session.id, 10);

  const syncTasks = invoices
    .filter((inv) => inv.submissionStatus === INVOICE_SUBMISSION_STATUS.ACCOUNTING && inv.orderIds.length > 0)
    .map(async (inv) => {
      try {
        const subitemIds = await getArtistSubitemIdsForOrderIds(inv.orderIds, artistId, session.name);
        if (subitemIds.length > 0) {
          await linkSubitemsToInvoice(subitemIds, inv.id);
          await markSubitemsInvoiceSubmitted(subitemIds);
        }
      } catch (err) {
        console.error(`Invoice subitem sync failed for ${inv.id}:`, err);
      }
    });
  if (syncTasks.length > 0) {
    // Subitem sync is bookkeeping — finish it after the response is sent.
    after(async () => {
      await Promise.all(syncTasks);
    });
  }

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  // עטיפה כללית: בלעדיה כל חריגה (למשל שגיאת Monday) מחזירה 500 לא-JSON,
  // והקליינט מציג "שגיאת רשת" גנרית ומטעה.
  try {
    return await handleInvoiceSubmit(req);
  } catch (error) {
    console.error("Invoice submit error:", error);
    return NextResponse.json(
      { error: "שגיאה בהגשת המסמך — נסה שוב, ואם זה חוזר פנה למנהל" },
      { status: 500 }
    );
  }
}

async function handleInvoiceSubmit(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const artistId = parseInt(session.id, 10);

  // גוף JSON — הקובץ עצמו כבר ב-Vercel Blob (העלאה ישירה מהדפדפן), מגיע רק ה-URL.
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (body[k] == null ? "" : String(body[k]));
  const list = (k: string): string[] => (Array.isArray(body[k]) ? (body[k] as unknown[]).map(String) : []);
  const voluntarySubmission = body.voluntarySubmission === true || body.voluntarySubmission === "true";
  const eventsDescription = str("eventsDescription").trim();
  const orderIds = list("orderIds");
  const subitemIds = list("subitemIds");
  const amount = Number(body.amount ?? 0);
  const actualAmount = body.actualAmount != null && body.actualAmount !== "" ? Number(body.actualAmount) : undefined;
  const bankDetails = str("bankDetails");
  const beneficiaryName = str("beneficiaryName");
  const bankCode = str("bankCode");
  const bankBranch = str("bankBranch");
  const bankAccount = str("bankAccount");
  const invoiceNumber = str("invoiceNumber");
  const amountNote = str("amountNote");
  const description = str("description");
  const eventDate = str("eventDate");
  const monthLabel = str("monthLabel");
  const monthKey = str("monthKey");
  const extractionToken = str("extractionToken");
  const blobUrl = str("blobUrl").trim();

  const resolvedMonthKey = monthKey.trim() || parseInvoiceMonthKey(eventDate);
  const monthSubmissionError = getInvoiceMonthSubmissionError(resolvedMonthKey);
  if (monthSubmissionError) {
    return NextResponse.json({ error: monthSubmissionError }, { status: 400 });
  }

  if (!blobUrl) {
    return NextResponse.json({ error: "חובה לצרף בקשת תשלום" }, { status: 400 });
  }
  let file: File;
  try {
    file = await downloadInvoiceBlob(blobUrl, session.id);
  } catch (err) {
    if (err instanceof BlobAccessError) return NextResponse.json({ error: err.message }, { status: 403 });
    if (err instanceof BlobNotFoundError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  if (!beneficiaryName.trim() || !bankCode.trim() || !bankBranch.trim() || !bankAccount.trim()) {
    return NextResponse.json({ error: "חובה למלא פרטי חשבון בנק" }, { status: 400 });
  }

  // Kick off all independent work in parallel: Monday reads + extraction resolution.
  const taxStatusPromise = getArtistTaxStatus(artistId);
  const existingInvoicesPromise = getArtistInvoices(session.id);
  const ordersPromise =
    voluntarySubmission || orderIds.length === 0 ? null : getOrdersByIdsForInvoice(orderIds);

  // A valid signed token (from /api/invoices/extract) lets us reuse the extraction
  // already performed on this exact file instead of running the AI again.
  const fileHash = await sha256OfFile(file);

  // אידמפוטנטיות: אותו אומן + אותו חודש + אותו קובץ = אותה הגשה. לחיצה חוזרת
  // אחרי תשובה שאבדה בדרך מחזירה את הרשומה הקיימת במקום ליצור כפילות.
  const duplicate = (await existingInvoicesPromise).find(
    (inv) => inv.fileHash && inv.fileHash === fileHash && parseInvoiceMonthKey(inv.date) === resolvedMonthKey
  );
  if (duplicate) {
    // ההעלאה החוזרת מיותרת — הקובץ כבר מצורף (או ממתין) על הרשומה הקיימת.
    after(() => deleteInvoiceBlobQuietly(blobUrl));
    return NextResponse.json({
      success: true,
      invoiceId: duplicate.id,
      duplicate: true,
      fileAttached: duplicate.fileStatus !== INVOICE_FILE_STATUS.MISSING,
      submissionStatus: duplicate.submissionStatus,
    });
  }

  const signedExtraction = extractionToken
    ? verifyExtractionToken(extractionToken, fileHash)
    : null;
  const extractionPromise: Promise<ExtractedInvoiceFields | null> | null = signedExtraction
    ? null
    : extractInvoiceDataWithTimeout(file);

  const taxStatus = await taxStatusPromise;
  if (taxStatus !== "מורשה" && taxStatus !== "פטור") {
    return NextResponse.json({ error: "יש לבחור סוג עוסק לפני הגשה" }, { status: 400 });
  }
  const documentConfig = getInitialDocumentForTaxStatus(taxStatus);

  // שוטף +60: אם קיימת בקשת תשלום שכבר שולמה לפי תנאי התשלום וטרם הועלה עליה
  // מסמך חשבונאי — חוסמים הגשת בקשה חדשה עד שהיא תושלם.
  const existingInvoices = await existingInvoicesPromise;
  const overduePaidRequests = existingInvoices.filter(
    (inv) =>
      inv.submissionStatus === INVOICE_SUBMISSION_STATUS.PAYMENT_REQUEST &&
      isPaymentRequestConsideredPaid(inv.date)
  );
  if (overduePaidRequests.length > 0) {
    const accountingLabel = getAccountingDocumentLabel(taxStatus);
    return NextResponse.json(
      {
        error: `לפי תנאי התשלום (שוטף +60), התשלום עבור ${overduePaidRequests
          .map((inv) => inv.name)
          .join(", ")} כבר בוצע — יש להעלות ${accountingLabel} עליו לפני הגשת בקשת תשלום חדשה`,
      },
      { status: 409 }
    );
  }

  let resolvedOrderIds = orderIds;
  let resolvedSubitemIds = subitemIds;
  let resolvedDescription = description;
  let resolvedEventDate = eventDate;
  let resolvedAmount = amount;
  let resolvedActualAmount = actualAmount;

  if (voluntarySubmission) {
    if (!monthKey) {
      return NextResponse.json({ error: "חסר חודש להגשה" }, { status: 400 });
    }
    if (!eventsDescription) {
      return NextResponse.json({ error: "יש לפרט עבור אילו אירועים מדובר" }, { status: 400 });
    }
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "יש למלא סכום להגשה" }, { status: 400 });
    }
    resolvedOrderIds = [];
    resolvedSubitemIds = [];
    resolvedEventDate = `${monthKey}-01`;
    resolvedDescription = [
      "הגשה ידנית — חסר במערכת",
      `אירועים: ${eventsDescription}`,
      description.trim() ? `הערות: ${description.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    // הגשה ידנית: אין למערכת סכום מחושב — העמודה נכתבת 0, והסכום שהוזן נשמר כמדווח
    resolvedAmount = 0;
    resolvedActualAmount = actualAmount ?? amount;
  } else {
    if (!orderIds.length || !amount) {
      return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
    }
    if (!subitemIds.length) {
      return NextResponse.json({ error: "יש לבחור לפחות אירוע אחד" }, { status: 400 });
    }

    const existingOrderIds = new Set(existingInvoices.flatMap((inv) => inv.orderIds));
    const duplicates = orderIds.filter((id) => existingOrderIds.has(id));
    if (duplicates.length > 0) {
      return NextResponse.json({ error: "חשבונית כבר הוגשה עבור חלק מהאירועים" }, { status: 409 });
    }

    const requestedOrderIds = new Set(orderIds);
    const eligibleOrderIds = new Set<string>();
    const eligibleSubitemIds = new Set<string>();
    const orders = (await ordersPromise) ?? [];

    for (const order of orders) {
      if (!requestedOrderIds.has(order.id)) continue;
      for (const sub of order.subitems || []) {
        const relationCol = sub.column_values.find((cv) => cv.id === "board_relation_mm18r4da");
        const attendanceCol = sub.column_values.find((cv) => cv.id === "color_mm18bjdk");
        const candidacyCol = sub.column_values.find((cv) => cv.id === "color_mm1q61p2");
        const invoiceStatusCol = sub.column_values.find((cv) => cv.id === "color_mm3pd8vf");
        const linkedIds = parseLinkedItemIds(relationCol?.value);
        const belongsToArtist = linkedIds.includes(artistId) || sub.name.trim() === session.name.trim();
        if (!belongsToArtist) continue;

        if (
          canSubmitInvoice({
            attendanceStatus: mapMondayAttendanceToInternal(attendanceCol?.text || ""),
            candidacyStatus: mapMondayCandidacyToInternal(candidacyCol?.text || ""),
            invoiceStatus: invoiceStatusCol?.text || "",
          })
        ) {
          eligibleOrderIds.add(order.id);
          eligibleSubitemIds.add(sub.id);
        }
      }
    }

    const notEligibleOrders = orderIds.filter((id) => !eligibleOrderIds.has(id));
    if (notEligibleOrders.length > 0) {
      return NextResponse.json(
        { error: "נבחרו אירועים שלא עומדים בתנאי הגשת חשבונית" },
        { status: 403 }
      );
    }

    if (subitemIds.some((id) => !eligibleSubitemIds.has(id))) {
      return NextResponse.json(
        { error: "נבחרו הרשמות שלא עומדות בתנאי הגשת חשבונית" },
        { status: 403 }
      );
    }

    if (Math.abs((actualAmount ?? amount) - amount) > 0.009 && !amountNote.trim()) {
      return NextResponse.json(
        { error: "כאשר הסכום שונה מהסכום המחושב, יש למלא סיבה לשינוי" },
        { status: 400 }
      );
    }
  }

  const normalizedAmountNote = amountNote.trim();
  const reportedAmount = resolvedActualAmount ?? resolvedAmount;

  const extractedInvoice = documentConfig.extractFromFile
    ? signedExtraction ?? (extractionPromise ? await extractionPromise : null)
    : null;
  const extractedAmount = extractedInvoice?.amount ?? undefined;

  let fillBothColumns = false;
  let needsTypeReview = false;
  if (documentConfig.extractFromFile) {
    const validationError = validateExtractedAgainstExpected({
      extracted: extractedInvoice,
      expectedAmount: reportedAmount,
      declaredNumber: invoiceNumber,
      requireAmountWhenExtracted: true,
      requireNumberWhenBothPresent: documentConfig.kind !== "payment_request",
    });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // אימות סוג המסמך: מצופה בקשת תשלום בשלב זה.
    const typeCheck = checkDocumentTypeForPaymentRequest(extractedInvoice?.documentType);
    if (!typeCheck.ok) {
      return NextResponse.json({ error: typeCheck.error }, { status: 400 });
    }
    // הועלתה קבלה במקום בקשת תשלום → הקובץ ייכתב לשתי העמודות.
    fillBothColumns = typeCheck.fillBothColumns === true;
    // אין סיווג (חילוץ AI לא זמין) → עובר (fail-open) אך מסומן לבדיקה.
    needsTypeReview = typeCheck.needsReview === true;
  }

  const result = await createInvoiceItem({
    artistId: session.id,
    artistName: session.name,
    orderIds: resolvedOrderIds,
    amount: resolvedAmount,
    actualAmount: resolvedActualAmount,
    extractedAmount,
    invoiceNumber: "",
    paymentRequestNumber: invoiceNumber,
    submissionType: voluntarySubmission
      ? INVOICE_SUBMISSION_TYPE.REVIEW
      : INVOICE_SUBMISSION_TYPE.MONTHLY,
    matchStatus: needsTypeReview
      ? INVOICE_MATCH_STATUS.NEEDS_REVIEW
      : !voluntarySubmission && invoiceAmountsMatch(reportedAmount, resolvedAmount)
        ? INVOICE_MATCH_STATUS.OK
        : INVOICE_MATCH_STATUS.REQUEST_DIFFERENT,
    bankDetails,
    beneficiaryName,
    bankCode,
    bankBranch,
    bankAccount,
    amountNote: voluntarySubmission
      ? [normalizedAmountNote, "הגשה ידנית — ממתין לבדיקה"].filter(Boolean).join(" | ")
      : normalizedAmountNote,
    description: resolvedDescription,
    eventDate: resolvedEventDate,
    monthLabel,
    monthKey,
    submissionStatus: documentConfig.submissionStatus,
    fileHash,
    fileStatus: INVOICE_FILE_STATUS.ATTACHED,
  });

  const fileColumnId =
    documentConfig.kind === "payment_request"
      ? INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID
      : INVOICE_ACCOUNTING_FILE_COLUMN_ID;
  // כשהועלתה קבלה בשלב בקשת התשלום — הקובץ נכתב לשתי העמודות.
  const targetFileColumns = fillBothColumns
    ? [INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID, INVOICE_ACCOUNTING_FILE_COLUMN_ID]
    : [fileColumnId];
  const bankCheckPromise =
    bankDetails || beneficiaryName || bankCode || bankBranch || bankAccount
      ? getArtistBankDetailsFields(session.id)
      : null;
  // צירוף הקובץ עם ניסיונות חוזרים. כשל סופי לא מאבד כלום: הרשומה מסומנת
  // "קובץ חסר" וה-blob נשמר לניסיון חוזר (/api/invoices/retry-file).
  let fileAttached = true;
  try {
    await attachInvoiceFileWithRetry(result.id, targetFileColumns, file, file.name);
    after(() => deleteInvoiceBlobQuietly(blobUrl));
  } catch (err) {
    fileAttached = false;
    console.error(`[invoice ${result.id}] file attach failed, marking pending:`, err);
    await setInvoiceFileState(result.id, {
      status: INVOICE_FILE_STATUS.MISSING,
      pendingBlobUrl: serializePendingBlob({ url: blobUrl, columns: targetFileColumns }),
    });
  }
  const current = bankCheckPromise ? await bankCheckPromise : null;

  const shouldUpdateBankDetails = current
    ? current.legacy !== bankDetails ||
      current.beneficiaryName !== beneficiaryName ||
      current.bankCode !== bankCode ||
      current.bankBranch !== bankBranch ||
      current.bankAccount !== bankAccount
    : false;

  // חריג / לא חריג: לא חריג → "העבר לתשלום" אוטומטית; חריג → נשאר "בבדיקה"
  // והסיבות נכתבות כאפדייט על הרשומה. נקבע פעם אחת כאן; אחר כך בידי המנהלים.
  const review = decideInvoiceReview({
    submissionType: voluntarySubmission ? INVOICE_SUBMISSION_TYPE.REVIEW : INVOICE_SUBMISSION_TYPE.MONTHLY,
    matchStatus: needsTypeReview ? INVOICE_MATCH_STATUS.NEEDS_REVIEW : "",
    expectedAmount: resolvedAmount,
    reportedAmount,
    amountNote: normalizedAmountNote,
    fileAttached,
    bankDetailsChanged: shouldUpdateBankDetails,
  });
  try {
    await setInvoicePaymentStatus(
      result.id,
      review.exceptional ? INVOICE_PAYMENT_STATUS.REVIEW : INVOICE_PAYMENT_STATUS.TRANSFER
    );
  } catch (err) {
    // ברירת המחדל של העמודה היא "בבדיקה" — כשל כאן משאיר את הרשומה בבדיקה, לא מאבד אותה.
    console.error(`[invoice ${result.id}] payment status write failed:`, err);
  }

  // Non-critical writes run after the response is sent (kept alive by the platform).
  after(async () => {
    // אפדייט רק כשהרשומה נשארת בבדיקה — כדי שהמנהל ידע מה לבדוק. אישור
    // אוטומטי לא מייצר רעש בפיד.
    const postCreateTasks: Array<Promise<unknown>> = review.exceptional
      ? [createInvoiceUpdate(result.id, formatInvoiceReviewUpdate(review))]
      : [];
    if (resolvedSubitemIds.length > 0) {
      postCreateTasks.push(linkSubitemsToInvoice(resolvedSubitemIds, result.id));
      if (documentConfig.subitemInvoiceStatus) {
        postCreateTasks.push(
          updateSubitemsInvoiceStatus(resolvedSubitemIds, documentConfig.subitemInvoiceStatus)
        );
      }
    }
    if (shouldUpdateBankDetails) {
      postCreateTasks.push(
        updateArtistBankDetails(
          session.id,
          bankDetails,
          beneficiaryName,
          bankCode,
          bankBranch,
          bankAccount
        )
      );
    }
    const results = await Promise.allSettled(postCreateTasks);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error(`post-submit task failed for invoice ${result.id}:`, r.reason);
      }
    }
  });

  return NextResponse.json({
    success: true,
    invoiceId: result.id,
    fileAttached,
    submissionStatus: documentConfig.submissionStatus,
    documentKind: documentConfig.kind,
  });
}
