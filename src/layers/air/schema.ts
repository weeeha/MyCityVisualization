export interface AirStation {
  stationId: string;                          // zero-padded, always a string
  address: string;
  lat: number;
  lon: number;
  aqi: number | null;                         // null = no reading. NEVER 0.
  pollutants: Record<string, number | null>;
  hour: number;
}

export interface AirPayload {
  asOf: string | null;                        // 'YYYY-MM-DDTHH:00'
  stations: AirStation[];
  meta: { stationCount: number; pollutants: string[]; source: string };
  stale?: boolean;
}

export interface AqiBand {
  id: 'good' | 'acceptable' | 'poor' | 'unknown';
  label: string;
  max: number;                                // inclusive upper bound
  color: [number, number, number, number];    // RGBA for deck.gl
}
