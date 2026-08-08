# MyCityVisualization — Plan 1: Foundation + Air Quality Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed 3D map of Montréal with a proven pluggable-layer architecture and one real live layer — air quality from the city's own RSQA feed.

**Architecture:** Next.js App Router on Vercel. Route handlers proxy, cache and normalise upstream data so the browser never touches a third party. The client is a MapLibre GL canvas with deck.gl composited into the same WebGL context (interleaved). Every visualization is a self-contained module in `src/layers/*` exposing a `LayerManifest`; the shell iterates a registry and knows nothing about any specific layer.

**Tech Stack:** Next.js (App Router), TypeScript, MapLibre GL JS, deck.gl, OpenFreeMap Liberty vector tiles, Papa Parse, Vitest, Playwright, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-08-07-mycityvisualization-design.md`

## Global Constraints

- **Node runtime only.** Never `export const runtime = 'edge'`. Fluid Compute is the default and gives full Node.js.
- **The client never fetches a third-party URL.** All layer data comes from `/api/layers/*`.
- **`null` and `0` must never be conflated for AQI readings.** Québec's index is low-is-good, so a missing reading rendered as `0` paints as pristine air. `null` must survive from CSV parse through to fill colour.
- **`stationId` is a zero-padded string** (`"06"`, `"03"`). Never coerce to number.
- **Nothing in `src/map` or `src/shell` may import from `src/layers/<name>`** — only `src/layers/registry.ts` and `src/layers/types.ts`.
- **Shell state lives in the URL**, not component state.
- **Vector tiles:** `https://tiles.openfreemap.org/styles/liberty` — free, no API key.
- **Never commit to `main`.** Work continues on `design/foundation` or a task branch.
- **E2E runs on Chromium AND WebKit.** Safari diverges on WebGL.

---

### Task 1: Scaffold the project and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Test: `src/lib/sanity.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test`, `npm run dev`, `npm run build`

- [ ] **Step 1: Scaffold Next.js via a temp directory**

The repo root already contains `README.md`, `.gitignore`, and `docs/`. Scaffold to a temp
directory and copy in, so nothing already committed is destroyed:

```bash
rm -rf /tmp/mcv-scaffold
npx create-next-app@latest /tmp/mcv-scaffold --typescript --app --tailwind \
  --eslint --src-dir=false --import-alias "@/*" --turbopack --no-git --yes
rsync -a --exclude .git --exclude README.md --exclude .gitignore \
  /tmp/mcv-scaffold/ .
```

**Do not scaffold in place, and do not drop the `--exclude .gitignore`.**
`create-next-app` writes its own `.gitignore`, which would overwrite the committed one and
silently un-ignore `.superpowers/` (the SDD ledger and brainstorm mockups). The committed
`.gitignore` already covers everything Next.js needs: `node_modules/`, `.next/`, `out/`,
`build/`, `.env*`, `.vercel`, `next-env.d.ts`.

`--src-dir=false` is deliberate: Next.js owns `app/` at the repo root, while `src/` holds
framework-independent code (`src/map`, `src/shell`, `src/layers`, `src/cities`). The `@/*`
alias resolves from the repo root, so `@/src/layers/types` is the correct import form.

- [ ] **Step 1b: Verify the scaffold did not clobber committed files**

```bash
git status --short
grep -q '.superpowers/' .gitignore && echo "gitignore OK" || echo "GITIGNORE CLOBBERED"
```

Expected: `gitignore OK`, and `.superpowers/` must **not** appear in `git status`.
If it says `GITIGNORE CLOBBERED`, restore it with `git checkout -- .gitignore` before
continuing.

- [ ] **Step 2: Install runtime and test dependencies**

```bash
npm install maplibre-gl @deck.gl/core @deck.gl/layers @deck.gl/mapbox papaparse
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react \
  @playwright/test @types/papaparse
npx playwright install chromium webkit
```

- [ ] **Step 3: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

- [ ] **Step 4: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Write a sanity test that fails**

Create `src/lib/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectName } from './sanity';

describe('scaffold', () => {
  it('exposes the project name', () => {
    expect(projectName()).toBe('MyCityVisualization');
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./sanity`.

- [ ] **Step 7: Write the minimal implementation**

Create `src/lib/sanity.ts`:

```ts
export function projectName(): string {
  return 'MyCityVisualization';
}
```

- [ ] **Step 8: Run tests and build**

Run: `npm test && npm run build`
Expected: 1 test passes; build succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and Playwright"
```

---

### Task 2: Define the layer contract and registry

**Files:**
- Create: `src/layers/types.ts`, `src/layers/registry.ts`
- Test: `src/layers/registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `LayerManifest`, `LayerContext`, `LayerState`, `CityConfig`, `BasemapPatch`, `registry: LayerManifest<any, any>[]`, `getLayer(id)`

- [ ] **Step 1: Write the contract test first**

Create `src/layers/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { registry, getLayer } from './registry';

describe('layer registry', () => {
  it('every manifest satisfies the contract', () => {
    for (const layer of registry) {
      expect(typeof layer.id).toBe('string');
      expect(layer.id.length).toBeGreaterThan(0);
      expect(typeof layer.label).toBe('string');
      expect(typeof layer.description).toBe('string');
      expect(typeof layer.render).toBe('function');
      expect(layer.Legend).toBeTruthy();
      expect(['full', 'reduced', 'off']).toContain(layer.budget.mobile);
      if (layer.refresh) {
        expect(layer.refresh.intervalMs).toBeGreaterThan(0);
        expect(layer.refresh.staleAfterMs).toBeGreaterThan(layer.refresh.intervalMs);
      }
    }
  });

  it('has no duplicate ids', () => {
    const ids = registry.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a layer by id', () => {
    if (registry.length > 0) {
      expect(getLayer(registry[0].id)).toBe(registry[0]);
    }
    expect(getLayer('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/layers/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write `src/layers/types.ts`**

```ts
import type { ComponentType } from 'react';
import type { Layer as DeckLayer } from '@deck.gl/core';

export interface CityConfig {
  id: string;
  name: string;
  center: [number, number];            // [lng, lat] — deck/MapLibre order
  bounds: [[number, number], [number, number]];
  defaultCamera: { zoom: number; pitch: number; bearing: number };
  layers: string[];                    // enabled layer ids, in display order
}

export type TimeWindow = 'now' | 'today' | 'weekend';

export interface TimeState {
  now: Date;
  window: TimeWindow;
  cursor?: Date;                       // timeline scrub position
}

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface LayerContext {
  city: CityConfig;
  time: TimeState;
  view: ViewState;
  device: 'desktop' | 'mobile';
  options: Record<string, Record<string, unknown>>;   // options[layerId][key]
}

/** A declarative override applied to an existing basemap style layer. */
export interface BasemapPatch {
  layerId: string;                                    // e.g. 'building-3d'
  paint: Record<string, unknown>;
}

export interface DetailCardContent {
  title: string;
  subtitle?: string;
  rows: Array<{ label: string; value: string }>;
  link?: { href: string; label: string };
}

export interface LayerOption {
  key: string;
  label: string;
  type: 'select' | 'toggle' | 'range';
  choices?: Array<{ value: string; label: string }>;
  default: string | number | boolean;
}

export type LayerStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'error';

export interface LayerState<TData> {
  status: LayerStatus;
  data: TData | null;
  asOf: string | null;
  error: string | null;
}

export interface LayerManifest<TData, TFeature> {
  id: string;
  label: string;
  description: string;

  /** Omitted for layers with no fetch — they are never stale. */
  refresh?: { intervalMs: number; staleAfterMs: number };

  /** Always hits our own /api/layers/*. Optional: buildings renders from tiles alone. */
  fetch?(ctx: LayerContext, signal: AbortSignal): Promise<TData>;

  /** Pure. Same inputs produce the same layers. */
  render(data: TData | null, ctx: LayerContext): DeckLayer[];

  basemapPatch?(data: TData | null, ctx: LayerContext): BasemapPatch;

  Legend: ComponentType<{ data: TData | null; ctx: LayerContext }>;

  detail?(feature: TFeature, ctx: LayerContext): DetailCardContent;

  options?: LayerOption[];

  budget: { mobile: 'full' | 'reduced' | 'off' };
}
```

- [ ] **Step 4: Write `src/layers/registry.ts`**

Starts empty. This is the **only** file permitted to import specific layer folders.

```ts
import type { LayerManifest } from './types';

// The only file in the codebase that imports specific layers.
// Adding a layer = add the import and one array entry. Nothing else changes.
export const registry: LayerManifest<any, any>[] = [];

export function getLayer(id: string): LayerManifest<any, any> | undefined {
  return registry.find((l) => l.id === id);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/layers/registry.test.ts`
Expected: PASS (3 tests; the contract loop is vacuous while the registry is empty and will gain teeth in Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/layers
git commit -m "feat: define layer contract and empty registry"
```

---

### Task 3: RSQA normaliser (pure, fixture-driven)

**Files:**
- Create: `src/layers/air/schema.ts`, `src/layers/air/normalise.ts`, `fixtures/rsqa-iqa-by-station.csv`
- Test: `src/layers/air/normalise.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `AirStation`, `AirPayload`, `AQI_BANDS`, `bandFor(aqi)`, `normaliseRsqaCsv(csv: string): AirPayload`

- [ ] **Step 1: Create the fixture from the real feed**

Create `fixtures/rsqa-iqa-by-station.csv` — a trimmed real sample. Column names are exactly as the **live file** serves them (note the dataset docs say `adresse`/`polluant` but the live file uses `address`/`pollutant`; the normaliser accepts both):

```csv
Id,stationId,address,latitude,longitude,X,Y,pollutant,valeur,date,heure
"1","80","2580 Saint-Joseph est",45.54271,-73.57176,299196.17,5044757.56,"O3",14,"2026-08-07",0
"2","99","20965 Ch. Ste-Marie",45.426509,-73.928944,271234.34,5031931.12,"O3",12,"2026-08-07",0
"3","80","2580 Saint-Joseph est",45.54271,-73.57176,299196.17,5044757.56,"PM",22,"2026-08-07",0
"4","80","2580 Saint-Joseph est",45.54271,-73.57176,299196.17,5044757.56,"O3",31,"2026-08-07",1
"5","80","2580 Saint-Joseph est",45.54271,-73.57176,299196.17,5044757.56,"PM",18,"2026-08-07",1
"6","99","20965 Ch. Ste-Marie",45.426509,-73.928944,271234.34,5031931.12,"O3",,"2026-08-07",1
"7","06","76540 Chateauneuf",45.602846,-73.558874,300207.36,5051439.76,"O3",55,"2026-08-07",1
```

This exercises: multi-hour files, max-hour selection, multi-pollutant max, an **empty value**, a zero-padded `stationId` (`"06"`), and all three AQI bands.

- [ ] **Step 2: Write the failing tests**

Create `src/layers/air/normalise.test.ts`:

```ts
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
```

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run src/layers/air/normalise.test.ts`
Expected: FAIL — cannot resolve `./normalise`.

- [ ] **Step 4: Write `src/layers/air/schema.ts`**

```ts
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
```

- [ ] **Step 5: Write `src/layers/air/normalise.ts`**

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/layers/air/normalise.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add src/layers/air fixtures
git commit -m "feat: normalise RSQA air quality CSV with null-safe AQI"
```

---

### Task 4: Air route handler with stale-on-failure caching

**Files:**
- Create: `src/layers/air/fetchPayload.ts`, `app/api/layers/air/route.ts`
- Test: `src/layers/air/route.test.ts`

**Interfaces:**
- Consumes: `normaliseRsqaCsv`, `SOURCE_URL`, `AirPayload` from Task 3
- Produces: `fetchAirPayload(fetchImpl?): Promise<AirPayload>`, `__resetAirCache()`, and `GET /api/layers/air`

- [ ] **Step 1: Write the failing tests**

Create `src/layers/air/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchAirPayload, __resetAirCache } from './fetchPayload';

const csv = readFileSync('fixtures/rsqa-iqa-by-station.csv', 'utf8');

const ok = async () => new Response(csv, { status: 200 });
const boom = async () => new Response('upstream down', { status: 503 });

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
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/layers/air/route.test.ts`
Expected: FAIL — cannot resolve `./fetchPayload`.

- [ ] **Step 3: Write `src/layers/air/fetchPayload.ts`**

```ts
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
```

- [ ] **Step 4: Write `app/api/layers/air/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { fetchAirPayload } from '@/src/layers/air/fetchPayload';

// Node runtime (Fluid Compute default). Never 'edge'.
export const revalidate = 300;   // RSQA publishes ~50 min past the hour

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/layers/air/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify against the live upstream**

```bash
npm run dev
curl -s localhost:3000/api/layers/air | head -c 400
```

Expected: JSON with `asOf`, a `stations` array, and `meta.stationCount` around 8.
If `stationCount` is 0, the upstream schema changed — stop and inspect before continuing.

- [ ] **Step 7: Commit**

```bash
git add app/api src/layers/air
git commit -m "feat: add cached air quality route with stale fallback"
```

---

### Task 5: MapCanvas — MapLibre with interleaved deck.gl

**Files:**
- Create: `src/map/basemap.ts`, `src/map/MapCanvas.tsx`, `src/cities/montreal.ts`
- Test: `src/map/basemap.test.ts`

**Interfaces:**
- Consumes: `CityConfig`, `BasemapPatch`, `ViewState` from Task 2
- Produces: `MONTREAL: CityConfig`; `BASEMAP_STYLE_URL`; `BUILDING_LAYER_ID`; `applyPatch(map, patch)`; `revertPatch(map, patch)`; `<MapCanvas layers viewState onViewStateChange patches />`

- [ ] **Step 1: Write the failing test**

Create `src/map/basemap.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyPatch, revertPatch, BUILDING_LAYER_ID } from './basemap';

function fakeMap() {
  const calls: Array<[string, string, unknown]> = [];
  return {
    calls,
    getLayer: () => ({ id: BUILDING_LAYER_ID }),
    getPaintProperty: vi.fn(() => 'hsl(35,8%,85%)'),
    setPaintProperty: (l: string, p: string, v: unknown) => calls.push([l, p, v]),
  };
}

describe('basemap patching', () => {
  it('applies each paint property to the named layer', () => {
    const map = fakeMap();
    applyPatch(map as never, {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    });
    expect(map.calls).toEqual([[BUILDING_LAYER_ID, 'fill-extrusion-color', '#ff0000']]);
  });

  it('restores the original value on revert', () => {
    const map = fakeMap();
    const patch = {
      layerId: BUILDING_LAYER_ID,
      paint: { 'fill-extrusion-color': '#ff0000' },
    };
    applyPatch(map as never, patch);
    revertPatch(map as never, patch);
    expect(map.calls[1]).toEqual([BUILDING_LAYER_ID, 'fill-extrusion-color', 'hsl(35,8%,85%)']);
  });

  it('is a no-op when the target layer is absent', () => {
    const map = { ...fakeMap(), getLayer: () => undefined };
    expect(() =>
      applyPatch(map as never, { layerId: 'nope', paint: { a: 1 } }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/map/basemap.test.ts`
Expected: FAIL — cannot resolve `./basemap`.

- [ ] **Step 3: Write `src/map/basemap.ts`**

```ts
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { BasemapPatch } from '@/src/layers/types';

/** Free, no API key, no request limit. Verified 2026-08-07. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Liberty's own extrusion layer: fill-extrusion on source-layer 'building', minzoom 14. */
export const BUILDING_LAYER_ID = 'building-3d';

const originals = new Map<string, unknown>();

export function applyPatch(map: MapLibreMap, patch: BasemapPatch): void {
  if (!map.getLayer(patch.layerId)) return;
  for (const [prop, value] of Object.entries(patch.paint)) {
    const key = `${patch.layerId}::${prop}`;
    if (!originals.has(key)) {
      originals.set(key, map.getPaintProperty(patch.layerId, prop));
    }
    map.setPaintProperty(patch.layerId, prop, value as never);
  }
}

export function revertPatch(map: MapLibreMap, patch: BasemapPatch): void {
  if (!map.getLayer(patch.layerId)) return;
  for (const prop of Object.keys(patch.paint)) {
    const key = `${patch.layerId}::${prop}`;
    if (originals.has(key)) {
      map.setPaintProperty(patch.layerId, prop, originals.get(key) as never);
      originals.delete(key);
    }
  }
}
```

- [ ] **Step 4: Write `src/cities/montreal.ts`**

```ts
import type { CityConfig } from '@/src/layers/types';

export const MONTREAL: CityConfig = {
  id: 'montreal',
  name: 'Montréal',
  center: [-73.5673, 45.5019],                 // [lng, lat]
  bounds: [[-73.98, 45.40], [-73.47, 45.70]],
  defaultCamera: { zoom: 12.5, pitch: 55, bearing: -18 },
  layers: ['air'],
};
```

- [ ] **Step 5: Write `src/map/MapCanvas.tsx`**

The wrapper carries an explicit height. A collapsed container yields a working map you cannot see.

```tsx
'use client';

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer as DeckLayer } from '@deck.gl/core';
import type { BasemapPatch, ViewState } from '@/src/layers/types';
import { BASEMAP_STYLE_URL, applyPatch } from './basemap';
import 'maplibre-gl/dist/maplibre-gl.css';

interface Props {
  layers: DeckLayer[];
  patches: BasemapPatch[];
  viewState: ViewState;
  onViewStateChange: (v: ViewState) => void;
}

export default function MapCanvas({
  layers, patches, viewState, onViewStateChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  // Mount once. viewState is deliberately not a dependency —
  // the map owns the camera after init; the URL is synced from move events.
  useEffect(() => {
    if (!container.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE_URL,
      center: [viewState.longitude, viewState.latitude],
      zoom: viewState.zoom,
      pitch: viewState.pitch,
      bearing: viewState.bearing,
      antialias: true,
    });

    // Interleaved: deck renders inside MapLibre's pass — one context, one
    // camera, and buildings correctly occlude data.
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);

    map.on('moveend', () => {
      const c = map.getCenter();
      onViewStateChange({
        longitude: c.lng, latitude: c.lat,
        zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(),
      });
    });

    // WebGL failures do not throw — recover explicitly.
    map.getCanvas().addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      map.once('webglcontextrestored', () => map.triggerRepaint());
    });

    mapRef.current = map;
    overlayRef.current = overlay;
    return () => { map.remove(); mapRef.current = null; overlayRef.current = null; };
  }, []);

  useEffect(() => { overlayRef.current?.setProps({ layers }); }, [layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const run = () => patches.forEach((p) => applyPatch(map, p));
    if (map.isStyleLoaded()) run(); else map.once('load', run);
  }, [patches]);

  return <div ref={container} className="absolute inset-0" data-testid="map-canvas" />;
}
```

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/map src/cities
git commit -m "feat: add MapCanvas with interleaved deck.gl overlay"
```

---

### Task 6: The air layer manifest

**Files:**
- Create: `src/layers/air/render.ts`, `src/layers/air/Legend.tsx`, `src/layers/air/index.ts`
- Modify: `src/layers/registry.ts`
- Test: `src/layers/air/render.test.ts`

**Interfaces:**
- Consumes: `AirPayload`, `bandFor`, `AQI_BANDS`, `UNKNOWN_BAND` (Task 3); `LayerManifest`, `LayerContext` (Task 2)
- Produces: `airLayer: LayerManifest<AirPayload, AirStation>` registered as id `'air'`

- [ ] **Step 1: Write the failing render tests**

Create `src/layers/air/render.test.ts`:

```ts
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
    const { getFillColor } = renderAir(payload, ctx)[0].props as {
      getFillColor: (s: (typeof payload.stations)[number]) => number[];
    };
    expect(getFillColor(payload.stations[1])).toEqual(UNKNOWN_BAND.color);
  });

  it('returns no layers when data is null', () => {
    expect(renderAir(null, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/layers/air/render.test.ts`
Expected: FAIL — cannot resolve `./render`.

- [ ] **Step 3: Write `src/layers/air/render.ts`**

```ts
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
```

- [ ] **Step 4: Write `src/layers/air/Legend.tsx`**

```tsx
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
```

- [ ] **Step 5: Write `src/layers/air/index.ts`**

```ts
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
```

- [ ] **Step 6: Register it in `src/layers/registry.ts`**

```ts
import type { LayerManifest } from './types';
import { airLayer } from './air';

// The only file in the codebase that imports specific layers.
export const registry: LayerManifest<any, any>[] = [airLayer];

export function getLayer(id: string): LayerManifest<any, any> | undefined {
  return registry.find((l) => l.id === id);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. The Task 2 contract test now actually exercises a manifest.

- [ ] **Step 8: Commit**

```bash
git add src/layers
git commit -m "feat: add air quality layer and register it"
```

---

### Task 7: Shell — layer state machine, toggles, legends, URL state

**Files:**
- Create: `src/shell/useUrlState.ts`, `src/shell/useLayersData.ts`, `src/shell/LayerToggles.tsx`, `src/shell/Shell.tsx`
- Modify: `app/page.tsx`
- Test: `src/shell/useUrlState.test.ts`

**Interfaces:**
- Consumes: `registry` (Tasks 2/6); `MapCanvas` (Task 5); `MONTREAL` (Task 5)
- Produces: `UrlState`, `DEFAULT_URL_STATE`, `parseUrlState(search)`, `toSearchParams(state)`,
  `useLayersData(manifests, ctx, enabled): Record<string, LayerState<any>>`, `IDLE`, `<Shell/>`

- [ ] **Step 1: Write the failing URL-state tests**

Create `src/shell/useUrlState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseUrlState, toSearchParams, DEFAULT_URL_STATE } from './useUrlState';

describe('url state', () => {
  it('falls back to defaults when the query is empty', () => {
    expect(parseUrlState('')).toEqual(DEFAULT_URL_STATE);
  });

  it('parses enabled layers and camera', () => {
    const s = parseUrlState('?layers=air&at=45.5088,-73.5678,15,60,-20');
    expect(s.layers).toEqual(['air']);
    expect(s.view).toEqual({
      latitude: 45.5088, longitude: -73.5678, zoom: 15, pitch: 60, bearing: -20,
    });
  });

  it('round-trips without loss', () => {
    const s = parseUrlState('?layers=air&at=45.5,-73.5,14,50,10');
    expect(parseUrlState('?' + toSearchParams(s).toString())).toEqual(s);
  });

  it('ignores unknown layer ids rather than crashing', () => {
    expect(parseUrlState('?layers=air,bogus').layers).toEqual(['air']);
  });

  it('ignores a malformed camera', () => {
    expect(parseUrlState('?at=garbage').view).toEqual(DEFAULT_URL_STATE.view);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run src/shell/useUrlState.test.ts`
Expected: FAIL — cannot resolve `./useUrlState`.

- [ ] **Step 3: Write `src/shell/useUrlState.ts`**

```ts
import type { ViewState } from '@/src/layers/types';
import { MONTREAL } from '@/src/cities/montreal';
import { registry } from '@/src/layers/registry';

export interface UrlState {
  layers: string[];
  view: ViewState;
}

export const DEFAULT_URL_STATE: UrlState = {
  layers: [...MONTREAL.layers],
  view: {
    longitude: MONTREAL.center[0],
    latitude: MONTREAL.center[1],
    ...MONTREAL.defaultCamera,
  },
};

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const known = new Set(registry.map((l) => l.id));

  const raw = p.get('layers');
  const layers = raw === null
    ? DEFAULT_URL_STATE.layers
    : raw.split(',').filter((id) => known.has(id));

  let view = DEFAULT_URL_STATE.view;
  const at = p.get('at')?.split(',').map(Number);
  if (at && at.length === 5 && at.every(Number.isFinite)) {
    view = { latitude: at[0], longitude: at[1], zoom: at[2], pitch: at[3], bearing: at[4] };
  }

  return { layers, view };
}

export function toSearchParams(state: UrlState): URLSearchParams {
  const v = state.view;
  const round = (n: number, d = 4) => Number(n.toFixed(d));
  return new URLSearchParams({
    layers: state.layers.join(','),
    at: [round(v.latitude), round(v.longitude), round(v.zoom, 2),
         round(v.pitch, 1), round(v.bearing, 1)].join(','),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/shell/useUrlState.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `src/shell/useLayersData.ts`**

One hook that loops internally over the registry. **Do not call a hook per layer inside
`.map()`** — `react-hooks/rules-of-hooks` rejects it, and it becomes genuinely unsafe the
moment anyone filters the registry. Each layer still gets its own AbortController and
interval, so per-layer failure isolation is preserved: one dead upstream must never blank
the app.

```ts
'use client';

import { useEffect, useState } from 'react';
import type { LayerContext, LayerManifest, LayerState } from '@/src/layers/types';

export const IDLE: LayerState<unknown> = {
  status: 'idle', data: null, asOf: null, error: null,
};

export function useLayersData(
  manifests: LayerManifest<any, any>[],
  ctx: LayerContext,
  enabled: string[],
): Record<string, LayerState<any>> {
  const [states, setStates] = useState<Record<string, LayerState<any>>>({});
  const enabledKey = [...enabled].sort().join(',');

  // ctx is deliberately NOT a dependency: it changes on every pan, and
  // refetching upstream data on camera movement would hammer the route handler.
  useEffect(() => {
    const controllers: AbortController[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];
    let cancelled = false;

    for (const manifest of manifests) {
      if (!enabled.includes(manifest.id) || !manifest.fetch) continue;

      const controller = new AbortController();
      controllers.push(controller);

      const load = async () => {
        setStates((prev) => ({
          ...prev,
          [manifest.id]: prev[manifest.id]?.data
            ? prev[manifest.id]
            : { status: 'loading', data: null, asOf: null, error: null },
        }));

        try {
          const data = await manifest.fetch!(ctx, controller.signal);
          if (cancelled) return;
          const stale = (data as { stale?: boolean }).stale === true;
          setStates((prev) => ({
            ...prev,
            [manifest.id]: {
              status: stale ? 'stale' : 'ready',
              data,
              asOf: (data as { asOf?: string }).asOf ?? null,
              error: null,
            },
          }));
        } catch (err) {
          if (cancelled || controller.signal.aborted) return;
          setStates((prev) => {
            const previous = prev[manifest.id];
            return {
              ...prev,
              [manifest.id]: previous?.data
                ? { ...previous, status: 'stale' }
                : {
                    status: 'error', data: null, asOf: null,
                    error: err instanceof Error ? err.message : 'failed',
                  },
            };
          });
        }
      };

      load();
      if (manifest.refresh) {
        intervals.push(setInterval(load, manifest.refresh.intervalMs));
      }
    }

    return () => {
      cancelled = true;
      controllers.forEach((c) => c.abort());
      intervals.forEach((i) => clearInterval(i));
    };
  }, [enabledKey]);

  return states;
}
```

- [ ] **Step 6: Write `src/shell/LayerToggles.tsx`**

Generated entirely from the registry — adding a layer needs no UI change.

```tsx
'use client';

import type { LayerManifest, LayerStatus } from '@/src/layers/types';

const DOT: Record<LayerStatus, string> = {
  idle: 'bg-slate-500', loading: 'bg-sky-400 animate-pulse',
  ready: 'bg-emerald-400', stale: 'bg-amber-400', error: 'bg-red-500',
};

export default function LayerToggles({
  layers, enabled, statuses, onToggle,
}: {
  layers: LayerManifest<any, any>[];
  enabled: string[];
  statuses: Record<string, LayerStatus>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {layers.map((l) => (
        <button
          key={l.id}
          onClick={() => onToggle(l.id)}
          title={l.description}
          data-testid={`toggle-${l.id}`}
          aria-pressed={enabled.includes(l.id)}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm
            ${enabled.includes(l.id)
              ? 'bg-white/15 text-white'
              : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
        >
          <span className={`h-2 w-2 rounded-full ${DOT[statuses[l.id] ?? 'idle']}`} />
          {l.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Write `src/shell/Shell.tsx`**

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { registry } from '@/src/layers/registry';
import { MONTREAL } from '@/src/cities/montreal';
import type { LayerContext, LayerStatus, ViewState } from '@/src/layers/types';
import { DEFAULT_URL_STATE, parseUrlState, toSearchParams } from './useUrlState';
import { IDLE, useLayersData } from './useLayersData';
import LayerToggles from './LayerToggles';

// ~400 KB gzipped — must not block first paint.
const MapCanvas = dynamic(() => import('@/src/map/MapCanvas'), { ssr: false });

export default function Shell() {
  const [urlState, setUrlState] = useState(DEFAULT_URL_STATE);

  useEffect(() => { setUrlState(parseUrlState(window.location.search)); }, []);

  useEffect(() => {
    const qs = toSearchParams(urlState).toString();
    window.history.replaceState(null, '', `?${qs}`);
  }, [urlState]);

  const ctx: LayerContext = useMemo(() => ({
    city: MONTREAL,
    time: { now: new Date(), window: 'now' },
    view: urlState.view,
    device: typeof window !== 'undefined' && window.innerWidth < 768 ? 'mobile' : 'desktop',
    options: {},
  }), [urlState.view]);

  // One hook, looping internally — never a hook per layer inside .map().
  const states = useLayersData(registry, ctx, urlState.layers);
  const stateOf = (id: string) => states[id] ?? IDLE;

  const deckLayers = registry.flatMap((m) =>
    urlState.layers.includes(m.id) ? m.render(stateOf(m.id).data, ctx) : []);

  const patches = registry.flatMap((m) =>
    urlState.layers.includes(m.id) && m.basemapPatch
      ? [m.basemapPatch(stateOf(m.id).data, ctx)] : []);

  const statuses = Object.fromEntries(
    registry.map((m) => [m.id, stateOf(m.id).status]),
  ) as Record<string, LayerStatus>;

  const setView = (view: ViewState) => setUrlState((s) => ({ ...s, view }));
  const toggle = (id: string) => setUrlState((s) => ({
    ...s,
    layers: s.layers.includes(id) ? s.layers.filter((x) => x !== id) : [...s.layers, id],
  }));

  return (
    <main className="fixed inset-0 bg-slate-950 text-white">
      <MapCanvas
        layers={deckLayers}
        patches={patches}
        viewState={urlState.view}
        onViewStateChange={setView}
      />
      <div className="absolute left-4 top-4 z-10 w-64 space-y-3 rounded-xl
                      bg-slate-900/80 p-3 backdrop-blur">
        <h1 className="text-sm font-semibold">{MONTREAL.name}</h1>
        <LayerToggles
          layers={registry}
          enabled={urlState.layers}
          statuses={statuses}
          onToggle={toggle}
        />
        <div className="space-y-3" data-testid="legend-slot">
          {registry.map((m) =>
            urlState.layers.includes(m.id) ? (
              <div key={m.id} data-testid={`legend-${m.id}`}>
                {stateOf(m.id).status === 'error' ? (
                  <p className="text-xs text-red-400">
                    {m.label} unavailable — {stateOf(m.id).error}
                  </p>
                ) : (
                  <m.Legend data={stateOf(m.id).data} ctx={ctx} />
                )}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Replace `app/page.tsx`**

```tsx
import Shell from '@/src/shell/Shell';

export default function Page() {
  return <Shell />;
}
```

- [ ] **Step 9: Verify in the browser**

```bash
npm run dev
```

Open `http://localhost:3000`. Expected: dark 3D Montréal, tilted; an "Air quality" toggle with a green dot; a legend naming the station count; the URL gains `?layers=air&at=…` and updates as you pan.

- [ ] **Step 10: Commit**

```bash
git add src/shell app/page.tsx
git commit -m "feat: add shell with per-layer state machine and URL state"
```

---

### Task 8: Enforce the architecture rule and add E2E coverage

**Files:**
- Modify: `eslint.config.mjs`
- Create: `playwright.config.ts`, `e2e/map.spec.ts`

**Interfaces:**
- Consumes: the running app from Task 7
- Produces: `npm run lint` failing on cross-layer imports; `npm run e2e` passing on Chromium and WebKit

- [ ] **Step 1: Add the import restriction to `eslint.config.mjs`**

```js
{
  files: ['src/shell/**/*.{ts,tsx}', 'src/map/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['@/src/layers/*/*', '../layers/*/*', './layers/*/*'],
        message:
          'shell and map must not import specific layers — use registry.ts or types.ts. ' +
          'See spec §3: deleting a layer folder must not break the app.',
      }],
    }],
  },
},
```

- [ ] **Step 2: Prove the rule fires**

Temporarily add `import { airLayer } from '@/src/layers/air';` to `src/shell/Shell.tsx`, then:

Run: `npm run lint`
Expected: FAIL with the "shell and map must not import specific layers" message.
**Remove the import** and re-run — expected: PASS.

- [ ] **Step 3: Write `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: Write `e2e/map.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('the map actually draws, not just mounts', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(5000);   // tiles + first render

  // WebGL failures do not throw — they yield a uniform black canvas that
  // passes every DOM assertion. Sample pixels and require variation.
  const distinct = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    off.getContext('2d')!.drawImage(c, 0, 0);
    const { data } = off.getContext('2d')!.getImageData(0, 0, off.width, off.height);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4 * 997) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });
  expect(distinct).toBeGreaterThan(5);
});

test('the air layer toggles and shows its legend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('legend-air')).toBeVisible();
  await expect(page.getByTestId('legend-air')).toContainText(/station/i);

  await page.getByTestId('toggle-air').click();
  await expect(page.getByTestId('legend-air')).toHaveCount(0);
  await expect(page).toHaveURL(/layers=(&|$)/);
});

test('a shared URL restores the exact view', async ({ page }) => {
  await page.goto('/?layers=air&at=45.5088,-73.5678,15,60,-20');
  await page.waitForTimeout(3000);
  await expect(page).toHaveURL(/at=45\.5088,-73\.5678/);
  await expect(page.getByTestId('legend-air')).toBeVisible();
});

test('an upstream failure degrades to an error, not a blank app', async ({ page }) => {
  await page.route('**/api/layers/air', (r) =>
    r.fulfill({ status: 503, body: '{"error":"down"}' }));
  await page.goto('/');
  await expect(page.getByTestId('legend-air')).toContainText(/unavailable/i);
  await expect(page.locator('canvas').first()).toBeVisible();   // map still there
});
```

- [ ] **Step 5: Run E2E on both engines**

Run: `npm run e2e`
Expected: 8 passes (4 tests × chromium + webkit).
If WebKit fails on the pixel check, raise the wait to 8000 ms before assuming a real bug — Safari's WebGL init is slower.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.mjs playwright.config.ts e2e
git commit -m "test: enforce layer isolation and add cross-browser E2E"
```

---

### Task 9: Deploy the preview

**Files:**
- Create: `vercel.json` (only if a build override proves necessary)

**Interfaces:**
- Consumes: everything above
- Produces: a live preview URL

- [ ] **Step 1: Verify the production build locally**

Run: `npm run build && npm start`
Open `http://localhost:3000`. Expected: identical behaviour to dev.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin design/foundation
```

- [ ] **Step 3: Deploy a preview**

```bash
npx vercel --yes
```

Expected: a preview URL. **Preview only — do not promote to production.**

- [ ] **Step 4: Verify the deployed preview**

Confirm on the live URL: the 3D map renders; the air legend shows a station count and a recent `as of` timestamp; `/api/layers/air` returns live JSON; the URL updates on pan. Check in **both Chrome and Safari**.

- [ ] **Step 5: Commit any config changes and report the URL**

```bash
git add -A && git commit -m "chore: deploy preview" || echo "nothing to commit"
git push
```

---

## What Plan 1 deliberately leaves out

Covered by later plans, not forgotten: places/chips with leader and beam anchoring, the detail card, the timeline, buildings recolouring, the mobile bottom sheet, the settings popover for layer options, and the transit layer. The `options` field, `detail()`, and `basemapPatch` are defined in the contract here and consumed later — this plan proves the contract holds; the rest populate it.
