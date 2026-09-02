/**
 * תפקידים במערכת — מקור אמת יחיד.
 *
 * העמודה "תפקיד במערכת" בלוח האומנים (color_mm18btbr) משמשת גם כהרשאה
 * (מי מגיע למסכי הניהול) וגם כזהות (מי נרשם לאירועים וכאיזה סוג).
 * "מנהל אומן" הוא מי שיש לו את שניהם — הרשאות ניהול מלאות וגם הרשמה כאומן.
 *
 * המודול נטול תלויות בכוונה: הוא נטען גם ב-edge (proxy) וגם בשרת.
 */

export type Role = "אומן" | "ODT" | "מנהל" | "מנהל אומן";

/** תפקיד ההרשמה על subitem — אומן / ODT */
export type RegistrationRole = "אומן" | "ODT";

const ROLE_LABELS: Role[] = ["אומן", "ODT", "מנהל", "מנהל אומן"];

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
 * כאיזה סוג המשתמש נרשם לאירועים.
 * null = מנהל טהור, שאינו נרשם ואינו רואה את מסכי האומן.
 */
export function getRegistrationRole(role: Role): RegistrationRole | null {
  if (role === "ODT") return "ODT";
  if (role === "אומן" || role === "מנהל אומן") return "אומן";
  return null;
}
