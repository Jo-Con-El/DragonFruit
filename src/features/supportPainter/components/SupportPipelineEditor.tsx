import React, { useState, useEffect } from 'react';
import {
  ChevronUp,
  ChevronDown,
  Info,
  Grid,
  X,
  Trash,
  Save,
  GitMerge,
} from 'lucide-react';
import { IconButton, Button } from '@/components/ui/primitives';
import { type CustomSupportOperation, type CustomSupportOperationType, type BrushType, arePipelinesEquivalent, upgradePipeline } from '../supportPainterTypes';
import { getPresetList, getPresetById } from '@/supports/Settings/presets';
import { supportPainterStore, useSupportPainterState } from '../supportPainterStore';
import { getSettings } from '@/supports/Settings';
import { SupportSequencePresetManagementModal } from './SupportSequencePresetManagementModal';

interface SupportPipelineEditorProps {
  initialPipeline: CustomSupportOperation[];
  comparisonPipeline?: CustomSupportOperation[];
  onChange: (pipeline: CustomSupportOperation[]) => void;
  isEmbedded?: boolean;
  onSave?: () => void;
  onClose?: () => void;
  colorTheme?: string; // Sourced from brush color
  placementScriptId?: string | null;
  onPlacementScriptIdChange?: (id: string | null) => void;
}

const SupportSpacingGauge = ({ op }: { op: CustomSupportOperation }) => {
  const preset = getPresetById(op.supportPresetId || 'structure');
  
  const shaftDiameter = preset?.settings?.shaft?.diameterMm ?? 1.2;
  const tipContact = preset?.settings?.tip?.contactDiameterMm ?? 0.4;
  const tipBody = preset?.settings?.tip?.bodyDiameterMm ?? 1.2;
  const tipLength = preset?.settings?.tip?.lengthMm ?? 2.0;
  
  const startSpacing = op.spacing.baseSpacingMm ?? 4.0;
  const endSpacing = typeof op.endSpacingMm === 'number' ? op.endSpacingMm : 4.0;
  const isZDensity = !!op.enableZHeightDensity;
  
  const width = 280;
  const height = 95;
  
  let scale = 20;
  let cx1 = 0, cx2 = 0, cx3 = 0;
  
  if (isZDensity) {
    const totalSpacing = startSpacing + endSpacing;
    const maxVal = Math.max(totalSpacing + Math.max(shaftDiameter, tipBody) * 2.0, 3.0);
    scale = 220 / maxVal;
    
    cx2 = width / 2;
    cx1 = cx2 - startSpacing * scale;
    cx3 = cx2 + endSpacing * scale;
  } else {
    const maxVal = Math.max(startSpacing + Math.max(shaftDiameter, tipBody) * 1.5, 3.0);
    scale = 200 / maxVal;
    
    cx1 = width / 2 - (startSpacing * scale) / 2;
    cx2 = width / 2 + (startSpacing * scale) / 2;
  }
  
  const yContact = 20;
  const yConeBase = yContact + tipLength * scale;
  const yShaftBottom = 85;

  const renderColumn = (cx: number, key: string) => {
    const pts = [
      `${cx - (tipContact * scale) / 2},${yContact}`,
      `${cx + (tipContact * scale) / 2},${yContact}`,
      `${cx + (tipBody * scale) / 2},${yConeBase}`,
      `${cx - (tipBody * scale) / 2},${yConeBase}`
    ].join(' ');
    
    return (
      <g key={key}>
        {/* Shaft/Trunk */}
        <rect
          x={cx - (shaftDiameter * scale) / 2}
          y={yConeBase}
          width={shaftDiameter * scale}
          height={Math.max(2, yShaftBottom - yConeBase)}
          fill="var(--accent, #4a90e2)"
          opacity="0.8"
          rx={1}
        />
        {/* Cone Tip */}
        <polygon points={pts} fill="var(--accent, #4a90e2)" opacity="0.9" />
        {/* Centerline marker */}
        <line x1={cx} y1={yContact} x2={cx} y2={yShaftBottom} stroke="var(--text-strong, #fff)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.25" />
      </g>
    );
  };

  return (
    <div 
      className="flex flex-col items-center justify-center p-2 rounded border mb-1.5"
      style={{
        background: 'var(--surface-2, #1a202c)',
        borderColor: 'var(--border-subtle, #2d3748)',
      }}
    >
      <div className="text-[9px] font-bold text-gray-400 mb-1 uppercase tracking-wider">
        Real-Time Spacing &amp; Geometry Gauge
      </div>
      <svg width={width} height={height} className="overflow-visible">
        {/* Overhang Surface guide */}
        <line x1={10} y1={yContact} x2={width - 10} y2={yContact} stroke="var(--text-muted, #4b5563)" strokeWidth="1.2" strokeDasharray="4,2" />
        <text x={12} y={yContact - 5} fill="var(--text-muted, #718096)" fontSize="7" fontWeight="bold" letterSpacing="0.05em">
          OVERHANG SURFACE
        </text>

        {/* Render active columns */}
        {renderColumn(cx1, 'col1')}
        {renderColumn(cx2, 'col2')}
        {isZDensity && renderColumn(cx3, 'col3')}

        {/* Annotations */}
        {isZDensity ? (
          <g>
            {/* Left Dimension (Start Spacing) */}
            <line x1={cx1} y1={55} x2={cx2} y2={55} stroke="var(--accent, #4a90e2)" strokeWidth="1" />
            <polygon points={`${cx1},55 ${cx1 + 4},52 ${cx1 + 4},58`} fill="var(--accent, #4a90e2)" />
            <polygon points={`${cx2},55 ${cx2 - 4},52 ${cx2 - 4},58`} fill="var(--accent, #4a90e2)" />
            
            {/* Left Badge */}
            <rect x={(cx1 + cx2) / 2 - 20} y={47} width={40} height={15} rx={3} fill="var(--surface-1, #151a22)" stroke="var(--border-subtle, #2d3748)" strokeWidth="0.5" />
            <text x={(cx1 + cx2) / 2} y={58} textAnchor="middle" fill="var(--accent, #4a90e2)" fontSize="8" fontWeight="bold">
              {startSpacing.toFixed(1)}
            </text>

            {/* Right Dimension (End Spacing) */}
            <line x1={cx2} y1={55} x2={cx3} y2={55} stroke="var(--accent, #4a90e2)" strokeWidth="1" />
            <polygon points={`${cx2},55 ${cx2 + 4},52 ${cx2 + 4},58`} fill="var(--accent, #4a90e2)" />
            <polygon points={`${cx3},55 ${cx3 - 4},52 ${cx3 - 4},58`} fill="var(--accent, #4a90e2)" />
            
            {/* Right Badge */}
            <rect x={(cx2 + cx3) / 2 - 20} y={47} width={40} height={15} rx={3} fill="var(--surface-1, #151a22)" stroke="var(--border-subtle, #2d3748)" strokeWidth="0.5" />
            <text x={(cx2 + cx3) / 2} y={58} textAnchor="middle" fill="var(--accent, #4a90e2)" fontSize="8" fontWeight="bold">
              {endSpacing.toFixed(1)}
            </text>
            
            <text x={cx1} y={yShaftBottom + 8} textAnchor="middle" fill="var(--text-muted, #718096)" fontSize="7" fontWeight="bold">START</text>
            <text x={cx3} y={yShaftBottom + 8} textAnchor="middle" fill="var(--text-muted, #718096)" fontSize="7" fontWeight="bold">END</text>
          </g>
        ) : (
          <g>
            {/* Horizontal guideline */}
            <line x1={cx1} y1={55} x2={cx2} y2={55} stroke="var(--accent, #4a90e2)" strokeWidth="1.2" />
            <polygon points={`${cx1},55 ${cx1 + 5},52 ${cx1 + 5},58`} fill="var(--accent, #4a90e2)" />
            <polygon points={`${cx2},55 ${cx2 - 5},52 ${cx2 - 5},58`} fill="var(--accent, #4a90e2)" />
            
            {/* Badge background */}
            <rect x={width / 2 - 25} y={46} width={50} height={18} rx={3} fill="var(--surface-1, #151a22)" stroke="var(--border-subtle, #2d3748)" strokeWidth="0.5" />
            <text x={width / 2} y={58} textAnchor="middle" fill="var(--accent, #4a90e2)" fontSize="9" fontWeight="bold">
              {startSpacing.toFixed(1)} mm
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};

export function SupportPipelineEditor({
  initialPipeline,
  comparisonPipeline,
  onChange,
  isEmbedded = false,
  onSave,
  onClose,
  colorTheme = '#FF5B6F',
  placementScriptId = null,
  onPlacementScriptIdChange,
}: SupportPipelineEditorProps) {
  const [expandedOp, setExpandedOp] = useState<string | null>(null);
  const state = useSupportPainterState();
  const [popupScriptNameInput, setPopupScriptNameInput] = useState('');
  const [isSavingPopupScript, setIsSavingPopupScript] = useState(false);
  const [showPresetManagement, setShowPresetManagement] = useState(false);

  // Find matched script for SupportPipelineEditor to keep inline input synchronized
  const matchedScriptForSync = placementScriptId ? state.placementScripts.get(placementScriptId) : null;
  const isReadOnly = !!(matchedScriptForSync?.isReadOnly);

  const handleCloneToCustom = () => {
    const defaultName = matchedScriptForSync ? `${matchedScriptForSync.name} (Custom)` : 'Custom Script';
    const name = prompt('Enter a name for the custom support sequence:', defaultName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const newScriptId = `custom-script-${Date.now()}`;
    const newScript = {
      id: newScriptId,
      name: trimmed,
      operations: JSON.parse(JSON.stringify(initialPipeline)),
      isBuiltIn: false,
      isReadOnly: false,
    };
    supportPainterStore.addPlacementScript(newScript);
    onPlacementScriptIdChange?.(newScriptId);
  };

  useEffect(() => {
    if (matchedScriptForSync) {
      setPopupScriptNameInput(matchedScriptForSync.isBuiltIn ? `${matchedScriptForSync.name} (Custom)` : matchedScriptForSync.name);
    } else {
      setPopupScriptNameInput('');
    }
  }, [matchedScriptForSync?.id]);

  const updateOp = (index: number, updates: Partial<CustomSupportOperation>) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const nextOps = initialPipeline.map((op, idx) => {
      if (idx === index) {
        return { ...op, ...updates };
      }
      return op;
    }) as CustomSupportOperation[];
    onChange(nextOps);
  };

  const updateOpSpacing = (index: number, updates: Partial<CustomSupportOperation['spacing']>) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const nextOps = initialPipeline.map((op, idx) => {
      if (idx === index) {
        return {
          ...op,
          spacing: { ...op.spacing, ...updates },
        };
      }
      return op;
    }) as CustomSupportOperation[];
    onChange(nextOps);
  };

  const updateOpSuppression = (index: number, updates: Partial<CustomSupportOperation['suppression']>) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const nextOps = initialPipeline.map((op, idx) => {
      if (idx === index) {
        return {
          ...op,
          suppression: { ...op.suppression, ...updates },
        };
      }
      return op;
    }) as CustomSupportOperation[];
    onChange(nextOps);
  };

  const moveOp = (index: number, dir: 'up' | 'down') => {
    if (dir === 'up' && index === 0) return;
    if (dir === 'down' && index === initialPipeline.length - 1) return;
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }

    const nextOps = [...initialPipeline];
    const targetIdx = dir === 'up' ? index - 1 : index + 1;
    const temp = nextOps[index];
    nextOps[index] = nextOps[targetIdx];
    nextOps[targetIdx] = temp;
    onChange(nextOps);
  };

  const addOp = (type: CustomSupportOperationType) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const defaultSpacing = 4.0;
    const newOp: CustomSupportOperation = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type,
      enabled: true,
      supportPresetId: 'structure',
      isIntervalDirectlyEdited: false,
      insetDistanceMm: 0.0,
      wrapFraction: 100,
      enableZHeightDensity: false,
      minimaStartInterval: 0,
      minimaEndInterval: 100,
      endSpacingMm: defaultSpacing,
      zFactor: 2.0,
      zFactorCurve: 'linear',
      suppression: {
        enabled: type !== 'perimeter',
        distanceMm: defaultSpacing,
        suppressAgainst: type === 'minima' ? ['minima'] : type === 'infill' ? ['minima', 'perimeter', 'infill'] : ['minima', 'perimeter', 'infill', 'centerline'],
      },
      spacing: {
        baseSpacingMm: defaultSpacing,
        solverMode: 'standard',
        useInflectionPoints: false,
        infillPattern: 'PoissonDisc',
        seedFromMinima: true,
        attemptLeafCreation: type === 'minima',
      },
    };
    onChange([...initialPipeline, newOp]);
  };

  const deleteOp = (index: number) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const nextOps = initialPipeline.filter((_, idx) => idx !== index);
    onChange(nextOps);
  };

  const applyPresetToOp = (index: number, presetId: string) => {
    if (placementScriptId && placementScriptId !== 'unsaved') {
      onPlacementScriptIdChange?.('unsaved');
    }
    const nextOps = initialPipeline.map((op, idx) => {
      if (idx === index) {
        const preset = getPresetById(presetId);
        const shaftDiameter = preset?.settings?.shaft?.diameterMm ?? 1.0;
        const newSpacing = op.isIntervalDirectlyEdited ? op.spacing.baseSpacingMm : shaftDiameter * 4.0;
        
        return {
          ...op,
          supportPresetId: presetId,
          spacing: {
            ...op.spacing,
            baseSpacingMm: newSpacing,
          }
        };
      }
      return op;
    }) as CustomSupportOperation[];
    onChange(nextOps);
  };

  const renderContent = () => {
    return (
      <div className="flex flex-col gap-3">
        {isReadOnly && (
          <div
            className="flex items-center justify-between p-3 rounded-lg border text-xs gap-3 mb-3 animate-fade-in"
            style={{
              background: 'rgba(217, 119, 6, 0.15)',
              borderColor: 'rgb(217, 119, 6)',
              color: 'var(--text-strong, #fff)',
            }}
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-amber-500">Built-in Template</span>
              <span>This default sequence is read-only. Clone it to customize parameters.</span>
            </div>
            <button
              type="button"
              onClick={handleCloneToCustom}
              className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold cursor-pointer transition-colors flex-shrink-0"
            >
              Clone to Custom
            </button>
          </div>
        )}
        {!isEmbedded && (() => {
          const matchedScript = placementScriptId ? state.placementScripts.get(placementScriptId) : null;

          const handleSelectPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
            const scriptId = e.target.value;
            if (scriptId === 'unsaved') {
              onPlacementScriptIdChange?.('unsaved');
              return;
            }
            const script = state.placementScripts.get(scriptId);
            if (script) {
              onChange(JSON.parse(JSON.stringify(script.operations)));
              onPlacementScriptIdChange?.(scriptId);
            }
          };

          const handleSavePreset = () => {
            if (!isSavingPopupScript) {
              setPopupScriptNameInput('');
              setIsSavingPopupScript(true);
              return;
            }

            const name = popupScriptNameInput.trim();
            if (!name) return;

            const existingCustom = Array.from(state.placementScripts.values()).find(
              s => s.name.toLowerCase() === name.toLowerCase() && !s.isBuiltIn
            );

            const scriptId = existingCustom ? existingCustom.id : `custom-script-${Date.now()}`;
            const newScript = {
              id: scriptId,
              name,
              operations: JSON.parse(JSON.stringify(initialPipeline)),
              isBuiltIn: false,
              isReadOnly: false,
            };

            supportPainterStore.addPlacementScript(newScript);
            supportPainterStore.showToast([`Saved placement script "${name}"`]);
            onPlacementScriptIdChange?.(scriptId);
            setIsSavingPopupScript(false);
          };

          const handleDeletePreset = () => {
            if (!matchedScript || matchedScript.isBuiltIn) return;
            if (confirm(`Are you sure you want to delete the placement script "${matchedScript.name}"?`)) {
              supportPainterStore.deletePlacementScript(matchedScript.id);
              supportPainterStore.showToast([`Deleted placement script "${matchedScript.name}"`]);
              onPlacementScriptIdChange?.('unsaved');
            }
          };

          const handleCancelSavePreset = () => {
            setIsSavingPopupScript(false);
            setPopupScriptNameInput('');
          };

          const brushLabel = state.activeBrush === 'PointPath' ? `PointPath (${state.pointPathMode})` : state.activeBrush;
          const defaultScriptId = supportPainterStore.getDefaultScriptIdForBrush(state.activeBrush, state.activeBrush === 'PointPath' ? state.pointPathMode : undefined);
          const defaultScript = state.placementScripts.get(defaultScriptId);

          return (
            <div
              className="flex flex-col gap-2 px-4 py-2.5 border text-xs flex-shrink-0 mb-3 rounded-lg animate-fade-in"
              style={{
                background: 'var(--surface-2, #1a202c)',
                borderColor: 'var(--border-subtle, #2d3748)',
              }}
            >
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-gray-300">
                  Preset Script:
                </span>
                {isSavingPopupScript ? (
                  <input
                    type="text"
                    value={popupScriptNameInput}
                    onChange={(e) => setPopupScriptNameInput(e.target.value)}
                    placeholder="Enter Support Script Name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSavePreset();
                      } else if (e.key === 'Escape') {
                        handleCancelSavePreset();
                      }
                    }}
                    className="flex-1 max-w-[280px] bg-surface-1 text-text-strong text-[11px] px-2 py-1 rounded border border-border-subtle outline-none"
                    style={{
                      background: 'var(--surface-1, #151a22)',
                      borderColor: 'var(--border-subtle, #2d3748)',
                      color: 'var(--text-strong, #f3f4f6)',
                    }}
                  />
                ) : (
                  <select
                    value={matchedScript ? matchedScript.id : 'unsaved'}
                    onChange={handleSelectPreset}
                    className="flex-1 max-w-[280px] bg-surface-1 text-text-strong text-[11px] px-2 py-1 rounded border border-border-subtle outline-none"
                    style={{
                      background: 'var(--surface-1, #151a22)',
                      borderColor: 'var(--border-subtle, #2d3748)',
                      color: 'var(--text-strong, #f3f4f6)',
                    }}
                  >
                    {!matchedScript && (
                      <option value="unsaved">(Unsaved Placement Script)</option>
                    )}
                    {Array.from(state.placementScripts.values()).map(script => (
                      <option key={script.id} value={script.id}>
                        {script.name}
                      </option>
                    ))}
                  </select>
                )}

                <IconButton
                  onClick={handleSavePreset}
                  disabled={isSavingPopupScript && !popupScriptNameInput.trim()}
                  className="!p-1 hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Save Placement Script"
                >
                  <Save className="w-3.5 h-3.5" style={{ color: (isSavingPopupScript && !popupScriptNameInput.trim()) ? 'var(--text-muted)' : 'var(--accent, #4a90e2)' }} />
                </IconButton>

                {isSavingPopupScript ? (
                  <IconButton
                    onClick={handleCancelSavePreset}
                    className="!p-1 hover:bg-black/20"
                    title="Cancel Saving"
                  >
                    <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted, #718096)' }} />
                  </IconButton>
                ) : (
                  <IconButton
                    onClick={handleDeletePreset}
                    disabled={!matchedScript || matchedScript.isBuiltIn}
                    className="!p-1 hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={matchedScript?.isBuiltIn ? "Cannot delete built-in script" : "Delete Placement Script"}
                  >
                    <Trash className="w-3.5 h-3.5" style={{ color: (!matchedScript || matchedScript.isBuiltIn) ? 'var(--text-muted, #718096)' : 'var(--danger, #ef4444)' }} />
                  </IconButton>
                )}
              </div>

              {/* Default overrides row */}
              <div className="flex items-center gap-2 mt-1.5 pt-2 border-t border-gray-700/50 justify-between">
                <span className="text-[10px] text-gray-400">
                  Default for {brushLabel}: <span className="font-bold text-gray-300">{defaultScript?.name || 'Default'}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      supportPainterStore.assignBrushDefault(
                        state.activeBrush,
                        matchedScript ? matchedScript.id : 'unsaved',
                        initialPipeline
                      );
                      supportPainterStore.showToast([`Assigned default sequence for ${brushLabel}`]);
                    }}
                    className="!text-[9px] h-6 px-2 flex items-center"
                    title={`Assign this sequence as the default for the current brush: ${brushLabel}`}
                  >
                    Assign as Default
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      supportPainterStore.resetBrushDefault(state.activeBrush);
                      supportPainterStore.showToast([`Reset ${brushLabel} default to factory setting`]);
                      const resetId = supportPainterStore.getDefaultScriptIdForBrush(state.activeBrush, state.activeBrush === 'PointPath' ? state.pointPathMode : undefined);
                      const resetScript = state.placementScripts.get(resetId);
                      if (resetScript) {
                        onChange(JSON.parse(JSON.stringify(resetScript.operations)));
                        onPlacementScriptIdChange?.(resetId);
                      }
                    }}
                    className="!text-[9px] h-6 px-2 flex items-center"
                    title={`Reset default preset for ${brushLabel} to built-in factory default`}
                  >
                    Reset Default
                  </Button>
                </div>
              </div>
            </div>
          );
        })()}

        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Operations Precedence Sequencer
        </span>
        
        <div className="flex flex-col gap-2.5">
          {initialPipeline.map((op, index) => {
            const opKey = op.id || `${op.type}-${index}`;
            const isExpanded = expandedOp === opKey;
            const compOp = comparisonPipeline?.find(c => c.type === op.type);
            const label =
              op.type === 'minima'
                ? 'Local Minima Placement'
                : op.type === 'perimeter'
                  ? 'Perimeter Contour Pathing'
                  : op.type === 'centerline'
                    ? '1D Centerline Diameter Spine Path'
                    : 'Poisson Disc Infill Populator';

            return (
              <div
                key={opKey}
                className="flex flex-col rounded-xl border overflow-hidden transition-all"
                style={{
                  background: 'var(--surface-2, #1d242e)',
                  borderColor: isExpanded ? colorTheme : 'var(--border-subtle, #2d3748)',
                }}
              >
                {/* Operation Card Header */}
                <div className="flex items-center justify-between px-4 py-3 select-none">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-xs capitalize truncate">
                        {op.type} stage
                      </span>
                      <span className="text-[9px] text-gray-400 truncate">{label}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Sort buttons */}
                    <IconButton
                      onClick={() => moveOp(index, 'up')}
                      disabled={index === 0 || isReadOnly}
                      className="!p-0.5"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton
                      onClick={() => moveOp(index, 'down')}
                      disabled={index === initialPipeline.length - 1 || isReadOnly}
                      className="!p-0.5"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </IconButton>
                    
                    <IconButton
                      onClick={() => deleteOp(index)}
                      disabled={isReadOnly}
                      className="!p-0.5 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Delete step from stack"
                    >
                      <Trash className="w-3.5 h-3.5" style={{ color: isReadOnly ? 'var(--text-muted)' : 'var(--danger, #ef4444)' }} />
                    </IconButton>

                    <button
                      type="button"
                      onClick={() => setExpandedOp(isExpanded ? null : opKey)}
                      className="text-[10px] ml-1 px-2 py-1 rounded border font-semibold flex items-center gap-1 hover:bg-black/20"
                      style={{
                        borderColor: 'var(--border-subtle, #2d3748)',
                        color: 'var(--text-strong)',
                      }}
                    >
                      <Info className="w-3 h-3" />
                      Config
                    </button>
                  </div>
                </div>

                {/* Collapsible Config Area */}
                {isExpanded && (
                  <fieldset
                    disabled={isReadOnly}
                    className="px-4 pb-4 pt-3 flex flex-col gap-4 border-t text-xs leading-normal"
                    style={{
                      borderColor: 'var(--border-subtle, #2d3748)',
                      background: 'rgba(0,0,0,0.15)',
                      borderStyle: 'solid',
                      borderWidth: '1px 0 0 0',
                      padding: '12px 16px 16px 16px',
                      margin: 0,
                      minWidth: 0,
                    }}
                  >
                    {/* Spacing Parameters */}
                    <div className="flex flex-col gap-2.5">
                      <h4 className="font-bold text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1">
                        <Grid className="w-3.5 h-3.5" />
                        Spacing settings
                      </h4>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {/* Support Preset Selection Dropdown */}
                        <div className="col-span-2 flex flex-col gap-1 border-b pb-2.5 mb-1.5" style={{ borderColor: 'var(--border-subtle, #2d3748)' }}>
                          <span className="font-semibold text-gray-300">Preset Size Binding</span>
                          <select
                            value={op.supportPresetId || 'structure'}
                            onChange={e => applyPresetToOp(index, e.target.value)}
                            className="px-2.5 py-1.5 rounded border font-medium outline-none cursor-pointer text-xs"
                            style={{
                              background: 'var(--surface-1, #151a22)',
                              borderColor: 'var(--border-subtle, #2d3748)',
                              color: 'var(--text-strong)',
                            }}
                          >
                            {getPresetList().map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name} preset ({p.settings.shaft.diameterMm.toFixed(2)} mm column)
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Spacing Gauge Component */}
                        <div className="col-span-2 flex justify-center py-1">
                          <SupportSpacingGauge op={op} />
                        </div>

                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5 justify-between w-full">
                            <span className="flex items-center gap-1">
                              {op.enableZHeightDensity
                                ? 'Base Spacing (mm) [Managed by Z-Density]'
                                : op.type === 'minima' && op.spacing.attemptLeafCreation
                                  ? 'Leaf Search Interval (mm)'
                                  : 'Base Spacing (mm)'}
                            </span>
                            {compOp && compOp.spacing.baseSpacingMm !== op.spacing.baseSpacingMm && (
                              <span className="text-[9px] text-[#A5A6B5] font-semibold bg-black/35 px-1.5 py-0.5 rounded">
                                Last: {compOp.spacing.baseSpacingMm.toFixed(1)} mm
                              </span>
                            )}
                          </div>
                          <input
                            type="number"
                            step="0.1"
                            min="0.5"
                            disabled={op.enableZHeightDensity}
                            value={isNaN(op.spacing.baseSpacingMm) ? '' : op.spacing.baseSpacingMm}
                            onChange={e => {
                              const val = parseFloat(e.target.value);
                              const newBase = isNaN(val) ? 0 : val;
                              const newSuppression = newBase > 0 ? Math.max(0.1, parseFloat((newBase - 0.1).toFixed(2))) : 0.1;
                              const updates: Partial<CustomSupportOperation> = {
                                isIntervalDirectlyEdited: true,
                                spacing: {
                                  ...op.spacing,
                                  baseSpacingMm: newBase,
                                },
                                suppression: {
                                  ...op.suppression,
                                  distanceMm: newSuppression,
                                }
                              };
                              updateOp(index, updates);
                            }}
                            className="px-2.5 py-1.5 rounded border font-medium outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                              background: 'var(--surface-1, #151a22)',
                              borderColor: 'var(--border-subtle, #2d3748)',
                            }}
                          />
                        </div>

                        {op.type === 'perimeter' && (
                          <>
                            <div className="flex flex-col gap-1">
                              <span>Inset Distance (mm)</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.0"
                                value={isNaN(op.insetDistanceMm ?? 0.0) ? '' : (op.insetDistanceMm ?? 0.0)}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  updateOp(index, {
                                    insetDistanceMm: isNaN(val) ? 0.0 : val,
                                  });
                                }}
                                className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                }}
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <span>Wrap Limit (Z) (%)</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="1"
                                  max="100"
                                  step="1"
                                  value={op.wrapFraction ?? 100}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      wrapFraction: isNaN(val) ? undefined : val,
                                    });
                                  }}
                                  className="flex-1 accent-accent h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-700"
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="1"
                                  max="100"
                                  value={op.wrapFraction === undefined ? '' : op.wrapFraction}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      wrapFraction: isNaN(val) ? undefined : val,
                                    });
                                  }}
                                  className="w-16 px-2 py-1 rounded border font-medium outline-none text-right"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>
                            </div>
                          </>
                        )}
                        


                        {/* Perimeter-specific fields */}
                        {op.type === 'perimeter' && (
                          <>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 justify-between w-full">
                                <span>Advanced Solver Mode</span>
                                {compOp && compOp.spacing.solverMode !== op.spacing.solverMode && (
                                  <span className="text-[9px] text-[#A5A6B5] font-semibold bg-black/35 px-1.5 py-0.5 rounded capitalize">
                                    Last: {compOp.spacing.solverMode || 'standard'}
                                  </span>
                                )}
                              </div>
                              <select
                                value={op.spacing.solverMode || 'standard'}
                                onChange={e =>
                                  updateOpSpacing(index, {
                                    solverMode: e.target.value as any,
                                  })
                                }
                                className="px-2.5 py-1.5 rounded border font-medium outline-none cursor-pointer"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                }}
                              >
                                <option value="standard">Standard Walk</option>
                                <option value="closest">Even (Closest Spacing)</option>
                                <option value="add">Even (Add / Density)</option>
                                <option value="remove">Even (Remove / Sparser)</option>
                              </select>
                            </div>



                            <div className="col-span-2 flex items-center gap-2 mt-1">
                              <input
                                type="checkbox"
                                checked={op.spacing.useInflectionPoints || false}
                                onChange={e =>
                                  updateOpSpacing(index, {
                                    useInflectionPoints: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 rounded accent-accent cursor-pointer"
                                id={`inflect-check-${op.type}`}
                              />
                              <label htmlFor={`inflect-check-${op.type}`} className="cursor-pointer font-medium select-none">
                                Split loop at curve inflection points and solve segments evenly
                              </label>
                            </div>
                          </>
                        )}

                        {/* Infill-specific fields */}
                        {op.type === 'infill' && (
                          <>
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-1.5 justify-between w-full">
                                <span>Infill Pattern</span>
                                {compOp && compOp.spacing.infillPattern !== op.spacing.infillPattern && (
                                  <span className="text-[9px] text-[#A5A6B5] font-semibold bg-black/35 px-1.5 py-0.5 rounded capitalize">
                                    Last: {compOp.spacing.infillPattern || 'PoissonDisc'}
                                  </span>
                                )}
                              </div>
                              <select
                                value={op.spacing.infillPattern || 'PoissonDisc'}
                                onChange={e =>
                                  updateOpSpacing(index, {
                                    infillPattern: e.target.value as any,
                                  })
                                }
                                className="px-2.5 py-1.5 rounded border font-medium outline-none cursor-pointer"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                }}
                              >
                                <option value="PoissonDisc">Poisson Disc (Organic)</option>
                                <option value="Grid">Orthogonal Grid</option>
                                <option value="Honeycomb">Honeycomb (Hexagonal)</option>
                                <option value="Concentric">Concentric Offset Rings</option>
                              </select>
                            </div>

                            <div className="col-span-2 flex items-center gap-2 mt-1">
                              <input
                                type="checkbox"
                                checked={op.spacing.seedFromMinima || false}
                                onChange={e =>
                                  updateOpSpacing(index, { seedFromMinima: e.target.checked })
                                }
                                className="w-4 h-4 rounded accent-accent cursor-pointer"
                                id={`seed-check-${op.type}`}
                              />
                              <label htmlFor={`seed-check-${op.type}`} className="cursor-pointer font-medium select-none">
                                Snap infill pattern coordinates origin to Vertical Z-minima anchor
                              </label>
                            </div>
                          </>
                        )}

                        {/* Centerline-specific fields */}
                        {op.type === 'centerline' && (
                          <div className="col-span-2 flex items-center gap-2 mt-1">
                            <input
                              type="checkbox"
                              checked={op.spacing.seedFromMinima || false}
                              onChange={e =>
                                updateOpSpacing(index, { seedFromMinima: e.target.checked })
                              }
                              className="w-4 h-4 rounded accent-accent cursor-pointer"
                              id={`seed-check-${op.type}`}
                            />
                            <label htmlFor={`seed-check-${op.type}`} className="cursor-pointer font-medium select-none">
                              Snap centerline coordinates origin to vertical Z-minima (work outwards symmetrically)
                            </label>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Proximity Suppression Rules */}
                    <div className="flex flex-col gap-2.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle, #2d3748)' }}>
                      <h4 className="font-bold text-[10px] uppercase tracking-wider text-gray-400">
                        Proximity Suppression settings
                      </h4>

                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={op.suppression.enabled}
                          onChange={e =>
                            updateOpSuppression(index, { enabled: e.target.checked })
                          }
                          className="w-4 h-4 rounded accent-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          id={`suppress-check-${op.type}`}
                        />
                        <label
                          htmlFor={`suppress-check-${op.type}`}
                          className="cursor-pointer font-medium select-none"
                        >
                          Enable candidate proximity checking
                        </label>
                      </div>

                      {op.suppression.enabled && (
                        <div className="grid grid-cols-2 gap-3 mt-1 animate-fade-in">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 justify-between w-full">
                              <span>Suppression Distance (mm)</span>
                              {compOp && compOp.suppression.distanceMm !== op.suppression.distanceMm && (
                                <span className="text-[9px] text-[#A5A6B5] font-semibold bg-black/35 px-1.5 py-0.5 rounded">
                                  Last: {compOp.suppression.distanceMm.toFixed(1)} mm
                                </span>
                              )}
                            </div>
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={isNaN(op.suppression.distanceMm) ? '' : op.suppression.distanceMm}
                              onChange={e => {
                                const val = parseFloat(e.target.value);
                                updateOpSuppression(index, {
                                  distanceMm: isNaN(val) ? 0 : val,
                                });
                              }}
                              className="px-2.5 py-1.5 rounded border font-medium outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                              style={{
                                background: 'var(--surface-1, #151a22)',
                                borderColor: 'var(--border-subtle, #2d3748)',
                              }}
                            />
                          </div>

                          <div className="flex flex-col gap-1.5">
                            <span>Suppress Against Stages:</span>
                            <div className="flex flex-wrap gap-2">
                              {['minima', 'perimeter', 'infill', 'centerline'].map(t => {
                                const active = op.suppression.suppressAgainst.includes(t as any);
                                return (
                                  <button
                                    key={t}
                                    type="button"
                                    onClick={() => {
                                      const current = op.suppression.suppressAgainst;
                                      const next = current.includes(t as any)
                                        ? current.filter(x => x !== t)
                                        : [...current, t as any];
                                      updateOpSuppression(index, { suppressAgainst: next });
                                    }}
                                    className="text-[10px] font-semibold px-2 py-1 rounded border capitalize transition-colors"
                                    style={{
                                      background: active
                                        ? colorTheme
                                        : 'var(--surface-1, #151a22)',
                                      borderColor: active
                                        ? colorTheme
                                        : 'var(--border-subtle, #2d3748)',
                                      color: 'var(--text-strong)',
                                    }}
                                  >
                                    {t}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {op.type !== 'minima' && (
                      <div className="flex flex-col gap-2.5 border-t pt-3" style={{ borderColor: 'var(--border-subtle, #2d3748)' }}>
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={op.enableZHeightDensity || false}
                              onChange={e => {
                                const isChecked = e.target.checked;
                                const updates: any = {
                                  enableZHeightDensity: isChecked,
                                  isIntervalDirectlyEdited: true,
                                };
                                if (op.type === 'infill' && isChecked) {
                                  updates.suppression = {
                                    ...op.suppression,
                                    enabled: true,
                                    distanceMm: 0.1,
                                  };
                                }
                                updateOp(index, updates);
                              }}
                              className="w-4 h-4 rounded accent-accent cursor-pointer"
                              id={`zheight-check-${opKey}`}
                            />
                            <label
                              htmlFor={`zheight-check-${opKey}`}
                              className="cursor-pointer font-semibold select-none text-xs text-gray-200"
                            >
                              Enable Z-Height Tip Spacing
                            </label>
                          </div>
                          
                          {op.enableZHeightDensity && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-semibold text-gray-300">Scaling Curve</span>
                              <select
                                value={op.zFactorCurve ?? 'linear'}
                                onChange={e =>
                                  updateOp(index, { zFactorCurve: e.target.value as any, isIntervalDirectlyEdited: true })
                                }
                                className="px-2 py-1 rounded border font-semibold outline-none cursor-pointer text-[11px]"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                  color: 'var(--text-strong)',
                                }}
                              >
                                <option value="linear">Linear</option>
                                <option value="sigmoid">Sigmoidal</option>
                                <option value="parabolic">Parabolic</option>
                              </select>
                            </div>
                          )}
                        </div>

                        {op.enableZHeightDensity && (
                          <div className="grid grid-cols-2 gap-3 mt-1.5 animate-fade-in">
                            {/* Row 1: Starting Tip Spacing and End Tip Spacing */}
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-gray-300">Starting Tip Spacing (mm)</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.5"
                                value={isNaN(op.spacing.baseSpacingMm) ? '' : op.spacing.baseSpacingMm}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  const newBase = isNaN(val) ? 0 : val;
                                  const newSuppression = newBase > 0 ? Math.max(0.1, parseFloat((newBase - 0.1).toFixed(2))) : 0.1;
                                  const updates: any = {
                                    isIntervalDirectlyEdited: true,
                                    spacing: {
                                      ...op.spacing,
                                      baseSpacingMm: newBase,
                                    },
                                    suppression: {
                                      ...op.suppression,
                                      distanceMm: newSuppression,
                                    }
                                  };
                                  updateOp(index, updates);
                                }}
                                className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                }}
                              />
                            </div>

                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-gray-300">End Tip Spacing (mm)</span>
                              <input
                                type="number"
                                step="0.1"
                                min="0.5"
                                value={isNaN(op.endSpacingMm ?? 4.0) ? '' : (op.endSpacingMm ?? 4.0)}
                                onChange={e => {
                                  const val = parseFloat(e.target.value);
                                  updateOp(index, {
                                    endSpacingMm: isNaN(val) ? 4.0 : val,
                                    isIntervalDirectlyEdited: true,
                                  });
                                }}
                                className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                style={{
                                  background: 'var(--surface-1, #151a22)',
                                  borderColor: 'var(--border-subtle, #2d3748)',
                                }}
                              />
                            </div>

                            {/* Row 2: Start Offset (Z) (%) and End Offset (Z) (%) */}
                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-gray-300">Start Offset (Z) (%)</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={op.minimaStartInterval ?? 0}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      minimaStartInterval: isNaN(val) ? undefined : val,
                                      isIntervalDirectlyEdited: true,
                                    });
                                  }}
                                  className="flex-1 accent-accent h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-700"
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  max="100"
                                  value={op.minimaStartInterval === undefined ? '' : op.minimaStartInterval}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      minimaStartInterval: isNaN(val) ? undefined : val,
                                      isIntervalDirectlyEdited: true,
                                    });
                                  }}
                                  className="w-16 px-2 py-1 rounded border font-medium outline-none text-right"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <span className="font-semibold text-gray-300">End Offset (Z) (%)</span>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  step="1"
                                  value={typeof op.minimaEndInterval === 'number' ? op.minimaEndInterval : 100}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      minimaEndInterval: isNaN(val) ? undefined : val,
                                      isIntervalDirectlyEdited: true,
                                    });
                                  }}
                                  className="flex-1 accent-accent h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-700"
                                />
                                <input
                                  type="number"
                                  step="1"
                                  min="0"
                                  max="100"
                                  value={op.minimaEndInterval === undefined ? '' : op.minimaEndInterval}
                                  onChange={e => {
                                    const val = parseInt(e.target.value, 10);
                                    updateOp(index, {
                                      minimaEndInterval: isNaN(val) ? undefined : val,
                                      isIntervalDirectlyEdited: true,
                                    });
                                  }}
                                  className="w-16 px-2 py-1 rounded border font-medium outline-none text-right"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Consolidation & Branching settings */}
                    <div className="flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--border-subtle, #2d3748)' }}>
                      <h4 className="font-bold text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                        <GitMerge className="w-3.5 h-3.5" />
                        Consolidation & Branching settings
                      </h4>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Leaf Consolidation Toggle */}
                        <div className="col-span-2 flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={op.spacing.attemptLeafCreation || false}
                              onChange={e =>
                                updateOpSpacing(index, { attemptLeafCreation: e.target.checked })
                              }
                              className="w-4 h-4 rounded accent-accent cursor-pointer"
                              id={`leaf-check-${opKey}`}
                            />
                            <label htmlFor={`leaf-check-${opKey}`} className="cursor-pointer font-medium select-none text-[11px] text-gray-200">
                              Attempt leaf support creation (Tips Merging)
                            </label>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-normal pl-6">
                            Merge support tips into nearby existing trunks to form branch connections instead of full vertical columns.
                          </p>
                        </div>

                        {/* Leaf Search Interval */}
                        {op.spacing.attemptLeafCreation && (
                          <div className="col-span-2 flex flex-col gap-1 pl-6 animate-fade-in">
                            <span>Leaf Search Interval (mm)</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0.5"
                              value={op.spacing.leafInterval ?? op.spacing.baseSpacingMm}
                              onChange={e => {
                                const val = parseFloat(e.target.value);
                                updateOpSpacing(index, {
                                  leafInterval: isNaN(val) ? op.spacing.baseSpacingMm : val,
                                });
                              }}
                              className="px-2.5 py-1.5 rounded border font-medium outline-none"
                              style={{
                                background: 'var(--surface-1, #151a22)',
                                borderColor: 'var(--border-subtle, #2d3748)',
                              }}
                            />
                          </div>
                        )}

                        {/* Branch Consolidation Toggle */}
                        <div className="col-span-2 flex flex-col gap-1.5 border-t pt-2.5" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={op.spacing.attemptBranchCreation || false}
                              onChange={e =>
                                updateOpSpacing(index, { attemptBranchCreation: e.target.checked })
                              }
                              className="w-4 h-4 rounded accent-accent cursor-pointer"
                              id={`branch-check-${opKey}`}
                            />
                            <label htmlFor={`branch-check-${opKey}`} className="cursor-pointer font-medium select-none text-[11px] text-gray-200">
                              Attempt branch support consolidation (Shafts Merging)
                            </label>
                          </div>
                          <p className="text-[10px] text-gray-400 leading-normal pl-6">
                            Merge vertical support shafts near the base into a single, shared trunk structure.
                          </p>
                        </div>

                        {/* Branch Parameters */}
                        {op.spacing.attemptBranchCreation && (
                          <div className="col-span-2 flex flex-col gap-3 pl-6 animate-fade-in">
                            <div className="grid grid-cols-2 gap-3">
                              <div className="flex flex-col gap-1">
                                <span>Consolidation Min Z Height (mm)</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.0"
                                  value={op.spacing.consolidationMinZ ?? 8.0}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    updateOpSpacing(index, {
                                      consolidationMinZ: isNaN(val) ? 8.0 : val,
                                    });
                                  }}
                                  className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <span>Base Close Distance (mm)</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  value={op.spacing.consolidationBaseDistance ?? 2.0}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    updateOpSpacing(index, {
                                      consolidationBaseDistance: isNaN(val) ? 2.0 : val,
                                    });
                                  }}
                                  className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <span>Tip Close Distance (mm)</span>
                                <input
                                  type="number"
                                  step="0.1"
                                  min="0.1"
                                  value={op.spacing.consolidationTipDistance ?? 5.0}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    updateOpSpacing(index, {
                                      consolidationTipDistance: isNaN(val) ? 5.0 : val,
                                    });
                                  }}
                                  className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>

                              <div className="flex flex-col gap-1">
                                <span>Centroid Angle (theta) (°)</span>
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0.0"
                                  max="180.0"
                                  value={op.spacing.consolidationThetaAngle ?? 20.0}
                                  onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    updateOpSpacing(index, {
                                      consolidationThetaAngle: isNaN(val) ? 20.0 : val,
                                    });
                                  }}
                                  className="px-2.5 py-1.5 rounded border font-medium outline-none"
                                  style={{
                                    background: 'var(--surface-1, #151a22)',
                                    borderColor: 'var(--border-subtle, #2d3748)',
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </fieldset>
                )}
              </div>
            );
          })}
        </div>

        {/* Operation Stack Appender Controls */}
        <div className="flex flex-col gap-2 border-t pt-4 mt-3" style={{ borderColor: 'var(--border-subtle, #2d3748)' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            Append New Operation to Stack
          </span>
          <div className="flex flex-wrap gap-2">
            {(['minima', 'perimeter', 'infill', 'centerline'] as CustomSupportOperationType[]).map(type => {
              const label = type === 'minima' ? '+ Add Minima' : type === 'perimeter' ? '+ Add Perimeter' : type === 'infill' ? '+ Add Infill' : '+ Add Centerline';
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => addOp(type)}
                  disabled={isReadOnly}
                  className="text-xs font-semibold px-3 py-1.5 rounded border transition-colors hover:bg-black/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    borderColor: isReadOnly ? 'var(--text-muted, #718096)' : colorTheme,
                    color: isReadOnly ? 'var(--text-muted, #718096)' : colorTheme,
                    background: 'transparent',
                    opacity: isReadOnly ? 0.4 : 1,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  if (isEmbedded) {
    return renderContent();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-black/45 animate-fade-in"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <div
        className="w-full max-w-xl rounded-xl border flex flex-col max-h-[85vh] overflow-hidden shadow-2xl"
        style={{
          background: 'var(--surface-1, #151a22)',
          borderColor: 'var(--border-subtle, #2d3748)',
          color: 'var(--text-strong, #f7fafc)',
        }}
      >
        {/* Standalone Modal Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle, #2d3748)' }}
        >
          <div className="flex items-center gap-2">
            <Grid className="w-5 h-5" style={{ color: colorTheme }} />
            <h2 className="text-base font-bold">Configure Support Generation Sequence</h2>
          </div>
          {onClose && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPresetManagement(true)}
                className="!text-[11px] h-7 px-2.5 flex items-center gap-1.5"
              >
                Manage Presets
              </Button>
              <IconButton onClick={onClose} className="!p-1">
                <X className="w-4 h-4" />
              </IconButton>
            </div>
          )}
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          {renderContent()}
        </div>

        {/* Standalone Modal Footer */}
        <div
          className="flex items-center justify-end gap-2.5 px-5 py-4 border-t"
          style={{ borderColor: 'var(--border-subtle, #2d3748)' }}
        >
          {onClose && (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          {onSave && (
            <Button onClick={onSave} style={{ background: colorTheme, color: '#fff' }}>
              Apply Changes
            </Button>
          )}
        </div>
      </div>
      {showPresetManagement && (
        <SupportSequencePresetManagementModal onClose={() => setShowPresetManagement(false)} />
      )}
    </div>
  );
}
