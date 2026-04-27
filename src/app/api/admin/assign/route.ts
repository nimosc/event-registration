import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createSubitem,
  getOpenOrders,
  getAllOrders,
  getColumnValue,
  parseLinkedItemIds,
  updateAssignedCount,
  updateOrderStatus,
  getOrderById,
  getArtistByIdBasic,
  updateCandidacyConfirmation,
  mapInternalCandidacyToMonday,
  ARTIST_ACTIVE_STATUS_COLUMN_ID,
  STATUS_OPEN,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
  CANDIDACY_STATUS_COLUMN_ID,
  BOARDS,
} from "@/lib/monday";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    if (session.role !== "מנהל") return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });

    const body = (await request.json()) as {
      orderId: string;
      artistId: string;
    };
    const { orderId, artistId } = body;
    if (!orderId || !artistId) {
      return NextResponse.json({ error: "orderId/artistId חסרים" }, { status: 400 });
    }

    const [open, all, artistBasic] = await Promise.all([
      getOpenOrders(),
      getAllOrders(),
      getArtistByIdBasic(artistId),
    ]);

    if (!artistBasic) return NextResponse.json({ error: "אומן לא נמצא" }, { status: 404 });
    if (!artistBasic.statusText || artistBasic.statusText === "לא פעיל") {
      return NextResponse.json({ error: "האומן לא מאושר לשיבוץ" }, { status: 400 });
    }

    const order = open.find((i) => i.id === orderId) ?? all.find((i) => i.id === orderId);
    if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

    const statusCol = getColumnValue(order, "color_mm18ej76");
    const orderStatus = statusCol?.text || "";
    if (orderStatus !== STATUS_OPEN) {
      return NextResponse.json({ error: "הזמנה לא פתוחה לשיבוץ" }, { status: 400 });
    }

    const requiredCol = getColumnValue(order, "numeric_mm185aw7");
    const assignedCol = getColumnValue(order, "numeric_mm18d914");
    const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
    const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

    const capacityLimit = requiredCount > 0 ? Math.ceil(requiredCount * 1.5) : 0;
    if (capacityLimit > 0 && assignedCount >= capacityLimit) {
      return NextResponse.json({ error: "הזמנה מלאה" }, { status: 400 });
    }

    // prevent duplicates for this artist
    const artistIdNum = parseInt(artistId, 10);
    const alreadyRegistered = (order.subitems || []).some((sub) => {
      const relationCol = sub.column_values.find((cv) => cv.id === "board_relation_mm18r4da");
      return parseLinkedItemIds(relationCol?.value).includes(artistIdNum);
    });
    if (alreadyRegistered) return NextResponse.json({ error: "האומן כבר משויך להזמנה" }, { status: 400 });

    const subitem = await createSubitem(orderId, artistBasic.name, artistBasic.id);
    const newAssignedCount = assignedCount + 1;
    await updateAssignedCount(orderId, newAssignedCount);

    if (capacityLimit > 0 && newAssignedCount >= capacityLimit) {
      await updateOrderStatus(orderId, STATUS_CANDIDACY_CLOSED);
    }

    // Mark candidacy as approved since this is an admin assignment.
    await updateCandidacyConfirmation(subitem.id, "מאושר");

    // If we reached the required amount, close assignment.
    const updatedOrder = await getOrderById(orderId);
    if (updatedOrder) {
      const requiredCol2 = getColumnValue(updatedOrder, "numeric_mm185aw7");
      const requiredCount2 = parseFloat(requiredCol2?.text || "0") || 0;
      const mondayApproved = mapInternalCandidacyToMonday("מאושר");
      const confirmedCount = (updatedOrder.subitems || []).filter((sub) => {
        const candidacyCol = sub.column_values.find((cv) => cv.id === CANDIDACY_STATUS_COLUMN_ID);
        return candidacyCol?.text === mondayApproved;
      }).length;

      if (requiredCount2 > 0 && confirmedCount >= requiredCount2) {
        await updateOrderStatus(orderId, STATUS_ASSIGNMENT_DONE);
      }
    }

    return NextResponse.json({ success: true, subitemId: subitem.id });
  } catch (error) {
    console.error("Admin assign error:", error);
    return NextResponse.json({ error: "שגיאה בשיבוץ" }, { status: 500 });
  }
}

