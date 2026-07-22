/**
 * לוגיקת צבירה טהורה לדוח פעילות האומנים.
 *
 * הקובץ הזה חייב להישאר נטול תלות בשרת (אין import ל-monday.ts), כי הוא
 * נטען גם בצד הלקוח — שם מריצים את הצבירה מחדש בכל שינוי פילטר תאריכים,
 * בלי לפנות שוב ל-Monday.
 */
import { sortRegionsForDisplay, UNMAPPED_REGION } from "./venueRegions";

export type ReportMetric = "registered" | "approved" | "attended";

export const REPORT_METRICS: ReportMetric[] = [
  "registered",
  "approved",
  "attended",
];

export type MetricCounts = Record<ReportMetric, number>;

/** רשומת הרשמה בודדת (subitem אחד) — היחידה הגולמית שממנה נבנה הדוח */
export interface RegistrationRecord {
  /** מפתח זהות יציב לאומן (id מלוח האומנים, או שם מנורמל) */
  artistKey: string;
  artistName: string;
  region: string;
  venue: string;
  /** תאריך האירוע בפורמט YYYY-MM-DD; ריק אם אין תאריך על ההזמנה */
  date: string;
  approved: boolean;
  attended: boolean;
}

export interface InstructorRow {
  artistKey: string;
  name: string;
  totals: MetricCounts;
  /** אזור -> ספירה לכל מטריקה */
  byRegion: Record<string, MetricCounts>;
}

export interface InstructorReport {
  /** תוויות האזורים (עמודות), ממוינות; "לא ממופה" אחרון */
  regions: string[];
  rows: InstructorRow[];
  regionTotals: Record<string, MetricCounts>;
  grandTotals: MetricCounts;
  /** מוונועים שלא נמפו לאזור — לתיקון ידני ב-Monday */
  unmappedVenues: Array<{ venue: string; registrations: number }>;
}

export function emptyCounts(): MetricCounts {
  return { registered: 0, approved: 0, attended: 0 };
}

function addRecord(target: MetricCounts, rec: RegistrationRecord): void {
  target.registered += 1;
  if (rec.approved) target.approved += 1;
  if (rec.attended) target.attended += 1;
}

/**
 * מסנן רשומות לפי טווח תאריכים (כולל את הקצוות).
 * רשומות ללא תאריך נשמרות רק כשאין פילטר כלל — אחרת אי אפשר לדעת
 * אם הן בטווח, ועדיף לא לנפח את המספרים.
 */
export function filterByDateRange(
  records: RegistrationRecord[],
  from: string,
  to: string
): RegistrationRecord[] {
  if (!from && !to) return records;
  return records.filter((r) => {
    if (!r.date) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  });
}

/** מסנן לפי טקסט חופשי על שם האומן */
export function filterBySearch(
  records: RegistrationRecord[],
  search: string
): RegistrationRecord[] {
  const q = search.trim().toLowerCase();
  if (!q) return records;
  return records.filter((r) => r.artistName.toLowerCase().includes(q));
}

/** בונה את מטריצת הדוח (אומן × אזור) מתוך רשומות ההרשמה. */
export function buildInstructorReport(
  records: RegistrationRecord[]
): InstructorReport {
  const rowsByKey = new Map<string, InstructorRow>();
  const regionSet = new Set<string>();
  const regionTotals: Record<string, MetricCounts> = {};
  const grandTotals = emptyCounts();
  const unmappedByVenue = new Map<string, number>();

  for (const rec of records) {
    let row = rowsByKey.get(rec.artistKey);
    if (!row) {
      row = {
        artistKey: rec.artistKey,
        name: rec.artistName || "ללא שם",
        totals: emptyCounts(),
        byRegion: {},
      };
      rowsByKey.set(rec.artistKey, row);
    }

    if (rec.region === UNMAPPED_REGION) {
      const venueKey = rec.venue || "(ריק)";
      unmappedByVenue.set(venueKey, (unmappedByVenue.get(venueKey) ?? 0) + 1);
    }

    regionSet.add(rec.region);
    if (!row.byRegion[rec.region]) row.byRegion[rec.region] = emptyCounts();
    addRecord(row.byRegion[rec.region], rec);
    addRecord(row.totals, rec);

    if (!regionTotals[rec.region]) regionTotals[rec.region] = emptyCounts();
    addRecord(regionTotals[rec.region], rec);
    addRecord(grandTotals, rec);
  }

  const unmappedVenues = Array.from(unmappedByVenue.entries())
    .map(([venue, registrations]) => ({ venue, registrations }))
    .sort((a, b) => b.registrations - a.registrations);

  return {
    regions: sortRegionsForDisplay(regionSet),
    rows: Array.from(rowsByKey.values()),
    regionTotals,
    grandTotals,
    unmappedVenues,
  };
}

export type SortDirection = "asc" | "desc";

/**
 * ממיין שורות לפי עמודה: "name" לפי שם, "total" לפי סה״כ,
 * או שם אזור ספציפי. תמיד לפי המטריקה הפעילה.
 */
export function sortRows(
  rows: InstructorRow[],
  sortKey: string,
  direction: SortDirection,
  metric: ReportMetric
): InstructorRow[] {
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortKey === "name") {
      return a.name.localeCompare(b.name, "he") * dir;
    }
    const av =
      sortKey === "total" ? a.totals[metric] : a.byRegion[sortKey]?.[metric] ?? 0;
    const bv =
      sortKey === "total" ? b.totals[metric] : b.byRegion[sortKey]?.[metric] ?? 0;
    if (av !== bv) return (av - bv) * dir;
    return a.name.localeCompare(b.name, "he");
  });
}
