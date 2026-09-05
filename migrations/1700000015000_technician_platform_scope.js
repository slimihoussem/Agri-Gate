/**
 * Migration 015: technician becomes platform-scoped (Part 14 amendment)
 *
 * Both 'admin' and 'technician' are now staff roles with org_id = NULL.
 * Only 'farmer' remains tied to a single organization.
 *
 *  1. Backfill: clear org_id for existing technicians (NOTICE per user —
 *     this is a real structural change worth a human glance).
 *  2. Replace the role/org CHECK constraint.
 *  3. Rename admin_actions_log → staff_actions_log and add a role column
 *     so both staff roles are captured in the audit trail.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Backfill: clear org_id for technicians
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT id, email, org_id FROM users
        WHERE role = 'technician' AND org_id IS NOT NULL
      LOOP
        UPDATE users SET org_id = NULL WHERE id = r.id;
        RAISE NOTICE '[migration 015] TECHNICIAN % (%) cleared from org % — now platform-scoped', r.email, r.id, r.org_id;
      END LOOP;
    END $$;

    -- 2. Replace the role/org consistency constraint
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_check;
    ALTER TABLE users ADD CONSTRAINT users_role_org_check CHECK (
      (role IN ('admin','technician') AND org_id IS NULL) OR
      (role = 'farmer' AND org_id IS NOT NULL)
    );

    -- 3. Audit table: rename + add role column for both staff roles
    ALTER TABLE admin_actions_log RENAME TO staff_actions_log;
    ALTER TABLE staff_actions_log RENAME COLUMN admin_user_id TO staff_user_id;
    ALTER TABLE staff_actions_log ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'admin';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Restore farm-scoped technicians to the pilot org before re-tightening.
    UPDATE users SET org_id = (SELECT id FROM organizations ORDER BY created_at LIMIT 1)
    WHERE role = 'technician' AND org_id IS NULL;

    ALTER TABLE staff_actions_log DROP COLUMN IF EXISTS role;
    ALTER TABLE staff_actions_log RENAME COLUMN staff_user_id TO admin_user_id;
    ALTER TABLE staff_actions_log RENAME TO admin_actions_log;

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_check;
    ALTER TABLE users ADD CONSTRAINT users_role_org_check CHECK (
      (role = 'admin' AND org_id IS NULL) OR
      (role IN ('technician','farmer') AND org_id IS NOT NULL)
    );
  `);
};
