import { NextRequest, NextResponse } from "next/server";
import {
  updateAttendanceConfirmation,
  updateCandidacyConfirmation,
  getOrderById,
  updateOrderStatus,
  getColumnValue,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
  mapInternalAttendanceToMonday,
  mapInternalCandidacyToMonday,
  CANDIDACY_STATUS_COLUMN_ID,
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
    const { orderId, subitemId, action, mode } = body as {
      orderId: string;
      subitemId: string;
      action: "confirm" | "reject";
      mode: "candidacy" | "arrival";
    };

    if (!orderId || !subitemId || !action || !mode) {
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

    const internalLabel = action === "confirm" ? "מאושר" : "נדחה";

    if (mode === "candidacy") {
      await updateCandidacyConfirmation(subitemId, internalLabel);

      // Fetch updated order to check candidacy confirmed count vs required.
      const order = await getOrderById(orderId);
      if (order) {
        const requiredCol = getColumnValue(order, "numeric_mm185aw7");
        const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
        const statusCol = getColumnValue(order, "color_mm18ej76");
        const currentStatus = statusCol?.text || "";

        const subitems = order.subitems || [];
        const mondayConfirmedLabel = mapInternalCandidacyToMonday("מאושר");
        const confirmedCount = subitems.filter((sub) => {
          const candidacyCol = sub.column_values.find(
            (cv) => cv.id === CANDIDACY_STATUS_COLUMN_ID
          );
          return candidacyCol?.text === mondayConfirmedLabel;
        }).length;

        if (action === "confirm" && requiredCount > 0 && confirmedCount >= requiredCount) {
          await updateOrderStatus(orderId, STATUS_ASSIGNMENT_DONE);
        } else if (action === "reject" && currentStatus === STATUS_ASSIGNMENT_DONE) {
          await updateOrderStatus(orderId, STATUS_CANDIDACY_CLOSED);
        }
      }
    } else {
      // mode === "arrival"
      await updateAttendanceConfirmation(subitemId, internalLabel);
      // No order status changes on arrival.
    }

    return NextResponse.json({ success: true, mode, label: internalLabel });
  } catch (error) {
    console.error("Confirm/reject error:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון סטטוס" },
      { status: 500 }
    );
  }
}
