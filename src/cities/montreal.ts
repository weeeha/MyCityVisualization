import type { CityConfig } from '@/src/layers/types';

export const MONTREAL: CityConfig = {
  id: 'montreal',
  name: 'Montréal',
  center: [-73.5673, 45.5019],                 // [lng, lat]
  bounds: [[-73.98, 45.40], [-73.47, 45.70]],
  defaultCamera: { zoom: 12.5, pitch: 55, bearing: -18 },
  layers: ['air'],
};
