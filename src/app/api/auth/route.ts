import { NextRequest, NextResponse } from "next/server";
import { getAllArtists, getColumnValue, parseColorLabel, ARTIST_LOCATION_COLUMN_ID } from "@/lib/monday";
import { createSession, setSessionCookie, clearSessionCookie, SessionUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body as { username: string; password: string };

    if (!username || !password) {
      return NextResponse.json(
        { error: "שם משתמש וסיסמה הם שדות חובה" },
        { status: 400 }
      );
    }

    const artists = await getAllArtists();

    const artist = artists.find((item) => {
      const usernameCol = getColumnValue(item, "text_mm18xbdq");
      const passwordCol = getColumnValue(item, "text_mm18d6vn");
      return (
        usernameCol?.text?.trim() === username.trim() &&
        passwordCol?.text?.trim() === password.trim()
      );
    });

    if (!artist) {
      return NextResponse.json(
        { error: "שם משתמש או סיסמה שגויים" },
        { status: 401 }
      );
    }

    // Check if active
    const statusCol = getColumnValue(artist, "color_mm18wjry");
    const status = statusCol?.text || "";
    if (status === "לא פעיל") {
      return NextResponse.json(
        { error: "החשבון שלך אינו פעיל. פנה למנהל." },
        { status: 403 }
      );
    }

    // Get system role
    const roleCol = getColumnValue(artist, "color_mm18btbr");
    const roleLabel = roleCol?.text || "";
    const role: SessionUser["role"] =
      roleLabel === "מנהל" ? "מנהל" : "אומן";

    const locationCol = getColumnValue(artist, ARTIST_LOCATION_COLUMN_ID);
    const location = locationCol?.text?.trim() || undefined;

    const user: SessionUser = {
      id: artist.id,
      name: artist.name,
      role,
      location,
    };

    const token = await createSession(user);
    await setSessionCookie(token);

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית בשרת. אנא נסה שוב." },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    await clearSessionCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "שגיאה בהתנתקות" },
      { status: 500 }
    );
  }
}
