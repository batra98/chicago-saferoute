"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import mapboxgl from "mapbox-gl";
import { Shield, Eye, EyeOff, Layers } from "lucide-react";

import RoutePanel, { RouteData } from "@/components/RoutePanel";
import LocationSearch from "@/components/LocationSearch";
import DemoPresets from "@/components/DemoPresets";
import AgentNarrator from "@/components/AgentNarrator";
import CrimeHeatmap from "@/components/CrimeHeatmap";
import { MapViewHandle } from "@/components/MapView";

// Dynamically import MapView to avoid SSR issues with mapbox-gl
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ROUTE_COLORS = {
  safest: "#22c55e",
  balanced: "#f59e0b",
  fastest: "#ef4444",
};

type RouteMode = "safest" | "balanced" | "fastest";

interface RouteState {
  startLat: number; startLng: number;
  endLat: number; endLng: number;
  startLabel: string; endLabel: string;
}

export default function Home() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const mapViewRef = useRef<MapViewHandle>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [routes, setRoutes] = useState<{ safest: RouteData; balanced: RouteData; fastest: RouteData } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<RouteMode | null>(null);
  const [narratingMode, setNarratingMode] = useState<RouteMode | null>(null);
  const [heatmapVisible, setHeatmapVisible] = useState(true);
  const [flyToCoords, setFlyToCoords] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);

  // ── Load routes ──────────────────────────────────────────────────────────
  const loadRoutes = useCallback(async (rs: RouteState) => {
    setRouteState(rs);
    setRoutes(null);
    setSelectedMode(null);
    setNarratingMode(null);
    mapViewRef.current?.clearDot();
    setRouteLoading(true);

    try {
      const res = await fetch(`${API_URL}/route/compute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_lat: rs.startLat, start_lng: rs.startLng,
          end_lat: rs.endLat, end_lng: rs.endLng,
          start_label: rs.startLabel, end_label: rs.endLabel,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Route compute failed:", err);
        return;
      }
      const data = await res.json();
      setRoutes(data);
      setSelectedMode("safest");

      // Fly to show the route
      const midLat = (rs.startLat + rs.endLat) / 2;
      const midLng = (rs.startLng + rs.endLng) / 2;
      setFlyToCoords({ lat: midLat, lng: midLng, zoom: 13 });
    } catch (e) {
      console.error("Route compute error:", e);
    } finally {
      setRouteLoading(false);
    }
  }, []);

  // ── Build route layers for map ────────────────────────────────────────────
  const routeLayers =
    routes && selectedMode && routes.safest && routes.balanced && routes.fastest
      ? (["fastest", "balanced", "safest"] as RouteMode[]).map((mode) => ({
        id: `route-${mode}`,
        coords: routes[mode].coords ?? [],
        color: ROUTE_COLORS[mode],
        opacity: mode === selectedMode ? 0.95 : 0.2,
        width: mode === selectedMode ? 5 : 3,
        isSelected: mode === selectedMode,
      }))
      : [];

  return (
    <main className="relative w-screen h-screen overflow-hidden">
      {/* Map fills the screen */}
      <MapView
        ref={mapViewRef}
        onMapReady={setMap}
        routes={routeLayers}
        startCoords={routeState ? { lat: routeState.startLat, lng: routeState.startLng } : null}
        endCoords={routeState ? { lat: routeState.endLat, lng: routeState.endLng } : null}
        flyToCoords={flyToCoords}
      />

      {/* Crime Heatmap layer */}
      <CrimeHeatmap map={map} visible={heatmapVisible} />

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-10">
        {/* Logo */}
        <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-2 pointer-events-auto">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-none">SafeRoute</p>
            <p className="text-[10px] text-white/40 leading-none">Chicago</p>
          </div>
        </div>

        {/* Live stats */}
        <div className="glass rounded-xl px-4 py-2 flex items-center gap-4 pointer-events-auto">
          <div className="text-center">
            <p className="text-xs font-bold text-white">229,153</p>
            <p className="text-[10px] text-white/40">crime incidents</p>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="text-center">
            <p className="text-xs font-bold text-white">12 months</p>
            <p className="text-[10px] text-white/40">data range</p>
          </div>
          <div className="w-px h-6 bg-white/10" />
          <div className="text-center">
            <p className="text-xs font-bold text-white">29,478</p>
            <p className="text-[10px] text-white/40">road nodes</p>
          </div>
        </div>

        {/* Heatmap toggle */}
        <button
          onClick={() => setHeatmapVisible((v) => !v)}
          className={`glass rounded-xl px-3 py-2 flex items-center gap-2 text-xs pointer-events-auto transition-all ${heatmapVisible ? "text-white" : "text-white/40"
            }`}
        >
          <Layers className="w-4 h-4" />
          {heatmapVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          Heatmap
        </button>
      </div>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div className="absolute left-4 top-20 bottom-4 w-80 flex flex-col gap-3 z-10">
        <LocationSearch onSearch={loadRoutes} />
        <DemoPresets onLoad={(p) => loadRoutes({
          startLat: p.startLat, startLng: p.startLng,
          endLat: p.endLat, endLng: p.endLng,
          startLabel: p.startLabel, endLabel: p.endLabel,
        })} />
        {(routes || routeLoading) && (
          <RoutePanel
            routes={routes}
            loading={routeLoading}
            selectedMode={selectedMode}
            onSelect={setSelectedMode}
            onNarrate={(mode) => setNarratingMode(mode)}
          />
        )}
      </div>

      {/* ── Right sidebar — Agent Narrator ────────────────────────────────── */}
      {narratingMode && routeState && (
        <div className="absolute right-4 top-20 bottom-4 w-[360px] z-10">
          <AgentNarrator
            startLat={routeState.startLat}
            startLng={routeState.startLng}
            endLat={routeState.endLat}
            endLng={routeState.endLng}
            startLabel={routeState.startLabel}
            endLabel={routeState.endLabel}
            mode={narratingMode}
            active={true}
            mapRef={mapViewRef}
            onDone={() => { }}
          />
        </div>
      )}
    </main>
  );
}
