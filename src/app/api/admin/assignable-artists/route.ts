import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getAllArtists,
  getOpenOrders,
  getAllOrders,
  getColumnValue,
  parseLinkedItemIds,
  ARTIST_ACTIVE_STATUS_COLUMN_ID,
  mondayQuery,
  BOARDS,
} from "@/lib/monday";

type MondayColumnDef = { id: string; title: string; type: string };

async function resolvePhoneColumnId(): Promise<string | null> {
  try {
    const data = await mondayQuery<{ boards: { columns: MondayColumnDef[] }[] }>(`
      query {
        boards(ids: [${BOARDS.ARTISTS}]) {
          columns { id title type }
        }
      }
    `);
    const columns = data.boards?.[0]?.columns ?? [];
    const byType = columns.find((c) => c.type === "phone");
    if (byType) return byType.id;
    const byTitle = columns.find((c) => /טלפון|נייד|פלאפון/i.test(c.title));
    return byTitle?.id ?? null;
  } catch {
    return null;
  }
}

function extractPhone(text: string | undefined, value: string | null | undefined): string {
  if (text?.trim()) return text.trim();
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const raw = (parsed.phone ?? parsed.phoneNumber ?? parsed.number ?? parsed.text ?? "") as string;
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

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

    const [openOrders, phoneColumnId] = await Promise.all([
      getOpenOrders(),
      resolvePhoneColumnId(),
    ]);

    let order = openOrders.find((i) => i.id === orderId);
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

    const extraCols = phoneColumnId ? [phoneColumnId] : [];
    const artists = await getAllArtists(extraCols);

    const eligible = artists
      .map((a) => {
        const statusCol = getColumnValue(a, ARTIST_ACTIVE_STATUS_COLUMN_ID);
        const statusText = (statusCol?.text || "").trim();
        const phoneCol = phoneColumnId
          ? a.column_values.find((cv) => cv.id === phoneColumnId)
          : undefined;
        const phone = extractPhone(phoneCol?.text, phoneCol?.value);
        return { id: a.id, name: a.name, statusText, phone };
      })
      .filter((a) => a.statusText && a.statusText !== "לא פעיל")
      .filter((a) => !registeredArtistIds.has(parseInt(a.id, 10)));

    eligible.sort((a, b) => a.name.localeCompare(b.name, "he"));
    return NextResponse.json({ artists: eligible.map((a) => ({ id: a.id, name: a.name, phone: a.phone })) });
  } catch (error) {
    console.error("Get assignable artists error:", error);
    return NextResponse.json({ error: "שגיאה בטעינת האומנים" }, { status: 500 });
  }
}
