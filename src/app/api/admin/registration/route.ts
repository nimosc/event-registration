import { NextRequest, NextResponse } from "next/server";
import {
  getOrderById,
  getColumnValue,
  updateOrderStatus,
  STATUS_OPEN,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANCELLED,
} from "@/lib/monday";
import { getSession, isAdmin } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }
    if (!isAdmin(session.role)) {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const body = await request.json();
    const { orderId, open } = body as { orderId: string; open: boolean };

    if (!orderId || typeof open !== "boolean") {
      return NextResponse.json(
        { error: "מזהה הזמנה או פעולה חסרה" },
        { status: 400 }
      );
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });
    }

    const currentStatus = getColumnValue(order, "color_mm18ej76")?.text || "";
    if (currentStatus === STATUS_CANCELLED) {
      return NextResponse.json(
        { error: "לא ניתן לשנות הרשמה להזמנה שבוטלה" },
        { status: 400 }
      );
    }

    const newStatus = open ? STATUS_OPEN : STATUS_ASSIGNMENT_DONE;
    if (currentStatus === newStatus) {
      return NextResponse.json({ success: true, status: newStatus });
    }

    await updateOrderStatus(orderId, newStatus);
    return NextResponse.json({ success: true, status: newStatus });
  } catch (error) {
    console.error("Registration toggle error:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון סטטוס ההרשמה" },
      { status: 500 }
    );
  }
}
