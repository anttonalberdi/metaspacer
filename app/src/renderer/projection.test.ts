import { describe, expect, it } from 'vitest';
import { getExampleBundle } from './bundle';
import {
  classifyCondition,
  defaultCondition,
  encodeCondition,
  projectCondition,
  projectTransition,
} from './projection';

describe('interactive projection math', () => {
  it('encodes categorical and continuous conditions from bundle metadata', () => {
    const bundle = getExampleBundle();

    expect(
      encodeCondition(bundle, { group: 'Zoo_A', habitat_score: -0.25 }),
    ).toEqual([1, 1, 0, -0.25]);
  });

  it('uses the sampled geometric domain independently of the model', () => {
    const bundle = getExampleBundle();
    const inside = classifyCondition(bundle, {
      group: 'Zoo_A',
      habitat_score: -0.25,
    });
    const outside = classifyCondition(bundle, {
      group: 'Zoo_A',
      habitat_score: 2,
    });

    expect(inside.insideSampledDomain).toBe(true);
    expect(inside.distanceToDomain).toBe(0);
    expect(outside.insideSampledDomain).toBe(false);
    expect(outside.distanceToDomain).toBeGreaterThan(0);
  });

  it('projects with intervals and decodes a normalized composition', () => {
    const bundle = getExampleBundle();
    const projection = projectCondition(
      bundle,
      { group: 'Wild', habitat_score: 0.02 },
      40,
    );

    expect(projection.tier).toBe('interpolated');
    expect(projection.coverage?.median).toBeGreaterThan(0);
    expect(projection.coordinates).toHaveLength(2);
    expect(projection.coordinates[0].estimate.lower).toBeLessThanOrEqual(
      projection.coordinates[0].estimate.median,
    );
    expect(projection.coordinates[0].estimate.upper).toBeGreaterThanOrEqual(
      projection.coordinates[0].estimate.median,
    );
    expect(
      projection.composition.reduce(
        (sum, feature) => sum + feature.estimate.median,
        0,
      ),
    ).toBeCloseTo(1, 8);
    expect(projection.composition[0].estimate.median).toBeGreaterThanOrEqual(
      projection.composition[1].estimate.median,
    );
  });

  it('creates a tiered transition with an uncertainty interval', () => {
    const bundle = getExampleBundle();
    const from = defaultCondition(bundle);
    const to = { ...defaultCondition(bundle, true), habitat_score: 2 };
    const transition = projectTransition(bundle, from, to, 40);

    expect(transition.from.tier).toBe('interpolated');
    expect(transition.to.tier).toBe('extrapolated');
    expect(transition.distance.median).toBeGreaterThan(0);
    expect(transition.distance.lower).toBeLessThanOrEqual(
      transition.distance.median,
    );
    expect(transition.distance.upper).toBeGreaterThanOrEqual(
      transition.distance.median,
    );
  });
});
