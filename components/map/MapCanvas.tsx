"use client";

// Leaflet is browser-only; this module is loaded via next/dynamic({ ssr: false })
// from app/map/page.tsx so it never executes during server render.
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";

// leaflet-geoman-free is a classic Leaflet plugin that reads the global
// window.L — it does NOT pull leaflet in as an ES-module dependency in this
// bundler setup. Attach L to the global explicitly BEFORE the plugin loads so
// geoman can find it (and so simple-leaflet init is never raced). Plain import
// order alone is unreliable here.
if (typeof window !== "undefined" && !(window as any).L) {
  (window as any).L = L;
}
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  Tooltip,
  Popup,
  useMap,
} from "react-leaflet";
import { Search, Satellite, Map as MapLucide } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type FarmSpatial,
  type GeojsonPolygon,
  geocode,
} from "@/lib/api";
import type { SensorNode, Zone } from "@/lib/types";
import {
  zoneColorsById,
  FARM_BOUNDARY_STYLE,
} from "./zoneColors";
import { autoPlaceNodes } from "./autoPlace";
import { formatAreaHectares } from "@/lib/format";
import { NodeCard } from "@/components/NodeCard";
import { ScheduleModal } from "@/components/ScheduleModal";

export type MapMode = "view" | "editBoundary" | "drawFarm" | "drawZone" | "reposition";

/** Sentinel id used to key the farm boundary layer (zones key by their own id). */
const FARM_LAYER_ID = "__farm__";

export interface MapCanvasProps {
  mode: MapMode;
  farmSpatial: FarmSpatial | null;
  zones: Zone[];
  nodes: SensorNode[];
  /** Zone the operator selected in Draw-Zone mode (before drawing). */
  drawZoneId: string | null;
  loading: boolean;
  /** Whether the current viewer may edit boundaries (technician+/admin). */
  canEdit: boolean;
  /** Whether the current viewer may operate node irrigation (Open/Close/Schedules). */
  canIrrigate: boolean;
  /** Currently active base layer (owns the Street/Satellite default + subtitle). */
  baseLayer: "street" | "satellite";
  onBaseLayerChange: (layer: "street" | "satellite") => void;
  onNodeClick: (node: SensorNode) => void;
  onFarmBoundarySaved: (geojson: GeojsonPolygon) => Promise<void>;
  onZoneBoundarySaved: (zoneId: string, boundaryGps: unknown) => Promise<void>;
  onNodePositionsSaved: (changes: Record<string, { lat: number; lon: number }>) => Promise<void>;
  /** Raise when the operator wants to leave the current editing mode. */
  onExitEditMode: () => void;
  /** Raise to auto-switch into Reposition mode (after auto node placement). */
  onEnterRepositionMode: () => void;
  onRefetch: () => void;
}

const NODE_COLORS: Record<SensorNode["status"], { fill: string; stroke: string }> = {
  online: { fill: "#8BAE6E", stroke: "#54713C" },
  warning: { fill: "#E4C173", stroke: "#B8863A" },
  offline: { fill: "#E0714A", stroke: "#9C3609" },
};

/** Derive a [lat, lng] center for the base map from farm data (defensive fallback). */
function centerOf(farmSpatial: FarmSpatial | null): [number, number] {
  const lat =
    farmSpatial?.centerLat ??
    farmSpatial?.latitude ??
    35.02;
  const lon =
    farmSpatial?.centerLon ??
    farmSpatial?.longitude ??
    9.68;
  return [lat, lon];
}

function nodeColor(node: SensorNode): { fill: string; stroke: string } {
  return NODE_COLORS[node.status] ?? NODE_COLORS.offline;
}

/**
 * Turn a GeoJSON Polygon ({type, coordinates:[ring, ...]}) into Leaflet latlngs.
 *
 * Defensive: a zone that has a boundary flag but boundary_gps that is null,
 * empty, or malformed (e.g. a flattened ring at the wrong nesting depth, or a
 * non-finite coordinate) is skipped rather than crashing the whole map. A
 * newly created zone with no boundary drawn is simply rendered with no polygon.
 */
function polygonLatLngs(geo: unknown | null): L.LatLngExpression[][] | null {
  if (!geo) return null;
  const g = geo as { type?: string; coordinates?: unknown };
  if (g.type !== "Polygon" || !Array.isArray(g.coordinates) || g.coordinates.length === 0) {
    return null;
  }

  const rings: L.LatLngExpression[][] = [];
  for (const ring of g.coordinates) {
    // A ring must be an array of [lon, lat] points (a flattened [lon, lat]
    // pair — wrong nesting depth — is length < 3 and safely skipped).
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const points: [number, number][] = [];
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const lon = point[0];
      const lat = point[1];
      if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }
      points.push([lat, lon]);
    }
    if (points.length >= 3) rings.push(points);
  }

  return rings.length > 0 ? rings : null;
}

/** Marker icon — a small colored pin with an outer glow matching node status. */
function buildNodeIcon(node: SensorNode, selected: boolean): L.DivIcon {
  const c = nodeColor(node);
  return L.divIcon({
    className: "agrigate-node-pin",
    html: `<div class="pin-wrap ${selected ? "pin-selected" : ""}">
             <span class="pin-dot" style="background:${c.fill};border-color:${c.stroke}"></span>
           </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

interface BoundaryPolygonProps {
  id: string;
  positions: L.LatLngExpression[][];
  pathOptions: L.PolylineOptions;
  tooltipLabel: string;
  /** Optional popup body rendered when the polygon is clicked (e.g. zone summary). */
  popup?: React.ReactNode;
  /** We are in the "Edit Boundary" sub-mode. */
  editMode: boolean;
  /** This exact shape is the target currently being edited. */
  targeted: boolean;
  canEdit: boolean;
  onTarget: (id: string) => void;
  onRegisterLayer: (id: string, layer: L.Polygon | null) => void;
}

/**
 * A persistent, editable boundary polygon. It renders declaratively through
 * react-leaflet (so it stays visible in every mode) but drives leaflet-geoman
 * editing on the underlying layer when targeted.
 */
function BoundaryPolygon({
  id,
  positions,
  pathOptions,
  tooltipLabel,
  popup,
  editMode,
  targeted,
  canEdit,
  onTarget,
  onRegisterLayer,
}: BoundaryPolygonProps) {
  const layerRef = useRef<L.Polygon | null>(null);
  const prevTargeted = useRef(false);

  const syncEdit = (layer: L.Polygon | null): void => {
    if (!layer || !layer.pm) return;
    if (editMode && targeted) {
      layer.pm.enable({ draggable: false, snappable: true, allowSelfIntersection: false });
    } else {
      if (typeof layer.pm.enabled === "function" && layer.pm.enabled()) layer.pm.disable();
      if (layer.pm.disableLayerDrag) layer.pm.disableLayerDrag();
    }
  };

  // Enable/disable editing + revert to the saved shape on deselect.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (editMode && targeted) {
      // (re)applying geoman edit to the targeted layer
      syncEdit(layer);
    } else {
      syncEdit(layer);
      if (prevTargeted.current && !targeted) {
        // Leaving a target → discard in-progress edits, revert to saved shape.
        layer.setLatLngs(positions as L.LatLngExpression[][]);
      }
    }
    prevTargeted.current = editMode && targeted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, targeted, id]);

  return (
    <Polygon
      positions={positions}
      pathOptions={pathOptions}
      eventHandlers={{
        add: (e) => {
          const layer = e.target as L.Polygon;
          layerRef.current = layer;
          onRegisterLayer(id, layer);
          syncEdit(layer);
        },
        remove: () => {
          onRegisterLayer(id, null);
          layerRef.current = null;
        },
        click: () => {
          if (editMode && canEdit && !targeted) onTarget(id);
        },
      }}
    >
      <Tooltip sticky>
        <span className="font-mono text-xs">{tooltipLabel}</span>
      </Tooltip>
      {popup ? <Popup>{popup}</Popup> : null}
    </Polygon>
  );
}

/** Compact telemetry summary shown in the popup when a zone polygon is clicked.
 *  Reuses the SAME data as the Dashboard zone cards (the Zone object supplied
 *  by GET /api/farms/:farmId/zones) as well as its status/offline conventions. */
function ZoneSummaryPopup({
  zone,
  color,
  totalNodes,
  activeNodes,
}: {
  zone: Zone;
  color: string;
  totalNodes: number;
  activeNodes: number;
}) {
  const t = useTranslations("mapCanvas");
  const offline = zone.activeNodeCount === 0 || zone.moisture === null;
  const badge =
    zone.status === "ok" && !offline
      ? { label: t("optimal"), cls: "bg-olive-600/20 text-olive-400 border-olive-500/40" }
      : zone.status === "warning"
        ? { label: t("warning"), cls: "bg-wheat-600/20 text-wheat-400 border-wheat-500/40" }
        : zone.status === "critical"
          ? { label: t("critical"), cls: "bg-clay-600/20 text-clay-400 border-clay-500/40" }
          : { label: t("offline"), cls: "bg-clay-600/20 text-clay-400 border-clay-500/40" };

  const npk: [string, number | null][] = [
    ["N", zone.nitrogen],
    ["P", zone.phosphorus],
    ["K", zone.potassium],
  ];

  return (
    <div className="zone-popup-wrapper w-[270px] max-w-[80vw] font-sans p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 border-b border-soil-800 pb-2.5 pr-7">
        <div>
          <div className="text-base font-display font-semibold text-parchment flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm shrink-0"
              style={{ background: `${color}88`, border: `1px solid ${color}` }}
            />
            {zone.name}
          </div>
          <p className="text-xs text-parchment/60 mt-0.5">{zone.cropType}</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-md border text-xs font-mono font-semibold shrink-0 ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="zone-popup-stat p-2">
          <div className="text-[10px] font-mono uppercase text-parchment/50">{t("moisture")}</div>
          <div className="font-mono text-sm font-bold text-parchment">
            {zone.moisture != null ? `${Math.round(zone.moisture)}%` : "—"}
          </div>
        </div>
        <div className="zone-popup-stat p-2">
          <div className="text-[10px] font-mono uppercase text-parchment/50">{t("active")}</div>
          <div className="font-mono text-sm font-bold text-parchment">
            {activeNodes}
            {totalNodes > 0 ? `/${totalNodes}` : ""}
          </div>
        </div>
        <div className="zone-popup-stat p-2">
          <div className="text-[10px] font-mono uppercase text-parchment/50">{t("watered")}</div>
          <div className="font-mono text-sm font-bold text-parchment">
            {zone.lastWatered ? t("yes") : t("no")}
          </div>
        </div>
        <div className="zone-popup-stat p-2">
          <div className="text-[10px] font-mono uppercase text-parchment/50">{t("area")}</div>
          <div className="font-mono text-sm font-bold text-parchment">
            {zone.boundaryGps
              ? formatAreaHectares(zone.areaHectares, "—")
              : t("notDrawn")}
          </div>
        </div>
      </div>

      <div className="zone-popup-stat p-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-parchment/50 mb-1.5">
          {t("soilNutrients")}
        </div>
        <div className="flex justify-between text-xs font-mono text-parchment/80">
          {npk.map(([label, value]) => {
            const text = value == null ? "—" : `${Math.round(value)} ppm`;
            return (
              <span key={label}>
                <span className="text-parchment/50">{label}: </span>
                <span className="text-parchment">{text}</span>
              </span>
            );
          })}
        </div>
      </div>

      <Link
        href={`/irrigation/${zone.id}`}
        className="zone-popup-primary-btn"
      >
        {t("viewNodesInZone")}
      </Link>
    </div>
  );
}

/**
 * Inner controller that talks to the Leaflet map instance (react-leaflet's
 * useMap) — powers geoman drawing + boundary fit-to-view.
 */
function MapInteractions({
  mode,
  farmSpatial,
  nodes,
  onDraft,
  onClearDraft,
}: {
  mode: MapMode;
  farmSpatial: FarmSpatial | null;
  nodes: SensorNode[];
  onDraft: (geo: GeojsonPolygon | null) => void;
  onClearDraft: () => void;
}) {
  const map = useMap();
  const draftRef = useRef<L.Layer | null>(null);
  const fittedRef = useRef(false);

  // Geoman is loaded by MapCanvas BEFORE the map is created, so map.pm exists
  // here. Keep its default toolbar hidden — this app drives drawing with its
  // own custom mode buttons.
  useEffect(() => {
    if (!map.pm) return;
    try {
      map.pm.removeControls?.();
    } catch {
      /* toolbar already removed */
    }
  }, [map]);

  // Fit bounds to farm boundary + nodes once, after first real data arrives.
  useEffect(() => {
    if (fittedRef.current || !farmSpatial) return;
    const latlngs = polygonLatLngs(farmSpatial.boundaryGeojson);
    const nodePts = nodes
      .filter((n) => typeof n.lat === "number" && typeof n.lon === "number")
      .map((n) => [n.lat as number, n.lon as number] as [number, number]);
    const pts: [number, number][] =
      (latlngs ? latlngs.flat(1) : []).map(
        (p: L.LatLngExpression): [number, number] => {
          const arr = L.latLng(p);
          return [arr.lat, arr.lng];
        }
      ).concat(nodePts);
    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts.map((p) => L.latLng(p[0], p[1]))), { padding: [40, 40] });
    }
    fittedRef.current = true;
  }, [farmSpatial, nodes, map]);

  // Geoman drawing control per mode. Persistent farm/zone layers are managed
  // separately (BoundaryPolygon above) — this only drives the single in-flight
  // "currently being drawn" temporary polygon, added on top.
  useEffect(() => {
    if (mode !== "drawFarm" && mode !== "drawZone") {
      map.pm?.disableDraw();
      return;
    }
    // Suppress the default geoman toolbar; we drive drawing programmatically.
    map.pm?.removeControls?.();

    const options = {
      snappable: true,
      allowSelfIntersection: true,
      showArea: false,
      continueDrawing: false,
      hintline: true,
      templineStyle: { color: "#8BAE6E", weight: 2 },
      hintlineStyle: { color: "#8BAE6E", dashArray: "6 6", opacity: 0.7 },
    };

    const onCreate = (e: { layer: L.Layer }): void => {
      const geo = (e.layer as L.Polygon).toGeoJSON?.() as
        | { geometry?: GeojsonPolygon }
        | undefined;
      const geometry = geo?.geometry ?? null;
      // One draft at a time: keep the first polygon, discard any extra ones.
      if (draftRef.current) {
        map.removeLayer(e.layer);
        return;
      }
      draftRef.current = e.layer;
      onDraft(geometry);
      map.pm?.disableDraw();
    };

    map.on("pm:create", onCreate);
    map.pm?.enableDraw("Polygon", options);

    return () => {
      map.off("pm:create", onCreate);
      map.pm?.disableDraw();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, map]);

  // When leaving a drawing mode, drop any in-flight draft polygon. (Edit mode
  // has no draft — persistent layers are handled by BoundaryPolygon.)
  useEffect(() => {
    if (mode !== "drawFarm" && mode !== "drawZone") {
      if (draftRef.current) {
        map.removeLayer(draftRef.current);
        draftRef.current = null;
      }
      onClearDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, map]);

  return null;
}

/**
 * Floating city-search control. Rendered as an overlay sibling of the map.
 * Uses the backend geocode proxy on explicit submit, then flies to the result.
 */
function SearchControl({
  mapRef,
  placement,
}: {
  mapRef: React.MutableRefObject<L.Map | null>;
  placement: "top-left" | "top-right";
}) {
  const t = useTranslations("mapCanvas");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "notfound">("idle");

  const submit = async (): Promise<void> => {
    const q = query.trim();
    if (!q || state === "busy") return;
    setState("busy");
    try {
      const result = await geocode(q);
      if (!result) {
        setState("notfound");
        return;
      }
      mapRef.current?.flyTo([result.lat, result.lon], 13);
      setState("idle");
    } catch {
      setState("notfound");
    }
  };

  const align = placement === "top-left" ? "left-3" : "right-3";

  return (
    <div className={`absolute top-3 ${align} z-[1000] flex flex-col gap-1 w-60`}>
      <div className="flex items-center gap-1 rounded-lg bg-soil-950/90 border border-soil-700 p-1 shadow-lg">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (state === "notfound") setState("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={t("searchCity")}
          aria-label={t("searchCity")}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-parchment placeholder:text-parchment/40 focus:outline-none font-mono"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={state === "busy"}
          aria-label={t("search")}
          title={t("search")}
          className="min-h-[34px] min-w-[38px] flex items-center justify-center rounded-md bg-soil-800 hover:bg-soil-700 text-olive-400 disabled:opacity-50 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>
      {state === "busy" && (
        <span className="px-2 text-xs font-mono text-parchment/60">{t("searching")}</span>
      )}
      {state === "notfound" && (
        <span className="px-2 py-1 rounded bg-clay-500/20 border border-clay-500/40 text-clay-400 text-xs font-mono">
          {t("cityNotFound")}
        </span>
      )}
    </div>
  );
}

export function MapCanvas(props: MapCanvasProps) {
  const {
    mode,
    farmSpatial,
    zones,
    nodes,
    drawZoneId,
    canEdit,
    canIrrigate,
    baseLayer,
    onBaseLayerChange,
    onNodeClick,
    onFarmBoundarySaved,
    onZoneBoundarySaved,
    onNodePositionsSaved,
    onExitEditMode,
    onEnterRepositionMode,
  } = props;

  const t = useTranslations("mapCanvas");

  const [draft, setDraft] = useState<GeojsonPolygon | null>(null);
  const [dirtyPositions, setDirtyPositions] = useState<
    Record<string, { lat: number; lon: number }>
  >({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleNode, setScheduleNode] = useState<SensorNode | null>(null);

  // Editing: the id of the boundary (zone id, or FARM_LAYER_ID) being edited,
  // plus a map of registered leaflet layers so we can read the edited GeoJSON.
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const boundaryLayersRef = useRef<Record<string, L.Polygon | null>>({});

  // reset the edit target whenever we leave the edit sub-mode
  useEffect(() => {
    if (mode !== "editBoundary") setEditTargetId(null);
  }, [mode]);

  // Geoman must patch L.Map BEFORE map creation so map.pm is guaranteed on the
  // react-leaflet instance. Load it once; gate the map's render on it.
  const [geoReady, setGeoReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    import("@geoman-io/leaflet-geoman-free")
      .then(() => {
        if (mounted) setGeoReady(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("Geoman failed to load:", err);
        if (mounted) setGeoReady(true); // still render the map (view-only) on failure
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Ref to the raw Leaflet map instance (for the search control's flyTo).
  const mapRef = useRef<L.Map | null>(null);

  // Base layer is controlled by the page (owns the default + subtitle text).

  const center = useMemo(() => centerOf(farmSpatial), [farmSpatial]);

  const mappableNodes = useMemo(
    () => nodes.filter((n) => typeof n.lat === "number" && typeof n.lon === "number"),
    [nodes]
  );

  const dirtyCount = Object.keys(dirtyPositions).length;

  const registerLayer = (id: string, layer: L.Polygon | null): void => {
    boundaryLayersRef.current[id] = layer;
  };

  /**
   * Stage auto-placement for nodes of a just-saved zone and, if any nodes were
   * moved, switch into Reposition mode so the operator can fine-tune them.
   * Returns true when we switched modes (else the caller exits to view).
   */
  const handleAutoPlacement = (zoneId: string, polygon: GeojsonPolygon | null): boolean => {
    const { changes } = autoPlaceNodes(zoneId, polygon, nodes);
    const ids = Object.keys(changes);
    if (ids.length === 0) return false;
    setDirtyPositions((p) => ({ ...p, ...changes }));
    onEnterRepositionMode();
    return true;
  };

  const doSaveFarm = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await onFarmBoundarySaved(draft);
      setDraft(null);
      props.onRefetch();
      onExitEditMode();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doSaveZone = async (): Promise<void> => {
    if (!draft || !drawZoneId) return;
    setSaving(true);
    setError(null);
    try {
      await onZoneBoundarySaved(drawZoneId, draft);
      setDraft(null);
      props.onRefetch();
      const switched = handleAutoPlacement(drawZoneId, draft);
      if (!switched) onExitEditMode();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doSaveEditedBoundary = async (): Promise<void> => {
    if (!editTargetId) return;
    setSaving(true);
    setError(null);
    const layer = boundaryLayersRef.current[editTargetId];
    const feature = layer?.toGeoJSON?.() as { geometry?: GeojsonPolygon } | undefined;
    const geometry = feature?.geometry ?? null;
    try {
      if (editTargetId === FARM_LAYER_ID) {
        if (geometry) await onFarmBoundarySaved(geometry);
        setEditTargetId(null);
        props.onRefetch();
        onExitEditMode();
      } else {
        const zoneId = editTargetId;
        if (geometry) await onZoneBoundarySaved(zoneId, geometry);
        setEditTargetId(null);
        props.onRefetch();
        const switched = handleAutoPlacement(zoneId, geometry);
        if (!switched) onExitEditMode();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const doSavePositions = async (): Promise<void> => {
    if (dirtyCount === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onNodePositionsSaved(dirtyPositions);
      setDirtyPositions({});
      props.onRefetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancel = (): void => {
    setDraft(null);
    setDirtyPositions({});
    setEditTargetId(null);
    setError(null);
    onExitEditMode();
  };

  // Farm boundary positions
  const farmLatLngs = polygonLatLngs(farmSpatial?.boundaryGeojson ?? null);
  // Zone polygons + deterministic, collision-free colors. The color map is
  // derived from the FULL set of zone ids (sorted rank), so small zone sets
  // always get distinct colors and map ↔ legend stay in sync even for zones
  // that have no boundary drawn yet (they render in the legend as "not drawn").
  const zoneColors = useMemo(
    () => zoneColorsById(zones.map((z) => z.id)),
    [zones]
  );

  const zoneShapes = useMemo(() => {
    const withBoundary = zones.filter((z) => z.boundaryGps);
    const shapes = withBoundary
      .map((zone) => {
        const latlngs = polygonLatLngs(zone.boundaryGps ?? null);
        if (!latlngs) return null;
        const c = zoneColors[zone.id] ?? { fill: "#8BAE6E", stroke: "#3E5C2E" };
        return { id: zone.id, zone, latlngs, color: c };
      })
      .filter(
        (z): z is { id: string; zone: Zone; latlngs: L.LatLngExpression[][]; color: { fill: string; stroke: string } } =>
          z !== null
      );
    return shapes;
  }, [zones, zoneColors]);

  const editingDraw = mode === "drawFarm" || mode === "drawZone" || mode === "reposition";
  const showEditBar = mode === "editBoundary" && editTargetId !== null;
  const showActionBar = editingDraw || showEditBar;

  return (
    <div className="relative h-[520px] sm:h-[560px] w-full rounded-xl overflow-hidden border border-soil-700">
      {!geoReady ? (
        <div className="h-full w-full flex items-center justify-center bg-soil-900">
          <p className="font-mono text-sm text-parchment/50">{t("loading")}</p>
        </div>
      ) : (
        <MapContainer
          ref={mapRef}
          center={center}
          zoom={15}
          className="h-full w-full"
          style={{ backgroundColor: "#1B1815" }}
        >
          {baseLayer === "street" ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          ) : (
            <TileLayer
              attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          )}

        {/* Farm outer boundary — dashed light outline, no fill, always visible */}
        {farmLatLngs && (
          <BoundaryPolygon
            id={FARM_LAYER_ID}
            positions={farmLatLngs}
            pathOptions={FARM_BOUNDARY_STYLE as L.PolylineOptions}
            tooltipLabel={farmSpatial?.name ?? "Farm boundary"}
            editMode={mode === "editBoundary"}
            targeted={mode === "editBoundary" && editTargetId === FARM_LAYER_ID}
            canEdit={canEdit}
            onTarget={(id) => setEditTargetId(id)}
            onRegisterLayer={registerLayer}
          />
        )}

        {/* Zones — each a distinct deterministic color, always visible together */}
        {zoneShapes.map((zone) => (
          <BoundaryPolygon
            key={zone.id}
            id={zone.id}
            positions={zone.latlngs}
            pathOptions={{
              color: zone.color.stroke,
              weight: 3,
              opacity: 1,
              fillColor: zone.color.fill,
              fillOpacity: 0.3,
            }}
            tooltipLabel={zone.zone.name}
            popup={
              <ZoneSummaryPopup
                zone={zone.zone}
                color={zone.color.stroke}
                totalNodes={
                  zone.zone.nodeCount ?? nodes.filter((n) => n.zoneId === zone.id).length
                }
                activeNodes={zone.zone.activeNodeCount}
              />
            }
            editMode={mode === "editBoundary"}
            targeted={mode === "editBoundary" && editTargetId === zone.id}
            canEdit={canEdit}
            onTarget={(id) => setEditTargetId(id)}
            onRegisterLayer={registerLayer}
          />
        ))}

        {/* Node markers — draggable in reposition mode, clickable otherwise */}
        {mappableNodes.map((node) => {
          const dirty = dirtyPositions[node.id];
          const pos: [number, number] = dirty
            ? [dirty.lat, dirty.lon]
            : [node.lat as number, node.lon as number];
          const isDirty = Boolean(dirty);
          return (
            <Marker
              key={node.id}
              position={pos}
              draggable={mode === "reposition"}
              icon={buildNodeIcon(node, isDirty)}
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const ll = m.getLatLng();
                  setDirtyPositions((p) => ({ ...p, [node.id]: { lat: ll.lat, lon: ll.lng } }));
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <span className="font-mono text-xs">
                  {node.id}
                  {isDirty ? " • moved" : ""}
                </span>
              </Tooltip>
              {mode !== "reposition" && (
                <Popup>
                  <div className="w-[300px] max-w-[80vw]">
                    <NodeCard
                      node={node}
                      canIrrigate={canIrrigate}
                      onOpenDrawer={() => onNodeClick(node)}
                      onOpenSchedule={() => setScheduleNode(node)}
                    />
                  </div>
                </Popup>
              )}
            </Marker>
          );
        })}

        <MapInteractions
          mode={mode}
          farmSpatial={farmSpatial}
          nodes={mappableNodes}
          onDraft={setDraft}
          onClearDraft={() => setDraft(null)}
        />
        </MapContainer>
      )}

      {/* City search — floating control, top-left of the map */}
      <SearchControl mapRef={mapRef} placement="top-left" />

      {/* Zone color legend — floating top-right, under the layer toggle. Lists
          EVERY zone (drawn or not) with its stored area where available. */}
      {zones.length > 0 && (
        <div className="absolute top-16 right-3 z-[1000] max-w-[240px] rounded-lg bg-soil-950/90 border border-soil-700 shadow-lg p-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-parchment/50 mb-1.5 px-1">
            Zones
          </div>
          <div className="flex flex-col gap-1">
            {zones.map((z) => {
              const c = zoneColors[z.id] ?? { fill: "#8BAE6E", stroke: "#3E5C2E" };
              const drawn = Boolean(z.boundaryGps);
              return (
                <div key={z.id} className="flex items-center gap-1.5 px-1">
                  <span
                    className="w-3 h-3 rounded-sm border border-soil-800 flex-none"
                    style={{ background: `${c.fill}66`, borderColor: c.stroke }}
                  />
                  <span className="text-[11px] font-mono text-parchment/80 truncate">{z.name}</span>
                  <span
                    className={`text-[11px] font-mono flex-none ml-auto ${
                      drawn ? "text-parchment/60" : "text-parchment/35 italic"
                    }`}
                  >
                    {drawn
                      ? formatAreaHectares(z.areaHectares, "—")
                      : "not drawn"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Base-layer (Street/Satellite) toggle — top-right */}
      <div className="absolute top-3 right-3 z-[1000] flex items-center">
        <div className="flex items-center rounded-lg bg-soil-950/90 border border-soil-700 shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => onBaseLayerChange("street")}
            title={t("streetMap")}
            aria-pressed={baseLayer === "street"}
            className={`min-h-[38px] px-3 flex items-center gap-1.5 font-mono text-xs transition-colors ${
              baseLayer === "street"
                ? "bg-olive-600/20 text-olive-400"
                : "text-parchment/50 hover:text-parchment"
            }`}
          >
            <MapLucide className="w-4 h-4" /> {t("streetBtn")}
          </button>
          <button
            type="button"
            onClick={() => onBaseLayerChange("satellite")}
            title={t("satelliteView")}
            aria-pressed={baseLayer === "satellite"}
            className={`min-h-[38px] px-3 flex items-center gap-1.5 font-mono text-xs border-l border-soil-700 transition-colors ${
              baseLayer === "satellite"
                ? "bg-olive-600/20 text-olive-400"
                : "text-parchment/50 hover:text-parchment"
            }`}
          >
            <Satellite className="w-4 h-4" /> {t("satelliteBtn")}
          </button>
        </div>
      </div>

      {/* In-map hint pill describing the active mode */}
      {mode === "editBoundary" && !showEditBar && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 rounded-lg bg-soil-950/90 border border-parchment/40 text-parchment font-mono text-xs whitespace-nowrap">
          Click a boundary (farm or zone) to edit it.
        </div>
      )}
      {mode === "drawFarm" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 rounded-lg bg-soil-950/90 border border-olive-500/40 text-olive-400 font-mono text-xs">
          Draw the farm&apos;s outer boundary, then Save.
        </div>
      )}
      {mode === "drawZone" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 rounded-lg bg-soil-950/90 border border-wheat-500/40 text-wheat-400 font-mono text-xs">
          Draw this zone&apos;s boundary within the farm, then Save.
        </div>
      )}
      {mode === "reposition" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] px-3 py-1.5 rounded-lg bg-soil-950/90 border border-clay-500/40 text-clay-400 font-mono text-xs">
          Drag nodes to reposition. Nothing is saved until you press Save.
        </div>
      )}

      {/* Editing action bar. The error banner renders ABOVE the buttons on
          its own row (vertical stack) so it is never hidden behind the
          controls, and its elevated z-index keeps it on top of the map. */}
      {showActionBar && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1100] flex flex-col items-center gap-2">
          {error && (
            <div className="px-3 py-1.5 rounded-lg bg-soil-950 border border-clay-500/60 text-clay-400 font-mono text-xs max-w-[320px] shadow-lg">
              {error}
            </div>
          )}
          <div className="flex items-center gap-2">
          {mode === "editBoundary" ? (
            <>
              <span className="px-3 py-1.5 rounded-lg bg-soil-950/90 border border-parchment/30 text-parchment/80 font-mono text-xs">
                Editing {editTargetId === FARM_LAYER_ID ? "farm" : "zone"} boundary
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void doSaveEditedBoundary()}
                className="min-h-[44px] px-4 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={cancel}
                className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={saving || (mode === "drawFarm" && !draft) || (mode === "drawZone" && (!draft || !drawZoneId)) || (mode === "reposition" && dirtyCount === 0)}
                onClick={mode === "reposition" ? () => void doSavePositions() : mode === "drawFarm" ? () => void doSaveFarm() : () => void doSaveZone()}
                className="min-h-[44px] px-4 rounded-lg bg-olive-500 hover:bg-olive-600 text-soil-950 font-mono font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving
                  ? "Saving…"
                  : mode === "reposition"
                    ? `Save Positions${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`
                    : mode === "drawFarm"
                      ? "Save Boundary"
                      : "Save Zone Boundary"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={cancel}
                className="min-h-[44px] px-4 rounded-lg bg-soil-800 hover:bg-soil-700 text-parchment border border-soil-600 font-mono text-sm"
              >
                Cancel
              </button>
            </>
          )}
          </div>
        </div>
      )}

      {/* Node irrigation schedule modal (reuses the Irrigation-page component) */}
      {scheduleNode && (
        <ScheduleModal
          isOpen
          onClose={() => setScheduleNode(null)}
          nodeId={scheduleNode.id}
          nodeName={scheduleNode.name}
          canIrrigate={canIrrigate}
        />
      )}
    </div>
  );
}

export type { ZoneColor } from "./zoneColors";
