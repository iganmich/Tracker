"use client";

import { C } from "@/lib/constants";

interface AIBoxProps {
  title: string;
  onRun: () => void;
  loading: boolean;
  text: string;
  placeholder: string;
}

export function AIBox({ title, onRun, loading, text, placeholder }: AIBoxProps) {
  return (
    <div
      className="rounded-xl p-3.5"
      style={{
        background: `${C.green}08`,
        border: `1px solid ${C.green}18`,
      }}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <p
          className="m-0 text-[10px] uppercase tracking-[1px]"
          style={{ color: C.green }}
        >
          🤖 {title}
        </p>
        <button
          type="button"
          onClick={onRun}
          disabled={loading}
          aria-busy={loading}
          className="min-h-[44px] rounded-md border px-4 text-[11px] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: loading ? `${C.green}0a` : `${C.green}18`,
            borderColor: `${C.green}44`,
            color: C.green,
            fontFamily: C.font,
          }}
        >
          {loading ? "Analysing…" : "Analyse"}
        </button>
      </div>
      <p
        className="m-0 whitespace-pre-wrap text-[11px] leading-[1.85]"
        style={{
          color: text ? C.text : C.muted,
          fontStyle: text ? "normal" : "italic",
        }}
      >
        {text || placeholder}
      </p>
    </div>
  );
}
