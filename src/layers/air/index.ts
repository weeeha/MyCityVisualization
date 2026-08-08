import type { LayerManifest } from '../types';
import type { AirPayload, AirStation } from './schema';
import { renderAir } from './render';
import AirLegend from './Legend';

export const airLayer: LayerManifest<AirPayload, AirStation> = {
  id: 'air',
  label: 'Air quality',
  description: 'Hourly index from the City of Montréal RSQA monitoring network',
  refresh: { intervalMs: 5 * 60_000, staleAfterMs: 90 * 60_000 },

  async fetch(_ctx, signal) {
    const res = await fetch('/api/layers/air', { signal });
    if (!res.ok) throw new Error(`air layer unavailable (${res.status})`);
    return (await res.json()) as AirPayload;
  },

  render: renderAir,
  Legend: AirLegend,

  detail: (station) => ({
    title: station.address || `Station ${station.stationId}`,
    subtitle: `Station ${station.stationId}`,
    rows: [
      { label: 'Index', value: station.aqi === null ? 'No reading' : String(station.aqi) },
      ...Object.entries(station.pollutants).map(([k, v]) => ({
        label: k,
        value: v === null ? 'No reading' : String(v),
      })),
    ],
  }),

  budget: { mobile: 'full' },
};
