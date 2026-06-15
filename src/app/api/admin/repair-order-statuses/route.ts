import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { repairMisopenedOrderStatuses } from "@/lib/monday";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }
    if (session.role !== "מנהל") {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const result = await repairMisopenedOrderStatuses();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Repair order statuses error:", error);
    return NextResponse.json({ error: "שגיאה בתיקון סטטוסים" }, { status: 500 });
  }
}
