import { NextRequest, NextResponse } from "next/server";
import { mondayQuery, BOARDS, ARTIST_LOCATION_COLUMN_ID, parseDropdownLabel } from "@/lib/monday";
import { createSession, COOKIE_NAME, SESSION_COOKIE_OPTIONS, SessionUser } from "@/lib/auth";

interface ArtistItem {
  id: string;
  name: string;
  board: { id: string };
  column_values: { id: string; text: string; value: string | null }[];
}

function redirectInactive(request: NextRequest): NextResponse {
  const loginUrl = new URL("/", request.url);
  loginUrl.searchParams.set("inactive", "1");
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) {
      return redirectInactive(request);
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
      return redirectInactive(request);
    }

    const statusCol = artist.column_values.find((cv) => cv.id === "color_mm18wjry");
    const status = (statusCol?.text || "").trim();
    if (status !== "פעיל") {
      return redirectInactive(request);
    }

    const roleCol = artist.column_values.find((cv) => cv.id === "color_mm18btbr");
    const role: SessionUser["role"] = roleCol?.text === "מנהל" ? "מנהל" : roleCol?.text === "ODT" ? "ODT" : "אומן";

    const locationCol = artist.column_values.find((cv) => cv.id === ARTIST_LOCATION_COLUMN_ID);

    // Dropdown: Monday sometimes returns the label in `value` instead of `text`.
    let location: string | undefined =
      locationCol?.text?.trim() || parseDropdownLabel(locationCol?.value)?.trim() || undefined;

    const user: SessionUser = { id: artist.id, name: artist.name, role, status, location };
    const token = await createSession(user);

    const destination = role === "מנהל" ? "/admin" : "/orders";
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(COOKIE_NAME, token, SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    console.error("Magic link error:", error);
    return redirectInactive(request);
  }
}
