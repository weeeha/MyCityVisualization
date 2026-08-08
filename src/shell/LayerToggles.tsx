'use client';

import type { LayerManifest, LayerStatus } from '@/src/layers/types';

const DOT: Record<LayerStatus, string> = {
  idle: 'bg-slate-500', loading: 'bg-sky-400 animate-pulse',
  ready: 'bg-emerald-400', stale: 'bg-amber-400', error: 'bg-red-500',
};

export default function LayerToggles({
  layers, enabled, statuses, onToggle,
}: {
  layers: LayerManifest<any, any>[];
  enabled: string[];
  statuses: Record<string, LayerStatus>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {layers.map((l) => (
        <button
          key={l.id}
          onClick={() => onToggle(l.id)}
          title={l.description}
          data-testid={`toggle-${l.id}`}
          aria-pressed={enabled.includes(l.id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm
            ${enabled.includes(l.id)
              ? 'bg-white/15 text-white'
              : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
        >
          <span className={`h-2 w-2 rounded-full ${DOT[statuses[l.id] ?? 'idle']}`} />
          {l.label}
        </button>
      ))}
    </div>
  );
}
