"use client";

import { useState } from "react";
import { MapPin, Navigation, ArrowRight } from "lucide-react";

interface LocationSearchProps {
    onSearch: (params: {
        startLat: number; startLng: number;
        endLat: number; endLng: number;
        startLabel: string; endLabel: string;
    }) => void;
}

// Hardcoded geocoding for demo — these are the preset demo addresses
// In production you'd call Mapbox Geocoding API
const KNOWN_PLACES: Record<string, { lat: number; lng: number; label: string }> = {
    "union station": { lat: 41.8789, lng: -87.6398, label: "Union Station" },
    "navy pier": { lat: 41.8919, lng: -87.6051, label: "Navy Pier" },
    "wicker park": { lat: 41.9097, lng: -87.6773, label: "Wicker Park Blue Line" },
    "uic": { lat: 41.8710, lng: -87.6500, label: "UIC–Halsted Station" },
    "millennium park": { lat: 41.8827, lng: -87.6233, label: "Millennium Park" },
    "o'hare": { lat: 41.9742, lng: -87.9073, label: "O'Hare Airport" },
    "midway": { lat: 41.7868, lng: -87.7522, label: "Midway Airport" },
    "the loop": { lat: 41.8827, lng: -87.6278, label: "The Loop" },
    "wrigley field": { lat: 41.9484, lng: -87.6553, label: "Wrigley Field" },
    "grant park": { lat: 41.8708, lng: -87.6190, label: "Grant Park" },
};

function geocode(query: string): { lat: number; lng: number; label: string } | null {
    const q = query.toLowerCase().trim();
    for (const [key, val] of Object.entries(KNOWN_PLACES)) {
        if (q.includes(key)) return val;
    }
    return null;
}

export default function LocationSearch({ onSearch }: LocationSearchProps) {
    const [startQuery, setStartQuery] = useState("");
    const [endQuery, setEndQuery] = useState("");
    const [error, setError] = useState("");

    const handleSearch = () => {
        const start = geocode(startQuery);
        const end = geocode(endQuery);
        if (!start) { setError(`Couldn't find "${startQuery}". Try: Union Station, Navy Pier, Wicker Park, UIC, Millennium Park...`); return; }
        if (!end) { setError(`Couldn't find "${endQuery}". Try: Union Station, Navy Pier, Wicker Park, UIC, Millennium Park...`); return; }
        setError("");
        onSearch({ startLat: start.lat, startLng: start.lng, endLat: end.lat, endLng: end.lng, startLabel: start.label, endLabel: end.label });
    };

    return (
        <div className="glass rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Plan Your Route</p>

            <div className="space-y-2">
                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <MapPin className="w-4 h-4 text-green-400 shrink-0" />
                    <input
                        className="bg-transparent text-sm text-white placeholder-white/30 outline-none w-full"
                        placeholder="Start — e.g. Union Station"
                        value={startQuery}
                        onChange={(e) => setStartQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                </div>

                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <Navigation className="w-4 h-4 text-red-400 shrink-0" />
                    <input
                        className="bg-transparent text-sm text-white placeholder-white/30 outline-none w-full"
                        placeholder="End — e.g. Navy Pier"
                        value={endQuery}
                        onChange={(e) => setEndQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                </div>
            </div>

            {error && <p className="text-xs text-amber-400/80">{error}</p>}

            <button
                onClick={handleSearch}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors"
            >
                Find Safe Routes
                <ArrowRight className="w-4 h-4" />
            </button>
        </div>
    );
}
