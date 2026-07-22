/**
 * מיפוי מוונוע (טקסט חופשי על ההזמנה) לאזור.
 *
 * רקע: עמודת האזור (dropdown) על לוח ההזמנות ריקה בכל ההזמנות, ולכן המידע
 * הגאוגרפי היחיד הוא שם המקום בטקסט חופשי (text_mm1894y7) — עם שגיאות כתיב
 * וריאציות. המיפוי כאן מבוסס מילות מפתח כדי לספוג וריאציות
 * ("שפיים" / "מלון שפיים" / "שפים").
 *
 * מקומות שלא ניתן לשייך בוודאות נשארים תחת UNMAPPED_REGION — במכוון.
 * עדיף להציג "לא ממופה" מאשר לשייך לאזור שגוי בשקט.
 */

export const REGION_SOUTH = "דרום";
export const REGION_CENTER = "ירושלים ומרכז";
export const REGION_NORTH = "פרדס חנה וצפונה";
export const UNMAPPED_REGION = "לא ממופה";

/** שלושת האזורים האמיתיים, לפי אוצר המילים של עמודת האזור בלוח האומנים */
export const REGIONS = [REGION_SOUTH, REGION_CENTER, REGION_NORTH] as const;

export type Region = string;

/**
 * מילות מפתח לכל אזור. ההתאמה היא "מכיל" על השם המנורמל.
 * סדר הבדיקה: הרשימות נבדקות לפי הסדר כאן, והתאמה ארוכה יותר מנצחת
 * (ראה resolveRegionForVenue) — כדי ש"ניר עציון" (צפון) לא יתנגש
 * עם "כפר עציון" (מרכז).
 */
const REGION_KEYWORDS: Array<{ region: Region; keywords: string[] }> = [
  {
    region: REGION_SOUTH,
    keywords: [
      "אשקלון",
      "ניצן",
      "מיצן",
      "להבים",
      "נגב",
      "גלי תמר",
      "שדה תימן",
      "באר שבע",
    ],
  },
  {
    region: REGION_CENTER,
    keywords: [
      "ירושלים",
      "נווה אילן",
      "נוווה אילן",
      "נווה אעילן",
      "יערים",
      "שפיים",
      "שפים",
      "בית ברל",
      "כפר סבא",
      "מכביה",
      "וינגייט",
      "בית חשמונאי",
      "רמת גן",
      "הרצליה",
      "תל אביב",
      "כפר עציון",
      "עץ הזית",
      "שדה חמד",
      "פארק",
    ],
  },
  {
    region: REGION_NORTH,
    keywords: [
      "חיספין",
      "גולן",
      "רביד",
      "האון",
      "דריה",
      "דרייה",
      "זכרון",
      "זיכרון",
      "עדן אין",
      "ניר עציון",
      "גיר עציון",
      "חוף דור",
      "חיפה",
      "כרמל",
      "נוף הגליל",
      "כנרת",
      "אולגה",
      "בנימינה",
      "פרדס חנה",
      "כרמים",
      "טבריה",
      "צפת",
    ],
  },
];

/**
 * מקומות שנבדקו ידנית ואי אפשר לשייך בוודאות (שמות עמומים / רשומות בדיקה /
 * טקסט שאינו מקום). מוחזרים כ"לא ממופה" במפורש, כדי שלא ייתפסו בטעות
 * על ידי מילת מפתח כלשהי.
 */
const EXPLICIT_UNMAPPED = new Set(
  [
    "דן פנורמה", // קיים גם בחיפה וגם בתל אביב — לא חד־משמעי
    "מלון רמדה",
    "מערת הפלמח ומחנה הקיבוצים",
    "בית הארחה רצון",
    "שדמות",
    "אין הד",
    "פלח גולד",
    "סברה",
    "אסיידבה ביישר",
    "עמוד בסיס",
    "ישירים",
    "שניים",
    "צוותי רפואה פעימה ב מקח״ר",
    "יבמ\"ש מטב\"ל",
  ].map((s) => normalizeVenue(s))
);

export function normalizeVenue(venue: string): string {
  return (venue || "").trim().replace(/\s+/g, " ");
}

/**
 * מחזיר את האזור עבור שם מוונוע.
 * ההתאמה הארוכה ביותר מנצחת, כדי למנוע התנגשויות בין מילות מפתח מוכלות.
 */
export function resolveRegionForVenue(venue: string): Region {
  const name = normalizeVenue(venue);
  if (!name) return UNMAPPED_REGION;
  if (EXPLICIT_UNMAPPED.has(name)) return UNMAPPED_REGION;

  let best: { region: Region; length: number } | null = null;
  for (const { region, keywords } of REGION_KEYWORDS) {
    for (const kw of keywords) {
      if (name.includes(kw) && (!best || kw.length > best.length)) {
        best = { region, length: kw.length };
      }
    }
  }

  return best ? best.region : UNMAPPED_REGION;
}

/** סדר תצוגה קבוע לעמודות: 3 האזורים ואז "לא ממופה" */
export function sortRegionsForDisplay(regions: Iterable<string>): string[] {
  const present = new Set(regions);
  const ordered: string[] = [];
  for (const r of REGIONS) if (present.has(r)) ordered.push(r);
  if (present.has(UNMAPPED_REGION)) ordered.push(UNMAPPED_REGION);
  // כל ערך בלתי צפוי אחר — בסוף, לפי א״ב
  for (const r of Array.from(present).sort((a, b) => a.localeCompare(b, "he"))) {
    if (!ordered.includes(r)) ordered.push(r);
  }
  return ordered;
}
