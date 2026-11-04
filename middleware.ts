/**
 * Redirects signed-out users away from (dashboard) routes.
 * Roadmap: S3.1 / K4.1 · Spec: ARCHITECTURE.md (API routes)
 * Status: scaffold — not implemented yet.
 */

import { NextResponse, type NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  // TODO: check the session cookie; demo sessions are allowed.
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/invoices/:path*", "/settings/:path*", "/fund/:path*", "/plan/:path*", "/history/:path*"],
};
