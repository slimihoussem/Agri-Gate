import {
  Alert,
  CreateNodeInput,
  DashboardData,
  Farm,
  FarmSettings,
  FarmSettingsPatch,
  FarmUser,
  IrrigationLog,
  NodeIrrigationStatus,
  OrganizationWithFarms,
  StartIrrigationResult,
  IrrigationSchedule,
  SensorNode,
  Zone,
  ZoneTrendSeries,
} from "./types";
import { API_BASE_URL } from "./constants";

/**
 * Typed fetch layer over the Part 3 REST API — one function per endpoint.
 * Throws ApiError (API responded with non-2xx) vs TypeError (network
 * failure), so calling code can distinguish the two.
 *
 * Part 10: every request sends credentials so the httpOnly session cookie
 * flows to the API; a 401 anywhere (except /auth itself) bounces the
 * browser to /login.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: { path: string; message: string }[],
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The backend rejected a stop because this valve is protected by a safety
 * rule:
 *   - reason "last_running_valve_in_zone"     → last running FIELD-NODE valve
 *     in the zone ("This is the only valve currently running in {Zone}.")
 *   - reason "last_open_zone_valve_in_farm"   → last open ZONE VALVE on the
 *     whole farm (Part 19 farm-level rule).
 * Transported via ApiError(409, data.blocked).
 */
export class LastRunningValveBlockedError extends Error {
  constructor(
    public readonly zoneName: string,
    public readonly reason: string = "last_running_valve_in_zone"
  ) {
    super(
      reason === "last_open_zone_valve_in_farm"
        ? "This is the only zone valve currently open on the farm."
        : `This is the only valve currently running in ${zoneName}.`
    );
    this.name = "LastRunningValveBlockedError";
  }

  /** True when the farm-level (Part 19) zone-valve rule fired, not the per-zone field-node rule. */
  get isFarmLevelRule(): boolean {
    return this.reason === "last_open_zone_valve_in_farm";
  }
}

/** Clear any cached farm context (sessionStorage) on session expiry. */
function clearFarmContext(): void {
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem("agrigate_farm_context");
      sessionStorage.removeItem("agrigate_farm_history");
    } catch {
      /* storage unavailable */
    }
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined> }
): Promise<T> {
  const { query, ...fetchInit } = init ?? {};
  const url = new URL(`/api${path}`, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      cache: "no-store",
      credentials: "include", // httpOnly session cookie (Part 10)
      headers:
        fetchInit.body !== undefined
          ? { "Content-Type": "application/json", ...fetchInit.headers }
          : fetchInit.headers,
      ...fetchInit,
    });
  } catch (err) {
    // Network-level failure (server down, DNS, CORS blackout…)
    throw new ApiError(0, `Network error contacting AgriGate API: ${(err as Error).message}`);
  }

  if (!response.ok) {
    // Session expired mid-use → back to login (auth endpoints excluded to
    // avoid a redirect loop while the login form itself is reporting 401s).
    if (response.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
      clearFarmContext();
      window.location.assign("/login");
    }
    let message = `API error ${response.status}`;
    let details: { path: string; message: string }[] | undefined;
    let data: unknown;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
      if (Array.isArray(body?.details)) details = body.details;
      data = body;
    } catch {
      /* non-JSON error body — keep default message */
    }
    throw new ApiError(response.status, message, details, data);
  }

  return (await response.json()) as T;
}

// ── auth (Part 10) ──────────────────────────────────────────────────────────

export type Language = "en" | "fr" | "ar";
export type Theme = "dark" | "light";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: "farmer" | "technician" | "admin";
  /** NULL for platform admins — AgriGate staff, no single org. */
  orgId: string | null;
  /** A farmer's OWN farm; NULL for staff (technician/admin). */
  farmId: string | null;
  /** Saved UI language — applied on login. */
  language: Language;
  /** Saved UI theme — applied on login. */
  theme: Theme;
  isAdminRole: boolean;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return result.user;
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

/** Current session user, or null when not logged in. Never redirects on 401. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const result = await request<{ user: AuthUser }>("/auth/me");
    return result.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Persists the caller's own language/theme preference (any role). */
export async function updatePreferences(patch: {
  language?: Language;
  theme?: Theme;
}): Promise<AuthUser> {
  const result = await request<{ user: AuthUser }>("/auth/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return result.user;
}

/** UI convenience only — the API enforces RBAC for real (Part 10). */
export function canManageInfrastructure(
  user: AuthUser | null | undefined
): boolean {
  return user?.role === "technician" || user?.role === "admin";
}

/**
 * UI convenience only — mirrors the backend PERMISSIONS map (src/auth/permissions.ts).
 * 'irrigation.manage' is granted to farmer, technician AND admin (admin via '*'),
 * so any authenticated role may open/close a valve and manage that node's schedules.
 * Distinct from canManageInfrastructure (node/zone *editing*, which farmer lacks).
 */
export function canOperateIrrigation(
  user: AuthUser | null | undefined
): boolean {
  if (!user) return false;
  // admin implicitly holds '*' (every capability); technician & farmer both list "irrigation.manage".
  return user.role === "admin" || user.role === "technician" || user.role === "farmer";
}

/**
 * UI convenience only — mirrors the backend PERMISSIONS map: technician +
 * admin hold "zones.edit" / "nodes.edit" (farmer does NOT). These gate the
 * GPS map's Draw-Boundary / Draw-Zone / Reposition-Node tools.
 */
export function canEditSpatial(user: AuthUser | null | undefined): boolean {
  return user?.role === "technician" || user?.role === "admin";
}

// ── Part 11: settings, node config, user & org administration ───────────────

export async function getFarmSettings(farmId: string): Promise<FarmSettings> {
  return request<FarmSettings>(`/farms/${farmId}/settings`);
}

export async function updateFarmSettings(
  farmId: string,
  patch: FarmSettingsPatch
): Promise<FarmSettings> {
  return request<FarmSettings>(`/farms/${farmId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface UpdateNodeConfigResult extends SensorNode {
  configDelivered: boolean;
  configTopic: string;
  failureReason?: string;
}

/** PATCH /api/nodes/:nodeId — retained MQTT config push (Part 11). */
export async function updateNodeReadInterval(
  nodeId: string,
  readIntervalMs: number | null
): Promise<UpdateNodeConfigResult> {
  return request<UpdateNodeConfigResult>(`/nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify({ read_interval_ms: readIntervalMs }),
  });
}

export async function getFarmUsers(farmId: string): Promise<FarmUser[]> {
  return request<FarmUser[]>(`/farms/${farmId}/users`);
}

/** Part 12 UI: one node's irrigation runs. */
export async function getNodeIrrigationLogs(nodeId: string): Promise<IrrigationLog[]> {
  return request<IrrigationLog[]>(`/nodes/${nodeId}/irrigation/logs`);
}

export async function inviteFarmUser(
  farmId: string,
  input: { email: string; password: string; fullName: string; role: "farmer" | "technician" }
): Promise<FarmUser> {
  return request<FarmUser>(`/farms/${farmId}/users`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeFarmUser(farmId: string, userId: string): Promise<void> {
  await request<{ ok: boolean }>(`/farms/${farmId}/users/${userId}`, { method: "DELETE" });
}

export async function updateFarm(farmId: string, patch: { name?: string; location?: string }): Promise<Farm> {
  return request<Farm>(`/farms/${farmId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ── GPS map VECTOR layer (farm boundary + center) ───────────────────────────

/** Minimal GeoJSON Polygon — [lon, lat] coordinate pairs. */
export interface GeojsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface FarmSpatial {
  farmId: string;
  name: string;
  boundaryGeojson: GeojsonPolygon | null;
  centerLat: number | null;
  centerLon: number | null;
  latitude: number | null;
  longitude: number | null;
  totalAreaHa: number | null;
}

/** GET farm boundary + center for the GPS map (any authenticated role). */
export async function getFarmSpatial(farmId: string): Promise<FarmSpatial> {
  return request<FarmSpatial>(`/farms/${farmId}/spatial`);
}

/** PATCH a freshly drawn farm boundary (technician+/admin). */
export async function updateFarmBoundary(
  farmId: string,
  patch: {
    boundaryGeojson?: GeojsonPolygon;
    centerLat?: number | null;
    centerLon?: number | null;
    /** Client-computed area (ha) from the drawn polygon — turf.area / 10000. */
    totalAreaHa?: number | null;
  }
): Promise<FarmSpatial> {
  return request<FarmSpatial>(`/farms/${farmId}/boundary`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  label: string | null;
}

/**
 * Geocode a free-text city query via the backend proxy (Nominatim requires a
 * server-side User-Agent, which browsers cannot set). Returns null when the
 * upstream finds no match.
 */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  try {
    return await request<GeocodeResult>("/geocode", { query: { q: query } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// Platform-admin only (Part 11 stub surface for the Part 12 console):
export async function listOrganizations(): Promise<OrganizationWithFarms[]> {
  return request<OrganizationWithFarms[]>("/orgs");
}

// ── Part 9 ext: per-node irrigation control ─────────────────────────────────

export async function getZoneNodes(
  zoneId: string,
  opts?: { includeInactive?: boolean }
): Promise<SensorNode[]> {
  return request<SensorNode[]>(`/zones/${zoneId}/nodes`, {
    query: { includeInactive: opts?.includeInactive ? "true" : undefined },
  });
}

export async function getNodeSchedules(nodeId: string): Promise<IrrigationSchedule[]> {
  return request<IrrigationSchedule[]>(`/nodes/${nodeId}/irrigation/schedules`);
}

export type CreateScheduleInput =
  | {
      scheduleType: "recurring";
      startTime: string;
      durationMinutes: number;
      repeatDays: number[];
      moistureThreshold: number;
      active?: boolean;
    }
  | {
      scheduleType: "one_time";
      scheduledStart: string;
      scheduledEnd: string;
      moistureThreshold?: number;
      active?: boolean;
    };

export async function createNodeSchedule(
  nodeId: string,
  input: CreateScheduleInput
): Promise<IrrigationSchedule> {
  return request<IrrigationSchedule>(`/nodes/${nodeId}/irrigation/schedules`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteNodeSchedule(nodeId: string, scheduleId: string): Promise<void> {
  await request<{ ok: boolean }>(`/irrigation/schedules/${scheduleId}`, { method: "DELETE" });
}

export async function getNodeIrrigationStatus(nodeId: string): Promise<NodeIrrigationStatus> {
  return request<NodeIrrigationStatus>(`/nodes/${nodeId}/irrigation/status`);
}

/**
 * Diagnostic ping (Part 15) — POST /api/nodes/:nodeId/ping.
 * Publishes a `{action:"ping"}` command to the node's MQTT command topic.
 * `delivered` reflects whether the broker accepted the message (QoS 1); an
 * online node subscribed to commands replies with a pong on its status topic.
 */
export async function sendNodePing(
  nodeId: string
): Promise<{ delivered: boolean; topic?: string; logId: string; failureReason?: string; note?: string }> {
  return request(`/nodes/${nodeId}/ping`, { method: "POST" });
}

/**
 * Open-ended manual OPEN: no duration is requested or sent. The valve stays
 * open until the operator issues a Close — nothing auto-closes it.
 */
export async function startNodeIrrigation(
  nodeId: string
): Promise<{ log: IrrigationLog; delivered: boolean; failureReason?: string }> {
  return request(`/nodes/${nodeId}/irrigation/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

/**
 * Manual CLOSE. A normal stop sends an empty `{}` body. The backend blocks
 * closing the last running valve in a zone with `{ blocked: true, reason:
 * "last_running_valve_in_zone", zoneName }` (HTTP 409); that is surfaced as a
 * LastRunningValveBlockedError. `{ force: true }` is only honored for
 * technicians/admins and is audited backend-side.
 */
export async function stopNodeIrrigation(
  nodeId: string,
  opts?: { force?: boolean }
): Promise<{ log: IrrigationLog; delivered: boolean; failureReason?: string }> {
  try {
    return await request(`/nodes/${nodeId}/irrigation/stop`, {
      method: "POST",
      body: JSON.stringify(opts?.force === true ? { force: true } : {}),
    });
  } catch (err) {
    if (
      err instanceof ApiError &&
      err.status === 409 &&
      err.data &&
      typeof err.data === "object" &&
      (err.data as { blocked?: boolean }).blocked === true
    ) {
      const body = err.data as { reason?: string; zoneName?: string };
      throw new LastRunningValveBlockedError(
        body.zoneName ?? "this zone",
        body.reason
      );
    }
    throw err;
  }
}

// ── Part 13: per-node threshold overrides ───────────────────────────────────

export interface EffectiveThresholds {
  values: Record<string, number>;
  sources: Record<string, "default" | "farm" | "node">;
}

export async function getNodeSettings(nodeId: string): Promise<EffectiveThresholds> {
  return request<EffectiveThresholds>(`/nodes/${nodeId}/settings`);
}

/** PATCH one or more node-level overrides (technician+). */
export async function updateNodeSetting(
  nodeId: string,
  key: string,
  value: number
): Promise<EffectiveThresholds> {
  return request<EffectiveThresholds>(`/nodes/${nodeId}/settings`, {
    method: "PATCH",
    body: JSON.stringify({ [key]: value }),
  });
}

/** DELETE one override — key reverts to farm setting (or platform default). */
export async function resetNodeSetting(nodeId: string, key: string): Promise<EffectiveThresholds> {
  return request<EffectiveThresholds>(`/nodes/${nodeId}/settings/${key}`, { method: "DELETE" });
}

// ── Part 12: platform-admin console ─────────────────────────────────────────

export interface PlatformOverview {
  totalOrgs: number;
  totalFarms: number;
  totalNodes: number;
  totalActiveNodes: number;
  totalOpenCriticalAlerts: number;
  totalOpenAlerts: number;
}

export interface OrgFarmStats {
  farmId: string;
  farmName: string;
  nodeCount: number;
  activeNodeCount: number;
  openAlertCount: number;
}

export interface AdminOrg {
  orgId: string;
  orgName: string;
  farms: OrgFarmStats[];
}

export async function getAdminOverview(): Promise<PlatformOverview> {
  return request<PlatformOverview>("/admin/overview");
}

export async function getAdminOrgs(): Promise<AdminOrg[]> {
  return request<AdminOrg[]>("/admin/orgs");
}

export interface AdminFarmUser {
  id: string;
  email: string;
  fullName: string;
  role: "farmer" | "technician";
  isActive: boolean;
}

/** Users of one farm's organization (Manage Users panel). */
export async function getAdminFarmUsers(
  farmId: string
): Promise<{ farmId: string; orgId: string; orgName: string; users: AdminFarmUser[] }> {
  return request(`/admin/farms/${farmId}/users`);
}

/** Part 14: creates a farmer/technician on an existing client farm. */
export async function adminCreateUser(input: {
  role: "farmer" | "technician";
  orgId: string;
  farmId: string;
  fullName: string;
  email: string;
  temporaryPassword: string;
}): Promise<{ id: string; email: string; temporaryPassword: string }> {
  return request("/admin/users", { method: "POST", body: JSON.stringify(input) });
}

/** Part 14 ext: edit user name/email/active (technician+ admin gate). */
export async function adminUpdateUser(
  userId: string,
  patch: { fullName?: string; email?: string; active?: boolean }
): Promise<{ id: string; email: string; fullName: string; role: string; isActive: boolean }> {
  return request(`/admin/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...(patch.fullName !== undefined ? { name: patch.fullName } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
    }),
  });
}

/** Part 14 ext: history-aware removal — archived if has references. */
export async function adminDeactivateUser(
  userId: string
): Promise<{
  deleted: boolean;
  mode: "hard" | "archived";
  reason?: string;
  referenceCount?: number;
}> {
  return request(`/admin/users/${userId}`, { method: "DELETE" });
}

/** Client onboarding (Part 12) — org + first farm in one transaction. */
/**
 * ONBOARD BRAND-NEW CLIENT — creates an org AND its first farm together.
 * POST /api/orgs. Only correct for forms labeled "Onboard Client", never for
 * "add a farm to THIS existing org" controls.
 */
export async function createNewOrgWithFarm(input: {
  orgName: string;
  country?: string;
  region?: string;
  firstFarmName: string;
  farmLat?: number;
  farmLon?: number;
}): Promise<{ organization: { id: string; name: string }; farm: Farm }> {
  return request("/orgs", { method: "POST", body: JSON.stringify(input) });
}

/**
 * ADD A FARM TO AN EXISTING ORG — POST /api/admin/orgs/:orgId/farms.
 * The :orgId comes from the specific org row the button lives on. Miswiring
 * this (e.g. calling createNewOrgWithFarm) silently creates a new org, so the
 * backend 404s on a missing orgId and the function name is deliberate.
 */
export async function addFarmToExistingOrg(input: {
  orgId: string;
  farmName: string;
  location?: string;
  farmLat?: number;
  farmLon?: number;
}): Promise<{ organization: { id: string; name: string }; farm: Farm }> {
  if (!input.orgId || input.orgId.trim() === "") {
    throw new ApiError(400, "Missing orgId — cannot add farm to an existing org");
  }
  return request(`/admin/orgs/${input.orgId}/farms`, {
    method: "POST",
    body: JSON.stringify({
      farmName: input.farmName,
      location: input.location,
      farmLat: input.farmLat,
      farmLon: input.farmLon,
    }),
  });
}

/** Part 12 ext: edit a farm's name/org/coordinates via the admin console. */
export async function adminUpdateFarm(
  farmId: string,
  patch: {
    name?: string;
    orgId?: string;
    centerLat?: number | null;
    centerLon?: number | null;
    totalAreaHa?: number | null;
    active?: boolean;
  }
): Promise<{ reassigned: boolean; oldOrgId: string | null; newOrgId: string | null }> {
  return request(`/admin/farms/${farmId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Part 12 ext: archive-or-hard-delete a farm (lifecycle-aware on the server). */
export async function adminDeleteFarm(
  farmId: string
): Promise<{
  deleted: boolean;
  mode: "hard" | "archived";
  zoneCount?: number;
  nodeCount?: number;
  userCount?: number;
}> {
  return request(`/admin/farms/${farmId}`, { method: "DELETE" });
}

/** Part 12 ext: delete an organization ONLY when it has no farms or users. */
export async function adminDeleteOrg(
  orgId: string
): Promise<{ deleted: true; farmCount: number; userCount: number }> {
  return request(`/admin/orgs/${orgId}`, { method: "DELETE" });
}

// ── farms ───────────────────────────────────────────────────────────────────

export interface ZoneInfo {
  id: string;
  name: string;
  cropType: string;
  targetMoisture: number;
  farmId: string;
  activeScheduleCount: number;
  nodeCount: number;
}

export async function getZone(zoneId: string): Promise<ZoneInfo> {
  return request<ZoneInfo>(`/zones/${zoneId}`);
}

export interface NodeTelemetryPoint {
  time: string;
  soilMoisture: number | null;
  soilTemp: number | null;
  airTemp: number | null;
  airHumidity: number | null;
  nitrogen: number | null;
  phosphorus: number | null;
  potassium: number | null;
  battery: number | null;
  rssi: number | null;
}

export async function getNodeTelemetry(
  nodeId: string,
  hours = 24
): Promise<{ points: NodeTelemetryPoint[] }> {
  return request<{ points: NodeTelemetryPoint[] }>(`/nodes/${nodeId}/telemetry`, {
    query: { hours },
  });
}

// ── Part 14 amendment: staff farms listing (admin + technician) ────────────

export interface StaffFarm {
  farmId: string;
  farmName: string;
  orgName: string;
  nodeCount: number;
  activeNodeCount: number;
  offlineNodeCount: number;
  openAlertCount: number;
}

export async function getStaffFarms(): Promise<StaffFarm[]> {
  return request<StaffFarm[]>("/staff/farms");
}

// ── farms ───────────────────────────────────────────────────────────────────

export function getFarms(): Promise<Farm[]> {
  return request<Farm[]>("/farms");
}

export function getDashboard(farmId: string): Promise<DashboardData> {
  return request<DashboardData>(`/farms/${farmId}/dashboard`);
}

export function getZones(
  farmId: string,
  opts?: { includeInactive?: boolean }
): Promise<Zone[]> {
  return request<Zone[]>(`/farms/${farmId}/zones`, {
    query: { includeInactive: opts?.includeInactive ? "true" : undefined },
  });
}

/** Part 13 ext: zone management (farm-admin create, technician+ edit). */
export async function createZone(
  farmId: string,
  input: {
    name: string;
    cropType: string;
    targetMoisture: number;
    soilType?: string;
    areaHectares?: number;
    boundaryGps?: Record<string, unknown>;
  }
): Promise<Zone> {
  return request<Zone>(`/farms/${farmId}/zones`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateZone(
  zoneId: string,
  patch: {
    name?: string;
    cropType?: string;
    targetMoisture?: number;
    soilType?: string;
    areaHectares?: number;
    boundaryGps?: Record<string, unknown>;
    active?: boolean;
  }
): Promise<Zone> {
  return request<Zone>(`/zones/${zoneId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteZone(
  zoneId: string
): Promise<{ deleted: true; mode: "hard" | "archived" }> {
  return request<{ deleted: true; mode: "hard" | "archived" }>(`/zones/${zoneId}`, {
    method: "DELETE",
  });
}

export function getNodes(
  farmId: string,
  opts?: { includeInactive?: boolean }
): Promise<SensorNode[]> {
  return request<SensorNode[]>(`/farms/${farmId}/nodes`, {
    query: { includeInactive: opts?.includeInactive ? "true" : undefined },
  });
}

/** Part 14: full-field node edit (technician+). */
export async function updateNode(
  nodeId: string,
  patch: Partial<{
    name: string;
    zoneId: string | null;
    commMethod: string;
    mqttClientId: string;
    read_interval_ms: number | null;
    isActuator: boolean;
    /**
     * DEPRECATED — superseded by real GPS (lat/lon). map_x/map_y were the old
     * 0-100 percentage "placeholder" position on the retired static SVG map.
     * The database columns are kept for now but nothing frontend writes to or
     * reads from them; positioning is entirely driven by lat/lon.
     */
    mapX: number;
    mapY: number;
    lat: number;
    lon: number;
    sensorCapabilities: string[];
    flowRateLPerMin: number;
    maxRuntimeMinutes: number;
    installedAt: string;
    notes: string;
    active: boolean;
  }>
): Promise<SensorNode> {
  return request<SensorNode>(`/nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Part 14: history-aware removal (hard delete vs archived). */
export async function deleteNode(
  nodeId: string
): Promise<{ deleted: true; mode: "hard" | "archived"; telemetryCount?: number; logsCount?: number }> {
  return request(`/nodes/${nodeId}`, { method: "DELETE" });
}

/** Part 14: un-archive an archived node (technician+). */
export async function reactivateNode(nodeId: string): Promise<SensorNode> {
  return request<SensorNode>(`/nodes/${nodeId}/reactivate`, { method: "POST" });
}

export function getNode(nodeId: string): Promise<SensorNode> {
  return request<SensorNode>(`/nodes/${nodeId}`);
}

export function createNode(input: CreateNodeInput): Promise<SensorNode> {
  return request<SensorNode>("/nodes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getTelemetryTrend(farmId: string, hours = 24): Promise<{ zones: ZoneTrendSeries[] }> {
  return request<{ zones: ZoneTrendSeries[] }>(`/farms/${farmId}/telemetry/trend`, {
    query: { hours },
  });
}

export type AlertStatusFilter = "active" | "acknowledged";

export function getAlerts(farmId: string, status?: AlertStatusFilter): Promise<Alert[]> {
  return request<Alert[]>(`/farms/${farmId}/alerts`, {
    query: { status },
  });
}

/** userId is optional until Part 10 wires real auth. */
export function acknowledgeAlert(alertId: string, userId?: string): Promise<Alert> {
  return request<Alert>(`/alerts/${alertId}/acknowledge`, {
    method: "PATCH",
    body: JSON.stringify(userId ? { userId } : {}),
  });
}

export function getSchedules(farmId: string): Promise<IrrigationSchedule[]> {
  return request<IrrigationSchedule[]>(`/farms/${farmId}/irrigation/schedules`);
}

export type SchedulePatch = Partial<{
  startTime: string;
  durationMinutes: number;
  repeatDays: number[];
  moistureThreshold: number;
  active: boolean;
  /** Part 017: retime a one_time schedule (resets firedAt). */
  scheduledStart: string;
  scheduledEnd: string;
}>;

export function updateSchedule(scheduleId: string, patch: SchedulePatch): Promise<IrrigationSchedule> {
  return request<IrrigationSchedule>(`/irrigation/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/**
 * Manual trigger (Part 9): persists the log AND publishes the MQTT start
 * command. `commandDelivered=false` means the broker never accepted it —
 * the returned log row is already marked skipped with the failure reason.
 */
export function startIrrigation(scheduleId: string): Promise<StartIrrigationResult> {
  return request<StartIrrigationResult>(`/irrigation/schedules/${scheduleId}/start`, {
    method: "POST",
  });
}

export function getIrrigationLogs(farmId: string): Promise<IrrigationLog[]> {
  return request<IrrigationLog[]>(`/farms/${farmId}/irrigation/logs`);
}