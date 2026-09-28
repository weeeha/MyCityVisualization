import { describe, it, expect } from 'vitest';
import { registry } from '@/src/layers/registry';
import { parseUrlState, toSearchParams, DEFAULT_URL_STATE } from './useUrlState';

// Derived from the registry, not hardcoded, so these tests stay meaningful
// (and don't false-pass on an empty registry) if the air layer is ever
// deleted — see the architectural rule that src/shell may not import a
// specific layer, only the registry.
const layerId = registry[0]?.id;
const describeOrSkip = layerId ? describe : describe.skip;

describeOrSkip('url state', () => {
  it('falls back to defaults when the query is empty', () => {
    expect(parseUrlState('')).toEqual(DEFAULT_URL_STATE);
  });

  it('parses enabled layers and camera', () => {
    const s = parseUrlState(`?layers=${layerId}&at=45.5088,-73.5678,15,60,-20`);
    expect(s.layers).toEqual([layerId]);
    expect(s.view).toEqual({
      latitude: 45.5088, longitude: -73.5678, zoom: 15, pitch: 60, bearing: -20,
    });
  });

  it('round-trips without loss', () => {
    const s = parseUrlState(`?layers=${layerId}&at=45.5,-73.5,14,50,10`);
    expect(parseUrlState('?' + toSearchParams(s).toString())).toEqual(s);
  });

  it('ignores unknown layer ids rather than crashing', () => {
    expect(parseUrlState(`?layers=${layerId},bogus`).layers).toEqual([layerId]);
  });

  it('ignores a malformed camera', () => {
    expect(parseUrlState('?at=garbage').view).toEqual(DEFAULT_URL_STATE.view);
  });
});
