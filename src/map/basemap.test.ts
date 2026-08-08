import { describe, it, expect, vi } from 'vitest';
import { applyPatch, revertPatch, BUILDING_LAYER_ID } from './basemap';

function fakeMap() {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    getLayer: () => ({ id: BUILDING_LAYER_ID }),
    getPaintProperty: vi.fn(() => 'hsl(35,8%,85%)'),
    setPaintProperty: (l: string, p: string, v: unknown) => calls.push([l, p, v]),
  };
}

describe('basemap patching', () => {
  it('applies each paint property to the named layer', () => {
    const map = fakeMap();
    applyPatch(map as never, {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    });
    expect(map.calls).toEqual([[BUILDING_LAYER_ID, 'fill-extrusion-color', '#ff0000']]);
  });

  it('restores the original value on revert', () => {
    const map = fakeMap();
    const patch = {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    };
    applyPatch(map as never, patch);
    revertPatch(map as never, patch);
    expect(map.calls[1]).toEqual([BUILDING_LAYER_ID, 'fill-extrusion-color', 'hsl(35,8%,85%)']);
  });

  it('is a no-op when the target layer is absent', () => {
    const map = { ...fakeMap(), getLayer: () => undefined };
    expect(() =>
      applyPatch(map as never, { layerId: 'nope', paint: { a: 1 } }),
    ).not.toThrow();
  });
});
