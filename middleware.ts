import { NextRequest, NextResponse } from "next/server";

/**
 * Next.js middleware — Part 10 (hardened).
 *
 * Redirects unauthenticated browsers from protected pages to /login BEFORE
 * any page content renders — no flash of the dashboard shell, blank stats,
 * or "Offline" banners.
 *
 * Two-stage gate:
 *   1. FAST path — cookie presence + payload `exp` check (no network).
 *      Handles the "no cookie" and "expired cookie" cases instantly.
 *   2. AUTHORITATIVE path — forwards the cookie to the API's /auth/me and
 *      requires a 200. Catches forged tokens and cookies whose user was
 *      deleted, which the presence+expiry heuristic alone would let through.
 *
 * Fail-closed: if the API is unreachable we redirect to /login rather than
 * ever rendering a half-authenticated protected page.
 *
 * NOTE: the edge runtime cannot verify HS256 signatures with jsonwebtoken,
 * so the full security boundary remains requireAuth on every /api route;
 * this middleware is the UX gate that prevents broken-content flashes.
 */

const SESSION_COOKIE = "agrigate_session";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/map",
  "/devices",
  "/alerts",
  "/irrigation",
  "/settings",
  "/admin",
  "/technician",
  "/nodes",
];

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/** Cookie present + payload exp in the future (JWT signature NOT verified here). */
function hasUnexpiredToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return false;
    const normalized = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(normalized)) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/** Authoritative: does the API consider this session valid right now? */
async function sessionValid(req: NextRequest): Promise<boolean> {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false; // fail closed — never render protected content on uncertainty
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (isProtectedPath(pathname)) {
    if (!hasUnexpiredToken(token)) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    if (!(await sessionValid(req))) {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    return NextResponse.next();
  }

  // Already logged in → skip the login form.
  if (pathname === "/login") {
    if (hasUnexpiredToken(token) && (await sessionValid(req))) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/map/:path*",
    "/devices/:path*",
    "/alerts/:path*",
    "/irrigation/:path*",
    "/settings/:path*",
    "/admin/:path*",
    "/technician/:path*",
    "/nodes/:path*",
    "/login",
  ],
};