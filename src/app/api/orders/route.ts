import { NextResponse } from "next/server";
import {
  getOpenOrders,
  getColumnValue,
  parseLinkedItemIds,
  ORDER_LOCATION_COLUMN_ID,
  ORDER_ACTIVITY_HOURS_COLUMN_ID,
  ODT_REQUIRED_COLUMN_ID,
  STATUS_OPEN,
  STATUS_CANDIDACY_CLOSED,
  STATUS_ASSIGNMENT_DONE,
  STATUS_CANCELLED,
  parseDropdownLabel,
  mapMondayAttendanceToInternal,
  mapMondayCandidacyToInternal,
  CANDIDACY_STATUS_COLUMN_ID,
  getLiveArtistRole,
  getOrderCapacityState,
  isRegistrationOpenForRole,
  isOrderOpenForRegistration,
  countApprovedCandidaciesForRole,
  getRegisteredCountsFromMondaySubitems,
  getSubitemRegistrationRoleFromMondayColumns,
  registrationRoleToArtistType,
} from "@/lib/monday";
import { getSession, createSession, setSessionCookie, getRegistrationRoles } from "@/lib/auth";
import type { RegistrationRole } from "@/lib/roles";

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
  /** דרישת התפקיד של המשתמש המחובר */
  roleCapacityCeiling: number;
  /** כמה נרשמו לתפקיד של המשתמש המחובר */
  roleApplied: number;
  /** כמה מאושרים לתפקיד של המשתמש המחובר */
  roleApproved: number;
  roleLabel: "ODT" | "אומנים";
  artistCapacityCeiling: number;
  odtCapacityCeiling: number;
  spotsRemaining: number;
  isRoleOpen: boolean;
  isRoleFull: boolean;
  canRegister: boolean;
  /** התפקידים שבהם המשתמש יכול להירשם להזמנה הזו (חיתוך תפקידיו עם צורכי ההזמנה) */
  roleOptions: RoleOption[];
  /** באיזה תפקיד המשתמש רשום (אם רשום) */
  registeredAs?: RegistrationRole;
  isRegistered: boolean;
  subitemId?: string;
  candidacyStatus?: string;
  subitems: SubitemData[];
}

export interface RoleOption {
  role: RegistrationRole;
  label: "ODT" | "אומנים";
  required: number;
  applied: number;
  approved: number;
  isFull: boolean;
  isOpen: boolean;
  spotsRemaining: number;
}

export interface SubitemData {
  id: string;
  name: string;
  linkedArtistIds: number[];
  attendanceStatus: string;
  candidacyStatus: string;
  artistType: string;
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

    // Role refresh and the orders fetch are independent — run them in parallel
    const [liveRole, items] = await Promise.all([
      getLiveArtistRole(session.id),
      getOpenOrders(),
    ]);
    let roleRefreshed = false;
    if (liveRole && liveRole !== session.role) {
      console.log(`[/api/orders] role changed ${session.role} → ${liveRole}, refreshing JWT`);
      session = { ...session, role: liveRole };
      roleRefreshed = true;
    }

    const userRoles = getRegistrationRoles(session.role);
    console.log(`[/api/orders] session ok (${session.name}, role: ${session.role})`);
    console.log(`[/api/orders] got ${items.length} items from Monday in ${Date.now() - start}ms`);
    const artistId = parseInt(session.id, 10);

    const orders: OrderData[] = items
      .map((item) => {
        const dateCol = getColumnValue(item, "date_mm18mqn2");
        const statusCol = getColumnValue(item, "color_mm18ej76");
        const locationCol = getColumnValue(item, "text_mm1894y7");
        const requiredCol = getColumnValue(item, "numeric_mm185aw7");
        const odtRequiredCol = getColumnValue(item, ODT_REQUIRED_COLUMN_ID);
        const orderLocationCol = getColumnValue(item, ORDER_LOCATION_COLUMN_ID);
        const activityHoursCol = getColumnValue(item, ORDER_ACTIVITY_HOURS_COLUMN_ID);

        const status = statusCol?.text || "";
        const requiredCount = parseFloat(requiredCol?.text || "0") || 0;
        const odtRequired = parseFloat(odtRequiredCol?.text || "0") || 0;

        const subitems: SubitemData[] = (item.subitems || []).map((sub) => {
          const relationCol = sub.column_values.find(
            (cv) => cv.id === "board_relation_mm18r4da"
          );
          const attendanceCol = sub.column_values.find(
            (cv) => cv.id === "color_mm18bjdk"
          );
          const candidacyCol = sub.column_values.find(
            (cv) => cv.id === CANDIDACY_STATUS_COLUMN_ID
          );
          const registrationRole = getSubitemRegistrationRoleFromMondayColumns(sub.column_values);

          return {
            id: sub.id,
            name: sub.name,
            linkedArtistIds: parseLinkedItemIds(relationCol?.value),
            attendanceStatus: mapMondayAttendanceToInternal(attendanceCol?.text || ""),
            candidacyStatus: mapMondayCandidacyToInternal(candidacyCol?.text || ""),
            artistType: registrationRoleToArtistType(registrationRole),
          };
        });

        const approvedArtist = countApprovedCandidaciesForRole(subitems, "אומן");
        const approvedOdt = countApprovedCandidaciesForRole(subitems, "ODT");
        const registered = getRegisteredCountsFromMondaySubitems(item.subitems || []);
        const capacity = getOrderCapacityState(
          requiredCount,
          approvedArtist,
          odtRequired,
          approvedOdt
        );
        const artistCapacity = capacity.artist.required;
        const odtCapacity = capacity.odt.required;

        const mySubitem = subitems.find((sub) =>
          sub.linkedArtistIds.includes(artistId) ||
          sub.name.trim() === session.name.trim()
        );

        const orderLocation =
          orderLocationCol?.text?.trim() || parseDropdownLabel(orderLocationCol?.value)?.trim() || "";
        // אפשרויות ההרשמה של המשתמש הזה בהזמנה הזו — אומן+ODT יכול לקבל שתיים.
        const roleOptions: RoleOption[] = userRoles
          .filter((r) => (r === "ODT" ? odtRequired > 0 : requiredCount > 0))
          .map((r) => {
            const isO = r === "ODT";
            const st = isO ? capacity.odt : capacity.artist;
            return {
              role: r,
              label: isO ? "ODT" : "אומנים",
              required: st.required,
              applied: isO ? registered.odt : registered.artist,
              approved: st.approved,
              isFull: st.isFull,
              isOpen: isRegistrationOpenForRole(r, capacity),
              spotsRemaining: st.required > 0 ? Math.max(0, st.required - st.approved) : 999,
            };
          });
        // השדות היחידניים הישנים ממולאים מהאפשרות הראשונה (תאימות למסכים קיימים).
        const primary = roleOptions[0];
        const isOdt = primary?.role === "ODT";
        const registrationRole: RegistrationRole = isOdt ? "ODT" : "אומן";
        const roleState = isOdt ? capacity.odt : capacity.artist;
        const roleCapacityCeiling = roleState.required;
        const roleApproved = roleState.approved;
        const roleApplied = isOdt ? registered.odt : registered.artist;
        const canRegister =
          roleOptions.some((o) => o.isOpen) && isOrderOpenForRegistration(status);
        const registeredAs: RegistrationRole | undefined = mySubitem
          ? mySubitem.artistType === "ODT" ? "ODT" : "אומן"
          : undefined;

        return {
          id: item.id,
          name: item.name,
          date: dateCol?.text || "",
          location: locationCol?.text || "",
          activityHours: (activityHoursCol?.text || "").trim(),
          orderLocation,
          status,
          requiredCount,
          assignedCount: registered.artist,
          odtRequired,
          odtAssigned: registered.odt,
          roleCapacityCeiling,
          roleApplied,
          roleApproved,
          roleLabel: (isOdt ? "ODT" : "אומנים") as "ODT" | "אומנים",
          artistCapacityCeiling: artistCapacity,
          odtCapacityCeiling: odtCapacity,
          isRoleOpen: isRegistrationOpenForRole(registrationRole, capacity),
          isRoleFull: roleState.isFull,
          canRegister,
          roleOptions,
          registeredAs,
          spotsRemaining:
            roleCapacityCeiling > 0
              ? Math.max(0, roleCapacityCeiling - roleApproved)
              : 999,
          isRegistered: !!mySubitem,
          subitemId: mySubitem?.id,
          candidacyStatus: mySubitem?.candidacyStatus || undefined,
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
        // מוצגות רק הזמנות שצריכות לפחות אחד מתפקידי המשתמש; מנהל טהור — כלום
        return order.roleOptions.length > 0;
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
