import Papa from 'papaparse';
import type { AirPayload, AirStation, AqiBand } from './schema';

export const SOURCE_URL =
  'https://donnees.montreal.ca/dataset/3e9f7b96-3f25-4404-a5ad-22d9a31060e6/' +
  'resource/6554355e-63d1-4a01-a268-91e0763c3606/download/iqa-by-station.csv';

/**
 * Québec IQA is LOW-IS-GOOD. Thresholds per the published convention:
 * 1-25 good, 26-50 acceptable, 51+ poor.
 * See spec §10 open item 2 — confirm against RSQA methodology.
 * Changing the ramp means editing only this constant.
 */
export const AQI_BANDS: AqiBand[] = [
  { id: 'good',       label: 'Good (1–25)',       max: 25,       color: [ 56, 178, 172, 200] },
  { id: 'acceptable', label: 'Acceptable (26–50)', max: 50,       color: [214, 158,  46, 200] },
  { id: 'poor',       label: 'Poor (51+)',         max: Infinity, color: [197,  48,  48, 200] },
];

export const UNKNOWN_BAND: AqiBand = {
  id: 'unknown',
  label: 'No reading',
  max: Infinity,
  color: [90, 100, 120, 120],
};

export function bandFor(aqi: number | null): AqiBand {
  if (aqi === null || Number.isNaN(aqi)) return UNKNOWN_BAND;
  return AQI_BANDS.find((b) => aqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

interface RawRow {
  stationId?: string;
  address?: string;
  adresse?: string;
  latitude?: string;
  longitude?: string;
  pollutant?: string;
  polluant?: string;
  valeur?: string;
  date?: string;
  heure?: string;
}

/** Empty string, whitespace or a non-numeric cell becomes null — never 0. */
function toValue(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function normaliseRsqaCsv(csv: string): AirPayload {
  const { data } = Papa.parse<RawRow>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const rows = data.filter((r) => r.stationId);
  if (rows.length === 0) {
    return {
      asOf: null,
      stations: [],
      meta: { stationCount: 0, pollutants: [], source: SOURCE_URL },
    };
  }

  const maxHour = Math.max(...rows.map((r) => Number(r.heure ?? 0)));
  const latest = rows.filter((r) => Number(r.heure ?? 0) === maxHour);

  const byStation = new Map<string, AirStation>();
  const pollutantSet = new Set<string>();

  for (const row of latest) {
    const id = String(row.stationId);                 // keep '06' as '06'
    const pollutant = (row.pollutant ?? row.polluant ?? '').trim();
    if (pollutant) pollutantSet.add(pollutant);

    let station = byStation.get(id);
    if (!station) {
      station = {
        stationId: id,
        address: (row.address ?? row.adresse ?? '').trim(),
        lat: Number(row.latitude),
        lon: Number(row.longitude),
        aqi: null,
        pollutants: {},
        hour: maxHour,
      };
      byStation.set(id, station);
    }

    const value = toValue(row.valeur);
    station.pollutants[pollutant] = value;

    // AQI = max sub-index. A null reading must not pull the max down to 0.
    if (value !== null) {
      station.aqi = station.aqi === null ? value : Math.max(station.aqi, value);
    }
  }

  const date = latest[0]?.date ?? null;

  return {
    asOf: date ? `${date}T${String(maxHour).padStart(2, '0')}:00` : null,
    stations: [...byStation.values()],
    meta: {
      stationCount: byStation.size,
      pollutants: [...pollutantSet],
      source: SOURCE_URL,
    },
  };
}
