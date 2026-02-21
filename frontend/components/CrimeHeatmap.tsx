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
    hourFilter?: number | null;
}

const SOURCE_ID = "crime-heatmap";
const LAYER_ID = "crime-heat";
const POINTS_LAYER_ID = "crime-points";

export default function CrimeHeatmap({
    map,
    visible,
    crimeTypeFilter,
    hourFilter,
}: CrimeHeatmapProps) {
    const [loading, setLoading] = useState(false);
    const loadedRef = useRef(false);

    useEffect(() => {
        if (!map) return;

        const load = async () => {
            setLoading(true);
            let url = `${API_URL}/crimes/heatmap?`;
            if (crimeTypeFilter) url += `crime_type=${encodeURIComponent(crimeTypeFilter)}&`;
            if (hourFilter !== null && hourFilter !== undefined) url += `hour=${hourFilter}`;

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
                            "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 10, 1],
                            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
                            "heatmap-color": [
                                "interpolate",
                                ["linear"],
                                ["heatmap-density"],
                                0, "rgba(0,0,0,0)",
                                0.1, "rgba(80,20,120,0.6)",
                                0.3, "rgba(140,40,180,0.7)",
                                0.5, "rgba(220,80,40,0.8)",
                                0.8, "rgba(255,140,0,0.9)",
                                1, "rgba(255,60,20,1)",
                            ],
                            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 4, 15, 20],
                            "heatmap-opacity": 0.85,
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
                            "match",
                            ["get", "type"],
                            "HOMICIDE", "#ef4444",
                            "ASSAULT", "#f97316",
                            "ROBBERY", "#f59e0b",
                            "BATTERY", "#fb923c",
                            "THEFT", "#3b82f6",
                            "#9ca3af",
                        ],
                        "circle-opacity": 0.75,
                        "circle-stroke-width": 1,
                        "circle-stroke-color": "rgba(255,255,255,0.3)",
                    },
                });
                loadedRef.current = true;
            }
            setLoading(false);
        };

        const onLoad = () => load();
        if (map.isStyleLoaded()) {
            load();
        } else {
            map.on("load", onLoad);
            return () => { map.off("load", onLoad); };
        }
    }, [map, crimeTypeFilter, hourFilter]);

    // Toggle visibility
    useEffect(() => {
        if (!map || !loadedRef.current) return;
        const vis = visible ? "visible" : "none";
        if (map.getLayer(LAYER_ID)) map.setLayoutProperty(LAYER_ID, "visibility", vis);
        if (map.getLayer(POINTS_LAYER_ID)) map.setLayoutProperty(POINTS_LAYER_ID, "visibility", vis);
    }, [map, visible]);

    return null;
}
