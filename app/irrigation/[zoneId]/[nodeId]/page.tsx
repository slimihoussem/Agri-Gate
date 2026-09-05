import { redirect } from "next/navigation";

/**
 * Screen 3 (legacy) — consolidated into the node-detail MODAL (NodeDetailModal).
 *
 * This route previously hosted its own duplicate Valve Control / Irrigation
 * Schedule / Telemetry markup, which drifted from the modal's implementation.
 * It is no longer a separate node-detail UI: it redirects to the zone card grid
 * with a ?node=<id> query that auto-opens that node's modal — preserving
 * shareable per-node deep links while keeping exactly ONE node-detail UI.
 */
export default function LegacyNodeRoute({
  params,
}: {
  params: { zoneId: string; nodeId: string };
}) {
  redirect(`/irrigation/${params.zoneId}?node=${encodeURIComponent(params.nodeId)}`);
}
