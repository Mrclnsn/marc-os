import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!ok) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Alles behalve login, de MCP-endpoint (eigen token), health-check en statische bestanden
  matcher: ["/((?!login|api/mcp|api/health|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon).*)"],
};
