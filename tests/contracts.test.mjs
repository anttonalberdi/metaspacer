import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function digest(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',');
  return {
    headers,
    rows: lines.map((line) =>
      Object.fromEntries(
        line.split(',').map((value, index) => [headers[index], value]),
      ),
    ),
  };
}

function assertMatrix(matrix, rows, columns, name) {
  assert.equal(matrix.length, rows, `${name} row count`);
  for (const row of matrix) {
    assert.equal(row.length, columns, `${name} column count`);
  }
}

const [modelSchema, bundleSchema, modelSpec, resultsBundle] = await Promise.all(
  [
    readJson('schemas/model-spec.schema.json'),
    readJson('schemas/results-bundle.schema.json'),
    readJson('examples/model-spec.json'),
    readJson('examples/results-bundle.json'),
  ],
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateModelSpec = ajv.compile(modelSchema);
const validateResultsBundle = ajv.compile(bundleSchema);

test('golden model spec conforms to its schema', () => {
  assert.equal(
    validateModelSpec(modelSpec),
    true,
    ajv.errorsText(validateModelSpec.errors),
  );
});

test('golden results bundle conforms to its schema', () => {
  assert.equal(
    validateResultsBundle(resultsBundle),
    true,
    ajv.errorsText(validateResultsBundle.errors),
  );
});

test('model schema rejects unsafe resource and modelling combinations', () => {
  const gpuOnCpuEngine = clone(modelSpec);
  gpuOnCpuEngine.resources.gpuDevice = 0;
  assert.equal(validateModelSpec(gpuOnCpuEngine), false);

  const noLibraryOffset = clone(modelSpec);
  noLibraryOffset.model.offset.librarySize = false;
  assert.equal(validateModelSpec(noLibraryOffset), false);

  const phylogenyWithoutTree = clone(modelSpec);
  delete phylogenyWithoutTree.data.phylogeneticTree;
  assert.equal(validateModelSpec(phylogenyWithoutTree), false);

  const disabledFormula = clone(modelSpec);
  disabledFormula.model.fourthCorner.enabled = false;
  assert.equal(validateModelSpec(disabledFormula), false);
});

test('bundle schema rejects missing uncertainty and tier/geometry disagreement', () => {
  const noUncertainty = clone(resultsBundle);
  delete noUncertainty.precomputed.metrics[0].estimate;
  assert.equal(validateResultsBundle(noUncertainty), false);

  const disguisedExtrapolation = clone(resultsBundle);
  const state = disguisedExtrapolation.precomputed.ordination.states.find(
    (candidate) => candidate.tier === 'extrapolated',
  );
  state.geometry.insideSampledDomain = true;
  assert.equal(validateResultsBundle(disguisedExtrapolation), false);

  const missingMetric = clone(resultsBundle);
  missingMetric.precomputed.metrics = missingMetric.precomputed.metrics.filter(
    (metric) => metric.id !== 'chao_coverage',
  );
  assert.equal(validateResultsBundle(missingMetric), false);
});

test('all declared fixture hashes match the files on disk', async () => {
  for (const [key, reference] of Object.entries(modelSpec.data)) {
    assert.ok(reference, `${key} reference must be present`);
    assert.equal(
      await digest(join('examples', reference.path)),
      reference.sha256,
      `${key} spec hash`,
    );
    assert.equal(
      resultsBundle.provenance.dataSha256[key],
      reference.sha256,
      `${key} bundle hash`,
    );
  }
  assert.equal(
    await digest('examples/model-spec.json'),
    resultsBundle.provenance.specSha256,
  );
});

test('golden tables have aligned sample and feature identifiers', async () => {
  const [counts, samples, features, tree] = await Promise.all([
    readFile('examples/data/counts.csv', 'utf8').then(parseCsv),
    readFile('examples/data/sample-metadata.csv', 'utf8').then(parseCsv),
    readFile('examples/data/feature-metadata.csv', 'utf8').then(parseCsv),
    readFile('examples/data/features.nwk', 'utf8'),
  ]);

  assert.equal(counts.rows.length, 100);
  assert.equal(samples.rows.length, 100);
  assert.equal(features.rows.length, 40);
  assert.equal(counts.headers.length, 41);
  assert.deepEqual(
    counts.rows.map((row) => row.sample_id),
    samples.rows.map((row) => row.sample_id),
  );

  const responseFeatures = counts.headers.slice(1);
  const metadataFeatures = features.rows.map((row) => row.feature_id);
  const treeFeatures = tree.match(/MAG_[0-9]{3}/g);
  assert.deepEqual(responseFeatures, metadataFeatures);
  assert.deepEqual(treeFeatures, metadataFeatures);

  const groupCounts = Object.groupBy(samples.rows, (row) => row.group);
  assert.equal(groupCounts.Wild.length, 50);
  assert.equal(groupCounts.Zoo_A.length, 25);
  assert.equal(groupCounts.Zoo_B.length, 25);
});

test('technical QC fields cannot silently become ecological traits', () => {
  const featureRoles = modelSpec.roles.features;
  const traitColumns = new Set(
    featureRoles.functionalTraits.map((trait) => trait.column),
  );
  const technicalColumns = [
    featureRoles.technicalQc.completenessColumn,
    featureRoles.technicalQc.contaminationColumn,
    featureRoles.technicalQc.genomeSizeColumn,
  ];
  const overlap = technicalColumns.filter((column) => traitColumns.has(column));

  if (!featureRoles.technicalQc.genomeSizeHasEcologicalRole) {
    assert.deepEqual(overlap, []);
  } else {
    assert.deepEqual(overlap, [featureRoles.technicalQc.genomeSizeColumn]);
  }
});

test('bundle contains every required metric and every confidence tier', () => {
  const expectedMetrics = new Set([
    'dispersion',
    'effective_dimensionality',
    'schoener_d',
    'containment',
    'transition_distance',
    'plasticity',
    'variance_partition',
    'chao_coverage',
  ]);
  const presentMetrics = new Set(
    resultsBundle.precomputed.metrics.map((metric) => metric.id),
  );
  assert.deepEqual(presentMetrics, expectedMetrics);

  const tiers = new Set([
    ...resultsBundle.precomputed.metrics.map((metric) => metric.tier),
    ...resultsBundle.precomputed.ordination.states.map((state) => state.tier),
  ]);
  assert.deepEqual(
    tiers,
    new Set(['measured', 'interpolated', 'extrapolated']),
  );

  for (const metric of resultsBundle.precomputed.metrics) {
    assert.ok(
      metric.estimate.lower <= metric.estimate.median,
      `${metric.label} lower bound`,
    );
    assert.ok(
      metric.estimate.median <= metric.estimate.upper,
      `${metric.label} upper bound`,
    );
  }
});

test('projection parameter dimensions are internally consistent', () => {
  const parameters = resultsBundle.fittedParameters;
  const dimensions = parameters.dimensions;

  assert.equal(parameters.responseFeatures.length, dimensions.responses);
  assert.equal(parameters.coefficientNames.length, dimensions.coefficients);
  assert.deepEqual(
    parameters.design.columns.map((column) => column.name),
    parameters.coefficientNames,
  );
  assert.deepEqual(
    new Set(parameters.design.predictors.map((predictor) => predictor.name)),
    new Set(
      modelSpec.roles.samples.focalVariables.map((variable) => variable.column),
    ),
  );
  assertMatrix(
    parameters.beta,
    dimensions.coefficients,
    dimensions.responses,
    'beta',
  );
  assertMatrix(
    parameters.latentLoadings,
    dimensions.latentVariables,
    dimensions.responses,
    'latentLoadings',
  );
  assert.equal(
    parameters.latentDistribution.mean.length,
    dimensions.latentVariables,
  );
  assertMatrix(
    parameters.latentDistribution.covariance,
    dimensions.latentVariables,
    dimensions.latentVariables,
    'latent covariance',
  );
  assert.equal(parameters.projection.center.length, dimensions.responses);
  assertMatrix(
    parameters.projection.rotation,
    dimensions.responses,
    dimensions.projectionAxes,
    'projection rotation',
  );
  assert.equal(parameters.family.dispersion.length, dimensions.responses);

  const uncertainty = parameters.uncertainty;
  assert.equal(uncertainty.kind, 'sampling_covariance');
  assert.equal(uncertainty.covariance.representation, 'diagonal');
  assert.equal(
    uncertainty.parameterOrder.length,
    uncertainty.covariance.diagonal.length,
  );
});

test('ordination axes, confidence tiers, and geometric flags agree', () => {
  const { axisLabels, states } = resultsBundle.precomputed.ordination;
  for (const state of states) {
    assert.deepEqual(
      state.coordinates.map((coordinate) => coordinate.axis),
      axisLabels,
    );
    assert.equal(
      state.geometry.insideSampledDomain,
      state.tier !== 'extrapolated',
    );
    assert.equal(state.kind === 'observed', state.tier === 'measured');
    for (const coordinate of state.coordinates) {
      assert.ok(coordinate.estimate.lower <= coordinate.estimate.median);
      assert.ok(coordinate.estimate.median <= coordinate.estimate.upper);
    }
  }
});
