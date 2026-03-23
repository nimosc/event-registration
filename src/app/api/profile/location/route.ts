import { NextRequest, NextResponse } from "next/server";
import { updateArtistLocation } from "@/lib/monday";
import { getSession, createSession, setSessionCookie } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
    }

    const { location } = (await request.json()) as { location: string };
    if (!location?.trim()) {
      return NextResponse.json({ error: "מיקום לא תקין" }, { status: 400 });
    }

    await updateArtistLocation(session.id, location.trim());

    // Re-issue JWT with updated location
    const updatedUser = { ...session, location: location.trim() };
    const token = await createSession(updatedUser);
    await setSessionCookie(token);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update location error:", error);
    return NextResponse.json({ error: "שגיאה בעדכון המיקום" }, { status: 500 });
  }
}
