import { NextRequest, NextResponse } from "next/server";
import {
  getOpenOrders,
  getAllOrders,
  createSubitem,
  deleteSubitem,
  updateAssignedCount,
  updateOrderStatus,
  getColumnValue,
  parseLinkedItemIds,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANCELLED,
  getOrderCapacityState,
  isRegistrationOpenForRole,
  getCandidacyOrderStatusFromCapacity,
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

    if (status === STATUS_CANCELLED || status === STATUS_ASSIGNMENT_DONE) {
      return NextResponse.json(
        { error: "ההזמנה אינה פתוחה להגשת מועמדות" },
        { status: 400 }
      );
    }

    const dateCol = getColumnValue(order, "date_mm18mqn2");
    const eventDate = dateCol?.text ? new Date(dateCol.text) : null;
    if (eventDate && eventDate < new Date(new Date().toDateString())) {
      return NextResponse.json(
        { error: "לא ניתן להגיש מועמדות למועד שעבר" },
        { status: 400 }
      );
    }

    const isOdt = session.role === "ODT";

    const requiredCol = getColumnValue(order, "numeric_mm185aw7");
    const requiredOdtCol = getColumnValue(order, "numeric_mm387qc7");
    const artistAssignedCol = getColumnValue(order, "numeric_mm18d914");
    const odtAssignedCol = getColumnValue(order, "numeric_mm3b6rnr");

    const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
    const requiredOdtCount = parseFloat(requiredOdtCol?.text || "0") || 0;
    const artistAssigned = parseFloat(artistAssignedCol?.text || "0") || 0;
    const odtAssigned = parseFloat(odtAssignedCol?.text || "0") || 0;

    const myAssigned = isOdt ? odtAssigned : artistAssigned;
    const myAssignedColumnId = isOdt ? "numeric_mm3b6rnr" : "numeric_mm18d914";
    const capacity = getOrderCapacityState(
      requiredCount,
      artistAssigned,
      requiredOdtCount,
      odtAssigned
    );
    const roleForCapacity = isOdt ? "ODT" : "אומן";
    const myCapacityLimit = isOdt
      ? capacity.odt.capacityLimit
      : capacity.artist.capacityLimit;

    if (!isRegistrationOpenForRole(roleForCapacity, capacity)) {
      return NextResponse.json(
        { error: "נסגרה קבלת מועמדויות להזמנה זו" },
        { status: 400 }
      );
    }

    // Check if already submitted candidacy
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
        { error: "כבר הגשת מועמדות להזמנה זו" },
        { status: 400 }
      );
    }

    if (myCapacityLimit > 0 && myAssigned >= myCapacityLimit) {
      return NextResponse.json(
        { error: "נסגרה קבלת מועמדויות להזמנה זו" },
        { status: 400 }
      );
    }

    // Create subitem
    const subitem = await createSubitem(
      orderId,
      session.name,
      session.id,
      isOdt ? "ODT" : undefined
    );

    // Update per-role assigned count
    const newAssigned = myAssigned + 1;
    await updateAssignedCount(orderId, newAssigned, myAssignedColumnId);

    const newArtistAssigned = isOdt ? artistAssigned : newAssigned;
    const newOdtAssigned = isOdt ? newAssigned : odtAssigned;
    const capacityAfterCreate = getOrderCapacityState(
      requiredCount,
      newArtistAssigned,
      requiredOdtCount,
      newOdtAssigned
    );
    const desiredStatus = getCandidacyOrderStatusFromCapacity(capacityAfterCreate, status);
    if (desiredStatus !== status) {
      await updateOrderStatus(orderId, desiredStatus);
    }

    return NextResponse.json({
      success: true,
      subitemId: subitem.id,
    });
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "שגיאה בהגשת המועמדות" },
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

    // Fetch order (open first; fallback to all for "המועמדויות שלי" unregister)
    let items = await getOpenOrders();
    let order = items.find((item) => item.id === orderId);
    if (!order) {
      items = await getAllOrders();
      order = items.find((item) => item.id === orderId);
    }
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
        { error: "לא ניתן לבטל מועמדות למועד שעבר" },
        { status: 400 }
      );
    }

    const deleteAssignedColumnId = session.role === "ODT" ? "numeric_mm3b6rnr" : "numeric_mm18d914";
    const assignedCol = getColumnValue(order, deleteAssignedColumnId);
    const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

    // Delete subitem
    await deleteSubitem(subitemId);

    // Update assigned count
    const newAssignedCount = Math.max(0, assignedCount - 1);
    await updateAssignedCount(orderId, newAssignedCount, deleteAssignedColumnId);

    const statusCol = getColumnValue(order, "color_mm18ej76");
    const status = statusCol?.text || "";
    const requiredCol = getColumnValue(order, "numeric_mm185aw7");
    const requiredOdtCol = getColumnValue(order, "numeric_mm387qc7");
    const artistAssignedCol = getColumnValue(order, "numeric_mm18d914");
    const odtAssignedCol = getColumnValue(order, "numeric_mm3b6rnr");
    const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
    const requiredOdtCount = parseFloat(requiredOdtCol?.text || "0") || 0;
    const artistAssigned = parseFloat(artistAssignedCol?.text || "0") || 0;
    const odtAssigned = parseFloat(odtAssignedCol?.text || "0") || 0;

    const newArtistAssigned = session.role === "ODT"
      ? artistAssigned
      : Math.max(0, artistAssigned - 1);
    const newOdtAssigned = session.role === "ODT"
      ? Math.max(0, odtAssigned - 1)
      : odtAssigned;
    const capacityAfterDelete = getOrderCapacityState(
      requiredCount,
      newArtistAssigned,
      requiredOdtCount,
      newOdtAssigned
    );
    const desiredStatus = getCandidacyOrderStatusFromCapacity(capacityAfterDelete, status);
    if (desiredStatus !== status) {
      await updateOrderStatus(orderId, desiredStatus);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unregister error:", error);
    return NextResponse.json(
      { error: "שגיאה בביטול המועמדות" },
      { status: 500 }
    );
  }
}
