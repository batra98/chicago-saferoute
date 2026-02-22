import React, { useEffect, useState, useCallback, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { Shield, MapPin, AlertTriangle, CheckCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface SafetyData {
    score: number;
    rating: string;
    name: string;
    incident_count: number;
}

interface SafetyWidgetProps {
    map: mapboxgl.Map | null;
}

export default function SafetyWidget({ map }: SafetyWidgetProps) {
    const [data, setData] = useState<SafetyData | null>(null);
    const [loading, setLoading] = useState(false);
    const [highlight, setHighlight] = useState(false);
    const prevNameRef = useRef<string | null>(null);

    const fetchSafety = useCallback(async () => {
        if (!map) return;
        const center = map.getCenter();
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/crimes/neighborhood?lat=${center.lat}&lng=${center.lng}`);
            if (res.ok) {
                const json = await res.json();
                if (json.name !== prevNameRef.current && prevNameRef.current !== null) {
                    setHighlight(true);
                    setTimeout(() => setHighlight(false), 1000);
                }
                prevNameRef.current = json.name;
                setData(json);
            }
        } catch (e) {
            console.error("Failed to fetch neighborhood safety:", e);
        } finally {
            setLoading(false);
        }
    }, [map]);

    useEffect(() => {
        if (!map) return;

        // Initial fetch
        fetchSafety();

        // Fetch on move end
        map.on("moveend", fetchSafety);
        return () => {
            map.off("moveend", fetchSafety);
        };
    }, [map, fetchSafety]);

    if (!data && !loading) return null;

    const getRatingColor = (rating: string) => {
        switch (rating) {
            case "Safe": return "text-emerald-400";
            case "Moderate": return "text-yellow-400";
            case "High Risk": return "text-red-400";
            default: return "text-white/60";
        }
    };

    const getRatingIcon = (rating: string) => {
        switch (rating) {
            case "Safe": return <CheckCircle className="w-3 h-3 text-emerald-400" />;
            case "Moderate": return <AlertTriangle className="w-3 h-3 text-yellow-400" />;
            case "High Risk": return <AlertTriangle className="w-3 h-3 text-red-400" />;
            default: return <Shield className="w-3 h-3 text-white/40" />;
        }
    };

    return (
        <div className={`glass rounded-xl p-4 flex flex-col gap-3 min-w-[200px] transition-all duration-500 ${highlight ? "ring-2 ring-indigo-500/50 scale-[1.02] shadow-lg shadow-indigo-500/20" : ""}`}>
            <div className={`flex items-center gap-2 transition-transform duration-300 ${highlight ? "translate-x-1" : ""}`}>
                <MapPin className={`w-3 h-3 ${highlight ? "text-indigo-300 animate-pulse" : "text-indigo-400"}`} />
                <h3 className={`text-xs font-bold transition-colors duration-300 ${highlight ? "text-indigo-300" : "text-white"} truncate max-w-[150px]`}>
                    {data?.name || "Scanning..."}
                </h3>
            </div>

            <div className="flex items-end justify-between">
                <div className="flex flex-col">
                    <span className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Safety Score</span>
                    <div className="flex items-baseline gap-1">
                        <span className={`text-2xl font-black ${data ? getRatingColor(data.rating) : "text-white/20"}`}>
                            {data?.score ?? "--"}
                        </span>
                        <span className="text-[10px] text-white/20">/100</span>
                    </div>
                </div>

                <div className="flex flex-col items-end">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        {data && getRatingIcon(data.rating)}
                        <span className={`text-[10px] font-bold uppercase tracking-tight ${data ? getRatingColor(data.rating) : "text-white/20"}`}>
                            {data?.rating || "Pending"}
                        </span>
                    </div>
                    <span className="text-[9px] text-white/20">{data?.incident_count ?? 0} local reports</span>
                </div>
            </div>

            {/* Mini Progress Bar */}
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-1000 ease-out rounded-full ${data?.rating === "Safe" ? "bg-emerald-500" :
                        data?.rating === "Moderate" ? "bg-yellow-500" :
                            "bg-red-500"
                        }`}
                    style={{ width: `${data?.score || 0}%` }}
                />
            </div>

            {loading && (
                <div className="absolute top-2 right-2">
                    <div className="w-2 h-2 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
            )}
        </div>
    );
}
