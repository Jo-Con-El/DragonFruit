import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import {
  Focus,
  Spline,
  CircleDot,
  Cylinder,
  GitCommit,
  Circle,
  WandSparkles,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { Card, CardHeader, IconButton, Button } from '@/components/ui/primitives';
import { supportPainterStore, useSupportPainterState } from '../supportPainterStore';
import { type BrushType, BRUSH_COLORS } from '../supportPainterTypes';
import { generateSupportsFromPainter } from '../supportScriptingEngine';

const BRUSH_DETAILS: Record<
  BrushType,
  { label: string; desc: string; icon: React.ComponentType<any> }
> = {
  MacroFace: {
    label: 'MacroFace',
    desc: 'Paint coplanar surfaces',
    icon: Focus,
  },
  Ridge: {
    label: 'Ridge Crease',
    desc: 'Trace 1D convex crease',
    icon: Spline,
  },
  Point: {
    label: 'Point Geodesic',
    desc: 'Geodesic circular brush',
    icon: CircleDot,
  },
  CylinderSides: {
    label: 'Cyl. Sides',
    desc: 'Paint cylinder side bands',
    icon: Cylinder,
  },
  CylinderMinima: {
    label: 'Cyl. Minima',
    desc: 'Trace bottom cylinder spine',
    icon: GitCommit,
  },
  Ring: {
    label: 'Z-Plane Ring',
    desc: 'Horizontal Z-plane slice',
    icon: Circle,
  },
};

export function SupportPainterPanel({
  activeModelId,
  getActiveMesh,
  onModeChange,
}: {
  activeModelId?: string | null;
  getActiveMesh?: () => THREE.Mesh | null;
  onModeChange?: (mode: 'support' | 'supportPainter') => void;
}) {
  const state = useSupportPainterState();
  const [isGenerating, setIsGenerating] = useState(false);
  const [expanded, setExpanded] = useState(false);  // collapsed = support mode, expanded = painter mode

  // Deactivate painter if panel unmounts while still expanded
  useEffect(() => {
    return () => {
      supportPainterStore.deactivate();
    };
  }, []);

  // Chevron is the mode-switch control
  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) {
      supportPainterStore.activate();
      onModeChange?.('supportPainter');
    } else {
      supportPainterStore.deactivate();
      onModeChange?.('support');
    }
  };

  const handleGenerate = async () => {
    if (!activeModelId || !getActiveMesh || state.regions.size === 0) return;
    const mesh = getActiveMesh();
    if (!mesh) return;

    setIsGenerating(true);
    try {
      await generateSupportsFromPainter(activeModelId, mesh, Array.from(state.regions.values()));
      supportPainterStore.clearAll();
    } catch (err) {
      console.error('[SupportPainterPanel] Generation failed', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const activeDetails = BRUSH_DETAILS[state.activeBrush] || BRUSH_DETAILS.MacroFace;

  return (
    <Card>
      <CardHeader
        left={
          <>
            <IconButton
              onClick={handleToggle}
              className="!p-0.5"
              title={expanded ? 'Close Support Painter' : 'Open Support Painter'}
            >
              {expanded
                ? <ChevronDown className="w-3 h-3" />
                : <ChevronRight className="w-3 h-3" />}
            </IconButton>
            <WandSparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
              Support Painter
            </h3>
          </>
        }
      />

      {expanded && (
      <div className="px-3 pb-3 pt-1 flex flex-col gap-3">

          {/* Direct Click-to-Generate Toggle */}
          <div
            className="flex items-center justify-between p-2.5 rounded-lg border text-xs"
            style={{
              background: 'var(--surface-2)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="flex flex-col gap-0.5 min-w-0 pr-2">
              <span className="font-semibold" style={{ color: 'var(--text-strong)' }}>
                Direct Click-to-Generate
              </span>
              <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                Generate supports instantly on click
              </span>
            </div>
            <button
              type="button"
              onClick={() => supportPainterStore.setDirectGenEnabled(!state.directGenEnabled)}
              className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
              style={{
                backgroundColor: state.directGenEnabled ? 'var(--accent)' : 'var(--surface-1)',
              }}
            >
              <span
                className="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                style={{
                  transform: state.directGenEnabled ? 'translateX(16px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          {/* Brush Selection */}
          <div className="flex flex-col gap-2">
            <span
              className="text-[10px] uppercase tracking-wider font-bold"
              style={{ color: 'var(--text-muted)' }}
            >
              Select Smart Brush
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(BRUSH_DETAILS) as BrushType[]).map((brush) => {
                const isSelected = state.activeBrush === brush;
                const details = BRUSH_DETAILS[brush];
                const brushColor = BRUSH_COLORS[brush];
                const Icon = details.icon;
                return (
                  <IconButton
                    key={brush}
                    active={isSelected}
                    onClick={() => supportPainterStore.setActiveBrush(brush)}
                    className="w-full !justify-start gap-2 !p-2"
                    title={details.desc}
                  >
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: brushColor }}
                    />
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-[11px] font-medium truncate">{details.label}</span>
                  </IconButton>
                );
              })}
            </div>
          </div>

          {/* Interaction Context Hint */}
          <div
            className="rounded-lg p-2.5 text-[11px] leading-relaxed border"
            style={{
              background: 'var(--surface-2)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            {state.modifierKeys.alt ? (
              <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--warning, #f59e0b)' }}>
                <span className="font-bold">Subtract Mode active:</span>
                &nbsp;Click a painted triangle to delete its region.
              </div>
            ) : state.directGenEnabled ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium" style={{ color: 'var(--accent)' }}>
                  {activeDetails.label}: Instant Placement
                </span>
                <span>Click model to instantly generate &amp; place supports in the highlighted region.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="font-medium" style={{ color: 'var(--text-strong)' }}>
                  {activeDetails.label}: {activeDetails.desc}
                </span>
                <span>
                  Click to paint. Hold{' '}
                  <kbd
                    className="px-1 rounded text-[10px] border"
                    style={{ background: 'var(--surface-0)', borderColor: 'var(--border-subtle)' }}
                  >
                    Alt
                  </kbd>
                  {' '}+ click to subtract.
                </span>
              </div>
            )}
          </div>

          {/* Painted Regions List */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] uppercase tracking-wider font-bold"
                style={{ color: 'var(--text-muted)' }}
              >
                Painted Regions ({state.regions.size})
              </span>
              {state.regions.size > 0 && (
                <button
                  type="button"
                  onClick={() => supportPainterStore.clearAll()}
                  className="text-[10px] font-medium hover:underline transition-colors"
                  style={{ color: 'var(--danger, #ef4444)' }}
                >
                  Clear All
                </button>
              )}
            </div>

            <div className="max-h-[180px] overflow-y-auto pr-1 flex flex-col gap-1.5 scrollbar-thin">
              {state.regions.size === 0 ? (
                <div
                  className="flex flex-col items-center justify-center py-5 text-center text-[11px] italic"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {state.directGenEnabled
                    ? 'Direct Generation Mode: Click mesh to instantly place supports'
                    : 'No regions painted yet'}
                </div>
              ) : (
                Array.from(state.regions.values())
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((region) => {
                    const details = BRUSH_DETAILS[region.brushType];
                    return (
                      <div
                        key={region.id}
                        className="flex items-center justify-between p-2 rounded-lg border text-xs"
                        style={{
                          background: 'var(--surface-2)',
                          borderColor: 'var(--border-subtle)',
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className="w-3 h-3 rounded border flex-shrink-0"
                            style={{
                              backgroundColor: region.color,
                              borderColor: 'var(--border-subtle)',
                            }}
                          />
                          <div className="flex flex-col min-w-0">
                            <span
                              className="font-semibold truncate"
                              style={{ color: 'var(--text-strong)' }}
                            >
                              {details?.label || region.brushType}
                            </span>
                            <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>
                              Seed #{region.seedTriangleId}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded border"
                            style={{
                              background: 'var(--surface-1)',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {region.triangleIds.size} tri
                          </span>
                          <IconButton
                            onClick={() => supportPainterStore.removeRegion(region.id)}
                            className="!p-1"
                            title="Delete region"
                          >
                            <Trash2 className="w-3 h-3" />
                          </IconButton>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          {/* Generate Button */}
          <Button
            variant="accent"
            size="sm"
            className="w-full"
            disabled={state.regions.size === 0 || isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? 'Generating…' : `Generate Supports (${state.regions.size})`}
          </Button>

        </div>
      )}
    </Card>
  );
}
