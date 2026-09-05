"use client";

import React, { useState } from "react";
import { SensorNode } from "@/lib/types";
import {
  createNode,
  updateNode,
  deleteNode,
  reactivateNode,
  canManageInfrastructure,
} from "@/lib/api";
import { usePrimaryFarmId, useNodes, useZones } from "@/lib/hooks";
import { useAuth } from "@/lib/hooks/useAuth";
import { NodeTable } from "@/components/NodeTable";
import { NodeDetailModal } from "@/components/NodeDetailModal";
import { AddNodeModal } from "@/components/AddNodeModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTranslations } from "next-intl";
import {
  Cpu,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Check,
} from "lucide-react";

export default function DevicesPage() {
  const t = useTranslations("pageHeadings");
  const tb = useTranslations("pageBits");
  const tc = useTranslations("common");
  const farmId = usePrimaryFarmId();
  const [showArchived, setShowArchived] = useState(false);
  const nodes = useNodes(farmId, { includeInactive: showArchived });
  const zones = useZones(farmId);
  const { user } = useAuth();
  // UI convenience only — POST/PATCH/DELETE /api/nodes enforces technician+ server-side.
  const canManageHardware = canManageInfrastructure(user);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "warning" | "offline">("all");
  const [selectedNode, setSelectedNode] = useState<SensorNode | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<SensorNode | null>(null);
  const [pendingRemove, setPendingRemove] = useState<SensorNode | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeResult, setRemoveResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const nodeList: SensorNode[] = nodes.data ?? [];

  // Real API registration — modal owns pending state; page triggers refetch on success.
  const handleAddNode = async (input: {
    name: string;
    zoneId: string | null;
    commMethod: string;
    mqttClientId?: string;
    read_interval_ms: number | null;
    isActuator: boolean;
    lat?: number;
    lon?: number;
    sensorCapabilities: string[];
    flowRateLPerMin?: number;
    maxRuntimeMinutes?: number;
    installedAt?: string;
    notes?: string;
  }): Promise<void> => {
    if (farmId === undefined) throw new Error("Farm not loaded yet — try again in a moment");
    const created = await createNode({
      farmId,
      name: input.name,
      zoneId: input.zoneId,
      commMethod: "wifi",
      lat: input.lat,
      lon: input.lon,
      sensorCapabilities: input.sensorCapabilities,
      flowRateLPerMin: input.flowRateLPerMin,
      maxRuntimeMinutes: input.maxRuntimeMinutes,
      installedAt: input.installedAt,
      notes: input.notes,
      isActuator: input.isActuator,
    });
    await nodes.refetch();
    setIsAddModalOpen(false);
    setToastMessage(`Node ${created.id} (${created.name}) registered successfully.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Part 14: full edit via PATCH (modal pre-filled from the row's config).
  const handleEditSave = async (
    nodeId: string,
    input: {
      name: string;
      zoneId: string | null;
      commMethod: string;
      mqttClientId?: string;
      read_interval_ms: number | null;
      isActuator: boolean;
      lat?: number;
      lon?: number;
      sensorCapabilities: string[];
      flowRateLPerMin?: number;
      maxRuntimeMinutes?: number;
      installedAt?: string;
      notes?: string;
    }
  ): Promise<void> => {
    await updateNode(nodeId, input);
    await nodes.refetch();
    setIsAddModalOpen(false);
    setToastMessage(`Node ${nodeId} updated.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Part 14: history-aware removal. The safety rule (zone's last active valve)
  // returns a 400 — on failure we KEEP the dialog open and surface the message
  // inline so the reason is never swallowed.
  const handleRemoveConfirmed = async (): Promise<void> => {
    if (!pendingRemove) return;
    setRemoveBusy(true);
    setRemoveResult(null);
    try {
      const res = await deleteNode(pendingRemove.id);
      const text =
        res.mode === "archived"
          ? `This node has ${res.telemetryCount ?? 0} readings and ${res.logsCount ?? 0} irrigation records — archived, not deleted. History preserved, hidden from active views.`
          : `Node "${pendingRemove.name}" permanently deleted.`;
      await nodes.refetch();
      setPendingRemove(null);
      setToastMessage(text);
      setTimeout(() => setToastMessage(null), 6000);
    } catch (err) {
      setRemoveResult({ ok: false, text: (err as Error).message });
    } finally {
      setRemoveBusy(false);
    }
  };

  const handleReactivate = async (nodeId: string): Promise<void> => {
    try {
      await reactivateNode(nodeId);
      await nodes.refetch();
    } catch (err) {
      setAddError((err as Error).message);
      setTimeout(() => setAddError(null), 6000);
    }
  };

  const filteredNodes = nodeList.filter((node) => {
    const matchesSearch =
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.zoneName && node.zoneName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus =
      statusFilter === "all" ? true : node.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const onlineCount = nodeList.filter((n) => n.status === "online").length;
  const warningCount = nodeList.filter((n) => n.status === "warning").length;
  const offlineCount = nodeList.filter((n) => n.status === "offline").length;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Toast / Error Notifications */}
      {toastMessage && (
        <div className="p-3.5 rounded-xl bg-olive-600/20 border-2 border-olive-500/50 text-olive-400 text-sm font-mono flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2">
          <Check className="w-5 h-5 text-olive-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
      {addError && (
        <div className="p-3.5 rounded-xl bg-clay-600/20 border-2 border-clay-500/50 text-clay-400 text-sm font-mono flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{addError}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-soil-800 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-parchment">
            {t("devicesTitle")}
          </h1>
          <p className="text-xs sm:text-sm text-parchment/60 font-sans mt-1">
            {t("devicesSub")}
          </p>
        </div>

        {/* Add Node Button (Min 48px target) — technician/admin only (UI convenience; API enforces) */}
        {canManageHardware && (
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="min-h-[48px] px-5 py-2.5 rounded-lg bg-olive-500 hover:bg-olive-600 active:bg-olive-700 text-soil-950 font-mono text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>{tb("registerNewNode")}</span>
          </button>
        )}
      </div>

      {/* Search & Status Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search Input (Min 48px height) */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-5 h-5 text-parchment/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder={tb("searchNodesPh")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[48px] pl-11 pr-4 rounded-xl bg-soil-900 border-2 border-soil-700 text-parchment text-sm font-sans placeholder:text-parchment/40 focus:outline-none focus:border-olive-400 transition-colors"
          />
        </div>

        {/* Part 14: archived nodes toggle */}
        <label className="flex items-center gap-2 min-h-[48px] px-4 rounded-xl bg-soil-900 border-2 border-soil-700 text-xs font-mono text-parchment/70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="w-4 h-4 accent-olive-500"
          />
          {tb("showArchivedNodes")}
        </label>

        {/* Status Filter Pills (Min 48px touch targets) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0" role="group" aria-label={tb("statusFiltersAria")}>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`min-h-[48px] px-4 py-2 rounded-xl font-mono text-xs font-bold border transition-colors whitespace-nowrap ${
              statusFilter === "all"
                ? "bg-soil-800 text-parchment border-soil-600 shadow-sm"
                : "bg-soil-900 text-parchment/50 border-soil-700 hover:text-parchment"
            }`}
          >
            {tb("allCount", { count: nodeList.length })}
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("online")}
            className={`min-h-[48px] px-4 py-2 rounded-xl font-mono text-xs font-bold border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              statusFilter === "online"
                ? "bg-olive-600/20 text-olive-400 border-olive-500/50 shadow-sm"
                : "bg-soil-900 text-parchment/50 border-soil-700 hover:text-olive-400"
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{tb("countOnline", { count: onlineCount })}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("warning")}
            className={`min-h-[48px] px-4 py-2 rounded-xl font-mono text-xs font-bold border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              statusFilter === "warning"
                ? "bg-wheat-600/20 text-wheat-400 border-wheat-500/50 shadow-sm"
                : "bg-soil-900 text-parchment/50 border-soil-700 hover:text-wheat-400"
            }`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span>{tb("countWarning", { count: warningCount })}</span>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter("offline")}
            className={`min-h-[48px] px-4 py-2 rounded-xl font-mono text-xs font-bold border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              statusFilter === "offline"
                ? "bg-clay-600/20 text-clay-400 border-clay-500/50 shadow-sm"
                : "bg-soil-900 text-parchment/50 border-soil-700 hover:text-clay-400"
            }`}
          >
            <WifiOff className="w-4 h-4" />
            <span>{tb("countOffline", { count: offlineCount })}</span>
          </button>
        </div>
      </div>

      {/* Full-width Sortable Node Table */}
      {nodes.loading && nodeList.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : nodeList.length === 0 ? (
        /* Empty successful response ≠ error */
        <div className="bg-soil-900 border-2 border-olive-500/40 rounded-xl p-12 text-center space-y-3">
          <Cpu className="w-10 h-10 text-parchment/30 mx-auto" />
          <h3 className="text-lg font-display font-semibold text-parchment">
            {tb("noNodesYetTitle")}
          </h3>
          <p className="text-xs font-sans text-parchment/60 max-w-sm mx-auto">
            {tb("noNodesYetSub")}
          </p>
        </div>
      ) : filteredNodes.length > 0 ? (
        <NodeTable
          nodes={filteredNodes}
          onSelectNode={(node) => setSelectedNode(node)}
          onEditNode={
            canManageHardware
              ? (node) => {
                  setEditingNode(node);
                  setIsAddModalOpen(true);
                }
              : undefined
          }
          onRemoveNode={
            canManageHardware
              ? (node) => {
                  setRemoveResult(null);
                  setPendingRemove(node);
                }
              : undefined
          }
          onReactivateNode={
            canManageHardware ? (node) => void handleReactivate(node.id) : undefined
          }
        />
      ) : (
        <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-12 text-center space-y-3">
          <Cpu className="w-10 h-10 text-parchment/30 mx-auto" />
          <h3 className="text-lg font-display font-semibold text-parchment">
            {tb("noMatchTitle")}
          </h3>
          <p className="text-xs font-sans text-parchment/60 max-w-sm mx-auto">
            {tb("noMatchSub")}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="min-h-[48px] px-4 py-2 rounded-lg bg-soil-800 text-olive-400 border border-soil-700 text-xs font-mono font-semibold"
          >
            {tb("resetFilters")}
          </button>
        </div>
      )}

      {/* Centered Node Detail Modal */}
      <NodeDetailModal
        node={selectedNode}
        isOpen={Boolean(selectedNode)}
        onClose={() => setSelectedNode(null)}
      />

      {/* Add/Edit Node Modal → POST (create) or PATCH (edit) */}
      <AddNodeModal
        isOpen={isAddModalOpen}
        mode={editingNode ? "edit" : "create"}
        initial={editingNode}
        zones={zones.data ?? []}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingNode(null);
        }}
        onSubmit={async (input) => {
          if (editingNode) {
            await handleEditSave(editingNode.id, input);
          } else {
            await handleAddNode(input);
          }
          setAddError(null);
        }}
      />

      {/* Remove confirmation — history-aware messaging on success. On failure
          (e.g. zone's last active valve) the dialog stays open with the reason
          shown inline so the 400 is never swallowed. */}
      {pendingRemove && (
        <ConfirmDialog
          isOpen
          title={tb("confirmRemoveNodeTitle")}
          message={tb("confirmRemoveNodeMsg", { name: pendingRemove.name })}
          confirmText={removeBusy ? tb("removing") : tb("removeNode")}
          cancelText={tc("cancel")}
          variant="danger"
          onConfirm={() => void handleRemoveConfirmed()}
          onCancel={() => setPendingRemove(null)}
        >
          {removeResult && !removeResult.ok && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-clay-500/10 border border-clay-500/30 text-clay-400 text-xs font-mono font-medium"
            >
              {removeResult.text}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="bg-soil-900 border-2 border-soil-700 rounded-xl p-4 flex items-center gap-4 animate-pulse motion-reduce:animate-none">
      <div className="h-9 w-9 rounded-lg bg-soil-800" />
      <div className="flex-1 space-y-2">
        <div className="h-3 w-1/3 rounded bg-soil-800" />
        <div className="h-2 w-1/5 rounded bg-soil-800" />
      </div>
      <div className="hidden md:block h-3 w-32 rounded bg-soil-800" />
      <div className="h-3 w-16 rounded bg-soil-800" />
      <div className="h-3 w-16 rounded bg-soil-800" />
    </div>
  );
}
