"use client";

import { Landmark, GraduationCap, Moon, ChevronRight } from "lucide-react";

interface DemoPreset {
    id: number;
    name: string;
    description: string;
    icon: React.ReactNode;
    startLat: number;
    startLng: number;
    startLabel: string;
    endLat: number;
    endLng: number;
    endLabel: string;
}

const PRESETS: DemoPreset[] = [
    {
        id: 1,
        name: "Historical Walk",
        description: "Union Station → Dearborn Station",
        icon: <Landmark className="w-4 h-4 text-cyan-400" />,
        startLat: 41.8781, startLng: -87.6403, startLabel: "Union Station",
        endLat: 41.8735, endLng: -87.6293, endLabel: "Dearborn Station",
    },
    {
        id: 2,
        name: "Neighborhood Hop",
        description: "Wicker Park → Churchill Park",
        icon: <GraduationCap className="w-4 h-4 text-purple-400" />,
        startLat: 41.9097, startLng: -87.6773, startLabel: "Wicker Park Station",
        endLat: 41.9168, endLng: -87.6845, endLabel: "Churchill Park",
    },
    {
        id: 3,
        name: "The Night Owl",
        description: "Old Town → Wacker Drive",
        icon: <Moon className="w-4 h-4 text-amber-400" />,
        startLat: 41.9077, startLng: -87.6346, startLabel: "Old Town",
        endLat: 41.8885, endLng: -87.6323, endLabel: "Wacker Drive",
    },
];

interface DemoPresetsProps {
    onLoad: (preset: Omit<DemoPreset, "id" | "name" | "description" | "icon">) => void;
}

export default function DemoPresets({ onLoad }: DemoPresetsProps) {
    return (
        <div className="glass rounded-xl p-4">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Demo Scenarios</p>
            <div className="space-y-2">
                {PRESETS.map((preset) => (
                    <button
                        key={preset.id}
                        onClick={() => onLoad(preset)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/8 hover:border-white/15 hover:bg-white/5 transition-all text-left group"
                    >
                        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                            {preset.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white">{preset.name}</p>
                            <p className="text-xs text-white/40 truncate">{preset.description}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
                    </button>
                ))}
            </div>
        </div>
    );
}
