import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normaliseRsqaCsv, bandFor } from './normalise';

const csv = readFileSync('fixtures/rsqa-iqa-by-station.csv', 'utf8');

describe('normaliseRsqaCsv', () => {
  const payload = normaliseRsqaCsv(csv);

  it('selects the latest hour present, not the first', () => {
    expect(payload.asOf).toBe('2026-08-07T01:00');
  });

  it('returns one entry per station', () => {
    expect(payload.stations).toHaveLength(3);
    expect(new Set(payload.stations.map((s) => s.stationId)).size).toBe(3);
  });

  it('keeps zero-padded station ids as strings', () => {
    const ids = payload.stations.map((s) => s.stationId);
    expect(ids).toContain('06');
    expect(ids).not.toContain(6 as unknown as string);
  });

  it('takes AQI as the max sub-index across pollutants', () => {
    const s80 = payload.stations.find((s) => s.stationId === '80')!;
    expect(s80.pollutants).toEqual({ O3: 31, PM: 18 });
    expect(s80.aqi).toBe(31);
  });

  it('represents a missing reading as null, never 0', () => {
    const s99 = payload.stations.find((s) => s.stationId === '99')!;
    expect(s99.aqi).toBeNull();
    expect(s99.aqi).not.toBe(0);
  });

  it('preserves coordinates as numbers', () => {
    const s06 = payload.stations.find((s) => s.stationId === '06')!;
    expect(s06.lat).toBeCloseTo(45.602846, 5);
    expect(s06.lon).toBeCloseTo(-73.558874, 5);
  });

  it('reports honest metadata about coverage', () => {
    expect(payload.meta.stationCount).toBe(3);
    expect(payload.meta.pollutants.sort()).toEqual(['O3', 'PM']);
  });

  it('accepts the French column names from the dataset docs', () => {
    const french = csv
      .replace('address', 'adresse')
      .replace('pollutant', 'polluant');
    expect(normaliseRsqaCsv(french).stations).toHaveLength(3);
  });
});

describe('bandFor', () => {
  it('maps values to Québec IQA bands', () => {
    expect(bandFor(14).id).toBe('good');
    expect(bandFor(31).id).toBe('acceptable');
    expect(bandFor(55).id).toBe('poor');
  });

  it('maps a missing reading to its own band, not to good', () => {
    expect(bandFor(null).id).toBe('unknown');
  });
});
