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
        name: "The Tourist",
        description: "Millennium Park → Lincoln Park Zoo",
        icon: <Landmark className="w-4 h-4 text-cyan-400" />,
        startLat: 41.8826, startLng: -87.6233, startLabel: "Millennium Park",
        endLat: 41.9214, endLng: -87.6337, endLabel: "Lincoln Park Zoo",
    },
    {
        id: 2,
        name: "The Student",
        description: "Wicker Park → UIC Campus",
        icon: <GraduationCap className="w-4 h-4 text-purple-400" />,
        startLat: 41.9097, startLng: -87.6773, startLabel: "Wicker Park Blue Line",
        endLat: 41.8710, endLng: -87.6500, endLabel: "UIC–Halsted Station",
    },
    {
        id: 3,
        name: "The Night Owl",
        description: "Logan Square → River North",
        icon: <Moon className="w-4 h-4 text-amber-400" />,
        startLat: 41.9219, startLng: -87.7068, startLabel: "Logan Square Blue Line",
        endLat: 41.8919, endLng: -87.6323, endLabel: "River North (Clark & Ohio)",
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
