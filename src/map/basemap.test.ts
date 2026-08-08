import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPatch, revertPatch, BUILDING_LAYER_ID, __resetBasemapCache } from './basemap';

function fakeMap(originalValue: string = 'hsl(35,8%,85%)') {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    getLayer: () => ({ id: BUILDING_LAYER_ID }),
    getPaintProperty: vi.fn(() => originalValue),
    setPaintProperty: (l: string, p: string, v: unknown) => calls.push([l, p, v]),
  };
}

describe('basemap patching', () => {
  beforeEach(() => __resetBasemapCache());

  it('applies each paint property to the named layer', () => {
    const map = fakeMap();
    applyPatch(map as never, {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    });
    expect(map.calls).toEqual([[BUILDING_LAYER_ID, 'fill-extrusion-color', '#ff0000']]);
  });

  it('restores the original value on revert', () => {
    // Deliberately a different original value from the previous test's fake
    // map, so this assertion can only pass if the module-level `originals`
    // cache was reset between tests — a stale cache would restore the wrong
    // colour here.
    const map = fakeMap('hsl(200,50%,40%)');
    const patch = {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    };
    applyPatch(map as never, patch);
    revertPatch(map as never, patch);
    expect(map.getPaintProperty).toHaveBeenCalledWith(BUILDING_LAYER_ID, 'fill-extrusion-color');
    expect(map.calls[1]).toEqual([BUILDING_LAYER_ID, 'fill-extrusion-color', 'hsl(200,50%,40%)']);
  });

  it('is a no-op when the target layer is absent', () => {
    const map = { ...fakeMap(), getLayer: () => undefined };
    expect(() =>
      applyPatch(map as never, { layerId: 'nope', paint: { a: 1 } }),
    ).not.toThrow();
  });
});
