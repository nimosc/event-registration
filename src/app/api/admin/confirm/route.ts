import { NextRequest, NextResponse } from "next/server";
import {
  updateAttendanceConfirmation,
  updateCandidacyConfirmation,
  getOrderAdminSnapshotById,
  getArtistByIdBasic,
  getCandidacyDateConflictForSubitem,
  updateOrderStatus,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
} from "@/lib/monday";
import { getSession } from "@/lib/auth";
import { postJsonWebhookOrLog } from "@/lib/webhook";

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
      if (action === "confirm") {
        const conflict = await getCandidacyDateConflictForSubitem(orderId, subitemId);
        if (conflict.hasConflict) {
          return NextResponse.json(
            { error: conflict.message || "לא ניתן לאשר - האומן כבר מאושר באירוע אחר באותו תאריך" },
            { status: 409 }
          );
        }
      }

      await updateCandidacyConfirmation(subitemId, internalLabel);

      const orderDto = await getOrderAdminSnapshotById(orderId);
      if (orderDto) {
        const { requiredCount, status: currentStatus, subitems } = orderDto;
        const confirmedCount = subitems.filter((s) => s.candidacyStatus === "מאושר").length;

        if (action === "confirm" && requiredCount > 0 && confirmedCount >= requiredCount) {
          await updateOrderStatus(orderId, STATUS_ASSIGNMENT_DONE);
        } else if (action === "reject" && currentStatus === STATUS_ASSIGNMENT_DONE) {
          await updateOrderStatus(orderId, STATUS_CANDIDACY_CLOSED);
        }

        if (action === "confirm") {
          const webhookUrl = process.env.ADMIN_CANDIDACY_APPROVED_WEBHOOK_URL?.trim();
          if (webhookUrl) {
            const registration = orderDto.subitems.find((s) => s.id === subitemId);
            if (registration) {
              const firstArtistId = registration.linkedArtistIds[0];
              const artist =
                firstArtistId != null
                  ? await getArtistByIdBasic(String(firstArtistId))
                  : null;

              await postJsonWebhookOrLog(webhookUrl, {
                event: "candidacy_approved",
                approvedAt: new Date().toISOString(),
                admin: { id: session.id, name: session.name },
                order: orderDto,
                registration,
                artist,
              });
            } else {
              console.error(
                "[Webhook] candidacy approved: subitem not in snapshot",
                subitemId
              );
            }
          }
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
