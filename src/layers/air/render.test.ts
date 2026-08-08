import { describe, it, expect } from 'vitest';
import { renderAir } from './render';
import { UNKNOWN_BAND } from './normalise';
import type { AirPayload } from './schema';
import type { LayerContext } from '../types';
import { MONTREAL } from '@/src/cities/montreal';

const ctx: LayerContext = {
  city: MONTREAL,
  time: { now: new Date('2026-08-07T18:00:00Z'), window: 'now' },
  view: { longitude: -73.56, latitude: 45.50, zoom: 12, pitch: 50, bearing: 0 },
  device: 'desktop',
  options: {},
};

const payload: AirPayload = {
  asOf: '2026-08-07T01:00',
  stations: [
    { stationId: '80', address: 'a', lat: 45.54, lon: -73.57, aqi: 31,   pollutants: { O3: 31 }, hour: 1 },
    { stationId: '99', address: 'b', lat: 45.42, lon: -73.92, aqi: null, pollutants: { O3: null }, hour: 1 },
  ],
  meta: { stationCount: 2, pollutants: ['O3'], source: 'x' },
};

describe('renderAir', () => {
  it('produces one scatterplot layer', () => {
    const layers = renderAir(payload, ctx);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('air-stations');
  });

  it('is pure — repeated calls give equal data', () => {
    expect(renderAir(payload, ctx)[0].props.data)
      .toEqual(renderAir(payload, ctx)[0].props.data);
  });

  it('colours a missing reading with the unknown band, not the good band', () => {
    const { getFillColor } = renderAir(payload, ctx)[0].props as unknown as {
      getFillColor: (s: (typeof payload.stations)[number]) => number[];
    };
    expect(getFillColor(payload.stations[1])).toEqual(UNKNOWN_BAND.color);
  });

  it('returns no layers when data is null', () => {
    expect(renderAir(null, ctx)).toEqual([]);
  });
});
