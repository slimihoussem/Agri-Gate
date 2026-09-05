/**
 * Migration 017: one-time dated irrigation schedules
 *
 * irrigation_schedules gains a schedule_type discriminator:
 *   - 'recurring' (default): existing weekly model — start_time + repeat_days.
 *   - 'one_time': a single dated run window (scheduled_start → scheduled_end).
 *     Duration = end − start at firing time; fired_at stamps the run once so
 *     it never fires again (a skipped one-time schedule is NOT retried).
 *
 * start_time/repeat_days become nullable because a one_time row has neither.
 * moisture_threshold becomes nullable so one_time rows can opt out of the
 * soil-moisture gate (NULL = always fire, subject to actuator-conflict check).
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE irrigation_schedules
      ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) NOT NULL DEFAULT 'recurring'
        CHECK (schedule_type IN ('recurring', 'one_time')),
      ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS fired_at TIMESTAMPTZ;

    ALTER TABLE irrigation_schedules ALTER COLUMN start_time DROP NOT NULL;
    ALTER TABLE irrigation_schedules ALTER COLUMN repeat_days DROP NOT NULL;
    ALTER TABLE irrigation_schedules ALTER COLUMN moisture_threshold DROP NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_irrigation_schedules_one_time_due
      ON irrigation_schedules(schedule_type, scheduled_start)
      WHERE fired_at IS NULL AND active = TRUE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_irrigation_schedules_one_time_due;

    UPDATE irrigation_schedules
    SET start_time = '00:00:00',
        repeat_days = '{0,1,2,3,4,5,6}',
        moisture_threshold = 50
    WHERE schedule_type = 'one_time';

    ALTER TABLE irrigation_schedules ALTER COLUMN start_time SET NOT NULL;
    ALTER TABLE irrigation_schedules ALTER COLUMN repeat_days SET NOT NULL;
    ALTER TABLE irrigation_schedules ALTER COLUMN moisture_threshold SET NOT NULL;

    ALTER TABLE irrigation_schedules DROP COLUMN IF EXISTS fired_at;
    ALTER TABLE irrigation_schedules DROP COLUMN IF EXISTS scheduled_end;
    ALTER TABLE irrigation_schedules DROP COLUMN IF EXISTS scheduled_start;
    ALTER TABLE irrigation_schedules DROP COLUMN IF EXISTS schedule_type;
  `);
};