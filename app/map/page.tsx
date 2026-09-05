"use client";

import React, { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Map as MapIcon,
  PenLine,
  SquareStack,
  Move,
  Eye,
  PencilLine,
  Loader2,
} from "lucide-react";
import {
  getFarmSpatial,
  updateFarmBoundary,
  updateZone,
  updateNode,
  canEditSpatial,
  canOperateIrrigation,
  type FarmSpatial,
  type GeojsonPolygon,
} from "@/lib/api";
import type { SensorNode } from "@/lib/types";
import { usePrimaryFarmId, useNodes, useZones } from "@/lib/hooks";
import { useTranslations } from "next-intl";
import { NodeDetailModal } from "@/components/NodeDetailModal";
import { useAuth } from "@/lib/hooks/useAuth";
import type { MapCanvasProps, MapMode } from "@/components/map/MapCanvas";
import { zoneColorsById } from "@/components/map/zoneColors";
import { geoAreaHectares } from "@/components/map/autoPlace";
import { formatAreaHectares } from "@/lib/format";

// Leaflet only exists in the browser — never import it during SSR.
const MapCanvas = dynamic<MapCanvasProps>(
  () => import("@/components/map/MapCanvas").then((m) => m.MapCanvas),
  { ssr: false, loading: () => <MapSkeleton /> }
);

function MapSkeleton() {
  const tb = useTranslations("pageBits");
  return (
    <div className="h-[520px] sm:h-[560px] w-full rounded-xl border border-soil-700 bg-soil-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-parchment/50">
        <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none text-olive-400" />
        <span className="font-mono text-sm">{tb("loadingGps")}</span>
      </div>
    </div>
  );
}

const MODE_LABELS: Record<MapMode, (tb: (k: string) => string) => string> = {
  view: (tb) => tb("modeView"),
  editBoundary: (tb) => tb("modeEditBoundary"),
  drawFarm: (tb) => tb("modeDrawFarm"),
  drawZone: (tb) => tb("modeDrawZone"),
  reposition: (tb) => tb("modeReposition"),
};

export default function MapPage() {
  const t = useTranslations("pageHeadings");
  const tbits = useTranslations("pageBits");
  const router = useRouter();
  const farmId = usePrimaryFarmId();
  const { user } = useAuth();
  const canEdit = canEditSpatial(user);
  const canIrrigate = canOperateIrrigation(user);

  const nodesQuery = useNodes(farmId);
  const zonesQuery = useZones(farmId);
  const nodes: SensorNode[] = nodesQuery.data ?? [];
  const zones = zonesQuery.data ?? [];

  const [spatial, setSpatial] = useState<FarmSpatial | null>(null);
  const [spatialLoading, setSpatialLoading] = useState(true);
  const [spatialError, setSpatialError] = useState<string | null>(null);

  const [mode, setMode] = useState<MapMode>("view");
  const [drawZoneId, setDrawZoneId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SensorNode | null>(null);

  // Base layer (street/satellite) is owned here so the page subtitle can
  // reflect it; the map's Street/Satellite toggle drives it via callback.
  const [baseLayer, setBaseLayer] = useState<"street" | "satellite">("satellite");

  const loadSpatial = useCallback(async (): Promise<void> => {
    if (!farmId) return;
    try {
      const data = await getFarmSpatial(farmId);
      setSpatial(data);
      setSpatialError(null);
    } catch (err) {
      setSpatialError((err as Error).message);
    } finally {
      setSpatialLoading(false);
    }
  }, [farmId]);

  useEffect(() => {
    setSpatialLoading(true);
    void loadSpatial();
  }, [loadSpatial]);

  const hasBoundary = Boolean(spatial?.boundaryGeojson);

  const enterMode = (next: MapMode): void => {
    if (!canEdit && next !== "view") return; // farmer: view only
    setMode(next);
    setSpatialError(null);
  };

  const saveFarmBoundary = async (geojson: GeojsonPolygon): Promise<void> => {
    if (!farmId) return;
    // Area is auto-calculated from the drawn polygon (turf) and saved together
    // with the boundary in the same call — no manual area entry anywhere.
    const totalAreaHa = geoAreaHectares(geojson);
    const updated = await updateFarmBoundary(farmId, { boundaryGeojson: geojson, totalAreaHa });
    setSpatial(updated);
  };

  const saveZoneBoundary = async (zoneId: string, boundaryGps: unknown): Promise<void> => {
    const areaHectares = geoAreaHectares(boundaryGps as GeojsonPolygon | null);
    await updateZone(zoneId, {
      boundaryGps: boundaryGps as Record<string, unknown>,
      areaHectares,
    });
  };

  const saveNodePositions = async (
    changes: Record<string, { lat: number; lon: number }>
  ): Promise<void> => {
    await Promise.all(
      Object.entries(changes).map(([nodeId, p]) => updateNode(nodeId, { lat: p.lat, lon: p.lon }))
    );
  };

  const refetchAll = (): void => {
    void loadSpatial();
    nodesQuery.refetch();
    zonesQuery.refetch();
  };

  // Fresh positions when the farm map tab regains focus/visibility — a node
  // auto-placed at CREATE or on zone change (server-side placement) shows up
  // in place without a hard reload. Mount + polling already covered the rest.
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState !== "visible") return;
      void loadSpatial();
      void nodesQuery.refetch();
      void zonesQuery.refetch();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [loadSpatial, nodesQuery.refetch, zonesQuery.refetch]);

  const isStaffHub = user?.role === "technician" || user?.role === "admin";

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-soil-800 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isStaffHub && (
              <button
                type="button"
                onClick={() => router.push(`/${user?.role === "admin" ? "admin" : "technician"}`)}
                aria-label={tbits("backAria")}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-parchment/60 hover:text-parchment hover:bg-soil-800 border border-transparent hover:border-soil-700 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment flex items-center gap-2">
                <MapIcon className="w-6 h-6 text-olive-400" />
                {t("mapTitle")}
              </h1>
              <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
                {t("mapSubSuffix", { name: spatial?.name ?? t("yourFarm") })}{" "}
                {spatial?.boundaryGeojson ? (
                  <span className="text-parchment/80">
                    ({formatAreaHectares(spatial.totalAreaHa, t("mapAreaNotComputed"))})
                  </span>
                ) : (
                  <span className="text-parchment/40">· {t("mapBoundaryNotDrawn")}</span>
                )}{" "}
                · {baseLayer === "satellite" ? t("esriSatellite") : t("openStreetMap")}
              </p>
            </div>
          </div>

          {/* Mode toggle — drawing/reposition tools only for technician+/admin */}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={tbits("mapModeAria")}>
              <ModeButton
                active={mode === "view"}
                onClick={() => enterMode("view")}
                icon={<Eye className="w-4 h-4" />}
                label={MODE_LABELS.view(tbits)}
              />
              <ModeButton
                active={mode === "editBoundary"}
                onClick={() => enterMode("editBoundary")}
                icon={<PencilLine className="w-4 h-4" />}
                label={MODE_LABELS.editBoundary(tbits)}
              />
              <ModeButton
                active={mode === "drawFarm"}
                onClick={() => enterMode("drawFarm")}
                icon={<PenLine className="w-4 h-4" />}
                label={MODE_LABELS.drawFarm(tbits)}
              />
              <ModeButton
                active={mode === "drawZone"}
                onClick={() => enterMode("drawZone")}
                icon={<SquareStack className="w-4 h-4" />}
                label={MODE_LABELS.drawZone(tbits)}
              />
              <ModeButton
                active={mode === "reposition"}
                onClick={() => enterMode("reposition")}
                icon={<Move className="w-4 h-4" />}
                label={MODE_LABELS.reposition(tbits)}
              />
            </div>
          )}
        </div>

        {/* Zone picker when drawing a zone boundary */}
        {canEdit && mode === "drawZone" && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-mono text-parchment/60">{tbits("drawingBoundary")}</span>
            <select
              value={drawZoneId ?? ""}
              onChange={(e) => setDrawZoneId(e.target.value || null)}
              className="min-h-[44px] px-3 rounded-lg bg-soil-950 border border-soil-700 text-parchment font-mono text-sm focus:outline-none focus:border-wheat-400"
            >
              <option value="">{tbits("selectZone")}</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Empty-state — no farm boundary drawn yet */}
      {!hasBoundary && !spatialLoading && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-soil-700 bg-soil-900">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 w-2 h-2 rounded-full bg-wheat-400 flex-none" />
            <div>
              <p className="font-mono text-sm text-parchment font-bold">
                {tbits("noBoundaryTitle")}
              </p>
              <p className="text-xs font-sans text-parchment/60 mt-0.5">
                {canEdit
                  ? tbits("noBoundaryEditSub")
                  : tbits("noBoundaryTechSub")}
              </p>
            </div>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => enterMode("drawFarm")}
              className="min-h-[44px] px-4 rounded-lg bg-wheat-500 hover:bg-wheat-600 text-soil-950 font-mono font-bold text-sm flex items-center gap-2 disabled:opacity-60"
            >
              <PenLine className="w-4 h-4" /> {tbits("modeDrawFarm")}
            </button>
          )}
        </div>
      )}

      {spatialError && (
        <div className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/40 text-clay-400 text-xs font-mono">
          {spatialError}
        </div>
      )}

      {/* The map */}
      {!farmId ? (
        <div className="h-[520px] w-full rounded-xl border border-soil-700 bg-soil-900 flex items-center justify-center">
          <p className="font-mono text-sm text-parchment/50">
            {isStaffHub
              ? "Pick a farm from your hub to load its map."
              : "No farm linked to your account yet."}
          </p>
        </div>
      ) : (
        <MapCanvas
          mode={mode}
          farmSpatial={spatial}
          zones={zones}
          nodes={nodes}
          drawZoneId={drawZoneId}
          loading={spatialLoading || nodesQuery.loading}
          canEdit={canEdit}
          canIrrigate={canIrrigate}
          baseLayer={baseLayer}
          onBaseLayerChange={setBaseLayer}
          onNodeClick={(n) => setSelectedNode(n)}
          onFarmBoundarySaved={saveFarmBoundary}
          onZoneBoundarySaved={saveZoneBoundary}
          onNodePositionsSaved={saveNodePositions}
          onExitEditMode={() => enterMode("view")}
          onEnterRepositionMode={() => enterMode("reposition")}
          onRefetch={refetchAll}
        />
      )}

      {/* Legend */}
      <div className="bg-soil-900 border border-soil-700 rounded-xl p-4 flex flex-col sm:flex-row 2xl:items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-parchment/60 font-bold uppercase">{tbits("legend")}:</span>
          <LegendItem color="#8BAE6E" label={tbits("legendNodeOnline")} />
          <LegendItem color="#E4C173" label={tbits("legendNodeWarning")} />
          <LegendItem color="#E0714A" label={tbits("legendNodeOffline")} />
          <LegendItem color="#F1F0E8" outline label={tbits("legendFarmBoundary")} />
          {zones.some((z) => z.boundaryGps) && (
            <span className="text-parchment/40">·</span>
          )}
          {(() => {
            const list = zones.filter((z) => z.boundaryGps);
            const colorById = zoneColorsById(list.map((z) => z.id));
            return list.map((z) => (
              <ZoneLegendItem
                key={z.id}
                color={colorById[z.id] ?? { fill: "#8BAE6E", stroke: "#3E5C2E" }}
                label={z.name}
              />
            ));
          })()}
        </div>
        <span className="text-parchment/50 text-[11px]">
          Nodes are color-coded by status; click a node to open its detail view.
        </span>
      </div>

      {/* Reuse the SAME node-detail modal used across the app */}
      <NodeDetailModal
        node={selectedNode}
        isOpen={Boolean(selectedNode)}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] px-3 py-1.5 rounded-lg font-mono text-xs font-bold border flex items-center gap-1.5 transition-colors ${
        active
          ? "bg-olive-600/20 text-olive-400 border-olive-500/50"
          : "bg-soil-950 text-parchment/50 border-soil-800 hover:text-parchment hover:border-soil-600"
      }`}
    >
      {icon} {label}
    </button>
  );
}

function LegendItem({
  color,
  label,
  outline,
  translucent,
}: {
  color: string;
  label: string;
  outline?: boolean;
  translucent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-3 h-3 rounded-full border border-soil-900"
        style={{
          background: translucent ? `${color}55` : outline ? "transparent" : color,
          borderColor: outline ? color : undefined,
        }}
      />
      <span className="text-parchment/80">{label}</span>
    </div>
  );
}

function ZoneLegendItem({
  color,
  label,
}: {
  color: { fill: string; stroke: string };
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-3 h-3 rounded-sm border"
        style={{ background: `${color.fill}66`, borderColor: color.stroke }}
      />
      <span className="text-parchment/80">{label}</span>
    </div>
  );
}
