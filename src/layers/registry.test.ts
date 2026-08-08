import { describe, it, expect } from 'vitest';
import { registry, getLayer } from './registry';

describe('layer registry', () => {
  it('every manifest satisfies the contract', () => {
    for (const layer of registry) {
      expect(typeof layer.id).toBe('string');
      expect(layer.id.length).toBeGreaterThan(0);
      expect(typeof layer.label).toBe('string');
      expect(typeof layer.description).toBe('string');
      expect(typeof layer.render).toBe('function');
      expect(layer.Legend).toBeTruthy();
      expect(['full', 'reduced', 'off']).toContain(layer.budget.mobile);
      if (layer.refresh) {
        expect(layer.refresh.intervalMs).toBeGreaterThan(0);
        expect(layer.refresh.staleAfterMs).toBeGreaterThan(layer.refresh.intervalMs);
      }
    }
  });

  it('has no duplicate ids', () => {
    const ids = registry.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a layer by id', () => {
    if (registry.length > 0) {
      expect(getLayer(registry[0].id)).toBe(registry[0]);
    }
    expect(getLayer('nope')).toBeUndefined();
  });
});
