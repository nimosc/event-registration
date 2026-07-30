/**
 * הכנת קובץ חשבונית להעלאה, בצד הלקוח.
 *
 * רקע: ל-Vercel יש מגבלת גוף בקשה של ~4.5MB. צילומי קבלה מהטלפון חורגים
 * בקלות. כאן מקטינים תמונות גדולות (canvas) לפני ההעלאה, וחוסמים PDF גדול
 * מדי בהודעה ברורה במקום "שגיאת רשת" מבלבלת.
 *
 * חשוב: יש להריץ פעם אחת ברגע בחירת הקובץ, ולהעביר את הקובץ המוקטן גם
 * לחילוץ וגם להגשה — כדי שה-SHA-256 של ה-token יתאים.
 */

/** מגבלה בטוחה מתחת ל-~4.5MB של Vercel */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** מעל הסף הזה כדאי לדחוס תמונה; מתחתיו משאירים כמו שהיא */
const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
/** הצד הארוך המרבי אחרי הקטנה — מספיק לקריאוּת טקסט לחילוץ ה-AI */
const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.82;
const MIN_JPEG_QUALITY = 0.4;

export class FileTooLargeError extends Error {
  readonly limitMB: number;
  constructor(limitBytes: number) {
    const limitMB = Math.round(limitBytes / (1024 * 1024));
    super(`הקובץ גדול מדי (מעל ${limitMB}MB)`);
    this.name = "FileTooLargeError";
    this.limitMB = limitMB;
  }
}

export interface PreparedFile {
  file: File;
  compressed: boolean;
  originalBytes: number;
}

function isImage(file: File): boolean {
  return /^image\//.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/**
 * מחזיר קובץ מוכן להעלאה. תמונות גדולות נדחסות; PDF גדול מדי זורק
 * FileTooLargeError; קבצים קטנים חוזרים כמו שהם.
 */
export async function prepareInvoiceFile(file: File): Promise<PreparedFile> {
  const originalBytes = file.size;

  if (isPdf(file)) {
    if (file.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
    return { file, compressed: false, originalBytes };
  }

  if (isImage(file)) {
    if (file.size <= COMPRESS_THRESHOLD_BYTES) {
      return { file, compressed: false, originalBytes };
    }
    try {
      const compressed = await compressImage(file);
      if (compressed && compressed.size < file.size) {
        if (compressed.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
        return { file: compressed, compressed: true, originalBytes };
      }
    } catch (err) {
      if (err instanceof FileTooLargeError) throw err;
      // פענוח נכשל (למשל HEIC) — נמשיך עם המקור ונאכוף מגבלה למטה.
    }
    if (file.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
    return { file, compressed: false, originalBytes };
  }

  // סוג לא מוכר — אכיפת מגבלת הפלטפורמה בלבד.
  if (file.size > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
  return { file, compressed: false, originalBytes };
}

async function compressImage(file: File): Promise<File | null> {
  const bitmap = await loadImage(file);
  const srcW = "width" in bitmap ? bitmap.width : 0;
  const srcH = "height" in bitmap ? bitmap.height : 0;
  if (!srcW || !srcH) return null;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // רקע לבן — משטח שקיפות (PNG) כדי שלא ייהפך לשחור ב-JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  let quality = JPEG_QUALITY;
  let blob = await canvasToBlob(canvas, quality);
  while (blob && blob.size > MAX_UPLOAD_BYTES && quality > MIN_JPEG_QUALITY) {
    quality = Math.max(MIN_JPEG_QUALITY, quality - 0.15);
    blob = await canvasToBlob(canvas, quality);
  }
  if (!blob) return null;

  const baseName = file.name.replace(/\.(png|jpe?g)$/i, "") || "invoice";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return await createImageBitmap(file);
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
}
