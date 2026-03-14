import { NextResponse } from "next/server";
import { getOpenOrders, getColumnValue, parseLinkedItemIds } from "@/lib/monday";
import { getSession } from "@/lib/auth";

export interface OrderData {
  id: string;
  name: string;
  date: string;
  location: string;
  status: string;
  requiredCount: number;
  assignedCount: number;
  spotsRemaining: number;
  isRegistered: boolean;
  subitemId?: string;
  subitems: SubitemData[];
}

export interface SubitemData {
  id: string;
  name: string;
  linkedArtistIds: number[];
  attendanceStatus: string;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const items = await getOpenOrders();
    const artistId = parseInt(session.id, 10);

    const orders: OrderData[] = items
      .map((item) => {
        const dateCol = getColumnValue(item, "date_mm18mqn2");
        const statusCol = getColumnValue(item, "color_mm18ej76");
        const locationCol = getColumnValue(item, "text_mm1894y7");
        const requiredCol = getColumnValue(item, "numeric_mm185aw7");
        const assignedCol = getColumnValue(item, "numeric_mm18d914");

        const status = statusCol?.text || "";
        const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
        const assignedCount = parseFloat(assignedCol?.text || "0") || 0;

        const subitems: SubitemData[] = (item.subitems || []).map((sub) => {
          const relationCol = sub.column_values.find(
            (cv) => cv.id === "board_relation_mm18r4da"
          );
          const attendanceCol = sub.column_values.find(
            (cv) => cv.id === "color_mm18bjdk"
          );

          return {
            id: sub.id,
            name: sub.name,
            linkedArtistIds: parseLinkedItemIds(relationCol?.value),
            attendanceStatus: attendanceCol?.text || "",
          };
        });

        // Check if current user is registered (by relation ID or name fallback)
        const mySubitem = subitems.find((sub) =>
          sub.linkedArtistIds.includes(artistId) ||
          sub.name.trim() === session.name.trim()
        );

        return {
          id: item.id,
          name: item.name,
          date: dateCol?.text || "",
          location: locationCol?.text || "",
          status,
          requiredCount,
          assignedCount,
          spotsRemaining: Math.max(0, requiredCount - assignedCount),
          isRegistered: !!mySubitem,
          subitemId: mySubitem?.id,
          subitems,
        };
      })
      .filter((order) => order.status === "בתהליך שיבוץ");

    return NextResponse.json({ orders });
  } catch (error) {
    console.error("Orders fetch error:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}
