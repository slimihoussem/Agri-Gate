import { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken, AuthUser, SESSION_COOKIE } from "./authService";
import type { Role } from "./authService";
import { hasCapability } from "./permissions";

/**
 * Access control — capability-based (replaces the Part 10 hierarchy and
 * the separate isPlatformAdmin flag).
 *
 *   requireAuth                  → valid session, attaches req.user
 *   requirePermission(action)    → admin passes everything; other roles need
 *                                  the action listed in PERMISSIONS[role]
 *   requireAdminUser             → role === 'admin' only (staff surface)
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface SessionUser extends AuthUser {
  role: Role;
}

function readToken(req: Request): string | undefined {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : undefined;
  return req.cookies?.[SESSION_COOKIE] ?? bearer;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  verifyToken(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => {
      res.status(401).json({ error: "Session invalid or expired — log in again" });
    });
};

/** Capability gate: admins pass every action; others need the explicit capability. */
export function requirePermission(action: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!hasCapability(req.user.role, action)) {
      res.status(403).json({ error: `Forbidden — missing capability "${action}"` });
      return;
    }
    next();
  };
}

/** Staff-only surface (admin console endpoints). Not a capability — a hard role check. */
export const requireAdminUser: RequestHandler = (req, res, next): void => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden — platform administrator access required" });
    return;
  }
  next();
};

/** Staff gate: admin OR technician (both platform-scoped, no home org). */
export const requireStaff: RequestHandler = (req, res, next): void => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin" && req.user.role !== "technician") {
    res.status(403).json({ error: "Forbidden — staff access required" });
    return;
  }
  next();
};
