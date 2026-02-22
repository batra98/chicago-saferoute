"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import mapboxgl from "mapbox-gl";
import { Shield, Eye, EyeOff, Layers } from "lucide-react";

import LocationSearch from "@/components/LocationSearch";
import DemoPresets from "@/components/DemoPresets";
import AgentNarrator from "@/components/AgentNarrator";
import CrimeHeatmap from "@/components/CrimeHeatmap";
import CrimeFilterToggles from "@/components/CrimeFilterToggles";
import SafetyWidget from "@/components/SafetyWidget";
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

interface RouteData {
  mode: RouteMode;
  coords: { lat: number; lng: number }[];
  shortest_coords?: { lat: number; lng: number }[];
  distance_m: number;
  travel_time_min: number;
  crime_score: number;
  comparison?: {
    extra_distance_m: number;
    extra_time_min: number;
    crimes_avoided_score: number;
    shortest_distance_m: number;
  };
}

interface RouteState {
  startLat: number; startLng: number;
  endLat: number; endLng: number;
  startLabel: string; endLabel: string;
}

export default function Home() {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const mapViewRef = useRef<MapViewHandle>(null);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [narratingMode, setNarratingMode] = useState<RouteMode | null>(null);
  const [heatmapVisible, setHeatmapVisible] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>("VIOLENT");
  const [selectedHour, setSelectedHour] = useState<number | null>(9);
  const [flyToCoords, setFlyToCoords] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [routeCompleted, setRouteCompleted] = useState(false);

  // ── Load routes ──────────────────────────────────────────────────────────
  const loadRoutes = useCallback(async (rs: RouteState) => {
    setRouteState(rs);
    setRoute(null);
    setNarratingMode(null);
    setRouteCompleted(false);
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
          category: selectedCategory,
          hour: selectedHour
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("Route compute failed:", err);
        return;
      }
      const data = await res.json();
      setRoute(data);
      // Auto-start the narration immediately
      setNarratingMode("safest");

      // Fly to show the route
      const midLat = (rs.startLat + rs.endLat) / 2;
      const midLng = (rs.startLng + rs.endLng) / 2;
      setFlyToCoords({ lat: midLat, lng: midLng, zoom: 13 });
    } catch (e) {
      console.error("Route compute error:", e);
    } finally {
      setRouteLoading(false);
    }
  }, [selectedCategory, selectedHour]);

  // ── Build route layers for map ────────────────────────────────────────────
  const routeLayers = useMemo(() => {
    return route
      ? [
        {
          id: `route-shortest`,
          coords: route.shortest_coords ?? [],
          color: "#94a3b8",
          opacity: 0.4, // Managed imperatively by MapView via setRouteCompleted
          width: 2,
          dashArray: undefined, // Solid
        },
        {
          id: `route-safest`,
          coords: route.coords ?? [],
          color: ROUTE_COLORS.safest,
          opacity: 1.0,
          width: 5, // Managed imperatively by MapView
          isSelected: true, // MUST remain true to retain the animated drawing capability
          dashArray: [2, 1], // Managed imperatively by MapView
        }
      ]
      : [];
  }, [route]);

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
      <CrimeHeatmap
        map={map}
        visible={heatmapVisible}
        categoryFilter={selectedCategory}
        hourFilter={selectedHour}
      />

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

        <CrimeFilterToggles
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
        />

        <SafetyWidget map={map} />

        {routeLoading && (
          <div className="glass rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-white/70">
            <div className="spinner w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full" />
            <p className="text-sm">Mapping safest traversal...</p>
          </div>
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
            category={selectedCategory}
            hour={selectedHour}
            mapRef={mapViewRef}
            active={!!narratingMode}
            onDone={() => {
              setRouteCompleted(true);
              mapViewRef.current?.setRouteCompleted(true);
            }}
            onClose={() => setNarratingMode(null)}
          />
        </div>
      )}

      {/* ── Bottom Controls: Time-of-Day Slider ────────────────────────────── */}
      {heatmapVisible && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[400px] z-10">
          <div className="glass rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Temporal Analysis</span>
              <span className="text-xs font-mono text-indigo-400">
                {selectedHour !== null ? `${selectedHour % 12 || 12}:00 ${selectedHour < 12 ? 'AM' : 'PM'}` : 'All Day'}
              </span>
            </div>

            <input
              type="range"
              min="0"
              max="23"
              value={selectedHour ?? 9}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setSelectedHour(val);
              }}
              className="w-full accent-indigo-500 bg-white/10 h-1.5 rounded-lg appearance-none cursor-pointer"
            />

            <div className="flex justify-between text-[9px] text-white/20 font-medium px-1">
              <span>Midnight</span>
              <span>Noon</span>
              <span>Night</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
