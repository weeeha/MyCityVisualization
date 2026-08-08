'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { registry } from '@/src/layers/registry';
import { MONTREAL } from '@/src/cities/montreal';
import type { LayerContext, LayerStatus, ViewState } from '@/src/layers/types';
import { parseUrlState, toSearchParams, type UrlState } from './useUrlState';
import { IDLE, useLayersData } from './useLayersData';
import LayerToggles from './LayerToggles';

// ~400 KB gzipped — must not block first paint.
const MapCanvas = dynamic(() => import('@/src/map/MapCanvas'), { ssr: false });

// The URL is the single source of truth for shell state — there is no
// separate React state to desync from it. useSyncExternalStore reads
// window.location.search directly; the empty server snapshot parses to
// DEFAULT_URL_STATE (see useUrlState.test.ts), so hydration matches.
// window.history.replaceState() does not fire 'popstate' on its own, so our
// own writes dispatch a matching synthetic event alongside real browser
// back/forward navigation — both funnel through the same subscription.
const URL_CHANGE_EVENT = 'shell:urlchange';

function subscribeToUrl(onStoreChange: () => void) {
  window.addEventListener('popstate', onStoreChange);
  window.addEventListener(URL_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('popstate', onStoreChange);
    window.removeEventListener(URL_CHANGE_EVENT, onStoreChange);
  };
}

const getUrlSnapshot = () => window.location.search;
const getServerUrlSnapshot = () => '';

export default function Shell() {
  const search = useSyncExternalStore(subscribeToUrl, getUrlSnapshot, getServerUrlSnapshot);
  const urlState = useMemo(() => parseUrlState(search), [search]);

  const writeUrlState = useCallback((next: UrlState) => {
    const qs = toSearchParams(next).toString();
    window.history.replaceState(null, '', `?${qs}`);
    window.dispatchEvent(new Event(URL_CHANGE_EVENT));
  }, []);

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

  // Read the URL fresh at call time rather than closing over the render's
  // `urlState`. MapCanvas's moveend handler and this toggle can both fire
  // after a stale render — a closure-captured snapshot from either would
  // silently overwrite whatever the other one wrote since. Reading
  // window.location.search live makes each write a delta on top of
  // whatever is actually there right now, not a snapshot from render time.
  const setView = (view: ViewState) =>
    writeUrlState({ ...parseUrlState(window.location.search), view });
  const toggle = (id: string) => {
    const current = parseUrlState(window.location.search);
    writeUrlState({
      ...current,
      layers: current.layers.includes(id)
        ? current.layers.filter((x) => x !== id)
        : [...current.layers, id],
    });
  };

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
