import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  COOKIE_NAME,
  createSession,
  SESSION_COOKIE_OPTIONS,
  SessionUser,
} from "@/lib/auth";
import { getRegistrationRole, isAdmin, parseRoleLabel, type Role } from "@/lib/roles";
const PROTECTED_ROUTES = ["/orders", "/my-registrations", "/admin"];
const ADMIN_ROUTES = ["/admin"];
const MONDAY_API_URL = "https://api.monday.com/v2";
const ARTISTS_BOARD_ID = 5092847546;
const ARTIST_ACTIVE_STATUS_COLUMN_ID = "color_mm18wjry";
const ARTIST_ROLE_COLUMN_ID = "color_mm18btbr";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

function getMondayToken(): string | null {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) return null;
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

/**
 * סטטוס ותפקיד חיים מ-Monday. כל שדה עשוי לחזור null — הקורא נשאר אז
 * עם הערך שב-JWT, כדי שכשל רגעי מול Monday לא יוריד הרשאות למשתמש.
 */
async function getLiveArtistProfile(
  artistId: string
): Promise<{ status: string | null; role: Role | null } | null> {
  const authHeader = getMondayToken();
  if (!authHeader) return null;

  const query = `
    query {
      items(ids: [${artistId}]) {
        id
        board { id }
        column_values(ids: ["${ARTIST_ACTIVE_STATUS_COLUMN_ID}", "${ARTIST_ROLE_COLUMN_ID}"]) {
          id
          text
        }
      }
    }
  `;

  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        "API-Version": "2024-01",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: {
        items?: {
          board?: { id: string };
          column_values?: { id?: string; text?: string }[];
        }[];
      };
    };
    const item = data.data?.items?.[0];
    if (!item || item.board?.id !== String(ARTISTS_BOARD_ID)) return null;
    const columns = item.column_values ?? [];
    const textOf = (id: string) =>
      (columns.find((cv) => cv.id === id)?.text || "").trim();
    return {
      status: textOf(ARTIST_ACTIVE_STATUS_COLUMN_ID) || null,
      role: parseRoleLabel(textOf(ARTIST_ROLE_COLUMN_ID)),
    };
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  );

  if (!isProtected) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);

    const isAdminRoute = ADMIN_ROUTES.some((route) =>
      pathname.startsWith(route)
    );

    const live = await getLiveArtistProfile(String(payload.id ?? ""));
    const effectiveStatus = live?.status || String(payload.status ?? "").trim();

    if (effectiveStatus !== "פעיל") {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("inactive", "1");
      return NextResponse.redirect(loginUrl);
    }

    // תפקיד חי גובר, אבל רק כשנקרא בהצלחה — אחרת נשארים עם מה שב-JWT
    const effectiveRole = live?.role ?? (payload.role as Role);

    if (isAdminRoute && !isAdmin(effectiveRole)) {
      return NextResponse.redirect(new URL("/orders", request.url));
    }

    if (
      pathname.startsWith("/orders") &&
      getRegistrationRole(effectiveRole) === null
    ) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    const response = NextResponse.next();
    const user: SessionUser = {
      id: String(payload.id ?? ""),
      name: String(payload.name ?? ""),
      role: effectiveRole,
      status: String(payload.status ?? ""),
      location: payload.location as string | undefined,
    };
    const newToken = await createSession(user);
    response.cookies.set(COOKIE_NAME, newToken, SESSION_COOKIE_OPTIONS);
    return response;
  } catch {
    const loginUrl = new URL("/", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(COOKIE_NAME);
    return response;
  }
}

export const config = {
  matcher: ["/orders/:path*", "/my-registrations/:path*", "/admin/:path*"],
};
