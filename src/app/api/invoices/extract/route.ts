import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import type { ImageBlockParam, DocumentBlockParam, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function resolveMediaType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.includes("jpeg")) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  // Try to guess from the filename if it contains the format name
  if (name.includes("jpg")) return "image/jpeg";
  if (name.includes("png")) return "image/png";
  return "image/jpeg"; // sensible default for scanned invoices
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "לא מורשה" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "לא צורף קובץ" }, { status: 400 });
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

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: [contentBlock, textBlock] }],
    });

    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ receiptNumber: null, amount: null, description: null });

    const parsed = JSON.parse(match[0]);
    return NextResponse.json({
      receiptNumber: parsed.receiptNumber ?? null,
      amount: parsed.amount != null ? Number(parsed.amount) : null,
      description: parsed.description ?? null,
    });
  } catch (err) {
    console.error("Invoice extract error:", err);
    return NextResponse.json({ error: "שגיאה בחילוץ נתוני החשבונית" }, { status: 500 });
  }
}
