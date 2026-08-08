import type { ViewState } from '@/src/layers/types';
import { MONTREAL } from '@/src/cities/montreal';
import { registry } from '@/src/layers/registry';

export interface UrlState {
  layers: string[];
  view: ViewState;
}

export const DEFAULT_URL_STATE: UrlState = {
  layers: [...MONTREAL.layers],
  view: {
    longitude: MONTREAL.center[0],
    latitude: MONTREAL.center[1],
    ...MONTREAL.defaultCamera,
  },
};

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const known = new Set(registry.map((l) => l.id));

  const raw = p.get('layers');
  const layers = raw === null
    ? DEFAULT_URL_STATE.layers
    : raw.split(',').filter((id) => known.has(id));

  let view = DEFAULT_URL_STATE.view;
  const at = p.get('at')?.split(',').map(Number);
  if (at && at.length === 5 && at.every(Number.isFinite)) {
    view = { latitude: at[0], longitude: at[1], zoom: at[2], pitch: at[3], bearing: at[4] };
  }

  return { layers, view };
}

export function toSearchParams(state: UrlState): URLSearchParams {
  const v = state.view;
  const round = (n: number, d = 4) => Number(n.toFixed(d));
  return new URLSearchParams({
    layers: state.layers.join(','),
    at: [round(v.latitude), round(v.longitude), round(v.zoom, 2),
         round(v.pitch, 1), round(v.bearing, 1)].join(','),
  });
}
