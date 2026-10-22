import { NextResponse, type NextRequest } from "next/server";

/**
 * Study participants (anyone holding the study cookie) are confined to the study: its page and its API. Every other
 * page redirects back and every other API call is refused, so no route outside the study can reveal hidden-exposure
 * information to a participant in the control arm.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const allowed =
    pathname === "/experiment" ||
    pathname.startsWith("/experiment/") ||
    pathname.startsWith("/api/experiment") ||
    pathname === "/api/health";
  if (allowed) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Not available during the study" } },
      { status: 403 },
    );
  }
  return NextResponse.redirect(new URL("/experiment", request.url));
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      has: [{ type: "cookie", key: "pl_exp" }],
    },
  ],
};
