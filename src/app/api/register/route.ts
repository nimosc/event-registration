import { NextRequest, NextResponse } from "next/server";
import {
  getOpenOrders,
  createSubitem,
  deleteSubitem,
  updateAssignedCount,
  updateOrderStatus,
  getColumnValue,
  parseColorLabel,
  parseLinkedItemIds,
} from "@/lib/monday";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId } = body as { orderId: string };

    if (!orderId) {
      return NextResponse.json(
        { error: "מזהה הזמנה חסר" },
        { status: 400 }
      );
    }

    // Fetch the order to validate
    const items = await getOpenOrders();
    const order = items.find((item) => item.id === orderId);

    if (!order) {
      return NextResponse.json(
        { error: "הזמנה לא נמצאה" },
        { status: 404 }
      );
    }

    const statusCol = getColumnValue(order, "color_mm18ej76");
    const status = statusCol?.text || "";

    if (status !== "בתהליך שיבוץ") {
      return NextResponse.json(
        { error: "ההזמנה אינה פתוחה לרישום" },
        { status: 400 }
      );
    }

    const dateCol = getColumnValue(order, "date_mm18mqn2");
    const eventDate = dateCol?.text ? new Date(dateCol.text) : null;
    if (eventDate && eventDate < new Date(new Date().toDateString())) {
      return NextResponse.json(
        { error: "לא ניתן להירשם למועד שעבר" },
        { status: 400 }
      );
    }

    const requiredCol = getColumnValue(order, "numeric_mm185aw7");
    const assignedCol = getColumnValue(order, "numeric_mm18d914");
    const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
    const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

    // Check if already registered
    const artistId = parseInt(session.id, 10);
    const subitems = order.subitems || [];
    const alreadyRegistered = subitems.some((sub) => {
      const relationCol = sub.column_values.find(
        (cv) => cv.id === "board_relation_mm18r4da"
      );
      return parseLinkedItemIds(relationCol?.value).includes(artistId) ||
        sub.name.trim() === session.name.trim();
    });

    if (alreadyRegistered) {
      return NextResponse.json(
        { error: "כבר רשום להזמנה זו" },
        { status: 400 }
      );
    }

    if (requiredCount > 0 && assignedCount >= requiredCount) {
      return NextResponse.json(
        { error: "ההזמנה מלאה" },
        { status: 400 }
      );
    }

    // Create subitem
    const subitem = await createSubitem(orderId, session.name, session.id);

    // Update assigned count
    const newAssignedCount = assignedCount + 1;
    await updateAssignedCount(orderId, newAssignedCount);

    // If now full, update order status
    if (requiredCount > 0 && newAssignedCount >= requiredCount) {
      await updateOrderStatus(orderId, "הסתיים השיבוץ");
    }

    return NextResponse.json({
      success: true,
      subitemId: subitem.id,
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "שגיאה בתהליך הרישום" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, subitemId } = body as {
      orderId: string;
      subitemId: string;
    };

    if (!orderId || !subitemId) {
      return NextResponse.json(
        { error: "מזהה הזמנה או תת-פריט חסר" },
        { status: 400 }
      );
    }

    // Fetch order to get current assigned count
    const items = await getOpenOrders();
    const order = items.find((item) => item.id === orderId);

    if (!order) {
      return NextResponse.json(
        { error: "הזמנה לא נמצאה" },
        { status: 404 }
      );
    }

    const dateCol2 = getColumnValue(order, "date_mm18mqn2");
    const eventDate2 = dateCol2?.text ? new Date(dateCol2.text) : null;
    if (eventDate2 && eventDate2 < new Date(new Date().toDateString())) {
      return NextResponse.json(
        { error: "לא ניתן לבטל רישום למועד שעבר" },
        { status: 400 }
      );
    }

    const assignedCol = getColumnValue(order, "numeric_mm18d914");
    const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

    // Delete subitem
    await deleteSubitem(subitemId);

    // Update assigned count
    const newAssignedCount = Math.max(0, assignedCount - 1);
    await updateAssignedCount(orderId, newAssignedCount);

    // If it was previously full, reopen it
    const statusCol = getColumnValue(order, "color_mm18ej76");
    const status = statusCol?.text || "";
    if (status === "הסתיים השיבוץ") {
      await updateOrderStatus(orderId, "בתהליך שיבוץ");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unregister error:", error);
    return NextResponse.json(
      { error: "שגיאה בביטול הרישום" },
      { status: 500 }
    );
  }
}
