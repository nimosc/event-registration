import { NextRequest, NextResponse } from "next/server";
import {
  getOpenOrders,
  getAllOrders,
  createSubitem,
  deleteSubitem,
  getColumnValue,
  parseLinkedItemIds,
  STATUS_CANCELLED,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANDIDACY_CLOSED,
  ODT_REQUIRED_COLUMN_ID,
} from "@/lib/monday";
import { getSession, getRegistrationRoles, resolveRegistrationRole } from "@/lib/auth";
import type { RegistrationRole } from "@/lib/roles";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, role: requestedRole } = body as { orderId: string; role?: string };

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

    if (status === STATUS_CANCELLED) {
      return NextResponse.json(
        { error: "ההזמנה אינה פתוחה להגשת מועמדות" },
        { status: 400 }
      );
    }

    if (status === STATUS_ASSIGNMENT_DONE) {
      return NextResponse.json(
        { error: "הסתיים השיבוץ — לא ניתן להגיש מועמדות" },
        { status: 400 }
      );
    }

    if (status === STATUS_CANDIDACY_CLOSED) {
      return NextResponse.json(
        { error: "נסגרה קבלת מועמדויות להזמנה זו" },
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

    const userRoles = getRegistrationRoles(session.role);
    if (userRoles.length === 0) {
      return NextResponse.json(
        { error: "תפקידך אינו מאפשר הגשת מועמדות" },
        { status: 403 }
      );
    }
    // באיזה תפקיד נרשמים: מהבקשה (אומן+ODT בוחר), או נגזר כשיש רק אפשרות אחת.
    const requiredArtists = parseFloat(getColumnValue(order, "numeric_mm185aw7")?.text || "0") || 0;
    const requiredOdt = parseFloat(getColumnValue(order, ODT_REQUIRED_COLUMN_ID)?.text || "0") || 0;
    const resolved = resolveRegistrationRole({
      userRoles,
      orderNeeds: { artist: requiredArtists > 0, odt: requiredOdt > 0 },
      requested: requestedRole === "ODT" || requestedRole === "אומן" ? (requestedRole as RegistrationRole) : null,
    });
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 400 });
    }
    const isOdt = resolved.role === "ODT";

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

    // Create subitem
    const subitem = await createSubitem(
      orderId,
      session.name,
      session.id,
      isOdt ? "ODT" : undefined
    );

    return NextResponse.json({
      success: true,
      subitemId: subitem.id,
      role: resolved.role,
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

    // Delete subitem
    await deleteSubitem(subitemId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unregister error:", error);
    return NextResponse.json(
      { error: "שגיאה בביטול המועמדות" },
      { status: 500 }
    );
  }
}
