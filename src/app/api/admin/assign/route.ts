import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createSubitem,
  getOpenOrders,
  getAllOrders,
  getColumnValue,
  parseLinkedItemIds,
  getOrderAdminSnapshotById,
  getArtistByIdBasic,
  updateCandidacyConfirmation,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANCELLED,
  getOrderById,
  getOrderCapacityStateFromMondayItem,
  getCandidacyOrderStatusFromCapacity,
  updateOrderStatus,
} from "@/lib/monday";
import { postJsonWebhookOrLog } from "@/lib/webhook";

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
    if (orderStatus === STATUS_CANCELLED) {
      return NextResponse.json({ error: "לא ניתן לשבץ להזמנה שבוטלה" }, { status: 400 });
    }
    if (orderStatus === STATUS_ASSIGNMENT_DONE) {
      return NextResponse.json({ error: "לא ניתן לשבץ להזמנה שבה הסתיים השיבוץ" }, { status: 400 });
    }

    // prevent duplicates for this artist
    const artistIdNum = parseInt(artistId, 10);
    const alreadyRegistered = (order.subitems || []).some((sub) => {
      const relationCol = sub.column_values.find((cv) => cv.id === "board_relation_mm18r4da");
      return parseLinkedItemIds(relationCol?.value).includes(artistIdNum);
    });
    if (alreadyRegistered) return NextResponse.json({ error: "האומן כבר משויך להזמנה" }, { status: 400 });

    const subitem = await createSubitem(orderId, artistBasic.name, artistBasic.id);
    // Mark candidacy as approved since this is an admin assignment.
    await updateCandidacyConfirmation(subitem.id, "מאושר");

    const liveOrder = await getOrderById(orderId);
    if (liveOrder) {
      const capacityAfterAssign = getOrderCapacityStateFromMondayItem(liveOrder);
      const desiredCandidacyStatus = getCandidacyOrderStatusFromCapacity(
        capacityAfterAssign,
        orderStatus
      );
      if (desiredCandidacyStatus !== orderStatus) {
        await updateOrderStatus(orderId, desiredCandidacyStatus);
      }
    }

    const webhookUrl = process.env.ADMIN_CANDIDACY_APPROVED_WEBHOOK_URL?.trim();
    if (webhookUrl) {
      const orderSnapshot = await getOrderAdminSnapshotById(orderId);
      if (orderSnapshot) {
        const registration = orderSnapshot.subitems.find((s) => s.id === subitem.id);
        if (registration) {
          const firstArtistId = registration.linkedArtistIds[0];
          const artist = firstArtistId != null ? await getArtistByIdBasic(String(firstArtistId)) : null;
          await postJsonWebhookOrLog(webhookUrl, {
            event: "candidacy_approved",
            decidedAt: new Date().toISOString(),
            admin: { id: session.id, name: session.name },
            order: orderSnapshot,
            registration,
            artist,
          });
        }
      }
    }

    return NextResponse.json({ success: true, subitemId: subitem.id });
  } catch (error) {
    console.error("Admin assign error:", error);
    return NextResponse.json({ error: "שגיאה בשיבוץ" }, { status: 500 });
  }
}

