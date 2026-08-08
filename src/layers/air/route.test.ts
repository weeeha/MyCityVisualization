import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchAirPayload, __resetAirCache } from './fetchPayload';

const csv = readFileSync('fixtures/rsqa-iqa-by-station.csv', 'utf8');

const ok = async () => new Response(csv, { status: 200 });
const boom = async () => new Response('upstream down', { status: 503 });
// Header row only — a successful response with zero stations.
const emptyOk = async () => new Response(csv.split('\n')[0], { status: 200 });

describe('fetchAirPayload', () => {
  beforeEach(() => __resetAirCache());

  it('returns fresh normalised data on success', async () => {
    const payload = await fetchAirPayload(ok);
    expect(payload.stations).toHaveLength(3);
    expect(payload.stale).toBeFalsy();
  });

  it('serves last-known-good marked stale when upstream fails', async () => {
    await fetchAirPayload(ok);
    const payload = await fetchAirPayload(boom);
    expect(payload.stations).toHaveLength(3);
    expect(payload.stale).toBe(true);
    expect(payload.asOf).toBe('2026-08-07T01:00');
  });

  it('throws when upstream fails and nothing is cached', async () => {
    await expect(fetchAirPayload(boom)).rejects.toThrow(/upstream/i);
  });

  it('does not let a successful-but-empty response overwrite the stale fallback', async () => {
    const good = await fetchAirPayload(ok);
    const empty = await fetchAirPayload(emptyOk);
    expect(empty.stations).toHaveLength(0); // served as-is, not silently backfilled
    const fallback = await fetchAirPayload(boom);
    // Must still be the ORIGINAL good data, not the empty response.
    expect(fallback.stations).toHaveLength(3);
    expect(fallback.stale).toBe(true);
    expect(fallback.asOf).toBe(good.asOf);
  });
});
