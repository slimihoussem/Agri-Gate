/**
 * Shared diurnal sensor model — Sidi Bouzid climate curves.
 *
 * SINGLE SOURCE OF TRUTH for the solar/evapotranspiration-driven daily
 * cycles used by BOTH:
 *   - scripts/seed.ts        (historical backfill)
 *   - src/simulator/*        (live virtual ESP32 nodes, Part 6)
 *
 * All values are functions of wall-clock hour-of-day (0–24):
 *   - air temperature peaks ~14:00 (~34°C), trough ~05:00 (~21°C)
 *   - soil temperature is damped/lagged by thermal inertia, peaks ~17:00
 *   - air humidity is inverse to air temp (dry midday afternoons)
 */

export const DIURNAL = {
  airTempBase: 27.5,
  airTempAmplitude: 6.5,
  airTempPhaseHour: 8,

  soilTempBase: 24.8,
  soilTempAmplitude: 2.2,
  soilTempPhaseHour: 11,

  humidityBase: 44,
  humidityAmplitude: -14, // negative: humidity is INVERSE to the same solar wave
  humidityPhaseHour: 8,
} as const;

/** Morning irrigation window (05:30–07:30) and the moisture boost it injects. */
export const MORNING_IRRIGATION = {
  startHour: 5.5,
  endHour: 7.5,
  boost: 7.0,
} as const;

export interface Microclimate {
  airTemp: number;
  soilTemp: number;
  /** Relative humidity %. */
  humidity: number;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

function wave(hourOfDay: number, base: number, amplitude: number, phaseHour: number): number {
  return base + amplitude * Math.sin(((hourOfDay - phaseHour) / 24) * 2 * Math.PI);
}

/**
 * Deterministic microclimate for a given hour — set jitter=false for smooth
 * graphing; default adds realistic sensor noise matching seed magnitudes.
 */
export function microclimate(hourOfDay: number, jitter = true): Microclimate {
  return {
    airTemp: clamp(
      round2(
        wave(hourOfDay, DIURNAL.airTempBase, DIURNAL.airTempAmplitude, DIURNAL.airTempPhaseHour) +
          (jitter ? Math.random() * 0.4 - 0.2 : 0)
      ),
      -10,
      55
    ),
    soilTemp: clamp(
      round2(
        wave(hourOfDay, DIURNAL.soilTempBase, DIURNAL.soilTempAmplitude, DIURNAL.soilTempPhaseHour) +
          (jitter ? Math.random() * 0.2 - 0.1 : 0)
      ),
      -10,
      55
    ),
    humidity: clamp(
      round2(
        wave(hourOfDay, DIURNAL.humidityBase, DIURNAL.humidityAmplitude, DIURNAL.humidityPhaseHour) +
          (jitter ? Math.random() * 1.5 - 0.75 : 0)
      ),
      0,
      100
    ),
  };
}

export function hourOfDayOf(at: Date): number {
  return at.getHours() + at.getMinutes() / 60 + at.getSeconds() / 3600;
}

export function microclimateAt(at: Date, jitter = true): Microclimate {
  return microclimate(hourOfDayOf(at), jitter);
}

export function isInMorningIrrigationWindow(hourOfDay: number): boolean {
  return hourOfDay >= MORNING_IRRIGATION.startHour && hourOfDay <= MORNING_IRRIGATION.endHour;
}

/**
 * One random-walk step of soil moisture around a node's baseline.
 * Drains slowly during the day; the morning irrigation window lifts it.
 */
export function nextSoilMoisture(previous: number, hourOfDay: number): number {
  let next = previous - 0.15 + (Math.random() * 0.6 - 0.3);
  if (isInMorningIrrigationWindow(hourOfDay)) {
    next += MORNING_IRRIGATION.boost * 0.25; // spread over several cycles
  }
  return round2(clamp(next, 10, 85));
}
