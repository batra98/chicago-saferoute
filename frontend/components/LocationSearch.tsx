"use client";

import { useState } from "react";
import { MapPin, Navigation, ArrowRight } from "lucide-react";
import dynamic from "next/dynamic";

const SearchBox = dynamic(
    () => import("@mapbox/search-js-react").then((mod) => mod.SearchBox),
    { ssr: false, loading: () => <div className="animate-pulse bg-white/5 h-10 rounded-xl w-full" /> }
);

interface LocationSearchProps {
    onSearch: (params: {
        startLat: number; startLng: number;
        endLat: number; endLng: number;
        startLabel: string; endLabel: string;
    }) => void;
}

interface LocationData {
    lat: number;
    lng: number;
    label: string;
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export default function LocationSearch({ onSearch }: LocationSearchProps) {
    const [startLoc, setStartLoc] = useState<LocationData | null>(null);
    const [endLoc, setEndLoc] = useState<LocationData | null>(null);
    const [error, setError] = useState("");

    const handleSearch = () => {
        if (!startLoc) { setError("Please search and select a starting location."); return; }
        if (!endLoc) { setError("Please search and select a destination."); return; }
        setError("");
        onSearch({
            startLat: startLoc.lat, startLng: startLoc.lng,
            endLat: endLoc.lat, endLng: endLoc.lng,
            startLabel: startLoc.label, endLabel: endLoc.label
        });
    };

    return (
        <div className="glass rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Plan Your Route</p>

            <div className="space-y-4">
                {/* START BOX */}
                <div className="flex items-start gap-2">
                    <MapPin className="w-5 h-5 text-green-400 shrink-0 mt-2" />
                    <div className="flex-1 min-w-0" style={{ filter: "invert(0.9) hue-rotate(180deg)" }}>
                        {/* Mapbox Searchbox is natively light-themed. A fast dark-mode hack is inverting it */}
                        {MAPBOX_TOKEN && (
                            <SearchBox
                                accessToken={MAPBOX_TOKEN}
                                options={{
                                    proximity: [-87.6298, 41.8781], // Bias to Chicago
                                    language: "en"
                                }}
                                onRetrieve={(res) => {
                                    const feat = res.features[0];
                                    if (feat) {
                                        setStartLoc({
                                            lng: feat.geometry.coordinates[0],
                                            lat: feat.geometry.coordinates[1],
                                            label: feat.properties.name || feat.properties.full_address || "Start Location"
                                        });
                                    }
                                }}
                            />
                        )}
                    </div>
                </div>

                {/* END BOX */}
                <div className="flex items-start gap-2">
                    <Navigation className="w-5 h-5 text-red-400 shrink-0 mt-2" />
                    <div className="flex-1 min-w-0" style={{ filter: "invert(0.9) hue-rotate(180deg)" }}>
                        {MAPBOX_TOKEN && (
                            <SearchBox
                                accessToken={MAPBOX_TOKEN}
                                options={{
                                    proximity: [-87.6298, 41.8781], // Bias to Chicago
                                    language: "en"
                                }}
                                onRetrieve={(res) => {
                                    const feat = res.features[0];
                                    if (feat) {
                                        setEndLoc({
                                            lng: feat.geometry.coordinates[0],
                                            lat: feat.geometry.coordinates[1],
                                            label: feat.properties.name || feat.properties.full_address || "Destination"
                                        });
                                    }
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>

            {error && <p className="text-xs text-amber-400/80">{error}</p>}

            <button
                onClick={handleSearch}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors"
            >
                Find Safe Routes
                <ArrowRight className="w-4 h-4" />
            </button>
        </div>
    );
}
