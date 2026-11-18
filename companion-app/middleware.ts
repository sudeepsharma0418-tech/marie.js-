import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/jwt";

// Send signed out visitors to /login, and signed in visitors away from the auth pages.
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isProtected = pathname.startsWith("/companions");

  if (isProtected && !session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isAuthPage && session) {
    return NextResponse.redirect(new URL("/companions", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/companions/:path*", "/login", "/signup"],
};
