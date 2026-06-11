import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createInvoiceItem,
  getArtistInvoices,
  getArtistTaxStatus,
  getOrdersByIdsForInvoice,
  mapMondayAttendanceToInternal,
  mapMondayCandidacyToInternal,
  parseLinkedItemIds,
  uploadFileToInvoiceColumn,
  updateArtistBankDetails,
  getArtistBankDetailsFields,
  updateSubitemsInvoiceStatus,
  linkSubitemsToInvoice,
  getArtistSubitemIdsForOrderIds,
  markSubitemsInvoiceSubmitted,
  INVOICE_ACCOUNTING_FILE_COLUMN_ID,
  INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID,
} from "@/lib/monday";
import { canSubmitInvoice } from "@/lib/invoiceEligibility";
import { getInitialDocumentForTaxStatus, INVOICE_SUBMISSION_STATUS } from "@/lib/invoiceDocuments";
import {
  extractInvoiceDataWithTimeout,
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
    await Promise.all(syncTasks);
  }

  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const artistId = parseInt(session.id, 10);
  const taxStatus = await getArtistTaxStatus(artistId);
  if (taxStatus !== "מורשה" && taxStatus !== "פטור") {
    return NextResponse.json({ error: "יש לבחור סוג עוסק לפני הגשה" }, { status: 400 });
  }

  const documentConfig = getInitialDocumentForTaxStatus(taxStatus);

  const formData = await req.formData();
  const voluntarySubmission = formData.get("voluntarySubmission") === "true";
  const eventsDescription = ((formData.get("eventsDescription") as string) || "").trim();
  const orderIds: string[] = JSON.parse(formData.get("orderIds") as string ?? "[]");
  const subitemIds: string[] = JSON.parse(formData.get("subitemIds") as string ?? "[]");
  const amount = Number(formData.get("amount") ?? 0);
  const actualAmount = formData.get("actualAmount") ? Number(formData.get("actualAmount")) : undefined;
  const bankDetails = (formData.get("bankDetails") as string) || "";
  const beneficiaryName = (formData.get("beneficiaryName") as string) || "";
  const bankCode = (formData.get("bankCode") as string) || "";
  const bankBranch = (formData.get("bankBranch") as string) || "";
  const bankAccount = (formData.get("bankAccount") as string) || "";
  const invoiceNumber = (formData.get("invoiceNumber") as string) || "";
  const amountNote = (formData.get("amountNote") as string) || "";
  const description = (formData.get("description") as string) || "";
  const eventDate = (formData.get("eventDate") as string) || "";
  const monthLabel = (formData.get("monthLabel") as string) || "";
  const monthKey = (formData.get("monthKey") as string) || "";
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: `חובה לצרף ${documentConfig.fileLabel}` }, { status: 400 });
  }
  if (!beneficiaryName.trim() || !bankCode.trim() || !bankBranch.trim() || !bankAccount.trim()) {
    return NextResponse.json({ error: "חובה למלא פרטי חשבון בנק" }, { status: 400 });
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
    resolvedAmount = amount;
    resolvedActualAmount = actualAmount;
  } else {
    if (!orderIds.length || !amount) {
      return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
    }
    if (!subitemIds.length) {
      return NextResponse.json({ error: "יש לבחור לפחות אירוע אחד" }, { status: 400 });
    }

    const existing = await getArtistInvoices(session.id);
    const existingOrderIds = new Set(existing.flatMap((inv) => inv.orderIds));
    const duplicates = orderIds.filter((id) => existingOrderIds.has(id));
    if (duplicates.length > 0) {
      return NextResponse.json({ error: "חשבונית כבר הוגשה עבור חלק מהאירועים" }, { status: 409 });
    }

    const requestedOrderIds = new Set(orderIds);
    const eligibleOrderIds = new Set<string>();
    const eligibleSubitemIds = new Set<string>();
    const orders = await getOrdersByIdsForInvoice(orderIds);

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
    ? await extractInvoiceDataWithTimeout(file)
    : null;
  const extractedAmount = extractedInvoice?.amount ?? undefined;

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
  }

  const result = await createInvoiceItem({
    artistId: session.id,
    artistName: session.name,
    orderIds: resolvedOrderIds,
    amount: resolvedAmount,
    actualAmount: resolvedActualAmount,
    extractedAmount,
    invoiceNumber,
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
  });

  const fileColumnId =
    documentConfig.kind === "payment_request"
      ? INVOICE_PAYMENT_REQUEST_FILE_COLUMN_ID
      : INVOICE_ACCOUNTING_FILE_COLUMN_ID;
  await uploadFileToInvoiceColumn(result.id, fileColumnId, file, file.name);

  let shouldUpdateBankDetails = false;
  if (bankDetails || beneficiaryName || bankCode || bankBranch || bankAccount) {
    const current = await getArtistBankDetailsFields(session.id);
    shouldUpdateBankDetails =
      current.legacy !== bankDetails ||
      current.beneficiaryName !== beneficiaryName ||
      current.bankCode !== bankCode ||
      current.bankBranch !== bankBranch ||
      current.bankAccount !== bankAccount;
  }

  const postCreateTasks: Array<Promise<unknown>> = [];
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

  if (postCreateTasks.length > 0) {
    await Promise.all(postCreateTasks);
  }

  return NextResponse.json({
    invoiceId: result.id,
    submissionStatus: documentConfig.submissionStatus,
    documentKind: documentConfig.kind,
  });
}
