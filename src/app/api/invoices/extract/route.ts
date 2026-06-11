import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { extractInvoiceData, isInvoiceExtractAvailable } from "@/lib/invoiceExtract";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "לא צורף קובץ" }, { status: 400 });
  }

  if (!isInvoiceExtractAvailable()) {
    return NextResponse.json({
      receiptNumber: null,
      amount: null,
      description: null,
      skipped: true,
      message: "חילוץ אוטומטי לא זמין — ניתן להמשיך ולהזין ידנית",
    });
  }

  try {
    const parsed = await extractInvoiceData(file);
    return NextResponse.json({
      receiptNumber: parsed.receiptNumber ?? null,
      amount: parsed.amount != null ? Number(parsed.amount) : null,
      description: parsed.description ?? null,
    });
  } catch (err) {
    console.error("Invoice extract error:", err);
    return NextResponse.json({
      receiptNumber: null,
      amount: null,
      description: null,
      skipped: true,
      message: "לא הצלחנו לחלץ נתונים מהקובץ — ניתן להמשיך ולהזין ידנית",
    });
  }
}
