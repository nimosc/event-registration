import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getAllArtists,
  getOpenOrders,
  getAllOrders,
  getColumnValue,
  parseLinkedItemIds,
  ARTIST_ACTIVE_STATUS_COLUMN_ID,
} from "@/lib/monday";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get("orderId");
    if (!orderId) {
      return NextResponse.json({ error: "orderId חסר" }, { status: 400 });
    }

    const session = await getSession();
    if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    if (session.role !== "מנהל") return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });

    const open = await getOpenOrders();
    let order = open.find((i) => i.id === orderId);
    if (!order) {
      const all = await getAllOrders();
      order = all.find((i) => i.id === orderId);
    }

    if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

    const registeredArtistIds = new Set<number>();
    for (const sub of order.subitems || []) {
      const relationCol = sub.column_values.find((cv) => cv.id === "board_relation_mm18r4da");
      for (const id of parseLinkedItemIds(relationCol?.value)) {
        registeredArtistIds.add(id);
      }
    }

    const artists = await getAllArtists();
    const eligible = artists
      .map((a) => {
        const statusCol = getColumnValue(a, ARTIST_ACTIVE_STATUS_COLUMN_ID);
        const statusText = (statusCol?.text || "").trim();
        return { id: a.id, name: a.name, statusText };
      })
      .filter((a) => a.statusText && a.statusText !== "לא פעיל")
      .filter((a) => !registeredArtistIds.has(parseInt(a.id, 10)));

    eligible.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return NextResponse.json({ artists: eligible.map((a) => ({ id: a.id, name: a.name })) });
  } catch (error) {
    console.error("Get assignable artists error:", error);
    return NextResponse.json({ error: "שגיאה בטעינת האומנים" }, { status: 500 });
  }
}

