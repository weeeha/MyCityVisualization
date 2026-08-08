import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer as DeckLayer } from '@deck.gl/core';
import type { LayerContext } from '../types';
import type { AirPayload, AirStation } from './schema';
import { bandFor } from './normalise';

export function renderAir(
  data: AirPayload | null,
  ctx: LayerContext,
): DeckLayer[] {
  if (!data || data.stations.length === 0) return [];

  return [
    new ScatterplotLayer<AirStation>({
      id: 'air-stations',
      data: data.stations,
      pickable: true,
      radiusUnits: 'meters',
      radiusMinPixels: 8,
      radiusMaxPixels: 60,
      getPosition: (s) => [s.lon, s.lat],
      getRadius: () => (ctx.device === 'mobile' ? 700 : 1000),
      getFillColor: (s) => bandFor(s.aqi).color,
      stroked: true,
      lineWidthMinPixels: 1.5,
      getLineColor: [255, 255, 255, 160],
      updateTriggers: { getFillColor: data.asOf },
    }),
  ];
}
