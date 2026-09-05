/**
 * Migration 014: capability-based access-control overhaul
 *
 *  - 'admin' becomes a platform-wide staff role (org_id NULL, no farm scope)
 *  - old farm-scoped 'admin' users are downgraded to technician (NOTICEd)
 *  - is_platform_admin is dropped — role='admin' fully supersedes it
 *  - users.is_active for deactivation instead of hard delete
 *  - admin_actions_log: audit trail for cross-tenant admin writes
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Platform admins → role='admin', org_id=NULL
    UPDATE users SET role = 'admin', org_id = NULL WHERE is_platform_admin = TRUE;

    -- 2. Downgrade remaining farm-scoped admins to technician (NOTICE per user)
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT id, email FROM users
        WHERE role = 'admin' AND org_id IS NOT NULL AND COALESCE(is_platform_admin, FALSE) = FALSE
      LOOP
        UPDATE users SET role = 'technician' WHERE id = r.id;
        RAISE NOTICE '[migration 014] DOWNGRADED farm-scoped admin % (%) → technician — MANUAL REVIEW REQUIRED', r.email, r.id;
      END LOOP;
    END $$;

    -- 3. Drop the superseded flag
    ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin;

    -- 4a. Role/org consistency constraint
    ALTER TABLE users ADD CONSTRAINT users_role_org_check CHECK (
      (role = 'admin' AND org_id IS NULL) OR
      (role IN ('technician','farmer') AND org_id IS NOT NULL)
    );

    -- 4b. Deactivatable accounts (history stays attributed)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

    -- e) Audit trail for cross-tenant admin actions
    CREATE TABLE IF NOT EXISTS admin_actions_log (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      admin_user_id UUID NOT NULL REFERENCES users(id),
      farm_id       UUID NOT NULL REFERENCES farms(id),
      action        TEXT NOT NULL,
      details       JSONB,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_admin_actions_log_farm_time
      ON admin_actions_log(farm_id, created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS admin_actions_log;
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_check;
    ALTER TABLE users DROP COLUMN IF EXISTS is_active;
    -- Re-create the flag; nothing sensible to restore for downgraded admins.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE users SET is_platform_admin = TRUE WHERE role = 'admin' AND org_id IS NULL;
    ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
  `);
};
