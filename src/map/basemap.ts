import type { Map as MapLibreMap, LayerSpecification } from 'maplibre-gl';
import type { BasemapPatch } from '@/src/layers/types';

/**
 * Free, no API key, no request limit. Verified 2026-08-08.
 *
 * The 'dark' style ships NO fill-extrusion layer for buildings (only a flat
 * 'building' fill layer, minzoom 12) — unlike 'liberty', which we previously
 * relied on for its 'building-3d' layer. We fetched and inspected the actual
 * style JSON before switching:
 *   - sources.openmaptiles is a vector source at
 *     https://tiles.openfreemap.org/planet — the SAME url 'liberty' uses.
 *   - a 'building' source-layer exists in that source (dark's own flat
 *     'building' layer reads it, minzoom 12).
 *   - because the vector tile source URL is identical to liberty's, and
 *     liberty's 'building-3d' layer already reads render_height /
 *     render_min_height from that exact source-layer in production, those
 *     feature properties are present in the tile data regardless of which
 *     style is loaded. We therefore build our own extrusion layer below
 *     (buildingLayerSpec) rather than relying on one shipped by the style.
 */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/**
 * Our own extrusion layer id. Kept as 'building-3d' (liberty's original name)
 * for lowest churn — applyPatch/revertPatch and the future buildings-as-data
 * layer target it by this constant, not by hardcoding the id.
 */
export const BUILDING_LAYER_ID = 'building-3d';

/**
 * Our replacement for liberty's shipped 'building-3d' layer, since the dark
 * style doesn't ship one. Colour is a dark desaturated blue-grey chosen to
 * read against the near-black dark basemap (background rgb(12,12,12)) without
 * competing with the teal/amber/red/grey air-quality station markers.
 */
function buildingLayerSpec(): LayerSpecification {
  return {
    id: BUILDING_LAYER_ID,
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-base': ['get', 'render_min_height'],
      'fill-extrusion-color': 'hsl(215,18%,32%)',
      'fill-extrusion-height': ['get', 'render_height'],
      'fill-extrusion-opacity': 0.75,
    },
  } as LayerSpecification;
}

/**
 * Adds our fill-extrusion building layer if it isn't already present.
 * Idempotent — safe to call from multiple 'load'/'styledata' firings.
 * Inserted beneath the first symbol (label) layer, if any, so street/place
 * labels stay readable above the extruded buildings.
 */
export function ensureBuildingLayer(map: MapLibreMap): void {
  if (map.getLayer(BUILDING_LAYER_ID)) return;
  const labelLayer = map.getStyle()?.layers?.find((l) => l.type === 'symbol');
  map.addLayer(buildingLayerSpec(), labelLayer?.id);
}

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
      originals.set(key, map.getPaintProperty(patch.layerId, prop));
    }
    map.setPaintProperty(patch.layerId, prop, value);
  }
}

export function revertPatch(map: MapLibreMap, patch: BasemapPatch): void {
  if (!map.getLayer(patch.layerId)) return;
  for (const prop of Object.keys(patch.paint)) {
    const key = `${patch.layerId}::${prop}`;
    if (originals.has(key)) {
      map.setPaintProperty(patch.layerId, prop, originals.get(key));
      originals.delete(key);
    }
  }
}
