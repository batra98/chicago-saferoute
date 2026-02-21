"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, AlertTriangle, CheckCircle, Navigation, Volume2, VolumeX } from "lucide-react";
import { MapViewHandle } from "./MapView";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface NarrationEvent {
    type: "intro" | "chunk" | "segment_done" | "summary_chunk" | "done";
    text?: string;
    segment_index?: number;
    coords?: { lat: number; lng: number };
    from_coords?: { lat: number; lng: number };
    to_coords?: { lat: number; lng: number };
    path_coords?: { lat: number; lng: number }[];
    incidents?: { lat: number; lng: number; type: string }[];
    crime_count?: number;
    crime_score?: number;
    full_narration?: string;
    summary?: string;
}

interface AgentNarratorProps {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    startLabel: string;
    endLabel: string;
    mode: "safest" | "balanced" | "fastest";
    active: boolean;
    mapRef: React.RefObject<MapViewHandle | null>;
    onDone?: () => void;
}

interface DisplayLine {
    text: string;
    crimeCount?: number;
    isSummary?: boolean;
}

// ── Voice helpers ──────────────────────────────────────────────────────────
function speakAndWait(text: string): Promise<void> {
    return new Promise((resolve) => {
        if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
        const clean = text.replace(/[^\x00-\x7F\u00C0-\u024F\s.,!?'-]/g, "").trim();
        if (!clean) { resolve(); return; }
        window.speechSynthesis.cancel(); // cancel any previous
        const utt = new SpeechSynthesisUtterance(clean);
        utt.rate = 1.05;
        utt.onend = () => resolve();
        utt.onerror = () => resolve();
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find((v) =>
            v.lang.startsWith("en") && (v.name.includes("Samantha") || v.name.includes("Google") || v.name.includes("Natural"))
        );
        if (preferred) utt.voice = preferred;
        window.speechSynthesis.speak(utt);
    });
}

function cancelSpeech() {
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}

function getBearing(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLng = toRad(to.lng - from.lng);
    const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
    const x =
        Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
        Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
    return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}
// ──────────────────────────────────────────────────────────────────────────

// Parse an SSE raw block into { eventType, payload }
function parseSSEBlock(block: string): { eventType: string; payload: NarrationEvent } | null {
    const eventMatch = block.match(/^event: (.+)$/m);
    const dataMatch = block.match(/^data: (.+)$/m);
    if (!eventMatch || !dataMatch) return null;
    try {
        return { eventType: eventMatch[1], payload: JSON.parse(dataMatch[1]) };
    } catch {
        return null;
    }
}

// Async generator that yields parsed SSE events from a fetch Response
async function* readSSE(res: Response, signal: AbortSignal): AsyncGenerator<{ eventType: string; payload: NarrationEvent }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
            if (!part.trim()) continue;
            const parsed = parseSSEBlock(part);
            if (parsed) yield parsed;
        }
    }
}

export default function AgentNarrator({
    startLat, startLng, endLat, endLng,
    startLabel, endLabel, mode, active,
    mapRef, onDone,
}: AgentNarratorProps) {
    const [lines, setLines] = useState<DisplayLine[]>([]);
    const [isDone, setIsDone] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const voiceRef = useRef(voiceEnabled);
    voiceRef.current = voiceEnabled;

    const toggleVoice = useCallback(() => {
        setVoiceEnabled((v) => { if (v) cancelSpeech(); return !v; });
    }, []);

    useEffect(() => {
        if (!active) return;

        setLines([]);
        setIsDone(false);
        cancelSpeech();

        abortRef.current?.abort();
        const abort = new AbortController();
        abortRef.current = abort;

        const run = async () => {
            const res = await fetch(`${API_URL}/route/narrate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    start_lat: startLat, start_lng: startLng,
                    end_lat: endLat, end_lng: endLng,
                    start_label: startLabel, end_label: endLabel, mode,
                }),
                signal: abort.signal,
            });

            for await (const { eventType, payload } of readSSE(res, abort.signal)) {
                if (abort.signal.aborted) break;

                if (eventType === "intro") {
                    const text = payload.text ?? "";
                    setLines([{ text }]);
                    if (voiceRef.current) await speakAndWait(text);

                } else if (eventType === "segment_done") {
                    const coords = payload.coords;
                    const text = (payload.full_narration ?? "").trim();

                    if (text) {
                        // Show text, pause dot at the corner, speak, then continue down the street
                        setLines((prev) => [...prev, { text, crimeCount: payload.crime_count }]);

                        // Visual arrow indicator at intersection
                        if (payload.from_coords && payload.to_coords) {
                            const bearing = getBearing(payload.from_coords, payload.to_coords);
                            mapRef.current?.setTurnArrow(payload.from_coords, bearing);
                        }

                        // Spawn physical markers for the crimes while narrating
                        if (payload.incidents) {
                            mapRef.current?.setPulseMarkers(payload.incidents);
                        }

                        if (voiceRef.current) await speakAndWait(text);

                        // Clear visual indicators after speaking finishes
                        mapRef.current?.setPulseMarkers([]);
                        mapRef.current?.setTurnArrow(null);
                    }

                    if (coords) {
                        const map = mapRef.current;
                        if (map) {
                            const target = { ...coords, path: payload.path_coords };
                            if (text) {
                                // Slower — camera pitches/turns as dot moves along path
                                await map.animateTo(target, 1400);
                            } else {
                                // Quick hop — keep moving silently along path
                                await map.animateTo(target, 700);
                            }
                        }
                    }

                } else if (eventType === "done") {
                    const summary = (payload.summary ?? "").trim();
                    if (summary) {
                        setLines((prev) => [...prev, { text: summary, isSummary: true }]);
                        if (voiceRef.current) await speakAndWait(summary);
                    }
                    mapRef.current?.clearDot();
                    setIsDone(true);
                    onDone?.();
                }
            }
        };

        run().catch((e) => { if (e?.name !== "AbortError") console.error(e); });

        return () => {
            abort.abort();
            cancelSpeech();
        };
    }, [active, startLat, startLng, endLat, endLng, mode]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    const modeColors = { safest: "text-green-400", balanced: "text-amber-400", fastest: "text-red-400" };

    return (
        <div className="glass rounded-xl p-4 h-full flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                    <p className="text-sm font-semibold text-white">SafeRoute AI</p>
                    <p className={`text-xs ${modeColors[mode]} capitalize`}>{mode} mode</p>
                </div>

                <button
                    onClick={toggleVoice}
                    title={voiceEnabled ? "Mute voice" : "Enable voice"}
                    className={`ml-auto p-1.5 rounded-lg transition-colors ${voiceEnabled
                        ? "bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30"
                        : "bg-white/5 text-white/30 hover:bg-white/10"}`}
                >
                    {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>

                {!isDone && active && (
                    <div className="flex items-center gap-1.5 ml-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-400 spinner" />
                        <span className="text-xs text-white/40">Live</span>
                    </div>
                )}
                {isDone && (
                    <div className="flex items-center gap-1 ml-2">
                        <CheckCircle className="w-4 h-4 text-green-400" />
                        <span className="text-xs text-green-400">Complete</span>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {lines.map((line, i) => (
                    <div key={i} className={`fade-in text-sm leading-relaxed ${line.isSummary ? "border border-indigo-500/30 rounded-lg p-3 bg-indigo-500/5" : ""}`}>
                        {line.isSummary && (
                            <p className="text-xs font-semibold text-indigo-400 mb-1 flex items-center gap-1">
                                <Navigation className="w-3 h-3" /> Route Summary
                            </p>
                        )}
                        {line.crimeCount !== undefined && line.crimeCount > 0 && !line.isSummary && (
                            <div className="flex items-center gap-1 mb-1">
                                <AlertTriangle className="w-3 h-3 text-amber-400" />
                                <span className="text-xs text-amber-400/80">{line.crimeCount} incidents nearby</span>
                            </div>
                        )}
                        <p className="text-white/85">{line.text}</p>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
