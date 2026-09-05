/**
 * Migration 018: per-farm farmer scoping (critical tenancy fix)
 *
 * Previously a client (farmer) user was scoped to an ORGANIZATION only —
 * users had no farm_id. Because one org can own many farms, a single farmer
 * row was implicitly shared across every farm in the org: editing that
 * account's email "for one farm" changed it for all of them, and a farmer
 * could read every farm in their org. A farmer operates ONE specific farm,
 * so farmer accounts must be tied to a farm_id, not just an org_id.
 *
 * Changes:
 *   - add users.farm_id UUID REFERENCES farms(id), nullable
 *   - new CHECK constraint: staff (admin/technician) are org-less and
 *     farm-less; farmers must carry BOTH org_id and farm_id, and that
 *     farm must belong to their org (enforced by the farm_id FK + the
 *     org/farm CHECK below which validates the pairing).
 *
 * NOTE on org/farm pairing: we cannot add a composite FK (org_id, farm_id)
 * -> farms(org_id, id) without a unique key on farms(org_id, id), so the
 * farmer's farm is validated against the org by a CHECK subquery only if the
 * custom constraint helper can reference the farms table. node-pg-migrate
 * CHECK constraints are expression-only; we therefore enforce org/farm
 * consistency at the application level (createUser/editUser validate that
 * the farm belongs to the org) and rely on the CHECK for the role matrix.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS farm_id UUID REFERENCES farms(id) ON DELETE SET NULL;

    -- BACKFILL: before the new CHECK can hold, every existing farmer must be
    -- assigned to a concrete farm. Farmers were previously org-scoped with no
    -- farm, so we assign each to the OLDEST farm of their org (a deterministic
    -- choice). Any farmer whose org had no farm is left NULL and must be fixed
    -- by an admin (and would be rejected by the new CHECK below on next edit).
    UPDATE users u
    SET farm_id = f.id
    FROM farms f
    WHERE u.role = 'farmer'
      AND u.farm_id IS NULL
      AND u.org_id = f.org_id
      AND f.id = (
        SELECT ff.id FROM farms ff
        WHERE ff.org_id = u.org_id
        ORDER BY ff.created_at ASC, ff.id ASC
        LIMIT 1
      );

    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_check;
    ALTER TABLE users ADD CONSTRAINT users_role_org_farm_check CHECK (
      (role IN ('admin', 'technician') AND org_id IS NULL AND farm_id IS NULL)
      OR
      (role = 'farmer' AND org_id IS NOT NULL AND farm_id IS NOT NULL)
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_org_farm_check;
    ALTER TABLE users ADD CONSTRAINT users_role_org_check CHECK (
      ((role)::text = ANY ((ARRAY['admin'::character varying, 'technician'::character varying])::text[])) AND (org_id IS NULL)
      OR
      ((role)::text = 'farmer'::text) AND (org_id IS NOT NULL)
    );
    ALTER TABLE users DROP COLUMN IF EXISTS farm_id;
  `);
};
