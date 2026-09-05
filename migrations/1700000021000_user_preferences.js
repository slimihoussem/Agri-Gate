/**
 * Migration 021: per-user UI preferences
 *
 * Multi-language (en/fr/ar) + light/dark theme, persisted per user and
 * returned by GET /api/auth/me so the client applies them on login without
 * a flash of the wrong language/theme.
 *
 *   users.language  TEXT  'en'|'fr'|'ar'   default 'en'
 *   users.theme     TEXT  'dark'|'light'   default 'dark'
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
      CHECK (language IN ('en', 'fr', 'ar'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'dark'
      CHECK (theme IN ('dark', 'light'));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN IF EXISTS theme;
    ALTER TABLE users DROP COLUMN IF EXISTS language;
  `);
};