import { NextRequest, NextResponse } from "next/server";
import {
  updateAttendanceConfirmation,
  updateCandidacyConfirmation,
  getOrderAdminSnapshotById,
  getOrderById,
  getColumnValue,
  getArtistByIdBasic,
  getCandidacyDateConflictForSubitem,
  updateOrderStatus,
  getOrderCapacityState,
  getCandidacyOrderStatusFromCapacity,
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

    // #region agent log
    console.log("[DBG H6] confirm request", { orderId, subitemId, action, mode });
    fetch("http://127.0.0.1:7442/ingest/30911afa-0e0f-4dec-b9b6-19b34bf7d632", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e21a1" },
      body: JSON.stringify({
        sessionId: "8e21a1",
        runId: "initial",
        hypothesisId: "H6",
        location: "src/app/api/admin/confirm/route.ts:PATCH",
        message: "Received confirm request",
        data: { orderId, subitemId, action, mode },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

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
        // #region agent log
        console.log("[DBG H6] conflict result", { orderId, subitemId, hasConflict: conflict.hasConflict });
        fetch("http://127.0.0.1:7442/ingest/30911afa-0e0f-4dec-b9b6-19b34bf7d632", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "8e21a1" },
          body: JSON.stringify({
            sessionId: "8e21a1",
            runId: "initial",
            hypothesisId: "H6",
            location: "src/app/api/admin/confirm/route.ts:PATCH",
            message: "Conflict check result before candidacy confirm",
            data: { orderId, subitemId, hasConflict: conflict.hasConflict },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion
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
        const { requiredCount, requiredOdtCount, status: currentStatus, subitems } = orderDto;
        const totalRequired = requiredCount + (requiredOdtCount ?? 0);
        const confirmedCount = subitems.filter((s) => s.candidacyStatus === "מאושר").length;
        let nextStatus = currentStatus;

        if (action === "confirm" && totalRequired > 0 && confirmedCount >= totalRequired) {
          await updateOrderStatus(orderId, STATUS_ASSIGNMENT_DONE);
          nextStatus = STATUS_ASSIGNMENT_DONE;
        } else {
          const liveOrder = await getOrderById(orderId);
          if (liveOrder) {
            const requiredCol = getColumnValue(liveOrder, "numeric_mm185aw7");
            const requiredOdtCol = getColumnValue(liveOrder, "numeric_mm387qc7");
            const artistAssignedCol = getColumnValue(liveOrder, "numeric_mm18d914");
            const odtAssignedCol = getColumnValue(liveOrder, "numeric_mm3b6rnr");
            const requiredArtist = parseFloat(requiredCol?.text || "0") || 0;
            const requiredOdt = parseFloat(requiredOdtCol?.text || "0") || 0;
            const assignedArtist = parseFloat(artistAssignedCol?.text || "0") || 0;
            const assignedOdt = parseFloat(odtAssignedCol?.text || "0") || 0;
            const capacity = getOrderCapacityState(
              requiredArtist,
              assignedArtist,
              requiredOdt,
              assignedOdt
            );
            const desiredStatus = getCandidacyOrderStatusFromCapacity(capacity, currentStatus);
            if (desiredStatus !== currentStatus) {
              await updateOrderStatus(orderId, desiredStatus);
              nextStatus = desiredStatus;
            }
          }
        }

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
              event: action === "confirm" ? "candidacy_approved" : "candidacy_rejected",
              decidedAt: new Date().toISOString(),
              admin: { id: session.id, name: session.name },
              order: { ...orderDto, status: nextStatus },
              registration,
              artist,
            });
          } else {
            console.error(
              "[Webhook] candidacy decision: subitem not in snapshot",
              subitemId
            );
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
