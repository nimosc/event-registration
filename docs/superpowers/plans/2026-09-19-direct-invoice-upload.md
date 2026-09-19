# העלאת חשבוניות ישירות ל-Vercel Blob — תוכנית ביצוע

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** קובץ חשבונית עולה פעם אחת מהדפדפן ישירות ל-Vercel Blob; ההגשה היא JSON קטן; כשל אחרי יצירת הרשומה לא מאבד כלום; לחיצה חוזרת לא מכפילה.

**Architecture:** הלקוח מקבל טוקן חתום מ-`/api/invoices/upload-token`, מעלה ל-Blob (private) עם `upload()` מ-`@vercel/blob/client`, ואז שולח `blobUrl` ל-`/extract` ול-`/api/invoices` כ-JSON. השרת מוריד מ-Blob עם `get({access:"private"})`, יוצר פריט ב-Monday, מצרף קובץ עם retry, ומסמן "קובץ חסר" בכשל. אידמפוטנטיות לפי `אומן+חודש+sha256`.

**Tech Stack:** Next.js 16 App Router, `@vercel/blob` ^2.8 (client+server), Monday GraphQL, אין test suite — אימות ידני מול Monday + dev server.

## Global Constraints

- מפרט: `docs/superpowers/specs/2026-09-17-direct-invoice-upload-design.md`.
- Blob store: private. Pathname: `invoices/<artistId>/<uuid>-<safe-name>`.
- גודל מרבי: 25MB. סוגים: `application/pdf`, `image/jpeg`, `image/png`.
- עמודות Monday חדשות (לוח 5097191457): `text_mm7bb3jm` hash קובץ, `text_mm7b4e73` קובץ ממתין (URL), `color_mm7bg02t` סטטוס קובץ (labels: `מצורף`, `קובץ חסר`).
- Blob נמחק אחרי צירוף מוצלח ל-Monday; שאריות > 7 ימים נמחקות ב-cron.
- כל טקסט UI בעברית. הודעת שגיאה לעולם לא "שגיאת רשת" גנרי כשיש סטטוס.
- Commit אחרי כל משימה, עם `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: תשתית Blob + מודול שרת `blobUpload.ts`

**Files:**
- Create: `src/lib/blobUpload.ts`
- Modify: `src/lib/monday.ts` (קבועי עמודות)
- Modify: `.env.local.example`, `.env.local` (BLOB_READ_WRITE_TOKEN)

**Interfaces (Produces):**
```ts
export const INVOICE_BLOB_PREFIX = "invoices/";
export const INVOICE_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const INVOICE_ALLOWED_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
export function buildInvoiceBlobPathname(artistId: string, filename: string): string;
export function blobPathnameBelongsToArtist(pathname: string, artistId: string): boolean;
export function blobUrlToPathname(blobUrl: string): string | null;
export async function downloadInvoiceBlob(blobUrl: string, artistId: string): Promise<File>; // throws BlobAccessError | BlobNotFoundError
export async function deleteInvoiceBlobQuietly(blobUrl: string): Promise<void>;
export class BlobAccessError extends Error {}
export class BlobNotFoundError extends Error {}
```
- monday.ts: `INVOICE_FILE_HASH_COLUMN_ID = "text_mm7bb3jm"`, `INVOICE_PENDING_BLOB_COLUMN_ID = "text_mm7b4e73"`, `INVOICE_FILE_STATUS_COLUMN_ID = "color_mm7bg02t"`, `INVOICE_FILE_STATUS = { ATTACHED: "מצורף", MISSING: "קובץ חסר" }`.

- [ ] `vercel env pull` לקובץ זמני ולהעתיק את `BLOB_READ_WRITE_TOKEN` ל-`.env.local` (לא לדרוס את הקובץ).
- [ ] לכתוב `blobUpload.ts` לפי החתימות. `downloadInvoiceBlob`: `blobUrlToPathname` → `blobPathnameBelongsToArtist` (אחרת `BlobAccessError`) → `get(url, {access:"private", useCache:false})` → null → `BlobNotFoundError` → `new File([await result.blob()], originalName, {type})`. שם הקובץ המקורי משוחזר מה-pathname אחרי ה-uuid.
- [ ] בדיקה ידנית: `npx tsx` סקריפט שמעלה קובץ עם `put()` (server), מוריד עם `downloadInvoiceBlob`, מוחק. Expected: אורך זהה.
- [ ] Commit: `feat(invoices): blob upload helpers + Monday file columns`

### Task 2: `POST /api/invoices/upload-token`

**Files:**
- Create: `src/app/api/invoices/upload-token/route.ts`

**Interfaces:** צורך `buildInvoiceBlobPathname`, `INVOICE_*` מ-Task 1. מייצר endpoint שה-client `upload()` קורא לו עם `handleUploadUrl`.

- [ ] `handleUpload({ body, request, onBeforeGenerateToken: async (pathname) => { session חובה; return { allowedContentTypes, maximumSizeInBytes, addRandomSuffix:false, allowOverwrite:false, validUntil: Date.now()+15*60_000, tokenPayload: JSON.stringify({artistId}) } } })`. ה-pathname שהלקוח מבקש **חייב** להתחיל ב-`invoices/<session.id>/` — אחרת 403. (הלקוח בונה אותו עם `buildInvoiceBlobPathname` — לכן המודול חייב להיות ניתן לייבוא גם בצד לקוח: בלי `@vercel/blob` server import בראש הקובץ; להפריד `blobPaths.ts` (טהור) מ-`blobUpload.ts` (שרת).)
- [ ] ללא session → 401 JSON.
- [ ] Commit: `feat(invoices): signed upload-token endpoint`

### Task 3: לקוח — העלאה ישירה + `/extract` ב-JSON

**Files:**
- Modify: `src/app/invoices/InvoicesClient.tsx` (`handleFileChange` ~503, `handleAccountingFileChange` ~555, state, שני ה-submit handlers ~780-940, מודל המסמך החשבונאי ~660-705)
- Modify: `src/lib/prepareInvoiceFile.ts` (`MAX_UPLOAD_BYTES` → 25MB, הערת רקע)
- Modify: `src/app/api/invoices/extract/route.ts`

**Interfaces:**
- `/extract` מקבל `{ blobUrl: string }` JSON; מחזיר כמו היום.
- state חדש: `invoiceBlobUrl`, `accountingBlobUrl`, `uploadProgress: number | null`.

- [ ] `handleFileChange`: `prepareInvoiceFile` → `upload(buildInvoiceBlobPathname(user.id, prepared.name), prepared, { access:"private", handleUploadUrl:"/api/invoices/upload-token", multipart: prepared.size > 5MB, contentType, onUploadProgress: ({percentage}) => setUploadProgress(percentage) })` → `setInvoiceBlobUrl(result.url)` → `POST /extract {blobUrl}`.
  כשל העלאה → `setError("העלאת הקובץ נכשלה — בדוק חיבור ונסה שוב")`, `setInvoiceFile(null)`.
- [ ] אותו דבר ל-`handleAccountingFileChange` עם `accountingBlobUrl`.
- [ ] `/extract`: `const { blobUrl } = await req.json()`; `downloadInvoiceBlob(blobUrl, session.id)`; `BlobAccessError` → 403, `BlobNotFoundError` → 400 "הקובץ לא נמצא — צרף שוב"; שאר הלוגיקה זהה.
- [ ] UI: פס התקדמות מתחת לשדה הקובץ בזמן `uploadProgress != null && < 100`; כפתור "הגש" disabled עד שיש `blobUrl`.
- [ ] Commit: `feat(invoices): direct-to-blob upload on file select`

### Task 4: שרת — `/api/invoices` ו-`accounting-document` ב-JSON, אידמפוטנטיות, retry, "קובץ חסר"

**Files:**
- Modify: `src/app/api/invoices/route.ts` (`handleInvoiceSubmit`)
- Modify: `src/app/api/invoices/accounting-document/route.ts`
- Modify: `src/lib/monday.ts`: `createInvoiceItem` מקבל `fileHash?: string`, `pendingBlobUrl?: string`, `fileStatus?: string`; חדש `setInvoiceFileState(itemId, {status, pendingBlobUrl})`; `getArtistInvoices` מחזיר גם `fileHash`, `fileStatus`, `pendingBlobUrl`; חדש `attachInvoiceFileWithRetry(itemId, columnIds, file, name, attempts=3)`.
- Modify: `src/app/invoices/InvoicesClient.tsx` — שני ה-submit: JSON במקום FormData; טיפול ב-`fileAttached:false` ו-`duplicate:true`; תשובה לא-JSON → `שגיאת שרת (${status}) — נסה שוב`.

**Interfaces:**
- `/api/invoices` body: כל השדות של היום כ-JSON + `blobUrl`; ללא `file`.
- תגובה: `{ success:true, invoiceId, fileAttached:boolean, duplicate?:true }`.

- [ ] `handleInvoiceSubmit`: `req.json()`; `downloadInvoiceBlob` (403/400 כנ"ל); `fileHash = sha256OfFile(file)`; **אידמפוטנטיות**: `existingInvoices.find(i => i.fileHash === fileHash && parseInvoiceMonthKey(i.date) === resolvedMonthKey)` → `200 {success, invoiceId, fileAttached: i.fileStatus !== MISSING, duplicate:true}`.
- [ ] `createInvoiceItem({... fileHash, fileStatus: ATTACHED})` → `attachInvoiceFileWithRetry` (backoff 1s, 3s) → הצלחה: `after(deleteInvoiceBlobQuietly)`; כשל: `setInvoiceFileState(id, {status: MISSING, pendingBlobUrl: blobUrl})`, `console.error`, תגובה `fileAttached:false`.
- [ ] `accounting-document`: אותו דפוס; אין אידמפוטנטיות לפי חודש (יש כבר `alreadySubmitted`), אבל כן `fileHash` נכתב.
- [ ] Commit: `feat(invoices): JSON submit with idempotency and file-attach retry`

### Task 5: `POST /api/invoices/retry-file` + UI "נסה שוב"

**Files:**
- Create: `src/app/api/invoices/retry-file/route.ts`
- Modify: `src/app/invoices/InvoicesClient.tsx` (רשימת החשבוניות: תג "קובץ חסר" + כפתור)
- Modify: `src/lib/monday.ts`: `getInvoiceItemForArtist` מחזיר `pendingBlobUrl`, `fileStatus`.

- [ ] route: `{ invoiceId }` → `getInvoiceItemForArtist(invoiceId, session.id)` (404) → `fileStatus !== MISSING` → 200 `{fileAttached:true}` (idempotent) → `downloadInvoiceBlob(pendingBlobUrl, session.id)` → `attachInvoiceFileWithRetry` על העמודה לפי `submissionStatus` (בקשת תשלום / מסמך חשבונאי) → `setInvoiceFileState(id, {status: ATTACHED, pendingBlobUrl: ""})` → `after(delete blob)`.
- [ ] UI: בשורת חשבונית עם `fileStatus === "קובץ חסר"` — תג אדום + "צרף שוב" → קריאה ל-route → רענון.
- [ ] Commit: `feat(invoices): retry attaching a pending blob`

### Task 6: Cron ניקוי blobs יתומים

**Files:**
- Create: `src/app/api/cron/purge-invoice-blobs/route.ts`
- Modify: `vercel.json` (`crons: [{ path: "/api/cron/purge-invoice-blobs", schedule: "0 3 * * *" }]`)
- Modify: `.env.local.example` (`CRON_SECRET`)

- [ ] route GET: `Authorization: Bearer ${CRON_SECRET}` חובה (401). `list({prefix: INVOICE_BLOB_PREFIX})` בעימוד → כל blob עם `uploadedAt < now-7d` ו-URL שאינו מופיע ב-`text_mm7b4e73` של אף פריט (query `items_page_by_column_values`? יקר — במקום זאת: `getAllPendingBlobUrls()` קורא את הלוח פעם אחת עם `column_values(ids:[PENDING])`) → `del([...])`. מחזיר `{scanned, deleted}`.
- [ ] `vercel env add CRON_SECRET production` (ערך אקראי).
- [ ] Commit: `chore(invoices): nightly purge of orphaned blobs`

### Task 7: אימות ידני ופריסה

- [ ] `npx tsc --noEmit` + `npm run build`.
- [ ] dev server: התחברות כ-נועם טסט (magic link), הגשה עם PDF קטן → פריט ב-Monday עם קובץ, `hash קובץ` מלא, `סטטוס קובץ`=מצורף; `vercel blob list` — ה-blob נמחק.
- [ ] PDF 10MB → עובר.
- [ ] כשל מדומה: `MONDAY_API_TOKEN` תקין אבל `uploadFileToInvoiceColumn` נכשל (זמנית לזרוק) → פריט "קובץ חסר", URL בעמודה → "צרף שוב" מתקן.
- [ ] לחיצה כפולה → `duplicate:true`, פריט אחד.
- [ ] blobUrl של אומן אחר (curl) → 403.
- [ ] מסלול מסמך חשבונאי — הגשה רגילה.
- [ ] מחיקת פריטי הבדיקה מ-Monday. Push ל-master, אימות ב-Vercel logs שאין שגיאות build, בדיקה חיה אחת.
