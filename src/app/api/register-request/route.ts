import { NextRequest, NextResponse } from "next/server";
import {
  ARTIST_ACTIVE_STATUS_COLUMN_ID,
  ARTIST_LOCATION_COLUMN_ID,
  BOARDS,
  mondayQuery,
} from "@/lib/monday";

type MondayColumnDef = {
  id: string;
  title: string;
  type: string;
};

type MondayGroupDef = {
  id: string;
  title: string;
};

type RegistrationInput = {
  name?: string;
  address?: string;
  location?: string;
  locations?: string[];
  phone?: string;
  email?: string;
  workedBefore?: string;
  trained?: string;
};

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function to972Format(raw: string): string {
  const base = digitsOnly(raw);
  if (!base) return "";

  let normalized = base;
  if (normalized.startsWith("00")) normalized = normalized.slice(2);
  if (normalized.startsWith("972")) return normalized;
  if (normalized.startsWith("0")) return `972${normalized.slice(1)}`;
  if (normalized.length === 9 && /^[2-9]/.test(normalized)) return `972${normalized}`;
  return normalized;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function toYesNo(value: string | undefined): "כן" | "לא" | "" {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  if (normalized === "כן" || normalized === "yes" || normalized === "true") return "כן";
  if (normalized === "לא" || normalized === "no" || normalized === "false") return "לא";
  return "";
}

function pickColumn(
  columns: MondayColumnDef[],
  matcher: (col: MondayColumnDef) => boolean
): MondayColumnDef | undefined {
  return columns.find(matcher);
}

function formatValueForMonday(columnType: string, value: string | string[]): unknown {
  if (!value || (Array.isArray(value) && value.length === 0)) return value;

  if (columnType === "phone") {
    return { phone: Array.isArray(value) ? value[0] : value, countryShortName: "IL" };
  }

  if (columnType === "email") {
    const email = Array.isArray(value) ? value[0] : value;
    return { email, text: email };
  }

  if (columnType === "dropdown") {
    return { labels: Array.isArray(value) ? value : [value] };
  }

  if (columnType === "color" || columnType === "status") {
    return { label: Array.isArray(value) ? value[0] : value };
  }

  return Array.isArray(value) ? value.join(", ") : value;
}

function extractPhoneFromValue(value: string | null | undefined): string[] {
  if (!value) return [];
  const candidates = new Set<string>();
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const normalized = to972Format(raw);
    if (normalized) candidates.add(normalized);
  };

  push(value);
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") {
      push(parsed);
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      push(obj.phone as string);
      push(obj.text as string);
      push(obj.value as string);
      push(obj.phoneNumber as string);
      push(obj.number as string);
    }
  } catch {
    // ignore parse errors
  }

  return Array.from(candidates);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegistrationInput;
    const trimmedName = (body.name || "").trim();
    const trimmedAddress = (body.address || "").trim();
    const selectedLocations = Array.isArray(body.locations)
      ? body.locations.map((value) => value.trim()).filter(Boolean)
      : [];
    const legacyLocation = (body.location || "").trim();
    if (legacyLocation && !selectedLocations.includes(legacyLocation)) {
      selectedLocations.push(legacyLocation);
    }
    const trimmedEmail = (body.email || "").trim();
    const workedBefore = toYesNo(body.workedBefore);
    const trained = toYesNo(body.trained);
    const normalizedPhone = to972Format(body.phone || "");

    if (
      !trimmedName ||
      !trimmedAddress ||
      selectedLocations.length === 0 ||
      !trimmedEmail ||
      !normalizedPhone ||
      !workedBefore ||
      !trained
    ) {
      return NextResponse.json(
        { error: "יש למלא את כל שדות ההרשמה" },
        { status: 400 }
      );
    }

    const boardData = await mondayQuery<{
      boards: {
        groups: MondayGroupDef[];
        columns: MondayColumnDef[];
      }[];
    }>(`
      query {
        boards(ids: [${BOARDS.ARTISTS}]) {
          groups {
            id
            title
          }
          columns {
            id
            title
            type
          }
        }
      }
    `);

    const board = boardData.boards?.[0];
    if (!board) {
      return NextResponse.json({ error: "לא נמצא בורד אומנים" }, { status: 500 });
    }

    const targetGroup = board.groups.find(
      (group) => normalizeLabel(group.title) === normalizeLabel("בתהליך בדיקה")
    );
    if (!targetGroup) {
      return NextResponse.json({ error: "לא נמצאה קבוצה 'בתהליך בדיקה'" }, { status: 500 });
    }

    const phoneColumn =
      pickColumn(board.columns, (col) => col.type === "phone") ||
      pickColumn(board.columns, (col) => /טלפון|נייד|פלאפון/i.test(col.title));
    if (!phoneColumn) {
      return NextResponse.json({ error: "לא נמצאה עמודת טלפון" }, { status: 500 });
    }

    const existingData = await mondayQuery<{
      boards: {
        items_page: {
          items: {
            id: string;
            group: { id: string; title: string };
            column_values: { id: string; text: string; value: string | null }[];
          }[];
        };
      }[];
    }>(`
      query {
        boards(ids: [${BOARDS.ARTISTS}]) {
          items_page(limit: 500) {
            items {
              id
              group {
                id
                title
              }
              column_values(ids: ["${phoneColumn.id}"]) {
                id
                text
                value
              }
            }
          }
        }
      }
    `);

    const items = existingData.boards?.[0]?.items_page?.items ?? [];
    const hasPending = items.some((item) => {
      if (item.group?.id !== targetGroup.id) return false;
      const phoneCol = item.column_values?.[0];
      const candidates = new Set<string>();
      if (phoneCol?.text) candidates.add(to972Format(phoneCol.text));
      for (const phoneCandidate of extractPhoneFromValue(phoneCol?.value)) {
        candidates.add(phoneCandidate);
      }
      return candidates.has(normalizedPhone);
    });

    if (hasPending) {
      return NextResponse.json(
        { error: "כבר קיימת הרשמה בתהליך בדיקה עבור הטלפון הזה" },
        { status: 409 }
      );
    }

    const addressColumn = pickColumn(board.columns, (col) => /כתובת/.test(col.title));
    const emailColumn =
      pickColumn(board.columns, (col) => col.type === "email") ||
      pickColumn(board.columns, (col) => /מייל|אימייל|דוא"ל|email/i.test(col.title));
    const locationColumn = board.columns.find((col) => col.id === ARTIST_LOCATION_COLUMN_ID);
    const activeStatusColumn = board.columns.find(
      (col) => col.id === ARTIST_ACTIVE_STATUS_COLUMN_ID
    );
    const workedBeforeColumn = pickColumn(
      board.columns,
      (col) => /עבדת בעבר|עבדת|נשימה/.test(col.title)
    );
    const trainedColumn = pickColumn(board.columns, (col) => /הכשרה|עברת הכשרה/.test(col.title));

    const columnValuesRaw: Record<string, unknown> = {};
    columnValuesRaw[phoneColumn.id] = formatValueForMonday(phoneColumn.type, normalizedPhone);
    if (addressColumn) {
      columnValuesRaw[addressColumn.id] = formatValueForMonday(addressColumn.type, trimmedAddress);
    }
    if (emailColumn) {
      columnValuesRaw[emailColumn.id] = formatValueForMonday(emailColumn.type, trimmedEmail);
    }
    if (locationColumn) {
      columnValuesRaw[locationColumn.id] = formatValueForMonday(locationColumn.type, selectedLocations);
    }
    if (activeStatusColumn) {
      columnValuesRaw[activeStatusColumn.id] = formatValueForMonday(
        activeStatusColumn.type,
        "בבדיקה"
      );
    }
    if (workedBeforeColumn) {
      columnValuesRaw[workedBeforeColumn.id] = formatValueForMonday(workedBeforeColumn.type, workedBefore);
    }
    if (trainedColumn) {
      columnValuesRaw[trainedColumn.id] = formatValueForMonday(trainedColumn.type, trained);
    }

    const createMutation = `
      mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
        create_item(
          board_id: $boardId,
          group_id: $groupId,
          item_name: $itemName,
          column_values: $columnValues
        ) {
          id
        }
      }
    `;

    const createData = await mondayQuery<{ create_item: { id: string } }>(createMutation, {
      boardId: BOARDS.ARTISTS,
      groupId: targetGroup.id,
      itemName: trimmedName,
      columnValues: JSON.stringify(columnValuesRaw),
    });

    const itemId = createData.create_item.id;

    const updateBody = [
      `שם: ${trimmedName}`,
      `טלפון: ${normalizedPhone}`,
      `כתובת: ${trimmedAddress}`,
      `איזור מגורים: ${selectedLocations.join(", ")}`,
      `כתובת מייל: ${trimmedEmail}`,
      `האם עבדת בעבר עם עמותת נשימה: ${workedBefore}`,
      `האם עברת הכשרה: ${trained}`,
      "",
      "מקור: טופס הרשמה ראשונית באתר",
    ].join("\n");

    await mondayQuery(
      `
        mutation ($itemId: ID!, $body: String!) {
          create_update(item_id: $itemId, body: $body) {
            id
          }
        }
      `,
      { itemId, body: updateBody }
    );

    return NextResponse.json({ success: true, itemId });
  } catch (error) {
    console.error("[/api/register-request] error:", error);
    return NextResponse.json({ error: "שגיאה פנימית בשרת" }, { status: 500 });
  }
}
