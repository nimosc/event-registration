import { NextRequest, NextResponse } from "next/server";
import { mondayQuery, BOARDS, getColumnValue, ARTIST_ACTIVE_STATUS_COLUMN_ID, MondayItem } from "@/lib/monday";
import { postJsonWebhook } from "@/lib/webhook";

const ACCOUNT_RECOVERY_WEBHOOK_URL =
  "https://hook.eu1.make.com/kxu61lmvm2l73w7qrrs6ghy379yknvij";

type MondayColumnDef = {
  id: string;
  title: string;
  type: string;
};

type ArtistWithPhone = MondayItem;

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function buildPhoneVariants(raw: string): string[] {
  const variants = new Set<string>();
  const base = digitsOnly(raw);
  if (!base) return [];

  const push = (value: string) => {
    if (value) variants.add(value);
  };

  push(base);

  let normalized = base;
  if (normalized.startsWith("00")) {
    normalized = normalized.slice(2);
    push(normalized);
  }

  // +972/972 format -> also accept local 0X... equivalent.
  if (normalized.startsWith("972")) {
    const withoutCountry = normalized.slice(3);
    push(withoutCountry);
    push(`0${withoutCountry}`);
  }

  // Local 0X... format -> also accept 972X... equivalent.
  if (normalized.startsWith("0")) {
    const withoutLeadingZero = normalized.slice(1);
    push(withoutLeadingZero);
    push(`972${withoutLeadingZero}`);
    push(`00972${withoutLeadingZero}`);
  }

  return Array.from(variants);
}

function to972Format(raw: string): string {
  const base = digitsOnly(raw);
  if (!base) return "";

  let normalized = base;
  if (normalized.startsWith("00")) normalized = normalized.slice(2);
  if (normalized.startsWith("972")) return normalized;
  if (normalized.startsWith("0")) return `972${normalized.slice(1)}`;
  // Common local input without leading 0, e.g. 524834745 -> 972524834745
  if (normalized.length === 9 && /^[2-9]/.test(normalized)) return `972${normalized}`;
  return normalized;
}

function extractPhoneCandidates(value: string | null | undefined): string[] {
  if (!value) return [];

  const candidates = new Set<string>();
  const pushCandidate = (input: unknown) => {
    if (typeof input !== "string") return;
    const normalizedList = buildPhoneVariants(input);
    for (const normalized of normalizedList) {
      candidates.add(normalized);
    }
  };

  pushCandidate(value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      pushCandidate(parsed);
    } else if (parsed && typeof parsed === "object") {
      const maybeObject = parsed as Record<string, unknown>;
      pushCandidate(maybeObject.phone as string);
      pushCandidate(maybeObject.text as string);
      pushCandidate(maybeObject.value as string);
      pushCandidate(maybeObject.phoneNumber as string);
      pushCandidate(maybeObject.number as string);
    }
  } catch {
    // Ignore malformed JSON and use raw string fallback.
  }

  return Array.from(candidates);
}

async function resolvePhoneColumnId(): Promise<string> {
  const columnsQuery = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;

  const columnsData = await mondayQuery<{
    boards: { columns: MondayColumnDef[] }[];
  }>(columnsQuery);
  const columns = columnsData.boards?.[0]?.columns ?? [];

  const byType = columns.find((col) => col.type === "phone");
  if (byType) return byType.id;

  const byTitle = columns.find((col) => /טלפון|נייד|פלאפון/i.test(col.title));
  if (byTitle) return byTitle.id;

  throw new Error("Phone column was not found on artists board");
}

async function getArtistsWithPhoneColumn(phoneColumnId: string): Promise<ArtistWithPhone[]> {
  const artistsQuery = `
    query {
      boards(ids: [${BOARDS.ARTISTS}]) {
        items_page(limit: 500) {
          items {
            id
            name
            column_values(ids: ["${ARTIST_ACTIVE_STATUS_COLUMN_ID}", "${phoneColumnId}"]) {
              id
              text
              value
            }
          }
        }
      }
    }
  `;
  const artistsData = await mondayQuery<{
    boards: { items_page: { items: ArtistWithPhone[] } }[];
  }>(artistsQuery);
  return artistsData.boards?.[0]?.items_page?.items ?? [];
}

export async function POST(request: NextRequest) {
  try {
    const { phone } = (await request.json()) as { phone?: string };
    const phoneInputRaw = phone || "";
    const inputVariants = buildPhoneVariants(phone || "");

    if (inputVariants.length === 0) {
      return NextResponse.json({ error: "טלפון הוא שדה חובה" }, { status: 400 });
    }

    const phoneColumnId = await resolvePhoneColumnId();
    const artists = await getArtistsWithPhoneColumn(phoneColumnId);

    const matchedArtists = artists.filter((item) => {
      const phoneCol = getColumnValue(item, phoneColumnId);
      const values = [phoneCol?.text ?? "", ...(phoneCol?.value ? extractPhoneCandidates(phoneCol.value) : [])];

      const artistVariants = new Set<string>();
      for (const value of values) {
        const candidateVariants = buildPhoneVariants(value);
        for (const candidate of candidateVariants) {
          artistVariants.add(candidate);
        }
      }

      return inputVariants.some((inputValue) => artistVariants.has(inputValue));
    });

    if (matchedArtists.length === 0) {
      return NextResponse.json({ error: "אין לך משתמש" }, { status: 404 });
    }

    const activeArtist = matchedArtists.find(
      (item) => (getColumnValue(item, ARTIST_ACTIVE_STATUS_COLUMN_ID)?.text || "").trim() === "פעיל"
    );
    if (activeArtist) {
      await postJsonWebhook(ACCOUNT_RECOVERY_WEBHOOK_URL, {
        phone: to972Format(phoneInputRaw),
        normalizedPhone: to972Format(phoneInputRaw),
        name: activeArtist.name,
        mondayItemId: activeArtist.id,
      });

      return NextResponse.json({ success: true });
    }

    const pendingArtist = matchedArtists.find(
      (item) => (getColumnValue(item, ARTIST_ACTIVE_STATUS_COLUMN_ID)?.text || "").trim() === "בבדיקה"
    );
    if (pendingArtist) {
      return NextResponse.json(
        { error: "המשתמש שלך בבדיקה, ובימים הקרובים יצרו איתך קשר." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: "אין לך משתמש" }, { status: 404 });
  } catch (error) {
    console.error("[/api/account-recovery] error:", error);
    return NextResponse.json({ error: "שגיאה פנימית בשרת" }, { status: 500 });
  }
}
