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
