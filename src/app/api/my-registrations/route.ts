import { NextResponse } from "next/server";
import { getAllOrders, getColumnValue, parseColorLabel, parseLinkedItemIds } from "@/lib/monday";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const artistId = parseInt(session.id, 10);
    const items = await getAllOrders();

    const myRegistrations: {
      orderId: string;
      orderName: string;
      date: string;
      location: string;
      orderStatus: string;
      subitemId: string;
      attendanceStatus: string;
      role: string;
    }[] = [];

    for (const order of items) {
      const dateCol = getColumnValue(order, "date_mm18mqn2");
      const statusCol = getColumnValue(order, "color_mm18ej76");
      const locationCol = getColumnValue(order, "text_mm1894y7");

      const subitems = order.subitems || [];

      for (const sub of subitems) {
        const relationCol = sub.column_values.find(
          (cv) => cv.id === "board_relation_mm18r4da"
        );
        const attendanceCol = sub.column_values.find(
          (cv) => cv.id === "color_mm18bjdk"
        );
        const roleCol = sub.column_values.find(
          (cv) => cv.id === "dropdown_mm18519p"
        );

        const linkedIds = parseLinkedItemIds(relationCol?.value);

        if (linkedIds.includes(artistId) || sub.name.trim() === session.name.trim()) {
          myRegistrations.push({
            orderId: order.id,
            orderName: order.name,
            date: dateCol?.text || "",
            location: locationCol?.text || "",
            orderStatus: statusCol?.text || "",
            subitemId: sub.id,
            attendanceStatus: attendanceCol?.text || "",
            role: roleCol?.text || "",
          });
        }
      }
    }

    return NextResponse.json({ registrations: myRegistrations });
  } catch (error) {
    console.error("My registrations fetch error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הרישומים שלי" },
      { status: 500 }
    );
  }
}
