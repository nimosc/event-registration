import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createInvoiceItem,
  getArtistInvoices,
  uploadFileToInvoiceItem,
  updateArtistBankDetails,
  getArtistBankDetails,
  markSubitemsInvoiceSubmitted,
} from "@/lib/monday";

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
  const invoiceNumber = (formData.get("invoiceNumber") as string) || "";
  const amountNote = (formData.get("amountNote") as string) || "";
  const description = (formData.get("description") as string) || "";
  const eventDate = (formData.get("eventDate") as string) || "";
  const monthLabel = (formData.get("monthLabel") as string) || "";
  const file = formData.get("file") as File | null;

  if (!orderIds.length || !amount) {
    return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
  }

  // Duplicate check: reject if any of the submitted orders already has an invoice
  const existing = await getArtistInvoices(session.id);
  const existingOrderIds = new Set(existing.flatMap(inv => inv.orderIds));
  const duplicates = orderIds.filter(id => existingOrderIds.has(id));
  if (duplicates.length > 0) {
    return NextResponse.json({ error: "חשבונית כבר הוגשה עבור חלק מהאירועים" }, { status: 409 });
  }

  const result = await createInvoiceItem({
    artistId: session.id,
    artistName: session.name,
    orderIds,
    amount,
    actualAmount,
    invoiceNumber,
    bankDetails,
    amountNote,
    description,
    eventDate,
    monthLabel,
  });

  if (file && file.size > 0) {
    await uploadFileToInvoiceItem(result.id, file, file.name);
  }

  if (subitemIds.length > 0) {
    await markSubitemsInvoiceSubmitted(subitemIds);
  }

  // Save bank details back to artist profile if changed
  if (bankDetails) {
    const current = await getArtistBankDetails(session.id);
    if (current !== bankDetails) {
      await updateArtistBankDetails(session.id, bankDetails);
    }
  }

  return NextResponse.json({ invoiceId: result.id });
}
