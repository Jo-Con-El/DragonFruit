import React, { useState, useRef, useEffect } from 'react';
import { X, Trash2, Edit2, Download, Upload, Check, ChevronRight } from 'lucide-react';
import { IconButton, Button } from '@/components/ui/primitives';
import { supportPainterStore, useSupportPainterState } from '../supportPainterStore';
import { type SupportPlacementScript, type BrushType, type CustomSupportOperation } from '../supportPainterTypes';
import {
  pickSavePathWithNativeDialogOptions,
  pickOpenFilesWithNativeDialog,
  writeBytesToNativePath,
  readPrintArtifactBytesFromPath,
} from '@/features/slicing/tauri/nativeSlicerBridge';

interface SupportSequencePresetManagementModalProps {
  onClose: () => void;
}

export function SupportSequencePresetManagementModal({
  onClose,
}: SupportSequencePresetManagementModalProps) {
  const state = useSupportPainterState();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allScripts = Array.from(state.placementScripts.values());

  const getStagesListString = (script: SupportPlacementScript) => {
    const enabledOps = script.operations.filter((op) => op.enabled);
    if (enabledOps.length === 0) return 'No stages enabled';
    const names = enabledOps.map((op) => {
      switch (op.type) {
        case 'minima':
          return 'Minima';
        case 'perimeter':
          return 'Perimeter';
        case 'infill':
          return 'Infill';
        case 'centerline':
          return 'Centerline';
        default:
          return op.type;
      }
    });
    return names.join(' → ');
  };

  const handleRowClick = (e: React.MouseEvent, id: string, index: number) => {
    e.stopPropagation();
    const newSelection = new Set(selectedIds);

    if (e.ctrlKey || e.metaKey) {
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
    } else if (e.altKey) {
      newSelection.delete(id);
    } else if (e.shiftKey && lastClickedId !== null) {
      const lastIndex = allScripts.findIndex((s) => s.id === lastClickedId);
      if (lastIndex !== -1) {
        const start = Math.min(lastIndex, index);
        const end = Math.max(lastIndex, index);
        for (let i = start; i <= end; i++) {
          newSelection.add(allScripts[i].id);
        }
      }
    } else {
      newSelection.clear();
      newSelection.add(id);
    }

    setSelectedIds(newSelection);
    setLastClickedId(id);
  };

  const handleStartRename = (script: SupportPlacementScript, e: React.MouseEvent) => {
    e.stopPropagation();
    if (script.isBuiltIn) return;
    setRenamingId(script.id);
    setRenameInput(script.name);
  };

  const handleSaveRename = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const name = renameInput.trim();
    if (name) {
      supportPainterStore.updatePlacementScript(id, { name });
      supportPainterStore.showToast([`Renamed script to "${name}"`]);
    }
    setRenamingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(null);
  };

  const handleDeleteScript = (script: SupportPlacementScript, e: React.MouseEvent) => {
    e.stopPropagation();
    if (script.isBuiltIn) return;
    if (confirm(`Are you sure you want to delete the script "${script.name}"?`)) {
      supportPainterStore.deletePlacementScript(script.id);
      supportPainterStore.showToast([`Deleted placement script "${script.name}"`]);
      const newSelection = new Set(selectedIds);
      newSelection.delete(script.id);
      setSelectedIds(newSelection);
    }
  };

  const handleExportScript = async (script: SupportPlacementScript, e: React.MouseEvent) => {
    e.stopPropagation();
    const content = JSON.stringify(script, null, 2);
    const filename = `${script.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const path = await pickSavePathWithNativeDialogOptions(filename, {
          filters: [{ name: 'Placement Script', extensions: ['json'] }],
        });
        if (path) {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(content);
          await writeBytesToNativePath(path, bytes);
          supportPainterStore.showToast([`Successfully exported script to ${path}`]);
        }
      } catch (err: any) {
        console.error('[PresetManagement] Export failed', err);
      }
    } else {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleBulkDelete = () => {
    const toDelete = Array.from(selectedIds).filter((id) => {
      const script = state.placementScripts.get(id);
      return script && !script.isBuiltIn;
    });

    if (toDelete.length === 0) {
      supportPainterStore.showToast(['No custom (deletable) scripts selected.']);
      return;
    }

    if (confirm(`Are you sure you want to delete the ${toDelete.length} selected custom scripts?`)) {
      for (const id of toDelete) {
        supportPainterStore.deletePlacementScript(id);
      }
      const newSelection = new Set(selectedIds);
      toDelete.forEach((id) => newSelection.delete(id));
      setSelectedIds(newSelection);
      supportPainterStore.showToast([`Deleted ${toDelete.length} placement scripts.`]);
    }
  };

  const handleBulkExport = async () => {
    const selectedScripts = Array.from(selectedIds)
      .map((id) => state.placementScripts.get(id))
      .filter(Boolean) as SupportPlacementScript[];

    if (selectedScripts.length === 0) {
      supportPainterStore.showToast(['No scripts selected to export.']);
      return;
    }

    const content = JSON.stringify(selectedScripts, null, 2);
    const filename = `exported_scripts_${Date.now()}.json`;

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const path = await pickSavePathWithNativeDialogOptions(filename, {
          filters: [{ name: 'Placement Scripts', extensions: ['json'] }],
        });
        if (path) {
          const encoder = new TextEncoder();
          const bytes = encoder.encode(content);
          await writeBytesToNativePath(path, bytes);
          supportPainterStore.showToast([`Successfully exported ${selectedScripts.length} scripts to ${path}`]);
        }
      } catch (err: any) {
        console.error('[PresetManagement] Bulk export failed', err);
      }
    } else {
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImportClick = () => {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      handleImportTauri();
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleImportTauri = async () => {
    try {
      const picked = await pickOpenFilesWithNativeDialog('bundle', false);
      if (picked && picked.length > 0) {
        const filePath = picked[0].path;
        const bytes = await readPrintArtifactBytesFromPath(filePath);
        const decoder = new TextDecoder();
        const content = decoder.decode(bytes);
        processImportText(content);
      }
    } catch (err: any) {
      if (err !== 'Open cancelled by user' && err?.message !== 'Open cancelled by user') {
        console.error('[PresetManagement] Tauri import error:', err);
        supportPainterStore.showToast([`Import failed: ${err?.message || err}`]);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        if (text) {
          processImportText(text);
        }
      };
      reader.readAsText(file);
    }
  };

  const processImportText = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      let importedScripts: SupportPlacementScript[] = [];

      if (parsed.kind === 'dragonfruit-config-pack') {
        importedScripts = parsed.placementScripts || [];
      } else if (Array.isArray(parsed)) {
        importedScripts = parsed;
      } else if (parsed && typeof parsed === 'object' && parsed.id && parsed.name && parsed.operations) {
        importedScripts = [parsed];
      } else {
        supportPainterStore.showToast(['Invalid file format. Ensure it contains support scripts.']);
        return;
      }

      let importCount = 0;
      for (const script of importedScripts) {
        if (!script.id || !script.name || !Array.isArray(script.operations)) continue;

        const existing = state.placementScripts.get(script.id);
        let finalId = script.id;
        let finalName = script.name;

        if (existing) {
          if (existing.isBuiltIn) {
            finalId = crypto.randomUUID?.() || Math.random().toString(36).substring(2);
            finalName = `${script.name} (Imported)`;
          } else {
            // Overwrite existing custom script or prompt. Let's auto-generate copy or overwrite.
            // Overwriting is default if same custom ID, but let's append copy if name clashes elsewhere.
          }
        }

        supportPainterStore.addPlacementScript({
          id: finalId,
          name: finalName,
          operations: script.operations,
          isBuiltIn: false,
        });
        importCount++;
      }

      supportPainterStore.showToast([`Successfully imported ${importCount} placement script(s)`]);
    } catch (err: any) {
      supportPainterStore.showToast(['Failed to import scripts: ' + (err?.message || err)]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-black/45 animate-fade-in"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      <div
        className="w-full max-w-xl rounded-xl border flex flex-col max-h-[80vh] overflow-hidden shadow-2xl"
        style={{
          background: 'var(--surface-1, #151a22)',
          borderColor: 'var(--border-subtle, #2d3748)',
          color: 'var(--text-strong, #f7fafc)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle, #2d3748)' }}
        >
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-bold">Support Sequence Preset Management</h2>
            <span className="text-[10px] text-gray-400">
              Bulk selections: &lt;Ctrl&gt;+click (add/toggle), &lt;Alt&gt;+click (remove), &lt;Shift&gt;+click (range)
            </span>
          </div>
          <IconButton onClick={onClose} className="!p-1">
            <X className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Action Buttons Toolbar */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{
            borderColor: 'var(--border-subtle, #2d3748)',
            background: 'var(--surface-2, #0d1117)',
          }}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkExport}
              disabled={selectedIds.size === 0}
              className="!text-[11px] h-7 px-2.5 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export Selected ({selectedIds.size})
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0}
              className="!text-[11px] h-7 px-2.5 flex items-center gap-1.5 text-red-400 hover:text-red-300"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected
            </Button>
          </div>
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleImportClick}
              className="!text-[11px] h-7 px-2.5 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Scripts
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* Body Preset List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin flex flex-col gap-2">
          {allScripts.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-xs">
              No placement scripts configured.
            </div>
          ) : (
            allScripts.map((script, index) => {
              const isSelected = selectedIds.has(script.id);
              const isRenaming = renamingId === script.id;

              return (
                <div
                  key={script.id}
                  onClick={(e) => handleRowClick(e, script.id, index)}
                  className={`flex items-center justify-between p-3 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-border-subtle/50 hover:bg-white/5'
                  }`}
                  style={{
                    borderColor: isSelected ? 'var(--accent, #4a90e2)' : 'var(--border-subtle, #2d3748)',
                  }}
                >
                  <div className="flex flex-col min-w-0 flex-1 pr-4">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={renameInput}
                          onChange={(e) => setRenameInput(e.target.value)}
                          className="bg-surface-2 text-text-strong text-[11px] px-2 py-0.5 rounded border border-border-subtle outline-none"
                          style={{
                            background: 'var(--surface-2, #0d1117)',
                            borderColor: 'var(--border-subtle, #2d3748)',
                            color: 'var(--text-strong, #f3f4f6)',
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(script.id, e as any);
                            else if (e.key === 'Escape') handleCancelRename(e as any);
                          }}
                        />
                        <IconButton
                          onClick={(e) => handleSaveRename(script.id, e)}
                          className="!p-0.5 text-green-500 hover:bg-black/20"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton
                          onClick={handleCancelRename}
                          className="!p-0.5 text-red-500 hover:bg-black/20"
                        >
                          <X className="w-3.5 h-3.5" />
                        </IconButton>
                      </div>
                    ) : (
                      <span className="font-semibold text-text-strong truncate">
                        {script.name}
                        {script.isBuiltIn && (
                          <span className="ml-1.5 px-1 py-0.2 text-[8px] bg-gray-700/50 text-gray-400 rounded">
                            Built-in
                          </span>
                        )}
                      </span>
                    )}
                    <span className="text-[10px] text-gray-400 mt-0.5 truncate">
                      {getStagesListString(script)}
                    </span>
                  </div>

                  {/* Inline Action Icons */}
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!script.isBuiltIn && !isRenaming && (
                      <>
                        <IconButton
                          onClick={(e) => handleStartRename(script, e)}
                          title="Rename Script"
                          className="!p-1 hover:bg-black/20 text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </IconButton>
                        <IconButton
                          onClick={(e) => handleDeleteScript(script, e)}
                          title="Delete Script"
                          className="!p-1 hover:bg-black/20 text-red-400 hover:text-red-300"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </IconButton>
                      </>
                    )}
                    <IconButton
                      onClick={(e) => handleExportScript(script, e)}
                      title="Export Script JSON"
                      className="!p-1 hover:bg-black/20 text-gray-400 hover:text-white"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end px-5 py-4 border-t"
          style={{ borderColor: 'var(--border-subtle, #2d3748)' }}
        >
          <Button variant="secondary" onClick={onClose} className="!text-xs">
            Close preset manager
          </Button>
        </div>
      </div>
    </div>
  );
}
