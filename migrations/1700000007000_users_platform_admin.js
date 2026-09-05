/**
 * Migration 007: platform-admin concept (Part 10 extension)
 *
 * A platform admin is an AgriGate staff identity, separate from the
 * client-side farmer/technician/admin role ladder:
 *  - is_platform_admin marks AgriGate staff who may view ANY client's data,
 *    but only by explicitly naming the client (org/farm) on every request.
 *  - users.org_id becomes NULLABLE: a platform admin belongs to no single
 *    organization.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ALTER COLUMN org_id DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Re-adding NOT NULL would fail while platform-admin rows exist; the
    -- down migration therefore removes them first.
    DELETE FROM users WHERE is_platform_admin = TRUE;
    ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin;
    ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
  `);
};
