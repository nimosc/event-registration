# תפקיד "מנהל אומן" — עיצוב

**תאריך:** 2026-09-02
**סטטוס:** מאושר

## רקע

חלק מהמנהלים הם גם אומנים פעילים. היום עמודת התפקיד בלוח האומנים (`color_mm18btbr`) היא בלעדית — `אומן` / `ODT` / `מנהל` — וערך `מנהל` משמש בקוד גם כ**הרשאת ניהול** וגם כ**זהות "לא אומן"**: מנהל חסום מ-`/orders`, `/my-registrations`, `/invoices` ומלינקי האומן ב-NavBar. לכן מנהל שהוא גם אומן לא יכול להירשם לאירועים, לראות את השיבוצים שלו או להגיש חשבונית.

שיבוץ ידני של מנהל דרך מסך האדמין כבר עובד היום (אין סינון תפקיד ב-`assignable-artists` וב-`assign`, וכל 5 המנהלים בסטטוס "פעיל"), אבל זה לא פותר את מה שקורה אחרי השיבוץ.

## מטרה

תפקיד רביעי **`מנהל אומן`**: הרשאות ניהול מלאות **וגם** חוויית אומן מלאה (צפייה, הרשמה, מועמדויות שלי, חשבוניות). מנהל רגיל נשאר כפי שהוא — ניהול בלבד.

| תפקיד | הרשאות ניהול | תפקיד הרשמה | מסכים |
|---|---|---|---|
| אומן | ✗ | אומן | אירועים, מועמדויות שלי, חשבוניות |
| ODT | ✗ | ODT | כנ"ל |
| מנהל | ✓ | — | ניהול, דוחות |
| מנהל אומן | ✓ | אומן | הכל |

## דרישה מוקדמת ב-Monday

להוסיף label `מנהל אומן` לעמודת הסטטוס `color_mm18btbr` בלוח האומנים (5092847546). ללא שינוי בלוח ה-subitems — מנהל אומן נרשם כ-subitem רגיל מסוג "אומן".

## עיצוב

### 1. שכבת auth (`src/lib/auth.ts`)

```ts
export type Role = "אומן" | "ODT" | "מנהל" | "מנהל אומן";
export type RegistrationRole = "אומן" | "ODT";

/** מיפוי label מ-Monday → Role. label לא מוכר/ריק → "אומן". */
export function parseRoleLabel(label: string | null | undefined): Role;

/** מנהל | מנהל אומן */
export function isAdmin(role: Role): boolean;

/** אומן→"אומן", ODT→"ODT", מנהל אומן→"אומן", מנהל→null */
export function getRegistrationRole(role: Role): RegistrationRole | null;
```

`SessionUser.role` הופך ל-`Role`. `parseRoleLabel` מחליף את שלושת העותקים של המיפוי label→role ב-`api/auth/route.ts`, `api/magic-link/route.ts`, ו-`getLiveArtistRole` ב-`monday.ts`.

כל השוואת `role === "מנהל"` / `role !== "מנהל"` בקוד מוחלפת ב-helper לפי הכוונה:
- **הרשאת ניהול** → `isAdmin(role)`
- **גישה למסכי אומן** → `getRegistrationRole(role) !== null`
- **סוג הרשמה** (`role === "ODT"`) → `getRegistrationRole(role) === "ODT"`

### 2. ניתוב והרשאות

**`src/proxy.ts`**
- `/admin*` דורש `isAdmin`; אחרת → `/orders`.
- `/orders*` חוסם רק כש-`getRegistrationRole === null` → `/admin`.
- השאילתה החיה ל-Monday (שכבר שולפת `color_mm18wjry` סטטוס) שולפת גם `color_mm18btbr` תפקיד. ה-JWT שמונפק מחדש בכל בקשה נכתב עם התפקיד החי (`parseRoleLabel`), כך ששינוי תפקיד ב-Monday נתפס מיד בלי re-login. אם השליפה נכשלת — נשאר התפקיד מה-payload (כמו היום לסטטוס).

**דפי שרת (`page.tsx`)**
- `orders`, `my-registrations`, `invoices`: redirect ל-`/admin` כש-`getRegistrationRole === null`.
- `admin`, `admin/reports/instructors`: redirect ל-`/orders` כש-`!isAdmin`.
- `src/app/page.tsx`, `api/auth`, `api/magic-link`: נחיתה `isAdmin ? "/admin" : "/orders"` — מנהל אומן נוחת בניהול.

**API** — כל routes תחת `/api/admin/*` (assign, confirm, orders, orders/export, assignable-artists, registration, repair-order-statuses) ו-`/api/reports/instructor-activity`: `isAdmin`.

### 3. הרשמה ותצוגה כאומן

- `api/orders/route.ts`: `registrationRole = getRegistrationRole(session.role)`; `isOdt = registrationRole === "ODT"`; סינון האירועים בסוף לפי `registrationRole` (ODT → `odtRequired > 0`, אומן → `requiredCount > 0`). ה-role refresh הקיים ממשיך לעבוד עם `Role` המורחב.
- `api/register/route.ts`: `isOdt = getRegistrationRole(session.role) === "ODT"`.
- `OrdersClient.tsx`: `isOdt` לפי `getRegistrationRole`. `OrderCard`, `NavBar`, `InstructorReportClient` — הרחבת ה-type של `userRole` ל-`Role`.

**NavBar**
- לינקים: `isAdmin` → לינקי ניהול; `getRegistrationRole !== null` → לינקי אומן. מנהל אומן מקבל את שניהם.
- באדג' מציג את `userRole` כמו היום ("מנהל אומן"); צבע סגול ל-`isAdmin`.
- אזור מוצג כש-`getRegistrationRole !== null`.

### 4. מחוץ לסקופ

- `createSubitem` בשיבוץ ידני (`api/admin/assign`) לא מעביר `artistType`, ולכן ODT משובץ ידנית נספר כאומן — באג קיים, יטופל בנפרד.
- "מנהל ODT" — לא נדרש כרגע.
- `api/report-issue` משתמש ב-`session.role` לטקסט בלבד — ללא שינוי.

## בדיקה

אין test suite. אימות ידני מול Monday:

1. להוסיף את ה-label ב-Monday ולשנות את "נועם טסט" (2795636820) ל-`מנהל אומן`.
2. בלי re-login: רענון `/admin` נשאר נגיש; `/orders` נפתח (ה-proxy תפס את התפקיד החי).
3. NavBar מציג לינקי ניהול + אירועים / המועמדויות שלי / חשבוניות.
4. הרשמה לאירוע מ-`/orders` → subitem נוצר כ"אומן"; אישור עצמי מ-`/admin`; מופיע ב-`/my-registrations`; `/invoices` נפתח.
5. מנהל רגיל: `/orders` עדיין מפנה ל-`/admin`; NavBar ללא לינקי אומן.
6. אומן ו-ODT רגילים: `/admin` עדיין מפנה ל-`/orders`; סינון ODT/אומן ב-`/orders` ללא שינוי.
7. `npm run lint` ו-`npm run build` עוברים.
