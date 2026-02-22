"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;
mapboxgl.accessToken = MAPBOX_TOKEN;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface RouteCoord {
    lat: number;
    lng: number;
    crime_score_norm?: number;  // 0–1, for gradient coloring
}

interface RouteLayer {
    id: string;
    coords: RouteCoord[];
    color: string;       // base color for non-selected routes
    opacity?: number;
    width?: number;
    isSelected?: boolean; // true = render gradient, animate draw
}

export interface PulseMarkerData {
    lat: number;
    lng: number;
    type: string;
    date?: string;
}

export interface MapViewHandle {
    animateTo: (toAndPath: { lat: number; lng: number; path?: { lat: number; lng: number }[] }, durationMs?: number) => Promise<void>;
    clearDot: () => void;
    flyTo: (coords: { lat: number; lng: number; zoom?: number }) => void;
    setPulseMarkers: (incidents: PulseMarkerData[]) => void;
    setTurnArrow: (coords: { lat: number; lng: number } | null, bearing?: number) => void;
    setAlternativeLines: (alternatives: { to_coords: { lat: number; lng: number }, from_coords: { lat: number; lng: number } }[]) => void;
}

interface MapViewProps {
    onMapReady?: (map: mapboxgl.Map) => void;
    routes?: RouteLayer[];
    startCoords?: { lat: number; lng: number } | null;
    endCoords?: { lat: number; lng: number } | null;
    flyToCoords?: { lat: number; lng: number; zoom?: number } | null;
}

const CHICAGO_CENTER: [number, number] = [-87.6298, 41.8781];

// ── Bearing helper (degrees) ──────────────────────────────────────────────────
function getBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLng = toRad(to.lng - from.lng);
    const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
    const x =
        Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
        Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
    return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

// ── Color helper: crime_score_norm → hex ──────────────────────────────────────
function crimeColor(norm: number): string {
    // green (0) → yellow (0.5) → red (1)
    const r = Math.round(norm < 0.5 ? norm * 2 * (239 - 34) + 34 : 239);
    const g = Math.round(norm < 0.5 ? 197 : (1 - norm) * 2 * (197 - 68) + 68);
    const b = Math.round(norm < 0.5 ? 68 : 68);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
    { onMapReady, routes = [], startCoords, endCoords, flyToCoords },
    ref
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<mapboxgl.Marker[]>([]);
    const agentMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const turnArrowMarkerRef = useRef<mapboxgl.Marker | null>(null);
    const pulseMarkersRef = useRef<mapboxgl.Marker[]>([]);
    const animFrameRef = useRef<number | null>(null);
    const currentPos = useRef<{ lng: number; lat: number } | null>(null);
    const drawAnimRef = useRef<number | null>(null);
    const drawnFeaturesRef = useRef<GeoJSON.Feature<GeoJSON.LineString>[]>([]);

    // Reset drawn features when routes change
    useEffect(() => {
        drawnFeaturesRef.current = [];
        const map = mapRef.current;
        const routeSourceId = "route-safest";
        if (map && map.getSource(routeSourceId)) {
            (map.getSource(routeSourceId) as mapboxgl.GeoJSONSource).setData({
                type: "FeatureCollection",
                features: [],
            });
        }
    }, [routes]);

    // ── Imperative handle ────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
        setAlternativeLines(alternatives) {
            const map = mapRef.current;
            if (!map) return;
            const sourceId = "route-alternatives";
            let source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
            if (!source) {
                map.addSource(sourceId, {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] }
                });
                map.addLayer({
                    id: sourceId,
                    type: "line",
                    source: sourceId,
                    paint: {
                        "line-color": "#ffffff",
                        "line-width": 3,
                        "line-dasharray": [2, 2],
                        "line-opacity": 0.3
                    }
                }, "route-safest-glow");
                source = map.getSource(sourceId) as mapboxgl.GeoJSONSource;
            }
            const features: any[] = alternatives.map(alt => ({
                type: "Feature" as const,
                properties: {},
                geometry: {
                    type: "LineString" as const,
                    coordinates: [
                        [alt.from_coords.lng, alt.from_coords.lat],
                        [alt.to_coords.lng, alt.to_coords.lat]
                    ]
                }
            }));
            source.setData({ type: "FeatureCollection", features });
        },

        setTurnArrow(coords, bearing = 0) {
            const map = mapRef.current;
            if (!map) return;
            if (!coords) {
                turnArrowMarkerRef.current?.remove();
                turnArrowMarkerRef.current = null;
                return;
            }
            if (!turnArrowMarkerRef.current) {
                const el = document.createElement("div");
                el.className = "turn-arrow-container flex items-center justify-center pointer-events-none";
                el.innerHTML = `
                    <div class="animate-bounce-sideways">
                        <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="#6366f1" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.9))">
                            <line x1="12" y1="19" x2="12" y2="5"></line>
                            <polyline points="5 12 12 5 19 12"></polyline>
                        </svg>
                    </div>
                `;
                turnArrowMarkerRef.current = new mapboxgl.Marker({ element: el, rotationAlignment: 'map' })
                    .setLngLat([coords.lng, coords.lat])
                    .addTo(map);
            } else {
                turnArrowMarkerRef.current.setLngLat([coords.lng, coords.lat]);
            }
            turnArrowMarkerRef.current.setRotation(bearing);
        },

        setPulseMarkers(incidents) {
            // Pulse markers have been removed to prioritize path and heatmap clarity.
            const map = mapRef.current;
            if (!map) return;
            pulseMarkersRef.current.forEach(m => m.remove());
            pulseMarkersRef.current = [];
        },

        animateTo(toAndPath, durationMs = 1200): Promise<void> {
            return new Promise<void>((resolve) => {
                const map = mapRef.current;
                const to = toAndPath;
                if (!map || typeof to?.lat !== "number" || isNaN(to.lat)) { resolve(); return; }

                // Create dot on first call
                if (!agentMarkerRef.current) {
                    const el = document.createElement("div");
                    el.className = "glow-dot w-5 h-5 rounded-full bg-indigo-500 border-2 border-white transition-all duration-300";
                    agentMarkerRef.current = new mapboxgl.Marker({ element: el })
                        .setLngLat([to.lng, to.lat])
                        .addTo(map);
                    currentPos.current = { lng: to.lng, lat: to.lat };

                    // Center and zoom immediately on first call
                    map.flyTo({
                        center: [to.lng, to.lat],
                        zoom: 15.5,
                        pitch: 55,
                        bearing: 0,
                        duration: 1200
                    });

                    resolve();
                    return;
                }

                const from = currentPos.current ?? { lng: to.lng, lat: to.lat };

                // If we have a polyline path, we animate along it. Otherwise just straight line.
                // We always ensure the path starts exactly where the dot is currently, 
                // and ends exactly at the requested destination.
                const path: { lat: number, lng: number }[] = (toAndPath as { path?: { lat: number, lng: number }[] }).path ?? [from, to];

                // Calculate cumulative distances along the path
                const dists = [0];
                for (let i = 1; i < path.length; i++) {
                    const p1 = path[i - 1];
                    const p2 = path[i];
                    const dx = p2.lng - p1.lng;
                    const dy = p2.lat - p1.lat;
                    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy));
                }
                const totalDist = dists[dists.length - 1];

                const startZoom = map.getZoom();
                const targetZoom = 15.5;
                const startPitch = map.getPitch();
                const targetPitch = 55;

                let lastBearing = map.getBearing();

                // ── Unified Animation (RAF) ──────────────────────────────────
                const start = performance.now();
                if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

                // For the trailer effect: grab the current route source if it exists
                const routeSourceId = "route-safest";
                const source = map.getSource(routeSourceId) as mapboxgl.GeoJSONSource | undefined;

                // Set moving appearance (arrowhead)
                const markerEl = agentMarkerRef.current?.getElement();
                if (markerEl) {
                    markerEl.classList.remove("rounded-full", "glow-dot");
                    markerEl.style.borderRadius = "0";
                    markerEl.style.background = "transparent";
                    markerEl.style.border = "none";
                    markerEl.style.animation = "none";
                    markerEl.innerHTML = `
                        <svg viewBox="0 0 24 24" width="24" height="24" fill="#6366f1" style="filter: drop-shadow(0 0 4px rgba(99, 102, 241, 0.8))">
                            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
                        </svg>
                    `;
                }

                const step = (now: number) => {
                    const t = Math.min((now - start) / durationMs, 1);
                    const ease = t; // Linear speed

                    // 1. Interpolate Dot Position along the polyline
                    const targetDist = totalDist * ease;
                    let lng = to.lng, lat = to.lat, segmentBearing = lastBearing;
                    let currentIndex = path.length - 1;

                    if (totalDist > 0) {
                        for (let i = 1; i < path.length; i++) {
                            if (targetDist <= dists[i] || i === path.length - 1) {
                                currentIndex = i;
                                const segmentDist = dists[i] - dists[i - 1];
                                const segmentT = segmentDist === 0 ? 1 : (targetDist - dists[i - 1]) / segmentDist;
                                const p1 = path[i - 1];
                                const p2 = path[i];
                                lng = p1.lng + (p2.lng - p1.lng) * segmentT;
                                lat = p1.lat + (p2.lat - p1.lat) * segmentT;

                                // Face the direction of this specific sub-segment
                                if (segmentDist > 0.000001) {
                                    segmentBearing = getBearing(p1, p2);
                                }
                                break;
                            }
                        }
                    }

                    agentMarkerRef.current?.setLngLat([lng, lat]);
                    currentPos.current = { lng, lat };

                    // 1.b Trailer line drawing
                    // We combine the history of drawn segments with the current active segment slice
                    if (source) {
                        const currentPathCoords = path.slice(0, currentIndex);
                        currentPathCoords.push({ lat, lng });

                        const activeFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
                        for (let i = 0; i < currentPathCoords.length - 1; i++) {
                            const p1 = currentPathCoords[i];
                            const p2 = currentPathCoords[i + 1];
                            activeFeatures.push({
                                type: "Feature",
                                properties: { crime_score_norm: (path as any)[i]?.crime_score_norm ?? 0 },
                                geometry: { type: "LineString", coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]] },
                            });
                        }
                        source.setData({ type: "FeatureCollection", features: [...drawnFeaturesRef.current, ...activeFeatures] });
                    }

                    // 2. Interpolate Camera
                    // Shortest-path angular interpolation for the bearing shift
                    const normTarget = ((segmentBearing % 360) + 360) % 360;
                    const normCurrent = ((lastBearing % 360) + 360) % 360;
                    let deltaBearing = normTarget - normCurrent;
                    if (deltaBearing > 180) deltaBearing -= 360;
                    if (deltaBearing < -180) deltaBearing += 360;

                    // Smooth the camera turning slightly so it doesn't instantly snap on curve vertices
                    lastBearing = lastBearing + deltaBearing * 0.15;

                    // Rotate arrowhead marker
                    if (agentMarkerRef.current) {
                        agentMarkerRef.current.setRotation(segmentBearing);
                        agentMarkerRef.current.setRotationAlignment('map');
                    }

                    const currentZoom = startZoom + (targetZoom - startZoom) * ease;
                    const currentPitch = startPitch + (targetPitch - startPitch) * ease;

                    // 3. Jump Camera
                    map.jumpTo({
                        center: [lng, lat],
                        bearing: lastBearing,
                        zoom: currentZoom,
                        pitch: currentPitch,
                    });

                    if (t < 1) {
                        animFrameRef.current = requestAnimationFrame(step);
                    } else {
                        // Animation finished for this entire path array. Commit it to permanent draw history.
                        if (source && path.length > 1) {
                            const finalSegmentFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
                            for (let i = 0; i < path.length - 1; i++) {
                                const p1 = path[i];
                                const p2 = path[i + 1];
                                finalSegmentFeatures.push({
                                    type: "Feature",
                                    properties: { crime_score_norm: (path as any)[i]?.crime_score_norm ?? 0 },
                                    geometry: { type: "LineString", coordinates: [[p1.lng, p1.lat], [p2.lng, p2.lat]] },
                                });
                            }
                            drawnFeaturesRef.current.push(...finalSegmentFeatures);
                            source.setData({ type: "FeatureCollection", features: drawnFeaturesRef.current });
                        }

                        // Revert to dot when stopped
                        if (markerEl) {
                            markerEl.innerHTML = "";
                            markerEl.className = "glow-dot w-5 h-5 rounded-full bg-indigo-500 border-2 border-white transition-all duration-300";
                            markerEl.style.background = "";
                            markerEl.style.border = "";
                        }

                        resolve();
                    }
                };
                animFrameRef.current = requestAnimationFrame(step);
            });
        },

        clearDot() {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            agentMarkerRef.current?.remove();
            agentMarkerRef.current = null;
            currentPos.current = null;

            pulseMarkersRef.current.forEach(m => m.remove());
            pulseMarkersRef.current = [];

            turnArrowMarkerRef.current?.remove();
            turnArrowMarkerRef.current = null;

            // Restore default camera
            mapRef.current?.easeTo({ pitch: 30, bearing: -10, zoom: 13, duration: 1500 });
        },

        flyTo(coords) {
            mapRef.current?.flyTo({ center: [coords.lng, coords.lat], zoom: coords.zoom ?? 13, speed: 1.4, curve: 1.2 });
        },
    }), []);

    // ── Dot cleanup in clearDot ──────────────────────────────────────────────
    useEffect(() => {
        return () => {
            if (turnArrowMarkerRef.current) turnArrowMarkerRef.current.remove();
        };
    }, []);

    // ── Initialize map ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;
        const map = new mapboxgl.Map({
            container: containerRef.current,
            style: "mapbox://styles/mapbox/dark-v11",
            center: CHICAGO_CENTER,
            zoom: 12,
            pitch: 30,
            bearing: -10,
            antialias: true,
        });

        map.on("load", () => {
            mapRef.current = map;

            // Atmospheric fog
            map.setFog({
                color: "rgb(8, 8, 20)",
                "high-color": "rgb(20, 20, 50)",
                "horizon-blend": 0.05,
                "space-color": "rgb(5, 5, 15)",
                "star-intensity": 0.4,
            });

            // 3D buildings
            const layers = map.getStyle().layers;
            const labelLayer = layers?.find(
                (l) => l.type === "symbol" && (l.layout as Record<string, unknown>)?.["text-field"]
            );
            map.addLayer(
                {
                    id: "3d-buildings",
                    source: "composite",
                    "source-layer": "building",
                    filter: ["==", "extrude", "true"],
                    type: "fill-extrusion",
                    minzoom: 13,
                    paint: {
                        "fill-extrusion-color": "#1a1a2e",
                        "fill-extrusion-height": ["get", "height"],
                        "fill-extrusion-base": ["get", "min_height"],
                        "fill-extrusion-opacity": 0.75,
                    },
                },
                labelLayer?.id
            );

            onMapReady?.(map);
        });

        return () => { map.remove(); mapRef.current = null; };
    }, [onMapReady]);

    // ── Draw route layers ────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        // Remove old layers/sources
        const style = map.getStyle();
        (style.layers ?? [])
            .filter((l) => l.id.startsWith("route-"))
            .forEach((l) => { try { map.removeLayer(l.id); } catch (_) { } });
        Object.keys(style.sources ?? {})
            .filter((s) => s.startsWith("route-"))
            .forEach((s) => { try { map.removeSource(s); } catch (_) { } });

        // Cancel any running draw animation
        if (drawAnimRef.current) cancelAnimationFrame(drawAnimRef.current);

        // Reset the path trailer memory
        drawnFeaturesRef.current = [];

        routes.forEach((route) => {
            if (!route.coords?.length) return;

            if (route.isSelected && route.coords.some((c) => c.crime_score_norm !== undefined)) {
                // ── INITIALIZE EMPTY LINE ─────────────────────
                // We start with an empty feature collection. It is filled incrementally in animateTo()
                map.addSource(route.id, {
                    type: "geojson",
                    data: { type: "FeatureCollection", features: [] },
                });

                // Shadow/glow pass underneath
                map.addLayer({
                    id: `${route.id}-glow`,
                    type: "line",
                    source: route.id,
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": ["interpolate", ["linear"], ["get", "crime_score_norm"],
                            0, "#22c55e", 0.4, "#f59e0b", 1, "#ef4444"],
                        "line-width": 12,
                        "line-opacity": 0.18,
                        "line-blur": 4,
                    },
                });

                // Main colored line
                map.addLayer({
                    id: route.id,
                    type: "line",
                    source: route.id,
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": ["interpolate", ["linear"], ["get", "crime_score_norm"],
                            0, "#22c55e", 0.4, "#f59e0b", 1, "#ef4444"],
                        "line-width": 5,
                        "line-opacity": 0.95, // full opacity, visibility controlled by geometry length
                    },
                });
            } else {
                // ── NON-SELECTED: simple solid line ───────────────────────
                map.addSource(route.id, {
                    type: "geojson",
                    data: {
                        type: "Feature",
                        properties: {},
                        geometry: {
                            type: "LineString",
                            coordinates: route.coords.map((c) => [c.lng, c.lat]),
                        },
                    },
                });
                map.addLayer({
                    id: route.id,
                    type: "line",
                    source: route.id,
                    layout: { "line-join": "round", "line-cap": "round" },
                    paint: {
                        "line-color": route.color,
                        "line-width": route.width ?? 3,
                        "line-opacity": route.opacity ?? 0.3,
                    },
                });
            }
        });
    }, [routes]);

    // ── Start / end markers ──────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        if (startCoords) {
            const el = document.createElement("div");
            el.className = "w-4 h-4 rounded-full bg-green-400 border-2 border-white shadow-lg";
            markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([startCoords.lng, startCoords.lat]).addTo(map));
        }

        if (endCoords) {
            const el = document.createElement("div");
            el.className = "w-4 h-4 rounded-full bg-red-400 border-2 border-white shadow-lg";
            markersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([endCoords.lng, endCoords.lat]).addTo(map));
        }
    }, [startCoords, endCoords]);

    // ── External fly-to ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!flyToCoords || !mapRef.current) return;
        mapRef.current.flyTo({ center: [flyToCoords.lng, flyToCoords.lat], zoom: flyToCoords.zoom ?? 13, speed: 1.4, curve: 1.2 });
    }, [flyToCoords]);

    return <div ref={containerRef} className="w-full h-full" />;
});

export default MapView;
