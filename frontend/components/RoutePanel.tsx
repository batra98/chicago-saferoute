"use client";

import { Shield, Zap, Scale, ChevronRight, Clock, Route, AlertCircle } from "lucide-react";

export interface RouteData {
    mode: string;
    coords: { lat: number; lng: number; crime_score_norm?: number }[];
    distance_km: number;
    travel_time_min: number;
    crime_score: number;
    crime_count: number;
}

interface RoutePanelProps {
    routes: { safest: RouteData; balanced: RouteData; fastest: RouteData } | null;
    loading: boolean;
    selectedMode: "safest" | "balanced" | "fastest" | null;
    onSelect: (mode: "safest" | "balanced" | "fastest") => void;
    onNarrate: (mode: "safest" | "balanced" | "fastest") => void;
}

const MODE_CONFIG = {
    safest: {
        label: "Safest Route",
        icon: Shield,
        color: "text-green-400",
        border: "border-green-500/40",
        bg: "bg-green-500/10",
        dot: "bg-green-400",
        line: "#22c55e",
    },
    balanced: {
        label: "Balanced Route",
        icon: Scale,
        color: "text-amber-400",
        border: "border-amber-500/40",
        bg: "bg-amber-500/10",
        dot: "bg-amber-400",
        line: "#f59e0b",
    },
    fastest: {
        label: "Fastest Route",
        icon: Zap,
        color: "text-red-400",
        border: "border-red-500/40",
        bg: "bg-red-500/10",
        dot: "bg-red-400",
        line: "#ef4444",
    },
};

function RouteCard({
    mode,
    data,
    selected,
    onSelect,
    onNarrate,
}: {
    mode: "safest" | "balanced" | "fastest";
    data: RouteData;
    selected: boolean;
    onSelect: () => void;
    onNarrate: () => void;
}) {
    const cfg = MODE_CONFIG[mode];
    const Icon = cfg.icon;
    const maxCrime = 500; // rough scale
    const crimeBarPct = Math.min(100, ((data?.crime_score ?? 0) / maxCrime) * 100);

    return (
        <div
            onClick={onSelect}
            className={`rounded-xl border p-3 cursor-pointer transition-all duration-200 ${selected
                ? `${cfg.border} ${cfg.bg}`
                : "border-white/8 hover:border-white/15 hover:bg-white/4"
                }`}
        >
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                </div>
                {selected && <Icon className={`w-4 h-4 ${cfg.color}`} />}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-white/60 mb-3">
                <div className="flex items-center gap-1">
                    <Route className="w-3 h-3" />
                    <span>{data.distance_km} km</span>
                </div>
                <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{data.travel_time_min} min</span>
                </div>
                <div className="flex items-center gap-1 col-span-2">
                    <AlertCircle className="w-3 h-3" />
                    <span>{data.crime_count} incidents along path</span>
                </div>
            </div>

            {/* Crime exposure bar */}
            <div className="mb-3">
                <div className="flex justify-between text-xs text-white/40 mb-1">
                    <span>Crime exposure</span>
                    <span>{Math.round(data.crime_score)}</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${crimeBarPct}%`,
                            background: `linear-gradient(90deg, ${cfg.line}88, ${cfg.line})`,
                        }}
                    />
                </div>
            </div>

            {selected && (
                <button
                    onClick={(e) => { e.stopPropagation(); onNarrate(); }}
                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all
            ${cfg.bg} ${cfg.color} border ${cfg.border} hover:brightness-125`}
                >
                    <Icon className="w-3 h-3" />
                    Narrate with AI Agent
                    <ChevronRight className="w-3 h-3" />
                </button>
            )}
        </div>
    );
}

export default function RoutePanel({ routes, loading, selectedMode, onSelect, onNarrate }: RoutePanelProps) {
    if (loading) {
        return (
            <div className="glass rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-2 h-2 rounded-full bg-indigo-400 spinner" />
                    <span className="text-sm text-white/60">Computing routes...</span>
                </div>
                {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-xl border border-white/8 p-3 mb-2 animate-pulse">
                        <div className="h-4 bg-white/10 rounded w-1/2 mb-2" />
                        <div className="h-3 bg-white/5 rounded w-3/4" />
                    </div>
                ))}
            </div>
        );
    }

    if (!routes) return null;

    return (
        <div className="glass rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Route Options</p>
            {(["safest", "balanced", "fastest"] as const).map((mode) => (
                <RouteCard
                    key={mode}
                    mode={mode}
                    data={routes[mode]}
                    selected={selectedMode === mode}
                    onSelect={() => onSelect(mode)}
                    onNarrate={() => onNarrate(mode)}
                />
            ))}
        </div>
    );
}
