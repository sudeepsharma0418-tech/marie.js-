import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/jwt";

// Pages only signed in people can open. Companion pages (/c/...) and
// profiles (/u/...) stay public so they can be shared.
const PRIVATE = ["/home", "/messages", "/people", "/chat", "/companions", "/settings", "/welcome"];

export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isPrivate = PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isPrivate && !session) return NextResponse.redirect(new URL("/login", req.url));
  if (isAuthPage && session) return NextResponse.redirect(new URL("/home", req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/home", "/messages/:path*", "/people", "/chat/:path*", "/companions/:path*", "/settings", "/welcome", "/login", "/signup"],
};
