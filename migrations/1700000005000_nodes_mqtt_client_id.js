/**
 * Migration 005: nodes.mqtt_client_id
 *
 * Part 6's virtual ESP32 nodes (and later the real firmware) connect with a
 * stable client id derived from the node identity. Backfilled to the node
 * serial so existing seeded nodes keep their identity.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes ADD COLUMN IF NOT EXISTS mqtt_client_id VARCHAR(50);
    UPDATE nodes SET mqtt_client_id = id WHERE mqtt_client_id IS NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE nodes DROP COLUMN IF EXISTS mqtt_client_id;
  `);
};
