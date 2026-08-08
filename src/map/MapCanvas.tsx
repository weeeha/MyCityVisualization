'use client';

import { useEffect, useRef } from 'react';
// maplibre-gl v6 ships no default export — only named exports.
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
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
      // v6 moved the WebGL context flag under canvasContextAttributes.
      canvasContextAttributes: { antialias: true },
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
    map.getCanvas().addEventListener('webglcontextlost', (e: Event) => {
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

  // Inline position/inset (not just the Tailwind classes) because
  // maplibre-gl.css ships `.maplibregl-map { position: relative }` and,
  // loaded via dynamic import, its stylesheet lands after Tailwind's in the
  // cascade — same specificity, so it silently wins and collapses this
  // container to zero height. Inline styles always beat a stylesheet rule.
  return (
    <div
      ref={container}
      className="absolute inset-0"
      style={{ position: 'absolute', inset: 0 }}
      data-testid="map-canvas"
    />
  );
}
