import type { LayerManifest } from './types';
import { airLayer } from './air';

// The only file in the codebase that imports specific layers.
// Adding a layer = add the import and one array entry. Nothing else changes.
export const registry: LayerManifest<any, any>[] = [airLayer];

export function getLayer(id: string): LayerManifest<any, any> | undefined {
  return registry.find((l) => l.id === id);
}
