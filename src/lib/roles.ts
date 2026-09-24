/**
 * תפקידים במערכת — מקור אמת יחיד.
 *
 * העמודה "תפקיד במערכת" בלוח האומנים (color_mm18btbr) משמשת גם כהרשאה
 * (מי מגיע למסכי הניהול) וגם כזהות (מי נרשם לאירועים וכאיזה סוג).
 * - "מנהל אומן" = הרשאות ניהול מלאות + הרשמה כאומן.
 * - "אומן+ODT" = נרשם כאומן או כ-ODT, לפי בחירתו בכל הרשמה.
 *
 * המודול נטול תלויות בכוונה: הוא נטען גם ב-edge (proxy) וגם בשרת וגם בלקוח.
 */

export type Role = "אומן" | "ODT" | "אומן+ODT" | "מנהל" | "מנהל אומן";

/** תפקיד ההרשמה על subitem — אומן / ODT */
export type RegistrationRole = "אומן" | "ODT";

const ROLE_LABELS: Role[] = ["אומן", "ODT", "אומן+ODT", "מנהל", "מנהל אומן"];

/**
 * ממפה label מעמודת התפקיד ב-Monday לתפקיד במערכת.
 *
 * מחזיר null ל-label ריק או לא מוכר — כדי שרענון תפקיד חי לא יוריד
 * הרשאות בגלל תשובה ריקה מ-Monday. נקודות הכניסה (login, magic-link)
 * מוסיפות בעצמן ברירת מחדל של "אומן".
 */
export function parseRoleLabel(label: string | null | undefined): Role | null {
  const trimmed = (label ?? "").trim();
  return ROLE_LABELS.find((role) => role === trimmed) ?? null;
}

/** הרשאת ניהול — מסכי האדמין, הדוחות וכל /api/admin/* */
export function isAdmin(role: Role): boolean {
  return role === "מנהל" || role === "מנהל אומן";
}

/**
 * התפקידים שבהם המשתמש יכול להירשם לאירועים, בסדר קבוע (אומן לפני ODT).
 * ריק = מנהל טהור, שאינו נרשם ואינו רואה את מסכי האומן.
 */
export function getRegistrationRoles(role: Role): RegistrationRole[] {
  switch (role) {
    case "אומן":
    case "מנהל אומן":
      return ["אומן"];
    case "ODT":
      return ["ODT"];
    case "אומן+ODT":
      return ["אומן", "ODT"];
    default:
      return [];
  }
}

/** האם המשתמש נרשם לאירועים בכלל (רואה את מסכי האומן) */
export function canRegisterForEvents(role: Role): boolean {
  return getRegistrationRoles(role).length > 0;
}

/**
 * קובע באיזה תפקיד להירשם להזמנה נתונה.
 * - `requested` נתון: חייב להיות בתפקידי המשתמש וגם נדרש בהזמנה.
 * - לא נתון: אם רק תפקיד אחד אפשרי — הוא; אם שניים — דו-משמעי (null).
 * מחזיר את התפקיד, או הודעת שגיאה בעברית.
 */
export function resolveRegistrationRole(input: {
  userRoles: RegistrationRole[];
  orderNeeds: { artist: boolean; odt: boolean };
  requested?: RegistrationRole | null;
}): { role: RegistrationRole } | { error: string } {
  const { userRoles, orderNeeds, requested } = input;
  const needed = (r: RegistrationRole) => (r === "ODT" ? orderNeeds.odt : orderNeeds.artist);

  if (requested) {
    if (!userRoles.includes(requested)) {
      return { error: requested === "ODT" ? "אינך רשום במערכת כ-ODT" : "אינך רשום במערכת כאומן" };
    }
    if (!needed(requested)) {
      return { error: requested === "ODT" ? "ההזמנה אינה זקוקה ל-ODT" : "ההזמנה אינה זקוקה לאומנים" };
    }
    return { role: requested };
  }

  const possible = userRoles.filter(needed);
  if (possible.length === 1) return { role: possible[0] };
  if (possible.length === 0) return { error: "ההזמנה אינה זקוקה לתפקיד שלך" };
  return { error: "יש לבחור תפקיד להרשמה" };
}
