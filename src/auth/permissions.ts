/**
 * Capability-based permission model — replaces the Part 10 role hierarchy.
 *
 * 'admin' implicitly holds every capability (platform-wide staff).
 * technician/farmer hold explicit capability lists; tenant scoping still
 * applies on top (a farmer can only ack alerts in their own org, etc. —
 * enforced by the existing assertFarmAccess layer).
 */
export const PERMISSIONS = {
  admin: ["*"], // implicitly everything
  technician: [
    "nodes.edit",
    "zones.edit",
    "alerts.ack",
    "irrigation.manage",
    "thresholds.edit",
  ],
  farmer: [
    "alerts.ack",
    "irrigation.manage",
    "thresholds.edit",
    "farmIdentity.edit",
  ],
} as const;

export type Role = keyof typeof PERMISSIONS;
export type Capability = string;

export function hasCapability(role: Role, action: Capability): boolean {
  const caps = PERMISSIONS[role];
  if (!caps) return false;
  return (caps as readonly string[]).includes("*") || (caps as readonly string[]).includes(action);
}
