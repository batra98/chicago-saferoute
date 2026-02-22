"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface HeatmapPoint {
    lat: number;
    lng: number;
    weight: number;
    type: string;
}

interface CrimeHeatmapProps {
    map: mapboxgl.Map | null;
    visible: boolean;
    crimeTypeFilter?: string | null;
    categoryFilter?: string | null; // VIOLENT, PROPERTY, OTHER
    hourFilter?: number | null;
}

const SOURCE_ID = "crime-heatmap";
const LAYER_ID = "crime-heat";
const POINTS_LAYER_ID = "crime-points";

export default function CrimeHeatmap({
    map,
    visible,
    crimeTypeFilter,
    categoryFilter,
    hourFilter,
}: CrimeHeatmapProps) {
    const [loading, setLoading] = useState(false);
    const [isLayerReady, setIsLayerReady] = useState(false);
    const loadedRef = useRef(false);

    useEffect(() => {
        if (!map) return;

        const load = async () => {
            setLoading(true);
            let url = `${API_URL}/crimes/heatmap?`;
            if (crimeTypeFilter) url += `crime_type=${encodeURIComponent(crimeTypeFilter)}&`;
            if (categoryFilter) url += `category=${encodeURIComponent(categoryFilter)}&`;
            if (hourFilter !== null && hourFilter !== undefined) url += `hour=${hourFilter}`;

            try {
                const res = await fetch(url);
                const data = await res.json();
                const points: HeatmapPoint[] = data.points;

                const geojson: GeoJSON.FeatureCollection = {
                    type: "FeatureCollection",
                    features: points.map((p) => ({
                        type: "Feature",
                        properties: { weight: p.weight, type: p.type },
                        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
                    })),
                };

                const applyToMap = () => {
                    if (!map) return;
                    if (map.getSource(SOURCE_ID)) {
                        (map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource).setData(geojson);
                    } else {
                        map.addSource(SOURCE_ID, { type: "geojson", data: geojson });

                        // Heatmap layer
                        map.addLayer(
                            {
                                id: LAYER_ID,
                                type: "heatmap",
                                source: SOURCE_ID,
                                maxzoom: 15,
                                paint: {
                                    "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 10, 1.2],
                                    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3.5],
                                    "heatmap-color": [
                                        "interpolate",
                                        ["linear"],
                                        ["heatmap-density"],
                                        0, "rgba(0,0,0,0)",
                                        0.1, "rgba(52, 211, 153, 0.4)",  // Emerald/Green (Safe)
                                        0.25, "rgba(250, 204, 21, 0.6)", // Yellow (Moderate)
                                        0.5, "rgba(251, 146, 60, 0.7)",  // Orange (High Risk)
                                        0.8, "rgba(248, 113, 113, 0.8)", // Red (Severe)
                                        1, "rgba(220, 38, 38, 0.9)",     // Deep Red
                                    ],
                                    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 15, 40],
                                    "heatmap-opacity": 0.7,
                                },
                            },
                            "waterway-label"
                        );

                        // Individual points at high zoom
                        map.addLayer({
                            id: POINTS_LAYER_ID,
                            type: "circle",
                            source: SOURCE_ID,
                            minzoom: 14,
                            paint: {
                                "circle-radius": 4,
                                "circle-color": [
                                    "interpolate",
                                    ["linear"],
                                    ["get", "weight"],
                                    1, "#fde047", // Yellow (Low)
                                    3, "#f97316", // Orange (Moderate)
                                    6, "#ef4444", // Red (High)
                                    9, "#991b1b", // Deep Red (Severe)
                                ],
                                "circle-opacity": 0.75,
                                "circle-stroke-width": 1,
                                "circle-stroke-color": "rgba(255,255,255,0.3)",
                            },
                        });
                        loadedRef.current = true;
                        setIsLayerReady(true);
                    }
                };

                if (map.isStyleLoaded()) {
                    applyToMap();
                } else {
                    map.once("style.load", applyToMap);
                }
            } catch (e) {
                console.error("Heatmap fetch error:", e);
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [map, crimeTypeFilter, categoryFilter, hourFilter]);

    // Toggle visibility & Interactivity
    useEffect(() => {
        if (!map || !isLayerReady) return;
        const vis = visible ? "visible" : "none";
        if (map.getLayer(LAYER_ID)) map.setLayoutProperty(LAYER_ID, "visibility", vis);
        if (map.getLayer(POINTS_LAYER_ID)) map.setLayoutProperty(POINTS_LAYER_ID, "visibility", vis);

        // Add hover popup logic
        const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            className: "crime-hover-popup",
            offset: 10
        });

        const onMouseEnter = (e: mapboxgl.MapLayerMouseEvent) => {
            if (!visible) return;
            map.getCanvas().style.cursor = "pointer";
            const coordinates = (e.features![0].geometry as any).coordinates.slice();
            const props = e.features![0].properties;
            const type = props?.type || "Unknown";
            const weight = props?.weight || 0;
            const desc = props?.description || "";
            const block = props?.block || "";
            const date = props?.date || "";

            const content = `
                <div class="w-64 px-4 py-3 bg-[#0a0a0a]/95 text-white rounded-xl border border-white/10 shadow-2xl backdrop-blur-xl font-sans">
                    <div class="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                        <p class="text-[10px] uppercase tracking-widest font-bold text-red-400 m-0 leading-none">${type}</p>
                        <div class="bg-red-500/10 px-2 py-0.5 rounded flex gap-1 items-center">
                            <span class="text-[9px] text-red-400 font-medium tracking-wide">SEVERITY</span>
                            <span class="text-[10px] text-white font-bold leading-none">${weight}</span>
                        </div>
                    </div>
                    
                    ${desc ? `<p class="text-xs font-medium text-white/90 mb-2 leading-snug capitalize">${desc.toLowerCase()}</p>` : ''}
                    
                    <div class="space-y-1">
                        ${block ? `
                            <div class="flex items-center gap-2">
                                <svg class="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <p class="text-[10px] text-white/60 m-0 truncate uppercase tracking-wide">${block}</p>
                            </div>
                        ` : ''}
                        ${date ? `
                            <div class="flex items-center gap-2">
                                <svg class="w-3 h-3 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                <p class="text-[10px] text-white/60 m-0 tracking-wide">${date}</p>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;

            popup.setLngLat(coordinates).setHTML(content).addTo(map);
        };

        const onMouseLeave = () => {
            map.getCanvas().style.cursor = "";
            popup.remove();
        };

        map.on("mouseenter", POINTS_LAYER_ID, onMouseEnter);
        map.on("mouseleave", POINTS_LAYER_ID, onMouseLeave);

        return () => {
            map.off("mouseenter", POINTS_LAYER_ID, onMouseEnter);
            map.off("mouseleave", POINTS_LAYER_ID, onMouseLeave);
            popup.remove();
        };
    }, [map, visible, isLayerReady]);

    return null;
}
