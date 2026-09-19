/**
 * POST של JSON עם פענוח תשובה עמיד: תשובה לא-JSON (למשל עמוד timeout של
 * Vercel) הופכת להודעת שגיאה עם קוד הסטטוס, במקום להיזרק ולהיראות כ"שגיאת רשת".
 */
export interface JsonResponse<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown
): Promise<JsonResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T & { error?: string };
  try {
    data = await res.json();
  } catch {
    data = {
      error: res.ok ? "שגיאה בפענוח תשובת השרת" : `שגיאת שרת (${res.status}) — נסה שוב`,
    } as T & { error?: string };
  }
  return { ok: res.ok && !data.error, status: res.status, data };
}
