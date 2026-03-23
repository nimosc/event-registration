import { NextRequest, NextResponse } from "next/server";
import {
  updateAttendanceConfirmation,
  getOrderById,
  updateOrderStatus,
  getColumnValue,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
} from "@/lib/monday";
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
    const { orderId, subitemId, action } = body as {
      orderId: string;
      subitemId: string;
      action: "confirm" | "reject";
    };

    if (!orderId || !subitemId || !action) {
      return NextResponse.json(
        { error: "מזהה הזמנה, תת-פריט או פעולה חסרה" },
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

    // Fetch updated order to check confirmed count vs required
    const order = await getOrderById(orderId);
    if (order) {
      const requiredCol = getColumnValue(order, "numeric_mm185aw7");
      const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
      const statusCol = getColumnValue(order, "color_mm18ej76");
      const currentStatus = statusCol?.text || "";

      const subitems = order.subitems || [];
      const confirmedCount = subitems.filter((sub) => {
        const attendanceCol = sub.column_values.find(
          (cv) => cv.id === "color_mm18bjdk"
        );
        // For the subitem just updated, use the new label
        if (sub.id === subitemId) return label === "מאושר";
        return attendanceCol?.text === "מאושר";
      }).length;

      if (action === "confirm" && requiredCount > 0 && confirmedCount >= requiredCount) {
        await updateOrderStatus(orderId, STATUS_ASSIGNMENT_DONE);
      } else if (action === "reject" && currentStatus === STATUS_ASSIGNMENT_DONE) {
        await updateOrderStatus(orderId, STATUS_CANDIDACY_CLOSED);
      }
    }

    return NextResponse.json({ success: true, label });
  } catch (error) {
    console.error("Confirm/reject error:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון סטטוס" },
      { status: 500 }
    );
  }
}
