export type NodeStatus = "online" | "warning" | "offline";
export type AlertSeverity = "info" | "warning" | "critical";
export type CommMethod = "wifi";
/** "disconnected" is computed server-side (Part 3) — a dead sensor is NOT dry soil. */
export type ZoneStatus = "ok" | "warning" | "critical" | "disconnected";

export interface Zone {
  id: string;
  /** Mock fallback data carries a client-side farm id; API zones nest under /farms/:id. */
  farmId?: string;
  name: string;
  cropType: string;
  moisture: number | null; // null if no active nodes / disconnected
  targetMoisture: number;
  nitrogen: number | null; // ppm (optimal 150-300)
  phosphorus: number | null; // ppm (optimal 30-80)
  potassium: number | null; // ppm (optimal 100-250)
  /** Raw ISO from the API; mock fallback may carry a display string. */
  lastWatered: string | null;
  status: ZoneStatus;
  activeNodeCount: number;
  /** GPS map page: per-zone boundary within the farm (null if never drawn). */
  boundaryGps?: unknown;
  /** Part 13 ext: lifecycle flag + per-zone schedule count. */
  active?: boolean;
  activeScheduleCount?: number;
  /** Total nodes assigned to the zone (real API); mock may omit. */
  nodeCount?: number;
  /** Active actuator (valve) nodes in the zone — zone with nodes but zero active valves lacks water control. */
  activeActuatorCount?: number;
  /** Part 19: whether this zone has a dedicated main-valve (zone valve) node configured. */
  hasZoneValve?: boolean;
  /** Part 19: whether this zone's main valve is CURRENTLY open (open run). */
  zoneValveRunning?: boolean;
  /** Stored area in hectares, computed/backfilled server-side (shown on Farm Map). */
  areaHectares?: number;
  soilType?: string;
}

export interface SensorNode {
  id: string;
  farmId?: string;
  zoneId?: string | null;
  zoneName?: string | null;
  name: string;
  battery: number | null; // 0-100%
  rssi: number | null; // dBm e.g. -65
  lastSeen: string | null;
  commMethod: CommMethod;
  status: NodeStatus;
  /** Part 11: per-node telemetry cadence override (ms); null = farm default. */
  readIntervalMs?: number | null;
  mqttClientId?: string | null;
  /** Part 9 ext: designated valve driver for its zone. */
  isActuator?: boolean;
  /** Part 19: dedicated main-valve node for its zone — one per zone, no sensors. */
  isZoneValve?: boolean;
  /** Part 14: archival flag — archived nodes hidden from default views. */
  active?: boolean;
  /** Part 13 ext: extended configuration. */
  lat?: number | null;
  lon?: number | null;
  sensorCapabilities?: string[];
  flowRateLPerMin?: number | null;
  maxRuntimeMinutes?: number | null;
  installedAt?: string | null;
  notes?: string | null;
  x: number | null; // 0-100 position % for map placement
  y: number | null; // 0-100 position % for map placement
  moisture?: number | null;
  soilTemp?: number; // °C
  ambientTemp?: number; // °C
  humidity?: number; // %
}

export interface Alert {
  id: string;
  nodeId?: string | null;
  zoneName?: string | null;
  type?: string;
  severity: AlertSeverity;
  message: string;
  value?: string | number | null;
  triggeredAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
}

export interface IrrigationSchedule {
  id: string;
  zoneId: string;
  zoneName: string;
  /** Part 9 ext: the specific actuator node this schedule drives. */
  nodeId?: string | null;
  nodeName?: string | null;
  /** Part 017: "recurring" (weekly) or "one_time" (dated single run). */
  scheduleType: "recurring" | "one_time";
  startTime: string | null;
  durationMinutes: number;
  repeatDays: number[]; // 0=Sun..6=Sat; empty for one_time
  moistureThreshold: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** Part 017: stamped once a one_time run is processed (fire or skip). */
  firedAt: string | null;
  active: boolean;
}

export interface IrrigationLog {
  id: string;
  zoneId?: string;
  zoneName: string;
  /** Part 9 ext: which node executed the run. */
  nodeId?: string | null;
  startedAt: string;
  endedAt: string | null;
  skipped: boolean;
  skipReason?: string | null;
  /** Part 13 ext: null = unmetered actuator (no flow rate configured). */
  waterUsedL: number | null;
  triggeredBy?: string;
}

// ── Part 11: configurable settings ──────────────────────────────────────────

export interface FarmSettings {
  moistureLow: number;
  moistureHigh: number;
  batteryLow: number;
  batteryCritical: number;
  nitrogenLow: number;
  phosphorusLow: number;
  potassiumLow: number;
  soilTempLowExtreme: number;
  soilTempHighExtreme: number;
  offlineMinutes: number;
  /** Max minutes an open run may run before a long-running warning fires (NEVER auto-closes). */
  irrigationMaxRunningMinutes: number;
}

export type FarmSettingsPatch = Partial<FarmSettings>;

/** Part 9 ext: live valve state for one node. */
export interface NodeIrrigationStatus {
  isRunning: boolean;
  currentLog: IrrigationLog | null;
}

export interface FarmUser {
  id: string;
  email: string;
  fullName: string;
  role: "farmer" | "technician" | "admin";
}

export interface OrganizationWithFarms {
  id: string;
  name: string;
  farms: Farm[];
}

/** Part 9: manual start response — distinguishes "logged" from "valve actually commanded". */
export interface StartIrrigationResult extends IrrigationLog {
  commandDelivered: boolean;
  failureReason?: string;
}

/** Legacy fixed-key trend shape — retained for the mock fallback chart. */
export interface MoisturePoint {
  time: string;
  zoneA: number | null;
  zoneB: number | null;
  zoneC: number | null;
}

// ── API-only shapes (Part 3 responses) ──────────────────────────────────────

export interface Farm {
  id: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
}

export interface DashboardStats {
  avgMoisture: number | null;
  activeNodes: number;
  totalNodes: number;
  waterUsedTodayL: number;
  openAlerts: number;
}

export interface DashboardData {
  farm: Farm;
  stats: DashboardStats;
  zones: Zone[];
}

/** Generic per-zone trend — never keyed by hardcoded zone aliases. */
export interface TrendPoint {
  time: string;
  avgMoisture: number;
}

export interface ZoneTrendSeries {
  zoneId: string;
  zoneName: string;
  points: TrendPoint[];
}

export interface CreateNodeInput {
  farmId: string;
  name: string;
  zoneId?: string | null;
  commMethod?: CommMethod;
  /** Part 13 ext: extended configuration. */
  lat?: number;
  lon?: number;
  sensorCapabilities?: string[];
  mqttClientId?: string;
  flowRateLPerMin?: number;
  maxRuntimeMinutes?: number;
  installedAt?: string;
  notes?: string;
  isActuator?: boolean;
  /** Part 19: mark this node as the zone's dedicated main valve (one per zone). */
  isZoneValve?: boolean;
}
