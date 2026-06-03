import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createInvoiceItem,
  getArtistInvoices,
  getOrdersByIdsForInvoice,
  mapMondayAttendanceToInternal,
  mapMondayCandidacyToInternal,
  parseLinkedItemIds,
  uploadFileToInvoiceItem,
  updateArtistBankDetails,
  getArtistBankDetailsFields,
  markSubitemsInvoiceSubmitted,
  linkSubitemsToInvoice,
} from "@/lib/monday";
import { canSubmitInvoice } from "@/lib/invoiceEligibility";
import { extractInvoiceData } from "@/lib/invoiceExtract";

async function extractInvoiceDataWithTimeout(file: File, timeoutMs = 4500) {
  try {
    return await Promise.race([
      extractInvoiceData(file),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const invoices = await getArtistInvoices(session.id);
  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const formData = await req.formData();
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

  if (!orderIds.length || !amount) {
    return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "חובה לצרף קובץ חשבונית" }, { status: 400 });
  }
  if (!beneficiaryName.trim() || !bankCode.trim() || !bankBranch.trim() || !bankAccount.trim()) {
    return NextResponse.json({ error: "חובה למלא פרטי חשבון בנק" }, { status: 400 });
  }
  if (!subitemIds.length) {
    return NextResponse.json({ error: "יש לבחור לפחות אירוע אחד" }, { status: 400 });
  }

  // Duplicate check: reject if any of the submitted orders already has an invoice
  const existing = await getArtistInvoices(session.id);
  const existingOrderIds = new Set(existing.flatMap(inv => inv.orderIds));
  const duplicates = orderIds.filter(id => existingOrderIds.has(id));
  if (duplicates.length > 0) {
    return NextResponse.json({ error: "חשבונית כבר הוגשה עבור חלק מהאירועים" }, { status: 409 });
  }

  const artistId = parseInt(session.id, 10);
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

  const normalizedAmountNote = amountNote.trim();
  const reportedAmount = actualAmount ?? amount;
  if (Math.abs(reportedAmount - amount) > 0.009 && !normalizedAmountNote) {
    return NextResponse.json(
      { error: "כאשר הסכום שונה מהסכום המחושב, יש למלא סיבה לשינוי" },
      { status: 400 }
    );
  }

  const extractedInvoice = await extractInvoiceDataWithTimeout(file);
  const extractedAmount = extractedInvoice?.amount ?? undefined;

  const result = await createInvoiceItem({
    artistId: session.id,
    artistName: session.name,
    orderIds,
    amount,
    actualAmount,
    extractedAmount,
    invoiceNumber,
    bankDetails,
    beneficiaryName,
    bankCode,
    bankBranch,
    bankAccount,
    amountNote: normalizedAmountNote,
    description,
    eventDate,
    monthLabel,
    monthKey,
  });

  await uploadFileToInvoiceItem(result.id, file, file.name);

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
  if (subitemIds.length > 0) {
    postCreateTasks.push(linkSubitemsToInvoice(subitemIds, result.id));
    postCreateTasks.push(markSubitemsInvoiceSubmitted(subitemIds));
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

  return NextResponse.json({ invoiceId: result.id });
}
