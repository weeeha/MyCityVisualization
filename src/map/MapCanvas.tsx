'use client';

import { useEffect, useRef } from 'react';
// maplibre-gl ships no default export — only named exports (verified against
// v5.24.0's dist/maplibre-gl.d.ts: `export as namespace maplibregl` + named `Map`).
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer as DeckLayer } from '@deck.gl/core';
import type { BasemapPatch, ViewState } from '@/src/layers/types';
import { BASEMAP_STYLE_URL, applyPatch, ensureBuildingLayer } from './basemap';
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

  // Refreshed every render so the mount-only effect below never closes over
  // a stale callback. Deliberately NOT a dependency of that effect — adding
  // it there would tear down and rebuild the whole map on every render.
  // Written from an effect (not directly in the render body) per
  // react-hooks/refs — ref writes belong in effects/handlers, not render.
  const onViewStateChangeRef = useRef(onViewStateChange);
  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  });

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
      // canvasContextAttributes is the only place v5.24.0's MapOptions
      // accepts antialias — there is no top-level field.
      // preserveDrawingBuffer: without it, the WebGL drawing buffer is
      // undefined immediately after the browser composites each frame —
      // drawImage()/createImageBitmap()/readPixels() all silently return
      // black regardless of what's on screen. That's not a diagnostic-tool
      // quirk; it means any future automated check for "is the canvas
      // actually painted" (e.g. a Playwright E2E asserting non-uniform
      // pixels) would false-negative forever without this flag.
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true },
    });

    // Interleaved: deck renders inside MapLibre's pass — one context, one
    // camera, and buildings correctly occlude data.
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);

    // The dark basemap style ships no 3D building layer — add ours once the
    // style is ready. ensureBuildingLayer is idempotent, so it's safe to
    // wire to both 'load' (first paint) and 'styledata' (fires again on any
    // later style reload) without ever adding the layer twice.
    map.on('load', () => ensureBuildingLayer(map));
    map.on('styledata', () => {
      if (map.isStyleLoaded()) ensureBuildingLayer(map);
    });

    // Defensive: if the container is still 0×0 at construction (observed in
    // practice right after this dynamically-imported component's first
    // mount), MapLibre's own _containerDimensions() falls back to a
    // hardcoded 400×300 canvas — and that fallback is baked into every
    // later resize() call too, not just the constructor, so a single
    // one-shot nudge (e.g. on 'load') only works if the container happens
    // to already be sized by the time it fires, which is a race, not a fix.
    // A ResizeObserver of our own reacts to whatever the container's size
    // actually becomes, whenever it becomes it, and keeps reacting for the
    // component's whole lifetime (window resize, sidebar toggle, etc.).
    const containerResizeObserver = new ResizeObserver(() => map.resize());
    containerResizeObserver.observe(container.current);

    map.on('moveend', () => {
      const c = map.getCenter();
      // Call through the ref, not the closed-over prop — the prop from this
      // mount-only effect's first render would otherwise stay wired
      // forever, writing that render's stale urlState back on every pan.
      onViewStateChangeRef.current({
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
    return () => {
      containerResizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
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
