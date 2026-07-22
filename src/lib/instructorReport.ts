import {
  BOARDS,
  mondayQuery,
  getColumnValue,
  parseDropdownLabel,
  getLinkedItemIdsAsNumbers,
  isMondayCandidacyApproved,
  getAllArtists,
  ORDER_LOCATION_COLUMN_ID,
  CANDIDACY_STATUS_COLUMN_ID,
  MONDAY_COLUMN_VALUE_FIELDS,
  type MondayBoard,
  type MondayItem,
} from "./monday";
import { resolveRegionForVenue } from "./venueRegions";
import type { RegistrationRecord } from "./instructorReportCore";

/** עמודת אזור (dropdown) על הזמנה — משותפת עם העדפת אזור של אומן */
const ORDER_REGION_COLUMN_ID = ORDER_LOCATION_COLUMN_ID; // dropdown_mm1qvq5q
/** עמודת מיקום חופשי (טקסט) — המקור בפועל לאזור, דרך טבלת המיפוי */
const ORDER_VENUE_COLUMN_ID = "text_mm1894y7";
const ORDER_DATE_COLUMN_ID = "date_mm18mqn2";
const SUBITEM_ARTIST_RELATION_COLUMN_ID = "board_relation_mm18r4da";
const SUBITEM_ATTENDANCE_COLUMN_ID = "color_mm18bjdk";

export interface InstructorActivityPayload {
  registrations: RegistrationRecord[];
  generatedAt: string;
}

function normalizeNameKey(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** מחלץ YYYY-MM-DD מעמודת תאריך של Monday (value כ-JSON, או text) */
function parseOrderDate(item: MondayItem): string {
  const col = getColumnValue(item, ORDER_DATE_COLUMN_ID);
  if (col?.value) {
    try {
      const parsed = JSON.parse(col.value) as { date?: string };
      if (typeof parsed?.date === "string" && parsed.date) return parsed.date;
    } catch {
      // ממשיכים ל-text
    }
  }
  const match = (col?.text || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

/**
 * מחזיר את האזור של ההזמנה ואת שם המוונוע שממנו הוא נגזר.
 * אם עמודת האזור (dropdown) מאוישת — היא קובעת. כיום היא ריקה בכל ההזמנות,
 * ולכן בפועל האזור נגזר משם המוונוע דרך טבלת המיפוי.
 */
function resolveOrderRegion(item: MondayItem): { region: string; venue: string } {
  const venue = (getColumnValue(item, ORDER_VENUE_COLUMN_ID)?.text || "").trim();

  const regionCol = getColumnValue(item, ORDER_REGION_COLUMN_ID);
  const explicitRegion =
    regionCol?.text?.trim() || parseDropdownLabel(regionCol?.value)?.trim() || "";
  if (explicitRegion) return { region: explicitRegion, venue };

  return { region: resolveRegionForVenue(venue), venue };
}

/** ממיר הזמנות + subitems לרשומות הרשמה שטוחות */
export function extractRegistrations(
  orders: MondayItem[],
  artistNameById: Map<string, string>
): RegistrationRecord[] {
  const out: RegistrationRecord[] = [];

  for (const order of orders) {
    const { region, venue } = resolveOrderRegion(order);
    const date = parseOrderDate(order);

    for (const sub of order.subitems || []) {
      const relationCol = sub.column_values.find(
        (cv) => cv.id === SUBITEM_ARTIST_RELATION_COLUMN_ID
      );
      const candidacyCol = sub.column_values.find(
        (cv) => cv.id === CANDIDACY_STATUS_COLUMN_ID
      );
      const attendanceCol = sub.column_values.find(
        (cv) => cv.id === SUBITEM_ATTENDANCE_COLUMN_ID
      );

      const linkedIds = getLinkedItemIdsAsNumbers(relationCol);
      const artistId = linkedIds.length > 0 ? String(linkedIds[0]) : null;
      const rawName = (sub.name || "").trim();
      // subitem ללא שם וללא קישור — לא ניתן לשייך לאומן
      if (!artistId && !rawName) continue;

      // זהות: קישור ללוח האומנים אם קיים, אחרת שם מנורמל
      const artistKey = artistId
        ? `id:${artistId}`
        : `name:${normalizeNameKey(rawName)}`;
      const artistName =
        (artistId && artistNameById.get(artistId)) || rawName || "ללא שם";

      out.push({
        artistKey,
        artistName,
        region,
        venue,
        date,
        approved: isMondayCandidacyApproved(candidacyCol?.text),
        attended: (attendanceCol?.text || "").trim() === "הגיע",
      });
    }
  }

  return out;
}

async function fetchOrdersForReport(): Promise<MondayItem[]> {
  const query = `
    query {
      boards(ids: [${BOARDS.ORDERS}]) {
        items_page(limit: 200) {
          items {
            id
            name
            column_values(ids: ["${ORDER_REGION_COLUMN_ID}", "${ORDER_VENUE_COLUMN_ID}", "${ORDER_DATE_COLUMN_ID}"]) {
              id
              text
              value
            }
            subitems {
              id
              name
              column_values(ids: ["${SUBITEM_ARTIST_RELATION_COLUMN_ID}", "${CANDIDACY_STATUS_COLUMN_ID}", "${SUBITEM_ATTENDANCE_COLUMN_ID}"]) {
                ${MONDAY_COLUMN_VALUE_FIELDS}
              }
            }
          }
        }
      }
    }
  `;
  const data = await mondayQuery<{ boards: MondayBoard[] }>(query);
  return data.boards[0]?.items_page?.items ?? [];
}

/**
 * שולף את רשומות ההרשמה הגולמיות (מקור אמת: subitems ב-Monday).
 * הצבירה עצמה נעשית בצד הלקוח, כדי שפילטרים יגיבו מיידית.
 */
export async function getInstructorActivityData(): Promise<InstructorActivityPayload> {
  const [orders, artists] = await Promise.all([
    fetchOrdersForReport(),
    getAllArtists(),
  ]);

  const artistNameById = new Map<string, string>();
  for (const artist of artists) {
    artistNameById.set(String(artist.id), (artist.name || "").trim());
  }

  return {
    registrations: extractRegistrations(orders, artistNameById),
    generatedAt: new Date().toISOString(),
  };
}
