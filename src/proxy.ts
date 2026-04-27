import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { COOKIE_NAME } from "@/lib/auth";

const PROTECTED_ROUTES = ["/orders", "/my-registrations", "/admin"];
const ADMIN_ROUTES = ["/admin"];
const MONDAY_API_URL = "https://api.monday.com/v2";
const ARTISTS_BOARD_ID = 5092847546;
const ARTIST_ACTIVE_STATUS_COLUMN_ID = "color_mm18wjry";

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

async function getLiveArtistStatus(artistId: string): Promise<string | null> {
  const authHeader = getMondayToken();
  if (!authHeader) return null;

  const query = `
    query {
      items(ids: [${artistId}]) {
        id
        board { id }
        column_values(ids: ["${ARTIST_ACTIVE_STATUS_COLUMN_ID}"]) {
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
        items?: { board?: { id: string }; column_values?: { text?: string }[] }[];
      };
    };
    const item = data.data?.items?.[0];
    if (!item || item.board?.id !== String(ARTISTS_BOARD_ID)) return null;
    return (item.column_values?.[0]?.text || "").trim();
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

    const liveStatus = await getLiveArtistStatus(String(payload.id ?? ""));
    const effectiveStatus = liveStatus || String(payload.status ?? "").trim();

    if (effectiveStatus !== "פעיל") {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("inactive", "1");
      const response = NextResponse.redirect(loginUrl);
      response.cookies.delete(COOKIE_NAME);
      return response;
    }

    if (isAdminRoute && payload.role !== "מנהל") {
      return NextResponse.redirect(new URL("/orders", request.url));
    }

    if (pathname.startsWith("/orders") && payload.role === "מנהל") {
      return NextResponse.redirect(new URL("/admin", request.url));
    }

    return NextResponse.next();
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
