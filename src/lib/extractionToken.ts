import { createHmac, timingSafeEqual } from "node:crypto";
import type { ExtractedInvoiceFields } from "@/lib/invoiceValidation";

/**
 * Signed extraction result: binds AI-extracted invoice fields to the exact file
 * (SHA-256) they were extracted from, so the submit route can trust the client's
 * extraction without re-running the AI. Signed with JWT_SECRET (HMAC-SHA256).
 */

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes — covers a normal form session

interface ExtractionTokenPayload {
  fileHash: string;
  receiptNumber: string | null;
  amount: number | null;
  description: string | null;
  documentType: ExtractedInvoiceFields["documentType"];
  exp: number;
}

function getSecret(): string | null {
  const secret = process.env.JWT_SECRET?.trim();
  return secret || null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signExtractionToken(
  fields: ExtractedInvoiceFields,
  fileHash: string
): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const payload: ExtractionTokenPayload = {
    fileHash,
    receiptNumber: fields.receiptNumber ?? null,
    amount: fields.amount ?? null,
    description: fields.description ?? null,
    documentType: fields.documentType ?? null,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

/** Returns the signed fields when the token is valid for this exact file, else null. */
export function verifyExtractionToken(
  token: string,
  fileHash: string
): ExtractedInvoiceFields | null {
  const secret = getSecret();
  if (!secret || !token) return null;

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = hmac(body, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: ExtractionTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (payload.fileHash !== fileHash) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;

  return {
    receiptNumber: payload.receiptNumber ?? null,
    amount: payload.amount ?? null,
    description: payload.description ?? null,
    documentType: payload.documentType ?? null,
  };
}

export async function sha256OfFile(file: Blob): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}
