import type { Map as MapLibreMap } from 'maplibre-gl';
import type { BasemapPatch } from '@/src/layers/types';

/** Free, no API key, no request limit. Verified 2026-08-07. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Liberty's own extrusion layer: fill-extrusion on source-layer 'building', minzoom 14. */
export const BUILDING_LAYER_ID = 'building-3d';

const originals = new Map<string, unknown>();

/** Test-only cache reset. */
export function __resetBasemapCache() {
  originals.clear();
}

export function applyPatch(map: MapLibreMap, patch: BasemapPatch): void {
  if (!map.getLayer(patch.layerId)) return;
  for (const [prop, value] of Object.entries(patch.paint)) {
    const key = `${patch.layerId}::${prop}`;
    if (!originals.has(key)) {
      originals.set(key, map.getPaintProperty(patch.layerId, prop as never));
    }
    map.setPaintProperty(patch.layerId, prop as never, value as never);
  }
}

export function revertPatch(map: MapLibreMap, patch: BasemapPatch): void {
  if (!map.getLayer(patch.layerId)) return;
  for (const prop of Object.keys(patch.paint)) {
    const key = `${patch.layerId}::${prop}`;
    if (originals.has(key)) {
      map.setPaintProperty(patch.layerId, prop as never, originals.get(key) as never);
      originals.delete(key);
    }
  }
}
