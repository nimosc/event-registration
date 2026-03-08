import { NextRequest, NextResponse } from "next/server";
import { updateAttendanceConfirmation } from "@/lib/monday";
import { getSession } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    if (session.role !== "מנהל") {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const body = await request.json();
    const { subitemId, action } = body as {
      subitemId: string;
      action: "confirm" | "reject";
    };

    if (!subitemId || !action) {
      return NextResponse.json(
        { error: "מזהה תת-פריט או פעולה חסרה" },
        { status: 400 }
      );
    }

    if (action !== "confirm" && action !== "reject") {
      return NextResponse.json(
        { error: "פעולה לא חוקית" },
        { status: 400 }
      );
    }

    const label = action === "confirm" ? "מאושר" : "נדחה";
    await updateAttendanceConfirmation(subitemId, label);

    return NextResponse.json({ success: true, label });
  } catch (error) {
    console.error("Confirm/reject error:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון סטטוס" },
      { status: 500 }
    );
  }
}
