import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format } from 'prettier';

const examplesDirectory = 'examples';
const dataDirectory = join(examplesDirectory, 'data');

const dataFiles = {
  countTable: 'counts.csv',
  sampleMetadata: 'sample-metadata.csv',
  featureMetadata: 'feature-metadata.csv',
  phylogeneticTree: 'features.nwk',
};

async function sha256(path) {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

async function dataHash(key) {
  return sha256(join(dataDirectory, dataFiles[key]));
}

async function writeJson(path, value) {
  const content = await format(JSON.stringify(value), { parser: 'json' });
  await writeFile(path, content);
}

function round(value, digits = 4) {
  return Number(value.toFixed(digits));
}

function matrix(rows, columns, valueAt) {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => round(valueAt(row, column))),
  );
}

function estimate(median, width, intervalType = 'confidence') {
  return {
    median: round(median),
    lower: round(median - width),
    upper: round(median + width),
    level: 0.95,
    intervalType,
  };
}

function metric(id, label, tier, median, width, unit, scope, note) {
  return {
    id,
    label,
    tier,
    estimate: estimate(
      median,
      width,
      tier === 'measured' ? 'bootstrap' : 'confidence',
    ),
    unit,
    scope,
    ...(note ? { note } : {}),
  };
}

function state({
  stateId,
  sampleId,
  kind,
  group,
  habitatScore,
  tier,
  x,
  y,
  width,
  inside,
  distance,
}) {
  return {
    stateId,
    ...(sampleId ? { sampleId } : {}),
    kind,
    group,
    condition: { group, habitat_score: habitatScore },
    tier,
    coordinates: [
      { axis: 'Space 1', estimate: estimate(x, width, 'empirical') },
      { axis: 'Space 2', estimate: estimate(y, width, 'empirical') },
    ],
    geometry: {
      method: 'mixed_hull_range',
      insideSampledDomain: inside,
      distanceToDomain: distance,
    },
  };
}

const hashes = Object.fromEntries(
  await Promise.all(
    Object.keys(dataFiles).map(async (key) => [key, await dataHash(key)]),
  ),
);

const spec = {
  specVersion: '1.0.0',
  name: 'Captive and wild golden example',
  description:
    'A deterministic 50 Wild + 25 Zoo A + 25 Zoo B example with 40 MAG response features.',
  data: {
    countTable: {
      path: 'data/counts.csv',
      sha256: hashes.countTable,
      format: 'csv',
    },
    sampleMetadata: {
      path: 'data/sample-metadata.csv',
      sha256: hashes.sampleMetadata,
      format: 'csv',
    },
    featureMetadata: {
      path: 'data/feature-metadata.csv',
      sha256: hashes.featureMetadata,
      format: 'csv',
    },
    phylogeneticTree: {
      path: 'data/features.nwk',
      sha256: hashes.phylogeneticTree,
      format: 'newick',
    },
  },
  roles: {
    response: { table: 'countTable', sampleIdColumn: 'sample_id' },
    samples: {
      table: 'sampleMetadata',
      sampleIdColumn: 'sample_id',
      focalVariables: [
        { column: 'group', type: 'categorical', referenceLevel: 'Wild' },
        { column: 'habitat_score', type: 'continuous' },
      ],
    },
    features: {
      table: 'featureMetadata',
      featureIdColumn: 'feature_id',
      taxonomyColumns: ['phylum', 'genus'],
      functionalTraits: [
        { column: 'oxygen_tolerance', type: 'continuous' },
        { column: 'metabolic_breadth', type: 'continuous' },
      ],
      technicalQc: {
        completenessColumn: 'completeness_pct',
        contaminationColumn: 'contamination_pct',
        genomeSizeColumn: 'genome_size_bp',
        filters: { minimumCompleteness: 90, maximumContamination: 5 },
        genomeSizeHasEcologicalRole: false,
      },
    },
  },
  model: {
    family: 'negative_binomial',
    offset: {
      librarySize: true,
      genomeSizeCorrection: false,
      completenessCorrection: false,
    },
    latentVariables: 2,
    phylogeneticRandomEffect: {
      enabled: true,
      covariance: 'vcv',
      approximation: 'full',
      preserveTipOrder: true,
    },
    fourthCorner: {
      enabled: true,
      formula: '~ group * (oxygen_tolerance + metabolic_breadth)',
    },
  },
  engine: 'gllvm',
  resources: {
    cpuThreads: 4,
    cpuAffinity: [0, 1, 2, 3],
    memorySoftLimitMB: 4096,
    memoryHardLimitMB: 6144,
  },
  seed: 20250920,
  output: { path: 'out/golden-example', overwrite: false },
};

const specPath = join(examplesDirectory, 'model-spec.json');
await writeJson(specPath, spec);

const featureIds = Array.from(
  { length: 40 },
  (_, index) => `MAG_${String(index + 1).padStart(3, '0')}`,
);
const coefficientNames = [
  '(Intercept)',
  'groupZoo_A',
  'groupZoo_B',
  'habitat_score',
];
const beta = matrix(
  coefficientNames.length,
  featureIds.length,
  (row, column) => {
    if (row === 0) return 1.4 + column * 0.035;
    if (row === 1) return -0.32 + column * 0.016;
    if (row === 2) return 0.26 - column * 0.013;
    return -0.2 + column * 0.01;
  },
);
const latentLoadings = matrix(2, featureIds.length, (row, column) =>
  row === 0
    ? Math.sin((column + 1) / 5) * 0.45
    : Math.cos((column + 1) / 6) * 0.4,
);
const rotation = matrix(featureIds.length, 2, (row, column) =>
  column === 0 ? Math.sin((row + 1) / 7) / 4 : Math.cos((row + 1) / 8) / 4,
);

const observedGroups = [
  { group: 'Wild', start: 1, x: -0.45, y: 0.18, habitat: 0.02 },
  { group: 'Zoo_A', start: 51, x: 0.72, y: 0.58, habitat: -0.25 },
  { group: 'Zoo_B', start: 76, x: 0.42, y: -0.62, habitat: 0.2 },
];
const observedStates = observedGroups.flatMap((definition, groupIndex) =>
  Array.from({ length: 5 }, (_, index) =>
    state({
      stateId: `observed-${definition.group.toLowerCase().replace('_', '-')}-${index + 1}`,
      sampleId: `S${String(definition.start + index).padStart(3, '0')}`,
      kind: 'observed',
      group: definition.group,
      habitatScore: round(definition.habitat + (index - 2) * 0.04),
      tier: 'measured',
      x: definition.x + Math.sin(index + groupIndex) * 0.18,
      y: definition.y + Math.cos(index * 1.3 + groupIndex) * 0.16,
      width: 0.035,
      inside: true,
      distance: 0,
    }),
  ),
);
const interpolatedStates = observedGroups.flatMap((definition, groupIndex) =>
  Array.from({ length: 8 }, (_, index) =>
    state({
      stateId: `predicted-${definition.group.toLowerCase().replace('_', '-')}-${index + 1}`,
      kind: 'predicted',
      group: definition.group,
      habitatScore: round(-0.7 + index * 0.2),
      tier: 'interpolated',
      x: definition.x + Math.sin(index * 0.8 + groupIndex) * 0.28,
      y: definition.y + Math.cos(index * 0.7 + groupIndex) * 0.24,
      width: 0.13,
      inside: true,
      distance: 0,
    }),
  ),
);
const extrapolatedStates = Array.from({ length: 8 }, (_, index) =>
  state({
    stateId: `extrapolated-zoo-a-${index + 1}`,
    kind: 'predicted',
    group: 'Zoo_A',
    habitatScore: round(1.1 + index * 0.08),
    tier: 'extrapolated',
    x: 1.1 + Math.sin(index * 0.9) * 0.35,
    y: 0.9 + Math.cos(index * 0.75) * 0.32,
    width: 0.38 + index * 0.025,
    inside: false,
    distance: round(0.1 + index * 0.08),
  }),
);

const parameterOrder = [
  ...coefficientNames.flatMap((coefficient) =>
    featureIds.map((feature) => `Beta[${coefficient},${feature}]`),
  ),
  ...Array.from({ length: 2 }, (_, latent) =>
    featureIds.map((feature) => `Lambda[LV${latent + 1},${feature}]`),
  ).flat(),
];

const bundle = {
  bundleVersion: '1.0.0',
  specVersion: spec.specVersion,
  precomputed: {
    metrics: [
      metric(
        'dispersion',
        'Wild oscillation',
        'measured',
        0.82,
        0.09,
        'ordination_sd',
        {
          group: 'Wild',
        },
      ),
      metric(
        'dispersion',
        'Zoo A oscillation',
        'measured',
        0.61,
        0.08,
        'ordination_sd',
        {
          group: 'Zoo_A',
        },
      ),
      metric(
        'dispersion',
        'Zoo B oscillation',
        'measured',
        0.67,
        0.08,
        'ordination_sd',
        {
          group: 'Zoo_B',
        },
      ),
      metric(
        'effective_dimensionality',
        'Wild effective dimensionality',
        'measured',
        2.4,
        0.25,
        'dimensions',
        { group: 'Wild' },
      ),
      metric(
        'schoener_d',
        'Wild–Zoo A overlap',
        'measured',
        0.58,
        0.06,
        'proportion',
        {
          from: 'Wild',
          to: 'Zoo_A',
        },
      ),
      metric(
        'containment',
        'Zoo A within wild space',
        'measured',
        0.46,
        0.07,
        'proportion',
        {
          container: 'Wild',
          contained: 'Zoo_A',
        },
      ),
      metric(
        'transition_distance',
        'Wild to Zoo A transition',
        'interpolated',
        1.21,
        0.18,
        'ordination_distance',
        { from: 'Wild', to: 'Zoo_A' },
      ),
      metric(
        'plasticity',
        'Predicted habitat response',
        'interpolated',
        0.37,
        0.09,
        'slope',
        {
          condition: 'habitat_score',
        },
      ),
      metric(
        'variance_partition',
        'Actionable variance',
        'interpolated',
        0.34,
        0.05,
        'proportion',
        { component: 'actionable' },
      ),
      metric(
        'variance_partition',
        'Structural variance',
        'interpolated',
        0.66,
        0.05,
        'proportion',
        { component: 'structural' },
      ),
      metric(
        'chao_coverage',
        'Wild sample coverage',
        'measured',
        0.92,
        0.025,
        'proportion',
        {
          group: 'Wild',
        },
      ),
      metric(
        'plasticity',
        'Beyond-range habitat response',
        'extrapolated',
        0.51,
        0.24,
        'slope',
        { condition: 'habitat_score', scenario: 'beyond_observed_range' },
        'An fMS proxy; uncertainty widens beyond the sampled condition range.',
      ),
    ],
    ordination: {
      axisLabels: ['Space 1', 'Space 2'],
      states: [...observedStates, ...interpolatedStates, ...extrapolatedStates],
    },
  },
  fittedParameters: {
    dimensions: {
      responses: featureIds.length,
      coefficients: coefficientNames.length,
      latentVariables: 2,
      projectionAxes: 2,
    },
    responseFeatures: featureIds,
    coefficientNames,
    design: {
      predictors: [
        {
          name: 'group',
          type: 'categorical',
          levels: ['Wild', 'Zoo_A', 'Zoo_B'],
          referenceLevel: 'Wild',
        },
        {
          name: 'habitat_score',
          type: 'continuous',
          center: 0,
          scale: 1,
        },
      ],
      columns: [
        { name: '(Intercept)', factors: [] },
        {
          name: 'groupZoo_A',
          factors: [
            { predictor: 'group', operation: 'indicator', level: 'Zoo_A' },
          ],
        },
        {
          name: 'groupZoo_B',
          factors: [
            { predictor: 'group', operation: 'indicator', level: 'Zoo_B' },
          ],
        },
        {
          name: 'habitat_score',
          factors: [{ predictor: 'habitat_score', operation: 'identity' }],
        },
      ],
    },
    offset: {
      librarySize: {
        source: 'count_table_row_sum',
        transform: 'log',
        referenceValue: 1000,
      },
      genomeSizeCorrection: false,
      completenessCorrection: false,
    },
    beta,
    latentLoadings,
    latentDistribution: {
      mean: [0, 0],
      covariance: [
        [1, 0.12],
        [0.12, 1],
      ],
    },
    projection: {
      center: featureIds.map((_, index) => round(2.05 + index * 0.018)),
      rotation,
    },
    family: {
      name: 'negative_binomial',
      link: 'log',
      dispersion: featureIds.map((_, index) => round(5.5 + (index % 7) * 0.4)),
    },
    uncertainty: {
      kind: 'sampling_covariance',
      parameterOrder,
      covariance: {
        representation: 'diagonal',
        diagonal: parameterOrder.map((_, index) =>
          round(0.012 + (index % 9) * 0.001),
        ),
      },
    },
  },
  provenance: {
    specSha256: await sha256(specPath),
    dataSha256: hashes,
    engine: { name: 'gllvm', version: 'contract-fixture-not-fitted' },
    metaspacerVersion: '0.1.0-example',
    seed: spec.seed,
    createdAt: '2026-09-20T00:00:00Z',
    tierDefinitions: {
      measured: 'Computed directly from observed samples.',
      interpolated:
        'Model prediction inside the geometrically sampled condition domain.',
      extrapolated:
        'Model prediction outside the geometrically sampled condition domain; an fMS proxy only.',
    },
    extrapolationMethod: {
      name: 'mixed_hull_range',
      conditionColumns: ['group', 'habitat_score'],
    },
    warnings: [
      'This golden bundle is a deterministic contract fixture, not the output of a fitted model.',
      'Extrapolated states are fMS proxies and do not establish a genetic ceiling.',
    ],
  },
};

await writeJson(join(examplesDirectory, 'results-bundle.json'), bundle);
