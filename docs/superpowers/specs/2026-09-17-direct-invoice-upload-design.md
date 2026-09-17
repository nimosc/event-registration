# העלאת קבצי חשבונית ישירות ל-Vercel Blob — מפרט

**תאריך:** 2026-09-17
**סטטוס:** טיוטה לאישור

## הבעיה

הגשת חשבונית נכשלת לפעמים ב"שגיאת רשת." בלי שנוצר כלום ב-Monday. הסיבה
המבנית: הקובץ עובר דרך פונקציית Vercel **פעמיים** — פעם ב-`/api/invoices/extract`
(חילוץ AI) ופעם ב-`/api/invoices` (הגשה) — ובפעם השנייה השרת מחזיק את חיבור
הלקוח פתוח בזמן שהוא יוצר פריט ב-Monday, מעלה אליו את הקובץ ושולח webhook, עם
תקרה של 60 שניות. על חיבור סלולרי זה נופל, ו-Vercel מחזיר תשובה לא-JSON
שהלקוח מציג כ"שגיאת רשת".

בנוסף, הפונקציה כפופה למגבלת גוף בקשה של 4.5MB, ולכן `prepareInvoiceFile`
חוסם היום PDF מעל 4MB ומכווץ תמונות.

נתוני אמת (233 קבצים אחרונים ב-Monday): חציון 0.15MB, p99 1.14MB, מקסימום 3.67MB.
מגבלת הגודל לא פגעה באף קובץ; ה-timeout וההעלאה הכפולה הם מה שנכשל.

## המטרה

1. הקובץ עולה **פעם אחת**, ברגע הבחירה, ישירות לאחסון — לא דרך פונקציה.
2. לחיצת "הגש" היא בקשת JSON קטנה. אין העלאה בשלב השביר.
3. כשל אחרי יצירת הפריט לא מאבד כלום: הפריט מסומן, הקובץ שמור, אפשר לנסות שוב.
4. לחיצה חוזרת אחרי שגיאה **לעולם** לא יוצרת רשומה כפולה.
5. מגבלת 4.5MB נעלמת מהמסלול כולו (כולל חילוץ ה-AI).
6. הודעות שגיאה אומרות מה קרה, לא "שגיאת רשת" גנרי.

לא בסקופ: שינוי בתהליך האישור של המנהל, שינוי מבנה לוח החשבוניות, מיגרציה של
קבצים קיימים.

## ארכיטקטורה

```
בחירת קובץ ──► prepareInvoiceFile (דחיסת תמונה; בלי חסימת PDF)
            ──► POST /api/invoices/upload-token  {name, size, type}      ← JSON קטן
            ◄── token חתום ל-Blob (pathname ייחודי לאומן)
            ──► דפדפן → Vercel Blob ישירות (multipart אוטומטי)           ← לא דרך פונקציה
            ◄── blob URL
            ──► POST /api/invoices/extract  {blobUrl}                    ← JSON קטן
                שרת: מוריד מ-Blob → AI → sha256 → extractionToken (כמו היום)
            ◄── שדות + extractionToken

לחיצה "הגש"
            ──► POST /api/invoices  {blobUrl, extractionToken, ...שדות}  ← JSON קטן
                שרת:
                  1. אימות: ה-blobUrl שייך לאומן (pathname prefix), token תקף
                  2. אידמפוטנטיות: אם כבר קיים פריט של האומן לחודש הזה עם
                     אותו fileHash → מחזיר אותו (success, duplicate: true)
                  3. יצירת פריט ב-Monday (מהיר)
                  4. הורדת הקובץ מ-Blob → העלאה ל-Monday, עם retry ×3
                  5. כשל ב-4 → הפריט מסומן "קובץ חסר" + blobUrl נשמר בעמודת
                     טקסט; מחזיר success עם fileAttached: false
                  6. after(): מחיקת ה-blob אחרי הצלחה; שאר ה-bookkeeping כמו היום
```

מסלול המסמך החשבונאי (`/api/invoices/accounting-document`) עובר את אותו שינוי:
מקבל `blobUrl` במקום קובץ.

## רכיבים

### `src/lib/blobUpload.ts` (חדש, שרת)
- `INVOICE_BLOB_PREFIX = "invoices/"`.
- `buildInvoiceBlobPathname(artistId, filename)` → `invoices/<artistId>/<uuid>-<safe-name>`.
- `assertBlobBelongsToArtist(blobUrl, artistId)` — בודק prefix; זורק אחרת.
- `downloadBlob(blobUrl): Promise<File>` — `fetch` + `File` עם השם המקורי.
- `deleteBlobQuietly(blobUrl)` — `del()` עטוף ב-try/catch ללוג.

### `POST /api/invoices/upload-token` (חדש)
- דורש session.
- משתמש ב-`handleUpload` מ-`@vercel/blob/client`:
  - `allowedContentTypes`: pdf, jpeg, png.
  - `maximumSizeInBytes`: 25MB (גבול סביר לחשבונית; ניתן לשינוי).
  - `pathname` נכפה לפי `buildInvoiceBlobPathname` — הלקוח לא בוחר נתיב.
  - `addRandomSuffix: false` (ה-uuid כבר בנתיב).
  - `onUploadCompleted` לא בשימוש (הלקוח ממשיך בעצמו).

### `POST /api/invoices/extract` (שינוי)
- קלט: JSON `{ blobUrl }` במקום multipart.
- `assertBlobBelongsToArtist` → `downloadBlob` → זהה להיום מכאן והלאה.

### `POST /api/invoices` (שינוי)
- קלט: JSON. `file` מוחלף ב-`blobUrl`. כל שאר השדות זהים.
- אידמפוטנטיות: `getArtistInvoices` (כבר נקרא היום) מסונן ל-`monthKey` זהה;
  fileHash של ההגשה נשמר בעמודת טקסט חדשה בלוח (`INVOICE_FILE_HASH_COLUMN_ID`).
  התאמה → מחזיר את הפריט הקיים.
- סדר: `createInvoiceItem` → `uploadFileToInvoiceColumn` עם retry (3 ניסיונות,
  backoff 1s/3s) → הצלחה: מוחקים blob ב-`after()`; כשל: עמודת סטטוס קובץ =
  "קובץ חסר", עמודת טקסט `INVOICE_PENDING_BLOB_COLUMN_ID` = blobUrl.
- תגובה: `{ success, invoiceId, fileAttached: boolean, duplicate?: true }`.

### `POST /api/invoices/accounting-document` (שינוי)
- אותו דפוס: `{ blobUrl, invoiceId, invoiceNumber, extractionToken }`.

### `POST /api/invoices/retry-file` (חדש)
- קלט `{ invoiceId }`. מוצא את הפריט של האומן, קורא את `blobUrl` מהעמודה,
  מנסה שוב להעלות ל-Monday. משמש גם את המנהל וגם את האומן.

### לוח Monday — שתי עמודות חדשות (הקמה ידנית, IDs ייכתבו ב-`monday.ts`)
- `INVOICE_FILE_HASH_COLUMN_ID` — טקסט, "hash קובץ".
- `INVOICE_PENDING_BLOB_COLUMN_ID` — טקסט, "קובץ ממתין (URL)".
- סטטוס "קובץ חסר" מתווסף לעמודת סטטוס ההגשה הקיימת **או** לעמודה חדשה —
  להחלטה בזמן ההקמה לפי מה שנוח למנהלים בתצוגות.

### לקוח — `InvoicesClient.tsx`
- `handleFileChange` / `handleAccountingFileChange`:
  1. `prepareInvoiceFile` (דחיסת תמונות נשארת; **חסימת PDF > 4MB מוסרת**,
     מגבלה חדשה 25MB עם הודעה ברורה).
  2. `upload()` מ-`@vercel/blob/client` עם `handleUploadUrl: "/api/invoices/upload-token"`
     ו-`onUploadProgress` → פס התקדמות.
  3. `POST /extract {blobUrl}`.
  4. state חדש: `blobUrl`; `invoiceFile` נשאר רק לתצוגת שם/גודל.
- הגשה: `fetch` עם JSON. טיפול בתשובה:
  - `!res.ok` ותשובה לא-JSON → `שגיאת שרת (${status}) — נסה שוב` (הדפוס
    שכבר קיים במסלול המסמך החשבונאי).
  - `fileAttached: false` → הודעת הצלחה חלקית: "הרשומה נוצרה, צירוף הקובץ
    ל-Monday נכשל — ננסה שוב אוטומטית" + כפתור "נסה שוב" → `/retry-file`.
  - `duplicate: true` → "ההגשה הזו כבר נקלטה" (לא שגיאה).
- `sessionStorage` cache של הטופס נשאר כפי שהוא.

### `prepareInvoiceFile.ts`
- `MAX_UPLOAD_BYTES` → 25MB. הערת הרקע על 4.5MB מתעדכנת.

## טיפול בשגיאות

| כשל | התנהגות |
|---|---|
| העלאה ל-Blob נכשלת | הלקוח מציג "העלאת הקובץ נכשלה — בדוק חיבור ונסה שוב"; הטופס נשאר מלא |
| `/extract` נכשל | כמו היום: ממשיכים בלי חילוץ, הזנה ידנית |
| `/api/invoices` — Blob לא נמצא (נמחק/פג) | 400 "הקובץ לא נמצא — צרף שוב" |
| `/api/invoices` — Monday create נכשל | 500 JSON; לא נוצר כלום; blob נשאר; לחיצה חוזרת בטוחה |
| `/api/invoices` — צירוף קובץ ל-Monday נכשל ×3 | 200 עם `fileAttached:false`; פריט מסומן "קובץ חסר" |
| תגובה אבדה בדרך ללקוח | לחיצה חוזרת → אידמפוטנטיות מחזירה את הפריט הקיים |
| blobUrl של אומן אחר | 403 |

## ניקוי ושמירת מידע

- Blob נמחק ב-`after()` מיד אחרי צירוף מוצלח ל-Monday.
- Blobs יתומים (בחר קובץ ולא הגיש; כשל שלא תוקן): Cron יומי
  `GET /api/cron/purge-invoice-blobs` (מוגן ב-`CRON_SECRET`) מוחק כל blob תחת
  `invoices/` שגילו > 7 ימים ואינו רשום בעמודת "קובץ ממתין" באף פריט.
- גישה ל-blobs: אם גרסת `@vercel/blob` המותקנת תומכת ב-`access: "private"`
  בהעלאת לקוח — משתמשים בו. אחרת `access: "public"` עם pathname בלתי ניתן
  לניחוש (uuid) ומחיקה מהירה, כפי ש-Vercel ממליצים. בשני המקרים מסמכים
  פיננסיים לא נשארים שם מעבר ל-7 ימים. ההכרעה נרשמת בזמן היישום.

## תשתית

- `@vercel/blob` נוסף ל-`package.json`.
- Blob store חדש בפרויקט `event-registration` (CLI: `vercel blob create-store`),
  מה שמזריק `BLOB_READ_WRITE_TOKEN` לסביבות. **דורש אישור המשתמש** — משאב חדש
  בחשבון, עם חיוב לפי שימוש (זניח בנפחים כאן).
- `CRON_SECRET` חדש + הגדרת cron ב-`vercel.json`.
- `.env.local.example` מתעדכן.

## בדיקות

אין test suite בפרויקט. אימות ידני מול Monday, כמו בפיצ'ר הקודם:
1. הגשה רגילה (PDF קטן) — פריט + קובץ ב-Monday, blob נמחק.
2. PDF של 10MB — עובר (היום נחסם).
3. סימולציית כשל Monday upload (טוקן שגוי זמנית ב-dev) — פריט "קובץ חסר",
   blobUrl בעמודה, `retry-file` מתקן.
4. לחיצה כפולה מהירה על "הגש" — פריט אחד.
5. blobUrl של אומן אחר — 403.
6. מסלול המסמך החשבונאי — תרחישים 1 ו-3.
7. רגרסיה: אומן ללא JS-upload (Blob חסום ברשת) — הודעה ברורה, לא "שגיאת רשת".

## סדר ביצוע

1. תשתית: חבילה, store, env, `blobUpload.ts`, `upload-token`.
2. לקוח: העלאה ישירה + `/extract` ב-JSON.
3. שרת: `/api/invoices` ו-`accounting-document` ב-JSON + אידמפוטנטיות + retry.
   שלבים 2 ו-3 נפרסים יחד — הלקוח החדש שולח `blobUrl` והשרת הישן מצפה לקובץ.
4. `retry-file` + סימון "קובץ חסר" + עמודות Monday.
5. Cron ניקוי.
6. אימות ידני 1–7, פריסה.
