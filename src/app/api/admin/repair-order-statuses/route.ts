import { NextResponse } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { restoreOrderStatusesFromActivityLogs } from "@/lib/monday";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }
    if (!isAdmin(session.role)) {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const result = await restoreOrderStatusesFromActivityLogs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Restore order statuses error:", error);
    return NextResponse.json({ error: "שגיאה בשחזור סטטוסים" }, { status: 500 });
  }
}
