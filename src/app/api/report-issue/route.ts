import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { mondayQuery } from "@/lib/monday";

const ISSUE_REPORTS_BOARD_ID = 5094343821;

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, path } = body as {
      title?: string;
      description?: string;
      path?: string;
    };

    const normalizedTitle = (title || "").trim();
    const normalizedDescription = (description || "").trim();

    if (!normalizedTitle || !normalizedDescription) {
      return NextResponse.json(
        { error: "כותרת ותיאור הם שדות חובה" },
        { status: 400 }
      );
    }

    if (normalizedTitle.length > 120) {
      return NextResponse.json(
        { error: "כותרת ארוכה מדי (עד 120 תווים)" },
        { status: 400 }
      );
    }

    if (normalizedDescription.length > 3000) {
      return NextResponse.json(
        { error: "תיאור ארוך מדי (עד 3000 תווים)" },
        { status: 400 }
      );
    }

    const location = (path || "").trim() || "לא צוין";
    const now = new Date().toLocaleString("he-IL", { hour12: false });

    const createItemMutation = `
      mutation ($boardId: ID!, $itemName: String!) {
        create_item(board_id: $boardId, item_name: $itemName) {
          id
        }
      }
    `;

    const createItemData = await mondayQuery<{ create_item: { id: string } }>(
      createItemMutation,
      {
        boardId: ISSUE_REPORTS_BOARD_ID,
        itemName: normalizedTitle,
      }
    );

    const itemId = createItemData.create_item.id;
    const updateBody = [
      "תיאור התקלה:",
      normalizedDescription,
      "",
      `דווח על ידי: ${session.name} (${session.role})`,
      `עמוד: ${location}`,
      `תאריך דיווח: ${now}`,
    ].join("\n");

    const createUpdateMutation = `
      mutation ($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) {
          id
        }
      }
    `;

    await mondayQuery(createUpdateMutation, {
      itemId,
      body: updateBody,
    });

    return NextResponse.json({ success: true, itemId });
  } catch (error) {
    console.error("Report issue error:", error);
    return NextResponse.json(
      { error: "שגיאה בשליחת הדיווח" },
      { status: 500 }
    );
  }
}
