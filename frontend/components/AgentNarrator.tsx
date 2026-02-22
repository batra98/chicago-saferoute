"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, AlertTriangle, CheckCircle, Navigation, Volume2, VolumeX, Play, Pause } from "lucide-react";
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
    avoided_alternatives?: { to_coords: { lat: number; lng: number } }[];
    crime_count?: number;
    crime_score?: number;
    full_narration?: string;
    summary?: string;
    audio_base64?: string;
    comparison_stats?: {
        extra_time_min: number;
        crimes_avoided_score: number;
    };
}

interface AgentNarratorProps {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    startLabel: string;
    endLabel: string;
    mode: "safest" | "balanced" | "fastest";
    category?: string | null;
    hour?: number | null;
    active: boolean;
    voiceId?: string;
    mapRef: React.RefObject<MapViewHandle | null>;
    onDone?: () => void;
    onClose?: () => void;
}

interface DisplayLine {
    text: string;
    crimeCount?: number;
    isSummary?: boolean;
    stats?: {
        extra_time_min: number;
        crimes_avoided_score: number;
    };
}

// Removed legacy speechSynthesis helpers

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
    startLabel, endLabel, mode,
    category, hour,
    active, voiceId,
    mapRef, onDone, onClose,
}: AgentNarratorProps) {
    const [lines, setLines] = useState<DisplayLine[]>([]);
    const [isDone, setIsDone] = useState(false);
    const [voiceEnabled, setVoiceEnabled] = useState(true);
    const [isPaused, setIsPaused] = useState(false);

    const bottomRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const voiceRef = useRef(voiceEnabled);
    voiceRef.current = voiceEnabled;
    const isPausedRef = useRef(isPaused);
    isPausedRef.current = isPaused;

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const resolveAudioRef = useRef<(() => void) | null>(null);

    const toggleVoice = useCallback(() => {
        setVoiceEnabled((v) => {
            const next = !v;
            if (!next) {
                audioRef.current?.pause();
                if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
                resolveAudioRef.current?.(); // instantly skip ahead
            } else if (next && audioRef.current && !isPausedRef.current) {
                audioRef.current.play().catch(() => { });
            }
            return next;
        });
    }, []);

    const togglePause = useCallback(() => {
        setIsPaused((p) => {
            const next = !p;
            if (next) {
                audioRef.current?.pause();
                if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.pause();
            } else if (!next && voiceRef.current && audioRef.current && audioRef.current.paused && !audioRef.current.ended) {
                // crucial: we resume the existing element without resetting its source or time
                audioRef.current.play().catch(() => { });
                if (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.paused) {
                    window.speechSynthesis.resume();
                }
            } else if (!next && voiceRef.current && typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
            if (mapRef.current?.setPaused) {
                mapRef.current.setPaused(next);
            }
            return next;
        });
    }, [mapRef]);

    const playAudioBase64AndWait = useCallback((base64: string | undefined, fallbackText?: string): Promise<void> => {
        return new Promise((resolve) => {
            // If previous audio is still running, resolve it immediately to stop overlapping
            if (resolveAudioRef.current) {
                resolveAudioRef.current();
            }
            resolveAudioRef.current = resolve;

            if (!base64 || !voiceRef.current) {
                if (!base64 && voiceRef.current && fallbackText && typeof window !== 'undefined' && window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                    const utterance = new SpeechSynthesisUtterance(fallbackText);
                    utterance.rate = 0.95;

                    const cleanup = () => {
                        utterance.onend = null;
                        utterance.onerror = null;
                        if (resolveAudioRef.current === resolve) {
                            resolveAudioRef.current = null;
                        }
                        resolve();
                    };

                    utterance.onend = cleanup;
                    utterance.onerror = cleanup;

                    if (!isPausedRef.current) {
                        window.speechSynthesis.speak(utterance);
                    } else {
                        // Will speak later when unpaused
                        setTimeout(cleanup, 1500);
                    }
                    return;
                }
                setTimeout(resolve, 1500);
                return;
            }

            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = "";
            }

            // Detect MIME type (Gemini is WAV, ElevenLabs is MP3)
            // WAV starts with 'RIFF' -> 'UklGR', MP3 often starts with 'ID3' -> 'SUQz' or sync frames
            const mime = base64.startsWith("UklGR") ? "audio/wav" : "audio/mpeg";
            const uri = `data:${mime};base64,${base64}`;
            const audio = new Audio(uri);
            audioRef.current = audio;

            const cleanup = () => {
                audio.onended = null;
                audio.onerror = null;
                audio.onpause = null;
                audio.onplay = null;
                if (resolveAudioRef.current === resolve) {
                    resolveAudioRef.current = null;
                }
                resolve();
            };

            audio.onended = cleanup;
            audio.onerror = cleanup;

            // If we are currently paused, don't start playing yet. 
            // The user will hit Resume, which triggers `togglePause` -> `audioRef.current.play()`.
            // Crucially, this promise stays pending, halting the SSE loop so we don't skip ahead text.
            if (!isPausedRef.current) {
                audio.play().catch(cleanup);
            }
        });
    }, []);

    useEffect(() => {
        if (!active) return;

        setLines([]);
        setIsDone(false);
        audioRef.current?.pause();

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
                    start_label: startLabel, end_label: endLabel,
                    mode,
                    category,
                    hour,
                    voice_id: voiceId
                }),
                signal: abort.signal,
            });

            for await (const { eventType, payload } of readSSE(res, abort.signal)) {
                if (abort.signal.aborted) break;

                if (eventType === "intro") {
                    const text = payload.text ?? "";
                    setLines([{ text }]);
                    await playAudioBase64AndWait(payload.audio_base64, text);
                    if (abort.signal.aborted) break;

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

                        if (payload.avoided_alternatives && payload.from_coords) {
                            const from = payload.from_coords;
                            const alts = payload.avoided_alternatives.map((alt) => ({
                                from_coords: from,
                                to_coords: alt.to_coords
                            }));
                            if (mapRef.current && typeof mapRef.current.setAlternativeLines === 'function') {
                                mapRef.current.setAlternativeLines(alts);
                            }
                        }

                        await playAudioBase64AndWait(payload.audio_base64, text);
                        if (abort.signal.aborted) break;

                        // Clear visual indicators after speaking finishes
                        mapRef.current?.setTurnArrow(null);
                        mapRef.current?.setAlternativeLines([]);
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
                        setLines((prev) => [...prev, {
                            text: summary,
                            isSummary: true,
                            stats: payload.comparison_stats
                        }]);
                        await playAudioBase64AndWait(payload.audio_base64, summary);
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
            audioRef.current?.pause();
            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
        };
    }, [active, startLat, startLng, endLat, endLng, mode, category, hour, playAudioBase64AndWait, mapRef, startLabel, endLabel, voiceId, onDone]);

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

                <div className="flex ml-auto gap-2">
                    <button
                        onClick={togglePause}
                        title={isPaused ? "Resume Route" : "Pause Route"}
                        className={`p-1.5 rounded-lg transition-colors ${isPaused
                            ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                            : "bg-white/5 text-white/40 hover:bg-white/10"}`}
                    >
                        {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Pause className="w-4 h-4 fill-current" />}
                    </button>

                    <button
                        onClick={toggleVoice}
                        title={voiceEnabled ? "Mute voice" : "Enable voice"}
                        className={`p-1.5 rounded-lg transition-colors ${voiceEnabled
                            ? "bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30"
                            : "bg-white/5 text-white/30 hover:bg-white/10"}`}
                    >
                        {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                    </button>
                </div>

                {!isDone && active && (
                    <div className="flex items-center gap-1.5 ml-2">
                        <span className="w-2 h-2 rounded-full bg-indigo-400 spinner" />
                        <span className="text-xs text-white/40">Live</span>
                    </div>
                )}
                {isDone && (
                    <div className="flex items-center gap-2 ml-2">
                        <div className="flex items-center gap-1">
                            <CheckCircle className="w-4 h-4 text-green-400" />
                            <span className="text-xs text-green-400">Complete</span>
                        </div>
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-white/70 transition-colors"
                            >
                                Dismiss
                            </button>
                        )}
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
                        {line.isSummary && line.stats && (
                            <div className="flex items-center gap-3 mb-2 border-b border-white/5 pb-2">
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Crimes Avoided</span>
                                    <span className="text-sm text-green-400 font-mono font-bold">+{Math.round(line.stats.crimes_avoided_score)}</span>
                                </div>
                                <div className="w-px h-6 bg-white/10" />
                                <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-wider text-white/40 font-bold">Time Delta</span>
                                    <span className="text-sm text-amber-400 font-mono font-bold">+{Math.round(line.stats.extra_time_min)}m</span>
                                </div>
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
