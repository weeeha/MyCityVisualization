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
