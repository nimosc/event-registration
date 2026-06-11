import Anthropic from "@anthropic-ai/sdk";
import type { DocumentBlockParam, ImageBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

export interface ExtractedInvoiceData {
  receiptNumber: string | null;
  amount: number | null;
  description: string | null;
}

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

function resolveMediaType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.includes("jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.includes("jpg")) return "image/jpeg";
  if (name.includes("png")) return "image/png";
  return "image/jpeg";
}

export function isInvoiceExtractAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function extractInvoiceData(file: File): Promise<ExtractedInvoiceData> {
  const client = getAnthropicClient();
  if (!client) {
    return { receiptNumber: null, amount: null, description: null };
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = resolveMediaType(file);

  const textBlock: TextBlockParam = {
    type: "text",
    text: `You are analyzing an invoice or receipt document. Extract the following fields:
1. receiptNumber: the invoice/receipt number or ID
2. amount: the total amount to pay (as a number, no currency symbol)
3. description: a short 1-sentence description of what the invoice is for (in Hebrew if the document is in Hebrew)

Return ONLY a valid JSON object:
{
  "receiptNumber": "<string or null>",
  "amount": <number or null>,
  "description": "<string or null>"
}`,
  };

  let contentBlock: ImageBlockParam | DocumentBlockParam;
  if (mediaType.startsWith("image/")) {
    contentBlock = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: base64,
      },
    };
  } else {
    contentBlock = {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64,
      },
    };
  }

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [{ role: "user", content: [contentBlock, textBlock] }],
  });

  const text = message.content.find((b) => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { receiptNumber: null, amount: null, description: null };

  const parsed = JSON.parse(match[0]);
  return {
    receiptNumber: parsed.receiptNumber ?? null,
    amount: parsed.amount != null ? Number(parsed.amount) : null,
    description: parsed.description ?? null,
  };
}
