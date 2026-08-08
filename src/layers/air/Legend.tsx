import type { AirPayload } from './schema';
import { AQI_BANDS, UNKNOWN_BAND } from './normalise';

const swatch = (c: number[]) => `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;

export default function AirLegend({ data }: { data: AirPayload | null }) {
  if (!data) return null;
  const stamp = data.asOf ? data.asOf.replace('T', ' ') : 'unknown';

  return (
    <div className="text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="font-semibold">Air quality</span>
        <span className={data.stale ? 'text-amber-400' : 'opacity-60'}>
          as of {stamp}{data.stale ? ' · stale' : ''}
        </span>
      </div>
      {[...AQI_BANDS, UNKNOWN_BAND].map((b) => (
        <div key={b.id} className="flex items-center gap-2">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: swatch(b.color) }}
          />
          <span>{b.label}</span>
        </div>
      ))}
      {/* Honest about coverage — 8 sensors is why this is not a heatmap. */}
      <p className="opacity-60 pt-1">
        {data.meta.stationCount} station{data.meta.stationCount === 1 ? '' : 's'} ·{' '}
        {data.meta.pollutants.join(', ')} · City of Montréal RSQA
      </p>
    </div>
  );
}
