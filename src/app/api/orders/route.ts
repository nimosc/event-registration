import { NextResponse } from "next/server";
import {
  getOpenOrders,
  getColumnValue,
  parseLinkedItemIds,
  ORDER_LOCATION_COLUMN_ID,
  ORDER_ACTIVITY_HOURS_COLUMN_ID,
  ODT_REQUIRED_COLUMN_ID,
  ODT_ASSIGNED_COLUMN_ID,
  STATUS_OPEN,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANCELLED,
  parseDropdownLabel,
  mapMondayAttendanceToInternal,
  getLiveArtistRole,
  getOrderCapacityState,
  isRegistrationOpenForRole,
  getCandidacyOrderStatusFromCapacity,
} from "@/lib/monday";
import { getSession, createSession, setSessionCookie } from "@/lib/auth";

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
  odtRequired: number;
  odtAssigned: number;
  /** מכסת התפקיד של המשתמש המחובר (תקרה 150%) */
  roleCapacityCeiling: number;
  /** כמה נרשמו לתפקיד של המשתמש המחובר */
  roleApplied: number;
  roleLabel: "ODT" | "אומנים";
  artistCapacityCeiling: number;
  odtCapacityCeiling: number;
  spotsRemaining: number;
  isRoleOpen: boolean;
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
    let session = await getSession();
    if (!session) {
      console.log("[/api/orders] no session → 401");
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    // Refresh role from Monday on every page load so changes take effect immediately
    const liveRole = await getLiveArtistRole(session.id);
    let roleRefreshed = false;
    if (liveRole && liveRole !== session.role) {
      console.log(`[/api/orders] role changed ${session.role} → ${liveRole}, refreshing JWT`);
      session = { ...session, role: liveRole };
      roleRefreshed = true;
    }

    console.log(`[/api/orders] session ok (${session.name}, role: ${session.role}), fetching orders...`);

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
        const odtRequiredCol = getColumnValue(item, ODT_REQUIRED_COLUMN_ID);
        const odtAssignedCol = getColumnValue(item, ODT_ASSIGNED_COLUMN_ID);
        const orderLocationCol = getColumnValue(item, ORDER_LOCATION_COLUMN_ID);
        const activityHoursCol = getColumnValue(item, ORDER_ACTIVITY_HOURS_COLUMN_ID);

        const status = statusCol?.text || "";
        const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
        const assignedCount = parseFloat(assignedCol?.text || "0") || 0;
        const odtRequired = parseFloat(odtRequiredCol?.text || "0") || 0;
        const odtAssigned = parseFloat(odtAssignedCol?.text || "0") || 0;
        const capacity = getOrderCapacityState(
          requiredCount,
          assignedCount,
          odtRequired,
          odtAssigned
        );
        const artistCapacity = capacity.artist.capacityLimit;
        const odtCapacity = capacity.odt.capacityLimit;

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
        const effectiveStatus = getCandidacyOrderStatusFromCapacity(capacity, status);
        const registrationRole = session.role === "ODT" ? "ODT" : "אומן";
        const isOdt = session.role === "ODT";
        const roleState = isOdt ? capacity.odt : capacity.artist;
        const roleCapacityCeiling = roleState.capacityLimit;
        const roleApplied = roleState.assigned;

        return {
          id: item.id,
          name: item.name,
          date: dateCol?.text || "",
          location: locationCol?.text || "",
          activityHours: (activityHoursCol?.text || "").trim(),
          orderLocation,
          status: effectiveStatus,
          requiredCount,
          assignedCount,
          odtRequired,
          odtAssigned,
          roleCapacityCeiling,
          roleApplied,
          roleLabel: (isOdt ? "ODT" : "אומנים") as "ODT" | "אומנים",
          artistCapacityCeiling: artistCapacity,
          odtCapacityCeiling: odtCapacity,
          isRoleOpen:
            effectiveStatus !== STATUS_ASSIGNMENT_DONE &&
            isRegistrationOpenForRole(registrationRole, capacity),
          spotsRemaining:
            roleCapacityCeiling > 0
              ? Math.max(0, roleCapacityCeiling - roleApplied)
              : 999,
          isRegistered: !!mySubitem,
          subitemId: mySubitem?.id,
          subitems,
        };
      })
      .filter((order) =>
        order.status === STATUS_OPEN ||
        order.status === STATUS_ASSIGNMENT_DONE ||
        order.status === STATUS_CANDIDACY_CLOSED ||
        order.status === STATUS_CANCELLED
      )
      .filter((order) => {
        if (session.role === "ODT") return order.odtRequired > 0;
        if (session.role === "אומן") return order.requiredCount > 0;
        return true;
      });

    console.log(`[/api/orders] returning ${orders.length} orders (total ${Date.now() - start}ms)`);
    if (roleRefreshed) {
      const newToken = await createSession(session);
      await setSessionCookie(newToken);
    }
    return NextResponse.json({ orders, roleRefreshed });
  } catch (error) {
    console.error(`[/api/orders] error after ${Date.now() - start}ms:`, error);
    return NextResponse.json(
      { error: "שגיאה בטעינת הזמנות" },
      { status: 500 }
    );
  }
}
