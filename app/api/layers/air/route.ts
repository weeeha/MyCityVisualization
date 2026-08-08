import { NextResponse } from 'next/server';
import { fetchAirPayload } from '@/src/layers/air/fetchPayload';

// Node runtime (default; never 'edge' — this project pins Next 16.3.0 where
// 'edge' is deprecated and 'nodejs' is already the default, so no runtime
// export is needed here).
export const revalidate = 300; // RSQA publishes ~50 min past the hour

export async function GET() {
  try {
    return NextResponse.json(await fetchAirPayload());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unavailable' },
      { status: 503 },
    );
  }
}
