import { describe, it, expect } from 'vitest';
import { projectName } from './sanity';

describe('scaffold', () => {
  it('exposes the project name', () => {
    expect(projectName()).toBe('MyCityVisualization');
  });
});
