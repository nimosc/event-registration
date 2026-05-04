import { NextResponse } from "next/server";
import {
  getOpenOrders,
  getColumnValue,
  parseLinkedItemIds,
  ORDER_LOCATION_COLUMN_ID,
  ORDER_ACTIVITY_HOURS_COLUMN_ID,
  STATUS_OPEN,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
  parseDropdownLabel,
  mapMondayAttendanceToInternal,
} from "@/lib/monday";
import { getSession } from "@/lib/auth";

export interface OrderData {
  id: string;
  name: string;
  date: string;
  location: string;
  /** שעות פעילות */
  activityHours: string;
  orderLocation: string;
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
  const start = Date.now();
  try {
    console.log("[/api/orders] GET start");
    const session = await getSession();
    if (!session) {
      console.log("[/api/orders] no session → 401");
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }
    console.log(`[/api/orders] session ok (${session.name}), fetching orders...`);

    const items = await getOpenOrders();
    console.log(`[/api/orders] got ${items.length} items from Monday in ${Date.now() - start}ms`);
    const artistId = parseInt(session.id, 10);

    const orders: OrderData[] = items
      .map((item) => {
        const dateCol = getColumnValue(item, "date_mm18mqn2");
        const statusCol = getColumnValue(item, "color_mm18ej76");
        const locationCol = getColumnValue(item, "text_mm1894y7");
        const requiredCol = getColumnValue(item, "numeric_mm185aw7");
        const assignedCol = getColumnValue(item, "numeric_mm18d914");
        const orderLocationCol = getColumnValue(item, ORDER_LOCATION_COLUMN_ID);
        const activityHoursCol = getColumnValue(item, ORDER_ACTIVITY_HOURS_COLUMN_ID);

        const status = statusCol?.text || "";
        const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
        const assignedCount = parseFloat(assignedCol?.text || "0") || 0;
        const capacityLimit = requiredCount > 0 ? Math.ceil(requiredCount * 1.5) : 0;

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
            attendanceStatus: mapMondayAttendanceToInternal(attendanceCol?.text || ""),
          };
        });

        const mySubitem = subitems.find((sub) =>
          sub.linkedArtistIds.includes(artistId) ||
          sub.name.trim() === session.name.trim()
        );

        const orderLocation =
          orderLocationCol?.text?.trim() || parseDropdownLabel(orderLocationCol?.value)?.trim() || "";

        return {
          id: item.id,
          name: item.name,
          date: dateCol?.text || "",
          location: locationCol?.text || "",
          activityHours: (activityHoursCol?.text || "").trim(),
          orderLocation,
          status,
          requiredCount,
          assignedCount,
          spotsRemaining: capacityLimit > 0 ? Math.max(0, capacityLimit - assignedCount) : 999,
          isRegistered: !!mySubitem,
          subitemId: mySubitem?.id,
          subitems,
        };
      })
      .filter((order) =>
        order.status === STATUS_OPEN ||
        order.status === STATUS_ASSIGNMENT_DONE ||
        order.status === STATUS_CANDIDACY_CLOSED
      );

    console.log(`[/api/orders] returning ${orders.length} orders (total ${Date.now() - start}ms)`);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error(`[/api/orders] error after ${Date.now() - start}ms:`, error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}
