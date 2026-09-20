import { describe, expect, it } from 'vitest';
import { getExampleBundle, parseResultsBundle, tierCounts } from './bundle';
import { PLOT_HEIGHT, PLOT_PADDING, PLOT_WIDTH, plottedPoints } from './space';

describe('results bundle loading', () => {
  it('validates and returns the golden bundle', () => {
    const bundle = getExampleBundle();

    expect(bundle.bundleVersion).toBe('1.0.0');
    expect(bundle.precomputed.metrics).toHaveLength(12);
    expect(tierCounts(bundle)).toEqual({
      measured: 15,
      interpolated: 24,
      extrapolated: 8,
    });
  });

  it('reports invalid JSON separately from a contract violation', () => {
    expect(() => parseResultsBundle('{')).toThrow('not valid JSON');

    const invalid = structuredClone(getExampleBundle()) as unknown as {
      bundleVersion: string;
    };
    invalid.bundleVersion = '2.0.0';
    expect(() => parseResultsBundle(JSON.stringify(invalid))).toThrow(
      'does not match results bundle v1.0.0',
    );
  });
});

describe('space plot model', () => {
  it('maps every state inside the padded plot region', () => {
    const bundle = getExampleBundle();
    const { points } = plottedPoints(bundle);

    expect(points).toHaveLength(bundle.precomputed.ordination.states.length);
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(PLOT_PADDING);
      expect(point.x).toBeLessThanOrEqual(PLOT_WIDTH - PLOT_PADDING);
      expect(point.y).toBeGreaterThanOrEqual(PLOT_PADDING);
      expect(point.y).toBeLessThanOrEqual(PLOT_HEIGHT - PLOT_PADDING);
    }
  });
});
