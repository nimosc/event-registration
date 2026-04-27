import { NextRequest, NextResponse } from "next/server";
import { mondayQuery, BOARDS, ARTIST_LOCATION_COLUMN_ID, parseDropdownLabel } from "@/lib/monday";
import { createSession, setSessionCookie, SessionUser } from "@/lib/auth";

interface ArtistItem {
  id: string;
  name: string;
  board: { id: string };
  column_values: { id: string; text: string; value: string | null }[];
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) {
      return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
    }

    const query = `
      query {
        items(ids: [${id}]) {
          id
          name
          board { id }
          column_values(ids: ["color_mm18btbr", "color_mm18wjry", "${ARTIST_LOCATION_COLUMN_ID}"]) {
            id
            text
            value
          }
        }
      }
    `;

    const data = await mondayQuery<{ items: ArtistItem[] }>(query);
    const artist = data.items?.[0];

    if (!artist || artist.board.id !== String(BOARDS.ARTISTS)) {
      return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
    }

    const statusCol = artist.column_values.find((cv) => cv.id === "color_mm18wjry");
    const status = (statusCol?.text || "").trim();
    if (status !== "פעיל") {
      return NextResponse.json(
        { error: "החשבון אינו פעיל כרגע." },
        { status: 403 }
      );
    }

    const roleCol = artist.column_values.find((cv) => cv.id === "color_mm18btbr");
    const role: SessionUser["role"] = roleCol?.text === "מנהל" ? "מנהל" : "אומן";

    const locationCol = artist.column_values.find((cv) => cv.id === ARTIST_LOCATION_COLUMN_ID);

    // Dropdown: Monday sometimes returns the label in `value` instead of `text`.
    let location: string | undefined =
      locationCol?.text?.trim() || parseDropdownLabel(locationCol?.value)?.trim() || undefined;

    const user: SessionUser = { id: artist.id, name: artist.name, role, status, location };
    const token = await createSession(user);
    await setSessionCookie(token);

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Magic link error:", error);
    return NextResponse.json({ error: "שגיאה פנימית בשרת" }, { status: 500 });
  }
}
