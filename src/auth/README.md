# AgriGate Authentication & RBAC (Part 10)

Session-based auth for the REST API plus login flow for the frontend. No new business features — access control only.

## Roles

| Role | Rank | Can do |
|---|---|---|
| `farmer` | 0 | Everything read-only + acknowledge alerts + manual irrigation trigger |
| `technician` | 1 | All of the above **+ register nodes, edit irrigation schedules** (and future threshold editing) |
| `admin` | 2 | All of the above (+ reserved for future user-management endpoints) |

Hierarchy check: `requireRole("technician")` passes for technician **and** admin.

## Auth flow

```text
POST /api/auth/login { email, password }
  → bcrypt.compare against users.password_hash (pgcrypt $2a$ hashes)
  → JWT signed with JWT_SECRET (HS256, 7-day expiry)
  → Set-Cookie: agrigate_session (httpOnly, SameSite=Lax)
  → body also returns the token (for curl / Bearer-style clients)

Every other /api/* route:
  requireAuth   → verifies cookie (or Authorization: Bearer), attaches req.user
                 → 401 { error } when missing/expired
  requireRole   → 403 when role rank is below minimum

POST /api/auth/logout  → clears the cookie
GET  /api/auth/me      → current user profile
```

**Enforcement map:**

| Route(s) | Requirement |
|---|---|
| `/api/auth/login`, `/api/auth/logout` | public |
| all GETs, alert acknowledge, manual irrigation start | any authenticated role |
| `POST /api/nodes`, `PATCH /api/irrigation/schedules/:id` | technician or admin |
| future user management | admin (reserved pattern in `alerts.routes.ts` export) |

The old Part 3 placeholder `userId` request bodies are gone: acknowledging and manual triggering now attribute to `req.user.id` server-side.

## Frontend

- `app/login/page.tsx` — themed login form; on success redirects to `/dashboard`
- `middleware.ts` — presence+expiry check on the session cookie redirects browsers from protected pages to `/login` (**convenience only**; the edge can't verify HS256 signatures — `requireAuth` is the real boundary, and any stale cookie gets a 401 → auto-redirect via `lib/api.ts`)
- `lib/hooks/useAuth.ts` — `{ user, loading }` from `/auth/me`; drives TopBar's real name/role badge and role-gated controls
- TopBar shows the logged-in operator (distinct icon/color per role) + logout button
- Schedule edit toggles and "Register New Node" render only for technician/admin — hidden buttons are UX, not security

## ⚠ DEV-ONLY TEST CREDENTIALS

> These exist purely because this is a pilot/demo environment. They must NEVER be used in production — rotate and provision real users before any deployment.

| Role | Email | Password |
|---|---|---|
| admin | `admin@agri-gate.tn` | `AdminPass2026!` |
| technician | `technician@agri-gate.tn` | `TechPass2026!` |
| farmer | `farmer@agri-gate.tn` | `FarmerPass2026!` |
| **platform admin** (staff) | `platform@agri-gate.tn` | `PlatformPass2026!` |

## Platform admin & tenant isolation (Part 10 extension)

A **platform admin is AgriGate staff**, orthogonal to the client-side
farmer/technician/admin ladder (`users.is_platform_admin`, migration 0007).
Their `users.org_id` is NULL — they belong to no client organization.

**JWT payload:** `{ userId, role, orgId (nullable), isPlatformAdmin }`.

Two independent gates, never one hierarchy:

| Middleware | Checks | Fails with |
|---|---|---|
| `requireRole("technician")` etc. | client role ladder rank | 403 role message |
| `requirePlatformAdmin` | `isPlatformAdmin === true` only | 403 "platform administrator access required" |

### Tenancy rules

- **Client users** are locked to their own organization: any request for a
  farm outside `users.org_id` → **403**, their own org always wins.
- **Platform admins** may read any farm/org, but only by naming it explicitly:
  - farm-scoped routes → the `:farmId` path param (validated via `assertFarmAccess`)
  - `GET /api/farms` list → requires `?orgId=<uuid>`, otherwise **400**
    ("explicit pick" rule — staff never receive unscoped cross-client data)
- Entities reached indirectly (node detail, alert acknowledge, schedule
  edit/start) resolve their owning farm first and apply the same gate.
- No auto-unscoped queries exist anywhere; a second client org can be onboarded
  and its data stays invisible to the first client.

### Staff surface

Every `/api/admin/*` route is gated by `requirePlatformAdmin` (non-staff
gets 403). Management is consolidated in the **Settings** page (Platform
View); `/admin` is read-only browse + farm-context switching. Highlights:

- `GET|POST /api/admin/farms/:farmId/users` — per-farm user list / create
- `PATCH /api/admin/users/:userId` — edit `name`/`email`/`role`, or `active`
  (`false` revokes, `true` restores login access)
- `DELETE /api/admin/users/:userId` — archive-or-hard-delete
- `PATCH /api/admin/farms/:farmId` — rename or reassign to another org
- `DELETE /api/admin/orgs/:orgId` — guarded hard delete (400 if farms/users
  still attached, 404 if missing)

## Configuration

`.env`:

```env
JWT_SECRET=<64-hex random>
```

Generate per environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Never commit a real secret. Never reuse one secret across dev/staging/prod** — a leaked dev secret would let anyone mint valid tokens elsewhere.
