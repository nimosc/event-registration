import { NextRequest, NextResponse } from "next/server";
import { mondayQuery, BOARDS, getOrderAdminSnapshotById } from "@/lib/monday";
import { getSession } from "@/lib/auth";

type MondayColumnDef = { id: string; title: string; type: string };

async function resolvePhoneColumnId(): Promise<string> {
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
  if (byTitle) return byTitle.id;
  throw new Error("Phone column not found on artists board");
}

function extractPhone(text: string | undefined, value: string | null | undefined): string {
  if (text && text.trim()) return text.trim();
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const raw = (parsed.phone ?? parsed.phoneNumber ?? parsed.number ?? parsed.text ?? "") as string;
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

function normalizeName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

type ArtistPhoneRecord = { id: number; name: string; phone: string };

async function getAllArtistsWithPhones(phoneColumnId: string): Promise<ArtistPhoneRecord[]> {
  const query = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          cursor
          items {
            id
            name
            column_values(ids: ["${phoneColumnId}"]) {
              id text value
            }
          }
        }
      }
    }
  `;

  type PageData = {
    boards: {
      items_page: {
        cursor?: string | null;
        items: { id: string; name: string; column_values: { id: string; text: string; value: string | null }[] }[];
      };
    }[];
  };

  const firstData = await mondayQuery<PageData>(query);
  const firstPage = firstData.boards?.[0]?.items_page;
  const rawItems = [...(firstPage?.items ?? [])];
  let cursor = firstPage?.cursor ?? null;

  while (cursor) {
    const nextData = await mondayQuery<{
      next_items_page: {
        cursor?: string | null;
        items: { id: string; name: string; column_values: { id: string; text: string; value: string | null }[] }[];
      };
    }>(`
      query {
        next_items_page(limit: 500, cursor: "${cursor}") {
          cursor
          items {
            id
            name
            column_values(ids: ["${phoneColumnId}"]) {
              id text value
            }
          }
        }
      }
    `);
    rawItems.push(...(nextData.next_items_page?.items ?? []));
    cursor = nextData.next_items_page?.cursor ?? null;
  }

  return rawItems.map((item) => {
    const col = item.column_values?.[0];
    return {
      id: parseInt(item.id, 10),
      name: item.name,
      phone: extractPhone(col?.text, col?.value),
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    if (session.role !== "מנהל") return NextResponse.json({ error: "גישה נדחתה" }, { status: 403 });

    const orderId = request.nextUrl.searchParams.get("orderId");
    if (!orderId) return NextResponse.json({ error: "חסר orderId" }, { status: 400 });

    const order = await getOrderAdminSnapshotById(orderId);
    if (!order) return NextResponse.json({ error: "הזמנה לא נמצאה" }, { status: 404 });

    const phoneColumnId = await resolvePhoneColumnId();
    const allArtists = await getAllArtistsWithPhones(phoneColumnId);

    // Build lookups: by numeric ID and by normalized name
    const byId = new Map<number, string>();
    const byName = new Map<string, string>();
    for (const a of allArtists) {
      if (a.id > 0) byId.set(a.id, a.phone);
      const key = normalizeName(a.name);
      if (key && !byName.has(key)) byName.set(key, a.phone);
    }

    const registrants = order.subitems.map((sub) => {
      const artistId = sub.linkedArtistIds[0] ?? 0;
      const phone =
        (artistId > 0 ? byId.get(artistId) : undefined) ??
        byName.get(normalizeName(sub.name)) ??
        "";
      return {
        name: sub.name,
        phone,
        role: sub.role,
        candidacyStatus: sub.candidacyStatus,
        attendanceStatus: sub.attendanceStatus,
      };
    });

    return NextResponse.json({ order, registrants });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "שגיאה בייצוא נתונים" }, { status: 500 });
  }
}
