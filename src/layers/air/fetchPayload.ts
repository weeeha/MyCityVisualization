import { normaliseRsqaCsv, SOURCE_URL } from './normalise';
import type { AirPayload } from './schema';

type FetchImpl = (url: string) => Promise<Response>;

let lastGood: AirPayload | null = null;

/** Test-only cache reset. */
export function __resetAirCache() {
  lastGood = null;
}

/**
 * The upstream 302s to a signed storage.googleapis.com URL; fetch follows it.
 * On failure we serve last-known-good marked stale rather than 500 —
 * a labelled stale reading beats a blank map.
 */
export async function fetchAirPayload(
  fetchImpl: FetchImpl = fetch,
): Promise<AirPayload> {
  try {
    const res = await fetchImpl(SOURCE_URL);
    if (!res.ok) throw new Error(`upstream responded ${res.status}`);
    const payload = normaliseRsqaCsv(await res.text());
    lastGood = payload;
    return payload;
  } catch (err) {
    if (lastGood) return { ...lastGood, stale: true };
    throw err instanceof Error ? err : new Error('upstream fetch failed');
  }
}
