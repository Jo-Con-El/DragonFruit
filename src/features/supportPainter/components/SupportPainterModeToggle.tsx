import React from 'react';
import { WandSparkles } from 'lucide-react';
import { supportPainterStore, useSupportPainterState } from '../supportPainterStore';

export function SupportPainterModeToggle({ onModeChange }: { onModeChange?: (mode: string) => void }) {
  const state = useSupportPainterState();

  const handleToggle = () => {
    if (state.isActive) {
      supportPainterStore.deactivate();
      if (onModeChange) onModeChange('support');
    } else {
      supportPainterStore.activate();
      if (onModeChange) onModeChange('supportPainter');
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold tracking-wide transition-all duration-300 hover:scale-[1.01]"
      style={{
        background: state.isActive
          ? 'color-mix(in srgb, var(--accent) 15%, var(--surface-1))'
          : 'var(--surface-1)',
        borderColor: state.isActive ? 'var(--accent)' : 'var(--border-subtle)',
        color: state.isActive ? 'var(--accent)' : 'var(--text-strong)',
        boxShadow: state.isActive ? '0 0 12px color-mix(in srgb, var(--accent) 20%, transparent)' : 'none',
      }}
    >
      <WandSparkles className={`h-3.5 w-3.5 ${state.isActive ? 'animate-pulse' : ''}`} />
      <span>{state.isActive ? 'Exit Paint Mode' : 'Paint Support Regions'}</span>
    </button>
  );
}
