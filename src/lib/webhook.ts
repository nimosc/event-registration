const WEBHOOK_TIMEOUT_MS = 8000;

export async function postJsonWebhook(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Awaits POST so it finishes before the serverless response closes (Netlify/Vercel
 * often drop detached promises). Swallows errors — Monday is already updated.
 */
export async function postJsonWebhookOrLog(url: string, body: unknown): Promise<void> {
  try {
    await postJsonWebhook(url, body);
  } catch (err) {
    console.error("[Webhook] POST failed:", err);
  }
}
