'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { registry } from '@/src/layers/registry';
import { MONTREAL } from '@/src/cities/montreal';
import type { LayerContext, LayerStatus, ViewState } from '@/src/layers/types';
import { DEFAULT_URL_STATE, parseUrlState, toSearchParams } from './useUrlState';
import { IDLE, useLayersData } from './useLayersData';
import LayerToggles from './LayerToggles';

// ~400 KB gzipped — must not block first paint.
const MapCanvas = dynamic(() => import('@/src/map/MapCanvas'), { ssr: false });

export default function Shell() {
  const [urlState, setUrlState] = useState(DEFAULT_URL_STATE);

  useEffect(() => { setUrlState(parseUrlState(window.location.search)); }, []);

  useEffect(() => {
    const qs = toSearchParams(urlState).toString();
    window.history.replaceState(null, '', `?${qs}`);
  }, [urlState]);

  const ctx: LayerContext = useMemo(() => ({
    city: MONTREAL,
    time: { now: new Date(), window: 'now' },
    view: urlState.view,
    device: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
    options: {},
  }), [urlState.view]);

  // One hook, looping internally — never a hook per layer inside .map().
  const states = useLayersData(registry, ctx, urlState.layers);
  const stateOf = (id: string) => states[id] ?? IDLE;

  const deckLayers = registry.flatMap((m) =>
    urlState.layers.includes(m.id) ? m.render(stateOf(m.id).data, ctx) : []);

  const patches = registry.flatMap((m) =>
    urlState.layers.includes(m.id) && m.basemapPatch
      ? [m.basemapPatch(stateOf(m.id).data, ctx)] : []);

  const statuses = Object.fromEntries(
    registry.map((m) => [m.id, stateOf(m.id).status]),
  ) as Record<string, LayerStatus>;

  const setView = (view: ViewState) => setUrlState((s) => ({ ...s, view }));
  const toggle = (id: string) => setUrlState((s) => ({
    ...s,
    layers: s.layers.includes(id) ? s.layers.filter((x) => x !== id) : [...s.layers, id],
  }));

  return (
    <main className="fixed inset-0 bg-slate-950 text-white">
      <MapCanvas
        layers={deckLayers}
        patches={patches}
        viewState={urlState.view}
        onViewStateChange={setView}
      />
      <div className="absolute left-4 top-4 z-10 w-64 space-y-3 rounded-xl
                      bg-slate-900/80 p-3 backdrop-blur">
        <h1 className="text-sm font-semibold">{MONTREAL.name}</h1>
        <LayerToggles
          layers={registry}
          enabled={urlState.layers}
          statuses={statuses}
          onToggle={toggle}
        />
        <div className="space-y-3" data-testid="legend-slot">
          {registry.map((m) =>
            urlState.layers.includes(m.id) ? (
              <div key={m.id} data-testid={`legend-${m.id}`}>
                {stateOf(m.id).status === 'error' ? (
                  <p className="text-xs text-red-400">
                    {m.label} unavailable — {stateOf(m.id).error}
                  </p>
                ) : (
                  <m.Legend data={stateOf(m.id).data} ctx={ctx} />
                )}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </main>
  );
}
