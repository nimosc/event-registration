import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { COOKIE_NAME } from "@/lib/auth";

const PROTECTED_ROUTES = ["/orders", "/my-registrations", "/admin"];
const ADMIN_ROUTES = ["/admin"];

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
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

    if (isAdminRoute && payload.role !== "מנהל") {
      return NextResponse.redirect(new URL("/orders", request.url));
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
