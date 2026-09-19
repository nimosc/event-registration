import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSession } from "@/lib/auth";
import {
  blobPathnameBelongsToArtist,
  INVOICE_ALLOWED_CONTENT_TYPES,
  INVOICE_MAX_UPLOAD_BYTES,
} from "@/lib/blobPaths";

/** תוקף הטוקן — מספיק לבחירת קובץ והעלאה, לא מעבר */
const TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * מנפיק טוקן חתום שמאפשר ללקוח להעלות קובץ חשבונית ישירות ל-Vercel Blob,
 * בלי שהקובץ יעבור דרך פונקציית שרת (ולכן בלי מגבלת 4.5MB ובלי timeout).
 * הטוקן כבול לנתיב `invoices/<artistId>/…` של האומן המחובר בלבד.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!blobPathnameBelongsToArtist(pathname, session.id)) {
          throw new Error("נתיב קובץ לא מורשה");
        }
        return {
          allowedContentTypes: INVOICE_ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: INVOICE_MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + TOKEN_TTL_MS,
          tokenPayload: JSON.stringify({ artistId: session.id }),
        };
      },
      // ההגשה עצמה מתבצעת ע"י הלקוח אחרי ההעלאה; אין צורך ב-callback.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "שגיאה בהנפקת טוקן העלאה";
    const status = message === "נתיב קובץ לא מורשה" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
