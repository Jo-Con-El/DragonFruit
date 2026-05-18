import React, { useState } from 'react';
import { NumberInput } from '@/components/ui/NumberInput';
import { Card, CardHeader, IconButton, Input } from '@/components/ui/primitives';

type IslandOverlayControlsProps = {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  brushRadiusMm: number;
  onBrushRadiusChange: (radius: number) => void;
  color: string;
  onColorChange: (color: string) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  taper: number;
  onTaperChange: (taper: number) => void;
  islandCount: number;
  // Halo shader controls — primary surface.
  haloIntensity?: number;
  onHaloIntensityChange?: (intensity: number) => void;
  // Support coverage halo toggle (step 10).
  showSupportVolumeHalo?: boolean;
  onShowSupportVolumeHaloChange?: (show: boolean) => void;
  // Island column highlight + overhang highlight (SoftClay shader path).
  showIslands?: boolean;
  onShowIslandsChange?: (show: boolean) => void;
  islandColor?: string;
  onIslandColorChange?: (color: string) => void;
  islandIntensity?: number;
  onIslandIntensityChange?: (v: number) => void;
  islandRadiusFactor?: number;
  onIslandRadiusFactorChange?: (v: number) => void;
  islandColumnHeight?: number;
  onIslandColumnHeightChange?: (v: number) => void;
  showOverhang?: boolean;
  onShowOverhangChange?: (show: boolean) => void;
  overhangColor?: string;
  onOverhangColorChange?: (color: string) => void;
  overhangAngleDeg?: number;
  onOverhangAngleDegChange?: (v: number) => void;
  overhangIntensity?: number;
  onOverhangIntensityChange?: (v: number) => void;
  overhangProximityMm?: number;
  onOverhangProximityMmChange?: (v: number) => void;
};

/**
 * Control card for the island overlay. Primary surface is the cognitive
 * minimum — one slider for halo intensity, one toggle for the breathing
 * pulse animation, one toggle for support coverage. Existing legacy
 * controls (brushRadiusMm / color / opacity / taper) drive the vertex-
 * color painter path and live under an "Advanced" disclosure so power
 * users can still tweak them without crowding the primary surface.
 */
export function IslandOverlayControls({
  enabled,
  onEnabledChange,
  brushRadiusMm,
  onBrushRadiusChange,
  color,
  onColorChange,
  opacity,
  onOpacityChange,
  taper,
  onTaperChange,
  islandCount,
  haloIntensity = 0.7,
  onHaloIntensityChange,
  showSupportVolumeHalo = false,
  onShowSupportVolumeHaloChange,
  showIslands = true,
  onShowIslandsChange,
  islandColor = '#FF6B00',
  onIslandColorChange,
  islandIntensity = 0.85,
  onIslandIntensityChange,
  islandRadiusFactor = 3.0,
  onIslandRadiusFactorChange,
  islandColumnHeight = 6.0,
  onIslandColumnHeightChange,
  showOverhang = true,
  onShowOverhangChange,
  overhangColor = '#FF1744',
  onOverhangColorChange,
  overhangAngleDeg = 45,
  onOverhangAngleDegChange,
  overhangIntensity = 0.7,
  onOverhangIntensityChange,
  overhangProximityMm = 8.0,
  onOverhangProximityMmChange,
}: IslandOverlayControlsProps) {
  const [expanded, setExpanded] = useState(enabled);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [editingColor, setEditingColor] = useState(color);

  React.useEffect(() => {
    setEditingColor(color);
  }, [color]);

  return (
    <Card>
      <CardHeader
        left={(
          <>
            <IconButton
            onClick={() => setExpanded(!expanded)}
            className="!p-0.5"
            title={expanded ? 'Collapse card' : 'Expand card'}
          >
            <svg
              className="w-3 h-3 transform transition-transform"
              style={{ color: expanded ? 'var(--accent)' : 'var(--text-muted)' }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {expanded ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              )}
            </svg>
            </IconButton>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>Island Overlay</h3>
          </>
        )}
        right={(
          <button
            type="button"
            onClick={() => onEnabledChange(!enabled)}
            className="h-8 min-w-[74px] rounded-md border px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors"
            style={enabled
              ? {
                  borderColor: 'color-mix(in srgb, var(--accent), white 10%)',
                  background: 'color-mix(in srgb, var(--accent), var(--surface-0) 76%)',
                  color: 'var(--accent-contrast)',
                }
              : {
                  borderColor: 'var(--border-subtle)',
                  background: 'var(--surface-1)',
                  color: 'var(--text-muted)',
                }}
            title="Toggle Island Overlay"
          >
            {enabled ? 'ON' : 'OFF'}
          </button>
        )}
        hideDivider={!expanded}
      />

      {expanded && (
        <div className="px-2.5 pt-2 pb-3 space-y-2.5">
          {islandCount > 0 && (
            <div className="ui-meta">
              {islandCount} island{islandCount !== 1 ? 's' : ''} detected
            </div>
          )}

          {/* Primary halo controls. */}
          <div className="space-y-1">
            <label
              className="ui-meta flex justify-between"
              title="How loudly the halos draw attention. Lower values make small islands quieter without hiding them."
            >
              <span>Halo intensity</span>
              <span style={{ color: 'var(--text-strong)' }}>{Math.round(haloIntensity * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={haloIntensity}
              onChange={(e) => onHaloIntensityChange?.(parseFloat(e.target.value))}
              className="ui-range"
              title="How loudly the halos draw attention. Lower values make small islands quieter without hiding them."
            />
          </div>


          {/* Support Coverage sub-section — visually divided from island controls. */}
          <div
            className="pt-2.5 mt-1.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="ui-meta mb-1.5" style={{ color: 'var(--text-strong)' }}>
              Support Coverage
            </div>
            <label
              className="ui-meta flex items-center gap-2 cursor-pointer"
              title="Visualise roughly how much model each support is holding up."
            >
              <input
                type="checkbox"
                checked={showSupportVolumeHalo}
                onChange={(e) => onShowSupportVolumeHaloChange?.(e.target.checked)}
              />
              <span>Show support coverage</span>
            </label>
          </div>

          {/* Islands & Overhangs — SoftClay per-pixel shader path. */}
          <div
            className="pt-2.5 mt-1.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="ui-meta mb-1.5" style={{ color: 'var(--text-strong)' }}>
              Islands &amp; Overhangs
            </div>

            <label className="ui-meta flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={showIslands}
                onChange={(e) => onShowIslandsChange?.(e.target.checked)}
              />
              <span>Show island columns</span>
            </label>

            {showIslands && (
              <div className="space-y-2 pl-5 mb-2">
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Color</span>
                  <input
                    type="color"
                    value={islandColor}
                    onChange={(e) => onIslandColorChange?.(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Intensity</span>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={islandIntensity}
                    onChange={(e) => onIslandIntensityChange?.(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span className="ui-meta" style={{ minWidth: 32, textAlign: 'right' }}>
                    {Math.round(islandIntensity * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Radius ×</span>
                  <NumberInput
                    value={islandRadiusFactor}
                    onChange={(v) => onIslandRadiusFactorChange?.(v)}
                    step={0.1}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Col height</span>
                  <NumberInput
                    value={islandColumnHeight}
                    onChange={(v) => onIslandColumnHeightChange?.(v)}
                    step={0.5}
                  />
                </div>
              </div>
            )}

            <label className="ui-meta flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={showOverhang}
                onChange={(e) => onShowOverhangChange?.(e.target.checked)}
              />
              <span>Show overhang (near islands only)</span>
            </label>

            {showOverhang && (
              <div className="space-y-2 pl-5">
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Color</span>
                  <input
                    type="color"
                    value={overhangColor}
                    onChange={(e) => onOverhangColorChange?.(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Angle</span>
                  <input
                    type="range" min={10} max={80} step={1}
                    value={overhangAngleDeg}
                    onChange={(e) => onOverhangAngleDegChange?.(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span className="ui-meta" style={{ minWidth: 32, textAlign: 'right' }}>
                    {overhangAngleDeg}°
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Intensity</span>
                  <input
                    type="range" min={0} max={1} step={0.01}
                    value={overhangIntensity}
                    onChange={(e) => onOverhangIntensityChange?.(parseFloat(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <span className="ui-meta" style={{ minWidth: 32, textAlign: 'right' }}>
                    {Math.round(overhangIntensity * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="ui-meta" style={{ minWidth: 70 }}>Proximity</span>
                  <NumberInput
                    value={overhangProximityMm}
                    onChange={(v) => onOverhangProximityMmChange?.(v)}
                    step={0.5}
                  />
                  <span className="ui-meta">mm</span>
                </div>
              </div>
            )}
          </div>

          {/* Advanced disclosure — preserves the legacy painter knobs. */}
          <div
            className="pt-2.5 mt-1.5"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <button
              type="button"
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
              title="Override automatic halo parameters and the legacy vertex-colour brush."
            >
              <svg
                className="w-3 h-3 transform transition-transform"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                style={{ transform: advancedExpanded ? 'rotate(90deg)' : undefined }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>Advanced</span>
            </button>

            {advancedExpanded && (
              <div className="mt-2 space-y-2.5">
                <div className="space-y-1">
                  <label className="ui-meta">Color</label>
                  <div className="flex gap-1.5 items-center">
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => {
                        const newColor = e.target.value;
                        setEditingColor(newColor);
                        onColorChange(newColor);
                      }}
                      className="w-10 h-8 rounded border cursor-pointer p-0"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-1)' }}
                    />
                    <Input
                      type="text"
                      value={editingColor}
                      onChange={(e) => setEditingColor(e.target.value)}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (/^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val)) {
                          onColorChange(val);
                        } else {
                          setEditingColor(color);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                      className="flex-1 !h-8 px-2 py-0 text-sm uppercase"
                      placeholder="#0433FF"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="ui-meta flex justify-between">
                    <span>Opacity</span>
                    <span style={{ color: 'var(--text-strong)' }}>{Math.round(opacity * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={opacity}
                    onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
                    className="ui-range"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
