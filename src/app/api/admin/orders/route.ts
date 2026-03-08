import { NextResponse } from "next/server";
import { getAllOrders, getColumnValue, parseColorLabel, parseLinkedItemIds } from "@/lib/monday";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    if (session.role !== "מנהל") {
      return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });
    }

    const items = await getAllOrders();

    const orders = items.map((item) => {
      const dateCol = getColumnValue(item, "date_mm18mqn2");
      const statusCol = getColumnValue(item, "color_mm18ej76");
      const locationCol = getColumnValue(item, "text_mm1894y7");
      const requiredCol = getColumnValue(item, "numeric_mm185aw7");
      const assignedCol = getColumnValue(item, "numeric_mm18d914");

      const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
      const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

      const subitems = (item.subitems || []).map((sub) => {
        const relationCol = sub.column_values.find(
          (cv) => cv.id === "board_relation_mm18r4da"
        );
        const roleCol = sub.column_values.find(
          (cv) => cv.id === "dropdown_mm18519p"
        );
        const attendanceCol = sub.column_values.find(
          (cv) => cv.id === "color_mm18bjdk"
        );

        return {
          id: sub.id,
          name: sub.name,
          linkedArtistIds: parseLinkedItemIds(relationCol?.value),
          role: roleCol?.text || "",
          attendanceStatus: attendanceCol?.text || "",
        };
      });

      return {
        id: item.id,
        name: item.name,
        date: dateCol?.text || "",
        location: locationCol?.text || "",
        status: statusCol?.text || "",
        requiredCount,
        assignedCount,
        spotsRemaining: Math.max(0, requiredCount - assignedCount),
        subitems,
      };
    });

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Admin orders fetch error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}
