"use client";

import { C, TABS } from "@/lib/constants";
import type { TabId } from "@/lib/types";

interface TabBarProps {
  active: TabId;
  onChange: (id: TabId) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav
      role="tablist"
      aria-label="Dashboard sections"
      className="mb-4 flex gap-1.5 overflow-x-auto sm:mb-5"
    >
      {TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className="min-h-[44px] whitespace-nowrap rounded-lg border px-3.5 text-[11px] transition-colors"
            style={{
              background: selected ? `${C.green}18` : "transparent",
              borderColor: selected ? C.green : C.border,
              color: selected ? C.green : C.muted,
              fontFamily: C.font,
              fontWeight: selected ? 700 : 400,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
