import React, { useState } from 'react';
import { ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useSupportPainterState } from '../supportPainterStore';
import { BRUSH_COLORS } from '../supportPainterTypes';

export function SupportPainterTooltipCard() {
  const state = useSupportPainterState();
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!state.isActive) return null;

  const brushColor = state.activeCustomBrushId
    ? state.customBrushes.get(state.activeCustomBrushId)?.color ?? BRUSH_COLORS[state.activeBrush]
    : BRUSH_COLORS[state.activeBrush];

  const brushLabel = state.activeCustomBrushId
    ? state.customBrushes.get(state.activeCustomBrushId)?.name ?? `${state.activeBrush} (Custom)`
    : state.activeBrush;

  const isPointPath = state.activeBrush === 'PointPath';
  const isMarker = state.activeBrush === 'Marker';

  return (
    <div
      className="w-full max-w-[320px] rounded-xl border backdrop-blur-md shadow-xl transition-all duration-200 pointer-events-auto"
      style={{
        background: 'var(--surface-1, rgba(21, 26, 34, 0.85))',
        borderColor: 'var(--border-subtle, rgba(45, 55, 72, 0.5))',
        color: 'var(--text-strong, #f7fafc)',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {/* Premium Mini-Rollup Header */}
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="flex items-center justify-between px-3.5 py-2 cursor-pointer select-none"
        style={{
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-subtle, rgba(45, 55, 72, 0.25))',
        }}
      >
        <div className="flex items-center gap-1.5">
          <HelpCircle className="w-3.5 h-3.5" style={{ color: 'var(--accent, #3b82f6)' }} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">
            Quick Reference
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Active Tool Color Dot & Indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.4)]"
              style={{ backgroundColor: brushColor }}
            />
            <span className="text-[10px] font-semibold text-gray-400">
              {brushLabel}
            </span>
          </div>
          <button className="text-gray-400 hover:text-gray-200 focus:outline-none transition-colors">
            {isCollapsed ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Reference Body */}
      {!isCollapsed && (
        <div className="px-3.5 py-3 flex flex-col gap-3">
          {/* Active Tool Description */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
              Selected Brush
            </span>
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: brushColor }}
              />
              <span className="text-xs font-semibold text-gray-100">
                {brushLabel}
              </span>
            </div>
          </div>

          {/* Shortcuts Table */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
              Shortcuts & Interaction
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-[11px] py-1 border-b border-gray-800">
                <span className="text-gray-400 font-medium">Add Paint / Point</span>
                <kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-[10px] font-semibold border border-gray-700 text-gray-200">
                  Left Click
                </kbd>
              </div>
              <div className="flex justify-between items-center text-[11px] py-1 border-b border-gray-800">
                <span className="text-gray-400 font-medium">Continuous Stroke</span>
                <kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-[10px] font-semibold border border-gray-700 text-gray-200">
                  Click + Drag
                </kbd>
              </div>
              {isMarker && (
                <div className="flex justify-between items-center text-[11px] py-1 border-b border-gray-800">
                  <span className="text-gray-400 font-medium">Erase Paint</span>
                  <div className="flex gap-1">
                    <kbd className="px-1 py-0.5 rounded bg-gray-800 text-[9px] font-semibold border border-gray-700 text-gray-200">
                      Alt
                    </kbd>
                    <span className="text-gray-500 font-bold">+</span>
                    <kbd className="px-1 py-0.5 rounded bg-gray-800 text-[9px] font-semibold border border-gray-700 text-gray-200">
                      Click
                    </kbd>
                  </div>
                </div>
              )}
              <div className="flex justify-between items-center text-[11px] py-1">
                <span className="text-gray-400 font-medium">Undo / Redo Stroke</span>
                <div className="flex gap-1">
                  <kbd className="px-1 py-0.5 rounded bg-gray-800 text-[9px] font-semibold border border-gray-700 text-gray-200">
                    Ctrl
                  </kbd>
                  <span className="text-gray-500 font-bold">+</span>
                  <kbd className="px-1 py-0.5 rounded bg-gray-800 text-[9px] font-semibold border border-gray-700 text-gray-200">
                    Z / Y
                  </kbd>
                </div>
              </div>
            </div>
          </div>

          {/* Conditional PointPath Reference */}
          {isPointPath && (
            <div
              className="flex flex-col gap-1.5 p-2 rounded-lg text-left"
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
              }}
            >
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">
                Point Path Modality
              </span>
              <div className="flex flex-col gap-1 text-[10px] leading-relaxed text-gray-300">
                <p>
                  • Place path nodes on mesh. Dragging creates continuous segments.
                </p>
                <p>
                  • Closure proximity highlight (green glow) triggers within{' '}
                  <span className="font-bold text-emerald-400">0.3mm</span>.
                </p>
                <p>
                  • <span className="font-semibold text-emerald-300">Mode A (Line)</span>: Traces support rows.
                </p>
                <p>
                  • <span className="font-semibold text-emerald-300">Mode B (Polygon)</span>: Closes loop to flood-fill paint.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
