"use client";

import React from "react";
import { ShieldAlert, Home, Zap, Info } from "lucide-react";

interface CrimeFilterTogglesProps {
    selectedCategory: string | null;
    onCategoryChange: (category: string | null) => void;
}

const CATEGORIES = [
    { id: "VIOLENT", label: "Violent", icon: ShieldAlert, color: "text-red-500", bg: "bg-red-500/20", border: "border-red-500/50" },
    { id: "PROPERTY", label: "Property", icon: Home, color: "text-orange-500", bg: "bg-orange-500/20", border: "border-orange-500/50" },
    { id: "OTHER", label: "Other", icon: Zap, color: "text-emerald-500", bg: "bg-emerald-500/20", border: "border-emerald-500/50" },
];

export default function CrimeFilterToggles({ selectedCategory, onCategoryChange }: CrimeFilterTogglesProps) {
    return (
        <div className="glass rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Heatmap Filters</h3>
                <Info className="w-3 h-3 text-white/20" />
            </div>

            <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((cat) => {
                    const isActive = selectedCategory === cat.id;
                    const Icon = typeof cat.icon === 'function' ? cat.icon : cat.icon;

                    return (
                        <button
                            key={cat.id}
                            onClick={() => onCategoryChange(isActive ? null : cat.id)}
                            className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg border transition-all duration-200 ${isActive
                                ? `${cat.bg} ${cat.border} ${cat.color} scale-105 shadow-lg shadow-black/40`
                                : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60"
                                }`}
                        >
                            <cat.icon className="w-4 h-4 mb-1" />
                            <span className="text-[10px] font-medium">{cat.label}</span>
                        </button>
                    );
                })}
            </div>

            {selectedCategory && (
                <button
                    onClick={() => onCategoryChange(null)}
                    className="mt-1 text-[9px] text-white/30 hover:text-white/60 transition-colors text-center w-full"
                >
                    Reset to all crimes
                </button>
            )}
        </div>
    );
}
